# BYTE / PayPerByte — Distribution-Surface & Discoverability Audit

**Date:** 2026-06-13
**Scope:** x402 distribution surfaces, MCP registries, agent-product directories, and package registries.
**Search terms probed on each surface:** `BYTE`, `PayPerByte`, `PPB`, `ppbyte`, `byte library`, `PayPerByte.io`, `Mark Zhurbin`.
**Method note:** Direct page fetches to most third-party hosts were blocked by this environment's network egress allowlist (only `registry.npmjs.org`, `registry.modelcontextprotocol.io`, and the GitHub API resolved directly). Findings below combine those authoritative API queries with external web-index searches.

---

## TL;DR

The brand is discoverable in **exactly two places**: the **npm package `byte-mcp-server`** and its **Glama** listing. Every other surface an agent (or a human evaluating the project) would check returns **nothing** — or worse, returns an unrelated "BYTE" project. The marketing domain (`payperbyte.io`), the founder name (`Mark Zhurbin`), and the brand strings `PayPerByte` / `PPB` / `ppbyte` have **near-zero search presence**. Separately, the package this repo ships (`byte-validator-agent`) is **not published to npm at all**, so its README install command is broken.

The single highest-leverage fix is publishing the MCP server to the **Official MCP Registry**, which fans out to most downstream clients and directories. The second is resolving a serious **brand-collision problem**: "BYTE" is already taken many times over (a meme token, a Virtuals agent, an exchange, ByteAI), so the unique, ownable, searchable name is **PayPerByte**, and it is not being used as the primary handle on any surface.

---

## 1. What the product is (context)

PayPerByte / "Byte Protocol" is a **per-byte data marketplace for AI agents** on Arbitrum, with x402 pay-per-call settlement. Agents discover data publishers, evaluate an on-chain **Proof-of-Quality Score (PQS)**, subscribe, and pay per request in USDC. Two code surfaces exist:

- **`byte-mcp-server`** — the agent-facing MCP server (13 tools: discover publishers, check PQS/reputation, subscribe, publish). Published to npm; listed on Glama. Publisher handle `ppbyte` (paperm2m@gmail.com).
- **`byte-validator-agent`** — *this repo*. Autonomous validator that scores publishers and submits PQS on-chain. **Not published anywhere.**

Founder/operator: Mark Zhurbin (consistent with the `zhnholdings` / `ppbyte` identities).

---

## 2. Surface-by-surface results

### A. x402 distribution surfaces

| Surface | What it is | BYTE/PayPerByte result |
|---|---|---|
| **x402.org/ecosystem** (Coinbase / x402 Foundation registry) | Canonical x402 ecosystem list, sourced from the `coinbase/x402` repo | **Absent.** Not in the ecosystem list; brand returns nothing. |
| **x402scan.com** (Merit Systems "ecosystem explorer") | Indexes *live on-chain x402 activity* + embedded-wallet access | **Absent from brand search.** Even if the Base-mainnet endpoint is live, it is not surfaced under any BYTE/PayPerByte query. |
| **x402-list.com** ("agent-first" directory, machine-readable JSON) | Agent-ready discovery directory | **Absent.** |
| **x402list.fun** (searchable services directory) | DeFi/AI/Data categories | **Absent.** |
| **awesome-x402** (Merit-Systems curated GitHub list) | Human-curated resource list | **Absent.** |
| **Onyx Bazaar** (15-min-refresh paid-service leaderboard) | Live leaderboard of paid x402 services | **Absent.** |
| **CoinGecko x402-ecosystem / CMC** | Token category | No PPB/PayPerByte token. **"BYTE" is already a crowded ticker** (meme "Byte", "BYTE by Virtuals", "ByteAI", Byte Exchange/BytePay). Direct **brand collision**. |

**Verdict:** zero presence on every x402 discovery surface. The npm description states settlement is "x402 … USDC on Base mainnet," so the endpoint may technically transact, but it is **not discoverable** on any x402 index.

### B. MCP surfaces

| Surface | BYTE/PayPerByte result |
|---|---|
| **Glama** (glama.ai/mcp) | ✅ **PRESENT** — "BYTE Protocol by 0rkz" → `0rkz/byte-mcp-server`. Listed as: per-byte data marketplace, discover publishers, evaluate PQS, subscribe & pay per request in USDC via x402; "13 tools, no API keys, live testnet." This is the **single best discovery asset** today. |
| **Official MCP Registry** (registry.modelcontextprotocol.io) | ❌ **ABSENT.** Query `payperbyte` → 0 results. Query `byte` → returns only the unrelated **ByteRay** (binary-vuln tool). This is the canonical registry that downstream clients/directories ingest — **biggest single gap.** |
| **Smithery** (smithery.ai) | ❌ Absent. |
| **PulseMCP** (pulsemcp.com, 18k+ servers) | ❌ Absent. |
| **mcp.so** | ❌ Absent. |
| **MCP Market** (mcpmarket.com) | ❌ Absent. |
| **Cursor Directory** (cursor.directory/mcp) | ❌ Absent. |

**Verdict:** present on **1 of 7** MCP surfaces (Glama only). These directories do **not** auto-sync with each other — each is a separate submission and a separate discovery funnel.

### C. Package registries

| Package | Status |
|---|---|
| **`byte-mcp-server`** (npm) | ✅ Published. v0.11.2 (2026-06-10), ~512 weekly / ~3,390 monthly downloads. Good keyword set: `mcp, model-context-protocol, byte-protocol, data-marketplace, ai-agents, arbitrum, depin, x402, agent-commerce`. Links homepage `payperbyte.io` + repo `0rkz/byte-mcp-server`. |
| **`byte-validator-agent`** (npm, *this repo*) | ❌ **NOT PUBLISHED (404).** The README instructs users to `npm install -g byte-validator-agent` — that command **fails**. Discoverability + credibility bug. |

### D. Raw brand-term web search

| Term | Result |
|---|---|
| `BYTE` | Meme tokens, exchanges, ByteByteGo, Byte Software. **Heavy collision; the project is invisible.** |
| `PayPerByte` | Nothing relevant; collides with "BytePay" / Byte Exchange. |
| `PayPerByte.io` | Domain **not indexed**; does not appear in results. |
| `PPB` | Payment/PPC noise. |
| `ppbyte` | Only the npm **publisher handle** surfaces. |
| `byte library` | Generic programming results. |
| `Mark Zhurbin` | **Zero results.** No founder/personal-brand footprint. |

---

## 3. New / recently-live surfaces worth targeting (last few weeks)

The agent-commerce stack has expanded fast; these are live and relevant:

- **Official MCP Registry** — now the canonical upstream that Smithery/PulseMCP/clients ingest. *Publish here first.*
- **x402 Foundation ecosystem + x402scan** — activity-indexed; driving real Base-mainnet x402 traffic gets you listed automatically.
- **AP2 (Google Agent Payments Protocol)** — v0.2.0 (Apr 2026), 60+ partners; the authorization layer above x402.
- **Stripe ACP** and **Visa TAP** — both now route x402; production reference implementations as of NRF 2026.
- **Circle Agent Stack** — built on x402; **23+ facilitators** now in the facilitator directory.
- **Onyx Bazaar** leaderboard, **x402-list**, **x402list.fun** — directories actively curating services.
- **Cloudflare x402** (Foundation co-founder) and **Solana x402** — relevant if/when cross-chain.

---

## 4. Discoverability recommendations (prioritized)

1. **Fix the broken npm install (trust bug).** Either publish `byte-validator-agent` to npm, or change the README so its install command actually works. A 404 on the headline command undermines every other channel.

2. **Publish the MCP server to the Official MCP Registry** (add a `server.json`). Highest leverage — it's the upstream most clients and directories read from. Currently the brand returns 0 results there.

3. **Submit `byte-mcp-server` to every MCP directory individually:** Smithery, PulseMCP, mcp.so, MCP Market, Cursor Directory, Docker MCP Catalog. They don't sync; each is a distinct funnel. Glama is already done — replicate that listing everywhere.

4. **Register on the x402 surfaces:** open a PR to add the service to `coinbase/x402` (ecosystem) and `Merit-Systems/awesome-x402`; list on x402-list.com, x402list.fun, and Onyx Bazaar; ensure the Base-mainnet x402 endpoint actually transacts so **x402scan** indexes it. Confirm the project is registered with an x402 facilitator (so it appears in the 23+ facilitator directory).

5. **Resolve the brand collision — lead with "PayPerByte," not "BYTE."** "BYTE" is unwinnable in search (token/exchange/agent collisions). Make **PayPerByte** the primary, searchable handle in every title and description: e.g. *"PayPerByte (Byte Protocol) — per-byte data marketplace for agents."* Keep a distinctive secondary keyword (PQS / Proof-of-Quality, per-byte data marketplace) that nothing else owns.

6. **Fix version/documentation drift across surfaces.** The Glama-indexed README still says *Arbitrum Sepolia testnet* and a clone of `github.com/byte-protocol/mcp-server` with a manual `claude mcp add … node /path/...`; npm v0.11.2 says *Base mainnet* x402 and points to `0rkz/byte-mcp-server`. Agents and humans currently get **inconsistent, partly-broken install paths**. Standardize on a single `npx byte-mcp-server` flow and **refresh the README so Glama re-indexes the corrected version.**

7. **Make the owned surfaces crawlable.** `payperbyte.io` isn't indexed at all. Add a sitemap, public docs, schema.org `SoftwareApplication` markup, and an **`llms.txt` / `agents.json` / `/.well-known/` x402 manifest** so both search engines and agents can auto-discover the endpoint and its pricing. Establish minimal founder presence (GitHub profile, one canonical "About PayPerByte / Mark Zhurbin" page) so the name resolves to something.

8. **Cross-link the assets.** Add GitHub repo topics; link npm ↔ repo ↔ payperbyte.io ↔ Glama ↔ MCP Registry in every direction so crawlers connect them into one entity instead of orphaned pages.

---

## 5. Coverage scorecard

| Category | Surfaces present | Surfaces checked |
|---|---|---|
| x402 directories/explorers | 0 | 6 |
| MCP registries | 1 (Glama) | 7 |
| Package registries | 1 (`byte-mcp-server`) / 1 broken (`byte-validator-agent`) | 2 |
| Owned web (site, founder, brand SEO) | 0 | — |

**Net:** the product is essentially undiscoverable except to someone already searching the exact npm package name. Fixing items 1–3 (publish validator/registry + fan out to MCP directories) and item 5 (brand on PayPerByte) would move it from ~2 surfaces to ~15 with mostly low-effort submissions.
