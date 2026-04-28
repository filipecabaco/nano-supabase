import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import type { NanoSupabaseBaseOptions, NanoSupabaseInstance } from "./nano-types.ts";
export type { NanoSupabaseBaseOptions, NanoSupabaseInstance, } from "./nano-types.ts";
export interface NanoSupabaseOptions extends NanoSupabaseBaseOptions {
    tcp?: boolean | {
        port?: number;
        host?: string;
    };
}
export declare function createClient<Database = unknown>(options?: NanoSupabaseOptions & SupabaseClientOptions<string> & {
    url?: string;
    key?: string;
}): Promise<SupabaseClient<Database>>;
export declare function nanoSupabase(options?: NanoSupabaseOptions): Promise<NanoSupabaseInstance>;
//# sourceMappingURL=nano.d.ts.map