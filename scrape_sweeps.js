#!/usr/bin/env node
/**
 * SWEEPSTAKES MARKET INTELLIGENCE
 * Claude Code automation script
 *
 * Usage:
 *   node scrape_sweeps.js
 *
 * Environment variables required (set in .env or shell):
 *   ANTHROPIC_API_KEY    — your Anthropic API key
 *   SLACK_WEBHOOK_SWEEP  — incoming webhook URL for #sweepstakes-intel
 *
 * Output:
 *   - Writes ./data/brief.json (merged with crypto data if present)
 *   - Posts a formatted Slack notification to #sweepstakes-intel
 *
 * Schedule (cron — runs 07:15 AWST / 23:15 UTC previous day, staggered from crypto):
 *   15 23 * * * cd ~/projects/market-intel/dashboard && node scrape_sweeps.js >> logs/sweeps.log 2>&1
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ──────────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, "data");
const BRIEF_FILE = path.join(DATA_DIR, "brief.json");

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_SWEEP;
const SLACK_CHANNEL = process.env.SLACK_SWEEP_CHANNEL || "#sweepstakes-intel";

if (!ANTHROPIC_KEY) { console.error("❌  ANTHROPIC_API_KEY not set"); process.exit(1); }
if (!SLACK_WEBHOOK) { console.error("❌  SLACK_WEBHOOK_SWEEP not set"); process.exit(1); }

// ── PROMPT ───────────────────────────────────────────────────────────────────
const TODAY = new Date().toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

const PROMPT = `You are a senior gambling and social gaming analyst specialising in sweepstakes casino markets. Today is ${TODAY}.

Search the web for the latest intelligence on the US sweepstakes casino market and any other emerging sweepstakes markets globally. Cover:
- Key players and their estimated annual turnovers (VGW/Chumba, High 5, McLuck, Pulsz, Stake.us, WOW Vegas, Fortune Coins, Global Poker, etc.)
- Projected revenue growth or contraction
- Regulatory concerns: state AG investigations, legislative threats, court rulings, bill filings
- New market entrants or operators pivoting to a sweepstakes model
- Emerging markets outside the US (Canada, Australia, Brazil, UK grey area, etc.)
- M&A activity, funding rounds, notable partnerships
- Consumer protection news: player complaints, chargebacks, payment processor changes
- Industry advocacy or lobbying efforts

Return ONLY a JSON object — no markdown fences, no preamble:
{
  "headline": "one punchy ≤12-word headline for the day's biggest story",
  "summary": "2-3 sentence executive overview of today's key themes",
  "stories": [
    {
      "title": "story title",
      "category": "one of: Regulatory | Revenue & Growth | Key Players | Emerging Markets | M&A | Consumer",
      "impact": "one of: High | Medium | Low",
      "customer": "operator or segment name, e.g. 'VGW' or 'All Sweepstakes Operators'",
      "body": "3-4 sentence story summary",
      "businessImpact": "1-2 sentence analysis of material impact to a slot game studio or content distributor",
      "source": "publication name"
    }
  ],
  "keyPlayers": [
    {
      "name": "operator name",
      "revenue": "estimated annual figure or range",
      "trend": "one of: Growing | Stable | Contracting | Unknown"
    }
  ],
  "watchlist": ["2-4 short strings — regulatory or market risks to monitor this week"]
}
Return 4-6 stories and 4-6 key players. JSON only.`;

// ── FETCH INTELLIGENCE ───────────────────────────────────────────────────────
async function fetchSweepsIntel() {
  console.log(`[${new Date().toISOString()}] 🔍  Fetching Sweepstakes intelligence…`);

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: PROMPT }]
  });

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) throw new Error("No text block in response");

  let raw = textBlock.text.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

  return JSON.parse(raw);
}

// ── WRITE JSON ───────────────────────────────────────────────────────────────
function writeBrief(sweepsData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let existing = {};
  if (fs.existsSync(BRIEF_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8")); } catch {}
  }

  const brief = {
    generatedAt: new Date().toISOString(),
    crypto: existing.crypto || null,
    sweepstakes: sweepsData
  };

  fs.writeFileSync(BRIEF_FILE, JSON.stringify(brief, null, 2));
  console.log(`[${new Date().toISOString()}] ✅  Brief written to ${BRIEF_FILE}`);
}

// ── SLACK NOTIFICATION ───────────────────────────────────────────────────────
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
      const arrow = p.trend === "Growing" ? "↑" : p.trend === "Contracting" ? "↓" : "→";
      return `• *${p.name}* — ${p.revenue} ${arrow} ${p.trend}`;
    })
    .join("\n");

  const watchlistText = (data.watchlist || []).map(w => `• ${w}`).join("\n");

  const payload = {
    text: `◉ *Sweepstakes Markets Brief — ${TODAY}*`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `◉ Sweepstakes Markets Brief · ${TODAY}`, emoji: true }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${data.headline}*\n${data.summary}` }
      },
      { type: "divider" },
      ...storyBlocks,
      ...(playersText ? [
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Key Players — Revenue Snapshot*\n${playersText}` }
        }
      ] : []),
      ...(watchlistText ? [
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*⚑ Watch This Week*\n${watchlistText}` }
        }
      ] : []),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Automated via Claude Code · ${new Date().toISOString()}` }]
      }
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

// ── MAIN ─────────────────────────────────────────────────────────────────────
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
