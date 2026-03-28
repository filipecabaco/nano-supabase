import {
	mkdir,
	readdir,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BlobMetadata, StorageBackend } from "./backend.ts";

export class FileSystemStorageBackend implements StorageBackend {
	private readonly baseDir: string;

	constructor(baseDir: string) {
		this.baseDir = baseDir;
	}

	private blobPath(key: string): string {
		return join(this.baseDir, key);
	}

	private metaPath(key: string): string {
		return join(this.baseDir, `${key}.__meta__.json`);
	}

	async put(
		key: string,
		data: Uint8Array,
		metadata: BlobMetadata,
	): Promise<void> {
		const blobPath = this.blobPath(key);
		await mkdir(dirname(blobPath), { recursive: true });
		await writeFile(blobPath, data);
		await writeFile(this.metaPath(key), JSON.stringify(metadata));
	}

	async get(
		key: string,
	): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null> {
		try {
			const [data, metaRaw] = await Promise.all([
				readFile(this.blobPath(key)),
				readFile(this.metaPath(key), "utf-8"),
			]);
			return { data: new Uint8Array(data), metadata: JSON.parse(metaRaw) };
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw e;
		}
	}

	async delete(key: string): Promise<boolean> {
		try {
			await unlink(this.blobPath(key));
			await unlink(this.metaPath(key)).catch(() => {});
			return true;
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw e;
		}
	}

	async deleteByPrefix(prefix: string): Promise<number> {
		const dir = join(this.baseDir, prefix);
		let count = 0;
		try {
			count = await this.countFiles(dir);
			await rm(dir, { recursive: true, force: true });
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
			throw e;
		}
		return count;
	}

	private async countFiles(dir: string): Promise<number> {
		let count = 0;
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					count += await this.countFiles(join(dir, entry.name));
				} else if (!entry.name.endsWith(".__meta__.json")) {
					count++;
				}
			}
		} catch {
			return 0;
		}
		return count;
	}

	async exists(key: string): Promise<boolean> {
		try {
			await readFile(this.blobPath(key), { flag: "r" });
			return true;
		} catch {
			return false;
		}
	}

	async copy(fromKey: string, toKey: string): Promise<boolean> {
		try {
			const [data, metaRaw] = await Promise.all([
				readFile(this.blobPath(fromKey)),
				readFile(this.metaPath(fromKey), "utf-8"),
			]);
			const toPath = this.blobPath(toKey);
			await mkdir(dirname(toPath), { recursive: true });
			await writeFile(toPath, data);
			await writeFile(this.metaPath(toKey), metaRaw);
			return true;
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw e;
		}
	}
}
