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
	tls?: boolean;
	scheme?: string;
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

	process.stdout.write(`${logo}\n\n`);
	const scheme = opts.scheme ?? "http";
	const base = `${scheme}://localhost:${opts.httpPort}`;
	const apiTitle = opts.tls ? "\ud83c\udf10 API (TLS)" : "\ud83c\udf10 API";
	process.stdout.write(
		`${box(apiTitle, [
			["URL", base],
			["REST", `${base}/rest/v1`],
			["Auth", `${base}/auth/v1`],
			["Storage", `${base}/storage/v1`],
		])}\n\n`,
	);
	process.stdout.write(
		`${box("\ud83d\uddc4\ufe0f  Database", [["URL", opts.pgUrl]])}\n\n`,
	);
	process.stdout.write(
		`${box("\ud83d\udd11 Auth Keys", [
			["Anon key", opts.anonKey],
			["Service role key", opts.serviceRoleKey],
		])}\n\n`,
	);

	if (opts.mcp) {
		const mcpUrl = `${scheme}://localhost:${opts.httpPort}/mcp`;
		process.stdout.write(
			`${box("\ud83e\udd16 MCP Server", [
				["Transport", "Streamable HTTP"],
				["URL", mcpUrl],
				[
					"Add to Claude Code",
					`claude mcp add --transport http nano-supabase ${mcpUrl}`,
				],
			])}\n\n`,
		);
	}
}

export function printTenantInfo(opts: {
	slug: string;
	serviceUrl: string;
	pgUrl: string;
	anonKey: string;
	serviceRoleKey: string;
	token: string;
	state: string;
}): void {
	const base = `${opts.serviceUrl}/${opts.slug}`;
	process.stdout.write(
		`${box(`\ud83c\udf10 API \u2014 ${opts.slug}`, [
			["URL", base],
			["REST", `${base}/rest/v1`],
			["Auth", `${base}/auth/v1`],
			["Storage", `${base}/storage/v1`],
		])}\n\n`,
	);
	process.stdout.write(
		`${box("\ud83d\uddc4\ufe0f  Database", [["URL", opts.pgUrl]])}\n\n`,
	);
	process.stdout.write(
		`${box("\ud83d\udd11 Auth Keys", [
			["Anon key", opts.anonKey],
			["Service role key", opts.serviceRoleKey],
		])}\n\n`,
	);
	process.stdout.write(
		`${box("\ud83d\udd12 Tenant", [
			["Token", opts.token],
			["State", opts.state],
		])}\n\n`,
	);
}
