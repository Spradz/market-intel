#!/usr/bin/env node
/**
 * COMPETITOR SLOT RELEASES INTELLIGENCE
 * Daily scraper — new slot releases by competitor studios (delta only)
 *
 * Schedule (cron — runs 07:30 AWST / 23:30 UTC daily):
 *   30 23 * * * set -a && . /Users/sprads/projects/market-intel/dashboard/.env && set +a && /Users/sprads/.nvm/versions/node/v20.20.2/bin/node /Users/sprads/projects/market-intel/dashboard/scrape_slots.js >> /Users/sprads/projects/market-intel/dashboard/logs/slots.log 2>&1 && cd /Users/sprads/projects/market-intel/dashboard && git add data/brief.json && git commit -m "Auto-update slots brief.json [$(date +%Y-%m-%d)]" >> /Users/sprads/projects/market-intel/dashboard/logs/slots.log 2>&1 && git push >> /Users/sprads/projects/market-intel/dashboard/logs/slots.log 2>&1
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
if (!SLACK_WEBHOOK) { console.warn("⚠️   SLACK_WEBHOOK_SLOTS not set — skipping Slack post"); }

const TODAY = new Date().toLocaleDateString("en-GB", {
  weekday: "long", year: "numeric", month: "long", day: "numeric"
});

function loadExistingReleases() {
  if (!fs.existsSync(BRIEF_FILE)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8"));
    return d.slots?.releases || [];
  } catch { return []; }
}

function buildPrompt(knownTitles) {
  const skipList = knownTitles.length
    ? `\nALREADY PUBLISHED — these titles are already on the dashboard, do NOT include them:\n${knownTitles.map(t => `- ${t}`).join("\n")}\n`
    : "";

  return `You are a senior iGaming slot analyst tracking competitor game releases. Today is ${TODAY}.

Start by visiting each of these pages directly and reading their content in full:
1. https://slotslaunch.com/calendar — the release calendar; read all entries for the past 7 days
2. https://slotcatalog.com/en/New-Slots — new slot listings; read all titles shown
3. https://www.pragmaticplay.com/en/games/ — Pragmatic Play's own game library; identify any titles added in the last 7 days

Use your remaining searches to look up any priority providers not already covered by those pages.

PRIORITY PROVIDERS — focus on these; always list their releases first:
1. Pragmatic Play
2. PG Soft
3. Jili / Tada Games
4. Playson
5. Hacksaw Gaming
6. No Limit City
7. Fat Panda
8. Spribe
9. Fat Chai

Also capture releases from 3 Oaks Gaming and any other notable providers found on the above pages.
${skipList}
For each NEW release collect:
- Game title
- Provider name
- Launch date (as specific as possible)
- Up to 3 key features (e.g. Buy Bonus, Megaways, Cascading Reels, Free Spins, Multipliers, Tumble, Hold & Win, etc.)
- Market deployment: only record if explicitly confirmed by the source. Map as follows — "RMG", ".com", "real money" → .com / "Sweeps", "Sweepstakes", "Social", "social casino" → Sweeps / confirmed on both → Both. If not explicitly stated, use "Unknown". Do not speculate.
- List ALL releases found per provider — do not limit to one title per provider.

RECENCY RULES:
- Only include games released or officially announced in the last 7 days from today (${TODAY})
- If a launch date is unclear, include it only if the announcement is clearly within the last 7 days
- Do not include games announced months ago that have not yet launched

If no new releases are found beyond what is already published, return an empty releases array.

After researching, call the submit_slots function with only the NEW releases found.`;
}

const SUBMIT_TOOL = {
  name: "submit_slots",
  description: "Submit newly discovered slot releases not yet on the dashboard",
  input_schema: {
    type: "object",
    properties: {
      asOf: { type: "string", description: "Today's date, e.g. '5 May 2026'" },
      summary: { type: "string", description: "1-2 sentence summary of what is new today, or 'No new releases found' if empty" },
      releases: {
        type: "array",
        description: "Only NEW releases not already published. Empty array if nothing new.",
        items: {
          type: "object",
          properties: {
            title:      { type: "string", description: "Game title" },
            provider:   { type: "string", description: "Provider / studio name" },
            launchDate: { type: "string", description: "Launch or announcement date" },
            features:   { type: "array", items: { type: "string" }, description: "Up to 3 key mechanics or features" },
            market:     { type: "string", enum: [".com", "Sweeps", "Both", "Unknown"], description: "Confirmed deployment market. Default Unknown if not explicitly stated." },
            priority:   { type: "boolean", description: "true if provider is on the priority watch list" }
          },
          required: ["title", "provider", "launchDate"]
        }
      }
    },
    required: ["asOf", "summary", "releases"]
  }
};

async function fetchSlotsIntel(knownTitles) {
  console.log(`[${new Date().toISOString()}] 🎰  Fetching Slot Releases intelligence…`);
  console.log(`[${new Date().toISOString()}] 📋  ${knownTitles.length} titles already published — checking for delta`);

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10, allowed_domains: ["slotslaunch.com","slotcatalog.com","pragmaticplay.com"] }, SUBMIT_TOOL],
    messages: [{ role: "user", content: buildPrompt(knownTitles) }]
  });

  const toolUse = response.content.find(b => b.type === "tool_use" && b.name === "submit_slots");
  if (!toolUse) throw new Error("Model did not call submit_slots — no structured data returned");

  return toolUse.input;
}

function mergeBrief(newData, existingReleases, knownTitlesSet) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let brief = {};
  if (fs.existsSync(BRIEF_FILE)) {
    try { brief = JSON.parse(fs.readFileSync(BRIEF_FILE, "utf8")); } catch {}
  }

  // Filter to genuinely new titles (model may still hallucinate known ones)
  const truly_new = (newData.releases || []).filter(
    r => !knownTitlesSet.has(r.title.toLowerCase().trim())
  );

  // Prepend new releases, then trim anything older than 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const merged = [...truly_new, ...existingReleases].filter(r => {
    const d = new Date(r.launchDate);
    return isNaN(d.getTime()) || d >= cutoff;
  });

  brief.generatedAt = new Date().toISOString();
  brief.slots = {
    asOf:     newData.asOf,
    summary:  newData.summary,
    releases: merged
  };

  fs.writeFileSync(BRIEF_FILE, JSON.stringify(brief, null, 2));
  console.log(`[${new Date().toISOString()}] ✅  Brief updated — ${truly_new.length} new release(s) added (${merged.length} total)`);

  return truly_new;
}

async function postToSlack(newReleases, summary, asOf) {
  const priority = newReleases.filter(r => r.priority);
  const other    = newReleases.filter(r => !r.priority);

  function releaseRow(r) {
    const features = (r.features || []).length ? `\n> ${r.features.join(" · ")}` : "";
    return `• *${r.title}* — ${r.provider} · ${r.launchDate}${features}`;
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🎰 New Slot Releases — ${asOf}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: summary } },
    { type: "divider" }
  ];

  if (priority.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*⭐ Priority Providers*\n${priority.map(releaseRow).join("\n")}` } });
  }

  if (other.length) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Other Releases*\n${other.map(releaseRow).join("\n")}` } });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Automated via Claude Code · ${new Date().toISOString()} · Sources: SlotsLaunch, SlotCatalog, Pragmatic Play` }]
  });

  const res = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `🎰 New Slot Releases — ${asOf}`, blocks })
  });

  if (!res.ok) throw new Error(`Slack post failed: ${res.status} ${await res.text()}`);
  console.log(`[${new Date().toISOString()}] 📨  Posted to Slack (${SLACK_CHANNEL})`);
}

(async () => {
  try {
    const existingReleases = loadExistingReleases();
    const knownTitles      = existingReleases.map(r => r.title);
    const knownTitlesSet   = new Set(knownTitles.map(t => t.toLowerCase().trim()));

    const data       = await fetchSlotsIntel(knownTitles);
    const newReleases = mergeBrief(data, existingReleases, knownTitlesSet);

    if (newReleases.length === 0) {
      console.log(`[${new Date().toISOString()}] ℹ️   No new releases found — Slack post skipped`);
    } else if (SLACK_WEBHOOK) {
      await postToSlack(newReleases, data.summary, data.asOf);
    }

    console.log(`[${new Date().toISOString()}] ✅  Slots job complete`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌  Error:`, err.message);
    process.exit(1);
  }
})();
