#!/usr/bin/env node
/**
 * search_coop.js — Search coop.ch for grocery items via Brave Search API.
 *
 * Usage:
 *   echo '["Milch", "Brot"]' | node search_coop.js
 *   node search_coop.js '["Milch", "Brot"]'
 *
 * Required environment variable:
 *   BRAVE_API_KEY  — Brave Search API subscription token
 *
 * Input:  JSON array of item strings (via stdin or first argument)
 * Output: JSON array of { query, results[] } objects
 *
 * Each result contains: name, brand, price, currency, unit, productId, url
 */

const https = require("https");

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 5;

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: { Accept: "application/json", ...headers },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });

    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Request timed out")));
    req.end();
  });
}

async function searchCoop(query) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing BRAVE_API_KEY env var.\n  export BRAVE_API_KEY='your-key'");
  }

  const params = new URLSearchParams({
    q: `site:coop.ch ${query}`,
    count: "10", // fetch extra to find product pages among mixed results
    country: "CH",
  });

  const url = `${BRAVE_SEARCH_URL}?${params}`;
  const { status, body } = await get(url, {
    "X-Subscription-Token": apiKey,
  });

  if (status === 401 || status === 403) {
    throw new Error(`Brave API: Unauthorized — check your BRAVE_API_KEY (HTTP ${status})`);
  }
  if (status === 429) {
    throw new Error("Brave API: Rate limit exceeded");
  }
  if (status !== 200) {
    throw new Error(`Brave API returned HTTP ${status}`);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Brave API returned invalid JSON");
  }

  const webResults = data?.web?.results || [];
  const queryLower = query.toLowerCase();

  // Parse all product pages first
  const products = [];
  for (const item of webResults) {
    const url = item.url || "";
    if (!/\/p\/\d+/.test(url)) continue;
    if (!url.startsWith("https://www.coop.ch/")) continue;

    const rawTitle = item.title || "";
    let name;
    if (!rawTitle || rawTitle.toLowerCase().includes("request rejected")) {
      // Fall back to URL slug: extract segment before /p/
      const slugMatch = url.match(/\/([^/]+)\/p\/\d+/);
      name = slugMatch
        ? slugMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "";
    } else {
      name = rawTitle
        .replace(/\s+online kaufen\s*/i, "")
        .replace(/\s*[\|–\-]\s*coop\.ch.*$/i, "")
        .trim();
    }

    const desc = (item.description || "").replace(/<[^>]+>/g, "");
    const priceMatch = desc.match(/CHF\s*([\d.,]+)|([\d.,]+)\s*CHF/);
    const price = priceMatch
      ? (priceMatch[1] || priceMatch[2]).replace(",", ".")
      : null;

    const pidMatch = url.match(/\/p\/(\d+)/);
    const productId = pidMatch ? pidMatch[1] : "";

    // Score: prefer products whose URL or name contains query word prefixes (min 4 chars)
    const haystack = (url + " " + name).toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    const score = queryWords.reduce((s, w) => {
      // Try progressively shorter prefixes (min 4 chars) for fuzzy matching
      for (let len = w.length; len >= 4; len--) {
        if (haystack.includes(w.slice(0, len))) return s + len;
      }
      return s;
    }, 0);

    products.push({ name, brand: "", price, currency: "CHF", unit: "", productId, url, score });
  }

  // Sort by relevance score (descending), return top MAX_RESULTS
  products.sort((a, b) => b.score - a.score);
  return products.slice(0, MAX_RESULTS).map(({ score: _score, ...p }) => p);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Invalid JSON from stdin")); }
    });
    process.stdin.on("error", reject);
  });
}

async function main() {
  let items;
  if (process.argv[2]) {
    try { items = JSON.parse(process.argv[2]); }
    catch {
      console.error("Error: first argument must be a JSON array of strings");
      process.exit(1);
    }
  } else {
    items = await readStdin();
  }

  if (!Array.isArray(items)) {
    console.error("Error: input must be a JSON array");
    process.exit(1);
  }

  const output = [];
  for (const item of items) {
    process.stderr.write(`Searching: ${item}...\n`);
    try {
      const results = await searchCoop(item);
      process.stderr.write(`  Found ${results.length} result(s)\n`);
      output.push({ query: item, results });
    } catch (err) {
      process.stderr.write(`  ⚠ ${err.message}\n`);
      output.push({ query: item, results: [], error: err.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
