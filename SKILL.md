---
name: coop-shopping-v2
description: This skill should be used when the user wants to "shop at Coop", "do my Coop shopping", "find my groceries on Coop", "fill my Coop cart", "add items to my shopping list", "update my shopping list", or "search coop.ch" for grocery items. Reads a shopping list from a Google Drive Doc (bullet point list, one item per bullet), matches items against a favorites Gist, searches coop.ch for unmatched items, and marks items ✓ done after cart addition.
---

# Coop Shopping Skill

Reads a grocery shopping list from a **Google Drive Doc** (formatted as a bullet point list, one item per bullet), matches each item against a **favorites Gist** (GitHub), auto-selects the preferred product when found, falls back to coop.ch search otherwise, and marks items `✓` done after cart addition.

## Configuration

| Role | Source | ID / URL |
|---|---|---|
| Shopping list | Google Drive Doc | `14yMNj3pvjPk0uDGYDEnCXSyQXJMgspBm2efW-XxZ1og` |
| Favorites | GitHub Gist | `c7fdebb823f5c3361116f8e2f96e7017` |

**Note:** Ignore `README.md` — it is for humans only. This file (`SKILL.md`) is the sole source of truth for all instructions.

**Requirements:**
- **google-docs MCP** connector must be active (for the shopping list)
- **GitHub MCP** connector must be active (for the favorites Gist)
Both are connected in Settings → Connectors. Start a fresh conversation if tools are unavailable.

---

## Important: Coop.ch Bot Protection

Coop uses DataDome bot protection on all endpoints:
- **Product search** — always use the `search_coop` MCP tool first (calls Brave Search API under the hood). Only use the browser as a last resort if the MCP tool returns no results.
- **Adding to cart** requires a real browser — use **Claude in Chrome** with the user's authenticated Coop session

**Search priority order:**
1. Favorites lookup (instant, no API call)
2. `mcp__local-scripts__search_coop` MCP tool (Brave Search API, `site:coop.ch`)
3. Claude in Chrome → `https://www.coop.ch/de/search/?q={item}` (only if MCP returns nothing)

---

## Full Workflow

```
1. Read shopping list Google Doc (google-docs MCP)
   ↓
2. Read favorites Gist (GitHub MCP)
   ↓
3. Batch-search all non-favorites items on coop.ch in one script call
   ↓
4. Present plan to user (favorites auto-selected, unknowns need choice)
   ↓
5. Add to cart item by item via Claude in Chrome
   (navigate directly to product URL from search results)
   ↓
6. After ALL items added: update shopping list Google Doc once via google-docs MCP
```

---

## Step 1: Read Shopping List Google Doc

Use the google-docs MCP to read the document with ID: `14yMNj3pvjPk0uDGYDEnCXSyQXJMgspBm2efW-XxZ1og`

The document is a **bullet point list** — one item per bullet. Parse line by line:
- Bullet lines start with `-` or `•` (Google Docs default bullet character)
- Lines starting with `✓` (with or without a leading bullet) → already done, **skip**
- Lines starting with `#` → comments, **skip**
- Blank lines → **skip**
- All other bullet lines → **pending items** — strip the leading `-`/`•` and any surrounding whitespace to get the raw item name

If the document contains comma-separated or otherwise grouped items on a single bullet, split them into individual bullets before processing — and rewrite the document in the normalized one-per-bullet format first.

---

## Step 2: Read Favorites Gist

Use GitHub MCP `get_gist` with ID: `c7fdebb823f5c3361116f8e2f96e7017`

The file `coop-favorites.md` contains a markdown table:

```markdown
| Suchbegriff | Bevorzugtes Produkt |
|---|---|
| Bananen | Naturaplan Bio Fairtrade Bananen ca. 1kg |
| Hafermilch | Prix Garantie Haferdrink Vitamine & Calcium |
| Haferdrink | Prix Garantie Haferdrink Vitamine & Calcium |
| Weisswein | Valais AOC Johannisberg Hurlevent (75cl) |
```

Parse all `| key | value |` data rows into a lookup map:
```
{ "bananen": "Naturaplan Bio Fairtrade Bananen ca. 1kg", "hafermilch": "Prix Garantie Haferdrink Vitamine & Calcium", ... }
```
Keys are **lowercased and trimmed** for matching. Skip the header row and separator row (`|---|---|`).

---

## Step 3: Match Items to Products

For each pending shopping list item:

**a) Favorites lookup (fuzzy keyword match):**
- Lowercase and trim the item name
- Check if any favorites key is contained in the item, OR the item is contained in a favorites key
- If matched → **auto-selected**, note the exact product name

**b) No favorites match → batch search via MCP tool:**

Collect ALL unmatched items into a single array and call the `search_coop` tool from the `local-scripts` MCP server in one call:

```
mcp__local-scripts__search_coop({ items: ["Pasta", "Rapsöl", "Tofu"] })
```

The tool returns a JSON array of `{ query, results[] }` objects where each result has `name`, `brand`, `price`, `currency`, `unit`, `productId`, and `url`.

**Auto-select the top result** (highest relevance score) — do not ask the user to confirm. Only ask if the top result looks clearly wrong (e.g. wrong category, irrelevant name).

**Only use Claude in Chrome (browser) as fallback** when the MCP search returns no results for an item — navigate directly to `https://www.coop.ch/de/search/?q={item}` to find the product manually.

---

## Step 4: Present the Shopping Plan

Show a clear summary before starting cart operations:

```
📋 Einkaufsplan — 5 Artikel

✨ Favoriten:
  • Hafermilch → Prix Garantie Haferdrink Vitamine & Calcium
  • Bananen → Naturaplan Bio Fairtrade Bananen ca. 1kg

🔍 Beste Treffer (automatisch ausgewählt):
  • Pasta → Barilla Spaghetti n°5 500g — CHF 1.80
  • Rapsöl → Coop Rapsöl 1L — CHF 3.50
  • Agavendicksaft → Naturaplan Bio Agavensirup 350g — CHF 4.95
```

Present the plan and proceed immediately — no confirmation needed unless a result looks clearly wrong.

---

## Step 5: Add to Cart via Claude in Chrome

For each item, use the **product URL** returned by the search script (faster and more reliable than searching again):

1. Navigate directly to the product URL: `https://www.coop.ch/de/p/{productId}`
   - For favorites (no search result URL available): fall back to `https://www.coop.ch/de/search/?q={exact product name}`
2. Check if the page shows a pre-set quantity (e.g. a pack of 6 wine bottles, a tray of eggs). **Leave the quantity as-is** — do not change it to 1.
3. Find and click "In den Warenkorb" / "Zum Warenkorb hinzufügen"
4. Confirm item was added (page feedback or cart counter update)
5. Track successfully added items in memory for the Google Doc update in Step 6

---

## Step 6: Mark ✓ Done in Shopping List Google Doc (single update)

After ALL items have been added to cart, do **one** Google Doc update:

1. Use the google-docs MCP to read the current document content (ID: `14yMNj3pvjPk0uDGYDEnCXSyQXJMgspBm2efW-XxZ1og`)
2. For each successfully added item, prepend `✓ ` to its line (case-insensitive match)
3. Use the google-docs MCP to write the fully updated content back to the document

Preserve the bullet character and prepend `✓ ` after it:

```
Before: - Hafermilch       After: - ✓ Hafermilch
Before: - Bananen          After: - ✓ Bananen
```

---

## Adding Items to the Shopping List

When the user asks to add one or more items to the shopping list:

1. Use the google-docs MCP to read the current document (ID: `14yMNj3pvjPk0uDGYDEnCXSyQXJMgspBm2efW-XxZ1og`)
2. For each item to add:
   - Search existing lines for a case-insensitive match (with or without `✓ ` prefix)
   - If found **with** `✓ ` → remove the `✓ ` so the item becomes pending again (keep the bullet character)
   - If found **without** `✓ ` → already pending, no change needed
   - If not found → append as a **new bullet line** (e.g. `- Hafermilch`), one item per bullet, never combine items
3. Use the google-docs MCP to write the updated content back to the document

---

## Updating the Favorites Gist

If the user wants to add or change a favorite product:
1. Use GitHub MCP `get_gist` to read current favorites
2. Add/edit the relevant `| Suchbegriff | Produktname |` row
3. Use GitHub MCP `update_gist` with ID `c7fdebb823f5c3361116f8e2f96e7017` to save

---

## Error Handling

- **google-docs MCP unavailable:** Start a fresh conversation — google-docs is connected in Settings → Connectors
- **GitHub MCP unavailable:** Start a fresh conversation — GitHub is connected in Settings → Connectors (needed for favorites)
- **Item not in favorites, not found on Coop:** Suggest Swiss German alternatives (`Hafermilch` → `Haferdrink`, `Paprika` → `Peperoni`, `Zwiebeln` → `Zwiebel`)
- **MCP search (`search_coop`) returns no results:** Fall back to Claude in Chrome navigating `https://www.coop.ch/de/search/?q={item}` directly. If the MCP tool is unavailable, run `node ~/.claude/skills/coop-shopping-v2/scripts/search_coop.js '["item"]'` as a last resort.
- **Cart button missing:** Product may be out of stock or online-unavailable — inform user, skip item, do NOT mark ✓

---

## Notes

- Always process the full shopping list in one session — don't stop mid-list without marking progress
- Coop searches work best in German (`de`)
- The `search_coop.js` script uses only Node.js built-ins — no `npm install` needed
- Prices are in CHF
- Shopping list reads and writes use google-docs MCP only — never `web_fetch` for document content
- Favorites reads and writes use GitHub MCP only — never `web_fetch` for Gist content
