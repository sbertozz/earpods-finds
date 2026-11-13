/* ───────────────────────────────────────────────────────────────
   lib/tg.js — motore di scansione condiviso (browser + Node)
   Legge l'anteprima pubblica dei canali Telegram (t.me/s/<canale>),
   estrae le offerte di auricolari/cuffie e le normalizza nel formato
   usato da index.html / app.js / data.json.
   Nessuna dipendenza esterna: usa solo espressioni regolari.
   ─────────────────────────────────────────────────────────────── */

import { MODELS, matchModel, deriveModelKey, specsFromText, mergeSpecs } from "./models.js";

export const DEFAULT_CHANNELS = [
  "sconticina",
  "offertedale",
  "prezzitech",
  "offertepuntotech",
  "mente_informatica",
  "offertesmartworld",
  "offerte_best",
  "scontify",
  "sconty_online",
];

/** Metadati di riserva (se la pagina non li espone) */
export const CHANNEL_INFO = {
  offertepuntotech: { title: "offerte.tech by Andrea Galeazzi" },
  mente_informatica: { title: "Mente Informatica | Offerte Tech ⚡" },
  offertesmartworld: { title: "Offerte Tecnologia SmartWorld.it" },
  prezzitech: { title: "Migliori Offerte Tech - Prezzi.Tech" },
  offertedale: { title: "OfferteDale" },
  sconticina: { title: "ScontiCina.it® - Canale Ufficiale" },
  scontify: { title: "Scontify.net🦊 Migliori Offerte" },
  offerte_best: { title: "Offerte Best" },
  sconty_online: { title: "SCONTY ONLINE - Le offerte di Greta" },
};

/* ═══════════════ 1. utility testo/HTML ═══════════════ */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", deg: "°",
  euro: "€", times: "×", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", plusmn: "±",
  agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù",
};

export function decodeEntities(s = "") {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = body.toLowerCase();
    return key in NAMED_ENTITIES ? NAMED_ENTITIES[key] : m;
  });
}

/** HTML → testo semplice (i <br> e i blocchi diventano a capo) */
export function stripTags(html = "") {
  const txt = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(txt).replace(/\r/g, "").replace(/\u00a0/g, " ");
}

function collapse(s = "") {
  return String(s).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** hash stabile (FNV-1a doppio) → 12 caratteri hex */
export function hash(str = "") {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) * 0x01000193;
    h2 = (h2 + c * 31) ^ (h2 << 5);
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return (hex(h1) + hex(h2)).slice(0, 12);
}

/** normalizzazione per confronti/dedupe */
export function norm(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "1.2K" / "12 345" / "1,1 M" → numero */
export function parseViews(raw) {
  if (!raw) return 0;
  const s = String(raw).replace(/\s/g, "").replace(",", ".");
  const m = s.match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return 0;
  const n = parseFloat(m[1]) || 0;
  const mult = m[2] ? (m[2].toLowerCase() === "m" ? 1e6 : 1e3) : 1;
  return Math.round(n * mult);
}

/** "1.403,22" | "199.99" | "93,6" | "1.299" → numero */
export function parsePrice(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[^\d.,]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (hasComma) {
    const p = s.split(",");
    s = p.length > 2 || (p[1] || "").length === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot) {
    const p = s.split(".");
    if (p.length > 2 || (p[1] || "").length === 3) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function timeAgoIt(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const d = Math.max(0, Math.round((now - t) / 1000));
  if (d < 45) return "ora";
  if (d < 90) return "1 min fa";
  const m = Math.round(d / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(d / 3600);
  if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
  const g = Math.round(d / 86400);
  return g < 30 ? `${g} ${g === 1 ? "giorno" : "giorni"} fa` : `${Math.round(g / 30)} mesi fa`;
}

/* ═══════════════ 2. parsing dell'anteprima Telegram ═══════════════ */

/** estrae il contenuto di un <div> bilanciato a partire dall'indice del tag */
function balancedDiv(html, startIdx) {
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = startIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth <= 0) return html.slice(startIdx, m.index);
    } else if (!/\/>\s*$/.test(m[0])) {
      depth += 1;
    }
  }
  return html.slice(startIdx, Math.min(html.length, startIdx + 8000));
}

function findTextHtml(seg) {
  const m = /<div[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>/i.exec(seg);
  if (!m) return "";
  const start = m.index;
  const bodyStart = start + m[0].length;
  const inner = balancedDiv(seg.slice(0, bodyStart) + seg.slice(bodyStart), start);
  return inner.slice(m[0].length);
}

function findPhoto(seg) {
  const urls = [];
  const re = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi;
  let m;
  while ((m = re.exec(seg))) {
    const before = seg.slice(Math.max(0, m.index - 600), m.index);
    if (/tgme_widget_message_photo_wrap|tgme_widget_message_video_thumb|link_preview/i.test(before)) {
      urls.push(m[1].replace(/\\/g, ""));
    }
  }
  const direct = /<a[^>]*tgme_widget_message_photo_wrap[^>]*>/i.exec(seg);
  if (!urls.length && direct) {
    const url = /url\(['"]?([^'")]+)['"]?\)/.exec(direct[0]);
    if (url) urls.push(url[1]);
  }
  const yt = /https:\/\/i\.ytimg\.com\/[^"'\s)]+/.exec(seg);
  if (!urls.length && yt) urls.push(yt[0]);
  return urls[0] || null;
}

/** link preview (titolo/descrizione/immagine/sito) */
function findLinkPreview(seg) {
  const idx = seg.search(/tgme_widget_message_link_preview/i);
  if (idx === -1) return null;
  const chunk = seg.slice(idx, idx + 4000);
  const grab = (cls) => {
    const m = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/`, "i").exec(chunk);
    return m ? decodeEntities(m[1].replace(/<[^>]*>/g, "")).trim() : null;
  };
  const href = /<a[^>]*href="([^"]+)"/i.exec(chunk);
  const img = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/i.exec(chunk);
  return {
    url: href ? decodeEntities(href[1]) : null,
    siteName: grab("link_preview_site_name"),
    title: grab("link_preview_title"),
    description: grab("link_preview_description"),
    image: img ? img[1] : null,
  };
}

/** HTML → righe [{ text, links:[{href,text}] }] */
export function htmlToLines(textHtml = "") {
  const pieces = String(textHtml).split(/<br\s*\/?>|<\/p>/i);
  const lines = [];
  for (const piece of pieces) {
    const links = [];
    const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(piece))) {
      links.push({ href: decodeEntities(m[1]), text: collapse(stripTags(m[2])) });
    }
    const text = collapse(stripTags(piece));
    if (text || links.length) lines.push({ text, links });
  }
  return lines;
}

export function extractChannelInfo(html = "", channel = "") {
  const info = { channel, title: null, description: null, photo: null, subscribers: null };
  const title = /class="[^"]*tgme_channel_info_header_title[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (title) info.title = collapse(stripTags(title[1])) || null;
  if (!info.title) {
    const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html);
    if (og) info.title = decodeEntities(og[1]).replace(/\s*[–-]\s*Telegram\s*$/i, "").trim();
  }
  const photo = /class="[^"]*tgme_page_photo_image[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"/i.exec(html);
  if (photo) info.photo = decodeEntities(photo[1]);
  const desc = /class="[^"]*tgme_channel_info_description[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (desc) info.description = collapse(stripTags(desc[1])).slice(0, 400) || null;
  const subs = /<span class="[^"]*tgme_channel_info_counter_value[^"]*"[^>]*>([^<]+)<\/span>\s*<span class="[^"]*tgme_channel_info_counter_title/i.exec(html);
  if (subs) info.subscribers = collapse(subs[1]);
  if (!info.title && CHANNEL_INFO[channel]) info.title = CHANNEL_INFO[channel].title;
  return info;
}

/**
 * Analizza la pagina t.me/s/<canale> e restituisce i post.
 * @returns {{channel:string, info:object, posts:Array}}
 */
export function parseChannelPage(html = "", channel = "") {
  const out = { channel, info: extractChannelInfo(html, channel), posts: [] };
  if (!html || typeof html !== "string") return out;

  const re = /data-post="([A-Za-z0-9_]+)\/(\d+)"/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) {
    if (m[1].toLowerCase() !== channel.toLowerCase()) continue;
    marks.push({ idx: m.index, id: Number(m[2]) });
  }
  const seen = new Set();
  for (let i = 0; i < marks.length; i++) {
    const { idx, id } = marks[i];
    if (seen.has(id)) continue;
    seen.add(id);
    const end = i + 1 < marks.length ? marks[i + 1].idx : Math.min(html.length, idx + 24000);
    const seg = html.slice(idx, end);
    const timeM = /<time[^>]*datetime="([^"]+)"/i.exec(seg);
    const viewsM = /class="[^"]*tgme_widget_message_views[^"]*"[^>]*>([^<]*)</i.exec(seg);
    const textHtml = findTextHtml(seg);
    const text = collapse(stripTags(textHtml));
    const preview = findLinkPreview(seg);
    out.posts.push({
      channel,
      id,
      datetime: timeM ? timeM[1] : null,
      views: parseViews(viewsM ? viewsM[1] : ""),
      text,
      lines: htmlToLines(textHtml),
      photo: findPhoto(seg),
      preview,
      messageUrl: `https://t.me/${channel}/${id}`,
    });
  }
  out.posts.sort((a, b) => new Date(a.datetime || 0) - new Date(b.datetime || 0));
  return out;
}

/* ═══════════════ 3. classificazione delle offerte ═══════════════ */

const STORES = {
  amazon: "Amazon", aliexpress: "AliExpress", unieuro: "Unieuro", mediaworld: "MediaWorld",
  ebay: "eBay", temu: "Temu", banggood: "Banggood", gearbest: "GearBest",
  cdiscount: "Cdiscount", shein: "Shein", decathlon: "Decathlon", euronics: "Euronics",
  trony: "Trony", expert: "Expert", comet: "Comet", zalando: "Zalando",
  aliexpress_it: "AliExpress", mi: "Xiaomi Store", scontify: "Scontify",
};

const DOMAIN_STORES = [
  [/amazon\./i, "Amazon"], [/aliexpress\./i, "AliExpress"], [/ebay\./i, "eBay"],
  [/mediaworld\./i, "MediaWorld"], [/unieuro\./i, "Unieuro"], [/euronics\./i, "Euronics"],
  [/trony\./i, "Trony"], [/temu\./i, "Temu"], [/banggood\./i, "Banggood"],
  [/cdiscount\./i, "Cdiscount"], [/shein\./i, "Shein"], [/zalando\./i, "Zalando"],
  [/decathlon\./i, "Decathlon"], [/gearbest\./i, "GearBest"],
];

const BRANDS = [
  ["Bowers & Wilkins", /\bbowers\s*&\s*wilkins|\bb&w\b/i],
  ["Bang & Olufsen", /\bbang\s*&\s*olufsen|\bb&o\b/i],
  ["Audio-Technica", /audio[-\s]?technica/i],
  ["Sennheiser", /\bsennheiser\b/i],
  ["Beyerdynamic", /beyerdynamic/i],
  ["Skullcandy", /skullcandy/i],
  ["Logitech", /\blogitech\b|\bg\s?pro\b|\bastro\b|\bg\s?435\b|\bg325\b/i],
  ["Marshall", /\bmarshall\b/i],
  ["Bose", /\bbose\b|\bquietcomfort\b/i],
  ["Sony", /\bsony\b|\bwf-1000|\bwh-1000|\blinkbuds\b|\bch-?520\b/i],
  ["Samsung", /\bsamsung\b|\bgalaxy\s*buds\b/i],
  ["Apple", /\bapple\b|\bairpods?\b/i],
  ["Beats", /\bbeats\b|\bpowerbeats\b|\bstudio\s*(?:pro|buds|3)\b|\bsolo\s*(?:3|4)\b|\bfit\s*pro\b/i],
  ["Google", /\bgoogle\b|\bpixel\s*buds?\b/i],
  ["Huawei", /\bhuawei\b|\bfreebuds\b|\bfreeclip\b/i],
  ["Honor", /\bhonor\b/i],
  ["Xiaomi", /\bxiaomi\b|\bredmi\b|\bpoco\b/i],
  ["Nothing", /\bnothing\b|\bcmf\b/i],
  ["Turtle Beach", /turtle\s*beach/i],
  ["SteelSeries", /steelseries/i],
  ["Shokz", /\bshokz\b|\bafter\s*shokz\b|\bopenrun\b|\bopenfit\b/i],
  ["OnePlus", /\boneplus\b/i],
  ["Realme", /\brealme\b/i],
  ["Oppo", /\boppo\b/i],
  ["Vivo", /\bvivo\b/i],
  ["Anker", /\banker\b|\bsoundcore\b|\bnebula\b/i],
  ["Edifier", /\bedifier\b/i],
  ["JBL", /\bjbl\b/i],
  ["Jabra", /\bjabra\b/i],
  ["Lenovo", /\blenovo\b/i],
  ["Motorola", /\bmotorola\b|\bmoto\b/i],
  ["Nokia", /\bnokia\b/i],
  ["Philips", /\bphilips\b/i],
  ["Panasonic", /\bpanasonic\b|\btechnics\b/i],
  ["Denon", /\bdenon\b/i],
  ["Devialet", /\bdevialet\b/i],
  ["Sonos", /\bsonos\b/i],
  ["Razer", /\brazer\b/i],
  ["HyperX", /\bhyperx\b/i],
  ["Corsair", /\bcorsair\b/i],
  ["Trust", /\btrust\b|\bgxtrust\b|\bgxt\b/i],
  ["Boytond", /\bboytond\b/i],
  ["QCY", /\bqcy\b/i],
  ["Baseus", /\bbaseus\b/i],
  ["Ugreen", /\bugreen\b/i],
  ["Haylou", /\bhaylou\b/i],
  ["Tribit", /\btribit\b/i],
  ["EarFun", /\bearfun\b/i],
  ["SoundPEATS", /soundpeats/i],
  ["TOZO", /\btozo\b/i],
  ["1MORE", /\b1more\b/i],
  ["KZ", /\bkz\b/i],
  ["Moondrop", /moondrop/i],
  ["FiiO", /\bfiio\b/i],
  ["Creative", /\bcreative\b/i],
  ["Aukey", /\baukey\b/i],
  ["Mpow", /\bmpow\b/i],
  ["TaoTronics", /taotronics/i],
  ["Belkin", /\bbelkin\b/i],
  ["Garmin", /\bgarmin\b/i],
  ["Irradio", /\birradio\b|\bir[- ]?h606\b/i],
  ["Lenco", /\blenco\b/i],
  ["Muse", /\bmuse\b/i],
];

const AUDIO_POSITIVE = /(?:\b)(?:cuffie|cuffia|auricolari?|earbuds?|earphones?|headphones?|headset|airpods?|freebuds|tws|true[-\s]?wireless|in[-\s]?ear|on[-\s]?ear|over[-\s]?ear|open[-\s]?ear|earclips?|soundcore|pixel\s*buds?|galaxy\s*buds?|redmi\s*buds?|nothing\s*ear|wh-1000|wf-1000|quietcomfort|liberty\s*[34]|neobuds?|soundpeats|earfun|shokz|bone\s+conduction)(?:\b|$)/iu;

const AUDIO_NEGATIVE = /(?:\b|^)(?:soundbar|diffusor[ei]?|speaker|casse|altoparlant[ei]|robot|aspirapolvere|lavapavimenti|tv|televisore|monitor|smartwatch|orologio|tablet|power\s*bank|caricatore|mouse|tastiera|drone|action\s*cam|fotocamera|camera|console|joypad|controller|hard\s*disk|ssd|router|stampante|proiettore|lampada|ventilatore|frullatore|microonde|phon|asciugacapelli|smartphone|telefono|lavatrice|frigorifero|condizionatore|depuratore|bilancia|segway|scooter|bici(?:cletta)?|e-?bike)(?:\b|$)/iu;

const CATEGORY_LABELS = {
  tws: ["True wireless", "🎧"],
  cuffie: ["Cuffie over-ear", "🎧"],
  anc: ["Con ANC", "🔇"], // legacy: ora l'ANC è un flag (hasAnc)
  gaming: ["Gaming", "🎮"],
  sport: ["Sport", "🏃"],
  open: ["Open-ear / clip", "👂"],
};

/* form factor ricavato dall'anagrafica modelli (lib/models.js) */
const FORM_TO_CATEGORY = {
  tws: "tws",
  "over-ear": "cuffie",
  "on-ear": "cuffie",
  open: "open",
  sport: "sport",
  gaming: "gaming",
};

/** true se il testo parla esplicitamente di cancellazione del rumore */
export function hasAncText(text = "") {
  return /\b(anc|enc|noise\s*cancel\w*|cancellazione\s+(?:attiva\s+)?(?:del\s+|della\s+)?rumore|anti[-\s]?rumore|quietcomfort|\d{2}\s*db)\b/i.test(String(text));
}

/* regex "solo nome marchio", costruite dai nomi canonici: servono a dare
   precedenza a chi il marchio lo scrive per esteso ("UGREEN Studio Pro"
   non è un Beats Studio Pro). */
const escapeRe = (x = "") => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BRAND_NAMES = (() => {
  const names = new Set(BRANDS.map(([n]) => n));
  for (const m of MODELS) names.add(m.brand);
  return [...names]
    .filter((n) => n && n.length >= 3)
    .sort((a, b) => b.length - a.length)
    .map((name) => {
      const parts = name.split(/[\s&]+/).filter(Boolean).map(escapeRe);
      return [name, new RegExp(`(?:^|[^a-z])${parts.join("[\\s&]+")}(?:[^a-z]|$)`, "i")];
    });
})();

/**
 * Marchio: prima il nome scritto per esteso nel titolo, poi l'anagrafica
 * modelli (risolve titoli senza marca, es. "Pixel Buds Pro 2" → Google),
 * solo alla fine le regex di famiglia prodotto nel corpo del post.
 * @param {string} text titolo + contesto
 * @param {string} [titleOnly] titolo del prodotto (peso maggiore)
 */
export function detectBrand(text = "", titleOnly = "") {
  const title = titleOnly || text;
  const hay = `${title || ""} ${text || ""}`;

  // 1) nome marchio esplicito (vince il primo che compare nel titolo)
  let bestName = null;
  for (const [name, re] of BRAND_NAMES) {
    const m = re.exec(title);
    if (m && (!bestName || m.index < bestName.index || (m.index === bestName.index && name.length > bestName.name.length))) {
      bestName = { name, index: m.index };
    }
  }
  if (bestName) return bestName.name;

  // 2) anagrafica modelli
  const known = matchModel(hay);
  if (known?.entry?.brand) return known.entry.brand;

  // 3) famiglie di prodotto note ("galaxy buds" → Samsung, "soundcore" → Anker)
  for (const [name, re] of BRANDS) if (re.test(title)) return name;
  for (const [name, re] of BRANDS) if (re.test(text)) return name;
  return null;
}

/**
 * Categoria merceologica = forma fisica (tws / cuffie / open / sport / gaming).
 * L'ANC non è più una categoria: viene tracciata a parte con `hasAnc`,
 * così "Cuffie over-ear" e "True wireless" non si mangiano i modelli ANC.
 * @param {string} text titolo + corpo
 * @param {string} [titleOnly]
 */
export function detectCategory(text = "", titleOnly = "") {
  const t = `${titleOnly || ""} ${text || ""}`;
  const head = titleOnly || text;

  const known = matchModel(t);
  const headKnown = matchModel(head);
  if (known?.entry) {
    const base = FORM_TO_CATEGORY[known.entry.form] || "cuffie";
    // il titolo ha l'ultima parola sulla forma fisica dichiarata
    if (base === "tws" && /\b(?:open[-\s]?ear|ear\s*clip)\b/i.test(head)) return "open";
    if (base === "tws" && /\b(sport|sportiv[ae]|running|corsa|palestra)\b/i.test(head)) return "sport";
    if (base === "open" && /\b(sport|sportiv[ae])\b/i.test(head) && /\bopen\b/i.test(head)) return "open";
    // un open-ear sportivo resta open; il gaming vince solo se dichiarato
    if (base === "sport" && /\b(gaming|gamer)\b/i.test(t)) return "gaming";
    return base;
  }

  if (/\b(gaming|gamer|ps5|playstation|xbox|lightspeed|arctis|hyperx\s*cloud|razer|steelseries)\b/i.test(head)) return "gaming";
  if (/\b(open[-\s]?ear|open\s+ear|ear\s*clip|clip[-\s]?on|bone\s+conduction|conduzione\s+ossea|shokz|openrun|openfit)\b/i.test(head)) return "open";
  if (/\b(sport|sportiv[ae]|running|corsa|palestra|nuoto|allenamento|ipx[5-8]|ip6[7-8])\b/i.test(head)) return "sport";
  if (/\b(tws|true[-\s]?wireless|auricolari?|earbuds?|earphones?|in[-\s]?ear|airpods?|freebuds|freeclip|pixel\s*buds?|galaxy\s*buds?|redmi\s*buds?|buds|ear\s*\(?[a1]\)?)\b/i.test(t)) return "tws";
  if (/\b(cuffie|cuffia|headphones?|headphone|over[-\s]?ear|around[-\s]?ear|on[-\s]?ear|headset)\b/i.test(t)) {
    if (/\b(sport|sportiv[ae]|running|corsa|palestra)\b/i.test(t)) return "sport";
    return "cuffie";
  }
  if (/\b(ner[oi]|bianc[ohe]|ocean\s*blu|cuffie\s+wireless)\b/i.test(t)) return "cuffie";
  return "cuffie";
}

export function isAudioOffer(title = "", text = "") {
  if (AUDIO_POSITIVE.test(title)) return true;
  if (AUDIO_NEGATIVE.test(title)) return false;
  if (!AUDIO_POSITIVE.test(text)) return false;
  // il testo può contenere anche altro (TV, casse…): scarto solo se l'audio
  // non compare proprio nel titolo ed è un accessorio/altro prodotto
  const audioInTitle = AUDIO_POSITIVE.test(title);
  return audioInTitle || !AUDIO_NEGATIVE.test(text.replace(AUDIO_POSITIVE, " "));
}

/* ── classificazione delle righe ── */

const RE_PRICE_PAIR = [
  /([\d][\d.,]*)\s*(?:€|eur(?:o)?)\s*(?:a\s+soli\s+)?(?:invece\s+di|anzich[eé]|al\s+posto\s+di|invece\s+che|rispetto\s+a|da)\s*([\d][\d.,]*)\s*(?:€|eur(?:o)?)?/i,
  /(?:da|invece\s+di)\s*([\d][\d.,]*)\s*(?:€|eur)?\s*(?:a|per|->|→|,)\s*([\d][\d.,]*)\s*(?:€|eur)/i,
];

const RE_HAS_PRICE = /(?:€|\beur(?:o)?\b)/i;
const RE_FOOTER = /(offerta\s+vista\s+su|altre\s+offerte|ottiene\s+commissioni|hai\s+risparmiato|hai\s+risparmiato|risparmi\s+\d|risparmio\s+di|sconto\s+automatico\s+(?:del|di)\s+\d|condiviso\s+da|#aff\b|#adv\b|spunta\s+box|coupon\s+gi[aà]\s+attivi|segui\s+tutte|iscriviti|unisciti|un\s+canale|le\s+migliori\s+offerte\s+del\s+giorno|migliori\s+offerte\s+tech\s+di\s+oggi|download\s+app|scopri\s+di\s+pi[uù]|commissioni\s+sulle\s+vendite|invita\s+un\s+amico)/i;
const RE_STORE_LINE = /^(?:[▪️•\-–]\s*)?#(amazon|aliexpress|unieuro|mediaworld|ebay|temu|banggood|gear\w*|shein|zalando|decathlon|euronics|trony|expert|comet)\b|^(?:[▪️•\-–]\s*)?(?:🛍️?|🏬|🏪)\s*[A-ZÀ-Ýa-z]/i;
const RE_VENDUTO = /(?:venduto(?:\s+e\s+spedito)?\s+da|spedito\s+da|consegna\s+a\s+domicilio)/i;
/** righe di venditore/spedizione: mai titoli, mai prezzi (il risparmio non è un prezzo) */
const RE_SELLER_ONLY = /^[\s🚛📦]*venduto\s+(?:e\s+spedito\s+)?da\s/i;
/** "hai risparmiato 106,00 €" — importo di risparmio, non un prezzo */
const RE_SAVINGS = /(?:hai\s+risparmiato|risparmi|risparmio|sconto\s+automatico|risparmia)\s*(?:di\s*)?[\d][\d.,]*\s*(?:€|eur(?:o)?)/i;
const RE_CTA = /(vedi\s+offerta|acquista|compra\s+ora|vai\s+all['’]offerta|approfitta|scopri\s+l['’]offerta|vedi\s+il\s+prodotto|clicca\s+qui)/i;
const RE_COUPON = /(coupon|sconto\s+automatico|codice)/i;
const RE_TITLE_MARKER = /^(?:🔷|🔹|📌|🎧|🎮|🎵|💥|⚡|🔥|❗️|❗|👉🏻|👉|✅|⭐️|⭐|🆕|🎁|➡️|➡|💶|💸|🤑|🏷️|🏷)\s*/u;
const RE_NUMBERED = /^\d{1,2}[).]\s*/;
/** "1) 👉🏻 Samsung TV…" → titolo pulito */
const RE_NUM_ITEM = /^\d{1,2}[).]\s*/;

function hasRealPrice(t) {
  if (!RE_HAS_PRICE.test(t)) return false;
  // "hai risparmiato 106,00 €": è un risparmio, non un prezzo
  if (RE_SAVINGS.test(t)) {
    const stripped = t.replace(RE_SAVINGS, " ");
    if (!RE_HAS_PRICE.test(stripped) && !/\d[\d.,]*\s*€/.test(stripped)) return false;
  }
  const max = Math.max(...(t.match(/[\d][\d.,]{0,8}\s*€/g) || ["0"]).map((x) => parsePrice(x) || 0));
  return max >= 2 && max <= 5000;
}

/** prezzo "vero" di una riga: esclude risparmi, venditori e righe di spedizione */
function isPriceLine(line) {
  const t = String(line?.text || "").trim();
  if (!t) return false;
  if (RE_SAVINGS.test(t) && !/invece\s+di|anzich[eé]|al\s+posto\s+di|→|->/i.test(t)) return false;
  if (RE_SELLER_ONLY.test(t)) return false;
  return hasRealPrice(t);
}

function classifyLine(line) {
  const t = line.text.trim();
  if (!t) return "EMPTY";
  if (RE_SELLER_ONLY.test(t)) return "STORE";
  if (RE_FOOTER.test(t)) return "FOOTER";
  const withoutNumbers = t.replace(/[\d][\d.,]*\s*(?:€|eur)/gi, " ").replace(/\s+/g, " ").trim();
  const wordCount = withoutNumbers.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]{2,}/.test(w)).length;
  if (hasRealPrice(t)) {
    // "1) 👉 Sony WH-1000XM5 a 199€" → titolo con prezzo incorporato
    if ((RE_NUM_ITEM.test(t) && withoutNumbers.length >= 12) || (withoutNumbers.length >= 30 && wordCount >= 4)) {
      return "TITLE_PRICE";
    }
    return "PRICE";
  }
  if (RE_STORE_LINE.test(t)) return "STORE";
  if (RE_VENDUTO.test(t)) return "STORE";
  if (RE_COUPON.test(t)) return "NOTE";
  if (RE_CTA.test(t) && t.length < 90) return "CTA";
  if (RE_NUM_ITEM.test(t) && t.length >= 10) return "TITLE";
  const words = t.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w));
  if (t.length >= 14 && words.length >= 2) return "TITLE";
  return "OTHER";
}

/** estrae {price, oldPrice, discountHint} dalla riga (null se no) */
function priceFromLine(line) {
  const t = line.text;
  for (const re of RE_PRICE_PAIR) {
    const m = re.exec(t);
    if (m) {
      let a = parsePrice(m[1]);
      let b = parsePrice(m[2]);
      if (!a || !b) continue;
      // nel formato "invece di", il primo numero è il prezzo scontato
      if (b < a) [a, b] = [b, a];
      if (a >= 2 && a <= 5000) return { price: round2(a), oldPrice: round2(b > a ? b : null) };
    }
  }
  const amounts = (t.match(/([\d][\d.,]*)\s*€/g) || [])
    .map((x) => parsePrice(x))
    .filter((n) => n && n >= 2 && n <= 5000);
  const pct = /(\d{1,2})\s*%/i.exec(t);
  if (amounts.length) {
    return { price: round2(Math.min(...amounts)), oldPrice: amounts.length > 1 ? round2(Math.max(...amounts)) : null, discountHint: pct ? Number(pct[1]) : null };
  }
  return null;
}

function cleanTitle(raw = "") {
  let t = String(raw);
  for (let i = 0; i < 4; i++) t = t.replace(RE_NUM_ITEM, "").replace(RE_TITLE_MARKER, "");
  t = t
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t
    .replace(/\s*(?:a|per|a\s+soli|solo)\s*[\d][\d.,]*\s*(?:€|eur(?:o)?)\s*.*$/iu, "")
    .replace(/\s*[\d][\d.,]*\s*(?:€|eur(?:o)?)\s*(?:invece.*)?$/iu, "")
    .replace(/\s*[-–|,]\s*$/u, "")
    .trim();
  if (t.length > 150) t = t.slice(0, 148).replace(/[\s,;:|/-]+$/u, "") + "…";
  return t;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/* nomi "veri" di negozio: tutto il resto non è uno store */
const STORE_ALIASES = [
  [/\bamazon\b/i, "Amazon"],
  [/\baliexpress\b/i, "AliExpress"],
  [/\bmediaworld\b|\bmedia\s*world\b/i, "MediaWorld"],
  [/\bunieuro\b/i, "Unieuro"],
  [/\beuronics\b/i, "Euronics"],
  [/\btrony\b/i, "Trony"],
  [/\bexpert\b/i, "Expert"],
  [/\bcomet\b/i, "Comet"],
  [/\bebay\b/i, "eBay"],
  [/\btemu\b/i, "Temu"],
  [/\bbanggood\b/i, "Banggood"],
  [/\bgearbest\b/i, "GearBest"],
  [/\bdecathlon\b/i, "Decathlon"],
  [/\bzalando\b/i, "Zalando"],
  [/\bcdiscount\b/i, "Cdiscount"],
  [/\bshein\b/i, "Shein"],
  [/\bkabum\b/i, "Kabum"],
  [/\bwalmart\b/i, "Walmart"],
  [/\bmi\s*store\b|\bxiaomi\s*store\b/i, "Xiaomi Store"],
];

/* parole generiche: se il "nome negozio" estratto è una di queste, non è uno store */
const GENERIC_STORE_WORDS = /^(?:store|shop|negozio|acquista|compra|offerta|offerte|link|qui|vedi|product|prodotto|pagina|sito|web|official|ufficiale|sconto|prezzo|amazon\.?it?|www)$/i;

/** normalizza il nome di uno store trovato nel post */
function canonStore(raw) {
  const name = String(raw || "").trim().replace(/[.,;:!]+$/, "").trim();
  if (!name || name.length < 3) return null;
  for (const [re, label] of STORE_ALIASES) if (re.test(name)) return label;
  if (GENERIC_STORE_WORDS.test(name)) return null;
  // un nome marchio plausibile (non una frase): max 3 parole
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 3) return null;
  if (!/[A-Za-zÀ-ÿ]{3,}/.test(name)) return null;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Store dell'offerta. Ordine: hashtag → riga 🛍/🏬/🏪 → "venduto/spedito da X"
 * → nome negozio nel testo → dominio dell'URL. Non restituisce MAI "Store".
 * @param {string} blockText testo del blocco offerta
 * @param {string|null} url link (anche shortener: in quel caso decide il testo)
 * @param {object} [post] post completo (fallback: testo dell'intero post)
 */
function detectStore(blockText, url, post = null) {
  const text = String(blockText || "");
  const fullText = `${text}\n${post?.text || ""}`;

  // 1) hashtag esplicito del canale (#Amazon #AliExpress …)
  for (const [tag, name] of Object.entries(STORES)) {
    if (new RegExp(`#${tag}\\b`, "i").test(text)) return name;
  }
  // 1b) "venduto da X e spedito da Amazon" → il negozio è quello della spedizione
  if (/venduto\s+(?:e\s+spedito\s+)?da\s+[^\n]*?e\s+spedito\s+da\s+(amazon|aliexpress|unieuro|mediaworld|ebay)/i.test(text)) {
    const m = /e\s+spedito\s+da\s+(amazon|aliexpress|unieuro|mediaworld|ebay)/i.exec(text);
    if (m) return canonStore(m[1]);
  }

  // 2) riga con emoji negozio: "🛍 Amazon", "🏬 Unieuro", "🛍️MediaWorld"
  const shopLine = /(?:🛍️?|🏬|🏪|🛒)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.&\- ]{1,24})/u.exec(text);
  if (shopLine) {
    const name = canonStore(shopLine[1]);
    if (name) return name;
  }

  // 3) "Venduto e spedito da Amazon" / "spedito da Amazon"
  const sold = /(?:venduto(?:\s+e\s+spedito)?\s+da|spedito\s+da|sold\s+by|shipped\s+by)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.&\- ]{1,24})/i.exec(text);
  if (sold) {
    const name = canonStore(sold[1]);
    // "venduto da LI-Auricolari … e spedito da Amazon" → vale Amazon dello store
    if (name) return name;
  }
  if (/spedito\s+da\s+amazon|venduto\s+(?:e\s+spedito\s+)?da\s+amazon/i.test(text)) return "Amazon";

  // 4) nome negozio citato nel testo ("disponibile su MediaWorld")
  const mentioned = /\b(?:su|da|presso|solo\s+su)\s+(amazon|aliexpress|mediaworld|unieuro|euronics|trony|expert|comet|ebay|temu|decathlon)\b/i.exec(text);
  if (mentioned) {
    const name = canonStore(mentioned[1]);
    if (name) return name;
  }

  // 5) dominio del link: se è uno shortener, provo il testo del post intero
  const host = hostOf(url || "");
  for (const [re, name] of DOMAIN_STORES) if (re.test(host)) return name;

  const SHORTENER = /(?:^|\.)(?:prezzi\.tech|ofclub\.click|scontify\.net|x\.gd|bit\.ly|tinyurl\.com|s\.click\.aliexpress\.com|amzn\.to|linktr\.ee|t\.me)$/i;
  if (!host || SHORTENER.test(host)) {
    for (const [re, label] of STORE_ALIASES) {
      if (re.test(fullText) && new RegExp(`#?(?:🛍️?|🏬|🏪|🛒)?\\s*${re.source}`, "i").test(fullText)) return label;
    }
    // ultimo tentativo: prima parola-store citata nel post
    const any = /\b(amazon|aliexpress|mediaworld|unieuro|euronics|trony|expert|comet|ebay|temu|banggood)\b/i.exec(fullText);
    if (any) return canonStore(any[1]);
  }
  return null;
}

const BAD_LINK = /(?:^|\.)t\.me$|telegram\.org|instagram\.com|facebook\.com|youtube\.com|youtu\.be|tiktok\.com|twitter\.com|x\.com|whatsapp\.com|amzn\.to\/[^/]*$|scontify\.net\/(?:offerta|negozi|tag)/i;
const TRACKING_LINK = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?[a-z0-9-]{2,}(?:\.(?:click|link|to|tech|net|info|com|it|shop|store|go|live|site|online|xyz))\/[a-z0-9]{3,12}\/?$/i;

function pickUrl(block, post) {
  const candidates = [];
  for (const line of block.lines) {
    for (const l of line.links) {
      if (!/^https?:/i.test(l.href)) continue;
      if (/t\.me\/[A-Za-z0-9_]+\?q=/i.test(l.href)) continue;
      if (BAD_LINK.test(hostOf(l.href))) continue;
      if (hostOf(l.href) === "t.me") continue;
      let score = 1;
      if (/(vedi|acquista|compra|offerta|product|prodotto|vai|scopri)/i.test(l.text)) score += 3;
      if (/amazon\.|aliexpress\./i.test(hostOf(l.href))) score += 2;
      if (TRACKING_LINK.test(l.href)) score += 2;
      if (/scontify\.net\/offerta/i.test(l.href)) score += 2;
      if (/prezzi\.tech\/go|ofclub\.click/.test(l.href)) score += 2;
      candidates.push({ href: l.href, score });
    }
  }
  if (post.preview?.url && /^https?:/i.test(post.preview.url) && hostOf(post.preview.url) !== "t.me") {
    candidates.push({ href: post.preview.url, score: 1.5 });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].href : post.messageUrl;
}

/* ── URL immagini: chiedo la variante grande quando il CDN la offre ── */
export function upgradeImage(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!/^https?:/i.test(u)) return u;
  // telethon/telesco: il path contiene già la risoluzione, non c'è molto da fare
  // Amazon/altri: rimuovo i suffissi che riducono la miniatura
  u = u
    .replace(/\._AC_UL\d+_\.jpg$/i, ".jpg")
    .replace(/\._SL\d+_\.jpg$/i, ".jpg")
    .replace(/\._SX\d+_SY\d+_\.jpg$/i, ".jpg")
    .replace(/\._SS\d+_\.jpg$/i, ".jpg")
    .replace(/\._AC_UY\d+_\.jpg$/i, ".jpg")
    .replace(/\?.*$/i, "");
  return u;
}

/* ── splitter di elenchi multi-prodotto (post con "🟢 Xiaomi ... a 62,40€") ── */

const RE_BULLET = /^(?:[\u{1F7E0}-\u{1F7FF}\u{1F534}\u{1F535}\u{1F7E1}\u{1F4CD}\u{1F539}\u{1F538}\u{1F536}\u{1F537}]\uFE0F?|🔷|🔹|▪️|▪|•|-|–|\d{1,2}[).])\s*/u;

/**
 * Un post Telegram diventa righe separate da <br/>; quando però il canale
 * pubblica un elenco con un solo a capo e ogni riga ha il suo prezzo
 * ("🟢 Xiaomi Smart Band 10 Pro a 62.40€"), il parser vedrebbe un unico
 * blocco. Qui spezzo il testo in singole offerte, ognuna con il suo prezzo.
 * @returns {Array<Array<{text:string, links:Array}>>} gruppi di righe
 */
export function splitMultiOfferLines(lines = []) {
  const groups = [];
  let cur = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  const prevHadPrice = () => {
    for (let i = cur.length - 1; i >= 0 && i >= cur.length - 4; i--) {
      if (/[€]/.test(cur[i].text)) return true;
    }
    return false;
  };

  for (const line of lines) {
    const t = String(line.text || "").trim();
    const isBullet = RE_BULLET.test(t);
    const hasPrice = /\d[\d.,]*\s*(?:€|eur)/i.test(t);
    const looksLikeProduct = isBullet && /[A-Za-zÀ-ÿ]{3,}/.test(t.replace(RE_BULLET, ""));

    // nuova voce di elenco con prezzo proprio → chiudo il gruppo precedente
    if (looksLikeProduct && hasPrice && cur.length && (prevHadPrice() || cur.some((l) => /[€]/.test(l.text)))) {
      flush();
    } else if (looksLikeProduct && hasPrice && cur.length && !cur.some((l) => /[€]/.test(l.text))) {
      // il gruppo in corso non ha ancora un prezzo: se c'è già un titolo, è un nuovo prodotto
      if (cur.some((l) => /[A-Za-zÀ-ÿ]{6,}/.test(l.text))) flush();
    }
    cur.push(line);
  }
  flush();
  return groups;
}

/**
 * Estrae le offerte da un singolo post.
 * @param {object} post risultato di parseChannelPage
 * @param {object} [opts]
 */
export function extractOffers(post, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const rawLines = (post.lines || []).filter((l) => l.text || l.links.length);
  // un post può contenere più elenchi con un solo a capo: li separo prima
  const segments = rawLines.length ? splitMultiOfferLines(rawLines) : [[]];
  const deals = [];
  const seen = new Set();

  for (const lines of segments) {
    const blocks = [];
    let cur = null;

    const pushBlock = () => {
      if (cur && (cur.prices.length || cur.lines.length)) blocks.push(cur);
      cur = null;
    };

    for (const line of lines) {
      const kind = classifyLine(line);
      if (kind === "EMPTY") continue;
      if (kind === "FOOTER") {
        if (cur) cur.lines.push(line);
        continue;
      }
      if (kind === "TITLE" || kind === "TITLE_PRICE") {
        if (cur) {
          // continuo il titolo solo se non ho ancora prezzo/store/CTA e i titoli sono brevi
          const titleOpen = kind === "TITLE" && !cur.prices.length && !cur.store && !cur.cta &&
            cur.titleLines.length < 3 && cur.title.length < 90 && !RE_NUM_ITEM.test(line.text);
          if (titleOpen) {
            cur.titleLines.push(line.text);
            cur.title = `${cur.title} ${line.text}`;
            cur.lines.push(line);
            continue;
          }
          pushBlock();
        }
        cur = { titleLines: [line.text], title: line.text, lines: [line], prices: [], store: null, cta: false, links: [] };
        if (kind === "TITLE_PRICE") {
          const p = priceFromLine(line);
          if (p) cur.prices.push(p);
        }
        continue;
      }
      if (!cur) {
        // riga di contesto prima del primo titolo: la uso come blocco provvisorio
        cur = { titleLines: [], title: "", lines: [], prices: [], store: null, cta: false, links: [] };
      }
      cur.lines.push(line);
      if (kind === "PRICE" && isPriceLine(line)) {
        const p = priceFromLine(line);
        if (p) cur.prices.push(p);
      }
      if (kind === "STORE" && !cur.store) cur.store = detectStore(line.text, null, post);
      if (kind === "CTA") cur.cta = true;
    }
    pushBlock();

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const blockText = b.lines.map((l) => l.text).join("\n");
      // il primo prezzo "vero" del blocco, non quello di un risparmio
      const priceInfo = b.prices[0];
      if (!priceInfo || !priceInfo.price) continue;
      let title = cleanTitle(b.title);
      if (!title || title.length < 10) {
        title = cleanTitle(post.preview?.title || (post.text || "").split("\n")[0] || "");
      }
      if (!title) continue;
      // titoli che sono in realtà righe di venditore/spedizione
      if (RE_SELLER_ONLY.test(title) || RE_SAVINGS.test(title)) continue;
      const oldPrice = priceInfo.oldPrice && priceInfo.oldPrice > priceInfo.price ? priceInfo.oldPrice : null;
      let discount = oldPrice ? Math.round((1 - priceInfo.price / oldPrice) * 100) : (priceInfo.discountHint || null);
      if (discount !== null) discount = Math.max(0, Math.min(95, discount));
      let url = pickUrl(b, post);
      const store = detectStore(blockText, url, post);
      if (!/^https?:/i.test(url)) url = post.messageUrl;
      const audio = isAudioOffer(title, blockText);
      if (!audio && !opts.keepNonAudio) continue;

      const known = matchModel(`${title}\n${blockText}`);
      const brand = detectBrand(`${title} ${blockText}`, title);
      const category = detectCategory(`${title} ${blockText}`, title);
      const hasAnc = Boolean(known?.entry?.specs?.anc) || hasAncText(`${title} ${blockText}`);
      const [categoryLabel, categoryEmoji] = CATEGORY_LABELS[category] || CATEGORY_LABELS.cuffie;
      const postSpecs = specsFromText(blockText);
      const { modelKey, model } = deriveModelKey({ title, text: blockText, brand });
      const fingerprint = hash(norm(title));
      const key = hash(`${post.channel}|${post.id}|${i}|${norm(title)}|${priceInfo.price}`);
      if (seen.has(key)) continue;
      seen.add(key);
      deals.push({
        key,
        title,
        price: priceInfo.price,
        oldPrice,
        discount,
        currency: "EUR",
        url,
        store,
        image: upgradeImage(post.photo || post.preview?.image || null),
        brand,
        model,
        modelKey,
        category,
        hasAnc,
        isAudio: audio,
        text: collapse(blockText).slice(0, 1600),
        channel: post.channel,
        channelTitle: post.channelTitle || CHANNEL_INFO[post.channel]?.title || null,
        channelPhoto: post.channelPhoto || null,
        messageId: post.id,
        messageUrl: post.messageUrl,
        postedAt: post.datetime || nowIso,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        views: post.views || 0,
        seenCount: 1,
        hotScore: 0,
        fingerprint,
        ago: timeAgoIt(post.datetime || nowIso),
        categoryLabel,
        categoryEmoji,
        telegramUrl: post.messageUrl,
        alsoOn: [],
        dupKey: `${modelKey}|${priceInfo.price}`,
        postSpecs,
        specs: mergeSpecs(known?.entry?.specs, postSpecs),
        priceSource: "channel",
        priceSuspect: false,
      });
    }
  }

  // stesso prodotto due volte nello stesso post (righe duplicate o varianti):
  // tengo la versione con il prezzo migliore
  return intraPostDedupe(deals);
}

/** rimuove i doppioni dello stesso modello dentro lo stesso post */
function intraPostDedupe(deals = []) {
  const best = new Map();
  for (const d of deals) {
    const k = d.modelKey || d.dupKey || d.key;
    const prev = best.get(k);
    if (!prev) {
      best.set(k, d);
      continue;
    }
    // stessa offerta nello stesso post: tengo prezzo più basso e più testo
    const winner = (d.price || Infinity) < (prev.price || Infinity) ? d : prev;
    const loser = winner === d ? prev : d;
    best.set(k, {
      ...winner,
      oldPrice: winner.oldPrice || loser.oldPrice,
      discount: winner.discount || loser.discount,
      url: winner.url && !/^https?:\/\/t\.me\//.test(winner.url) ? winner.url : loser.url,
      image: winner.image || loser.image,
      text: (winner.text || "").length >= (loser.text || "").length ? winner.text : loser.text,
    });
  }
  return [...best.values()];
}

/** Alias comodo: HTML completo di un canale → offerte */
export function offersFromHtml(html, channel, opts = {}) {
  const page = parseChannelPage(html, channel);
  const out = [];
  for (const post of page.posts) {
    post.channelTitle = page.info.title;
    post.channelPhoto = page.info.photo;
    out.push(...extractOffers(post, opts));
  }
  return out;
}

/* ═══════════════ 4. archivio: merge, dedupe, stats ═══════════════ */

function pickPrimary(a, b) {
  const score = (d) =>
    (/^https?:\/\/(?:www\.)?t\.me\//.test(d.url || "") ? 0 : 3) +
    (d.oldPrice ? 1 : 0) +
    Math.min(2, (d.text || "").length / 600) +
    (d.image ? 0.5 : 0) +
    (/^https:\/\/(?:[a-z.]+)?amazon\./i.test(d.url || "") ? 1 : 0) +
    (d.store ? 0.5 : 0);
  return score(a) >= score(b) ? a : b;
}

/** preferisce un'immagine/CDN più grande */
function richerImage(a, b) {
  const url = a || b;
  if (!url) return null;
  return upgradeImage(url);
}

/** chiave di raggruppamento: il modello, non il titolo */
export function groupKey(d = {}) {
  return d.modelKey || d.dupKey || d.fingerprint || `${norm(d.title)}`;
}

/** segnalazioni distinte (canale + messaggio): la stessa card riscansita non conta due volte */
function reportPoints(deals = []) {
  const map = new Map();
  for (const d of deals) {
    if (!d.channel) continue;
    // `reports` può essere un numero nelle card generate dalla vecchia versione
    if (Array.isArray(d.reports)) {
      for (const r of d.reports) if (r?.channel) map.set(`${r.channel}#${r.messageId ?? ""}`, r);
    }
    // le card vecchie annotavano gli altri canali in `alsoOn`
    for (const o of d.alsoOn || []) {
      if (o?.channel) map.set(`${o.channel}#${o.messageId ?? ""}`, { ...o, channel: o.channel });
    }
    const id = `${d.channel}#${d.messageId ?? ""}`;
    if (!map.has(id)) {
      map.set(id, {
        channel: d.channel,
        channelTitle: d.channelTitle || null,
        messageId: d.messageId ?? null,
        messageUrl: d.messageUrl || `https://t.me/${d.channel}/${d.messageId ?? ""}`,
        price: Number.isFinite(d.price) ? d.price : null,
        postedAt: d.postedAt || null,
      });
    }
  }
  return [...map.values()].sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
}

/**
 * Unisce le offerte dello STESSO prodotto (stesso modello) pubblicate su
 * canali o post diversi: una card sola con il prezzo migliore, l'elenco dei
 * canali che l'hanno segnalata e il numero di segnalazioni.
 */
export function dedupeDeals(deals = []) {
  const groups = new Map();
  for (const d of deals) {
    const k = groupKey(d);
    const g = groups.get(k);
    if (!g) groups.set(k, [d]);
    else g.push(d);
  }

  const out = [];
  for (const group of groups.values()) {
    // dati "ricchi": link diretto allo store, immagine, testo completo
    let primary = group[0];
    for (const d of group) primary = pickPrimary(primary, d);

    // prezzo migliore del gruppo (ignorando prezzi assenti o sospetti)
    const priced = group.filter((d) => Number.isFinite(d.price) && d.price > 0);
    const cheapest = priced.length
      ? priced.reduce((best, d) => (d.price < best.price ? d : best), priced[0])
      : null;

    // tutti i canali che hanno segnalato il prodotto
    const channels = new Map();
    const addChannel = (ch, meta = {}) => {
      if (!ch) return;
      if (!channels.has(ch)) {
        channels.set(ch, {
          channel: ch,
          channelTitle: meta.channelTitle || null,
          messageUrl: meta.messageUrl || `https://t.me/${ch}/${meta.messageId || ""}`,
          price: Number.isFinite(meta.price) ? meta.price : null,
          postedAt: meta.postedAt || null,
        });
      } else {
        const prev = channels.get(ch);
        if (Number.isFinite(meta.price) && (!Number.isFinite(prev.price) || meta.price < prev.price)) prev.price = meta.price;
        if (new Date(meta.postedAt || 0) > new Date(prev.postedAt || 0)) prev.postedAt = meta.postedAt;
      }
    };
    for (const d of group) {
      addChannel(d.channel, d);
      // canali accumulati nelle fusioni precedenti
      for (const o of d.alsoOn || []) addChannel(o.channel, o);
    }
    const alsoOn = [...channels.values()]
      .filter((c) => c.channel !== primary.channel)
      .sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));

    const reports = reportPoints(group);
    const seenCount = Math.max(1, reports.length);

    // se il prezzo migliore arriva da un altro canale, la card lo usa
    const priceFrom = cheapest || primary;
    const merged = {
      ...primary,
      price: priceFrom.price ?? primary.price,
      oldPrice: priceFrom.oldPrice ?? primary.oldPrice,
      discount: priceFrom.discount ?? primary.discount,
      priceChannel: priceFrom.channel || primary.channel,
      priceUrl: priceFrom.url || primary.url,
      url: cheapest && !/^https?:\/\/t\.me\//.test(cheapest.url || "") ? cheapest.url : primary.url,
      image: richerImage(primary.image, cheapest?.image),
      // specifiche: prendo le più complete del gruppo
      postSpecs: group.map((d) => d.postSpecs).find((x) => x && (x.anc || x.batt)) || primary.postSpecs || null,
      specs: primary.specs || cheapest?.specs || null,
      hasAnc: group.some((d) => d.hasAnc) || Boolean(primary.hasAnc),
      alsoOn,
      seenCount,
      channelCount: channels.size,
      reports,
      lastSeenAt: group.map((d) => d.lastSeenAt).filter(Boolean).sort().pop() || primary.lastSeenAt,
      postedAt: group
        .map((d) => d.postedAt)
        .filter(Boolean)
        .sort()
        .pop() || primary.postedAt,
    };
    // scarto campi di lavoro
    delete merged.deto;
    out.push(merged);
  }
  return out;
}

/**
 * Fonde l'archivio con le offerte appena scansionate.
 * Il confronto è per prodotto (modelKey): un prodotto già presente viene
 * aggiornato (prezzo migliore, canali extra, "segnalato N volte") invece di
 * creare una seconda card.
 * @returns {{deals:Array, added:Array, updated:number}}
 */
export function mergeDeals(existing = [], incoming = [], nowIso = new Date().toISOString()) {
  const byProduct = new Map();     // modelKey → deal fuso
  const byKey = new Map();         // key tecnica → modelKey
  const byMsg = new Map();         // canale#messaggio → modelKey

  const remember = (d) => {
    const k = groupKey(d);
    byKey.set(d.key, k);
    if (d.channel && d.messageId !== undefined) byMsg.set(`${d.channel}#${d.messageId}`, k);
  };

  for (const d of existing) {
    const k = groupKey(d);
    byProduct.set(k, d);
    remember(d);
  }

  const added = [];
  const touched = new Set();

  for (const inc of incoming) {
    const k = groupKey(inc);
    const prev = byProduct.get(k);
    const sameMessage = inc.channel ? byMsg.get(`${inc.channel}#${inc.messageId}`) : null;

    if (!prev) {
      // Prodotto nuovo. Un singolo post può però contenere più offerte dello
      // stesso articolo (o lo stesso articolo riscritto): se il messaggio ha
      // già generato una card con titolo molto simile, aggiorno quella.
      const sibling = sameMessage ? byProduct.get(sameMessage) : null;
      if (sibling && similarTitle(sibling.title, inc.title)) {
        byProduct.set(sameMessage, blend(sibling, inc, nowIso));
        touched.add(sameMessage);
        remember(inc);
        continue;
      }
      const fresh = { ...inc, firstSeenAt: inc.firstSeenAt || nowIso, lastSeenAt: nowIso, seenCount: 1 };
      byProduct.set(k, fresh);
      remember(fresh);
      added.push(inc);
      continue;
    }

    byProduct.set(k, blend(prev, inc, nowIso));
    touched.add(k);
    remember(prev);
    remember(inc);
  }

  const deals = dedupeDeals([...byProduct.values()]).sort(
    (a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0),
  );
  return { deals, added, updated: touched.size };
}

/** due titoli parlano dello stesso articolo? (per non fondere offerte diverse dello stesso post) */
export function similarTitle(a = "", b = "") {
  const ta = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const tb = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  const inter = [...ta].filter((w) => tb.has(w)).length;
  return inter / Math.min(ta.size, tb.size) >= 0.7;
}

/** unisce le segnalazioni (canale#messaggio) di due versioni dello stesso prodotto */
function mergeReports(prev, inc) {
  const map = new Map();
  const add = (r) => {
    if (!r?.channel) return;
    map.set(`${r.channel}#${r.messageId ?? ""}`, r);
  };
  for (const r of prev.reports || []) add(r);
  for (const r of inc.reports || []) add(r);
  add({
    channel: prev.channel,
    channelTitle: prev.channelTitle,
    messageId: prev.messageId ?? null,
    messageUrl: prev.messageUrl,
    price: Number.isFinite(prev.price) ? prev.price : null,
    postedAt: prev.postedAt || null,
  });
  add({
    channel: inc.channel,
    channelTitle: inc.channelTitle,
    messageId: inc.messageId ?? null,
    messageUrl: inc.messageUrl,
    price: Number.isFinite(inc.price) ? inc.price : null,
    postedAt: inc.postedAt || null,
  });
  return [...map.values()].sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
}

/** fonde due versioni dello stesso prodotto senza perdere informazioni */
function blend(prev, inc, nowIso) {
  const better = (a, b) => {
    if (!Number.isFinite(a)) return false;
    if (!Number.isFinite(b)) return true;
    return a < b;
  };
  const priceWins = better(inc.price, prev.price);
  const priceSrc = priceWins ? inc : prev;
  const textSrc = (inc.text || "").length >= (prev.text || "").length ? inc : prev;
  const urlSrc = inc.url && !/^https?:\/\/t\.me\//.test(inc.url) ? inc : prev;
  // il canale primario è quello della card (dopo la fusione): quello non va in alsoOn
  const primaryChannel = priceWins ? inc.channel || prev.channel : prev.channel;

  const reports = mergeReports(prev, inc);
  // alsoOn è derivato dalle segnalazioni: tutti i canali tranne quello primario
  const also = new Map();
  for (const r of reports) {
    if (!r?.channel || r.channel === primaryChannel) continue;
    also.set(r.channel, {
      channel: r.channel,
      channelTitle: r.channelTitle || null,
      messageUrl: r.messageUrl || `https://t.me/${r.channel}/${r.messageId ?? ""}`,
      price: Number.isFinite(r.price) ? r.price : null,
      postedAt: r.postedAt || null,
    });
  }
  const alsoList = [...also.values()].sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));

  return {
    ...prev,
    ...inc,
    // identità della card: resta ancorata al post principale (quello con il
    // prezzo che mostro), così l'elenco "alsoOn" non si svuota a ogni fusione
    key: prev.key,
    channel: primaryChannel,
    channelTitle: priceWins ? inc.channelTitle || prev.channelTitle : prev.channelTitle,
    messageId: priceWins ? inc.messageId ?? prev.messageId : prev.messageId,
    messageUrl: priceWins ? inc.messageUrl || prev.messageUrl : prev.messageUrl,
    telegramUrl: priceWins ? inc.telegramUrl || prev.telegramUrl : prev.telegramUrl,
    modelKey: prev.modelKey || inc.modelKey,
    brand: prev.brand || inc.brand,
    model: prev.model || inc.model,
    price: priceSrc.price,
    oldPrice: priceSrc.oldPrice ?? prev.oldPrice,
    discount: priceSrc.discount ?? prev.discount,
    url: urlSrc.url || inc.url,
    store: prev.store || inc.store,
    image: richerImage(prev.image, inc.image),
    text: textSrc.text,
    title: (prev.title || "").length >= (inc.title || "").length ? prev.title : inc.title,
    postSpecs: inc.postSpecs || prev.postSpecs,
    specs: inc.specs || prev.specs,
    hasAnc: Boolean(prev.hasAnc || inc.hasAnc),
    firstSeenAt: prev.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    // "segnalato N volte" = post/canali distinti che l'hanno pubblicata,
    // non quante volte il browser ha riscansito lo stesso post
    seenCount: Math.max(1, reports.length),
    reports,
    views: Math.max(prev.views || 0, inc.views || 0),
    alsoOn: alsoList,
    dupKey: prev.dupKey || inc.dupKey,
  };
}

/** elimina le offerte troppo vecchie e limita la dimensione dell'archivio */
export function pruneDeals(deals = [], { days = 30, max = 800 } = {}) {
  const cut = Date.now() - days * 86400000;
  return deals
    .filter((d) => new Date(d.postedAt || d.lastSeenAt || 0).getTime() >= cut)
    .slice(0, max);
}

function countPairs(values, limit = 14) {
  const counts = new Map();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/**
 * Ricalcola le statistiche mostrate in homepage.
 */
export function computeStats(deals = [], channelMeta = {}, extra = {}) {
  const audio = deals.filter((d) => d.isAudio !== false);
  const withAnc = audio.filter((d) => d.hasAnc);
  const categories = countPairs(audio.map((d) => d.category), 10);
  if (withAnc.length) categories.push(["anc", withAnc.length]);
  const byModel = new Map();
  for (const d of audio) {
    const k = groupKey(d);
    if (!byModel.has(k)) byModel.set(k, d);
  }
  const prices = audio.map((d) => d.price).filter((n) => Number.isFinite(n));
  const discounts = audio.map((d) => d.discount).filter((n) => Number.isFinite(n));
  const now = extra.now || new Date().toISOString();
  const cut = Date.now() - 86400000;
  const sources = Object.entries(channelMeta).map(([channel, meta]) => ({
    channel,
    title: meta.title || CHANNEL_INFO[channel]?.title || channel,
    photo: meta.photo || null,
    description: meta.description || null,
    lastMessageId: meta.lastMessageId || null,
    lastScanAt: meta.lastScanAt || null,
    lastOkAt: meta.lastOkAt || null,
    newDeals: meta.newDeals || 0,
    okScans: meta.okScans ?? 1,
    error: meta.error || null,
  }));
  return {
    totalDeals: audio.length,
    allParsed: deals.length,
    last24h: audio.filter((d) => new Date(d.postedAt).getTime() >= cut).length,
    bestDiscount: discounts.length ? Math.max(...discounts) : 0,
    suspectCount: 0,
    verifiedCount: 0,
    avgPrice: prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
    avgDiscount: discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : 0,
    cheapest: prices.length ? Math.min(...prices) : 0,
    priceRange: prices.length ? [Math.min(...prices), Math.max(...prices)] : [0, 0],
    brands: countPairs(audio.map((d) => d.brand), 14),
    stores: countPairs(audio.map((d) => d.store), 10),
    categories,
    ancCount: withAnc.length,
    uniqueModels: byModel.size,
    multiChannel: audio.filter((d) => (d.alsoOn || []).length > 0).length,
    channels: sources,
    sources,
    botEnabled: false,
    channelPublishEnabled: false,
    scanner: {
      running: false,
      lastScanAt: extra.lastScanAt || now,
      nextScanAt: null,
      scans: extra.scans || 0,
      errors: extra.errors || 0,
    },
    now,
  };
}

/** metadati canali per data.json (top-level "channels") */
export function buildChannels(deals = [], channelMeta = {}) {
  const chans = new Set([...Object.keys(channelMeta), ...deals.map((d) => d.channel).filter(Boolean)]);
  return [...chans].map((channel) => ({
    channel,
    title: channelMeta[channel]?.title || CHANNEL_INFO[channel]?.title || channel,
    photo: channelMeta[channel]?.photo || null,
    newDeals: channelMeta[channel]?.newDeals || 0,
  }));
}

/* ═══════════════ 5. ri-normalizzazione di offerte già salvate ═══════════════
   Serve per due casi reali:
   - data.json generato da una versione precedente del parser;
   - archivio locale nel browser (localStorage) con card vecchie.
   Ricalcola marca, modello, categoria, store e specifiche dal testo, senza
   riscaricare i canali. Le card "fantasma" (venditore/risparmio) spariscono. */

/** prezzo della riga che parla davvero di questo modello */
function priceForModel(text = "", model = "") {
  const key = norm(model || "");
  if (!key) return null;
  const words = key.split(" ").filter((w) => w.length > 2);
  const lines = String(text).split("\n");
  for (const line of lines) {
    const l = norm(line);
    if (!words.length || !words.every((w) => l.includes(w) || l.includes(w.replace(/\d/g, "")))) continue;
    if (RE_SAVINGS.test(line)) continue;
    const m = /(\d[\d.,]*)\s*(?:€|eur)/i.exec(line);
    if (m) {
      const p = parsePrice(m[1]);
      if (p && p >= 2 && p <= 5000) return p;
    }
  }
  return null;
}

/**
 * Riscrive una singola offerta salvata con la logica attuale.
 * @returns {object|null} null se la card non è valida (fantasma o non audio)
 */
export function normalizeDeal(deal = {}) {
  if (!deal || !deal.title || !Number.isFinite(Number(deal.price))) return null;
  const text = String(deal.text || "");
  const title = String(deal.title || "");

  // card fantasma: titolo = riga di venditore, o prezzo = importo risparmiato
  if (RE_SELLER_ONLY.test(title) || RE_SAVINGS.test(title)) return null;
  const saved = /(?:hai\s+risparmiato|risparmi|risparmio)\s*(?:di\s*)?(\d[\d.,]*)\s*€/i.exec(text);
  if (saved && parsePrice(saved[1]) === Number(deal.price)) return null;
  if (/^store$/i.test(String(deal.store || "").trim())) deal = { ...deal, store: null };

  const audio = deal.isAudio !== false ? isAudioOffer(title, text) : false;
  if (!audio) return null;

  const known = matchModel(`${title}\n${text.slice(0, 400)}`);
  const brand = known?.entry?.brand || detectBrand(`${title} ${text}`, title);
  const category = detectCategory(`${title} ${text}`, title);
  const specInfo = specsFromText(text);
  const hasAnc = Boolean(known?.entry?.specs?.anc) || hasAncText(`${title} ${text}`);
  const { modelKey, model } = deriveModelKey({ title, text, brand });
  const store = detectStore(text, deal.url || null, { text });
  const [categoryLabel, categoryEmoji] = CATEGORY_LABELS[category] || CATEGORY_LABELS.cuffie;

  // prezzo: se il testo indica un altro prezzo sulla riga del modello, vince quello
  let price = Number(deal.price);
  let priceSuspect = Boolean(deal.priceSuspect);
  const hinted = priceForModel(text, known?.entry?.model || model || "");
  if (hinted && Math.abs(hinted - price) > 0.01) {
    price = hinted;
    priceSuspect = false;
  }

  const oldPrice = Number(deal.oldPrice) > price ? Number(deal.oldPrice) : null;
  let discount = oldPrice ? Math.round((1 - price / oldPrice) * 100) : deal.discount ?? null;
  if (discount !== null) discount = Math.max(0, Math.min(95, Number(discount)));

  const out = {
    ...deal,
    title,
    price,
    oldPrice,
    discount,
    url: deal.url || deal.messageUrl,
    store,
    brand,
    model,
    modelKey,
    category,
    hasAnc,
    categoryLabel,
    categoryEmoji,
    postSpecs: specInfo,
    specs: mergeSpecs(known?.entry?.specs, specInfo),
    dupKey: `${modelKey}|${price}`,
    priceSuspect,
    image: upgradeImage(deal.image),
    isAudio: true,
  };
  delete out.deto;
  return out;
}

/** ri-normalizza un elenco e ricompatta i doppioni per modello */
export function renormalizeDeals(deals = []) {
  const cleaned = [];
  let dropped = 0;
  for (const d of deals) {
    const n = normalizeDeal(d);
    if (n) cleaned.push(n);
    else dropped += 1;
  }
  return { deals: dedupeDeals(cleaned), dropped };
}

/** stato vuoto utile quando il sito non ha ancora dati */
export function emptySnapshot(channels = DEFAULT_CHANNELS) {
  const meta = {};
  for (const ch of channels) meta[ch] = { title: CHANNEL_INFO[ch]?.title || ch };
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    mode: "static",
    deals: [],
    stats: computeStats([], meta, { now }),
    channels: buildChannels([], meta),
  };
}
