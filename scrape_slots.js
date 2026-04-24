#!/usr/bin/env node
/**
 * COMPETITOR SLOT RELEASES INTELLIGENCE
 * Weekly scraper — new slot releases by competitor studios
 *
 * Schedule (cron — runs 07:30 AWST / 23:30 UTC every Monday):
 *   30 23 * * 0 cd ~/projects/market-intel/dashboard && node scrape_slots.js >> logs/slots.log 2>&1
 *
 * NOTE: Add SLACK_WEBHOOK_SLOTS to .env before enabling cron
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
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_SLOTS;
const SLACK_CHANNEL = process.env.SLACK_SLOTS_CHANNEL || "#slots-intel";

if (!ANTHROPIC_KEY) { console.error("❌  ANTHROPIC_API_KEY not set"); process.exit(1); }
if (!SLACK_WEBHOOK) { console.error("❌  SLACK_WEBHOOK_SLOTS not set"); process.exit(1); }

const TODAY = new Date().toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

const PROMPT = `You are a senior iGaming slot analyst tracking competitor game releases. Today is ${TODAY}.

Search the following sources for new slot game releases published in the last 7 days:
- https://slotslaunch.com/calendar
- https://slotcatalog.com/en/New-Slots
- https://www.pragmaticplay.com/en/games/
- Search generally for "new slot releases [current week/month]" to catch additional launches

PRIORITY PROVIDERS — always search for these first and list their releases at the top:
1. Pragmatic Play
2. PG Soft
3. Jili / Tada Games
4. 3 Oaks Gaming
5. Playson
6. Hacksaw Gaming
7. No Limit City
8. Fat Panda
9. Spribe
10. Fat Chai

Also capture releases from any other notable providers you find.

For each release collect:
- Game title
- Provider name
- Launch date (as specific as possible)
- Up to 3 key features (e.g. Buy Bonus, Megaways, Cascading Reels, Free Spins, Multipliers, Tumble, Hold & Win, etc.)
- Market deployment: only record if explicitly confirmed by the source. Map as follows — "RMG", ".com", "real money" → .com / "Sweeps", "Sweepstakes", "Social", "social casino" → Sweeps / confirmed on both → Both. If not explicitly stated, use "Unknown". Do not speculate.
- List ALL releases found per provider — do not limit to one title per provider. If a provider released three games this week, list all three.

RECENCY RULES:
- Only include games released or officially announced in the last 7 days from today (${TODAY})
- If a launch date is unclear, include it only if the announcement is clearly this week
- Do not include games announced months ago that have not yet launched

After researching, call the submit_slots function with all releases found.`;

const SUBMIT_TOOL = {
  name: "submit_slots",
  description: "Submit the compiled weekly slot release intelligence",
  input_schema: {
    type: "object",
    properties: {
      weekOf: { type: "string", description: "Week ending date, e.g. '25 April 2026'" },
      summary: { type: "string", description: "2-3 sentence overview of this week's release landscape" },
      releases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:      { type: "string", description: "Game title" },
            provider:   { type: "string", description: "Provider / studio name" },
            launchDate: { type: "string", description: "Launch or announcement date" },
            features:   { type: "array", items: { type: "string" }, description: "Up to 3 key mechanics or features" },
            market:     { type: "string", enum: [".com", "Sweeps", "Both", "Unknown"], description: "Confirmed deployment market. Map RMG/real money → .com, Sweeps/Sweepstakes/Social → Sweeps, confirmed on both → Both. Default Unknown if not explicitly stated." },
            priority:   { type: "boolean", description: "true if provider is on the priority watch list" }
          },
          required: ["title", "provider", "launchDate"]
        }
      }
    },
    required: ["weekOf", "summary", "releases"]
  }
};

async function fetchSlotsIntel() {
  console.log(`[${new Date().toISOString()}] 🎰  Fetching Slot Releases intelligence…`);

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    tools: [{ type: "web_search_20250305", name: "web_search" }, SUBMIT_TOOL],
    messages: [{ role: "user", content: PROMPT }]
  });

  const toolUse = response.content.find(b => b.type === "tool_use" && b.name === "submit_slots");
  if (!toolUse) throw new Error("Model did not call submit_slots — no structured data returned");

  return toolUse.input;
}

function writeBrief(slotsData) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let existing = {};
  if (fs.existsSync(BRIEF_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8")); } catch {}
  }

  fs.writeFileSync(BRIEF_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    crypto:       existing.crypto       || null,
    sweepstakes:  existing.sweepstakes  || null,
    slots:        slotsData
  }, null, 2));
  console.log(`[${new Date().toISOString()}] ✅  Brief written to ${BRIEF_FILE}`);
}

async function postToSlack(data) {
  const priorityReleases = (data.releases || []).filter(r => r.priority);
  const otherReleases    = (data.releases || []).filter(r => !r.priority);

  function releaseRow(r) {
    const features = (r.features || []).length ? `\n> ${r.features.join(" · ")}` : "";
    return `• *${r.title}* — ${r.provider} · ${r.launchDate}${features}`;
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🎰 Slot Releases — Week of ${data.weekOf}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: data.summary } },
    { type: "divider" }
  ];

  if (priorityReleases.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*⭐ Priority Providers*\n${priorityReleases.map(releaseRow).join("\n")}` }
    });
  }

  if (otherReleases.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Other Releases*\n${otherReleases.map(releaseRow).join("\n")}` }
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Automated via Claude Code · ${new Date().toISOString()} · Sources: SlotsLaunch, SlotCatalog, provider sites` }]
  });

  const res = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `🎰 Slot Releases — Week of ${data.weekOf}`, blocks })
  });

  if (!res.ok) throw new Error(`Slack post failed: ${res.status} ${await res.text()}`);
  console.log(`[${new Date().toISOString()}] 📨  Posted to Slack (${SLACK_CHANNEL})`);
}

(async () => {
  try {
    const data = await fetchSlotsIntel();
    writeBrief(data);
    await postToSlack(data);
    console.log(`[${new Date().toISOString()}] ✅  Slots job complete`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌  Error:`, err.message);
    process.exit(1);
  }
})();
