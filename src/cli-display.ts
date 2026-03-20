export function emojiWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0e || (cp >= 0x200b && cp <= 0x200f)) continue;
    if (cp === 0xfe0f) {
      w -= 1;
      continue;
    }
    w += cp > 0x2000 ? 2 : 1;
  }
  return w;
}

export function box(title: string, rows: [string, string][]): string {
  const keyWidth = Math.max(...rows.map(([k]) => k.length));
  const valWidth = Math.max(...rows.map(([, v]) => v.length));
  const innerWidth = keyWidth + 3 + valWidth;
  const titleVisualWidth = emojiWidth(title);
  const titlePad = Math.max(0, innerWidth - titleVisualWidth);
  const top = `\u256d${"─".repeat(innerWidth + 2)}\u256e`;
  const titleLine = `\u2502 ${title}${" ".repeat(titlePad)} \u2502`;
  const sep = `\u251c${"─".repeat(keyWidth + 2)}\u252c${"─".repeat(valWidth + 2)}\u2524`;
  const dataLines = rows.map(
    ([k, v]) =>
      `\u2502 ${k.padEnd(keyWidth)} \u2502 ${v.padEnd(valWidth)} \u2502`,
  );
  const bottom = `\u2570${"─".repeat(keyWidth + 2)}\u2534${"─".repeat(valWidth + 2)}\u256f`;
  return [top, titleLine, sep, ...dataLines, bottom].join("\n");
}

export function printStartupInfo(opts: {
  httpPort: number;
  pgUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  mcp: boolean;
}): void {
  const c = {
    light: "\x1b[38;2;62;207;142m",
    mid: "\x1b[38;2;36;180;126m",
    dark: "\x1b[38;2;26;138;92m",
    reset: "\x1b[0m",
  };

  const logo = [
    `        ${c.light}\u2591${c.mid}\u2593\u2593${c.reset}`,
    `       ${c.mid}\u2593${c.dark}\u2588\u2588${c.mid}\u2593${c.reset}`,
    `     ${c.light}\u2591${c.mid}\u2593${c.dark}\u2588\u2588\u2588${c.mid}\u2593\u2593\u2593${c.reset}`,
    `    ${c.mid}\u2593${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593${c.reset}`,
    `  ${c.light}\u2591${c.mid}\u2593${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593${c.light}\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591${c.reset}`,
    ` ${c.light}\u2591${c.dark}\u2588\u2588${c.mid}\u2593${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.reset}`,
    `${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.reset}`,
    `${c.light}\u2591${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.light}\u2591${c.reset}`,
    `           ${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.reset}`,
    `           ${c.mid}\u2593\u2593\u2593\u2593\u2593${c.light}\u2591${c.reset}`,
    `           ${c.mid}\u2593\u2593\u2593${c.light}\u2591${c.reset}`,
    `           ${c.mid}\u2593\u2593${c.light}\u2591${c.reset}`,
    ``,
    `    nano-supabase  \u2022  local dev server`,
  ].join("\n");

  process.stdout.write(logo + "\n\n");
  process.stdout.write(
    box("\ud83c\udf10 API", [
      ["URL", `http://localhost:${opts.httpPort}`],
      ["REST", `http://localhost:${opts.httpPort}/rest/v1`],
      ["Auth", `http://localhost:${opts.httpPort}/auth/v1`],
      ["Storage", `http://localhost:${opts.httpPort}/storage/v1`],
    ]) + "\n\n",
  );
  process.stdout.write(
    box("\ud83d\uddc4\ufe0f  Database", [["URL", opts.pgUrl]]) + "\n\n",
  );
  process.stdout.write(
    box("\ud83d\udd11 Auth Keys", [
      ["Anon key", opts.anonKey],
      ["Service role key", opts.serviceRoleKey],
    ]) + "\n\n",
  );

  if (opts.mcp) {
    const mcpUrl = `http://localhost:${opts.httpPort}/mcp`;
    process.stdout.write(
      box("\ud83e\udd16 MCP Server", [
        ["Transport", "Streamable HTTP"],
        ["URL", mcpUrl],
        [
          "Add to Claude Code",
          `claude mcp add --transport http nano-supabase ${mcpUrl}`,
        ],
      ]) + "\n\n",
    );
  }
}
