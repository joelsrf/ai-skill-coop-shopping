# coop-shopping-v2

A Claude Code skill that automates grocery shopping on [coop.ch](https://www.coop.ch).

## What it does

1. Reads your shopping list from a private GitHub Gist
2. Matches items against a favorites Gist (preferred products you've saved)
3. Searches coop.ch for unmatched items via the Brave Search API
4. Presents a shopping plan and asks you to confirm/choose products
5. Adds items to your Coop cart using Claude in Chrome (your authenticated browser session)
6. Marks completed items with ✓ in the shopping list Gist

## Setup

### Requirements

- [Claude Code](https://claude.ai/claude-code) with the `coop-shopping-v2` skill installed
- GitHub MCP connector active (Settings → Connectors)
- `local-scripts` MCP server running (see `~/.claude/mcp-local/`)
- A Brave Search API key → set in `.env`:
  ```
  BRAVE_API_KEY=your-key-here
  ```
- An authenticated Coop account in Chrome (for adding to cart)

### Gists

| Role | Gist |
|---|---|
| Shopping list | `gist.github.com/joelsrf/6ff611328971438a2bc2cafb44119536` |
| Favorites | `gist.github.com/joelsrf/c7fdebb823f5c3361116f8e2f96e7017` |

The **shopping list** is a plain text file, one item per line. Lines prefixed with `✓` are done, `#` are comments.

The **favorites** file is a Markdown table mapping search terms to preferred product names:

```markdown
| Suchbegriff | Bevorzugtes Produkt |
|---|---|
| Bananen | Naturaplan Bio Fairtrade Bananen ca. 1kg |
| Hafermilch | Prix Garantie Haferdrink Vitamine & Calcium |
```

## How search works

Coop.ch uses DataDome bot protection, so direct API calls are blocked. Search priority:

1. **Favorites lookup** — instant, no API call
2. **`search_coop` MCP tool** — queries Brave Search API with `site:coop.ch {item}`
3. **Claude in Chrome** — browser fallback if MCP returns no results

## Files

```
scripts/
  search_coop.js   Node.js script called by the MCP server to search coop.ch
SKILL.md           Skill instructions loaded by Claude Code
.env               API keys (not committed)
```

## Usage

Just tell Claude: *"mach meinen Coop Einkauf"* or *"do my Coop shopping"*.
