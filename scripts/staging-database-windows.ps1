param(
  [ValidateSet('preflight', 'apply', 'test', 'auth-test', 'hosted-acceptance')]
  [string]$Operation = 'preflight'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$gitCommonDirectory = (& git -C $repositoryRoot rev-parse --path-format=absolute --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0 -or -not $gitCommonDirectory) {
  throw 'Unable to resolve the canonical Git directory for protected staging configuration'
}
$canonicalRepositoryRoot = Split-Path -Parent $gitCommonDirectory
$engineRoot = Split-Path -Parent $canonicalRepositoryRoot
$configurationPath = Join-Path $repositoryRoot 'supabase\staging-project.json'
$poolerPath = Join-Path $canonicalRepositoryRoot 'supabase\.temp\pooler-url'
$linkedProjectPath = Join-Path $canonicalRepositoryRoot 'supabase\.temp\project-ref'
$secretPath = Join-Path $engineRoot '.secrets\green-hive-staging-db-password.dpapi'
$publishableKeyPath = Join-Path $engineRoot '.secrets\green-hive-staging-publishable-key.dpapi'
$serviceRoleKeyPath = Join-Path $engineRoot '.secrets\green-hive-staging-secret-key.dpapi'
$certificatePath = Join-Path $repositoryRoot 'config\supabase-root-2021-ca.crt'

foreach ($requiredPath in @(
  $configurationPath,
  $poolerPath,
  $linkedProjectPath,
  $secretPath,
  $publishableKeyPath,
  $serviceRoleKeyPath,
  $certificatePath
)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required staging configuration is unavailable: $requiredPath"
  }
}

$configuration = Get-Content -LiteralPath $configurationPath -Raw -Encoding UTF8 | ConvertFrom-Json
$linkedProject = (Get-Content -LiteralPath $linkedProjectPath -Raw -Encoding UTF8).Trim()
if ($linkedProject -ne $configuration.projectRef) {
  throw 'The linked Supabase project does not match supabase/staging-project.json'
}

$pooler = [Uri](Get-Content -LiteralPath $poolerPath -Raw -Encoding UTF8).Trim()
if ($pooler.Port -ne 5432 -or -not $pooler.Host.EndsWith('.pooler.supabase.com')) {
  throw 'The linked Supabase session pooler is not the expected TLS port 5432 endpoint'
}

$encryptedPassword = Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8
$securePassword = ConvertTo-SecureString -String $encryptedPassword
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

function Unprotect-DpapiText([string]$Path) {
  $encryptedValue = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $secureValue = ConvertTo-SecureString -String $encryptedValue
  $valuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($valuePointer)
  } finally {
    if ($valuePointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($valuePointer)
    }
  }
}

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $escapedUser = [Uri]::EscapeDataString($pooler.UserInfo)
  $escapedPassword = [Uri]::EscapeDataString($plainPassword)
  $databaseUrl = "postgresql://${escapedUser}:${escapedPassword}@$($pooler.Host):5432/postgres?sslmode=verify-full"

  $env:GREEN_HIVE_STAGING_PROJECT_REF = $configuration.projectRef
  $env:GREEN_HIVE_STAGING_PROJECT_NAME = $configuration.projectName
  $env:GREEN_HIVE_STAGING_REGION = $configuration.region
  $env:GREEN_HIVE_STAGING_TARGET = 'SUPABASE_STAGING'
  $env:GREEN_HIVE_STAGING_CONFIRM = 'GREEN_HIVE_DEDICATED_STAGING'
  $env:GREEN_HIVE_STAGING_DATABASE_URL = $databaseUrl
  $env:NODE_EXTRA_CA_CERTS = $certificatePath

  if ($Operation -eq 'auth-test' -or $Operation -eq 'hosted-acceptance') {
    $publishableKey = Unprotect-DpapiText $publishableKeyPath
    $serviceRoleKey = Unprotect-DpapiText $serviceRoleKeyPath
    $env:GREEN_HIVE_TEST_DATABASE_URL = $databaseUrl
    $env:GREEN_HIVE_TEST_TARGET = 'SUPABASE_STAGING'
    $env:GREEN_HIVE_TEST_CONFIRM = 'GREEN_HIVE_DEDICATED_STAGING'
    $env:GREEN_HIVE_TEST_PREPARED = 'SUPABASE_STAGING_BASELINE_READY'
    $env:GREEN_HIVE_SUPABASE_AUTH_URL = $configuration.authUrl
    $env:GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY = $publishableKey
    $env:GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY = $serviceRoleKey
    if ($Operation -eq 'hosted-acceptance') {
      $env:GREEN_HIVE_STAGING_APP_ORIGIN = 'https://green-hive-staging.onrender.com'
      $env:GREEN_HIVE_SUPABASE_AUTH_URL = $configuration.authUrl
      $env:GREEN_HIVE_AUTH_RECOVERY_REDIRECT = 'https://green-hive-staging.onrender.com/auth/recovery'
      $env:GREEN_HIVE_HOSTED_APP_ORIGIN = 'https://green-hive-staging.onrender.com'
      $env:GREEN_HIVE_HOSTED_TEST_CONFIRM = 'CREATE_DISPOSABLE_HOSTED_FIXTURES'
    }
    & npm run build --silent
    if ($LASTEXITCODE -eq 0) {
      if ($Operation -eq 'hosted-acceptance') {
        & node scripts/hosted-acceptance.mjs
      } else {
        & node --test --test-reporter=spec database/tests/staging-auth.integration.test.mjs
      }
    }
  } elseif ($Operation -eq 'test') {
    $env:GREEN_HIVE_TEST_DATABASE_URL = $databaseUrl
    $env:GREEN_HIVE_TEST_TARGET = 'SUPABASE_STAGING'
    $env:GREEN_HIVE_TEST_CONFIRM = 'GREEN_HIVE_DEDICATED_STAGING'
    $env:GREEN_HIVE_TEST_PREPARED = 'SUPABASE_STAGING_BASELINE_READY'
    & npm run build --silent
    if ($LASTEXITCODE -eq 0) {
      & node --test --test-reporter=spec database/tests/postgres-rls.integration.test.mjs
    }
    if ($LASTEXITCODE -eq 0) {
      & node --test --test-reporter=spec database/tests/project-service.integration.test.mjs
    }
    if ($LASTEXITCODE -eq 0) {
      & node --test --test-reporter=spec database/tests/billing-service.supabase.integration.test.mjs
    }
  } elseif ($Operation -eq 'apply') {
    & node (Join-Path $repositoryRoot 'scripts\staging-apply.mjs')
  } else {
    & node (Join-Path $repositoryRoot 'scripts\staging-preflight.mjs') --database-only
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Staging database $Operation failed"
  }
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  Remove-Variable plainPassword,databaseUrl,escapedPassword -ErrorAction SilentlyContinue
  Remove-Variable publishableKey,serviceRoleKey -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_PROJECT_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_REGION -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_TARGET -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_CONFIRM -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_TEST_TARGET -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_TEST_CONFIRM -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_TEST_PREPARED -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_SUPABASE_AUTH_URL -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_STAGING_APP_ORIGIN -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_AUTH_RECOVERY_REDIRECT -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_HOSTED_APP_ORIGIN -ErrorAction SilentlyContinue
  Remove-Item Env:GREEN_HIVE_HOSTED_TEST_CONFIRM -ErrorAction SilentlyContinue
}
