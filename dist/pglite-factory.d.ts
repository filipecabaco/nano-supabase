import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
export declare function createPGlite(dataDir?: string, options?: PGliteOptions & {
    extensions?: PGliteOptions["extensions"];
}): PGlite;
export declare const LEAN_POSTGRES_OPTIONS: Pick<PGliteOptions, "startParams">;
//# sourceMappingURL=pglite-factory.d.ts.map