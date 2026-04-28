# Market Intelligence Dashboard — Project Summary

## Overview
An automated daily market intelligence system for an iGaming slot game studio. Tracks crypto iGaming, sweepstakes casino markets, and competitor slot releases. Delivers a live web dashboard and Slack notifications every morning at 7am AWST.

**Live URL:** https://our-intel.com
**Repository:** https://github.com/Spradz/market-intel
**Local files:** `~/projects/market-intel/dashboard/`

---

## Architecture

### Three Automated Scrapers
All scripts use Claude API (`claude-opus-4-7`) with web search tool. Node v20.20.2 required (v16 lacks global fetch).

| Script | Schedule | Slack Channel | Log |
|--------|----------|---------------|-----|
| `scrape_crypto.js` | Daily 07:00 AWST | `#igaming-intel` | `logs/crypto.log` |
| `scrape_sweeps.js` | Daily 07:15 AWST | `#sweepstakes-intel` | `logs/sweeps.log` |
| `scrape_slots.js` | Weekly Monday 07:30 AWST | None (dashboard only) | `logs/slots.log` |

### Dashboard (`index.html`)
Static HTML — reads `./data/brief.json` on load. No server required. Hosted on GitHub Pages.

### Data File (`data/brief.json`)
Written by scrapers after each run. Contains four keys: `crypto`, `sweepstakes`, `slots`, `generatedAt`.
**Important:** Each scraper preserves all existing keys when writing — crypto preserves sweepstakes+slots, sweeps preserves crypto+slots, slots preserves crypto+sweepstakes.

### Auto-Deploy
Sweeps and slots cron jobs automatically `git push` after writing `brief.json` so the live dashboard updates without manual intervention. Crypto scraper does not push (sweeps runs 15 minutes later and pushes both).

---

## Environment Setup

### .env file
Location: `~/projects/market-intel/dashboard/.env`
- Plain ASCII only — no comments, no Unicode (breaks `source`)
- Self-loaded via `dotenv` package — no manual sourcing needed

Required variables:
```
ANTHROPIC_API_KEY=...
SLACK_WEBHOOK_CRYPTO=...
SLACK_WEBHOOK_SWEEP=...
SLACK_WEBHOOK_SLOTS=...   # optional — slots scraper skips Slack if not set
```

### Node
- Version: v20.20.2 via nvm
- Path: `/Users/sprads/.nvm/versions/node/v20.20.2/bin/node`
- All cron jobs use explicit full path

### Cron (crontab -e to edit)
```
0 23 * * *   # crypto — 07:00 AWST
15 23 * * *  # sweeps + git push — 07:15 AWST
30 23 * * 0  # slots + git push — 07:30 AWST Monday
```

---

## Dashboard Sections

### Top — Summary Cards
Two cards (Crypto / Sweepstakes) showing headline and 2-3 sentence summary for the day.

### Left Column — Crypto iGaming
- Expandable story cards (click to reveal detail + business impact)
- Watchlist
- Tanzanite deposit volume link button (site blocks embedding — links to tanzanite.xyz/centralized/volume)

### Right Column — Sweepstakes
- Expandable story cards
- Key Players table: Operator / Parent Company / Est. Annual Revenue / Trend
- Market Share pie chart (SVG, no libraries) — labelled slices, AI-estimated disclaimer
- Emerging Markets table: Market / Status / Notes
- Watchlist

### Full Width — Competitor Slot Releases
- Weekly table: Game / Provider / Launch Date / Market / Key Features
- Priority providers starred (★)
- Market column: `.com`, `Sweeps`, `Both`, `Unknown` — only populated when source explicitly confirms

---

## Scraper Configuration

### Crypto Scraper Sources
- General web search
- tanzanite.xyz/centralized/volume (deposit volume trends)
- 30-day recency window enforced

### Sweeps Scraper
**Priority operators** (always included): Stake.us, Shuffle

**Portfolio operators tracked:**
- ARB Gaming / Casimba / Paranagames
- YSI group brands: McLuck, Ace, Spindoo, Pulsz, Jackpot, Megabonanza, Spree, Patbit, Cardcrush
- CrownCoins (parent: Sunflower)
- High5 / Legendz / Monotech / Plaee / Lonestar

**Priority sources:**
- sweepchecker.com — operator status and ratings
- next.io/win/us/ — player stats and growth reports (e.g. Stake.us monthly highlights)
- ekgamingllc.com — EKG research citations
- slotslaunch.com

**Key rules:**
- 30-day recency window
- Trend only assigned when backed by a specific source — state exits alone do not = Contracting
- Any country in an Emerging Markets story MUST appear in emergingMarkets array
- Market share: CrownCoins/Sunflower and Stake.us always included

### Slots Scraper
**Sources:** slotslaunch.com/calendar, slotcatalog.com/en/New-Slots, pragmaticplay.com/en/games/

**Priority providers:** Pragmatic Play, PG Soft, Jili/Tada, 3 Oaks Gaming, Playson, Hacksaw Gaming, No Limit City, Fat Panda, Spribe, Fat Chai

**Rules:**
- All titles per provider — no one-per-provider limit
- Market field maps: RMG/.com → `.com` | Sweeps/Sweepstakes/Social → `Sweeps` | confirmed both → `Both` | else `Unknown`
- 7-day recency window

---

## GitHub

- **Repo:** https://github.com/Spradz/market-intel
- **Pages:** Enabled — source: main branch, root folder
- **Token:** Personal Access Token (repo scope) stored in Mac keychain
- **Push manually:** `git add -A && git commit -m "message" && git push` from dashboard folder

---

## Known Issues & Fixes Applied

| Issue | Fix |
|-------|-----|
| Node v16 lacks global fetch — scripts failed | Upgraded to Node v20.20.2, updated all cron paths |
| max_tokens 4096 too low — model returned incomplete tool calls | Raised to 8192 on all scrapers |
| Sweeps/crypto scrapers not preserving slots data on write | Fixed writeBrief in all three scrapers to preserve all keys |
| Dashboard not auto-updating (required manual git push) | Added git add/commit/push to sweeps and slots cron jobs |
| Tanzanite.xyz blocks iframe embedding | Replaced with direct link button |
| Headline not matching top story | Prompt updated — headline must derive from first story |
| Trend inferred from state exits (false Contracting) | Prompt rule added — state exits alone don't = Contracting |
| Emerging markets story not cross-populating table | Prompt consistency rule added |

---

## Pending / Future Work

- [ ] **Font contrast** — body text (#E8E8EE on #0C0F1A) could be brighter for readability
- [x] **Custom domain** — our-intel.com live on HTTPS via Cloudflare DNS + GitHub Pages
- [ ] **Trend column validation** — currently inference-based; will improve as next.io + sweepchecker data flows through
- [ ] **Pie chart data accuracy** — AI-estimated; will improve as EKG citations and operator filings surface
- [ ] **Cloud scheduler** — move cron to GitHub Actions so scraper runs even if Mac is offline

---

## Costs

- **Anthropic API** — ~$0.50–$1.50 per daily run (Opus + web search). Monitor at console.anthropic.com → Billing. Set a spend alert to avoid silent scraper failures.
- **GitHub Pages** — free
- **Slack webhooks** — free

---

## How to Modify

**Change scraping focus or add operators:**
Edit the `PROMPT` constant in the relevant scraper. No other changes needed — scraper picks up on next run.

**Add a new data field to the dashboard:**
1. Add field to `SUBMIT_TOOL` input_schema in the scraper
2. Add render function in `index.html`
3. Wire into `render()` function
4. Add demo data to `DEMO_DATA` in `index.html`

**Run a scraper manually:**
```bash
source ~/.nvm/nvm.sh && nvm use 20
cd ~/projects/market-intel/dashboard
node scrape_crypto.js    # or scrape_sweeps.js / scrape_slots.js
```
Then push: `git add -A && git commit -m "Manual run" && git push`

**If Mac was offline and cron missed:**
Run the scrapers manually as above. The dashboard will update on next push.
