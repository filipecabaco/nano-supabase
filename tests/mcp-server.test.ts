import { createMcpHandler } from "../src/mcp-server.ts";
import { nanoSupabase } from "../src/nano.ts";
import { assertEquals, assertExists, describe, test } from "./compat.ts";

async function sendMcpRequest(
  handler: { handleRequest: (req: Request) => Promise<Response> },
  body: unknown,
  sessionId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return handler.handleRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function initializeRequest(id: number = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

async function initSession(handler: {
  handleRequest: (req: Request) => Promise<Response>;
}): Promise<string> {
  const res = await sendMcpRequest(handler, initializeRequest());
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No session ID returned");
  return sessionId;
}

function makeHandler(
  nano: Awaited<ReturnType<typeof nanoSupabase>>,
  httpPort = 54321,
) {
  return createMcpHandler(nano, {
    httpPort,
    serviceRoleKey: "test-key",
    anonKey: "test-anon-key",
  });
}

describe("MCP Server", () => {
  test("initialize returns protocol version and capabilities", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const res = await sendMcpRequest(handler, initializeRequest());
      assertEquals(res.status, 200);

      const data = await res.json();
      assertExists(data.result);
      assertExists(data.result.protocolVersion);
      assertExists(data.result.capabilities);
      assertExists(data.result.serverInfo);
    } finally {
      await nano.stop();
    }
  });

  test("list tools returns database and development tools", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const listRes = await sendMcpRequest(
        handler,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        sessionId,
      );
      assertEquals(listRes.status, 200);

      const data = await listRes.json();
      assertExists(data.result);
      assertExists(data.result.tools);

      const toolNames = data.result.tools.map((t: { name: string }) => t.name);
      assertEquals(toolNames.includes("execute_sql"), true);
      assertEquals(toolNames.includes("list_migrations"), true);
      assertEquals(toolNames.includes("apply_migration"), true);
      assertEquals(toolNames.includes("get_project_url"), true);
      assertEquals(toolNames.includes("generate_typescript_types"), true);
    } finally {
      await nano.stop();
    }
  });

  test("execute_sql tool runs a query", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "execute_sql",
            arguments: { query: "SELECT 1 AS value" },
          },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      assertExists(data.result);
      assertExists(data.result.content);
      const textContent = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      );
      assertExists(textContent);
      assertEquals(textContent.text.includes("value"), true);
      assertEquals(textContent.text.includes("1"), true);
    } finally {
      await nano.stop();
    }
  });

  test("apply_migration creates table and records migration", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const applyRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "apply_migration",
            arguments: {
              name: "create_test_table",
              query:
                "CREATE TABLE mcp_test (id serial primary key, name text);",
            },
          },
        },
        sessionId,
      );
      assertEquals(applyRes.status, 200);
      const applyData = await applyRes.json();
      assertEquals(applyData.result.isError, undefined);

      const listRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_migrations", arguments: {} },
        },
        sessionId,
      );
      assertEquals(listRes.status, 200);

      const listData = await listRes.json();
      const text = listData.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("create_test_table"), true);
    } finally {
      await nano.stop();
    }
  });

  test("get_project_url returns correct URL", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano, 12345);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_project_url", arguments: {} },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("12345"), true);
    } finally {
      await nano.stop();
    }
  });

  test("generate_typescript_types returns type definitions", async () => {
    const nano = await nanoSupabase();
    try {
      await nano.db.exec(
        "CREATE TABLE ts_test (id serial primary key, name text NOT NULL, active boolean);",
      );

      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "generate_typescript_types", arguments: {} },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("ts_test"), true);
      assertEquals(text.includes("Database"), true);
    } finally {
      await nano.stop();
    }
  });

  test("list_tables returns table information", async () => {
    const nano = await nanoSupabase();
    try {
      await nano.db.exec(
        "CREATE TABLE list_test (id serial primary key, name text);",
      );

      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_tables", arguments: {} },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("list_test"), true);
    } finally {
      await nano.stop();
    }
  });

  test("list_extensions returns extension information", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_extensions", arguments: {} },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      assertExists(data.result);
      assertExists(data.result.content);
      assertEquals(data.result.isError, undefined);
    } finally {
      await nano.stop();
    }
  });

  test("get_logs returns without error", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_logs", arguments: { service: "postgres" } },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      assertExists(data.result);
      assertExists(data.result.content);
    } finally {
      await nano.stop();
    }
  });

  test("get_advisors security detects extensions in public schema", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_advisors", arguments: { type: "security" } },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      assertExists(data.result);
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("extension_in_public"), true);
    } finally {
      await nano.stop();
    }
  });

  test("get_advisors security detects RLS disabled on table with anon access", async () => {
    const nano = await nanoSupabase();
    try {
      await nano.db.exec(
        "CREATE TABLE public.rls_test (id serial primary key, name text);",
      );
      await nano.db.exec("GRANT SELECT ON public.rls_test TO anon;");

      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_advisors", arguments: { type: "security" } },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("rls_disabled_in_public"), true);
      assertEquals(text.includes("rls_test"), true);
    } finally {
      await nano.stop();
    }
  });

  test("get_advisors performance detects table without primary key", async () => {
    const nano = await nanoSupabase();
    try {
      await nano.db.exec("CREATE TABLE public.no_pk_test (name text);");

      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_advisors", arguments: { type: "performance" } },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      assertExists(data.result);
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("no_primary_key"), true);
      assertEquals(text.includes("no_pk_test"), true);
    } finally {
      await nano.stop();
    }
  });

  test("get_publishable_keys returns anon and service role keys", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);
      const sessionId = await initSession(handler);

      const callRes = await sendMcpRequest(
        handler,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_publishable_keys", arguments: {} },
        },
        sessionId,
      );
      assertEquals(callRes.status, 200);

      const data = await callRes.json();
      const text = data.result.content.find(
        (c: { type: string }) => c.type === "text",
      ).text;
      assertEquals(text.includes("test-anon-key"), true);
    } finally {
      await nano.stop();
    }
  });

  test("request with unknown session returns 404", async () => {
    const nano = await nanoSupabase();
    try {
      const handler = makeHandler(nano);

      const res = await sendMcpRequest(
        handler,
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        "nonexistent-session-id",
      );
      assertEquals(res.status, 404);
    } finally {
      await nano.stop();
    }
  });
});
