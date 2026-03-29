import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

export function createPGlite(
  dataDir?: string,
  options?: PGliteOptions & { extensions?: PGliteOptions["extensions"] },
): PGlite {
  const ext = { pgcrypto, uuid_ossp, ...options?.extensions };
  const opts = { ...options, extensions: ext };
  return dataDir ? new PGlite(dataDir, opts) : new PGlite(opts);
}

export const LEAN_POSTGRES_OPTIONS: Pick<PGliteOptions, "startParams"> = {
  startParams: [
    "--single",
    "-F",
    "-O",
    "-j",
    "-c",
    "shared_buffers=128kB",
    "-c",
    "work_mem=64kB",
  ],
};
