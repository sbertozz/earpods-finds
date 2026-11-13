#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────
   scripts/scan.mjs — rigenera data.json leggendo i canali Telegram
   Uso:
     node scripts/scan.mjs                 # aggiorna data.json
     node scripts/scan.mjs --dry           # stampa solo il riepilogo
     node scripts/scan.mjs --channels=a,b  # canali extra
     node scripts/scan.mjs --days=30       # finestra archivio
   Richiede Node 18+ (fetch nativo). Nessuna dipendenza npm.
   ─────────────────────────────────────────────────────────────── */
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CHANNELS,
  CHANNEL_INFO,
  parseChannelPage,
  extractOffers,
  mergeDeals,
  pruneDeals,
  computeStats,
  buildChannels,
} from "../lib/tg.js";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const DATA_FILE = path.resolve(process.env.DATA_FILE || "data.json");
const DRY = args.has("dry");
const DAYS = Number(args.get("days") || process.env.ARCHIVE_DAYS || 30);
const MAX_DEALS = Number(args.get("max") || 900);
const UA = "Mozilla/5.0 (compatible; AuricolariRadar/1.0; +https://github.com/sbertozz/earpods-finds)";

const channels = [
  ...new Set([
    ...(process.env.TELEGRAM_CHANNELS ? process.env.TELEGRAM_CHANNELS.split(/[,\s]+/).filter(Boolean) : DEFAULT_CHANNELS),
    ...(args.get("channels") ? String(args.get("channels")).split(/[,\s]+/).filter(Boolean) : []),
  ]),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(channel, before) {
  const url = `https://t.me/s/${encodeURIComponent(channel)}${before ? `?before=${before}` : ""}`;
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "it-IT,it;q=0.9" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function readArchive() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.deals) ? parsed : { deals: [] };
  } catch {
    return { deals: [] };
  }
}

async function main() {
  const prev = await readArchive();
  const previousDeals = (prev.deals || []).filter((d) => d && d.key);
  const channelMeta = {};
  for (const s of prev.stats?.sources || prev.channels || []) {
    if (s?.channel) channelMeta[s.channel] = { ...(channelMeta[s.channel] || {}), ...s };
  }

  const incoming = [];
  let ok = 0;
  let failed = 0;
  for (const ch of channels) {
    try {
      const html = await fetchPage(ch);
      const page = parseChannelPage(html, ch);
      if (!page.posts.length) throw new Error("nessun post nell'anteprima");
      channelMeta[ch] = {
        ...(channelMeta[ch] || {}),
        title: page.info.title || CHANNEL_INFO[ch]?.title || ch,
        photo: page.info.photo || channelMeta[ch]?.photo || null,
        description: page.info.description || channelMeta[ch]?.description || null,
        lastMessageId: page.posts[page.posts.length - 1].id,
        lastScanAt: new Date().toISOString(),
        lastOkAt: new Date().toISOString(),
        error: null,
        okScans: (channelMeta[ch]?.okScans || 0) + 1,
      };
      let count = 0;
      for (const post of page.posts) {
        post.channelTitle = page.info.title;
        post.channelPhoto = page.info.photo;
        const offers = extractOffers(post);
        incoming.push(...offers);
        count += offers.length;
      }
      ok += 1;
      console.log(`✓ @${ch}: ${page.posts.length} post, ${count} offerte audio`);
    } catch (err) {
      failed += 1;
      channelMeta[ch] = {
        ...(channelMeta[ch] || {}),
        title: channelMeta[ch]?.title || CHANNEL_INFO[ch]?.title || ch,
        lastScanAt: new Date().toISOString(),
        error: String(err.message || err),
      };
      console.warn(`✗ @${ch}: ${err.message}`);
    }
    await sleep(1200); // cortesia verso t.me
  }

  const nowIso = new Date().toISOString();
  const { deals, added } = mergeDeals(previousDeals, incoming, nowIso);
  const pruned = pruneDeals(deals, { days: DAYS, max: MAX_DEALS });
  const stats = computeStats(pruned, channelMeta, { now: nowIso, lastScanAt: nowIso, scans: (prev.stats?.scanner?.scans || 0) + 1, errors: failed });
  const snapshot = {
    generatedAt: nowIso,
    mode: "static",
    deals: pruned,
    stats,
    channels: buildChannels(pruned, channelMeta),
  };

  console.log(
    `\ncanali ok: ${ok}/${channels.length} · nuove offerte: ${added.length} · archivio: ${pruned.length} · sconto max: ${stats.bestDiscount}%`,
  );

  if (DRY) {
    console.log("(--dry: data.json non modificato)");
    return;
  }
  if (!ok) {
    console.error("Nessun canale raggiunto: lascio data.json invariato.");
    process.exitCode = 1;
    return;
  }
  await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 0) + "\n", "utf8");
  console.log(`✓ scritto ${path.relative(process.cwd(), DATA_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
