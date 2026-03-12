#!/usr/bin/env node
/**
 * search_coop.js — Search coop.ch for grocery items.
 *
 * Usage:
 *   echo '["Milch", "Brot"]' | node search_coop.js
 *   node search_coop.js '["Milch", "Brot"]'
 *
 * Input:  JSON array of item strings (via stdin or first argument)
 * Output: JSON array of { query, results[] } objects
 *
 * Each result contains: name, brand, price, currency, unit, productId, url
 */

const https = require("https");

const COOP_SEARCH_URL = "https://www.coop.ch/de/search/";
const LANG = "de";
const MAX_RESULTS_PER_ITEM = 3;

/**
 * Make an HTTPS GET request and return the response body as a string.
 */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "de-CH,de;q=0.9",
      ...headers,
    };

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: defaultHeaders,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.end();
  });
}

/**
 * Search coop.ch for a single item query.
 * Returns an array of product objects.
 */
async function searchCoop(query) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    lang: LANG,
    rows: String(MAX_RESULTS_PER_ITEM * 2), // fetch extra in case some are filtered
  });

  const url = `${COOP_SEARCH_URL}?${params}`;

  try {
    const { status, body } = await get(url);

    if (status === 200) {
      try {
        const data = JSON.parse(body);
        return parseCoopResponse(data, query);
      } catch {
        // Response wasn't JSON — Coop may have returned HTML (DataDome block)
        return [];
      }
    }

    if (status === 403 || status === 429) {
      // DataDome blocked the request
      throw new Error(`Coop blocked the request (HTTP ${status}). Try using Claude in Chrome.`);
    }

    return [];
  } catch (err) {
    if (err.message.includes("blocked")) throw err;
    return [];
  }
}

/**
 * Parse the JSON response from coop.ch search.
 * Coop's internal JSON structure varies — we handle the known formats.
 */
function parseCoopResponse(data, query) {
  const results = [];

  // Format 1: { products: [...] }
  const productList =
    data?.products ||
    data?.searchResults?.products ||
    data?.data?.products ||
    [];

  for (const p of productList.slice(0, MAX_RESULTS_PER_ITEM)) {
    const product = extractProduct(p);
    if (product) results.push(product);
  }

  return results;
}

function extractProduct(p) {
  if (!p) return null;

  const name = p.name || p.title || p.productName || "";
  if (!name) return null;

  const price =
    p.price?.value ??
    p.price?.formattedValue?.replace(/[^0-9.]/g, "") ??
    p.priceData?.value ??
    null;

  const productId = p.code || p.id || p.productId || "";
  const url = productId
    ? `https://www.coop.ch/de/p/${productId}`
    : p.url
    ? `https://www.coop.ch${p.url}`
    : "";

  return {
    name,
    brand: p.brand?.name || p.brandName || "",
    price: price ? String(price) : null,
    currency: "CHF",
    unit: p.salesUnit || p.unit || p.quantityUnit || "",
    productId,
    url,
  };
}

/**
 * Read stdin until EOF, then parse as JSON.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON from stdin"));
      }
    });
    process.stdin.on("error", reject);
  });
}

async function main() {
  let items;

  if (process.argv[2]) {
    try {
      items = JSON.parse(process.argv[2]);
    } catch {
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
      output.push({ query: item, results });
    } catch (err) {
      process.stderr.write(`  ⚠ ${err.message}\n`);
      output.push({ query: item, results: [], error: err.message });
    }
    // Polite delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
