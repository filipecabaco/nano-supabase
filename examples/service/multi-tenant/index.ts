import { ServiceClient } from "../../../src/service-client.ts";

const SERVICE_URL = process.env.SERVICE_URL || "http://localhost:8080";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "my-admin-token";

async function main() {
	console.log("=== Service Mode (Multi-Tenant) Demo ===\n");
	console.log(`Service URL: ${SERVICE_URL}`);
	console.log(`Admin token: ${ADMIN_TOKEN}\n`);

	console.log("NOTE: Start the service first:");
	console.log(
		`  npx nano-supabase service --admin-token=${ADMIN_TOKEN} --secret=my-secret --data-dir=./service-data\n`,
	);

	const client = new ServiceClient({
		url: SERVICE_URL,
		adminToken: ADMIN_TOKEN,
	});

	console.log("--- 1: Create tenants ---");
	const acme = await client.createTenant("acme", {
		anonKey: "acme-anon-key",
		serviceRoleKey: "acme-service-key",
	});
	console.log(`  Created 'acme' — token: ${acme.token.slice(0, 8)}...`);

	const globex = await client.createTenant("globex", {
		anonKey: "globex-anon-key",
		serviceRoleKey: "globex-service-key",
	});
	console.log(`  Created 'globex' — token: ${globex.token.slice(0, 8)}...`);
	console.log();

	console.log("--- 2: List tenants ---");
	const tenants = await client.listTenants();
	console.log(
		`  ${tenants.length} tenants:`,
		tenants.map((t) => `${t.slug} (${t.state})`),
	);
	console.log();

	console.log("--- 3: Execute SQL on a tenant ---");
	await client.sql(
		"acme",
		`CREATE TABLE IF NOT EXISTS products (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			price NUMERIC(10,2)
		)`,
	);
	await client.sql(
		"acme",
		"INSERT INTO products (name, price) VALUES ($1, $2)",
		["Widget", 9.99],
	);
	await client.sql(
		"acme",
		"INSERT INTO products (name, price) VALUES ($1, $2)",
		["Gadget", 24.99],
	);

	const { rows } = await client.sql("acme", "SELECT * FROM products");
	console.log("  Acme products:", rows);
	console.log();

	console.log("--- 4: Tenants are isolated ---");
	try {
		const result = await client.sql("globex", "SELECT * FROM products");
		console.log("  Globex products:", result.rows);
	} catch (err) {
		console.log(`  Globex has no 'products' table (isolated): ${err instanceof Error ? err.message : err}`);
	}
	console.log();

	console.log("--- 5: Pause and wake a tenant ---");
	await client.pauseTenant("acme");
	const paused = await client.getTenant("acme");
	console.log(`  Acme state after pause: ${paused.state}`);

	await client.wakeTenant("acme");
	const woken = await client.getTenant("acme");
	console.log(`  Acme state after wake: ${woken.state}`);

	const { rows: afterWake } = await client.sql(
		"acme",
		"SELECT COUNT(*) AS n FROM products",
	);
	console.log(`  Products survived pause/wake: ${afterWake[0]?.n}`);
	console.log();

	console.log("--- 6: Rotate tenant token ---");
	const { token: newToken } = await client.resetToken("acme");
	console.log(`  New token: ${newToken.slice(0, 8)}...`);
	console.log();

	console.log("--- 7: Cleanup ---");
	await client.deleteTenant("acme");
	await client.deleteTenant("globex");
	const remaining = await client.listTenants();
	console.log(`  Tenants remaining: ${remaining.length}`);
	console.log();

	console.log("All service mode examples completed successfully!");
}

main().catch(console.error);
