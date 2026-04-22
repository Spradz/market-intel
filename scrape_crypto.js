#!/usr/bin/env node
/**
 * CRYPTO IGAMING MARKET INTELLIGENCE
 * Claude Code automation script
 *
 * Usage:
 *   node scrape_crypto.js
 *
 * Environment variables required (set in .env or shell):
 *   ANTHROPIC_API_KEY      — your Anthropic API key
 *   SLACK_WEBHOOK_CRYPTO   — incoming webhook URL for #igaming-intel
 *
 * Output:
 *   - Writes ./data/brief.json (merged with sweeps data if present)
 *   - Posts a formatted Slack notification to #igaming-intel
 *
 * Schedule (cron — runs 07:00 AWST / 23:00 UTC previous day):
 *   0 23 * * * cd ~/projects/market-intel/dashboard && node scrape_crypto.js >> logs/crypto.log 2>&1
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
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_CRYPTO;
const SLACK_CHANNEL = process.env.SLACK_CRYPTO_CHANNEL || "#igaming-intel";

if (!ANTHROPIC_KEY) { console.error("❌  ANTHROPIC_API_KEY not set"); process.exit(1); }
if (!SLACK_WEBHOOK) { console.error("❌  SLACK_WEBHOOK_CRYPTO not set"); process.exit(1); }

// ── PROMPT ───────────────────────────────────────────────────────────────────
const TODAY = new Date().toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

const PROMPT = `You are a senior iGaming industry analyst. Today is ${TODAY}.

Search the web for the latest news across the Crypto iGaming market. Cover:
- Regulatory developments affecting crypto gambling operators globally
- Major platform launches, acquisitions, or partnerships
- Key operator moves (Stake, Rollbit, BC.Game, Roobet, Shuffle, Duelbits, etc.)
- Aggregator or provider deal news in the crypto-friendly B2B space
- Market trends, player acquisition shifts, or blockchain/token integrations
- Enforcement actions, licensing changes, or country-level restrictions
- Noteworthy industry conference or event news (ICE, SiGMA, etc.)

Return ONLY a JSON object — no markdown fences, no preamble:
{
  "headline": "one punchy ≤12-word headline for the day's biggest story",
  "summary": "2-3 sentence executive overview of today's key themes",
  "stories": [
    {
      "title": "story title",
      "category": "one of: Regulatory | M&A | Product | Market Trend | Enforcement | Industry Event",
      "impact": "one of: High | Medium | Low",
      "customer": "operator segment affected, e.g. 'Aggregator Partners' or 'LatAm Operators'",
      "body": "3-4 sentence story summary",
      "businessImpact": "1-2 sentence analysis of material impact to a slot game studio or aggregator",
      "source": "publication name"
    }
  ],
  "watchlist": ["2-4 short strings — things to monitor this week"]
}
Return 4-6 stories. JSON only.`;

// ── FETCH INTELLIGENCE ───────────────────────────────────────────────────────
async function fetchCryptoIntel() {
  console.log(`[${new Date().toISOString()}] 🔍  Fetching Crypto iGaming intelligence…`);

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
function writeBrief(cryptoData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let existing = {};
  if (fs.existsSync(BRIEF_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8")); } catch {}
  }

  const brief = {
    generatedAt: new Date().toISOString(),
    crypto: cryptoData,
    sweepstakes: existing.sweepstakes || null
  };

  fs.writeFileSync(BRIEF_FILE, JSON.stringify(brief, null, 2));
  console.log(`[${new Date().toISOString()}] ✅  Brief written to ${BRIEF_FILE}`);
}

// ── SLACK NOTIFICATION ───────────────────────────────────────────────────────
async function postToSlack(data) {
  const impactEmoji = { High: "🔴", Medium: "🟡", Low: "🟢" };
  const categoryEmoji = {
    "Regulatory": "⚖️", "M&A": "🤝", "Product": "🔷",
    "Market Trend": "📈", "Enforcement": "⚡", "Industry Event": "🎪"
  };

  const storyBlocks = (data.stories || []).map(s => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: [
        `${impactEmoji[s.impact] || "⚪"} *${s.title}*`,
        `_${categoryEmoji[s.category] || "•"} ${s.category}_ · Segment: ${s.customer || "—"}`,
        s.body,
        s.businessImpact ? `> ⚑ *Business impact:* ${s.businessImpact}` : "",
        `_Source: ${s.source}_`
      ].filter(Boolean).join("\n")
    }
  }));

  const watchlistText = (data.watchlist || []).map(w => `• ${w}`).join("\n");

  const payload = {
    text: `⬡ *Crypto iGaming Brief — ${TODAY}*`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `⬡ Crypto iGaming Brief · ${TODAY}`, emoji: true }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${data.headline}*\n${data.summary}` }
      },
      { type: "divider" },
      ...storyBlocks,
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
    const data = await fetchCryptoIntel();
    writeBrief(data);
    await postToSlack(data);
    console.log(`[${new Date().toISOString()}] ✅  Crypto job complete`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌  Error:`, err.message);
    process.exit(1);
  }
})();
