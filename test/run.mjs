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
  mergeDeals,
  dedupeDeals,
  computeStats,
  pruneDeals,
} from "../lib/tg.js";
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
  assert.equal(detectCategory("Cuffie con ANC attivo"), "anc");
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
test("prune elimina le offerte vecchie", () => {
  const old = { ...first[0], key: "old", postedAt: new Date(Date.now() - 40 * 86400000).toISOString() };
  const kept = pruneDeals([old, ...first], { days: 30 });
  assert.ok(!kept.some((d) => d.key === "old"));
  assert.equal(kept.length, first.length);
});

if (!process.exitCode) console.log(`\n${passed} test superati ✅`);
else console.log(`\n${passed} test superati, alcuni falliti ❌`);
