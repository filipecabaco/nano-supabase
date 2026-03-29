export interface BlobMetadata {
  contentType: string;
  size: number;
  cacheControl?: string;
}

export interface StorageBackend {
  put(key: string, data: Uint8Array, metadata: BlobMetadata): Promise<void>;

  get(
    key: string,
  ): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null>;

  delete(key: string): Promise<boolean>;

  deleteByPrefix(prefix: string): Promise<number>;

  exists(key: string): Promise<boolean>;

  copy(fromKey: string, toKey: string): Promise<boolean>;
}
export class MemoryStorageBackend implements StorageBackend {
  private store = new Map<
    string,
    { data: Uint8Array; metadata: BlobMetadata }
  >();

  async put(
    key: string,
    data: Uint8Array,
    metadata: BlobMetadata,
  ): Promise<void> {
    this.store.set(key, { data, metadata });
  }

  async get(
    key: string,
  ): Promise<{ data: Uint8Array; metadata: BlobMetadata } | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const entry = this.store.get(fromKey);
    if (!entry) return false;
    this.store.set(toKey, {
      data: new Uint8Array(entry.data),
      metadata: { ...entry.metadata },
    });
    return true;
  }
}
