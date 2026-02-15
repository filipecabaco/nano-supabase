/**
 * Storage schema SQL for PGlite
 *
 * Distilled from the official Supabase Storage tenant migrations
 * (https://github.com/supabase/storage/tree/master/migrations/tenant)
 * into a single idempotent schema that works with PGlite.
 *
 * Tables: storage.buckets, storage.objects
 * Functions: storage.foldername, storage.filename, storage.extension, storage.search
 * RLS: enabled on storage.objects (users write their own policies)
 */

export const STORAGE_SCHEMA_SQL = `
-- Create storage schema
CREATE SCHEMA IF NOT EXISTS storage;

-- Grant permissions to roles (created by auth schema)
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Buckets table
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

-- Objects table
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
  CONSTRAINT objects_bucketId_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bucketid_objname ON storage.objects USING btree (bucket_id, name);
CREATE INDEX IF NOT EXISTS name_prefix_search ON storage.objects(name text_pattern_ops);

-- Enable RLS on objects (users add their own policies)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Enable RLS on buckets
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

-- Utility functions

CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[]
  LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text)
  RETURNS text
  LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts, 1)];
END
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text)
  RETURNS text
  LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
  _filename text;
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  SELECT _parts[array_length(_parts, 1)] INTO _filename;
  RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;

CREATE OR REPLACE FUNCTION storage.search(
  prefix text,
  bucketname text,
  limits int DEFAULT 100,
  levels int DEFAULT 1,
  offsets int DEFAULT 0
)
  RETURNS TABLE (
    name text,
    id uuid,
    updated_at timestamptz,
    created_at timestamptz,
    last_accessed_at timestamptz,
    metadata jsonb
  )
  LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    WITH files_folders AS (
      SELECT ((string_to_array(objects.name, '/'))[levels]) AS folder
      FROM storage.objects
      WHERE objects.name ILIKE prefix || '%'
        AND bucket_id = bucketname
      GROUP BY folder
      LIMIT limits
      OFFSET offsets
    )
    SELECT
      files_folders.folder AS name,
      objects.id,
      objects.updated_at,
      objects.created_at,
      objects.last_accessed_at,
      objects.metadata
    FROM files_folders
    LEFT JOIN storage.objects
      ON prefix || files_folders.folder = objects.name
      AND objects.bucket_id = bucketname;
END
$$;

-- Grant table permissions explicitly
GRANT ALL ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;

-- Grant function permissions
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.filename(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.extension(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.search(text, text, int, int, int) TO anon, authenticated, service_role;
`;
