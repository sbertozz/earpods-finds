/* ───────────────────────────────────────────────────────────────
   Auricolari Radar — frontend (vanilla JS, zero dipendenze)
   ─────────────────────────────────────────────────────────────── */
import {
  DEFAULT_CHANNELS,
  parseChannelPage,
  extractOffers,
  mergeDeals,
  pruneDeals,
  computeStats,
  buildChannels,
} from "./lib/tg.js";

const state = {
  q: "",
  sort: "recent",
  brand: null,
  store: null,
  category: null,
  maxPrice: 600,
  minDiscount: 0,
  only24: false,
  hideSeen: false,
  limit: 48,
  offset: 0,
  total: 0,
  loading: false,
  deals: [],
  stats: null,
  channels: [],
  soundOn: localStorage.getItem("ar_sound") === "1",
  seen: new Set(JSON.parse(localStorage.getItem("ar_seen") || "[]")),
  newCount: 0,
  lastKeys: new Set(),
  live: false,
};

const $ = (sel) => document.querySelector(sel);
const el = {
  feed: $("#feed"),
  empty: $("#empty"),
  resultCount: $("#resultCount"),
  livePill: $("#livePill"),
  liveText: $("#liveText"),
  search: $("#search"),
  clearSearch: $("#clearSearch"),
  sort: $("#sort"),
  filters: $("#filters"),
  filtersToggle: $("#filtersToggle"),
  categoryChips: $("#categoryChips"),
  brandChips: $("#brandChips"),
  storeChips: $("#storeChips"),
  maxPrice: $("#maxPrice"),
  maxPriceOut: $("#maxPriceOut"),
  minDiscount: $("#minDiscount"),
  minDiscountOut: $("#minDiscountOut"),
  only24: $("#only24"),
  hideSeen: $("#hideSeen"),
  loadMore: $("#loadMore"),
  toastStack: $("#toastStack"),
  newPill: $("#newPill"),
  newPillCount: $("#newPillCount"),
  modal: $("#modal"),
  channelList: $("#channelList"),
  channelManage: $("#channelManage"),
  newChannel: $("#newChannel"),
  botStatus: $("#botStatus"),
};

const euro = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? null
    : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function timeAgoIt(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const d = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (d < 45) return "ora";
  if (d < 90) return "1 min fa";
  const m = Math.round(d / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(d / 3600);
  if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
  const g = Math.round(d / 86400);
  if (g < 30) return `${g} ${g === 1 ? "giorno" : "giorni"} fa`;
  const mo = Math.round(g / 30);
  return `${mo} ${mo === 1 ? "mese" : "mesi"} fa`;
}

const debounce = (fn, ms = 260) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
/* ──────────────  Modalità: "live" (API) oppure "static" (GitHub Pages)  ──────────────
   In modalità statica il frontend parte da data.json e poi si aggiorna da solo:
   ad ogni visita scarica l'anteprima pubblica dei canali Telegram (t.me/s/…) e
   aggiunge le nuove offerte, così il catalogo non resta mai fermo. */
let MODE = "live";
let STATIC_DATA = null;
/* snapshot "vivo": data.json + archivio locale + scan on-demand */
const LIVE = {
  deals: [],            // tutte le offerte note (audio)
  channels: {},         // { canale: {title, photo, lastMessageId, …} }
  generatedAt: null,    // ultima scansione riuscita
  scans: 0,             // scansioni complete
  errors: 0,            // canali che hanno fallito all'ultimo giro
  available: false,     // il browser è riuscito a leggere t.me almeno una volta
  busy: false,          // scansione in corso
  lastAttemptAt: 0,     // ultima scansione (anche fallita)
  lastResult: null,     // { added, updated, seconds }
};

const CFG = {
  channels: () => {
    const custom = JSON.parse(localStorage.getItem("ar_extra_channels") || "[]");
    return [...new Set([...DEFAULT_CHANNELS, ...custom])];
  },
  autoScan: localStorage.getItem("ar_autoscan") !== "0",
  /** intervallo tra due scansioni automatiche (ms) */
  intervalMs: Number(localStorage.getItem("ar_scan_interval") || 180000),
  /** non riscansiono più spesso di così (ms) */
  minGapMs: 60000,
  /** quante pagine di archivio Telegram scaricare per canale */
  maxPages: 1,
  days: 30,
  maxDeals: 600,
};

function staticQuery(params) {
  const get = (k) => params.get(k);
  const q = (get("q") || "").toLowerCase().trim();
  const brand = get("brand");
  const store = get("store");
  const category = get("category");
  const channel = get("channel");
  const minDiscount = Number(get("minDiscount") || 0);
  const maxPrice = get("maxPrice") ? Number(get("maxPrice")) : null;
  const minPrice = get("minPrice") ? Number(get("minPrice")) : null;
  const sort = get("sort") || "recent";
  const limit = Number(get("limit") || 48);
  const offset = Number(get("offset") || 0);

  const source = LIVE.deals.length ? LIVE.deals : (STATIC_DATA?.deals || []);
  let rows = source.filter((d) => {
    if (!d.isAudio) return false;
    if (brand && d.brand !== brand) return false;
    if (store && d.store !== store) return false;
    if (category && d.category !== category) return false;
    if (channel && d.channel !== channel) return false;
    if (minDiscount && (d.discount || 0) < minDiscount) return false;
    if (maxPrice !== null && (d.price ?? Infinity) > maxPrice) return false;
    if (minPrice !== null && (d.price ?? 0) < minPrice) return false;
    if (q) {
      const hay = `${d.title} ${d.brand || ""} ${d.model || ""} ${d.text || ""} ${d.channelTitle || ""}`.toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const sorters = {
    recent: (a, b) => new Date(b.postedAt) - new Date(a.postedAt),
    discount: (a, b) => (b.discount || 0) - (a.discount || 0),
    priceAsc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    priceDesc: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    popular: (a, b) => (b.views || 0) - (a.views || 0) || new Date(b.postedAt) - new Date(a.postedAt),
  };
  rows.sort(sorters[sort] || sorters.recent);
  return { total: rows.length, deals: rows.slice(offset, offset + limit) };
}

async function api(path, opts = {}) {
  if (MODE === "static") {
    const [pathname, qs] = path.split("?");
    const params = new URLSearchParams(qs || "");
    if (pathname === "/deals") return staticQuery(params);
    if (pathname === "/stats") return currentStats();
    if (pathname === "/channels") return { channels: currentChannels() };
    if (pathname === "/scan") return { ok: false, static: true };
    if (opts.method === "POST") throw new Error("La gestione dei canali non è disponibile nella versione statica (GitHub Pages).");
    throw new Error(`Endpoint ${path} non disponibile in modalità statica`);
  }
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Capisce se c'è un backend: se non risponde, prova data.json (GitHub Pages) */
async function loadBootstrap() {
  // la build statica (GitHub Pages) inietta <meta name="static-mode" content="1">
  const isStaticBuild = document.querySelector('meta[name="static-mode"]');
  if (isStaticBuild) {
    const res = await fetch("./data.json", { cache: "no-store" });
    STATIC_DATA = await res.json();
    MODE = "static";
    return { channels: STATIC_DATA.channels || [] };
  }
  try {
    const ch = await api("/channels");
    MODE = "live";
    return { channels: ch.channels || [] };
  } catch {
    /* niente API: provo la modalità statica */
  }
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    STATIC_DATA = await res.json();
    MODE = "static";
    return { channels: STATIC_DATA.channels || [] };
  } catch {
    MODE = "live";
    return { channels: [] };
  }
}

/* ──────────────  Snapshot "vivo" (modalità statica)  ────────────── */

function currentStats(extra = {}) {
  const deals = LIVE.deals.length ? LIVE.deals : (STATIC_DATA?.deals || []);
  return computeStats(deals, LIVE.channels, {
    lastScanAt: LIVE.generatedAt || STATIC_DATA?.generatedAt || null,
    scans: LIVE.scans,
    errors: LIVE.errors,
    ...extra,
  });
}

function currentChannels() {
  const base = LIVE.deals.length ? buildChannels(LIVE.deals, LIVE.channels) : (STATIC_DATA?.channels || []);
  return base.map((c) => ({ ...c, ...(LIVE.channels[c.channel] || {}) }));
}

/** carica l'archivio locale (offerte già viste su questo browser) */
function loadArchive() {
  try {
    const saved = JSON.parse(localStorage.getItem("ar_archive") || "null");
    if (saved && Array.isArray(saved.deals) && saved.deals.length) {
      LIVE.deals = saved.deals.filter((d) => d.isAudio !== false);
    }
    if (saved?.channels && typeof saved.channels === "object") LIVE.channels = saved.channels;
    if (saved?.generatedAt) LIVE.generatedAt = saved.generatedAt;
    if (Number.isFinite(saved?.scans)) LIVE.scans = saved.scans;
  } catch {
    /* archivio corrotto: riparto pulito */
  }
}

function saveArchive() {
  const slim = LIVE.deals.map((d) => ({ ...d, text: String(d.text || "").slice(0, 500) }));
  try {
    localStorage.setItem(
      "ar_archive",
      JSON.stringify({
        savedAt: new Date().toISOString(),
        generatedAt: LIVE.generatedAt,
        scans: LIVE.scans,
        channels: LIVE.channels,
        deals: slim,
      }),
    );
  } catch {
    // quota piena: salvo solo le offerte più recenti (l'archivio resta in memoria)
    try {
      localStorage.setItem(
        "ar_archive",
        JSON.stringify({ generatedAt: LIVE.generatedAt, scans: LIVE.scans, channels: LIVE.channels, deals: slim.slice(0, 120) }),
      );
    } catch {
      /* niente storage: pazienza */
    }
  }
}

/** unisce data.json con l'archivio locale (via nuova, senza perdere le novità) */
function seedLiveData() {
  const base = STATIC_DATA?.deals || [];
  const { deals } = mergeDeals(
    base.filter((d) => d.isAudio !== false),
    LIVE.deals,
    new Date().toISOString(),
  );
  LIVE.deals = pruneDeals(deals, { days: CFG.days, max: CFG.maxDeals });
  if (!LIVE.generatedAt && STATIC_DATA?.generatedAt) LIVE.generatedAt = STATIC_DATA.generatedAt;
  for (const c of STATIC_DATA?.channels || []) {
    if (c?.channel && !LIVE.channels[c.channel]) LIVE.channels[c.channel] = { title: c.title, photo: c.photo };
  }
}

/** Adatta l'interfaccia alla modalità statica */
function applyMode() {
  const isStatic = MODE === "static";
  document.body.classList.toggle("static-mode", isStatic);
  if (!isStatic) return;
  const refresh = $("#refreshBtn");
  if (refresh) refresh.textContent = "↻ Aggiorna ora";
  renderBotStatus();
}

function renderBotStatus() {
  const bot = $("#botStatus");
  if (!bot) return;
  if (MODE !== "static") return;
  const used = LIVE.generatedAt || STATIC_DATA?.generatedAt;
  const when = used ? timeAgoIt(used) : "mai";
  const extra = JSON.parse(localStorage.getItem("ar_extra_channels") || "[]");
  bot.innerHTML =
    `🔄 <strong>Aggiornamento automatico attivo</strong>: ad ogni visita (e ogni ${Math.round(CFG.intervalMs / 60000)} min) ` +
    `rileggo i canali Telegram pubblici e aggiungo le nuove offerte. Ultimo controllo: <strong>${when}</strong>.` +
    `<br/>Archivio locale: <strong>${LIVE.deals.length}</strong> offerte · scansioni: ${LIVE.scans}` +
    (LIVE.errors ? ` · canali non raggiungibili: ${LIVE.errors}` : "") +
    `<br/><label class="toggle" style="margin-top:8px"><input type="checkbox" id="autoscanToggle" ${CFG.autoScan ? "checked" : ""}/> Aggiorna automaticamente mentre il sito è aperto</label>` +
    `<br/><span class="tiny">Puoi anche aggiungere canali extra: scrivili qui sotto e premi <em>Aggiorna ora</em> per includerli.</span>` +
    (extra.length ? `<br/><span class="tiny">Canali personalizzati: ${extra.map((c) => `@${esc(c)}`).join(", ")}</span>` : "");
  const toggle = $("#autoscanToggle");
  if (toggle) {
    toggle.addEventListener("change", (e) => {
      localStorage.setItem("ar_autoscan", e.currentTarget.checked ? "1" : "0");
      CFG.autoScan = e.currentTarget.checked;
      toastInfo(e.currentTarget.checked ? "Aggiornamento automatico attivo" : "Aggiornamento automatico disattivato");
    });
  }
}

function toastInfo(text) {
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<div class="t-ph">🔄</div><div class="t-body"><div class="t-title">Auricolari Radar</div><div class="t-text">${esc(text)}</div></div>`;
  el.toastStack.prepend(node);
  setTimeout(() => node.classList.add("out"), 2600);
  setTimeout(() => node.remove(), 2900);
  while (el.toastStack.children.length > 3) el.toastStack.lastElementChild.remove();
}

/* ──────────────  Scanner: legge i canali Telegram dal browser  ──────────────
   t.me non manda header CORS, quindi passo da proxy pubblici. Provo più
   servizi in sequenza e tengo quello che funziona (con cache in localStorage).
   Tutto gira in parallelo e con limiti di tempo: la pagina resta reattiva. */

const PROXIES = [
  { id: "allorigins", build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { id: "codetabs", build: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
  { id: "corsproxy-io", build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { id: "thingproxy", build: (u) => `https://thingproxy.freeboard.io/fetch/${u}` },
  { id: "r.jina.ai", build: (u) => `https://r.jina.ai/${u}` },
];

function proxyOrder() {
  const saved = localStorage.getItem("ar_proxy");
  const list = [...PROXIES];
  if (saved) {
    const i = list.findIndex((p) => p.id === saved);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

async function fetchTimeout(url, ms = 12000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl?.signal, cache: "no-store", redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < 4000) throw new Error("risposta troppo corta");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** scarica l'anteprima di un canale provando i proxy finché uno funziona */
async function fetchChannelPage(channel) {
  const target = `https://t.me/s/${encodeURIComponent(channel)}`;
  for (const proxy of proxyOrder()) {
    try {
      const text = await fetchTimeout(proxy.build(target), 14000);
      if (!/tgme_widget_message|tgme_channel_info/i.test(text)) throw new Error("markup inatteso");
      localStorage.setItem("ar_proxy", proxy.id);
      return text;
    } catch {
      /* provo il prossimo proxy */
    }
  }
  throw new Error("canali non raggiungibili");
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (err) {
        out[idx] = { error: err };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function incomingOffersFromPage(channel, html) {
  const page = parseChannelPage(html, channel);
  const meta = {
    title: page.info.title,
    photo: page.info.photo,
    description: page.info.description,
    lastMessageId: page.posts.length ? page.posts[page.posts.length - 1].id : null,
    lastScanAt: new Date().toISOString(),
    lastOkAt: new Date().toISOString(),
  };
  const offers = [];
  for (const post of page.posts) {
    post.channelTitle = page.info.title;
    post.channelPhoto = page.info.photo;
    offers.push(...extractOffers(post));
  }
  return { meta, offers, posts: page.posts.length };
}

/**
 * Scansiona tutti i canali e fonde le nuove offerte nell'archivio.
 * @param {{manual?:boolean, quiet?:boolean}} opts
 */
async function scanNow({ manual = false, quiet = false } = {}) {
  if (MODE !== "static" || LIVE.busy) return LIVE.lastResult;
  const now = Date.now();
  if (!manual && now - LIVE.lastAttemptAt < CFG.minGapMs) return LIVE.lastResult;
  if (manual && now - LIVE.lastAttemptAt < 15000) return LIVE.lastResult;

  LIVE.busy = true;
  LIVE.lastAttemptAt = now;
  const started = performance.now();
  const channels = CFG.channels();
  setLive("scanning", `controllo ${channels.length} canali…`);
  if (manual) {
    const btn = $("#refreshBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "↻ aggiorno…";
    }
  }

  try {
    const results = await mapLimit(channels, 3, (ch) => fetchChannelPage(ch).then((html) => incomingOffersFromPage(ch, html)));
    const incoming = [];
    let ok = 0;
    let failed = 0;
    const metaUpdates = {};
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const ch = channels[i];
      if (!r || r.error) {
        failed += 1;
        metaUpdates[ch] = { ...(LIVE.channels[ch] || {}), error: String(r?.error?.message || "errore"), lastScanAt: new Date().toISOString() };
        continue;
      }
      ok += 1;
      LIVE.available = true;
      metaUpdates[ch] = { ...(LIVE.channels[ch] || {}), ...r.meta, error: null };
      incoming.push(...r.offers);
    }

    const fresh = incoming.filter((d) => d.isAudio);
    const { deals, added } = mergeDeals(LIVE.deals, fresh, new Date().toISOString());
    LIVE.deals = pruneDeals(deals, { days: CFG.days, max: CFG.maxDeals });
    LIVE.channels = { ...LIVE.channels, ...metaUpdates };
    LIVE.errors = failed;
    if (ok > 0) {
      LIVE.scans += 1;
      LIVE.generatedAt = new Date().toISOString();
    }
    LIVE.lastResult = {
      added: added.length,
      updated: fresh.length - added.length,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      ok,
      failed,
      at: new Date().toISOString(),
    };
    saveArchive();
    await Promise.all([loadStats(), loadDeals()]);
    renderBotStatus();

    if (ok === 0) {
      setLive("offline", "canali non raggiungibili");
      if (manual) toastInfo("Non riesco a contattare Telegram da questo browser (proxy bloccati o rete aziendale).");
      return LIVE.lastResult;
    }
    if (!quiet) {
      setLive("ok", added.length ? `+${added.length} nuove offerte` : "catalogo aggiornato");
      if (added.length) {
        const names = added.slice(0, 3).map((d) => d.title).join(" · ");
        toastInfo(`${added.length} nuov${added.length === 1 ? "a offerta" : "e offerte"} · ${names}${added.length > 3 ? "…" : ""}`);
        if (manual) window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (manual) {
        toastInfo("Nessuna nuova offerta: il catalogo è già aggiornato.");
      }
    }
    return LIVE.lastResult;
  } finally {
    LIVE.busy = false;
    if (manual) {
      const btn = $("#refreshBtn");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "↻ Aggiorna ora";
      }
    }
  }
}

/** avvia il refresh: subito all'apertura + ogni N minuti se la pagina è visibile */
function startAutoScan() {
  if (MODE !== "static") return;
  const kick = () => {
    if (!CFG.autoScan || document.hidden) return;
    scanNow({ manual: false }).catch(() => {});
  };
  // prima scansione dopo che la UI è visibile (non bloccare il primo render)
  setTimeout(kick, 900);
  setInterval(kick, CFG.intervalMs);
  // quando torni sulla tab, se sono passati >2 min aggiorno subito
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - LIVE.lastAttemptAt > 120000) kick();
  });
  window.addEventListener("online", kick);
}

function queryParams(offset = state.offset) {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.brand) p.set("brand", state.brand);
  if (state.store) p.set("store", state.store);
  if (state.category) p.set("category", state.category);
  if (state.minDiscount) p.set("minDiscount", state.minDiscount);
  if (state.maxPrice < 600) p.set("maxPrice", state.maxPrice);
  p.set("sort", state.sort);
  p.set("limit", state.limit);
  p.set("offset", String(offset));
  return p.toString();
}

async function loadDeals({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  try {
    // se non stiamo paginando, ripartiamo sempre dalla prima offerta
    const offset = append ? state.offset : 0;
    if (!append) state.offset = 0;
    const data = await api(`/deals?${queryParams(offset)}`);
    let deals = data.deals;
    if (state.only24) {
      const cut = Date.now() - 86400000;
      deals = deals.filter((d) => new Date(d.postedAt).getTime() >= cut);
    }
    if (state.hideSeen) deals = deals.filter((d) => !state.seen.has(d.key));
    state.total = data.total;
    state.deals = append ? [...state.deals, ...deals] : deals;
    state.offset = append ? state.offset + deals.length : deals.length;
    if (!append) {
      state.lastKeys = new Set(deals.map((d) => d.key));
      state.newCount = 0;
      updateNewPill();
    }
    render({
      newKeys: new Set(
        (append ? deals : []).map((d) => d.key).filter((k) => !state.lastKeys.has(k)),
      ),
    });
  } catch (err) {
    console.error(err);
    setLive("offline", "server offline");
  } finally {
    state.loading = false;
  }
}

async function loadStats() {
  try {
    state.stats = await api("/stats");
    renderStats();
    renderFilterChips();
    renderChannelFooter();
  } catch (err) {
    console.error(err);
  }
}

/* ──────────────  Render  ────────────── */
function renderStats() {
  const s = state.stats;
  if (!s) return;
  $("#statTotal").textContent = s.totalDeals ?? "—";
  $("#stat24").textContent = s.last24h ?? "—";
  $("#statBest").textContent = s.bestDiscount ? `−${s.bestDiscount}%` : "—";
  $("#statAvg").textContent = s.avgPrice ? euro(s.avgPrice) : "—";
  $("#heroChannels").textContent = state.channels.length || s.sources?.length || "…";
}

/** normalizza i contatori: l'API può darli come oggetto o come array di coppie */
function pairs(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Array.isArray).map(([k, n]) => [String(k), Number(n) || 0]);
  return Object.entries(v).map(([k, n]) => [k, Number(n) || 0]);
}

function renderFilterChips() {
  const s = state.stats;
  if (!s) return;
  const catLabels = { tws: "Auricolari TWS", cuffie: "Cuffie over-ear", anc: "Con ANC", gaming: "Gaming", sport: "Sport", open: "Open-ear" };
  el.categoryChips.innerHTML = pairs(s.categories)
    .filter(([, n]) => n > 0)
    .map(
      ([k, n]) =>
        `<button class="chip ${state.category === k ? "active" : ""}" data-cat="${esc(k)}">${esc(catLabels[k] || k)}<span class="count">${n}</span></button>`,
    )
    .join("");
  el.brandChips.innerHTML = pairs(s.brands)
    .slice(0, 14)
    .map(
      ([b, n]) =>
        `<button class="chip ${state.brand === b ? "active" : ""}" data-brand="${esc(b)}">${esc(b)}<span class="count">${n}</span></button>`,
    )
    .join("");
  el.storeChips.innerHTML = pairs(s.stores)
    .slice(0, 10)
    .map(
      ([st, n]) =>
        `<button class="chip ${state.store === st ? "active" : ""}" data-store="${esc(st)}">${esc(st)}<span class="count">${n}</span></button>`,
    )
    .join("");
}

function renderChannelFooter() {
  const list = state.stats?.sources || state.channels || [];
  el.channelList.innerHTML = (list || [])
    .filter((c) => !c.imported)
    .map(
      (c) =>
        `<li><span class="st ${c.error ? "err" : ""}" title="${c.error ? esc(c.error) : "ok"}"></span><a href="https://t.me/${esc(c.channel)}" target="_blank" rel="noopener">@${esc(c.channel)}</a></li>`,
    )
    .join("");
}

const svg = (paths, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

const ICON = {
  verified: svg('<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4"/>'),
  check: svg('<path d="m4 12.5 5 5L20 6.5"/>'),
  square: svg('<rect x="4" y="4" width="16" height="16" rx="4"/>'),
  link: svg('<path d="M9 15l6-6"/><path d="M11 6.5 12.5 5a4.2 4.2 0 0 1 6 6L17 12.5"/><path d="M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5"/>'),
  plane: svg('<path d="M21.5 3.5 2.8 10.4l6.2 2.4 2.4 6.2 3.4-6.1 6.7-9.4Z"/><path d="m9 12.8 4.2 4.2"/>'),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.2l2.6 11.2h11.4l2.3-8.4H6"/>'),
};

function cardHtml(d, isNew) {
  const price = euro(d.price);
  const old = euro(d.oldPrice);
  const save = d.price && d.oldPrice ? euro(d.oldPrice - d.price) : null;
  const img = d.image
    ? `<img src="${esc(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.parentElement.querySelector('.ph').style.display='grid'">
       <span class="ph" style="display:none">🎧</span>`
    : `<span class="ph">🎧</span>`;
  const alsoOn = (d.alsoOn || [])
    .slice(0, 3)
    .map((o) => `<a href="https://t.me/${esc(o.channel)}" target="_blank" rel="noopener" title="Stessa offerta anche qui">@${esc(o.channel)}</a>`)
    .join("");
  const isSeen = state.seen.has(d.key);

  return `
  <article class="card ${isNew ? "is-new" : ""}" data-key="${esc(d.key)}">
    <a class="card-media" href="${esc(d.url || d.telegramUrl)}" target="_blank" rel="noopener nofollow sponsored" aria-label="${esc(d.title)}">
      ${img}
      ${d.discount ? `<span class="badge-discount">−${d.discount}%</span>` : `<span class="badge-discount soft">offerta</span>`}
      ${isNew ? `<span class="badge-new">NUOVA</span>` : ""}
    </a>
    <div class="card-body">
      <div class="card-meta">
        ${d.categoryLabel ? `<span class="pill cat">${esc(d.categoryLabel)}</span>` : ""}
        ${d.brand ? `<span class="pill brand">${esc(d.brand)}</span>` : ""}
        ${d.store ? `<span class="pill">${esc(d.store)}</span>` : ""}
      </div>
      <h3 class="card-title">${esc(d.title)}</h3>
      <div class="card-price-row">
        ${price ? `<span class="price-now">${price}</span>` : `<span class="price-now" style="font-size:16px;color:var(--muted)">prezzo nel post</span>`}
        ${old ? `<span class="price-old">${old}</span>` : ""}
        ${save ? `<span class="price-save">risparmi ${save}</span>` : ""}
      </div>
      <div class="price-note ${d.priceSource === "verified" ? "ok" : d.priceSuspect ? "warn" : ""}">
        ${
          d.priceSource === "verified"
            ? `${ICON.verified}<span>prezzo verificato${d.priceVerifiedAt ? ` · ${timeAgoIt(d.priceVerifiedAt)}` : ""}</span>`
            : d.priceSuspect
              ? `<span title="${esc(d.priceSuspectReason || "")}">⚠︎ prezzo dichiarato dal canale — da verificare sullo store</span>`
              : `<span>prezzo indicato dal canale</span>`
        }
      </div>
      <div class="card-foot">
        <span class="src" title="Pubblicata da @${esc(d.channel)}">
          ${d.channelPhoto ? `<img src="${esc(d.channelPhoto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
          <span>@${esc(d.channel)}</span>
          <span class="src-time">· ${esc(timeAgoIt(d.postedAt))}</span>
        </span>
        <div class="card-actions">
          <button class="icon-btn ${isSeen ? "on" : ""}" data-act="seen" title="Segna come vista" aria-label="Segna come vista">${isSeen ? ICON.check : ICON.square}</button>
          <button class="icon-btn" data-act="copy" title="Copia link" aria-label="Copia link">${ICON.link}</button>
          <button class="icon-btn" data-act="tg" title="Apri il post su Telegram" aria-label="Apri Telegram">${ICON.plane}</button>
        </div>
      </div>
      ${alsoOn ? `<div class="also-on">${alsoOn}</div>` : ""}
      <a class="card-cta" href="${esc(d.url || d.telegramUrl)}" target="_blank" rel="noopener nofollow sponsored">
        ${ICON.cart}<span>${price ? `Vai all'offerta · ${price}` : "Vedi l'offerta"}</span>
      </a>
    </div>
  </article>`;
}

function render({ newKeys = new Set() } = {}) {
  const deals = state.deals;
  el.feed.innerHTML = deals.map((d) => cardHtml(d, newKeys.has(d.key))).join("");
  el.empty.hidden = deals.length > 0;
  el.resultCount.innerHTML =
    deals.length === 0
      ? "Nessuna offerta trovata"
      : `<strong>${deals.length}</strong> offerte mostrate · <strong>${state.total}</strong> in archivio`;
  el.loadMore.hidden = deals.length >= state.total || deals.length === 0;
}

function setLive(kind, text) {
  el.livePill.classList.toggle("offline", kind === "offline");
  el.livePill.classList.toggle("scanning", kind === "scanning");
  el.liveText.textContent = text;
}

function updateNewPill() {
  el.newPill.hidden = state.newCount === 0;
  el.newPillCount.textContent = state.newCount;
}

/* ──────────────  Toast + suono  ────────────── */
let audioCtx = null;
function beep() {
  if (!state.soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.32);
  } catch {
    /* niente audio */
  }
}

function toast(deal) {
  const price = euro(deal.price);
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `
    ${deal.image ? `<img src="${esc(deal.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : `<div class="t-ph">${ICON.plane.replace("plane", "plane")}</div>`}
    <div class="t-body">
      <div class="t-title">Nuova offerta · @${esc(deal.channel)}</div>
      <div class="t-text">${esc(deal.title)}</div>
      <div class="t-text"><span class="t-price">${price || ""}</span> ${
        deal.discount ? `· −${deal.discount}%` : ""
      }</div>
    </div>`;
  node.addEventListener("click", () => {
    window.open(deal.url || deal.telegramUrl, "_blank", "noopener");
    dismiss();
  });
  el.toastStack.prepend(node);
  const dismiss = () => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 250);
  };
  setTimeout(dismiss, 7000);
  while (el.toastStack.children.length > 3) el.toastStack.lastElementChild.remove();
  beep();
}

/* ──────────────  SSE: tempo reale  ────────────── */
let es = null;
function connectSSE() {
  if (es) es.close();
  es = new EventSource("/api/events");

  es.addEventListener("hello", () => {
    state.live = true;
    setLive("ok", "in tempo reale");
  });

  es.addEventListener("deal:new", (ev) => {
    const deal = JSON.parse(ev.data);
    // mostra toast + segna come nuova
    toast(deal);
    if (!state.deals.some((d) => d.key === deal.key)) {
      state.newCount += 1;
      updateNewPill();
      state.deals.unshift(deal);
      state.total += 1;
      if (state.deals.length > state.limit) state.deals.pop();
      render({ newKeys: new Set([deal.key]) });
    }
    loadStats();
  });

  es.addEventListener("scan:start", () => setLive("scanning", "scansione canali…"));
  es.addEventListener("scan:end", (ev) => {
    let d = {};
    try { d = JSON.parse(ev.data); } catch { /* ignore */ }
    setLive("ok", d.lastScanAt ? `aggiornato ${timeAgoIt(d.lastScanAt)}` : "in tempo reale");
    loadStats();
  });
  es.addEventListener("source:error", () => {});
  es.addEventListener("ping", () => {
    state.live = true;
    setLive("ok", "in tempo reale");
  });

  es.onerror = () => {
    state.live = false;
    setLive("offline", "riconnessione…");
    es.close();
    setTimeout(connectSSE, 4000);
  };
}

/* ──────────────  Eventi UI  ────────────── */
el.search.addEventListener(
  "input",
  debounce(() => {
    state.q = el.search.value.trim();
    el.clearSearch.hidden = !state.q;
    state.offset = 0;
    loadDeals();
  }, 280),
);

el.clearSearch.addEventListener("click", () => {
  el.search.value = "";
  state.q = "";
  el.clearSearch.hidden = true;
  loadDeals();
});

el.sort.addEventListener("change", () => {
  state.sort = el.sort.value;
  loadDeals();
});

el.filtersToggle.addEventListener("click", () => {
  const open = el.filters.hidden;
  el.filters.hidden = !open;
  el.filtersToggle.setAttribute("aria-expanded", String(open));
});

el.categoryChips.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  state.category = state.category === b.dataset.cat ? null : b.dataset.cat;
  renderFilterChips();
  loadDeals();
});

el.brandChips.addEventListener("click", (e) => {
  const b = e.target.closest("[data-brand]");
  if (!b) return;
  state.brand = state.brand === b.dataset.brand ? null : b.dataset.brand;
  renderFilterChips();
  loadDeals();
});

el.storeChips.addEventListener("click", (e) => {
  const b = e.target.closest("[data-store]");
  if (!b) return;
  state.store = state.store === b.dataset.store ? null : b.dataset.store;
  renderFilterChips();
  loadDeals();
});

el.maxPrice.addEventListener("input", () => {
  state.maxPrice = Number(el.maxPrice.value);
  el.maxPriceOut.textContent = state.maxPrice >= 600 ? "tutti" : `fino a ${euro(state.maxPrice)}`;
});
el.maxPrice.addEventListener("change", () => loadDeals());

el.minDiscount.addEventListener("input", () => {
  state.minDiscount = Number(el.minDiscount.value);
  el.minDiscountOut.textContent = `${state.minDiscount}%`;
});
el.minDiscount.addEventListener("change", () => loadDeals());

el.only24.addEventListener("change", () => {
  state.only24 = el.only24.checked;
  loadDeals();
});
el.hideSeen.addEventListener("change", () => {
  state.hideSeen = el.hideSeen.checked;
  loadDeals();
});

const resetFilters = () => {
  state.q = "";
  state.brand = state.store = state.category = null;
  state.maxPrice = 600;
  state.minDiscount = 0;
  state.only24 = state.hideSeen = false;
  state.sort = "recent";
  el.search.value = "";
  el.clearSearch.hidden = true;
  el.sort.value = "recent";
  el.maxPrice.value = 600;
  el.maxPriceOut.textContent = "tutti";
  el.minDiscount.value = 0;
  el.minDiscountOut.textContent = "0%";
  el.only24.checked = false;
  el.hideSeen.checked = false;
  renderFilterChips();
  loadDeals();
};
$("#resetFilters").addEventListener("click", resetFilters);
$("#emptyReset").addEventListener("click", resetFilters);

el.loadMore.addEventListener("click", () => loadDeals({ append: true }));

$("#refreshBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (MODE === "static") {
    // rileggo subito i canali Telegram e poi ricarico data.json con cache bypassata
    await scanNow({ manual: true });
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      try {
        STATIC_DATA = await res.json();
        seedLiveData();
        saveArchive();
        await Promise.all([loadStats(), loadDeals()]);
      } catch {
        /* data.json non aggiornato: resto sull'archivio locale */
      }
    }
    return;
  }
  btn.disabled = true;
  btn.textContent = "↻ aggiorno…";
  try {
    const r = await fetch("/api/scan", { method: "POST" }).then((x) => x.json()).catch(() => ({}));
    if (r?.throttled) {
      btn.textContent = `attendi ${r.waitSeconds}s`;
      await new Promise((res) => setTimeout(res, 900));
    } else {
      await new Promise((res) => setTimeout(res, 4000));
    }
    await Promise.all([loadStats(), loadDeals()]);
  } finally {
    btn.disabled = false;
    btn.textContent = "↻ Aggiorna ora";
  }
});

$("#csvBtn").addEventListener("click", () => {
  const rows = [
    ["Titolo", "Prezzo", "PrezzoPieno", "Sconto%", "Marca", "Categoria", "Store", "Canale", "Pubblicata", "Link"],
    ...state.deals.map((d) => [
      d.title,
      d.price ?? "",
      d.oldPrice ?? "",
      d.discount ?? "",
      d.brand ?? "",
      d.categoryLabel ?? "",
      d.store ?? "",
      d.channel,
      d.postedAt,
      d.url ?? "",
    ]),
  ];
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `offerte-auricolari-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#soundToggle").addEventListener("click", (e) => {
  state.soundOn = !state.soundOn;
  localStorage.setItem("ar_sound", state.soundOn ? "1" : "0");
  e.currentTarget.setAttribute("aria-pressed", String(state.soundOn));
  e.currentTarget.title = state.soundOn ? "Avviso sonoro attivo" : "Avviso sonoro disattivato";
  if (state.soundOn) beep();
});

el.newPill.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
  state.newCount = 0;
  updateNewPill();
});

// Azioni sulle card
el.feed.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest(".card");
  const deal = state.deals.find((d) => d.key === card?.dataset.key);
  if (!deal) return;
  const act = btn.dataset.act;
  if (act === "copy") {
    try {
      await navigator.clipboard.writeText(deal.url || deal.telegramUrl);
      btn.innerHTML = ICON.check;
      setTimeout(() => (btn.innerHTML = ICON.link), 1200);
    } catch {
      /* clipboard bloccata */
    }
  }
  if (act === "tg") window.open(deal.telegramUrl, "_blank", "noopener");
  if (act === "seen") {
    if (state.seen.has(deal.key)) state.seen.delete(deal.key);
    else state.seen.add(deal.key);
    localStorage.setItem("ar_seen", JSON.stringify([...state.seen].slice(-2000)));
    btn.classList.toggle("on", state.seen.has(deal.key));
    btn.innerHTML = state.seen.has(deal.key) ? ICON.check : ICON.square;
  }
});

/* ──────────────  Modal canali  ────────────── */
$("#settingsBtn").addEventListener("click", async () => {
  el.modal.hidden = false;
  await loadChannels();
});
$("#modalClose").addEventListener("click", () => (el.modal.hidden = true));
el.modal.addEventListener("click", (e) => {
  if (e.target === el.modal) el.modal.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") el.modal.hidden = true;
  if (e.key === "/" && document.activeElement !== el.search) {
    e.preventDefault();
    el.search.focus();
  }
});

async function loadChannels() {
  try {
    if (MODE === "static") {
      const extra = new Set(JSON.parse(localStorage.getItem("ar_extra_channels") || "[]"));
      const list = currentChannels();
      state.channels = list;
      const newByChannel = LIVE.lastResult
        ? Object.fromEntries(
            LIVE.deals
              .filter((d) => !d.firstSeenAt || Date.now() - new Date(d.firstSeenAt).getTime() < 86400000)
              .map((d) => [d.channel, true]),
          )
        : {};
      el.channelManage.innerHTML = list
        .map(
          (c) => `
        <li>
          ${c.photo ? `<img src="${esc(c.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : "📣"}
          <span class="nm">
            @${esc(c.channel)}
            <small>${LIVE.channels[c.channel]?.error ? `<span class="tag-err">errore recente</span>` : `${c.newDeals || (newByChannel[c.channel] ? 1 : 0) || 0} ${(c.newDeals || 0) === 1 ? "offerta" : "offerte"} nelle ultime 24h`}</small>
          </span>
          <a class="btn ghost small" href="https://t.me/${esc(c.channel)}" target="_blank" rel="noopener">apri</a>
          ${extra.has(c.channel) ? `<button class="del" data-ch="${esc(c.channel)}">rimuovi</button>` : ""}
        </li>`,
        )
        .join("");
      applyMode();
      renderChannelFooter();
      renderStats();
      return;
    }
    const [data, stats] = await Promise.all([api("/channels"), api("/stats")]);
    state.channels = data.channels;
    el.channelManage.innerHTML = data.channels
      .map(
        (c) => `
      <li>
        ${c.photo ? `<img src="${esc(c.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : "📣"}
        <span class="nm">
          @${esc(c.channel)}
          <small>${c.error ? `<span class="tag-err">errore: ${esc(c.error)}</span>` : `${c.newDeals || 0} ${(c.newDeals || 0) === 1 ? "offerta trovata" : "offerte trovate"}`}</small>
        </span>
        <a class="btn ghost small" href="https://t.me/${esc(c.channel)}" target="_blank" rel="noopener">apri</a>
        ${MODE === "static" ? "" : `<button class="del" data-ch="${esc(c.channel)}">rimuovi</button>`}
      </li>`,
      )
      .join("");
    el.botStatus.textContent = stats.botEnabled
      ? `Bot Telegram attivo${stats.channelPublishEnabled ? " e collegato a un canale" : ""} ✅`
      : "Bot Telegram non configurato: imposta TELEGRAM_BOT_TOKEN nel file .env per ricevere le notifiche su Telegram.";
    renderChannelFooter();
    renderStats();
  } catch (err) {
    el.channelManage.innerHTML = `<li>Impossibile caricare i canali: ${esc(err.message)}</li>`;
  }
}

el.channelManage.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ch]");
  if (!b) return;
  b.disabled = true;
  if (MODE === "static") {
    const extra = JSON.parse(localStorage.getItem("ar_extra_channels") || "[]").filter((c) => c !== b.dataset.ch);
    localStorage.setItem("ar_extra_channels", JSON.stringify(extra));
    await loadChannels();
    return;
  }
  try {
    await api("/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remove: b.dataset.ch }),
    });
    await loadChannels();
    loadDeals();
  } catch (err) {
    alert(`Errore: ${err.message}`);
  }
});

$("#addChannelBtn").addEventListener("click", async () => {
  const raw = el.newChannel.value.trim();
  const name = raw.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  if (!name) return;
  const btn = $("#addChannelBtn");
  btn.disabled = true;
  btn.textContent = "…";
  if (MODE === "static") {
    const extra = new Set(JSON.parse(localStorage.getItem("ar_extra_channels") || "[]"));
    extra.add(name);
    localStorage.setItem("ar_extra_channels", JSON.stringify([...extra]));
    el.newChannel.value = "";
    await scanNow({ manual: true });
    await loadChannels();
    btn.disabled = false;
    btn.textContent = "Aggiungi";
    return;
  }
  try {
    await api("/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ add: name }),
    });
    el.newChannel.value = "";
    await loadChannels();
    setTimeout(loadDeals, 2500);
  } catch (err) {
    alert(`Errore: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Aggiungi";
  }
});
el.newChannel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#addChannelBtn").click();
});

/* ──────────────  Init  ────────────── */
async function init() {
  $("#soundToggle").setAttribute("aria-pressed", String(state.soundOn));
  $("#soundToggle").title = state.soundOn ? "Avviso sonoro attivo" : "Avviso sonoro disattivato";

  const boot = await loadBootstrap();
  state.channels = boot.channels;
  if (boot.channels.length) $("#heroChannels").textContent = boot.channels.length;
  applyMode();

  if (MODE === "static") {
    loadArchive();
    seedLiveData();
    state.channels = currentChannels();
    if (state.channels.length) $("#heroChannels").textContent = state.channels.length;
  }

  await Promise.all([loadStats(), loadDeals()]);
  await loadStats();

  if (MODE === "live") {
    connectSSE();
    setInterval(loadStats, 60000); // stats fresche
  } else {
    const label = () => {
      if (LIVE.busy) return;
      const when = LIVE.generatedAt || STATIC_DATA?.generatedAt;
      const ago = when ? timeAgoIt(when) : "";
      setLive("ok", when ? `aggiornato ${ago}` : "pronto");
    };
    label();
    setInterval(label, 30000);
    // ogni tanto ricordo quando è stato fatto l'ultimo controllo
    setInterval(() => {
      if (LIVE.busy || !LIVE.lastResult) return;
      const r = LIVE.lastResult;
      if (Date.now() - new Date(r.at).getTime() < 25000) return;
      setLive(r.ok ? "ok" : "offline", r.ok ? `ultimo controllo ${timeAgoIt(r.at)}` : "canali non raggiungibili");
    }, 60000);
    renderBotStatus();
    startAutoScan();
  }
}

init();
