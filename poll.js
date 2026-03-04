import fs from "fs";
import path from "path";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

const SERIES = new Set([
  "kxspotstreamsusa",
  "kxspotstreamglobal",
  "kxalbumsales",
  "kxtop10billboardspotsbb",
  "kxtopalbumtheromantic",
  "kxtopalbum",
  "kxbillboardrunnerupsong",
  "kxbillboardrunnerupalbum",
  "kxtop10billboardspotsbruno",
  "kxranklistsongtop10",
  "kxspotifyglobald",
  "kxspotifyd",
  "kxspotifyartistd",
  "kxtopsong",
  "kxspotifyw",
  "kxspotifyartistw",
  "kxspotifyalbumw",
  "kxtopmonthly",
  "kxranklistsongspotglobal",
  "kxranklistsongspotusa"
].map(s => s.toLowerCase()));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const STATE_FILE = path.join(process.cwd(), "state.json");
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { min_created_ts: Math.floor(Date.now()/1000) - 600, seen: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("DISCORD_WEBHOOK_URL not set. Message:\n", text);
    return;
  }
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) console.log("Discord error", res.status, await res.text().catch(()=> ""));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchMarkets(series, minCreated) {
  const url = new URL(`${BASE_URL}/markets`);
  url.searchParams.set("series_ticker", series);
  url.searchParams.set("min_created_ts", String(minCreated));
  url.searchParams.set("limit", "50");

  // Retry w/ backoff if we get 429
  let backoffMs = 1000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await fetch(url);

    if (r.status === 429) {
      console.log(`429 rate limit for ${series}. Backing off ${backoffMs}ms (attempt ${attempt}/5)`);
      await sleep(backoffMs);
      backoffMs *= 2;
      continue;
    }

    if (!r.ok) {
      throw new Error(`Kalshi HTTP ${r.status}`);
    }

    const j = await r.json();
    return j.markets || [];
  }

  // If we keep getting 429, just skip this series for this run (don't fail the whole job)
  console.log(`Skipping ${series} after repeated 429s`);
  return [];
}

(async function main() {
  const state = loadState();
  let minCreated = state.min_created_ts;
  const seen = new Set(state.seen || []);
await sendDiscord("✅ Kalshi alerts bot is running (test ping).");
  let newest = minCreated;

  for (const s of SERIES) {

    const markets = await fetchMarkets(s, minCreated);

    for (const m of markets) {

      const ticker = m.ticker;
      const created = m.created_ts || 0;

      if (created > newest) newest = created;

      if (ticker && !seen.has(ticker)) {

        seen.add(ticker);

        const title = m.title || "(no title)";
        const seriesGuess = ticker.split("-")[0];

        const link =
          `https://kalshi.com/markets/${seriesGuess}/${ticker}`;

        await sendDiscord(
          `🚨 NEW KALSHI MARKET\n${ticker}\n${title}\n${link}`
        );
      }
    }

    // throttle so we don't hit Kalshi rate limits
    await sleep(300);

  }

  state.min_created_ts = newest;
  state.seen = Array.from(seen).slice(-5000);

  saveState(state);

  console.log("Done. min_created_ts =", newest);

})();
