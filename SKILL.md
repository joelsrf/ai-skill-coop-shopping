---
name: coop-shopping-v2
description: Read a grocery shopping list from a GitHub Gist using the GitHub MCP, match items against a favorites list (also a GitHub Gist), auto-select the favorite product if found, otherwise search coop.ch and show top results. Mark items as ✓ done in the shopping list Gist once added to cart. Use this skill whenever the user wants to shop at Coop, find Coop products, search coop.ch for grocery items, fill their Coop cart, check or update their shopping list, or sync the shopping list after adding items to cart. Trigger even if the user just says "do my Coop shopping", "find my groceries on Coop", or "update my shopping list".
---

# Coop Shopping Skill

Reads a grocery shopping list from a **GitHub Gist**, matches each item against a **favorites Gist**, auto-selects the preferred product when found, falls back to coop.ch search otherwise, and marks items `✓` done after cart addition.

## Gist Configuration

| Role | Gist ID | URL |
|---|---|---|
| Shopping list | `6ff611328971438a2bc2cafb44119536` | https://gist.github.com/joelsrf/6ff611328971438a2bc2cafb44119536 |
| Favorites | `c7fdebb823f5c3361116f8e2f96e7017` | https://gist.github.com/joelsrf/c7fdebb823f5c3361116f8e2f96e7017 |

**Requirement:** GitHub MCP connector must be active. It is already connected in Settings → Connectors. Start a fresh conversation if GitHub tools are unavailable.

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
1. Read shopping list Gist (GitHub MCP)
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
6. After ALL items added: update shopping list Gist once via GitHub MCP
```

---

## Step 1: Read Shopping List Gist

Use GitHub MCP `get_gist` with ID: `6ff611328971438a2bc2cafb44119536`

Parse file content line by line:
- Lines starting with `✓` → already done, **skip**
- Lines starting with `#` → comments, **skip**
- Blank lines → **skip**
- All other lines → **pending items**

Note the exact filename — needed for the update step.

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

Show top 3 results per unknown item and ask the user to pick.

**Only use Claude in Chrome (browser) as fallback** when the MCP search returns no results for an item — navigate directly to `https://www.coop.ch/de/search/?q={item}` to find the product manually.

---

## Step 4: Present the Shopping Plan

Show a clear summary before starting cart operations:

```
📋 Einkaufsplan — 5 Artikel

✨ Favoriten (werden automatisch hinzugefügt):
  • Hafermilch → Prix Garantie Haferdrink Vitamine & Calcium
  • Bananen → Naturaplan Bio Fairtrade Bananen ca. 1kg
  • Eier → Naturaplan Bio Eier Freilandhaltung Schweiz

❓ Keine Favoriten — bitte auswählen:
  • Pasta
    1. Barilla Spaghetti n°5 500g — CHF 1.80
    2. Coop Bio Pasta Spaghetti 500g — CHF 2.50
    3. De Cecco Spaghetti n°12 500g — CHF 3.20
```

Once the user confirms / selects options for unknowns, proceed to cart.

---

## Step 5: Add to Cart via Claude in Chrome

For each item, use the **product URL** returned by the search script (faster and more reliable than searching again):

1. Navigate directly to the product URL: `https://www.coop.ch/de/p/{productId}`
   - For favorites (no search result URL available): fall back to `https://www.coop.ch/de/search/?q={exact product name}`
2. Find and click "In den Warenkorb" / "Zum Warenkorb hinzufügen"
3. Confirm item was added (page feedback or cart counter update)
4. Track successfully added items in memory for the Gist update in Step 6

---

## Step 6: Mark ✓ Done in Shopping List Gist (single update)

After ALL items have been added to cart, do **one** Gist update:

1. Use GitHub MCP `get_gist` (ID: `6ff611328971438a2bc2cafb44119536`) to get the latest content
2. For each successfully added item, prepend `✓ ` to its line (case-insensitive match)
3. Use GitHub MCP `update_gist` once with the fully updated content:
   - Gist ID: `6ff611328971438a2bc2cafb44119536`
   - Filename: same as fetched (preserve exact filename)
   - Content: full updated text with all ✓ marks applied

Example:
```
Before: Hafermilch       After: ✓ Hafermilch
Before: Bananen          After: ✓ Bananen
```

---

## Updating the Favorites Gist

If the user wants to add or change a favorite product:
1. Use GitHub MCP `get_gist` to read current favorites
2. Add/edit the relevant `| Suchbegriff | Produktname |` row
3. Use GitHub MCP `update_gist` with ID `c7fdebb823f5c3361116f8e2f96e7017` to save

---

## Error Handling

- **GitHub MCP unavailable:** Start a fresh conversation — GitHub is connected in Settings → Connectors
- **Item not in favorites, not found on Coop:** Suggest Swiss German alternatives (`Hafermilch` → `Haferdrink`, `Paprika` → `Peperoni`, `Zwiebeln` → `Zwiebel`)
- **MCP search (`search_coop`) returns no results:** Fall back to Claude in Chrome navigating `https://www.coop.ch/de/search/?q={item}` directly. If the MCP tool is unavailable, run `node ~/.claude/skills/coop-shopping-v2/scripts/search_coop.js '["item"]'` as a last resort.
- **Cart button missing:** Product may be out of stock or online-unavailable — inform user, skip item, do NOT mark ✓

---

## Notes

- Always process the full shopping list in one session — don't stop mid-list without marking progress
- Coop searches work best in German (`de`)
- The `search_coop.js` script uses only Node.js built-ins — no `npm install` needed
- Prices are in CHF
- All Gist reads and writes use GitHub MCP only — never `web_fetch` for Gist content
