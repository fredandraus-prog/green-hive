param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath
)

$ErrorActionPreference = 'Stop'
$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ("green-hive-recovery-" + [guid]::NewGuid().ToString('N'))
$download = Join-Path ([System.IO.Path]::GetTempPath()) ("green-hive-recovery-download-" + [guid]::NewGuid().ToString('N'))
$supabaseContainer = 'supabase_db_green-hive'
$recoveryToken = [guid]::NewGuid().ToString('N').Substring(0, 12)
$recoveryDatabase = "green_hive_restore_proof_$recoveryToken"
$containerWorkspace = "/tmp/green-hive-recovery-$recoveryToken"
$securePassphrase = Read-Host -AsSecureString 'Cole a frase secreta do backup (ela nao sera exibida)'
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassphrase)

try {
  $passphrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $env:GREEN_HIVE_BACKUP_PASSPHRASE = $passphrase
  New-Item -ItemType Directory -Path $download | Out-Null

  if ((Get-Item -LiteralPath $ArtifactPath).PSIsContainer) {
    Copy-Item -Path (Join-Path $ArtifactPath '*') -Destination $download -Recurse -Force
  } else {
    Expand-Archive -LiteralPath $ArtifactPath -DestinationPath $download -Force
  }

  & node scripts/backup-recovery-local.mjs prepare $download $workspace
  if ($LASTEXITCODE -ne 0) { throw 'A verificacao criptografica ou o inventario do backup falhou.' }

  $supabaseImage = & docker inspect --format '{{.Config.Image}}' $supabaseContainer
  if ($LASTEXITCODE -ne 0 -or $supabaseImage -notmatch '^public\.ecr\.aws/supabase/postgres:17\.') {
    throw 'A prova exige o container local oficial Supabase PostgreSQL 17, supabase_db_green-hive.'
  }
  # `postgres` is the live local development database and may have active
  # Auth/Mailpit clients, so PostgreSQL correctly refuses a template clone.
  # Create an empty disposable database and restore a local-only system dump
  # instead; pg_dump can read the active baseline without disconnecting it.
  & docker exec $supabaseContainer createdb -U postgres --template=template0 $recoveryDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o banco temporario isolado de recuperacao.' }
  & docker exec $supabaseContainer mkdir -p $containerWorkspace
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel preparar o diretorio temporario dentro do Supabase local.' }
  & docker cp (Join-Path $workspace '.') "${supabaseContainer}:$containerWorkspace"
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel copiar o restore temporario para o Supabase local.' }

  # The local Supabase server pre-provisions its cluster roles and managed
  # Auth/Storage/Vault schemas. Restore a local-only baseline dump into this
  # empty database, then remove only application schemas and disposable data.
  # The external role-only dump remains verified but is not applied because
  # roles are cluster-wide in the running local Supabase instance.
  $psql = @('exec', $supabaseContainer, 'psql', '-U', 'postgres', '-d', $recoveryDatabase, '--quiet', '--single-transaction', '--set', 'ON_ERROR_STOP=1')
  # Vault secret values are not part of the technical baseline. Keep its
  # extension/schema shape but exclude its protected table data.
  & docker exec $supabaseContainer pg_dump -U postgres -d postgres --no-owner --no-privileges --exclude-table-data=vault.secrets --file "$containerWorkspace/local-system-baseline.sql"
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel capturar o baseline tecnico local do Supabase.' }
  & docker @psql '--file' "$containerWorkspace/local-system-baseline.sql" *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel preparar o baseline tecnico no banco temporario.' }
  $targetCleanupSql = @'
DROP SCHEMA IF EXISTS hive CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;
DROP SCHEMA IF EXISTS reference_app CASCADE;
TRUNCATE TABLE auth.users CASCADE;
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN TRUNCATE TABLE storage.objects CASCADE; END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN TRUNCATE TABLE storage.buckets CASCADE; END IF;
END $$;
'@
  & docker @psql '--command' $targetCleanupSql *> $null
  if ($LASTEXITCODE -ne 0) { throw 'A limpeza do banco temporario isolado falhou.' }
  & docker @psql '--file' "$containerWorkspace/target-bootstrap.sql"
  if ($LASTEXITCODE -ne 0) { throw 'O preparo do alvo Supabase temporario falhou.' }
  # Realtime stays disabled for normal local development, but the verified
  # staging schema contains ALTER PUBLICATION statements. The publication is
  # created only in this generated database and vanishes with its cleanup.
  $publicationExists = (& docker @psql '--tuples-only' '--no-align' '--command' "SELECT EXISTS(SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime');").Trim()
  if ($publicationExists -ne 't') {
    & docker @psql '--command' 'CREATE PUBLICATION supabase_realtime;'
    if ($LASTEXITCODE -ne 0) { throw 'O preparo da publicacao temporaria de Realtime falhou.' }
  }

  # The official Supabase image provides native extensions. The verified dump
  # may still reference a technical schema before defining it in this isolated
  # database, so only safe placeholder schema names are retried locally.
  # Create only identifier-shaped missing schema placeholders, locally, with a
  # hard retry bound, then restart only the schema restore transaction.
  $schemaRestored = $false
  foreach ($attempt in 1..8) {
    $schemaRestoreOutput = & docker @psql '--file' "$containerWorkspace/plain/schema.sql" 2>&1
    if ($LASTEXITCODE -eq 0) {
      $schemaRestored = $true
      break
    }

    $missingSchemaMatch = [regex]::Match(($schemaRestoreOutput | Out-String), 'schema "([A-Za-z_][A-Za-z0-9_]*)" does not exist')
    if (-not $missingSchemaMatch.Success) {
      $schemaRestoreOutput | Write-Output
      break
    }

    $missingSchema = $missingSchemaMatch.Groups[1].Value
    $bootstrapSchemaSql = "CREATE SCHEMA IF NOT EXISTS $missingSchema;"
    & docker @psql '--command' $bootstrapSchemaSql
    if ($LASTEXITCODE -ne 0) { throw 'O preparo de um schema temporario do Supabase falhou.' }
  }
  if (-not $schemaRestored) { throw 'A restauracao de schema falhou.' }
  & docker @psql '--command' 'SET session_replication_role = replica' '--file' "$containerWorkspace/plain/data.sql"
  if ($LASTEXITCODE -ne 0) { throw 'A restauracao de dados falhou.' }
  & docker @psql '--file' "$containerWorkspace/verify-recovery.sql"
  if ($LASTEXITCODE -ne 0) { throw 'A matriz de verificacao da recuperacao falhou.' }

  Write-Output 'RECOVERY_PROOF_SUCCESS target=local-supabase-disposable-database plaintext=removed-on-cleanup'
} finally {
  $env:GREEN_HIVE_BACKUP_PASSPHRASE = $null
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  & docker exec $supabaseContainer psql -U postgres -d postgres --command "DROP DATABASE IF EXISTS $recoveryDatabase WITH (FORCE);" *> $null
  & docker exec $supabaseContainer rm -rf -- $containerWorkspace *> $null
  Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $download -Recurse -Force -ErrorAction SilentlyContinue
}
