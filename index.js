import WebSocket from "ws";

const WS_URL = "wss://api.elections.kalshi.com/trade-api/ws/v2";

// your series tickers from the URLs you pasted
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

// prevent duplicate alerts if Kalshi replays messages on reconnect
const seen = new Set();

function matchesYourMarkets(marketTicker, additionalMetadata) {
  // Most reliable: market_ticker often begins with the series prefix (case-insensitive).
  const mt = (marketTicker || "").toLowerCase();
  for (const s of SERIES) {
    if (mt.startsWith(s + "-") || mt === s) return true;
  }

  // backup: sometimes series is in metadata (not guaranteed)
  const eventTicker = (additionalMetadata?.event_ticker || "").toLowerCase();
  for (const s of SERIES) {
    if (eventTicker.startsWith(s + "-") || eventTicker === s) return true;
  }

  return false;
}

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("DISCORD_WEBHOOK_URL not set, printing only:\n", text);
    return;
  }

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log("Discord webhook failed:", res.status, body);
  }
}

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("Connected:", WS_URL);

    // Subscribe to market lifecycle events (created/activated/etc.)
    // Channel: market_lifecycle_v2 (creation notifications)
    ws.send(JSON.stringify({
      id: 1,
      cmd: "subscribe",
      params: { channels: ["market_lifecycle_v2"] }
    }));
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // We only care about actual lifecycle payloads
    if (msg?.type !== "market_lifecycle_v2") return;

    const m = msg.msg || {};
    const eventType = m.event_type;
    const marketTicker = m.market_ticker;

    if (eventType !== "created") return;

    if (!matchesYourMarkets(marketTicker, m.additional_metadata)) return;

    if (seen.has(marketTicker)) return;
    seen.add(marketTicker);

    const title = m.additional_metadata?.title || m.additional_metadata?.name || "(no title)";
    const seriesGuess = (marketTicker || "").split("-")[0];
    const link = seriesGuess ? `https://kalshi.com/markets/${seriesGuess}` : "https://kalshi.com/markets";

    const text =
`🚨 NEW KALSHI MARKET CREATED
Ticker: ${marketTicker}
Title: ${title}
Link: ${link}`;

    console.log(text);
    await sendDiscord(text);
  });

  ws.on("close", (code, reason) => {
    console.log("WS closed:", code, reason?.toString?.() || "");
    setTimeout(connect, 2000);
  });

  ws.on("error", (err) => {
    console.log("WS error:", err.message);
    try { ws.close(); } catch {}
  });
}

connect();
