/* ───────────────────────────────────────────────────────────────
   lib/tg.js — motore di scansione condiviso (browser + Node)
   Legge l'anteprima pubblica dei canali Telegram (t.me/s/<canale>),
   estrae le offerte di auricolari/cuffie e le normalizza nel formato
   usato da index.html / app.js / data.json.
   Nessuna dipendenza esterna: usa solo espressioni regolari.
   ─────────────────────────────────────────────────────────────── */

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
  ["SteelSeries", /steelseries/i],
  ["Logitech", /\blogitech\b|\blogitech g\b|\bg\s?pro\b|\bastro\b/i],
  ["Marshall", /\bmarshall\b/i],
  ["Bose", /\bbose\b/i],
  ["Sony", /\bsony\b|\bwf-1000|\bwh-1000|\blinkbuds\b/i],
  ["Samsung", /\bsamsung\b|\bgalaxy\s*buds\b/i],
  ["Apple", /\bapple\b|\bairpods?\b|\bbeats\b/i],
  ["Google", /\bgoogle\b|\bpixel\s*buds?\b/i],
  ["Huawei", /\bhuawei\b|\bfreebuds\b/i],
  ["Honor", /\bhonor\b/i],
  ["Xiaomi", /\bxiaomi\b|\bredmi\b|\bpoco\b/i],
  ["Nothing", /\bnothing\b|\bcmf\b/i],
  ["OnePlus", /\boneplus\b/i],
  ["Realme", /\brealme\b/i],
  ["Oppo", /\boppo\b/i],
  ["Vivo", /\bvivo\b/i],
  ["Anker", /\banker\b|\bsoundcore\b|\bnebula\b/i],
  ["Edifier", /\bedifier\b/i],
  ["JBL", /\bjbl\b/i],
  ["Jabra", /\bjabra\b/i],
  ["Beats", /\bbeats\b/i],
  ["Shokz", /\bshokz\b|\bafter\s*shokz\b/i],
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
  ["Trust", /\btrust\b/i],
  ["Baseus", /\bbaseus\b/i],
  ["Ugreen", /\bugreen\b/i],
  ["QCY", /\bqcy\b/i],
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
  ["Irradio", /\birradio\b/i],
  ["Lenco", /\blenco\b/i],
  ["Muse", /\bmuse\b/i],
];

const AUDIO_POSITIVE = /(?:\b)(?:cuffie|cuffia|auricolari?|earbuds?|earphones?|headphones?|headset|airpods?|freebuds|tws|true[-\s]?wireless|in[-\s]?ear|on[-\s]?ear|over[-\s]?ear|open[-\s]?ear|earclips?|soundcore|pixel\s*buds?|galaxy\s*buds?|redmi\s*buds?|nothing\s*ear|wh-1000|wf-1000|quietcomfort|liberty\s*[34]|neobuds?|soundpeats|earfun|shokz|bone\s+conduction)(?:\b|$)/iu;

const AUDIO_NEGATIVE = /(?:\b|^)(?:soundbar|diffusor[ei]?|speaker|casse|altoparlant[ei]|robot|aspirapolvere|lavapavimenti|tv|televisore|monitor|smartwatch|orologio|tablet|power\s*bank|caricatore|mouse|tastiera|drone|action\s*cam|fotocamera|camera|console|joypad|controller|hard\s*disk|ssd|router|stampante|proiettore|lampada|ventilatore|frullatore|microonde|phon|asciugacapelli|smartphone|telefono|lavatrice|frigorifero|condizionatore|depuratore|bilancia|segway|scooter|bici(?:cletta)?|e-?bike)(?:\b|$)/iu;

const CATEGORY_LABELS = {
  tws: ["True wireless", "🎧"],
  cuffie: ["Cuffie over-ear", "🎧"],
  anc: ["Con ANC", "🔇"],
  gaming: ["Gaming", "🎮"],
  sport: ["Sport", "🏃"],
  open: ["Open-ear / clip", "👂"],
};

export function detectBrand(text = "") {
  for (const [name, re] of BRANDS) if (re.test(text)) return name;
  return null;
}

export function detectCategory(text = "") {
  const t = String(text);
  if (/\b(gaming|gamer|ps5|playstation|xbox|lightspeed|hyperx|razer|steelseries|logitech g)\b/i.test(t)) return "gaming";
  if (/\b(sport|running|corsa|palestra|nuoto|allenamento|ipx[4-8]|ip6[7-8])\b/i.test(t)) return "sport";
  if (/\b(open[-\s]?ear|open\s+ear|ear\s*clip|bone\s+conduction|conduzione\s+ossea|shokz)\b/i.test(t)) return "open";
  // prima TWS: un auricolare ANC resta comunque un "true wireless"
  if (/\b(tws|true[-\s]?wireless|auricolari|earbuds?|earphones?|in[-\s]?ear|airpods?|freebuds|pixel\s*buds?|galaxy\s*buds?|redmi\s*buds?|buds)\b/i.test(t)) return "tws";
  if (/\b(anc|noise\s*cancel\w*|cancellazione\s+(?:attiva\s+)?(?:del\s+)?rumore|quietcomfort|wh-1000|wf-1000|neobuds\s+planar)\b/i.test(t)) return "anc";
  if (/\b(cuffie|cuffia|headphones?|over[-\s]?ear|on[-\s]?ear|headset)\b/i.test(t)) return "cuffie";
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
const RE_FOOTER = /(offerta\s+vista\s+su|altre\s+offerte|ottiene\s+commissioni|hai\s+risparmiato|condiviso\s+da|#aff\b|#adv\b|spunta\s+box|coupon\s+gi[aà]\s+attivi|segui\s+tutte|iscriviti|unisciti|un\s+canale|le\s+migliori\s+offerte\s+del\s+giorno|migliori\s+offerte\s+tech\s+di\s+oggi|download\s+app|scopri\s+di\s+pi[uù])/i;
const RE_STORE_LINE = /^(?:[▪️•\-–]\s*)?#(amazon|aliexpress|unieuro|mediaworld|ebay|temu|banggood|gear\w*|shein|zalando|decathlon|euronics|trony|expert|comet)\b|^(?:[▪️•\-–]\s*)?(?:🛍️?|🏬|🏪)\s*[A-ZÀ-Ýa-z]/i;
const RE_VENDUTO = /(?:venduto(?:\s+e\s+spedito)?\s+da|spedito\s+da|consegna\s+a\s+domicilio)/i;
const RE_CTA = /(vedi\s+offerta|acquista|compra\s+ora|vai\s+all['’]offerta|approfitta|scopri\s+l['’]offerta|vedi\s+il\s+prodotto|clicca\s+qui)/i;
const RE_COUPON = /(coupon|sconto\s+automatico|codice)/i;
const RE_TITLE_MARKER = /^(?:🔷|🔹|📌|🎧|🎮|🎵|💥|⚡|🔥|❗️|❗|👉🏻|👉|✅|⭐️|⭐|🆕|🎁|➡️|➡|💶|💸|🤑|🏷️|🏷)\s*/u;
const RE_NUMBERED = /^\d{1,2}[).]\s*/;
/** "1) 👉🏻 Samsung TV…" → titolo pulito */
const RE_NUM_ITEM = /^\d{1,2}[).]\s*/;

function hasRealPrice(t) {
  if (!RE_HAS_PRICE.test(t)) return false;
  const max = Math.max(...(t.match(/[\d][\d.,]{0,8}\s*€/g) || ["0"]).map((x) => parsePrice(x) || 0));
  return max >= 2 && max <= 5000;
}

function classifyLine(line) {
  const t = line.text.trim();
  if (!t) return "EMPTY";
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

function detectStore(blockText, url) {
  for (const [tag, name] of Object.entries(STORES)) {
    if (new RegExp(`#${tag}\\b`, "i").test(blockText)) return name;
  }
  const shippedBy = /(?:venduto(?:\s+e\s+spedito)?\s+da|spedito\s+da)\s+(?:amazon)/i.test(blockText);
  if (shippedBy) return "Amazon";
  const shop = /(?:🛍️?|🏬|🏪)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.&\- ]{1,18})/.exec(blockText);
  if (shop) {
    const name = shop[1].trim().replace(/\s+$/, "");
    if (/amazon/i.test(name)) return "Amazon";
    if (/aliexpress/i.test(name)) return "AliExpress";
    if (name.length >= 3) return name.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (/spedito\s+da\s+amazon|venduto\s+(?:e\s+spedito\s+)?da\s+amazon/i.test(blockText)) return "Amazon";
  const host = hostOf(url || "");
  for (const [re, name] of DOMAIN_STORES) if (re.test(host)) return name;
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

/**
 * Estrae le offerte da un singolo post.
 * @param {object} post risultato di parseChannelPage
 * @param {object} [opts]
 */
export function extractOffers(post, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const lines = (post.lines || []).filter((l) => l.text || l.links.length);
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
    if (kind === "PRICE") {
      const p = priceFromLine(line);
      if (p) cur.prices.push(p);
    }
    if (kind === "STORE" && !cur.store) cur.store = detectStore(line.text, null);
    if (kind === "CTA") cur.cta = true;
  }
  pushBlock();

  const deals = [];
  const seen = new Set();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const blockText = b.lines.map((l) => l.text).join("\n");
    const priceInfo = b.prices[0];
    if (!priceInfo || !priceInfo.price) continue;
    let title = cleanTitle(b.title);
    if (!title || title.length < 10) {
      title = cleanTitle(post.preview?.title || (post.text || "").split("\n")[0] || "");
    }
    if (!title) continue;
    const oldPrice = priceInfo.oldPrice && priceInfo.oldPrice > priceInfo.price ? priceInfo.oldPrice : null;
    let discount = oldPrice ? Math.round((1 - priceInfo.price / oldPrice) * 100) : (priceInfo.discountHint || null);
    if (discount !== null) discount = Math.max(0, Math.min(95, discount));
    let url = pickUrl(b, post);
    const store = detectStore(blockText, url);
    if (!/^https?:/i.test(url)) url = post.messageUrl;
    const brand = detectBrand(`${title} ${blockText}`);
    const audio = isAudioOffer(title, blockText);
    if (!audio && !opts.keepNonAudio) continue;
    const category = detectCategory(`${title} ${blockText}`);
    const [categoryLabel, categoryEmoji] = CATEGORY_LABELS[category] || CATEGORY_LABELS.cuffie;
    const fingerprint = hash(norm(title));
    const key = hash(`${post.channel}|${post.id}|${i}|${norm(title)}|${priceInfo.price}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const deal = {
      key,
      title,
      price: priceInfo.price,
      oldPrice,
      discount,
      currency: "EUR",
      url,
      store,
      image: post.photo || post.preview?.image || null,
      brand,
      model: null,
      category,
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
      deto: undefined,
      dupKey: `${norm(title)}|${priceInfo.price}`,
      priceSource: "channel",
      priceSuspect: false,
    };
    delete deal.deto;
    deals.push(deal);
  }
  return deals;
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
    (/^https:\/\/(?:[a-z.]+)?amazon\./i.test(d.url || "") ? 1 : 0);
  return score(a) >= score(b) ? a : b;
}

/** unisce offerte che sono lo stesso prodotto su canali diversi */
export function dedupeDeals(deals = []) {
  const groups = new Map();
  for (const d of deals) {
    const k = d.dupKey || `${norm(d.title)}|${d.price}`;
    const g = groups.get(k);
    if (!g) groups.set(k, [d]);
    else g.push(d);
  }
  const out = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      const seenOther = new Map();
      for (const o of only.alsoOn || []) if (o?.channel && o.channel !== only.channel) seenOther.set(o.channel, o);
      out.push({ ...only, alsoOn: [...seenOther.values()] });
      continue;
    }
    group.sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
    const merged = group.reduce((acc, d) => pickPrimary(acc, d));
    const others = group.filter((d) => d !== merged);
    const also = new Map();
    for (const o of [...(merged.alsoOn || []), ...others.flatMap((o) => o.alsoOn || []), ...others]) {
      const ch = o.channel;
      if (!ch || ch === merged.channel) continue;
      also.set(ch, { channel: ch, channelTitle: o.channelTitle || null, messageUrl: o.messageUrl || `https://t.me/${ch}/${o.messageId || ""}` });
    }
    const alsoList = [...also.values()].sort(
      (a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0),
    );
    out.push({ ...merged, alsoOn: alsoList });
  }
  return out;
}

/**
 * Fonde l'archivio con le offerte appena scansionate.
 * @returns {{deals:Array, added:Array, updated:number}}
 */
export function mergeDeals(existing = [], incoming = [], nowIso = new Date().toISOString()) {
  const map = new Map();
  const byDup = new Map();
  for (const d of existing) {
    map.set(d.key, d);
    byDup.set(d.dupKey || `${norm(d.title)}|${d.price}`, d.key);
  }
  const added = [];
  let updated = 0;
  for (const inc of incoming) {
    const dup = inc.dupKey || `${norm(inc.title)}|${inc.price}`;
    const prevKey = map.has(inc.key) ? inc.key : byDup.get(dup);
    const prev = prevKey ? map.get(prevKey) : null;
    if (prev) {
      map.set(prev.key, {
        ...prev,
        ...inc,
        key: prev.key,
        firstSeenAt: prev.firstSeenAt || inc.firstSeenAt || nowIso,
        lastSeenAt: nowIso,
        seenCount: (prev.seenCount || 1) + 1,
        views: Math.max(prev.views || 0, inc.views || 0),
        alsoOn: [...(prev.alsoOn || []), ...(inc.alsoOn || [])],
        dupKey: prev.dupKey || dup,
      });
      updated += 1;
    } else {
      map.set(inc.key, { ...inc, firstSeenAt: inc.firstSeenAt || nowIso, lastSeenAt: nowIso, seenCount: 1 });
      byDup.set(dup, inc.key);
      added.push(inc);
    }
  }
  const deals = dedupeDeals([...map.values()]).sort(
    (a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0),
  );
  return { deals, added, updated };
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
    categories: countPairs(audio.map((d) => d.category), 10),
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
