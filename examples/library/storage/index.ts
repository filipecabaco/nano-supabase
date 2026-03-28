import { createClient } from "@supabase/supabase-js";
import { createFetchAdapter } from "../../../src/index.ts";
import { createPGlite } from "../../../src/pglite-factory.ts";

async function main() {
	console.log("=== Storage Demo ===\n");

	const db = await createPGlite();
	const { localFetch, storageHandler } = await createFetchAdapter({
		db,
		supabaseUrl: "http://localhost:54321",
	});

	const supabase = createClient("http://localhost:54321", "local-anon-key", {
		auth: { autoRefreshToken: false },
		global: { fetch: localFetch as typeof fetch },
	});

	console.log("--- 1: Create buckets ---");
	await storageHandler!.createBucket({
		name: "avatars",
		public: true,
		file_size_limit: 2 * 1024 * 1024,
		allowed_mime_types: ["image/png", "image/jpeg"],
	});
	await storageHandler!.createBucket({
		name: "documents",
		public: false,
		file_size_limit: 10 * 1024 * 1024,
	});

	const { data: buckets } = await supabase.storage.listBuckets();
	console.log(
		"  Buckets:",
		buckets?.map((b) => `${b.name} (${b.public ? "public" : "private"})`),
	);
	console.log();

	console.log("--- 2: Upload files ---");
	const textContent = new TextEncoder().encode("Hello, nano-supabase!");
	const { data: upload1 } = await supabase.storage
		.from("documents")
		.upload("notes/hello.txt", textContent, { contentType: "text/plain" });
	console.log("  Uploaded:", upload1?.path);

	const csvContent = new TextEncoder().encode("name,age\nAlice,25\nBob,30");
	const { data: upload2 } = await supabase.storage
		.from("documents")
		.upload("reports/users.csv", csvContent, { contentType: "text/csv" });
	console.log("  Uploaded:", upload2?.path);

	const avatarContent = new TextEncoder().encode("(fake PNG data)");
	const { data: upload3 } = await supabase.storage
		.from("avatars")
		.upload("user1/profile.png", avatarContent, { contentType: "image/png" });
	console.log("  Uploaded:", upload3?.path);
	console.log();

	console.log("--- 3: List files ---");
	const { data: docFiles } = await supabase.storage
		.from("documents")
		.list("", { sortBy: { column: "name", order: "asc" } });
	console.log(
		"  documents/:",
		docFiles?.map((f) => f.name),
	);

	const { data: noteFiles } = await supabase.storage
		.from("documents")
		.list("notes");
	console.log(
		"  documents/notes/:",
		noteFiles?.map((f) => f.name),
	);
	console.log();

	console.log("--- 4: Download a file ---");
	const { data: downloaded } = await supabase.storage
		.from("documents")
		.download("notes/hello.txt");
	if (downloaded) {
		const text = await downloaded.text();
		console.log(`  Content: "${text}"`);
	}
	console.log();

	console.log("--- 5: Public URL (for public buckets) ---");
	const { data: publicUrl } = supabase.storage
		.from("avatars")
		.getPublicUrl("user1/profile.png");
	console.log(`  Public URL: ${publicUrl.publicUrl}`);
	console.log();

	console.log("--- 6: Signed URL (for private buckets) ---");
	const { data: signedUrl } = await supabase.storage
		.from("documents")
		.createSignedUrl("notes/hello.txt", 3600);
	console.log(`  Signed URL (1h expiry): ${signedUrl?.signedUrl}`);
	console.log();

	console.log("--- 7: Move and copy files ---");
	await supabase.storage
		.from("documents")
		.copy("notes/hello.txt", "notes/hello-backup.txt");
	console.log("  Copied notes/hello.txt → notes/hello-backup.txt");

	await supabase.storage
		.from("documents")
		.move("reports/users.csv", "archive/users.csv");
	console.log("  Moved reports/users.csv → archive/users.csv");

	const { data: afterMove } = await supabase.storage
		.from("documents")
		.list("archive");
	console.log(
		"  documents/archive/:",
		afterMove?.map((f) => f.name),
	);
	console.log();

	console.log("--- 8: Delete files ---");
	const { data: removed } = await supabase.storage
		.from("documents")
		.remove(["notes/hello-backup.txt"]);
	console.log(
		"  Removed:",
		removed?.map((f) => f.name),
	);

	const { data: remaining } = await supabase.storage
		.from("documents")
		.list("notes");
	console.log(
		"  Remaining in notes/:",
		remaining?.map((f) => f.name),
	);
	console.log();

	console.log("All storage examples completed successfully!");
}

main().catch(console.error);
