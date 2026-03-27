import type { BlobMetadata, StorageBackend } from "./backend.ts";

export interface S3StorageBackendOptions {
	bucket: string;
	prefix?: string;
	endpoint?: string;
	region?: string;
	credentials?: {
		accessKeyId: string;
		secretAccessKey: string;
	};
}

export class S3StorageBackend implements StorageBackend {
	private readonly bucket: string;
	private readonly prefix: string;
	private s3Client: unknown;
	private s3Loaded: Promise<{
		S3Client: unknown;
		PutObjectCommand: unknown;
		GetObjectCommand: unknown;
		DeleteObjectCommand: unknown;
		ListObjectsV2Command: unknown;
		CopyObjectCommand: unknown;
		HeadObjectCommand: unknown;
	}> | null = null;
	private readonly s3Options: S3StorageBackendOptions;

	constructor(options: S3StorageBackendOptions) {
		this.bucket = options.bucket;
		this.prefix = options.prefix ?? "storage/";
		this.s3Options = options;
	}

	private async getS3(): Promise<{ client: any; commands: any }> {
		if (!this.s3Loaded) {
			this.s3Loaded = import("@aws-sdk/client-s3").then((mod) => ({
				S3Client: mod.S3Client,
				PutObjectCommand: mod.PutObjectCommand,
				GetObjectCommand: mod.GetObjectCommand,
				DeleteObjectCommand: mod.DeleteObjectCommand,
				ListObjectsV2Command: mod.ListObjectsV2Command,
				CopyObjectCommand: mod.CopyObjectCommand,
				HeadObjectCommand: mod.HeadObjectCommand,
			}));
		}
		const commands = await this.s3Loaded;
		if (!this.s3Client) {
			const ClientClass = commands.S3Client as any;
			const clientOpts: Record<string, unknown> = {};
			if (this.s3Options.endpoint)
				clientOpts.endpoint = this.s3Options.endpoint;
			if (this.s3Options.region) clientOpts.region = this.s3Options.region;
			if (this.s3Options.credentials)
				clientOpts.credentials = this.s3Options.credentials;
			if (this.s3Options.endpoint) clientOpts.forcePathStyle = true;
			this.s3Client = new ClientClass(clientOpts);
		}
		return { client: this.s3Client, commands };
	}

	private s3Key(key: string): string {
		return `${this.prefix}${key}`;
	}

	private metaKey(key: string): string {
		return `${this.prefix}${key}.__meta__.json`;
	}

	async put(
		key: string,
		data: Uint8Array,
		metadata: BlobMetadata,
	): Promise<void> {
		const { client, commands } = await this.getS3();
		await Promise.all([
			client.send(
				new (commands.PutObjectCommand as any)({
					Bucket: this.bucket,
					Key: this.s3Key(key),
					Body: data,
					ContentType: metadata.contentType,
				}),
			),
			client.send(
				new (commands.PutObjectCommand as any)({
					Bucket: this.bucket,
					Key: this.metaKey(key),
					Body: JSON.stringify(metadata),
					ContentType: "application/json",
				}),
			),
		]);
	}

	async get(
		key: string,
	): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null> {
		const { client, commands } = await this.getS3();
		try {
			const [blobResp, metaResp] = await Promise.all([
				client.send(
					new (commands.GetObjectCommand as any)({
						Bucket: this.bucket,
						Key: this.s3Key(key),
					}),
				),
				client.send(
					new (commands.GetObjectCommand as any)({
						Bucket: this.bucket,
						Key: this.metaKey(key),
					}),
				),
			]);

			const blobChunks: Uint8Array[] = [];
			for await (const chunk of blobResp.Body as AsyncIterable<Uint8Array>) {
				blobChunks.push(chunk);
			}
			const totalLen = blobChunks.reduce((s, c) => s + c.length, 0);
			const data = new Uint8Array(totalLen);
			let offset = 0;
			for (const chunk of blobChunks) {
				data.set(chunk, offset);
				offset += chunk.length;
			}

			const metaChunks: Uint8Array[] = [];
			for await (const chunk of metaResp.Body as AsyncIterable<Uint8Array>) {
				metaChunks.push(chunk);
			}
			const metaStr = new TextDecoder().decode(
				metaChunks.reduce((acc, c) => {
					const merged = new Uint8Array(acc.length + c.length);
					merged.set(acc);
					merged.set(c, acc.length);
					return merged;
				}, new Uint8Array()),
			);

			return { data, metadata: JSON.parse(metaStr) };
		} catch (e: any) {
			if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404)
				return null;
			throw e;
		}
	}

	async delete(key: string): Promise<boolean> {
		const { client, commands } = await this.getS3();
		const existed = await this.exists(key);
		await Promise.all([
			client.send(
				new (commands.DeleteObjectCommand as any)({
					Bucket: this.bucket,
					Key: this.s3Key(key),
				}),
			),
			client.send(
				new (commands.DeleteObjectCommand as any)({
					Bucket: this.bucket,
					Key: this.metaKey(key),
				}),
			),
		]);
		return existed;
	}

	async deleteByPrefix(prefix: string): Promise<number> {
		const { client, commands } = await this.getS3();
		const s3Prefix = this.s3Key(prefix);
		let count = 0;
		let continuationToken: string | undefined;

		do {
			const listResp: any = await client.send(
				new (commands.ListObjectsV2Command as any)({
					Bucket: this.bucket,
					Prefix: s3Prefix,
					ContinuationToken: continuationToken,
				}),
			);

			const contents = listResp.Contents ?? [];
			for (const obj of contents) {
				await client.send(
					new (commands.DeleteObjectCommand as any)({
						Bucket: this.bucket,
						Key: obj.Key,
					}),
				);
				if (!obj.Key.endsWith(".__meta__.json")) count++;
			}

			continuationToken = listResp.IsTruncated
				? listResp.NextContinuationToken
				: undefined;
		} while (continuationToken);

		return count;
	}

	async exists(key: string): Promise<boolean> {
		const { client, commands } = await this.getS3();
		try {
			await client.send(
				new (commands.HeadObjectCommand as any)({
					Bucket: this.bucket,
					Key: this.s3Key(key),
				}),
			);
			return true;
		} catch (e: any) {
			if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404)
				return false;
			throw e;
		}
	}

	async copy(fromKey: string, toKey: string): Promise<boolean> {
		const { client, commands } = await this.getS3();
		try {
			await Promise.all([
				client.send(
					new (commands.CopyObjectCommand as any)({
						Bucket: this.bucket,
						CopySource: `${this.bucket}/${this.s3Key(fromKey)}`,
						Key: this.s3Key(toKey),
					}),
				),
				client.send(
					new (commands.CopyObjectCommand as any)({
						Bucket: this.bucket,
						CopySource: `${this.bucket}/${this.metaKey(fromKey)}`,
						Key: this.metaKey(toKey),
					}),
				),
			]);
			return true;
		} catch (e: any) {
			if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404)
				return false;
			throw e;
		}
	}
}
