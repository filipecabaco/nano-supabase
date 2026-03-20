CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  data_dir TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sleeping',
  last_active TIMESTAMPTZ NOT NULL DEFAULT now()
);
