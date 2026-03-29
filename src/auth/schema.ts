export const AUTH_SCHEMA_SQL = `
-- pgcrypto and uuid-ossp are pre-loaded via createPGlite factory
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- API roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  -- authenticator: PostgREST connects as this role then SET ROLE per request
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN;
  END IF;
  -- supabase_auth_admin: owns auth schema tables
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
  -- dashboard_user: used by Supabase Studio / pg-meta
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'dashboard_user') THEN
    CREATE ROLE dashboard_user NOSUPERUSER CREATEDB CREATEROLE REPLICATION;
  END IF;
END
$$;

GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;

-- Statement timeouts matching official Supabase defaults
ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';

-- Public schema grants
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Auth schema grants
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO service_role;

-- supabase_auth_admin owns the auth schema
GRANT ALL PRIVILEGES ON SCHEMA auth TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = "auth";

-- dashboard_user gets full access to auth (Studio needs this)
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO dashboard_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO dashboard_user;
GRANT ALL ON ALL ROUTINES IN SCHEMA auth TO dashboard_user;

-- Users table — columns match supabase/postgres init-scripts + incremental migrations
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  aud VARCHAR(255),
  role VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  encrypted_password VARCHAR(255),
  -- confirmed_at: original base column from init script
  confirmed_at TIMESTAMPTZ,
  -- email_confirmed_at: added in later migrations (alias for confirmed_at in practice)
  email_confirmed_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  confirmation_token VARCHAR(255),
  confirmation_sent_at TIMESTAMPTZ,
  recovery_token VARCHAR(255),
  recovery_sent_at TIMESTAMPTZ,
  -- email_change_token: original single column; _new/_current added in later migrations
  email_change_token VARCHAR(255),
  email_change_token_new VARCHAR(255),
  email_change_token_current VARCHAR(255),
  email_change VARCHAR(255),
  email_change_sent_at TIMESTAMPTZ,
  email_change_confirm_status SMALLINT DEFAULT 0,
  last_sign_in_at TIMESTAMPTZ,
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  phone VARCHAR(255) UNIQUE,
  phone_confirmed_at TIMESTAMPTZ,
  phone_change VARCHAR(255),
  phone_change_token VARCHAR(255),
  phone_change_sent_at TIMESTAMPTZ,
  banned_until TIMESTAMPTZ,
  reauthentication_token VARCHAR(255),
  reauthentication_sent_at TIMESTAMPTZ,
  is_sso_user BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  is_anonymous BOOLEAN DEFAULT FALSE,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- Sessions table
CREATE TABLE IF NOT EXISTS auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  factor_id UUID,
  aal VARCHAR(255) DEFAULT 'aal1',
  not_after TIMESTAMPTZ,
  refreshed_at TIMESTAMPTZ,
  user_agent TEXT,
  ip INET,
  tag TEXT
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  parent VARCHAR(255),
  session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE
);

-- Instances table (required by GoTrue / pg-meta introspection)
CREATE TABLE IF NOT EXISTS auth.instances (
  id UUID PRIMARY KEY,
  uuid UUID,
  raw_base_config TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Audit log entries
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id UUID,
  id UUID NOT NULL PRIMARY KEY,
  payload JSON,
  created_at TIMESTAMPTZ,
  ip_address VARCHAR(64) DEFAULT ''
);

-- Schema migrations tracker
CREATE TABLE IF NOT EXISTS auth.schema_migrations (
  version VARCHAR(255) PRIMARY KEY
);

-- Identities (OAuth / external provider links)
CREATE TABLE IF NOT EXISTS auth.identities (
  provider_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data JSONB NOT NULL,
  provider TEXT NOT NULL,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  email TEXT GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT identities_pkey PRIMARY KEY (id),
  CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider)
);
CREATE INDEX IF NOT EXISTS identities_user_id_idx ON auth.identities (user_id);
CREATE INDEX IF NOT EXISTS identities_email_idx ON auth.identities (email);

-- PKCE flow state
CREATE TABLE IF NOT EXISTS auth.flow_state (
  id UUID NOT NULL PRIMARY KEY,
  user_id UUID,
  auth_code TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  provider_access_token TEXT,
  provider_refresh_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  authentication_method TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS flow_state_created_at_idx ON auth.flow_state (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_code ON auth.flow_state (auth_code);
CREATE INDEX IF NOT EXISTS idx_user_id_auth_method ON auth.flow_state (user_id, authentication_method);

-- MFA factors
CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id UUID NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name TEXT,
  factor_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  secret TEXT,
  phone TEXT,
  last_challenged_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_factors_user_friendly_name_unique ON auth.mfa_factors (user_id, friendly_name) WHERE TRIM(friendly_name) <> '';
CREATE INDEX IF NOT EXISTS factor_id_created_at_idx ON auth.mfa_factors (user_id, created_at);

CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
  id UUID NOT NULL PRIMARY KEY,
  factor_id UUID NOT NULL REFERENCES auth.mfa_factors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  ip_address INET NOT NULL
);

CREATE TABLE IF NOT EXISTS auth.mfa_amr_claims (
  session_id UUID NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authentication_method TEXT NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method)
);

-- SSO
CREATE TABLE IF NOT EXISTS auth.sso_providers (
  id UUID NOT NULL PRIMARY KEY,
  resource_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.sso_domains (
  id UUID NOT NULL PRIMARY KEY,
  sso_provider_id UUID NOT NULL REFERENCES auth.sso_providers(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sso_domains_domain_idx ON auth.sso_domains (lower(domain));
CREATE INDEX IF NOT EXISTS sso_domains_sso_provider_id_idx ON auth.sso_domains (sso_provider_id);

CREATE TABLE IF NOT EXISTS auth.saml_providers (
  id UUID NOT NULL PRIMARY KEY,
  sso_provider_id UUID NOT NULL REFERENCES auth.sso_providers(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL UNIQUE,
  metadata_xml TEXT NOT NULL,
  metadata_url TEXT,
  attribute_mapping JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  name_id_format TEXT
);
CREATE INDEX IF NOT EXISTS saml_providers_sso_provider_id_idx ON auth.saml_providers (sso_provider_id);

CREATE TABLE IF NOT EXISTS auth.saml_relay_states (
  id UUID NOT NULL PRIMARY KEY,
  sso_provider_id UUID NOT NULL REFERENCES auth.sso_providers(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  for_email TEXT,
  redirect_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  flow_state_id UUID REFERENCES auth.flow_state(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states (sso_provider_id);
CREATE INDEX IF NOT EXISTS saml_relay_states_for_email_idx ON auth.saml_relay_states (for_email);
CREATE INDEX IF NOT EXISTS saml_relay_states_created_at_idx ON auth.saml_relay_states (created_at DESC);

-- One-time tokens (magic link, email OTP, phone OTP, etc.)
CREATE TABLE IF NOT EXISTS auth.one_time_tokens (
  id UUID NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_type TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  relates_to TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);
CREATE INDEX IF NOT EXISTS one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);
CREATE INDEX IF NOT EXISTS one_time_tokens_user_id_token_type_key ON auth.one_time_tokens (user_id, token_type);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS users_email_idx ON auth.users(email);
CREATE INDEX IF NOT EXISTS users_instance_id_idx ON auth.users(instance_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_not_after_idx ON auth.sessions(not_after);
CREATE INDEX IF NOT EXISTS refresh_tokens_token_idx ON auth.refresh_tokens(token);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON auth.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_session_id_idx ON auth.refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS audit_logs_instance_id_idx ON auth.audit_log_entries(instance_id);
CREATE INDEX IF NOT EXISTS one_time_tokens_expires_at_idx ON auth.one_time_tokens (expires_at);
CREATE INDEX IF NOT EXISTS mfa_challenges_factor_id_idx ON auth.mfa_challenges (factor_id);
CREATE INDEX IF NOT EXISTS audit_log_entries_created_at_idx ON auth.audit_log_entries (created_at DESC);

-- Function to get current user ID (for RLS policies)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

-- Function to get current user role (for RLS policies)
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$ LANGUAGE SQL STABLE;

-- Function to get current user email (for RLS policies)
CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.email', true), '');
$$ LANGUAGE SQL STABLE;

-- Function to get JWT claims (for RLS policies)
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$ LANGUAGE SQL STABLE;

-- Function to hash a password using pgcrypto
CREATE OR REPLACE FUNCTION auth.hash_password(password TEXT) RETURNS TEXT AS $$
  SELECT crypt(password, gen_salt('bf', 10));
$$ LANGUAGE SQL;

-- Function to verify a password against a hash
CREATE OR REPLACE FUNCTION auth.verify_password(password TEXT, password_hash TEXT) RETURNS BOOLEAN AS $$
  SELECT password_hash = crypt(password, password_hash);
$$ LANGUAGE SQL;

-- Function to generate a secure random token
CREATE OR REPLACE FUNCTION auth.generate_token(length INT DEFAULT 32) RETURNS TEXT AS $$
  SELECT encode(gen_random_bytes(length), 'hex');
$$ LANGUAGE SQL;

-- Function to create a new user with hashed password
CREATE OR REPLACE FUNCTION auth.create_user(
  p_email TEXT,
  p_password TEXT,
  p_user_metadata JSONB DEFAULT '{}'::jsonb,
  p_app_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS auth.users AS $$
DECLARE
  v_user auth.users;
BEGIN
  INSERT INTO auth.users (
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    aud,
    role,
    created_at,
    updated_at
  ) VALUES (
    p_email,
    auth.hash_password(p_password),
    NOW(), -- Auto-confirm for local development
    p_user_metadata,
    p_app_metadata,
    'authenticated',
    'authenticated',
    NOW(),
    NOW()
  ) RETURNING * INTO v_user;

  RETURN v_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify user credentials and return user if valid
CREATE OR REPLACE FUNCTION auth.verify_user_credentials(
  p_email TEXT,
  p_password TEXT
) RETURNS auth.users AS $$
DECLARE
  v_user auth.users;
BEGIN
  SELECT * INTO v_user
  FROM auth.users
  WHERE email = p_email
    AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until < NOW());

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT auth.verify_password(p_password, v_user.encrypted_password) THEN
    RETURN NULL;
  END IF;

  -- Update last sign in time
  UPDATE auth.users
  SET last_sign_in_at = NOW(), updated_at = NOW()
  WHERE id = v_user.id;

  RETURN v_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a session for a user
CREATE OR REPLACE FUNCTION auth.create_session(
  p_user_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL
) RETURNS auth.sessions AS $$
DECLARE
  v_session auth.sessions;
BEGIN
  INSERT INTO auth.sessions (
    user_id,
    user_agent,
    ip,
    created_at,
    updated_at,
    refreshed_at
  ) VALUES (
    p_user_id,
    p_user_agent,
    p_ip::inet,
    NOW(),
    NOW(),
    NOW()
  ) RETURNING * INTO v_session;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a refresh token for a session
CREATE OR REPLACE FUNCTION auth.create_refresh_token(
  p_user_id UUID,
  p_session_id UUID
) RETURNS auth.refresh_tokens AS $$
DECLARE
  v_refresh_token auth.refresh_tokens;
BEGIN
  INSERT INTO auth.refresh_tokens (
    token,
    user_id,
    session_id,
    created_at,
    updated_at
  ) VALUES (
    auth.generate_token(32),
    p_user_id,
    p_session_id,
    NOW(),
    NOW()
  ) RETURNING * INTO v_refresh_token;

  RETURN v_refresh_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to refresh a token (revoke old, create new)
CREATE OR REPLACE FUNCTION auth.refresh_token(
  p_refresh_token TEXT
) RETURNS TABLE(
  new_token TEXT,
  user_id UUID,
  session_id UUID
) AS $$
DECLARE
  v_old_token_id BIGINT;
  v_old_user_id UUID;
  v_old_session_id UUID;
  v_old_token_value TEXT;
  v_new_token TEXT;
BEGIN
  -- Find and validate the old token
  SELECT rt.id, rt.user_id, rt.session_id, rt.token
  INTO v_old_token_id, v_old_user_id, v_old_session_id, v_old_token_value
  FROM auth.refresh_tokens rt
  WHERE rt.token = p_refresh_token
    AND rt.revoked = FALSE;

  IF v_old_token_id IS NULL THEN
    RETURN;
  END IF;

  -- Revoke the old token
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE id = v_old_token_id;

  -- Update session refreshed_at
  UPDATE auth.sessions
  SET refreshed_at = NOW(), updated_at = NOW()
  WHERE id = v_old_session_id;

  -- Create new token
  INSERT INTO auth.refresh_tokens (
    token,
    user_id,
    session_id,
    parent,
    created_at,
    updated_at
  ) VALUES (
    auth.generate_token(32),
    v_old_user_id,
    v_old_session_id,
    v_old_token_value,
    NOW(),
    NOW()
  ) RETURNING token INTO v_new_token;

  -- Return the result
  RETURN QUERY SELECT v_new_token, v_old_user_id, v_old_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke all sessions for a user (sign out)
CREATE OR REPLACE FUNCTION auth.sign_out(p_session_id UUID) RETURNS VOID AS $$
BEGIN
  -- Revoke all refresh tokens for this session
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE session_id = p_session_id;

  -- Delete the session
  DELETE FROM auth.sessions WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sign out all sessions for a user
CREATE OR REPLACE FUNCTION auth.sign_out_all(p_user_id UUID) RETURNS VOID AS $$
BEGIN
  -- Revoke all refresh tokens
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Delete all sessions
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Config table for storing signing key
CREATE TABLE IF NOT EXISTS auth.config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to get or create the signing key
CREATE OR REPLACE FUNCTION auth.get_signing_key() RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
BEGIN
  SELECT value INTO v_key FROM auth.config WHERE key = 'jwt_signing_key';

  IF v_key IS NULL THEN
    v_key := encode(gen_random_bytes(32), 'hex');
    INSERT INTO auth.config (key, value) VALUES ('jwt_signing_key', v_key);
  END IF;

  RETURN v_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to base64url encode
CREATE OR REPLACE FUNCTION auth.base64url_encode(data BYTEA) RETURNS TEXT AS $$
  SELECT replace(replace(rtrim(encode(data, 'base64'), '='), '+', '-'), '/', '_');
$$ LANGUAGE SQL IMMUTABLE;

-- Function to base64url decode
CREATE OR REPLACE FUNCTION auth.base64url_decode(data TEXT) RETURNS BYTEA AS $$
DECLARE
  v_padded TEXT;
  v_converted TEXT;
BEGIN
  v_converted := replace(replace(data, '-', '+'), '_', '/');
  v_padded := v_converted || repeat('=', (4 - length(v_converted) % 4) % 4);
  RETURN decode(v_padded, 'base64');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to create an access token (JWT-like structure using HMAC)
CREATE OR REPLACE FUNCTION auth.create_access_token(
  p_user_id UUID,
  p_session_id UUID,
  p_email TEXT,
  p_role TEXT DEFAULT 'authenticated',
  p_user_metadata JSONB DEFAULT '{}'::jsonb,
  p_app_metadata JSONB DEFAULT '{}'::jsonb,
  p_expires_in INT DEFAULT 3600
) RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
  v_now BIGINT;
  v_exp BIGINT;
  v_header TEXT;
  v_payload TEXT;
  v_header_b64 TEXT;
  v_payload_b64 TEXT;
  v_signature_input TEXT;
  v_signature TEXT;
BEGIN
  v_key := auth.get_signing_key();
  v_now := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_exp := v_now + p_expires_in;

  -- Create header
  v_header := '{"alg":"HS256","typ":"JWT"}';
  v_header_b64 := auth.base64url_encode(v_header::bytea);

  -- Create payload
  v_payload := json_build_object(
    'sub', p_user_id,
    'aud', 'authenticated',
    'role', p_role,
    'email', p_email,
    'session_id', p_session_id,
    'iat', v_now,
    'exp', v_exp,
    'user_metadata', p_user_metadata,
    'app_metadata', p_app_metadata
  )::text;
  v_payload_b64 := auth.base64url_encode(v_payload::bytea);

  -- Create signature
  v_signature_input := v_header_b64 || '.' || v_payload_b64;
  v_signature := auth.base64url_encode(
    hmac(v_signature_input::bytea, decode(v_key, 'hex'), 'sha256')
  );

  RETURN v_signature_input || '.' || v_signature;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify an access token and return payload
CREATE OR REPLACE FUNCTION auth.verify_access_token(p_token TEXT) RETURNS TABLE(
  valid BOOLEAN,
  user_id UUID,
  session_id UUID,
  email TEXT,
  role TEXT,
  exp BIGINT,
  user_metadata JSONB,
  app_metadata JSONB,
  error TEXT
) AS $$
DECLARE
  v_parts TEXT[];
  v_header_b64 TEXT;
  v_payload_b64 TEXT;
  v_signature_b64 TEXT;
  v_key TEXT;
  v_signature_input TEXT;
  v_expected_sig TEXT;
  v_payload JSONB;
  v_now BIGINT;
BEGIN
  -- Split token into parts
  v_parts := string_to_array(p_token, '.');

  IF array_length(v_parts, 1) != 3 THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Invalid token format'::TEXT;
    RETURN;
  END IF;

  v_header_b64 := v_parts[1];
  v_payload_b64 := v_parts[2];
  v_signature_b64 := v_parts[3];

  -- Verify signature
  v_key := auth.get_signing_key();
  v_signature_input := v_header_b64 || '.' || v_payload_b64;
  v_expected_sig := auth.base64url_encode(
    hmac(v_signature_input::bytea, decode(v_key, 'hex'), 'sha256')
  );

  IF v_signature_b64 != v_expected_sig THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Invalid signature'::TEXT;
    RETURN;
  END IF;

  -- Decode payload
  BEGIN
    v_payload := convert_from(auth.base64url_decode(v_payload_b64), 'UTF8')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Invalid payload'::TEXT;
    RETURN;
  END;

  -- Check expiration
  v_now := EXTRACT(EPOCH FROM NOW())::BIGINT;
  IF (v_payload->>'exp')::BIGINT < v_now THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Token expired'::TEXT;
    RETURN;
  END IF;

  -- Return valid token data
  RETURN QUERY SELECT
    true,
    (v_payload->>'sub')::UUID,
    (v_payload->>'session_id')::UUID,
    v_payload->>'email',
    v_payload->>'role',
    (v_payload->>'exp')::BIGINT,
    COALESCE(v_payload->'user_metadata', '{}'::jsonb),
    COALESCE(v_payload->'app_metadata', '{}'::jsonb),
    NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on auth schema functions to roles
-- This allows RLS policies and DEFAULT values to use these functions
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.email() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

-- Grant execute on auth management functions
-- These have SECURITY DEFINER so they run with elevated privileges
GRANT EXECUTE ON FUNCTION auth.create_user(TEXT, TEXT, JSONB, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.verify_user_credentials(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.create_session(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.create_refresh_token(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.refresh_token(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.sign_out(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.sign_out_all(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.get_signing_key() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.create_access_token(UUID, UUID, TEXT, TEXT, JSONB, JSONB, INT) TO service_role;
GRANT EXECUTE ON FUNCTION auth.verify_access_token(TEXT) TO service_role;
`;

const ALLOWED_ROLES = new Set([
  "anon",
  "authenticated",
  "service_role",
  "supabase_admin",
  "postgres",
]);

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function getSetAuthContextSQL(
  userId: string,
  role: string,
  email: string,
): string {
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(`Invalid role: ${role}`);
  }

  const claims = JSON.stringify({
    sub: userId,
    role: role,
    email: email,
    aud: "authenticated",
  });

  const escapedUserId = escapeSqlString(userId);
  const escapedEmail = escapeSqlString(email);
  const escapedClaims = escapeSqlString(claims);

  return `
    SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${escapedUserId}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);
    SELECT set_config('request.jwt.claim.email', '${escapedEmail}', false);
    SELECT set_config('request.jwt.claims', '${escapedClaims}', false);
  `;
}

export const CLEAR_AUTH_CONTEXT_SQL = `
  SET ROLE anon;
  SELECT set_config('request.jwt.claim.sub', '', false);
  SELECT set_config('request.jwt.claim.role', 'anon', false);
  SELECT set_config('request.jwt.claim.email', '', false);
  SELECT set_config('request.jwt.claims', '{"role": "anon"}', false);
`;
