function L(n){return btoa(String.fromCharCode(...n)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"")}function U(n){let e=n.replace(/-/g,"+").replace(/_/g,"/").padEnd(n.length+(4-n.length%4)%4,"="),t=atob(e),a=new Uint8Array(t.length);for(let r=0;r<t.length;r++)a[r]=t.charCodeAt(r);return a}var m=new TextEncoder,y=new TextDecoder;async function C(n,e){let t={alg:"HS256",typ:"JWT"},a=L(m.encode(JSON.stringify(t))),r=L(m.encode(JSON.stringify(n))),s=`${a}.${r}`,i=await crypto.subtle.importKey("raw",m.encode(e),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),o=await crypto.subtle.sign("HMAC",i,m.encode(s)),u=L(new Uint8Array(o));return`${s}.${u}`}async function b(n,e){try{let t=n.split(".");if(t.length!==3)return{valid:!1,error:"Invalid token format"};let[a,r,s]=t;if(!a||!r||!s)return{valid:!1,error:"Invalid token format"};let i=`${a}.${r}`,o=await crypto.subtle.importKey("raw",m.encode(e),{name:"HMAC",hash:"SHA-256"},!1,["verify"]),u=U(s);if(!await crypto.subtle.verify("HMAC",o,u,m.encode(i)))return{valid:!1,error:"Invalid signature"};let T=y.decode(U(r)),d=JSON.parse(T),c=Math.floor(Date.now()/1e3);return d.exp&&d.exp<c?{valid:!1,error:"Token expired"}:{valid:!0,payload:d}}catch(t){return{valid:!1,error:t instanceof Error?t.message:"Verification failed"}}}function O(n){try{let e=n.split(".");if(e.length!==3)return null;let t=e[1];if(!t)return null;let a=y.decode(U(t));return JSON.parse(a)}catch{return null}}var w=3600,I=new WeakMap;async function k(n){let e=I.get(n);if(e)return e;let t=await n.query("SELECT value FROM auth.config WHERE key = 'jwt_secret'");if(t.rows.length>0&&t.rows[0])return I.set(n,t.rows[0].value),t.rows[0].value;let a=new Uint8Array(32);crypto.getRandomValues(a);let r=Array.from(a,s=>s.toString(16).padStart(2,"0")).join("");return await n.query("INSERT INTO auth.config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",["jwt_secret",r]),I.set(n,r),r}async function p(n,e,t,a=w){let r=await k(n),s=Math.floor(Date.now()/1e3),i={sub:e.id,aud:"authenticated",role:e.role,email:e.email||void 0,session_id:t,iat:s,exp:s+a,user_metadata:e.user_metadata||{},app_metadata:e.app_metadata||{}};return C(i,r)}async function A(n,e){let t=await k(n);return b(e,t)}async function q(n,e,t,a,r=w){let s=await p(n,e,t,r),i=Math.floor(Date.now()/1e3);return{accessToken:s,refreshToken:a,expiresIn:r,expiresAt:i+r}}function W(n){return O(n)?.sub||null}function v(n){return O(n)?.session_id||null}var D=`
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

-- Users table \u2014 columns match supabase/postgres init-scripts + incremental migrations
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
`;function R(n){return n.replace(/'/g,"''")}function j(n,e,t){let a=JSON.stringify({sub:n,role:e,email:t,aud:"authenticated"}),r=R(n),s=R(e),i=R(t),o=R(a);return`
    SET ROLE ${s};
    SELECT set_config('request.jwt.claim.sub', '${r}', false);
    SELECT set_config('request.jwt.claim.role', '${s}', false);
    SELECT set_config('request.jwt.claim.email', '${i}', false);
    SELECT set_config('request.jwt.claims', '${o}', false);
  `}var z=`
  SET ROLE anon;
  SELECT set_config('request.jwt.claim.sub', '', false);
  SELECT set_config('request.jwt.claim.role', 'anon', false);
  SELECT set_config('request.jwt.claim.email', '', false);
  SELECT set_config('request.jwt.claims', '{"role": "anon"}', false);
`;var N=3600;function _(n){return{id:n.id,aud:n.aud,role:n.role,email:n.email,email_confirmed_at:n.email_confirmed_at||void 0,phone:n.phone||void 0,phone_confirmed_at:n.phone_confirmed_at||void 0,confirmed_at:n.email_confirmed_at||n.phone_confirmed_at||void 0,last_sign_in_at:n.last_sign_in_at||void 0,app_metadata:n.raw_app_meta_data||{},user_metadata:n.raw_user_meta_data||{},created_at:n.created_at,updated_at:n.updated_at}}function l(n,e,t){return{message:n,status:e,code:t}}var F=class{db;initPromise=null;subscriptions=new Map;currentSession=null;constructor(e){this.db=e}async initialize(){this.initPromise??=this.db.exec(D),await this.initPromise}emitAuthStateChange(e,t){this.currentSession=t;for(let a of this.subscriptions.values())try{a(e,t)}catch(r){console.error("Auth state change callback error:",r)}}onAuthStateChange(e){let t=crypto.randomUUID();return this.subscriptions.set(t,e),queueMicrotask(()=>{e("INITIAL_SESSION",this.currentSession)}),{id:t,callback:e,unsubscribe:()=>{this.subscriptions.delete(t)}}}async signUp(e,t,a){await this.initialize(),await this.db.exec("RESET ROLE");try{if((await this.db.query("SELECT * FROM auth.users WHERE email = $1",[e])).rows.length>0)return{data:{user:null,session:null},error:l("User already registered",400,"user_already_exists")};let s=a?.data?JSON.stringify(a.data):"{}",i=await this.db.query("SELECT * FROM auth.create_user($1, $2, $3::jsonb)",[e,t,s]);if(i.rows.length===0)return{data:{user:null,session:null},error:l("Failed to create user",500,"user_creation_failed")};let o=i.rows[0];if(!o)return{data:{user:null,session:null},error:l("Failed to create user",500,"user_creation_failed")};let u=_(o),E=await this.createSession(o);return this.emitAuthStateChange("SIGNED_IN",E),{data:{user:u,session:E},error:null}}catch(r){let s=r instanceof Error?r.message:"Sign up failed";return{data:{user:null,session:null},error:l(s,500,"sign_up_failed")}}}async signInWithPassword(e,t){await this.initialize(),await this.db.exec("RESET ROLE");try{let r=(await this.db.query("SELECT * FROM auth.verify_user_credentials($1, $2)",[e,t])).rows[0];if(!r||!r.id)return{data:{user:null,session:null},error:l("Invalid login credentials",400,"invalid_credentials")};let s=_(r),i=await this.createSession(r);return this.emitAuthStateChange("SIGNED_IN",i),{data:{user:s,session:i},error:null}}catch(a){let r=a instanceof Error?a.message:"Sign in failed";return{data:{user:null,session:null},error:l(r,500,"sign_in_failed")}}}async createSession(e){let a=(await this.db.query("SELECT * FROM auth.create_session($1)",[e.id])).rows[0];if(!a)throw new Error("Failed to create session");let s=(await this.db.query("SELECT * FROM auth.create_refresh_token($1, $2)",[e.id,a.id])).rows[0];if(!s)throw new Error("Failed to create refresh token");let i=_(e);return{access_token:await p(this.db,i,a.id,N),token_type:"bearer",expires_in:N,expires_at:Math.floor(Date.now()/1e3)+N,refresh_token:s.token,user:i}}async refreshSession(e){await this.initialize();try{let a=(await this.db.query("SELECT * FROM auth.refresh_token($1)",[e])).rows[0];if(!a||!a.new_token)return{data:{user:null,session:null},error:l("Invalid refresh token",401,"invalid_refresh_token")};let{new_token:r,user_id:s,session_id:i}=a,u=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[s])).rows[0];if(!u)return{data:{user:null,session:null},error:l("User not found",404,"user_not_found")};let E=_(u),d={access_token:await p(this.db,E,i,N),token_type:"bearer",expires_in:N,expires_at:Math.floor(Date.now()/1e3)+N,refresh_token:r,user:E};return this.emitAuthStateChange("TOKEN_REFRESHED",d),{data:{user:E,session:d},error:null}}catch(t){let a=t instanceof Error?t.message:"Token refresh failed";return{data:{user:null,session:null},error:l(a,500,"refresh_failed")}}}async signOut(e){await this.initialize();try{if(e){let t=v(e);t&&await this.db.query("SELECT auth.sign_out($1::uuid)",[t])}return await this.db.exec("RESET ROLE"),this.emitAuthStateChange("SIGNED_OUT",null),{error:null}}catch(t){let a=t instanceof Error?t.message:"Sign out failed";return{error:l(a,500,"sign_out_failed")}}}async getUser(e){await this.initialize();try{let t=await A(this.db,e);if(!t.valid||!t.payload)return{data:{user:null},error:l(t.error||"Invalid token",401,"invalid_token")};let r=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[t.payload.sub])).rows[0];return r?{data:{user:_(r)},error:null}:{data:{user:null},error:l("User not found",404,"user_not_found")}}catch(t){let a=t instanceof Error?t.message:"Get user failed";return{data:{user:null},error:l(a,500,"get_user_failed")}}}async updateUser(e,t){await this.initialize();try{let a=await A(this.db,e);if(!a.valid||!a.payload)return{data:{user:null,session:null},error:l(a.error||"Invalid token",401,"invalid_token")};let r=a.payload.sub,s=[],i=[],o=1;if(t.email&&(s.push(`email = $${o}`),i.push(t.email),o++),t.password&&(s.push(`encrypted_password = auth.hash_password($${o})`),i.push(t.password),o++),t.data&&(s.push(`raw_user_meta_data = raw_user_meta_data || $${o}::jsonb`),i.push(JSON.stringify(t.data)),o++),s.length===0){let h=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[r])).rows[0];return h?{data:{user:_(h),session:this.currentSession},error:null}:{data:{user:null,session:null},error:l("User not found",404,"user_not_found")}}s.push("updated_at = NOW()"),i.push(r);let E=(await this.db.query(`UPDATE auth.users SET ${s.join(", ")} WHERE id = $${o} RETURNING *`,i)).rows[0];if(!E)return{data:{user:null,session:null},error:l("User not found",404,"user_not_found")};let T=_(E),d=this.currentSession;if(d){let c=await p(this.db,T,a.payload.session_id,N);d={...d,access_token:c,user:T}}return this.emitAuthStateChange("USER_UPDATED",d),{data:{user:T,session:d},error:null}}catch(a){let r=a instanceof Error?a.message:"Update user failed";return{data:{user:null,session:null},error:l(r,500,"update_user_failed")}}}async adminListUsers(e=1,t=50){await this.initialize();let a=(e-1)*t,[r,s]=await Promise.all([this.db.query("SELECT * FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2",[t,a]),this.db.query("SELECT count(*)::int AS total FROM auth.users")]);return{users:r.rows.map(_),total:s.rows[0]?.total??0}}async adminGetUser(e){await this.initialize();let a=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[e])).rows[0];return a?_(a):null}async adminCreateUser(e){await this.initialize();let t=JSON.stringify(e.user_metadata??{}),a=JSON.stringify(e.app_metadata??{}),r=e.email_confirm!==!1?"NOW()":"NULL",i=(await this.db.query(`INSERT INTO auth.users (email, phone, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, confirmed_at, aud, role)
       VALUES ($1, $2, COALESCE(auth.hash_password($3), ''), $4::jsonb, $5::jsonb, ${r}, ${r}, 'authenticated', 'authenticated')
       RETURNING *`,[e.email??null,e.phone??null,e.password??null,t,a])).rows[0];if(!i)throw new Error("Failed to create user");return _(i)}async adminUpdateUser(e,t){await this.initialize();let a=[],r=[],s=1;if(t.email!==void 0&&(a.push(`email = $${s++}`),r.push(t.email)),t.phone!==void 0&&(a.push(`phone = $${s++}`),r.push(t.phone)),t.password&&(a.push(`encrypted_password = auth.hash_password($${s++})`),r.push(t.password)),t.user_metadata&&(a.push(`raw_user_meta_data = raw_user_meta_data || $${s++}::jsonb`),r.push(JSON.stringify(t.user_metadata))),t.app_metadata&&(a.push(`raw_app_meta_data = raw_app_meta_data || $${s++}::jsonb`),r.push(JSON.stringify(t.app_metadata))),t.ban_duration==="none"?a.push("banned_until = NULL"):t.ban_duration&&(a.push(`banned_until = NOW() + $${s++}::interval`),r.push(t.ban_duration)),t.email_confirm&&a.push("email_confirmed_at = COALESCE(email_confirmed_at, NOW())"),a.length===0)return this.adminGetUser(e);a.push("updated_at = NOW()"),r.push(e);let o=(await this.db.query(`UPDATE auth.users SET ${a.join(", ")} WHERE id = $${s} RETURNING *`,r)).rows[0];return o?_(o):null}async adminDeleteUser(e){await this.initialize(),await this.db.query("DELETE FROM auth.users WHERE id = $1",[e])}getSession(){return this.currentSession}setSession(e){this.currentSession=e,e&&this.emitAuthStateChange("SIGNED_IN",e)}async verifyToken(e){return A(this.db,e)}};var g=class{store=new Map;async put(e,t,a){this.store.set(e,{data:t,metadata:a})}async get(e){return this.store.get(e)??null}async delete(e){return this.store.delete(e)}async deleteByPrefix(e){let t=0;for(let a of this.store.keys())a.startsWith(e)&&(this.store.delete(a),t++);return t}async exists(e){return this.store.has(e)}async copy(e,t){let a=this.store.get(e);return a?(this.store.set(t,{data:new Uint8Array(a.data),metadata:{...a.metadata}}),!0):!1}};var $=`
CREATE SCHEMA IF NOT EXISTS storage;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Migration tracker (mirrors storage.migrations table from 0002)
CREATE TABLE IF NOT EXISTS storage.migrations (
  id integer PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT current_timestamp
);
ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

-- Buckets (0002 + 0008 public + 0012 avif + 0013/0014 limits + 0018 owner_id)
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE UNIQUE INDEX IF NOT EXISTS bname ON storage.buckets USING btree (name);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

-- Objects (0002 base + 0003 path_tokens + 0016 version + 0018 owner_id + 0025 user_metadata)
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  version text,
  user_metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  CONSTRAINT objects_bucketId_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id),
  PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bucketid_objname ON storage.objects USING btree (bucket_id, name);
CREATE INDEX IF NOT EXISTS name_prefix_search ON storage.objects(name text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_objects_bucket_id_name ON storage.objects (bucket_id, name);
CREATE INDEX IF NOT EXISTS idx_objects_bucket_id_name_lower ON storage.objects (bucket_id, lower(name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- S3 multipart uploads (migration 0021 + 0022 bigint + 0025 user_metadata)
CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads (
  id text PRIMARY KEY,
  in_progress_size bigint NOT NULL DEFAULT 0,
  upload_signature text NOT NULL,
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  key text NOT NULL,
  version text NOT NULL,
  owner_id text,
  user_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_multipart_uploads_list ON storage.s3_multipart_uploads (bucket_id, key, created_at ASC);
ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id text NOT NULL REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE,
  size bigint NOT NULL DEFAULT 0,
  part_number int NOT NULL,
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  key text NOT NULL,
  etag text NOT NULL,
  owner_id text,
  version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

-- auto-update updated_at (migration 0011)
CREATE OR REPLACE FUNCTION storage.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS update_objects_updated_at ON storage.objects;
CREATE TRIGGER update_objects_updated_at
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW EXECUTE PROCEDURE storage.update_updated_at_column();

-- Path utilities (migration 0002, extension optimised in 0036)
CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;

CREATE OR REPLACE FUNCTION storage.filename(name text)
  RETURNS text LANGUAGE plpgsql AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts, 1)];
END $$;

CREATE OR REPLACE FUNCTION storage.extension(name text)
  RETURNS text LANGUAGE plpgsql AS $$
DECLARE _parts text[]; _filename text;
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  SELECT _parts[array_length(_parts, 1)] INTO _filename;
  RETURN reverse(split_part(reverse(_filename), '.', 1));
END $$;

-- search with sort support (migration 00010)
CREATE OR REPLACE FUNCTION storage.search(
  prefix text,
  bucketname text,
  limits int DEFAULT 100,
  levels int DEFAULT 1,
  offsets int DEFAULT 0,
  search text DEFAULT '',
  sortcolumn text DEFAULT 'name',
  sortorder text DEFAULT 'asc'
) RETURNS TABLE (
  name text, id uuid, updated_at timestamptz, created_at timestamptz,
  last_accessed_at timestamptz, metadata jsonb
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_order_by text;
  v_sort_order text;
BEGIN
  CASE
    WHEN sortcolumn = 'name'           THEN v_order_by = 'name';
    WHEN sortcolumn = 'updated_at'     THEN v_order_by = 'updated_at';
    WHEN sortcolumn = 'created_at'     THEN v_order_by = 'created_at';
    WHEN sortcolumn = 'last_accessed_at' THEN v_order_by = 'last_accessed_at';
    ELSE v_order_by = 'name';
  END CASE;
  v_sort_order := CASE WHEN sortorder = 'desc' THEN 'desc' ELSE 'asc' END;
  v_order_by := v_order_by || ' ' || v_sort_order;

  RETURN QUERY EXECUTE
    'with folders as (
       select path_tokens[$1] as folder
       from storage.objects
       where objects.name ilike $2 || $3 || ''%''
         and bucket_id = $4
         and array_length(regexp_split_to_array(objects.name, ''/''), 1) <> $1
       group by folder
       order by folder ' || v_sort_order || '
     )
     (select folder as "name", null::uuid as id, null::timestamptz as updated_at,
             null::timestamptz as created_at, null::timestamptz as last_accessed_at,
             null::jsonb as metadata from folders)
     union all
     (select path_tokens[$1] as "name", id, updated_at, created_at, last_accessed_at, metadata
      from storage.objects
      where objects.name ilike $2 || $3 || ''%''
        and bucket_id = $4
        and array_length(regexp_split_to_array(objects.name, ''/''), 1) = $1
      order by ' || v_order_by || ')
     limit $5 offset $6'
    USING levels, prefix, search, bucketname, limits, offsets;
END $$;

-- get_size_by_bucket (migration 0006)
CREATE OR REPLACE FUNCTION storage.get_size_by_bucket()
  RETURNS TABLE (size bigint, bucket_id text) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    SELECT sum((metadata->>'size')::bigint) AS size, obj.bucket_id
    FROM storage.objects AS obj
    GROUP BY obj.bucket_id;
END $$;

-- can_insert_object: RLS-check helper via rollback trick (migration 0015)
CREATE OR REPLACE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb)
  RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES (bucketid, name, owner, metadata);
  RAISE sqlstate 'PT200' USING message = 'ROLLBACK', detail = 'rollback successful insert';
END $$;

-- list_objects_with_delimiter: S3-compatible listing (migration 0020)
CREATE OR REPLACE FUNCTION storage.list_objects_with_delimiter(
  bucket_id text, prefix_param text, delimiter_param text,
  max_keys integer DEFAULT 100, start_after text DEFAULT '', next_token text DEFAULT ''
) RETURNS TABLE (name text, id uuid, metadata jsonb, updated_at timestamptz)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE
    'SELECT DISTINCT ON(name) * from (
       SELECT
         CASE
           WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
             substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1)))
           ELSE name
         END AS name, id, metadata, updated_at
       FROM storage.objects
       WHERE bucket_id = $5
         AND name ILIKE $1 || ''%''
         AND CASE WHEN $6 != '''' THEN name > $6 ELSE true END
         AND CASE WHEN $4 != '''' THEN
           CASE WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
             substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1))) > $4
           ELSE name > $4 END
         ELSE true END
       ORDER BY name ASC) AS e
     ORDER BY name LIMIT $3'
    USING prefix_param, delimiter_param, max_keys, next_token, bucket_id, start_after;
END $$;

-- list_multipart_uploads_with_delimiter (migration 0021)
CREATE OR REPLACE FUNCTION storage.list_multipart_uploads_with_delimiter(
  bucket_id text, prefix_param text, delimiter_param text,
  max_keys integer DEFAULT 100, next_key_token text DEFAULT '', next_upload_token text DEFAULT ''
) RETURNS TABLE (key text, id text, created_at timestamptz)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE
    'SELECT DISTINCT ON(key) * from (
       SELECT
         CASE
           WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
             substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
           ELSE key
         END AS key, id, created_at
       FROM storage.s3_multipart_uploads
       WHERE bucket_id = $5
         AND key ILIKE $1 || ''%''
         AND CASE WHEN $4 != '''' AND $6 = '''' THEN
           CASE WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
             substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) > $4
           ELSE key > $4 END
         ELSE true END
         AND CASE WHEN $6 != '''' THEN id > $6 ELSE true END
       ORDER BY key ASC, created_at ASC) AS e
     ORDER BY key LIMIT $3'
    USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END $$;

-- operation() GUC helper (migration 0024)
CREATE OR REPLACE FUNCTION storage.operation()
  RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN current_setting('storage.operation', true);
END $$;

-- enforce bucket name length (migration 0037)
CREATE OR REPLACE FUNCTION storage.enforce_bucket_name_length()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF length(NEW.name) > 100 THEN
    RAISE EXCEPTION 'bucket name "%" is too long (% characters). Max is 100.', NEW.name, length(NEW.name);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_bucket_name_length_trigger ON storage.buckets;
CREATE TRIGGER enforce_bucket_name_length_trigger
  BEFORE INSERT OR UPDATE OF name ON storage.buckets
  FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

-- Grants
GRANT ALL ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT ALL ON storage.migrations TO anon, authenticated, service_role;
REVOKE ALL ON storage.s3_multipart_uploads FROM anon, authenticated;
REVOKE ALL ON storage.s3_multipart_uploads_parts FROM anon, authenticated;
GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated, anon;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated, anon;

GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.filename(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.extension(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.search(text,text,int,int,int,text,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.get_size_by_bucket() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.list_objects_with_delimiter(text,text,text,int,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.operation() TO anon, authenticated, service_role;

GRANT ALL ON SCHEMA storage TO dashboard_user;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO dashboard_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO dashboard_user;
GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO dashboard_user;
`;function P(n){return n.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}function M(n){let e=n.replace(/-/g,"+").replace(/_/g,"/");for(;e.length%4;)e+="=";return e}var x=class{db;backend;initPromise=null;constructor(e,t){this.db=e,this.backend=t??new g}async initialize(){this.initPromise??=this.db.exec($),await this.initPromise}getBackend(){return this.backend}async listBuckets(){return await this.initialize(),(await this.db.query("SELECT * FROM storage.buckets ORDER BY name")).rows}async getBucket(e){return await this.initialize(),(await this.db.query("SELECT * FROM storage.buckets WHERE id = $1",[e])).rows[0]??null}async createBucket(e){await this.initialize();let t=e.id??e.name,r=(await this.db.query(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,[t,e.name,e.public??!1,e.file_size_limit??null,e.allowed_mime_types??null])).rows[0];if(!r)throw new Error("Failed to create bucket");return r}async updateBucket(e,t){await this.initialize();let a=[],r=[],s=1;if(t.public!==void 0&&(a.push(`public = $${s++}`),r.push(t.public)),t.file_size_limit!==void 0&&(a.push(`file_size_limit = $${s++}`),r.push(t.file_size_limit)),t.allowed_mime_types!==void 0&&(a.push(`allowed_mime_types = $${s++}`),r.push(t.allowed_mime_types)),a.length===0){let u=await this.getBucket(e);if(!u)throw new Error("Bucket not found");return u}a.push("updated_at = now()"),r.push(e);let o=(await this.db.query(`UPDATE storage.buckets SET ${a.join(", ")} WHERE id = $${s} RETURNING *`,r)).rows[0];if(!o)throw new Error("Bucket not found");return o}async emptyBucket(e){await this.initialize(),await this.db.query("DELETE FROM storage.objects WHERE bucket_id = $1",[e]),await this.backend.deleteByPrefix(`${e}/`)}async deleteBucket(e){await this.initialize();let t=await this.db.query("SELECT count(*)::text as count FROM storage.objects WHERE bucket_id = $1",[e]);if(t.rows[0]&&parseInt(t.rows[0].count,10)>0)throw new Error("Bucket not empty");await this.db.query("DELETE FROM storage.buckets WHERE id = $1",[e])}async uploadObject(e,t,a,r,s){await this.initialize();let i=await this.getBucket(e);if(!i)throw new Error("Bucket not found");if(i.file_size_limit&&a.byteLength>i.file_size_limit)throw new Error(`File size ${a.byteLength} exceeds bucket limit of ${i.file_size_limit}`);if(i.allowed_mime_types&&i.allowed_mime_types.length>0&&!i.allowed_mime_types.some(h=>h.endsWith("/*")?r.startsWith(h.slice(0,-1)):r===h))throw new Error(`MIME type ${r} is not allowed in this bucket`);let o={eTag:`"${await this.computeETag(a)}"`,size:a.byteLength,mimetype:r,cacheControl:s?.cacheControl??"max-age=3600",lastModified:new Date().toISOString(),contentLength:a.byteLength,httpStatusCode:200},u=s?.upsert??!1,E;u?E=await this.db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
         VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
         ON CONFLICT (bucket_id, name)
         DO UPDATE SET
           metadata = $4,
           user_metadata = $5,
           updated_at = now(),
           last_accessed_at = now(),
           version = gen_random_uuid()::text,
           owner_id = EXCLUDED.owner_id
         RETURNING *`,[e,t,s?.ownerId??null,JSON.stringify(o),s?.userMetadata?JSON.stringify(s.userMetadata):null]):E=await this.db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
         VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
         RETURNING *`,[e,t,s?.ownerId??null,JSON.stringify(o),s?.userMetadata?JSON.stringify(s.userMetadata):null]);let T=E.rows[0];if(!T)throw new Error("Failed to create object");let d=`${e}/${t}`;return await this.backend.put(d,a,{contentType:r,size:a.byteLength,cacheControl:s?.cacheControl}),T}async downloadObject(e,t){await this.initialize();let r=(await this.db.query(`UPDATE storage.objects
       SET last_accessed_at = now()
       WHERE bucket_id = $1 AND name = $2
       RETURNING *`,[e,t])).rows[0];if(!r)return null;let s=`${e}/${t}`,i=await this.backend.get(s);return i?{data:i.data,metadata:i.metadata,object:r}:null}async getObjectInfo(e,t){return await this.initialize(),(await this.db.query("SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2",[e,t])).rows[0]??null}async objectExists(e,t){return await this.initialize(),(await this.db.query("SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2) as exists",[e,t])).rows[0]?.exists??!1}async removeObjects(e,t){if(await this.initialize(),t.length===0)return[];let a=t.map((s,i)=>`$${i+2}`).join(", "),r=await this.db.query(`DELETE FROM storage.objects
       WHERE bucket_id = $1 AND name IN (${a})
       RETURNING *`,[e,...t]);for(let s of r.rows)await this.backend.delete(`${e}/${s.name}`);return r.rows}async listObjects(e,t){await this.initialize();let a=t?.prefix??"",r=t?.limit??100,s=t?.offset??0,i=t?.sortBy?.column??"name",o=t?.sortBy?.order?.toLowerCase()==="desc"?"DESC":"ASC",E=["name","created_at","updated_at","last_accessed_at"].includes(i)?i:"name",T=t?.search??"",d=a.split("/").filter(Boolean).length+1;return(await this.db.query("SELECT * FROM storage.search($1, $2, $3, $8, $4, $5, $6, $7)",[a,e,r,s,T,E,o.toLowerCase(),d])).rows}async moveObject(e,t,a,r){await this.initialize();let s=r??e;if((await this.db.query(`UPDATE storage.objects
       SET bucket_id = $3, name = $4, updated_at = now()
       WHERE bucket_id = $1 AND name = $2
       RETURNING *`,[e,t,s,a])).rows.length===0)throw new Error("Object not found");let o=`${e}/${t}`,u=`${s}/${a}`;await this.backend.copy(o,u)&&await this.backend.delete(o)}async copyObject(e,t,a,r){await this.initialize();let s=r??e,o=(await this.db.query("SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2",[e,t])).rows[0];if(!o)throw new Error("Object not found");if(!(await this.db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
       VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
       ON CONFLICT (bucket_id, name)
       DO UPDATE SET
         metadata = EXCLUDED.metadata,
         user_metadata = EXCLUDED.user_metadata,
         updated_at = now(),
         version = gen_random_uuid()::text
       RETURNING *`,[s,a,o.owner_id,JSON.stringify(o.metadata),o.user_metadata?JSON.stringify(o.user_metadata):null])).rows[0])throw new Error("Failed to copy object");let T=`${e}/${t}`,d=`${s}/${a}`;return await this.backend.copy(T,d),`${s}/${a}`}async createSignedUrl(e,t,a){await this.initialize();let r={bucket_id:e,object_name:t,exp:Math.floor(Date.now()/1e3)+a},i=(await this.db.query("SELECT auth.get_signing_key()")).rows[0]?.get_signing_key;if(!i)throw new Error("Signing key not available");let o=new TextEncoder,u=await crypto.subtle.importKey("raw",o.encode(i),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),E=JSON.stringify(r),T=await crypto.subtle.sign("HMAC",u,o.encode(E)),d=P(btoa(E)),c=P(btoa(String.fromCharCode(...new Uint8Array(T))));return`${d}.${c}`}async verifySignedUrl(e){let t=e.split(".");if(t.length!==2)return null;let[a,r]=t;try{let s=atob(M(a??"")),i=JSON.parse(s);if(i.exp<Math.floor(Date.now()/1e3))return null;let o=await this.db.query("SELECT auth.get_signing_key()");if(!o.rows[0])return null;let u=new TextEncoder,E=await crypto.subtle.importKey("raw",u.encode(o.rows[0].get_signing_key),{name:"HMAC",hash:"SHA-256"},!1,["verify"]),T=Uint8Array.from(atob(M(r??"")),c=>c.charCodeAt(0));return await crypto.subtle.verify("HMAC",E,T,u.encode(s))?i:null}catch{return null}}async computeETag(e){try{let t=e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength),a=await crypto.subtle.digest("SHA-256",t),r=new Uint8Array(a);return Array.from(r.slice(0,8)).map(s=>s.toString(16).padStart(2,"0")).join("")}catch{return Math.random().toString(36).slice(2,18)}}};var f=(r=>(r[r.CRITICAL=0]="CRITICAL",r[r.HIGH=1]="HIGH",r[r.MEDIUM=2]="MEDIUM",r[r.LOW=3]="LOW",r))(f||{});var G={1:0,2:1,3:2},S=class{queues;heads;maxSize;agingThresholdMs;_size=0;lastAgingRun=0;constructor(e=1e3,t=5e3){this.maxSize=e,this.agingThresholdMs=t,this.queues=[[],[],[],[]],this.heads=[0,0,0,0]}enqueue(e){if(e.priority<0||e.priority>3)throw new Error(`Invalid priority: ${e.priority}`);if(this._size>=this.maxSize)throw new Error(`Queue is full (size: ${this._size}, max: ${this.maxSize})`);this.queues[e.priority].push(e),this._size++}dequeue(){let e=Date.now();e-this.lastAgingRun>1e3&&(this.applyAging(e),this.lastAgingRun=e);for(let t=0;t<4;t++){let a=this.queues[t],r=this.heads[t];if(r<a.length){let s=a[r]??null;return a[r]=null,this.heads[t]++,this._size--,this.heads[t]>a.length/2&&(this.queues[t]=a.slice(this.heads[t]),this.heads[t]=0),s}}return null}applyAging(e){for(let t of[1,2,3]){let a=this.queues[t],r=this.heads[t];if(r>=a.length)continue;let s=!1,i=this.queues[G[t]];for(let o=r;o<a.length;o++){let u=a[o];u!==void 0&&e-u.enqueuedAt>this.agingThresholdMs&&(u.priority=G[t],i.push(u),a[o]=null,s=!0)}if(s){let o=[];for(let u=r;u<a.length;u++){let E=a[u];E!=null&&o.push(E)}this.queues[t]=o,this.heads[t]=0}}}size(){return this._size}clear(){let e=[];for(let t=0;t<4;t++){let a=this.queues[t],r=this.heads[t];for(let s=r;s<a.length;s++){let i=a[s];i!==void 0&&e.push(i)}this.queues[t]=[],this.heads[t]=0}return this._size=0,e}sizeByPriority(){return{0:Math.max(0,this.queues[0].length-this.heads[0]),1:Math.max(0,this.queues[1].length-this.heads[1]),2:Math.max(0,this.queues[2].length-this.heads[2]),3:Math.max(0,this.queues[3].length-this.heads[3])}}};var X=class n{db;queue;running=!1;config;wakeUp=null;processQueueDone=Promise.resolve();resolveProcessQueueDone=null;totalEnqueued=0;totalDequeued=0;totalTimedOut=0;totalErrors=0;waitTimeSum=0;waitTimeCount=0;nextQueryId=0;get pglite(){return this.db}constructor(e,t={}){this.db=e;let a=t.maxQueueSize??1e3,r=t.agingThresholdMs??5e3;this.queue=new S(a,r),this.config={maxQueueSize:a,defaultTimeout:t.defaultTimeout??5e3,agingThresholdMs:r}}static async create(e,t){let a=new n(e,t);return await a.start(),a}async start(){if(this.running)throw new Error("Pooler already started");this.running=!0,this.processQueueDone=new Promise(e=>{this.resolveProcessQueueDone=e}),setTimeout(()=>{this.processQueue().catch(e=>{console.error("Queue processor error:",e),this.running=!1,this.resolveProcessQueueDone?.()})},0),await new Promise(e=>setTimeout(e,0))}async stop(){if(!this.running)return;this.running=!1,this.wakeUp?.();let e=this.queue.clear();for(let t of e)t.reject(new Error("Pooler stopped"));await this.processQueueDone}async query(e,t,a=2,r){if(!this.running)throw new Error("Pooler is not running");return new Promise((s,i)=>{let o={kind:"sql",id:String(this.nextQueryId++),sql:e,params:t??[],priority:a,enqueuedAt:Date.now(),resolve:s,reject:i,timeoutMs:r??this.config.defaultTimeout};try{this.queue.enqueue(o),this.totalEnqueued++,this.wakeUp?.()}catch(u){i(u instanceof Error?u:new Error(String(u)))}})}async transaction(e,t=2){if(!this.running)throw new Error("Pooler is not running");return new Promise((a,r)=>{let s={kind:"transaction",id:String(this.nextQueryId++),priority:t,enqueuedAt:Date.now(),resolve:a,reject:r,timeoutMs:this.config.defaultTimeout,transactionFn:e};try{this.queue.enqueue(s),this.totalEnqueued++,this.wakeUp?.()}catch(i){r(i instanceof Error?i:new Error(String(i)))}})}metrics(){let e=this.waitTimeCount>0?this.waitTimeSum/this.waitTimeCount:0;return{totalEnqueued:this.totalEnqueued,totalDequeued:this.totalDequeued,totalTimedOut:this.totalTimedOut,totalErrors:this.totalErrors,currentSize:this.queue.size(),avgWaitTimeMs:e,sizeByPriority:this.queue.sizeByPriority()}}async[Symbol.asyncDispose](){await this.stop()}async processQueue(){for(;this.running;){let e=this.queue.dequeue();if(!e){await new Promise(t=>{this.wakeUp=t,setTimeout(()=>t(),1)}),this.wakeUp=null;continue}this.totalDequeued++,this.waitTimeSum+=Date.now()-e.enqueuedAt,this.waitTimeCount++;try{if(e.kind==="transaction"){let t=await this.runTransaction(e.transactionFn);e.resolve(t)}else{let t=await this.executeWithTimeout(e);e.resolve(t)}}catch(t){this.totalErrors++;let a=t instanceof Error?t:new Error(String(t));a.message==="Query timeout"&&this.totalTimedOut++,e.reject(a)}}this.resolveProcessQueueDone?.()}async runTransaction(e){return this.db.transaction(async t=>e((r,s)=>t.query(r,s)))}async executeWithTimeout(e){let t=e.timeoutMs??this.config.defaultTimeout,a=null,r=new Promise((i,o)=>{a=setTimeout(()=>{o(new Error("Query timeout"))},t)}),s=this.db.query(e.sql,[...e.params??[]]).finally(()=>{a!==null&&clearTimeout(a)});return Promise.race([s,r])}};export{C as a,b,O as c,p as d,A as e,q as f,W as g,v as h,D as i,j,z as k,F as l,g as m,$ as n,x as o,f as p,S as q,X as r};
//# sourceMappingURL=chunk-KSRYJJJ6.js.map
