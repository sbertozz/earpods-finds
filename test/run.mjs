/* Test del motore di scansione: `node test/run.mjs` */
import assert from "node:assert/strict";
import {
  parseChannelPage,
  extractOffers,
  offersFromHtml,
  parsePrice,
  parseViews,
  isAudioOffer,
  detectBrand,
  detectCategory,
  hasAncText,
  mergeDeals,
  dedupeDeals,
  computeStats,
  pruneDeals,
  splitMultiOfferLines,
  renormalizeDeals,
  upgradeImage,
} from "../lib/tg.js";
import { MODELS, matchModel, deriveModelKey, specsFromText, buildProfile, mergeSpecs } from "../lib/models.js";
import { SCONTICINA_HTML, PREZZITECH_HTML, OFFERTEDALE_HTML } from "./fixtures.mjs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

console.log("parsePrice / parseViews");
test("prezzi it/en", () => {
  assert.equal(parsePrice("199,99 €"), 199.99);
  assert.equal(parsePrice("93,6€"), 93.6);
  assert.equal(parsePrice("1.403,22"), 1403.22);
  assert.equal(parsePrice("129"), 129);
  assert.equal(parsePrice("14,30"), 14.3);
  assert.equal(parsePrice("abc"), null);
});
test("views con suffissi", () => {
  assert.equal(parseViews("1.2K"), 1200);
  assert.equal(parseViews("2,4 M"), 2400000);
  assert.equal(parseViews("1 234"), 1234);
  assert.equal(parseViews(""), 0);
});

console.log("parseChannelPage");
const sconti = parseChannelPage(SCONTICINA_HTML, "sconticina");
test("titolo canale + foto", () => {
  assert.match(sconti.info.title, /ScontiCina/);
  assert.match(sconti.info.photo, /chanphoto\.jpg/);
});
test("3 post trovati, id e date", () => {
  assert.equal(sconti.posts.length, 3);
  assert.deepEqual(sconti.posts.map((p) => p.id), [99237, 99238, 99240]);
  assert.equal(sconti.posts[0].datetime, "2026-11-13T09:37:43+00:00");
  assert.equal(sconti.posts[1].views, 1200);
});
test("testo decodificato e foto estratte", () => {
  assert.match(sconti.posts[0].text, /Bowers & Wilkins Cuffie Wireless Px7/);
  assert.match(sconti.posts[0].photo, /photo99237\.jpg/);
  assert.equal(sconti.posts[0].messageUrl, "https://t.me/sconticina/99237");
});

console.log("extractOffers");
const scontiDeals = offersFromHtml(SCONTICINA_HTML, "sconticina");
test("2 offerte audio dal post multi-offerta, aspirapolvere escluso", () => {
  const fromFirst = scontiDeals.filter((d) => d.messageId === 99237);
  assert.equal(fromFirst.length, 2);
  assert.ok(scontiDeals.every((d) => d.isAudio));
  assert.ok(!scontiDeals.some((d) => /Narwal/.test(d.title)));
});
test("prezzo scontato + prezzo pieno + sconto", () => {
  const d = scontiDeals.find((x) => x.messageId === 99237);
  assert.equal(d.price, 199.99);
  assert.equal(d.oldPrice, 249.55);
  assert.equal(d.discount, 20);
  assert.equal(d.store, "Amazon");
  assert.equal(d.brand, "Bowers & Wilkins");
  assert.equal(d.url, "https://www.amazon.it/dp/B0CH1XRDTR?psc=1&tag=scontiamz-21");
  assert.equal(d.category, "cuffie");
  assert.equal(d.currency, "EUR");
});
test("seconda offerta dello stesso post", () => {
  const d = scontiDeals.find((x) => /Px 8/.test(x.title));
  assert.equal(d.price, 324.5);
  assert.equal(d.oldPrice, 399.99);
});
test("cuffie gaming → categoria gaming", () => {
  const d = scontiDeals.find((x) => x.messageId === 99240);
  assert.equal(d.category, "gaming");
  assert.equal(d.price, 54.99);
});

const prezzitechDeals = offersFromHtml(PREZZITECH_HTML, "prezzitech");
test("post Prezzi.Tech con formato compatto", () => {
  assert.equal(prezzitechDeals.length, 1);
  const d = prezzitechDeals[0];
  assert.match(d.title, /Pixel Buds 2a/);
  assert.equal(d.price, 93.6);
  assert.equal(d.oldPrice, 119);
  assert.equal(d.store, "Amazon");
  assert.equal(d.brand, "Google");
  assert.equal(d.category, "tws");
  assert.equal(d.url, "https://prezzi.tech/go/bgcx");
});

const daleDeals = offersFromHtml(OFFERTEDALE_HTML, "offertedale");
test("post multi-prodotto numerato: solo le cuffie", () => {
  assert.equal(daleDeals.length, 1);
  const d = daleDeals[0];
  assert.match(d.title, /IRRADIO IR-H606BT cuffie Bluetooth/);
  assert.equal(d.price, 14.3);
  assert.equal(d.oldPrice, 30.39);
  assert.equal(d.store, "Amazon");
  assert.equal(d.channel, "offertedale");
});

console.log("classificazione");
test("isAudioOffer", () => {
  assert.ok(isAudioOffer("Sony WH-1000XM5 Cuffie Wireless", ""));
  assert.ok(!isAudioOffer("Bose SoundLink Home diffusore", "Bluetooth"));
  assert.ok(!isAudioOffer("Robot aspirapolvere", "Cuffie incluse?"));
  assert.ok(isAudioOffer("Offerte tech", "cuffie Bluetooth a 19€"));
});
test("brand e categoria", () => {
  assert.equal(detectBrand("Apple AirPods Pro 3"), "Apple");
  assert.equal(detectBrand("Soundcore P20i di Anker"), "Anker");
  assert.equal(detectBrand("Bowers & Wilkins Px8"), "Bowers & Wilkins");
  assert.equal(detectCategory("Auricolari TWS sport IPX7"), "sport");
  // l'ANC non è più una categoria: è un flag, la forma resta over-ear
  assert.equal(detectCategory("Cuffie con ANC attivo"), "cuffie");
  assert.ok(hasAncText("Cuffie con ANC attivo"));
});

console.log("modelli (anagrafica + dedupe per modello)");
test("matchModel riconosce generazioni e varianti", () => {
  assert.equal(matchModel("HUAWEI FreeBuds SE 5 MAX").entry.model, "FreeBuds SE 5 Max");
  assert.equal(matchModel("HUAWEI FreeBuds SE 3 Nere 42h").entry.model, "FreeBuds SE 3");
  assert.equal(matchModel("Google Pixel Buds Pro 2").entry.model, "Pixel Buds Pro 2");
  assert.equal(matchModel("Google Pixel Buds 2a").entry.model, "Pixel Buds 2a");
  assert.equal(matchModel("Bowers & Wilkins Px7 S2e").entry.model, "Px7 S2e");
  assert.equal(matchModel("IRRADIO IR-H606BT Pro").entry.model, "IR-H606BT Pro");
  assert.equal(matchModel("IRRADIO IR-H606BT cuffie").entry.model, "IR-H606BT");
  assert.equal(matchModel("Sony WH-1000XM5").entry.model, "WH-1000XM5");
  assert.equal(matchModel("Sony WH-1000XM4C").entry.model, "WH-1000XM4");
  assert.ok(MODELS.length >= 50, "l'anagrafica deve avere almeno 50 modelli");
});
test("brand dedotto dal modello anche senza marca nel titolo", () => {
  assert.equal(detectBrand("Auricolari true wireless Pixel Buds Pro 2", ""), "Google");
  assert.equal(detectBrand("HUAWEI CUFFIE TRUE WIRELESS", ""), "Huawei");
  assert.equal(detectBrand("UGREEN Studio Pro Cuffie", ""), "Ugreen"); // non Beats
  assert.equal(detectBrand("GXTrust Rayne: cuffie gaming", ""), "Trust");
  assert.equal(detectBrand("Turtle Beach Atlas Air cuffie", ""), "Turtle Beach");
});
test("categorie: TWS vs over-ear vs open, ANC come flag", () => {
  assert.equal(detectCategory("HUAWEI FreeBuds SE 5 MAX Auricolari"), "tws");
  assert.equal(detectCategory("Bose QuietComfort Ultra cuffie over-ear"), "cuffie");
  assert.equal(detectCategory("HUAWEI FreeClip 2 Blu, Cuffie Bluetooth"), "open");
  assert.equal(detectCategory("Baseus MC1 Pro Auricolari Aperti"), "open");
  assert.equal(detectCategory("Cuffie gaming Logitech G325"), "gaming");
  assert.equal(detectCategory("JLab Epic Pods ANC Auricolari"), "tws");
});
test("deriveModelKey: stesso prodotto → stessa chiave, prodotti diversi → chiavi diverse", () => {
  const a = deriveModelKey({ title: "HUAWEI FreeBuds SE 5 MAX, Auricolari Wireless", brand: "Huawei" });
  const b = deriveModelKey({ title: "Auricolari true wireless HUAWEI FreeBuds SE 5 MAX", brand: "Huawei" });
  const c = deriveModelKey({ title: "HUAWEI FreeBuds SE 3 Nere 42h", brand: "Huawei" });
  assert.equal(a.modelKey, b.modelKey);
  assert.notEqual(a.modelKey, c.modelKey);
  assert.match(a.modelKey, /^huawei:freebudsse5max$/);
  const px7 = deriveModelKey({ title: "Bowers & Wilkins Px7 S2e", brand: "Bowers & Wilkins" });
  const px8 = deriveModelKey({ title: "Bowers & Wilkins Px 8", brand: "Bowers & Wilkins" });
  assert.notEqual(px7.modelKey, px8.modelKey);
});

console.log("merge / dedupe / stats");
const first = offersFromHtml(SCONTICINA_HTML, "sconticina");
const dup = offersFromHtml(SCONTICINA_HTML, "sconticina").map((d) => ({ ...d, channel: "altrocanale", key: d.key + "x" }));
test("nessun duplicato al secondo passaggio", () => {
  const now = new Date().toISOString();
  const r1 = mergeDeals([], first, now);
  assert.equal(r1.deals.length, first.length);
  assert.equal(r1.added.length, first.length);
  const r2 = mergeDeals(r1.deals, first, now);
  assert.equal(r2.deals.length, first.length);
  assert.equal(r2.added.length, 0);
  assert.ok(r2.updated >= first.length);
});
test("stessa offerta su 2 canali → una card con alsoOn", () => {
  const merged = dedupeDeals([...first, ...dup]);
  assert.equal(merged.length, first.length);
  const withAlt = merged.find((d) => (d.alsoOn || []).length > 0);
  assert.ok(withAlt, "manca alsoOn");
  assert.ok(["sconticina", "altrocanale"].includes(withAlt.channel));
  assert.ok(withAlt.alsoOn.some((o) => o.channel === "altrocanale" || o.channel === "sconticina"));
});
test("stats coerenti con la UI", () => {
  const merged = dedupeDeals([...first, ...offersFromHtml(PREZZITECH_HTML, "prezzitech")]);
  const stats = computeStats(merged, { sconticina: { title: "ScontiCina" } });
  assert.equal(stats.totalDeals, merged.length);
  assert.equal(typeof stats.avgPrice, "number");
  const expectedBest = Math.max(...merged.map((d) => d.discount || 0));
  assert.equal(stats.bestDiscount, expectedBest);
  assert.ok(Array.isArray(stats.categories) && stats.categories.length > 0);
  assert.ok(Array.isArray(stats.brands) && stats.brands.some(([b]) => b === "Bowers & Wilkins"));
  assert.equal(stats.sources.length, 1);
  assert.equal(stats.scanner.running, false);
});
test("dedupe per modello: una card, prezzo migliore, canali e segnalazioni", () => {
  const base = {
    title: "HUAWEI FreeBuds SE 5 MAX, Auricolari Wireless",
    brand: "Huawei", model: "FreeBuds SE 5 Max", modelKey: "huawei:freebudsse5max",
    category: "tws", hasAnc: true, isAudio: true, image: null, text: "testo offerta",
    oldPrice: null, discount: 20, postedAt: "2026-11-13T09:00:00Z",
  };
  const a = { ...base, key: "a", price: 39.99, channel: "sconticina", messageId: 1, store: "Amazon", url: "https://www.amazon.it/dp/1" };
  const b = { ...base, key: "b", price: 39, channel: "prezzitech", messageId: 2, store: "Amazon", url: "https://prezzi.tech/go/x" };
  const c = { ...base, key: "c", price: 39, channel: "offertedale", messageId: 3, store: "Amazon", url: "https://www.amazon.it/dp/1" };
  const merged = dedupeDeals([a, b, c]);
  assert.equal(merged.length, 1);
  const card = merged[0];
  assert.equal(card.price, 39, "deve mostrare il prezzo migliore");
  assert.equal(card.alsoOn.length, 2, "deve elencare gli altri canali");
  assert.ok(card.alsoOn.some((o) => o.channel === "prezzitech"));
  assert.ok(card.seenCount >= 3, "deve contare le segnalazioni");
});
test("post con elenco a un solo a capo: ogni riga ha il suo prezzo", () => {
  const txt = [
    "🆕 NUOVI ARRIVI:",
    "🟢 Xiaomi Smart Band 10 Pro AMOLED a 62.40€ con ITD1106",
    "🔴 Sony WH-1000XM5 Cuffie Wireless ANC a 203.01€ con ITD1125",
    "🟣 Garmin Instinct 3 Solar GPS da 269.31€ a 258.47€ con ITD1145",
  ];
  const lines = txt.map((t) => ({ text: t, links: [] }));
  assert.ok(splitMultiOfferLines(lines).length >= 3, "deve separare le voci dell'elenco");
  const post = { channel: "sconty_online", id: 1, datetime: "2026-11-13T09:00:00Z", lines, text: txt.join("\n"), messageUrl: "https://t.me/sconty_online/1" };
  const deals = extractOffers(post);
  assert.equal(deals.length, 1, "solo le cuffie");
  assert.equal(deals[0].price, 203.01, "il prezzo non deve essere quello dello smartwatch");
  assert.equal(deals[0].brand, "Sony");
});
test("niente card fantasma da venditore/risparmio", () => {
  const lines = [
    "🔷 Cuffie Bluetooth Sport 120 Ore",
    "▪️ #Amazon",
    "💰 A soli 23,99 € invece di 129,99 €",
    "🚛 Venduto da LI-Auricolari Vendita Diretta e spedito da Amazon.",
    "🦊 Con quest'offerta hai risparmiato 106,00 €!",
  ].map((t) => ({ text: t, links: [] }));
  const post = { channel: "sconticina", id: 99217, datetime: "2026-11-13T09:00:00Z", lines, text: lines.map((l) => l.text).join("\n"), messageUrl: "https://t.me/sconticina/99217" };
  const deals = extractOffers(post);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].price, 23.99);
  assert.ok(!/Venduto da/i.test(deals[0].title));
  assert.equal(deals[0].store, "Amazon");
});
test("store: mai \"Store\" generico, shortener risolto dal testo", () => {
  const mk = (body, url, ch = "prezzitech") => offersFromHtml(
    `<div data-post="${ch}/1"><div class="tgme_widget_message_text">${body}</div></div>`, ch,
  ).map((d) => d.store);
  assert.deepEqual(mk("📌 Google Pixel Buds 2a<br/><br/>🛍 Amazon<br/>💰 93,6€ invece di 119€<br/>👉 <a href=\"https://prezzi.tech/go/bgcx\">x</a>", "https://prezzi.tech/go/bgcx"), ["Amazon"]);
  assert.deepEqual(mk("Sony WH-1000XM5 cuffie<br/>🛍 Store<br/>💰 168,86€ invece di 229€", "https://t.me/x/1"), [null]);
  assert.deepEqual(mk("Cuffie Sony WH-1000XM5<br/>💰 168,86€ invece di 229€<br/>Venduto e spedito da Amazon.", "https://ofclub.click/a1"), ["Amazon"]);
});
test("normalizza vecchie card: fantasma eliminata, prezzo corretto, store pulito", () => {
  const ghost = {
    key: "g", title: "Venduto da LI-Auricolari Vendita Diretta e spedito", price: 106,
    text: "Cuffie Sport\n💰 A soli 23,99 € invece di 129,99 €\n🦊 hai risparmiato 106,00 €!", store: "Amazon",
    channel: "sconticina", messageId: 1, isAudio: true,
  };
  assert.equal(renormalizeDeals([ghost]).deals.length, 0);
  const round = {
    key: "r", title: "Google Pixel Buds 2a - Auricolari wireless", price: 93.6, store: "Store",
    text: "Google Pixel Buds 2a\n🛍 Amazon\n💰 93,6€ invece di 119€", channel: "prezzitech", messageId: 2, isAudio: true,
  };
  const out = renormalizeDeals([round]).deals[0];
  assert.equal(out.store, "Amazon");
  assert.equal(out.brand, "Google");
  assert.equal(out.model, "Pixel Buds 2a");
  assert.equal(out.category, "tws");
});
test("specifiche dal post e scheda pro/contro", () => {
  const specs = specsFromText("ANC multimodale a 52 dB, Audio Hi-Res, fino a 80 ore, IP54, multipoint, LDAC");
  assert.equal(specs.ancDb, 52);
  assert.equal(specs.batt, 80);
  assert.equal(specs.ip, "IP54");
  assert.ok(specs.multipoint);
  assert.ok(specs.codecs.includes("LDAC"));
  const known = matchModel("Sony WH-1000XM5");
  const profile = buildProfile({ title: "Sony WH-1000XM5 Cuffie", specs: mergeSpecs(known.entry.specs, specsFromText("")), postSpecs: specsFromText("") });
  assert.equal(profile.known, true);
  assert.equal(profile.pros.length, 2);
  assert.equal(profile.cons.length, 2);
  assert.ok(profile.specs.length >= 4);
  // modello sconosciuto: scheda parziale ma sempre 2+2
  const odd = buildProfile({ title: "Boytond 2026 Cuffie Bluetooth IPX7 Sportive", category: "sport", postSpecs: specsFromText("IPX7, Bluetooth 6.1") });
  assert.equal(odd.known, false);
  assert.equal(odd.partial, true);
  assert.equal(odd.pros.length, 2);
  assert.equal(odd.cons.length, 2);
});
test("upgradeImage toglie i suffissi miniatura", () => {
  assert.equal(upgradeImage("https://m.media-amazon.com/images/I/x._AC_UL320_.jpg"), "https://m.media-amazon.com/images/I/x.jpg");
  assert.equal(upgradeImage(null), null);
});
test("prune elimina le offerte vecchie", () => {
  const old = { ...first[0], key: "old", postedAt: new Date(Date.now() - 40 * 86400000).toISOString() };
  const kept = pruneDeals([old, ...first], { days: 30 });
  assert.ok(!kept.some((d) => d.key === "old"));
  assert.equal(kept.length, first.length);
});

if (!process.exitCode) console.log(`\n${passed} test superati ✅`);
else console.log(`\n${passed} test superati, alcuni falliti ❌`);
