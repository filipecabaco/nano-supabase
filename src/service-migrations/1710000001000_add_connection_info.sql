ALTER TABLE tenants ADD COLUMN tcp_port INTEGER;
ALTER TABLE tenants ADD COLUMN anon_key TEXT NOT NULL DEFAULT 'local-anon-key';
ALTER TABLE tenants ADD COLUMN service_role_key TEXT NOT NULL DEFAULT 'local-service-role-key';
