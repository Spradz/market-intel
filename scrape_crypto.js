#!/usr/bin/env node
/**
 * CRYPTO IGAMING MARKET INTELLIGENCE
 * Claude Code automation script
 *
 * Schedule (cron — runs 07:00 AWST / 23:00 UTC):
 *   0 23 * * * cd ~/projects/market-intel/dashboard && node scrape_crypto.js >> logs/crypto.log 2>&1
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
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_CRYPTO;
const SLACK_CHANNEL = process.env.SLACK_CRYPTO_CHANNEL || "#igaming-intel";

if (!ANTHROPIC_KEY) { console.error("❌  ANTHROPIC_API_KEY not set"); process.exit(1); }
if (!SLACK_WEBHOOK) { console.error("❌  SLACK_WEBHOOK_CRYPTO not set"); process.exit(1); }

const TODAY = new Date().toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

const PROMPT = `You are a senior iGaming industry analyst. Today is ${TODAY}.

Search the web for the latest news across the Crypto iGaming market. Also check https://www.tanzanite.xyz/centralized/volume for the latest crypto casino deposit volume data and reference any notable trends or operator movements shown there. Cover:
- Regulatory developments affecting crypto gambling operators globally
- Major platform launches, acquisitions, or partnerships
- Key operator moves (Stake, Rollbit, BC.Game, Roobet, Shuffle, Duelbits, etc.)
- Aggregator or provider deal news in the crypto-friendly B2B space
- Market trends, player acquisition shifts, or blockchain/token integrations
- Enforcement actions, licensing changes, or country-level restrictions
- Noteworthy industry conference or event news (ICE, SiGMA, etc.)

RECENCY RULES — strictly enforce:
- Only include stories published within the last 30 days from today (${TODAY})
- If a story is older than 60 days, discard it unless it is actively shaping a current event (e.g. a court case still in progress, a law that just took effect)
- If referencing an older event for context, clearly state it is background — do not present it as current news
- If no fresh stories exist for a topic, omit that topic rather than filling with dated content

After researching, call the submit_intelligence function with 4-6 stories.`;

const SUBMIT_TOOL = {
  name: "submit_intelligence",
  description: "Submit the compiled crypto iGaming market intelligence report",
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
            category:       { type: "string", enum: ["Regulatory","M&A","Product","Market Trend","Enforcement","Industry Event"] },
            impact:         { type: "string", enum: ["High","Medium","Low"] },
            customer:       { type: "string" },
            body:           { type: "string" },
            businessImpact: { type: "string" },
            source:         { type: "string" }
          },
          required: ["title","category","impact","body","source"]
        }
      },
      watchlist: { type: "array", items: { type: "string" } }
    },
    required: ["headline","summary","stories","watchlist"]
  }
};

async function fetchCryptoIntel() {
  console.log(`[${new Date().toISOString()}] 🔍  Fetching Crypto iGaming intelligence…`);

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

function writeBrief(cryptoData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let existing = {};
  if (fs.existsSync(BRIEF_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8")); } catch {}
  }

  fs.writeFileSync(BRIEF_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    crypto: cryptoData,
    sweepstakes: existing.sweepstakes || null,
    slots: existing.slots || null,
    sweepstakes: existing.sweepstakes || null
  }, null, 2));
  console.log(`[${new Date().toISOString()}] ✅  Brief written to ${BRIEF_FILE}`);
}

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
      { type: "header", text: { type: "plain_text", text: `⬡ Crypto iGaming Brief · ${TODAY}`, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${data.headline}*\n${data.summary}` } },
      { type: "divider" },
      ...storyBlocks,
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
    const data = await fetchCryptoIntel();
    writeBrief(data);
    await postToSlack(data);
    console.log(`[${new Date().toISOString()}] ✅  Crypto job complete`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌  Error:`, err.message);
    process.exit(1);
  }
})();
