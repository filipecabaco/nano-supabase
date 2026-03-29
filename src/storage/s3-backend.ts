import { AwsClient } from "aws4fetch";
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
  private readonly baseUrl: string;
  private readonly aws: AwsClient;

  constructor(options: S3StorageBackendOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? "storage/";
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
    const accessKeyId =
      options.credentials?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? "";
    const secretAccessKey =
      options.credentials?.secretAccessKey ??
      process.env.AWS_SECRET_ACCESS_KEY ??
      "";

    this.aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      region,
      service: "s3",
    });

    this.baseUrl = options.endpoint
      ? `${options.endpoint.replace(/\/$/, "")}/${this.bucket}`
      : `https://${this.bucket}.s3.${region}.amazonaws.com`;
  }

  private url(key: string): string {
    return `${this.baseUrl}/${this.prefix}${key}`;
  }

  private metaUrl(key: string): string {
    return `${this.baseUrl}/${this.prefix}${key}.__meta__.json`;
  }

  async put(
    key: string,
    data: Uint8Array,
    metadata: BlobMetadata,
  ): Promise<void> {
    const [blobResp, metaResp] = await Promise.all([
      this.aws.fetch(this.url(key), {
        method: "PUT",
        body: data as unknown as BodyInit,
        headers: { "Content-Type": metadata.contentType },
      }),
      this.aws.fetch(this.metaUrl(key), {
        method: "PUT",
        body: JSON.stringify(metadata),
        headers: { "Content-Type": "application/json" },
      }),
    ]);
    if (!blobResp.ok || !metaResp.ok) {
      const text = await (blobResp.ok ? metaResp : blobResp).text();
      throw new Error(`S3 PUT failed: ${text}`);
    }
  }

  async get(
    key: string,
  ): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null> {
    const [blobResp, metaResp] = await Promise.all([
      this.aws.fetch(this.url(key)),
      this.aws.fetch(this.metaUrl(key)),
    ]);
    if (blobResp.status === 404 || metaResp.status === 404) {
      return null;
    }
    if (!blobResp.ok || !metaResp.ok) {
      const text = await (blobResp.ok ? metaResp : blobResp).text();
      throw new Error(`S3 GET failed: ${text}`);
    }
    const [data, metaText] = await Promise.all([
      blobResp.arrayBuffer(),
      metaResp.text(),
    ]);
    return {
      data: new Uint8Array(data),
      metadata: JSON.parse(metaText),
    };
  }

  async delete(key: string): Promise<boolean> {
    const existed = await this.exists(key);
    await Promise.all([
      this.aws.fetch(this.url(key), { method: "DELETE" }),
      this.aws.fetch(this.metaUrl(key), { method: "DELETE" }),
    ]);
    return existed;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const s3Prefix = `${this.prefix}${prefix}`;
    let count = 0;
    let continuationToken = "";

    do {
      const params = new URLSearchParams({
        "list-type": "2",
        prefix: s3Prefix,
      });
      if (continuationToken) {
        params.set("continuation-token", continuationToken);
      }
      const listResp = await this.aws.fetch(
        `${this.baseUrl}?${params.toString()}`,
      );
      if (!listResp.ok) break;

      const xml = await listResp.text();
      const keys: string[] = [];
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        if (m[1]) keys.push(m[1]);
      }

      for (const objKey of keys) {
        await this.aws.fetch(`${this.baseUrl}/${objKey}`, {
          method: "DELETE",
        });
        if (!objKey.endsWith(".__meta__.json")) count++;
      }

      const truncatedMatch = xml.match(
        /<IsTruncated>(true|false)<\/IsTruncated>/,
      );
      const isTruncated = truncatedMatch?.[1] === "true";
      if (isTruncated) {
        const tokenMatch = xml.match(
          /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/,
        );
        continuationToken = tokenMatch?.[1] ?? "";
      } else {
        continuationToken = "";
      }
    } while (continuationToken);

    return count;
  }

  async exists(key: string): Promise<boolean> {
    const resp = await this.aws.fetch(this.url(key), { method: "HEAD" });
    if (resp.status === 404) return false;
    if (resp.ok) return true;
    throw new Error(`S3 HEAD failed: ${resp.status}`);
  }

  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const copySource = `/${this.bucket}/${this.prefix}${fromKey}`;
    const metaCopySource = `/${this.bucket}/${this.prefix}${fromKey}.__meta__.json`;

    const [blobResp, metaResp] = await Promise.all([
      this.aws.fetch(this.url(toKey), {
        method: "PUT",
        headers: { "x-amz-copy-source": copySource },
      }),
      this.aws.fetch(this.metaUrl(toKey), {
        method: "PUT",
        headers: { "x-amz-copy-source": metaCopySource },
      }),
    ]);

    if (blobResp.status === 404 || metaResp.status === 404) return false;
    if (!blobResp.ok || !metaResp.ok) return false;
    return true;
  }
}
