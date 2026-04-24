#!/usr/bin/env node
/**
 * SWEEPSTAKES MARKET INTELLIGENCE
 * Claude Code automation script
 *
 * Schedule (cron — runs 07:15 AWST / 23:15 UTC):
 *   15 23 * * * cd ~/projects/market-intel/dashboard && node scrape_sweeps.js >> logs/sweeps.log 2>&1
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR   = path.join(__dirname, "data");
const BRIEF_FILE = path.join(DATA_DIR, "brief.json");

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_SWEEP;
const SLACK_CHANNEL = process.env.SLACK_SWEEP_CHANNEL || "#sweepstakes-intel";

if (!ANTHROPIC_KEY) { console.error("❌  ANTHROPIC_API_KEY not set"); process.exit(1); }
if (!SLACK_WEBHOOK) { console.error("❌  SLACK_WEBHOOK_SWEEP not set"); process.exit(1); }

const TODAY = new Date().toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

const PROMPT = `You are a senior gambling and social gaming analyst specialising in sweepstakes casino markets. Today is ${TODAY}.

Search the web for the latest intelligence on the US sweepstakes casino market and any other emerging sweepstakes markets globally. Priority sources to check first:
- https://sweepchecker.com — operator tracking, ratings, and status changes
- https://next.io/win/us/ — latest US sweepstakes operator news, player stats, and growth reports (e.g. Stake.us publishes monthly player highlights here)
- https://ekgamingllc.com — Eilers & Krejcik Gaming research; also search for any news articles citing EKG data or reports on sweepstakes market size and operator revenue
- https://slotslaunch.com — for any sweepstakes-specific game launches
- General news search for each operator

PRIORITY OPERATORS — search for these first and always include them in keyPlayers if any data exists:
- Stake.us
- Shuffle

PORTFOLIO OPERATORS — search for current revenue data and news on each:
- ARB Gaming
- Casimba
- Paranagames
- The following brands are understood to share a common parent company — identify the parent through your research: McLuck, Ace, Spindoo, Pulsz, Jackpot, Megabonanza, Spree, Patbit, Cardcrush
- CrownCoins (parent company: Sunflower)
- High5
- Legendz
- Monotech
- Plaee
- Lonestar

RECENCY RULES — strictly enforce:
- Only include stories and revenue data published within the last 30 days from today (${TODAY})
- If a story is older than 30 days, discard it unless it is actively shaping a current event (e.g. a court case still in progress, a law that just took effect)
- If referencing an older event for context, clearly state it is background — do not present it as current news
- If no fresh stories exist for a topic, omit that topic rather than filling with dated content

RESEARCH COVERAGE:
- Revenue estimates for all operators above — only if sourced from content published in the last 30 days
- Projected revenue growth or contraction
- Regulatory concerns: state AG investigations, legislative threats, court rulings, bill filings
- New market entrants or operators pivoting to a sweepstakes model
- Emerging markets outside the US (Canada, Australia, Brazil, UK grey area, etc.)
- M&A activity, funding rounds, notable partnerships
- Consumer protection news: player complaints, chargebacks, payment processor changes
- Industry advocacy or lobbying efforts

KEY PLAYERS OUTPUT RULES:
- Sort by estimated annual revenue, largest first
- Always include Stake.us and Shuffle regardless of news volume
- Where the brand name differs from the parent/holding company, set name = brand and parent = holding company
- Only use revenue figures sourced from content published in the last 30 days — if no recent data exists set revenue to "No current data found" and trend to "Unknown"
- Only assign trend as Growing, Stable, or Contracting when you have a specific source to back it up (e.g. funding news, revenue filing, player growth stats) — otherwise use "Unknown"
- Do not infer Contracting purely from state-level exits — an operator can exit certain states while growing overall revenue and player base. Look for actual revenue or player growth data before assigning a trend.

MARKET SHARE — when estimating operator share:
- CrownCoins (Sunflower) and Stake.us are understood to be among the largest operators — prioritise finding current data on both
- Do not omit either from the marketShare array even if exact figures are unavailable — use best available estimates with a clear basis note
- Sort by estimated share, largest first

EMERGING MARKETS — search specifically for:
- Sweepstakes or social casino activity in countries outside the US and Canada
- Operators entering Germany or Australia based on legal opinion that the sweepstakes model falls outside local gambling law — search for this explicitly
- Any jurisdiction exploring, regulating, or restricting the sweepstakes model
- Operators entering or exiting non-US markets
- Regulatory signals from Australia, Brazil, UK, EU, Latin America, Asia-Pacific

IMPORTANT — data consistency rule: every country or region mentioned in any story that has category "Emerging Markets" MUST also appear as an entry in the emergingMarkets array. Do not write an emerging markets story about a country and then omit it from the emergingMarkets table. Canada must always be included if there is any active story about it.

After researching, call the submit_intelligence function with 4-6 stories, all relevant key players, a market share estimate, and any emerging market developments.`;

const SUBMIT_TOOL = {
  name: "submit_intelligence",
  description: "Submit the compiled sweepstakes market intelligence report",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One punchy ≤12-word headline taken directly from the title of your first (highest-impact) story" },
      summary:  { type: "string", description: "2-3 sentence executive overview of today's key themes" },
      stories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:          { type: "string" },
            category:       { type: "string", enum: ["Regulatory","Revenue & Growth","Key Players","Emerging Markets","M&A","Consumer"] },
            impact:         { type: "string", enum: ["High","Medium","Low"] },
            customer:       { type: "string" },
            body:           { type: "string" },
            businessImpact: { type: "string" },
            source:         { type: "string" }
          },
          required: ["title","category","impact","body","source"]
        }
      },
      keyPlayers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:    { type: "string", description: "Brand name" },
            parent:  { type: "string", description: "Parent or holding company name if different from brand" },
            revenue: { type: "string" },
            trend:   { type: "string", enum: ["Growing","Stable","Contracting","Unknown"] }
          },
          required: ["name","revenue","trend"]
        }
      },
      marketShare: {
        type: "array",
        description: "Estimated US sweepstakes market share by operator — percentages should sum to ~100",
        items: {
          type: "object",
          properties: {
            operator: { type: "string" },
            sharePercent: { type: "number", description: "Estimated % of total market" },
            basis: { type: "string", description: "Brief note on what the estimate is based on" }
          },
          required: ["operator", "sharePercent"]
        }
      },
      emergingMarkets: {
        type: "array",
        description: "Sweepstakes activity or regulatory developments in markets outside the US and Canada",
        items: {
          type: "object",
          properties: {
            market:  { type: "string", description: "Country or region" },
            status:  { type: "string", enum: ["Active", "Exploring", "Restricted", "Banned", "Watching"] },
            notes:   { type: "string", description: "1-2 sentence summary of what is happening" }
          },
          required: ["market", "status", "notes"]
        }
      },
      watchlist: { type: "array", items: { type: "string" } }
    },
    required: ["headline","summary","stories","keyPlayers","watchlist"]
  }
};

async function fetchSweepsIntel() {
  console.log(`[${new Date().toISOString()}] 🔍  Fetching Sweepstakes intelligence…`);

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    tools: [{ type: "web_search_20250305", name: "web_search" }, SUBMIT_TOOL],
    messages: [{ role: "user", content: PROMPT }]
  });

  const toolUse = response.content.find(b => b.type === "tool_use" && b.name === "submit_intelligence");
  if (!toolUse) throw new Error("Model did not call submit_intelligence — no structured data returned");

  return toolUse.input;
}

function writeBrief(sweepsData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let existing = {};
  if (fs.existsSync(BRIEF_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8")); } catch {}
  }

  fs.writeFileSync(BRIEF_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    crypto: existing.crypto || null,
    sweepstakes: sweepsData,
    slots: existing.slots || null
  }, null, 2));
  console.log(`[${new Date().toISOString()}] ✅  Brief written to ${BRIEF_FILE}`);
}

async function postToSlack(data) {
  const impactEmoji   = { High: "🔴", Medium: "🟡", Low: "🟢" };
  const categoryEmoji = {
    "Regulatory": "⚖️", "Revenue & Growth": "📊", "Key Players": "◉",
    "Emerging Markets": "🌐", "M&A": "🤝", "Consumer": "👤"
  };

  const storyBlocks = (data.stories || []).map(s => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: [
        `${impactEmoji[s.impact] || "⚪"} *${s.title}*`,
        `_${categoryEmoji[s.category] || "•"} ${s.category}_ · ${s.customer || "—"}`,
        s.body,
        s.businessImpact ? `> ⚑ *Business impact:* ${s.businessImpact}` : "",
        `_Source: ${s.source}_`
      ].filter(Boolean).join("\n")
    }
  }));

  const playersText = (data.keyPlayers || [])
    .map(p => {
      const arrow = p.trend === "Growing" ? "↑" : p.trend === "Contracting" ? "↓" : p.trend === "Unknown" ? "?" : "→";
      const parentStr = p.parent ? ` _(${p.parent})_` : "";
      return `• *${p.name}*${parentStr} — ${p.revenue} ${arrow} ${p.trend}`;
    }).join("\n");

  const watchlistText = (data.watchlist || []).map(w => `• ${w}`).join("\n");

  const payload = {
    text: `◉ *Sweepstakes Markets Brief — ${TODAY}*`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `◉ Sweepstakes Markets Brief · ${TODAY}`, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${data.headline}*\n${data.summary}` } },
      { type: "divider" },
      ...storyBlocks,
      ...(playersText ? [{ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: `*Key Players — Revenue Snapshot*\n${playersText}` } }] : []),
      ...(watchlistText ? [{ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: `*⚑ Watch This Week*\n${watchlistText}` } }] : []),
      { type: "context", elements: [{ type: "mrkdwn", text: `Automated via Claude Code · ${new Date().toISOString()}` }] }
    ]
  };

  const res = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`Slack post failed: ${res.status} ${await res.text()}`);
  console.log(`[${new Date().toISOString()}] 📨  Posted to Slack (${SLACK_CHANNEL})`);
}

(async () => {
  try {
    const data = await fetchSweepsIntel();
    writeBrief(data);
    await postToSlack(data);
    console.log(`[${new Date().toISOString()}] ✅  Sweepstakes job complete`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌  Error:`, err.message);
    process.exit(1);
  }
})();
