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


const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      disable_web_page_preview: true
    }),
  });

  if (!res.ok) {
    console.log("Telegram error", res.status);
  }
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
  // Always look back a bit so we don't miss anything between runs
  // (GitHub Actions has no persistent disk, so we can't rely on state.json)
  const now = Math.floor(Date.now() / 1000);
  const LOOKBACK = 12 * 60 * 60; // 12 hours
  const minCreated = now - LOOKBACK;

  // Deduplicate within a single run
  const seen = new Set();

  let alertsSent = 0;

  for (const s of SERIES) {
    const markets = await fetchMarkets(s, minCreated);

    for (const m of markets) {
      const ticker = m.ticker;
      if (!ticker) continue;
      const created = m.created_ts || 0;
if (created < now - 10 * 60) continue; // only last 10 minutes

      // Dedupe
      if (seen.has(ticker)) continue;
      seen.add(ticker);

      const title = m.title || "(no title)";
      const seriesGuess = ticker.split("-")[0];
      const link = `https://kalshi.com/markets/${seriesGuess}/${ticker}`;

      const msg = `🚨 NEW KALSHI MARKET
${ticker}
${title}
${link}`;

      await sendDiscord(msg);
      await sendTelegram(msg);
      alertsSent++;
    }

    // throttle so we don't hit Kalshi rate limits
    await sleep(300);
  }

  console.log(`Done. Alerts sent: ${alertsSent}`);
})();
