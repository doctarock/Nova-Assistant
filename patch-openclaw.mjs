import fs from "node:fs";
import path from "node:path";

const base = "/home/openclaw/.npm-global/lib/node_modules/openclaw";
const exts = new Set([".js", ".md", ".json", ".d.ts"]);
const webBundleMarker = 'label: "Web Search"';

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".npm") continue;
      walk(full, acc);
      continue;
    }
    if (exts.has(path.extname(full))) acc.push(full);
  }
  return acc;
}

function replaceAll(text, from, to) {
  return text.includes(from) ? text.split(from).join(to) : text;
}

function patchDocsAndPrompts(text) {
  const replacements = [
    ["Search the web (Brave API)", "Search the web (internet-enabled run)"],
    [
      "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.",
      "Search the web using the internet-enabled run in this workspace. Prefer generic web access for ordinary research; provider-specific search remains optional."
    ],
    [
      "web_search needs a Brave Search API key.",
      "web_search is provider-backed. For ordinary web access in this workspace, use the internet-enabled run and prefer generic web access instead of configuring Brave Search."
    ],
    [
      "Enable the web_search tool (requires a provider API key).",
      "Enable the web_search tool (provider-backed; ordinary internet access may be available separately)."
    ],
    [
      "OpenClaw uses Brave Search for the `web_search` tool. Without a Brave Search API key, web search won’t work.",
      "In this workspace, ordinary web access should use the internet-enabled run. Provider-backed web_search is optional and only needed for provider-specific workflows."
    ],
    [
      "OpenClaw uses Brave Search for the `web_search` tool. Without a Brave Search API key, web search wonâ€™t work.",
      "In this workspace, ordinary web access should use the internet-enabled run. Provider-backed web_search is optional and only needed for provider-specific workflows."
    ],
    ["- Enable web_search and paste your Brave Search API key", "- Use the internet-enabled run for ordinary web access"],
    ["Configure Brave search + fetch", "Configure web access + fetch"],
    [
      "It requires a Brave Search API key (you can store it in the config or set BRAVE_API_KEY in the Gateway environment).",
      "Provider-backed web_search requires its own API key, but ordinary web access in this workspace should use the internet-enabled run instead."
    ],
    ["Enable web_search (Brave Search)?", "Enable provider-backed web_search?"],
    [
      "Brave Search API key (leave blank to keep current or use BRAVE_API_KEY)",
      "Provider API key for web_search (leave blank to keep current or use BRAVE_API_KEY)"
    ],
    [
      "Brave Search API key (paste it here; leave blank to use BRAVE_API_KEY)",
      "Provider API key for web_search (paste it here; leave blank to use BRAVE_API_KEY)"
    ],
    [
      "Tip: run \\`${formatCliCommand(\"openclaw configure --section web\")}\\` to store your Brave API key for web_search. Docs: https://docs.openclaw.ai/tools/web",
      "Tip: ordinary web access in this workspace should use the internet-enabled run. Configure a provider key only if a specific provider-backed web_search workflow is required."
    ],
    [
      "API key: provided via BRAVE_API_KEY env var (Gateway environment).",
      "Provider key is optional and only needed for provider-backed web_search workflows."
    ],
    [
      "Alternative: set BRAVE_API_KEY in the Gateway environment (no config changes).",
      "Alternative: configure a provider key only when a provider-backed web_search workflow is explicitly required."
    ],
    ["Brave Search API key (fallback: BRAVE_API_KEY env var).", "Provider API key for web_search (fallback: BRAVE_API_KEY env var)."],
    ["Brave Search API Key", "Provider API key for web_search"],
    ["BSA...", "Optional provider key"]
  ];

  let next = text;
  for (const [from, to] of replacements) {
    next = replaceAll(next, from, to);
  }

  next = next.replace(
    /Run `\$\{formatCliCommand\("openclaw configure --section web"\)\}` to store it, or set BRAVE_API_KEY in the Gateway environment\./g,
    "Use the existing internet-enabled run for ordinary web access. Only configure a provider key if a task explicitly requires a specific provider."
  );

  return next;
}

const internetSearchHelper = String.raw`function decodeInternetSearchEntities(value) {
	return String(value ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&#x2F;/gi, "/").replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}
function stripInternetSearchTags(value) {
	return decodeInternetSearchEntities(String(value ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function readInternetSearchTag(block, tagName) {
	const match = new RegExp("<" + tagName + ">([\\s\\S]*?)<\\/" + tagName + ">", "i").exec(block);
	return match ? stripInternetSearchTags(match[1]) : "";
}
async function runInternetSearch(params) {
	const cacheKey = normalizeCacheKey(` + "`internet:${params.query}:${params.count}`" + String.raw`);
	const cached = readCache(SEARCH_CACHE, cacheKey);
	if (cached) return {
		...cached.value,
		cached: true
	};
	const start = Date.now();
	const url = new URL("https://www.bing.com/search");
	url.searchParams.set("format", "rss");
	url.searchParams.set("q", params.query);
	const response = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
			"User-Agent": "Mozilla/5.0 (compatible; OpenClaw internet search fallback)"
		},
		signal: AbortSignal.timeout(Math.max(1, params.timeoutSeconds) * 1e3)
	});
	if (!response.ok) {
		const detail = (await readResponseText(response, { maxBytes: 64e3 })).text;
		throw new Error(` + "`Internet search error (${response.status}): ${detail || response.statusText}`" + String.raw`);
	}
	const xml = (await readResponseText(response, { maxBytes: 256e3 })).text;
	const results = [];
	const limit = Math.max(1, Math.min(params.count, 10));
	const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
	let match;
	while ((match = itemPattern.exec(xml)) && results.length < limit) {
		const block = match[1];
		const url = readInternetSearchTag(block, "link");
		if (!url) continue;
		const title = readInternetSearchTag(block, "title");
		const description = readInternetSearchTag(block, "description");
		const published = readInternetSearchTag(block, "pubDate") || void 0;
		const rawSiteName = resolveSiteName(url);
		results.push({
			title: title ? wrapWebContent(title, "web_search") : "",
			url,
			description: description ? wrapWebContent(description, "web_search") : "",
			published,
			siteName: rawSiteName || void 0
		});
	}
	const payload = {
		query: params.query,
		provider: "internet",
		count: results.length,
		tookMs: Date.now() - start,
		externalContent: {
			untrusted: true,
			source: "web_search",
			provider: "internet",
			wrapped: true
		},
		results
	};
	writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
	return payload;
}
`;

function patchWebBundle(text) {
  let next = patchDocsAndPrompts(text);

  if (!next.includes(webBundleMarker)) {
    return { text: next, changed: next !== text, webBundle: false };
  }

  if (!next.includes("async function runInternetSearch(params) {")) {
    next = next.replace(
      /async function runWebSearch\(params\) \{/,
      `${internetSearchHelper}async function runWebSearch(params) {`
    );
  }

  next = next.replace(
    /if \(!apiKey\) return jsonResult\(missingSearchKeyPayload\(provider\)\);/g,
    `if (!apiKey && provider === "brave") {
				const fallbackParams = args;
				const fallbackQuery = readStringParam(fallbackParams, "query", { required: true });
				const fallbackCount = readNumberParam(fallbackParams, "count", { integer: true }) ?? search?.maxResults ?? void 0;
				return jsonResult(await runInternetSearch({
					query: fallbackQuery,
					count: resolveSearchCount(fallbackCount, DEFAULT_SEARCH_COUNT),
					timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
					cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES)
				}));
			}
			if (!apiKey) return jsonResult(missingSearchKeyPayload(provider));`
  );

  next = next.replace(
    /description:\s*provider === "perplexity" \? "[^"]+" : provider === "grok" \? "[^"]+" : "Search the web using Brave Search API\.[^"]+",/g,
    `description: provider === "perplexity" ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with citations from real-time web search." : provider === "grok" ? "Search the web using xAI Grok. Returns AI-synthesized answers with citations from real-time web search." : "Search the web using the internet-enabled run in this workspace. Prefer generic web access for ordinary research; provider-specific search remains optional.",`
  );

  const changed = next !== text;
  return { text: next, changed, webBundle: true };
}

const results = [];
for (const file of walk(base)) {
  const original = fs.readFileSync(file, "utf8");
  const { text, changed, webBundle } = patchWebBundle(original);
  if (changed) fs.writeFileSync(file, text);
  if (webBundle) {
    results.push({
      file,
      patched: text.includes("async function runInternetSearch(params) {") &&
        text.includes('return jsonResult(await runInternetSearch({') &&
        !text.includes("web_search needs a Brave Search API key")
    });
  }
}

if (results.length === 0) {
  throw new Error("No web_search bundles were found to patch.");
}

const failed = results.filter((entry) => !entry.patched);
if (failed.length > 0) {
  throw new Error(`Unpatched web_search bundles remain: ${failed.map((entry) => entry.file).join(", ")}`);
}

console.log(`Patched ${results.length} web_search bundles.`);
