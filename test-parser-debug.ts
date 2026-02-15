import { PGlite } from "@electric-sql/pglite";
import { PostgrestParser } from "./src/postgrest-parser.ts";

const db = new PGlite();
await db.exec(`
  CREATE TABLE profiles (id UUID PRIMARY KEY, username TEXT, avatar_url TEXT);
  CREATE TABLE posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), author_id UUID REFERENCES profiles(id), content TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
`);

await PostgrestParser.init();
await PostgrestParser.initSchema(async (sql: string) => {
  const r = await db.query(sql);
  return { rows: r.rows };
});

const parser = new PostgrestParser();
const result = parser.parseSelect("posts", "select=*,profiles(username,avatar_url)&order=created_at.desc");
console.log("SQL:", result.sql);
console.log("Params:", result.params);
await db.close();
