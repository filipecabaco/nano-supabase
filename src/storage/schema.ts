export const STORAGE_SCHEMA_SQL = `
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
`;
