-- green_hive_migration: 0003
-- checkpoint: GH-0102
-- description: Create app-neutral profiles linked to the Supabase authentication authority.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_PROFILE_RESTORE

CREATE TABLE hive.user_profiles (
  user_id uuid PRIMARY KEY,
  display_name text,
  preferred_language text NOT NULL DEFAULT 'pt',
  preferred_locale text NOT NULL DEFAULT 'pt-BR',
  timezone text NOT NULL DEFAULT 'UTC',
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_auth_user_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT user_profiles_display_name_length CHECK (
    display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT user_profiles_language_format CHECK (preferred_language ~ '^[a-z]{2,3}$'),
  CONSTRAINT user_profiles_locale_format CHECK (
    preferred_locale ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'
  ),
  CONSTRAINT user_profiles_timezone_present CHECK (char_length(btrim(timezone)) > 0),
  CONSTRAINT user_profiles_preferences_object CHECK (jsonb_typeof(preferences) = 'object')
);

COMMENT ON COLUMN hive.user_profiles.user_id IS
  'Supabase Auth subject. Credentials and secrets never live in the Hive schema.';
