/* ───────────────────────────────────────────────────────────────
   lib/models.js — anagrafica modelli + schede pro/contro
   Nessuna dipendenza: usato sia da lib/tg.js (Node/scan) sia da
   app.js (browser) per deduplica per modello e pannello dettagli.

   Contiene:
   - MODELS: ~60 modelli di cuffie/auricolari più frequenti nei
     canali Telegram tech italiani (specifiche curate a mano);
   - matchModel(): riconosce il modello nel testo del post;
   - deriveModelKey(): chiave stabile "marchio:modello" per il dedupe;
   - specsFromText(): specifiche dedotte dal testo del post;
   - buildProfile(): 2 pro + 2 contro + specifiche per la card.
   ─────────────────────────────────────────────────────────────── */

/* ─────────────── utility ─────────────── */

const stripAccents = (s = "") =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** slug compatto: "WH-1000XM5" → "wh1000xm5" */
export function slug(s = "") {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/* ─────────────── anagrafica modelli ───────────────
   form:  tws | over-ear | on-ear | open | sport | gaming
   specs: { anc, batt, bt, ip, weight, codecs[], multipoint, mics }
   highlight / weak: il dettaglio specifico che rende la scheda utile
   (i pro/contro generici vengono generati dalle specifiche).
   ------------------------------------------------------------ */

export const MODELS = [
  /* ── Apple ── */
  { brand: "Apple", model: "AirPods Pro 3", form: "tws", re: /airpods?\s*pro\s*(?:3|terza)/i,
    specs: { anc: "Ibrida adattiva", batt: "8 h (24 h con custodia)", bt: "5.3", ip: "IP54", weight: "5,1 g", codecs: ["AAC"], multipoint: false, mics: 4 },
    highlight: "Riduzione del rumore ai vertici e modalità Trasparenza naturale",
    weak: "Con iPhone: alcune funzioni avanzate restano legate ad Apple Intelligence" },
  { brand: "Apple", model: "AirPods Pro 2", form: "tws", re: /airpods?\s*pro\s*(?:2|seconda)/i,
    specs: { anc: "Ibrida adattiva", batt: "6 h (30 h con custodia)", bt: "5.3", ip: "IP54", weight: "5,3 g", codecs: ["AAC"], multipoint: false, mics: 4 },
    highlight: "ANC eccellente e audio adattivo, ottima integrazione con iPhone/Mac",
    weak: "Codec solo AAC, niente multipoint su Android" },
  { brand: "Apple", model: "AirPods 4", form: "tws", re: /airpods?\s*4(?!\s*pro)/i,
    specs: { anc: false, batt: "5 h (30 h con custodia)", bt: "5.3", ip: "IP54", weight: "4,3 g", codecs: ["AAC"], multipoint: false, mics: 2 },
    highlight: "Fit aperto comodissimo per ore e custodia piccolissima",
    weak: "Senza gommini non isola: serve la versione con ANC per i viaggi" },
  { brand: "Apple", model: "AirPods Max", form: "over-ear", re: /airpods?\s*max/i,
    specs: { anc: "Ibrida", batt: "20 h", bt: "5.3", ip: null, weight: "385 g", codecs: ["AAC"], multipoint: false, mics: 9 },
    highlight: "Materiali premium e spazialità audio notevole",
    weak: "Pesante e costoso; custodia poco protettiva" },

  /* ── Sony ── */
  { brand: "Sony", model: "WH-1000XM6", form: "over-ear", re: /wh-?1000\s*xm6/i,
    specs: { anc: "Ibrida QN3, 12 mic", batt: "30 h", bt: "5.3", ip: null, weight: "254 g", codecs: ["LDAC", "AAC", "SBC"], multipoint: true, mics: 12 },
    highlight: "La reference per ANC e qualità audio in viaggio",
    weak: "Prezzo alto e non si piega in una custodia davvero compatta" },
  { brand: "Sony", model: "WH-1000XM5", form: "over-ear", re: /wh-?1000\s*xm5/i,
    specs: { anc: "Ibrida 8 mic", batt: "30 h (38 h senza ANC)", bt: "5.2", ip: null, weight: "250 g", codecs: ["LDAC", "AAC", "SBC"], multipoint: true, mics: 8 },
    highlight: "ANC di altissimo livello, 30 ore reali e multipoint",
    weak: "Cuffia non pieghevole e custodia ingombrante" },
  { brand: "Sony", model: "WH-1000XM4", form: "over-ear", re: /wh-?1000\s*xm4/i,
    specs: { anc: "Ibrida", batt: "30 h", bt: "5.0", ip: null, weight: "254 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 4 },
    highlight: "Rapporto qualità/prezzo stellare: ANC top a prezzi da offerta",
    weak: "Bluetooth 5.0 e microfono sotto i modelli più recenti" },
  { brand: "Sony", model: "WF-1000XM5", form: "tws", re: /wf-?1000\s*xm5/i,
    specs: { anc: "Ibrida, 8.4 mm driver", batt: "8 h (24 h con custodia)", bt: "5.3", ip: "IPX4", weight: "5,9 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 6 },
    highlight: "I migliori auricolari ANC Sony: suono pieno e LDAC",
    weak: "Custodia grande e gommini da scegliere con cura per il fit" },
  { brand: "Sony", model: "WF-1000XM4", form: "tws", re: /wf-?1000\s*xm4/i,
    specs: { anc: "Ibrida", batt: "8 h (24 h con custodia)", bt: "5.2", ip: "IPX4", weight: "7,3 g", codecs: ["LDAC", "AAC"], multipoint: false, mics: 4 },
    highlight: "ANC e resa sonora ancora attuali, spesso in forte sconto",
    weak: "Niente multipoint e gommini in schiuma che si consumano" },
  { brand: "Sony", model: "WH-CH720N", form: "over-ear", re: /wh-?ch720\s*n/i,
    specs: { anc: "Ibrida leggera", batt: "35 h", bt: "5.2", ip: null, weight: "192 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 2 },
    highlight: "Leggerissime (192 g) con ANC e 35 ore: ottime per l'ufficio",
    weak: "Materiali plasticosi e niente LDAC" },
  { brand: "Sony", model: "WH-CH520", form: "on-ear", re: /wh-?ch520/i,
    specs: { anc: false, batt: "50 h", bt: "5.2", ip: null, weight: "147 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 1 },
    highlight: "50 ore di autonomia e 147 g: compagne ideali tutti i giorni",
    weak: "Nessun ANC e padiglioni on-ear poco isolanti" },
  { brand: "Sony", model: "LinkBuds S", form: "tws", re: /linkbuds?\s*s\b/i,
    specs: { anc: "Ibrida", batt: "6 h (20 h con custodia)", bt: "5.2", ip: "IPX4", weight: "4,8 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 2 },
    highlight: "Piccolissimi e leggerissimi, con LDAC e ANC",
    weak: "Autonomia media e volume massimo non altissimo" },
  { brand: "Sony", model: "LinkBuds Open", form: "open", re: /linkbuds?\s*(?:open|fit)/i,
    specs: { anc: false, batt: "8 h (22 h con custodia)", bt: "5.3", ip: "IPX4", weight: "4,7 g", codecs: ["AAC"], multipoint: true, mics: 2 },
    highlight: "Design aperto che lascia passare l'ambiente, comodissimo",
    weak: "Zero isolamento acustico e bassi leggeri" },

  /* ── Bose ── */
  { brand: "Bose", model: "QuietComfort Ultra", form: "over-ear", re: /quietcomfort\s*ultra(?!\s*earbuds)/i,
    specs: { anc: "CustomTune adattiva", batt: "24 h", bt: "5.3", ip: null, weight: "250 g", codecs: ["aptX Adaptive", "AAC"], multipoint: true, mics: 8 },
    highlight: "ANC e audio spaziale immersivo, comfort da riferimento",
    weak: "Non si piega e costa parecchio fuori offerta" },
  { brand: "Bose", model: "QuietComfort Ultra Earbuds", form: "tws", re: /quietcomfort\s*ultra\s*earbuds/i,
    specs: { anc: "CustomTune adattiva", batt: "6 h (24 h con custodia)", bt: "5.3", ip: "IPX4", weight: "6,2 g", codecs: ["aptX Adaptive", "AAC"], multipoint: true, mics: 4 },
    highlight: "ANC ai massimi livelli in formato auricolare",
    weak: "Custodia ingombrante e autonomia non superiore alle concorrenti" },
  { brand: "Bose", model: "QuietComfort 45", form: "over-ear", re: /quietcomfort\s*(?:45|qc45|se)\b/i,
    specs: { anc: "Ibrida", batt: "24 h", bt: "5.1", ip: null, weight: "240 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 4 },
    highlight: "Comfort Bose e ANC efficace, spesso a prezzo aggressivo",
    weak: "Bluetooth 5.1, niente audio spaziale né app moderna" },
  { brand: "Bose", model: "QuietComfort Earbuds II", form: "tws", re: /quietcomfort\s*earbuds?\s*(?:ii|2)/i,
    specs: { anc: "CustomTune", batt: "6 h (24 h con custodia)", bt: "5.3", ip: "IPX4", weight: "6,2 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 4 },
    highlight: "Isolamento e calzata ottimi, suono Bose caldo",
    weak: "Niente multipoint e codec limitati ad AAC" },
  { brand: "Bose", model: "QuietComfort Headphones", form: "over-ear", re: /quietcomfort\s*headphones/i,
    specs: { anc: "Ibrida", batt: "24 h", bt: "5.3", ip: null, weight: "240 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 6 },
    highlight: "ANC affidabile e 24 ore reali di autonomia",
    weak: "Suono meno raffinato degli Ultra e custodia rigida" },

  /* ── Google ── */
  { brand: "Google", model: "Pixel Buds Pro 2", form: "tws", re: /pixel\s*buds?\s*pro\s*(?:2|seconda)/i,
    specs: { anc: "Ibrida Silent Seal 2.0", batt: "8 h (30 h con custodia)", bt: "5.4", ip: "IP54", weight: "4,7 g", codecs: ["LC3", "AAC"], multipoint: true, mics: 6 },
    highlight: "Gemini integrato, ANC ottima e 30 ore totali",
    weak: "Molte funzioni smart solo su smartphone Android recenti" },
  { brand: "Google", model: "Pixel Buds Pro", form: "tws", re: /pixel\s*buds?\s*pro(?!\s*(?:2|seconda))/i,
    specs: { anc: "Ibrida", batt: "7 h (31 h con custodia)", bt: "5.0", ip: "IPX4", weight: "6,2 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 3 },
    highlight: "ANC solida e integrazione totale con Android",
    weak: "Modello datato: Bluetooth 5.0 e nessun codec HD" },
  { brand: "Google", model: "Pixel Buds 2a", form: "tws", re: /pixel\s*buds?\s*2a/i,
    specs: { anc: "Ibrida", batt: "7 h (20 h con custodia)", bt: "5.4", ip: "IP54", weight: "4,7 g", codecs: ["AAC"], multipoint: true, mics: 4 },
    highlight: "Prezzo aggressivo con ANC e Google Translate in tempo reale",
    weak: "Niente ricarica wireless e codec solo AAC" },
  { brand: "Google", model: "Pixel Buds A-Series", form: "tws", re: /pixel\s*buds?\s*a[- ]?series/i,
    specs: { anc: false, batt: "5 h (24 h con custodia)", bt: "5.0", ip: "IPX4", weight: "5,1 g", codecs: ["AAC"], multipoint: false, mics: 2 },
    highlight: "Leggerissimi e con ottima integrazione Google",
    weak: "Senza ANC e con autonomia sotto la media" },

  /* ── Samsung ── */
  { brand: "Samsung", model: "Galaxy Buds 3 Pro", form: "tws", re: /galaxy\s*buds?\s*3\s*pro/i,
    specs: { anc: "Adattiva", batt: "6 h (26 h con custodia)", bt: "5.4", ip: "IP57", weight: "5,4 g", codecs: ["SSC UHQ", "AAC"], multipoint: true, mics: 3 },
    highlight: "Audio 24 bit e ANC eccellente, IP57",
    weak: "Il meglio solo con smartphone Galaxy: prezzo pieno alto" },
  { brand: "Samsung", model: "Galaxy Buds 3", form: "tws", re: /galaxy\s*buds?\s*3(?!\s*pro)/i,
    specs: { anc: "Adattiva leggera", batt: "6 h (30 h con custodia)", bt: "5.4", ip: "IP57", weight: "4,7 g", codecs: ["SSC UHQ", "AAC"], multipoint: true, mics: 3 },
    highlight: "Formato aperto comodo con ANC e ottima autonomia",
    weak: "Bassi contenuti e isolamento inferiore alla versione Pro" },
  { brand: "Samsung", model: "Galaxy Buds2 Pro", form: "tws", re: /galaxy\s*buds?\s*2\s*pro/i,
    specs: { anc: "Ibrida", batt: "5 h (18 h con custodia)", bt: "5.3", ip: "IPX7", weight: "5,5 g", codecs: ["SSC", "AAC"], multipoint: false, mics: 3 },
    highlight: "Suono 24 bit e vestibilità molto compatta",
    weak: "Autonomia modesta e niente multipoint" },
  { brand: "Samsung", model: "Galaxy Buds FE", form: "tws", re: /galaxy\s*buds?\s*fe/i,
    specs: { anc: "Ibrida", batt: "6 h (21 h con custodia)", bt: "5.2", ip: "IPX2", weight: "5,6 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 3 },
    highlight: "Il modo più economico per entrare nell'ecosistema Galaxy",
    weak: "Resistenza all'acqua minima (IPX2) e codec base" },

  /* ── Huawei ── */
  { brand: "Huawei", model: "FreeClip", form: "open", re: /freeclip(?!\s*2)/i,
    specs: { anc: false, batt: "8 h (36 h con custodia)", bt: "5.3", ip: "IP54", weight: "5,6 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 2 },
    highlight: "Design a clip che non entra nel condotto uditivo: comodità unica",
    weak: "Non isola nulla e i bassi sono leggeri: non per aereo o metro" },
  { brand: "Huawei", model: "FreeClip 2", form: "open", re: /freeclip\s*2/i,
    specs: { anc: false, batt: "9 h (47 h con custodia)", bt: "5.4", ip: "IP57", weight: "5,1 g", codecs: ["L2HC", "AAC"], multipoint: true, mics: 3 },
    highlight: "Open-ear con autonomia enorme e IP57",
    weak: "Prezzo alto e isolamento acustico praticamente assente" },
  { brand: "Huawei", model: "FreeBuds Pro 4", form: "tws", re: /freebuds?\s*pro\s*(?:4|3)/i,
    specs: { anc: "Ibrida, 50 dB", batt: "7 h (33 h con custodia)", bt: "5.2", ip: "IP54", weight: "5,8 g", codecs: ["LDAC", "L2HC"], multipoint: true, mics: 4 },
    highlight: "ANC molto profonda e LDAC: suono ricco",
    weak: "App e funzioni smart complete solo con smartphone Huawei" },
  { brand: "Huawei", model: "FreeBuds 6i", form: "tws", re: /freebuds?\s*6i/i,
    specs: { anc: "Ibrida, 27 dB", batt: "8 h (35 h con custodia)", bt: "5.3", ip: "IP54", weight: "5,4 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 3 },
    highlight: "Ottimo rapporto qualità/prezzo: ANC e 35 ore totali",
    weak: "Codec limitati e app meno rifinita delle concorrenti" },
  { brand: "Huawei", model: "FreeBuds SE 3", form: "tws", re: /freebuds?\s*se\s*3/i,
    specs: { anc: false, batt: "9 h (42 h con custodia)", bt: "5.4", ip: "IP54", weight: "3,8 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 2 },
    highlight: "42 ore con custodia e soli 3,8 g per auricolare",
    weak: "Niente ANC né multipoint: fascia base" },
  { brand: "Huawei", model: "FreeBuds SE 5 Max", form: "tws", re: /freebuds?\s*se\s*5\s*max/i,
    specs: { anc: "Ibrida multimodale, 52 dB", batt: "80 h con custodia", bt: "5.4", ip: "IP54", weight: "4,2 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 3 },
    highlight: "ANC multimodale a 52 dB e fino a 80 ore con custodia",
    weak: "Driver piccoli: bassi presenti ma non profondissimi" },
  { brand: "Huawei", model: "FreeBuds 7i", form: "tws", re: /freebuds?\s*7i/i,
    specs: { anc: "Ibrida, 45 dB", batt: "8 h (35 h con custodia)", bt: "5.4", ip: "IP54", weight: "4,9 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 3 },
    highlight: "LDAC e ANC 45 dB nella fascia media",
    weak: "App completa solo su Huawei e ricarica wireless assente" },
  { brand: "Huawei", model: "FreeBuds SE 2", form: "tws", re: /freebuds?\s*se\s*2/i,
    specs: { anc: false, batt: "6 h (40 h con custodia)", bt: "5.3", ip: "IP54", weight: "3,8 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 2 },
    highlight: "Leggerissimi e con ricarica rapida",
    weak: "Senza ANC e con microfono basilare in chiamata" },

  /* ── Anker / Soundcore ── */
  { brand: "Anker", model: "Soundcore Q30", form: "over-ear", re: /soundcore\s*(?:di\s*anker\s*)?q30/i,
    specs: { anc: "Ibrida", batt: "40 h (60 h senza ANC)", bt: "5.0", ip: null, weight: "260 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 2 },
    highlight: "40 ore con ANC a un prezzo quasi sempre sotto i 60 €",
    weak: "Bluetooth 5.0, plastica economica e nessun codec HD" },
  { brand: "Anker", model: "Soundcore Q45", form: "over-ear", re: /soundcore\s*(?:di\s*anker\s*)?q45/i,
    specs: { anc: "Ibrida, 98% rumore", batt: "50 h (65 h senza ANC)", bt: "5.3", ip: null, weight: "265 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 2 },
    highlight: "50 ore con ANC e LDAC: autonomia mostruosa",
    weak: "Comfort inferiore a Sony/Bose e app con qualche bug" },
  { brand: "Anker", model: "Soundcore Space One", form: "over-ear", re: /soundcore\s*(?:di\s*anker\s*)?space\s*one/i,
    specs: { anc: "Adattiva 2.0", batt: "40 h (55 h senza ANC)", bt: "5.3", ip: null, weight: "265 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 4 },
    highlight: "ANC adattiva e LDAC in una fascia media imbattibile",
    weak: "Custodia morbida e microfono non eccezionale all'aperto" },
  { brand: "Anker", model: "Soundcore P20i", form: "tws", re: /soundcore\s*(?:di\s*anker\s*)?p20i/i,
    specs: { anc: false, batt: "10 h (30 h con custodia)", bt: "5.3", ip: "IPX5", weight: "4,5 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 2 },
    highlight: "10 ore per carica e bassi BassUp: prezzo da quasi regalo",
    weak: "Niente ANC e microfono appena sufficiente" },
  { brand: "Anker", model: "Soundcore P31i", form: "tws", re: /soundcore\s*(?:di\s*anker\s*)?p31i/i,
    specs: { anc: "Ibrida adattiva", batt: "12 h (48 h con custodia)", bt: "5.4", ip: "IPX5", weight: "4,6 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 4 },
    highlight: "ANC e 48 ore totali sotto i 30 €: best buy della fascia",
    weak: "Fit che non calza a tutti e nessun codec HD" },
  { brand: "Anker", model: "Soundcore P41i", form: "tws", re: /soundcore\s*(?:di\s*anker\s*)?p41i/i,
    specs: { anc: "Ibrida adattiva", batt: "12 h (48 h con custodia)", bt: "5.4", ip: "IPX5", weight: "4,8 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 4 },
    highlight: "ANC adattiva, multipoint e display sulla custodia",
    weak: "Suono con bassi un po' gonfiati e codec base" },
  { brand: "Anker", model: "Soundcore C50i", form: "open", re: /soundcore\s*(?:di\s*anker\s*)?c50i/i,
    specs: { anc: false, batt: "8 h (32 h con custodia)", bt: "5.4", ip: "IPX5", weight: "5,2 g", codecs: ["AAC"], multipoint: false, mics: 2 },
    highlight: "Open-ear a clip con ottima stabilità per sport e ufficio",
    weak: "Nessun isolamento e volume massimo modesto" },
  { brand: "Anker", model: "Soundcore Liberty 4 NC", form: "tws", re: /liberty\s*4\s*nc/i,
    specs: { anc: "Adattiva, 98.5%", batt: "10 h (50 h con custodia)", bt: "5.3", ip: "IPX4", weight: "5,5 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 6 },
    highlight: "ANC fortissima e 50 ore totali con LDAC",
    weak: "Custodia ingombrante e app molto densa di opzioni" },
  { brand: "Anker", model: "Soundcore Sport X10", form: "sport", re: /soundcore\s*sport\s*x10/i,
    specs: { anc: false, batt: "8 h (32 h con custodia)", bt: "5.2", ip: "IPX7", weight: "5,9 g", codecs: ["AAC"], multipoint: false, mics: 2 },
    highlight: "Ganci rotanti e IPX7: non cadono nemmeno correndo",
    weak: "Senza ANC e con suono pensato per la palestra" },

  /* ── Nothing ── */
  { brand: "Nothing", model: "Nothing Headphone (1)", form: "over-ear", re: /nothing\s*headphone\s*\(?1\)?/i,
    specs: { anc: "Ibrida adattiva", batt: "80 h (35 h con ANC)", bt: "5.3", ip: "IP52", weight: "329 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 6 },
    highlight: "80 ore di autonomia e design trasparente inconfondibile",
    weak: "329 g si sentono dopo qualche ora e l'ANC non è al livello Sony" },
  { brand: "Nothing", model: "Nothing Ear (a)", form: "tws", re: /nothing\s*ear\s*\(?a\)?/i,
    specs: { anc: "Ibrida, 45 dB", batt: "9,5 h (42 h con custodia)", bt: "5.3", ip: "IP54", weight: "4,8 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 3 },
    highlight: "ANC 45 dB e LDAC a prezzo medio, con estetica unica",
    weak: "Custodia fragile e app con personalizzazione limitata" },
  { brand: "Nothing", model: "Nothing Ear", form: "tws", re: /nothing\s*ear(?!\s*\()(?!\s*a\b)/i,
    specs: { anc: "Ibrida, 45 dB", batt: "8,5 h (40,5 h con custodia)", bt: "5.3", ip: "IP54", weight: "4,7 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 3 },
    highlight: "Suono equilibrato e ANC profonda, ottimo con Android",
    weak: "Prezzo vicino a concorrenti più blasonati" },
  { brand: "Nothing", model: "CMF Buds Pro 2", form: "tws", re: /cmf\s*buds?\s*pro\s*2/i,
    specs: { anc: "Ibrida, 50 dB", batt: "11 h (43 h con custodia)", bt: "5.3", ip: "IP54", weight: "4,9 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 3 },
    highlight: "50 dB di ANC e rotella sulla custodia a prezzo basso",
    weak: "Materiali economici e microfono medio in chiamata" },

  /* ── JBL ── */
  { brand: "JBL", model: "Tune 520BT", form: "on-ear", re: /tune\s*520\s*bt/i,
    specs: { anc: false, batt: "57 h", bt: "5.3", ip: null, weight: "160 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 1 },
    highlight: "57 ore e 160 g: cuffia da battaglia per pochi euro",
    weak: "Nessun ANC e costruzione interamente in plastica" },
  { brand: "JBL", model: "Tune 720BT", form: "over-ear", re: /tune\s*720\s*bt/i,
    specs: { anc: false, batt: "76 h", bt: "5.3", ip: null, weight: "220 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 1 },
    highlight: "76 ore reali di autonomia: si carica una volta al mese",
    weak: "Senza ANC e con suono molto orientato ai bassi" },
  { brand: "JBL", model: "Live 770NC", form: "over-ear", re: /live\s*770\s*nc/i,
    specs: { anc: "Adattiva", batt: "30 h (70 h senza ANC)", bt: "5.3", ip: null, weight: "232 g", codecs: ["AAC", "SBC"], multipoint: true, mics: 4 },
    highlight: "70 ore senza ANC e audio spaziale JBL",
    weak: "ANC discreta ma non ai livelli Sony/Bose" },
  { brand: "JBL", model: "Tour Pro 3", form: "tws", re: /tour\s*pro\s*3/i,
    specs: { anc: "Ibrida", batt: "7 h (32 h con custodia)", bt: "5.3", ip: "IPX4", weight: "5,5 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 6 },
    highlight: "Custodia con schermo touch e LDAC",
    weak: "Prezzo alto e custodia davvero voluminosa" },

  /* ── Sennheiser / Bowers & Wilkins / Marshall / Beats ── */
  { brand: "Sennheiser", model: "Momentum 4", form: "over-ear", re: /momentum\s*4/i,
    specs: { anc: "Adattiva", batt: "60 h", bt: "5.2", ip: null, weight: "293 g", codecs: ["aptX Adaptive", "AAC"], multipoint: true, mics: 6 },
    highlight: "60 ore e suono Sennheiser: la cuffia per chi ascolta musica",
    weak: "293 g e ANC un gradino sotto Sony" },
  { brand: "Sennheiser", model: "Accentum Plus", form: "over-ear", re: /accentum\s*plus/i,
    specs: { anc: "Ibrida", batt: "50 h", bt: "5.2", ip: null, weight: "227 g", codecs: ["aptX Adaptive", "AAC"], multipoint: true, mics: 4 },
    highlight: "50 ore, aptX Adaptive e custodia rigida inclusa",
    weak: "ANC buona ma non eccelsa in ambienti rumorosi" },
  { brand: "Bowers & Wilkins", model: "Px7 S2e", form: "over-ear", re: /px\s*7\s*s2e?/i,
    specs: { anc: "Ibrida", batt: "30 h", bt: "5.2", ip: null, weight: "307 g", codecs: ["aptX Adaptive", "AAC"], multipoint: true, mics: 6 },
    highlight: "Resa audio da audiofilo con DSP a 24 bit",
    weak: "307 g, comfort inferiore e ANC non al top" },
  { brand: "Bowers & Wilkins", model: "Px8", form: "over-ear", re: /px\s*8\b/i,
    specs: { anc: "Ibrida", batt: "30 h", bt: "5.2", ip: null, weight: "320 g", codecs: ["aptX Adaptive", "AAC"], multipoint: true, mics: 6 },
    highlight: "Driver in carbonio e finiture premium: suono di classe superiore",
    weak: "Prezzo da fascia alta e peso importante" },
  { brand: "Bowers & Wilkins", model: "Pi8", form: "tws", re: /pi\s*8\b/i,
    specs: { anc: "Ibrida", batt: "6,5 h (20 h con custodia)", bt: "5.4", ip: "IP54", weight: "7 g", codecs: ["aptX Lossless", "AAC"], multipoint: true, mics: 3 },
    highlight: "aptX Lossless in un auricolare: audio senza compromessi",
    weak: "Autonomia media e prezzo molto alto" },
  { brand: "Marshall", model: "Major V", form: "on-ear", re: /major\s*v\b/i,
    specs: { anc: false, batt: "100 h", bt: "5.3", ip: null, weight: "186 g", codecs: ["SBC", "AAC"], multipoint: true, mics: 1 },
    highlight: "100 ore di autonomia e look Marshall inconfondibile",
    weak: "Nessun ANC e padiglioni on-ear che stringono un po'" },
  { brand: "Marshall", model: "Minor IV", form: "tws", re: /minor\s*iv/i,
    specs: { anc: false, batt: "7 h (30 h con custodia)", bt: "5.3", ip: "IPX4", weight: "4,5 g", codecs: ["AAC", "SBC"], multipoint: false, mics: 2 },
    highlight: "Estetica Marshall e buona autonomia totale",
    weak: "Senza ANC e con microfono nella media" },
  { brand: "Beats", model: "Studio Pro", form: "over-ear", re: /\bbeats\s*studio\s*pro|studio\s*pro\s*wireless/i,
    specs: { anc: "Ibrida", batt: "40 h", bt: "5.3", ip: null, weight: "260 g", codecs: ["AAC"], multipoint: false, mics: 6 },
    highlight: "40 ore e integrazione Apple/Android completa",
    weak: "Solo AAC e isolamento inferiore ai concorrenti" },
  { brand: "Beats", model: "Solo 4", form: "on-ear", re: /solo\s*4\b/i,
    specs: { anc: false, batt: "50 h", bt: "5.3", ip: null, weight: "178 g", codecs: ["AAC"], multipoint: false, mics: 1 },
    highlight: "50 ore e 178 g, perfetta con iPhone",
    weak: "On-ear senza ANC: poco isolante in città" },
  { brand: "Beats", model: "Fit Pro", form: "sport", re: /fit\s*pro/i,
    specs: { anc: "Ibrida", batt: "6 h (24 h con custodia)", bt: "5.0", ip: "IPX4", weight: "5,6 g", codecs: ["AAC"], multipoint: false, mics: 2 },
    highlight: "Alette di ancoraggio: non si muovono in palestra",
    weak: "Bluetooth 5.0 e niente multipoint" },

  /* ── Jabra / Shokz ── */
  { brand: "Jabra", model: "Elite 8 Active", form: "sport", re: /elite\s*8\s*active/i,
    specs: { anc: "Ibrida", batt: "8 h (32 h con custodia)", bt: "5.3", ip: "IP68", weight: "5,2 g", codecs: ["AAC"], multipoint: true, mics: 6 },
    highlight: "IP68: sopravvive a sudore, pioggia e cadute",
    weak: "Suono meno musicale delle rivali e app in dismissione" },
  { brand: "Jabra", model: "Elite 10", form: "tws", re: /elite\s*10\b/i,
    specs: { anc: "Ibrida", batt: "6 h (36 h con custodia)", bt: "5.3", ip: "IP57", weight: "5 g", codecs: ["AAC"], multipoint: true, mics: 6 },
    highlight: "Microfoni ottimi in chiamata e fit senza gommini",
    weak: "Autonomia singola modesta e codec limitati" },
  { brand: "Shokz", model: "OpenRun Pro 2", form: "open", re: /openrun\s*pro\s*2/i,
    specs: { anc: false, batt: "12 h", bt: "5.3", ip: "IP55", weight: "30 g", codecs: ["SBC"], multipoint: true, mics: 2 },
    highlight: "Conduzione ossea: senti la musica e l'ambiente insieme",
    weak: "Bassi quasi assenti e nessun isolamento" },
  { brand: "Shokz", model: "OpenFit", form: "open", re: /openfit/i,
    specs: { anc: false, batt: "7 h (28 h con custodia)", bt: "5.2", ip: "IP54", weight: "8,3 g", codecs: ["AAC"], multipoint: false, mics: 2 },
    highlight: "Comodissimi tutto il giorno, ideali in ufficio",
    weak: "Prezzo alto per un open-ear senza ANC" },

  /* ── Baseus / Ugreen / JLab / QCY / Xiaomi / Realme / OnePlus ── */
  { brand: "Baseus", model: "MC1 Pro", form: "open", re: /mc\s*1\s*pro/i,
    specs: { anc: false, batt: "8 h (35 h con custodia)", bt: "5.4", ip: "IPX5", weight: "5,5 g", codecs: ["AAC"], multipoint: true, mics: 4 },
    highlight: "Open-ear a clip con Bluetooth 5.4 a prezzo contenuto",
    weak: "Bassi leggeri e nessuna cancellazione del rumore" },
  { brand: "JLab", model: "JBuds ANC 3", form: "tws", re: /jbuds?\s*anc\s*3/i,
    specs: { anc: "Ibrida", batt: "9 h (42 h con custodia)", bt: "5.2", ip: "IP55", weight: "4,5 g", codecs: ["AAC"], multipoint: true, mics: 2 },
    highlight: "42 ore con ANC e app con equalizzatore completo",
    weak: "Suono con bassi poco controllati e custodia economica" },
  { brand: "JLab", model: "Epic Pods ANC", form: "tws", re: /epic\s*pods?\s*anc/i,
    specs: { anc: "Ibrida", batt: "9 h (38 h con custodia)", bt: "5.2", ip: "IPX4", weight: "5,5 g", codecs: ["AAC"], multipoint: true, mics: 2 },
    highlight: "ANC efficace e autonomia generosa sotto i 80 €",
    weak: "Fit che richiede gommini giusti e app essenziale" },
  { brand: "Edifier", model: "NeoBuds Planar", form: "tws", re: /neobuds?\s*planar/i,
    specs: { anc: "Ibrida", batt: "6 h (18 h con custodia)", bt: "5.4", ip: "IP55", weight: "5,8 g", codecs: ["LDAC", "Hi-Res", "Snapdragon Sound"], multipoint: true, mics: 6 },
    highlight: "Driver planari magnetici e LDAC: suono da fascia alta",
    weak: "Autonomia corta e custodia voluminosa" },
  { brand: "Edifier", model: "W800BT Pro", form: "over-ear", re: /w800\s*bt\s*pro/i,
    specs: { anc: "Ibrida", batt: "55 h", bt: "5.4", ip: null, weight: "215 g", codecs: ["Hi-Res", "AAC"], multipoint: true, mics: 2 },
    highlight: "55 ore e Hi-Res in una cuffia da meno di 50 €",
    weak: "Materiali economici e microfono appena sufficiente" },
  { brand: "Edifier", model: "W820NB Plus Gen 2", form: "over-ear", re: /w820\s*nb/i,
    specs: { anc: "Ibrida, 49 dB", batt: "45 h", bt: "5.4", ip: null, weight: "240 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 2 },
    highlight: "ANC 49 dB dichiarata e 45 ore a prezzo aggressivo",
    weak: "Comfort rigido sulle prime ore e app basilare" },
  { brand: "Ugreen", model: "FitBuds", form: "open", re: /fitbuds/i,
    specs: { anc: false, batt: "28 h con custodia", bt: "5.3", ip: "IPX5", weight: "5 g", codecs: ["AAC"], multipoint: true, mics: 2 },
    highlight: "Open-ear leggerissime con 28 ore totali, ottime in ufficio",
    weak: "Nessun isolamento e bassi leggeri" },
  { brand: "Ugreen", model: "Studio Pro", form: "over-ear", re: /ugreen\s*studio\s*pro|studio\s*pro\s*cuffie/i,
    specs: { anc: "Ibrida, 48 dB", batt: "75 h", bt: "5.4", ip: false, weight: "250 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 4 },
    highlight: "ANC 48 dB e 75 ore a prezzo da fascia bassa",
    weak: "Materiali plastici e app poco curata" },
  { brand: "QCY", model: "MeloBuds Pro", form: "tws", re: /melobuds?\s*pro/i,
    specs: { anc: "Ibrida, 46 dB", batt: "8 h (32 h con custodia)", bt: "5.3", ip: "IPX5", weight: "4,3 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 4 },
    highlight: "LDAC e ANC 46 dB a prezzi da supermercato",
    weak: "Controlli touch poco precisi e microfono medio" },
  { brand: "Xiaomi", model: "Redmi Buds 6 Pro", form: "tws", re: /redmi\s*buds?\s*6\s*pro/i,
    specs: { anc: "Ibrida, 55 dB", batt: "9,5 h (36 h con custodia)", bt: "5.3", ip: "IP54", weight: "4,8 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 3 },
    highlight: "ANC 55 dB e LDAC: specifiche da fascia alta a prezzo basso",
    weak: "App Xiaomi pubblicitaria e fit non per tutte le orecchie" },
  { brand: "Xiaomi", model: "Redmi Buds 6", form: "tws", re: /redmi\s*buds?\s*6(?!\s*pro)/i,
    specs: { anc: "Ibrida, 49 dB", batt: "10 h (42 h con custodia)", bt: "5.3", ip: "IP54", weight: "4,5 g", codecs: ["AAC"], multipoint: true, mics: 2 },
    highlight: "42 ore totali con ANC a prezzo d'attacco",
    weak: "Solo AAC e controlli touch basici" },
  { brand: "Realme", model: "Buds Air 7 Pro", form: "tws", re: /buds\s*air\s*7\s*pro/i,
    specs: { anc: "Ibrida, 55 dB", batt: "9 h (40 h con custodia)", bt: "5.3", ip: "IP55", weight: "4,5 g", codecs: ["LDAC", "AAC"], multipoint: true, mics: 3 },
    highlight: "ANC profonda e 40 ore: concorrenza interna agguerrita",
    weak: "Distribuzione in Italia limitata e app acerba" },
  { brand: "OnePlus", model: "Buds Pro 3", form: "tws", re: /buds\s*pro\s*3/i,
    specs: { anc: "Ibrida, 50 dB", batt: "10 h (43 h con custodia)", bt: "5.4", ip: "IP55", weight: "4,7 g", codecs: ["LHDC", "AAC"], multipoint: true, mics: 3 },
    highlight: "ANC 50 dB, 43 ore e ricarica rapidissima",
    weak: "Funzioni avanzate solo su OnePlus/OPPO" },

  /* ── Gaming ── */
  { brand: "Logitech", model: "G325 LIGHTSPEED", form: "gaming", re: /g325\s*lightspeed/i,
    specs: { anc: false, batt: "24 h", bt: "LIGHTSPEED 2.4 GHz + BT", ip: null, weight: "250 g", codecs: ["SBC"], multipoint: true, mics: 1 },
    highlight: "Doppia connessione LIGHTSPEED + Bluetooth, 24 ore",
    weak: "Nessun ANC e padiglioni poco traspiranti" },
  { brand: "Logitech", model: "G435", form: "gaming", re: /g\s*435/i,
    specs: { anc: false, batt: "18 h", bt: "LIGHTSPEED + BT", ip: null, weight: "165 g", codecs: ["SBC"], multipoint: true, mics: 2 },
    highlight: "165 g: non si sente nemmeno dopo una sessione lunga",
    weak: "Microfono integrato e nessun isolamento" },
  { brand: "HyperX", model: "Cloud III", form: "gaming", re: /cloud\s*iii/i,
    specs: { anc: false, batt: "120 h", bt: "2.4 GHz + BT", ip: null, weight: "320 g", codecs: ["SBC"], multipoint: true, mics: 1 },
    highlight: "120 ore e microfono con cancellazione del rumore",
    weak: "320 g si fanno sentire e i bassi sono molto presenti" },
  { brand: "SteelSeries", model: "Arctis Nova 7", form: "gaming", re: /arctis\s*nova\s*7/i,
    specs: { anc: "Ibrida passiva", batt: "38 h", bt: "2.4 GHz + BT", ip: null, weight: "325 g", codecs: ["SBC"], multipoint: true, mics: 1 },
    highlight: "Audio simultaneo 2.4 GHz + Bluetooth (game + telefono)",
    weak: "Prezzo alto e peso importante" },
  { brand: "Turtle Beach", model: "Atlas Air", form: "gaming", re: /atlas\s*air/i,
    specs: { anc: false, batt: "80 h", bt: "2.4 GHz + BT", ip: null, weight: "301 g", codecs: ["SBC"], multipoint: true, mics: 1 },
    highlight: "80 ore e doppia connessione per console e PC",
    weak: "Comfort migliorabile e software desktop basilare" },
  { brand: "Trust", model: "GXTrust Rayne", form: "gaming", re: /gxtrust\s*rayne|rayne/i,
    specs: { anc: false, batt: null, bt: false, ip: false, weight: "230 g", codecs: ["SBC"], multipoint: false, mics: 1 },
    highlight: "Cuffia gaming USB con LED sotto i 15 €",
    weak: "Solo USB cablato, nessun Bluetooth e audio basico" },
  { brand: "Irradio", model: "IR-H606BT Pro", form: "over-ear", re: /ir[- ]?h606\s*bt\s*pro/i,
    specs: { anc: "Ibrida (ANC)", batt: "12 h", bt: "5.0", ip: null, weight: "185 g", codecs: ["SBC"], multipoint: false, mics: 1 },
    highlight: "ANC ibrida a un prezzo da cuffia basic",
    weak: "Costruzione economica e autonomia ridotta" },
  { brand: "Irradio", model: "IR-H606BT", form: "over-ear", re: /ir[- ]?h606\s*bt(?!\s*pro)/i,
    specs: { anc: false, batt: "10 h", bt: "5.0", ip: null, weight: "180 g", codecs: ["SBC"], multipoint: false, mics: 1 },
    highlight: "Prezzo da pochi euro per una cuffia Bluetooth base",
    weak: "Costruzione molto economica e autonomia ridotta" },
];

/* ─────────────── riconoscimento modello ─────────────── */

/** tutti i nomi modello in forma normalizzata, per la ricerca nel testo */
const MODEL_HAY = MODELS.map((m) => ({
  entry: m,
  re: m.re,
  slugKey: slug(m.model),
}));

/**
 * Cerca il modello nell'anagrafica.
 * Vince il match più lungo (evita "Pixel Buds Pro" quando c'è "Pixel Buds Pro 2").
 * @returns {{entry:object, matched:string}|null}
 */
export function matchModel(text = "") {
  const hay = String(text || "");
  if (!hay) return null;
  let best = null;
  for (const m of MODEL_HAY) {
    const re = new RegExp(m.re.source, m.re.flags.replace("g", ""));
    const found = re.exec(hay);
    if (!found) continue;
    const len = found[0].length;
    if (!best || len > best.len) best = { entry: m.entry, matched: found[0], len };
  }
  return best ? { entry: best.entry, matched: best.matched } : null;
}

/* ─────────────── chiave di dedupe ─────────────── */

const STOPWORDS = new Set([
  "cuffie", "cuffia", "cuffiette", "auricolari", "auricolare", "auricolari", "earbuds", "earbud",
  "earphones", "headphones", "headphone", "headset", "wireless", "bluetooth", "true", "tws",
  "in", "ear", "on", "over", "open", "earclip", "clip", "with", "con", "per", "e", "di", "da",
  "the", "and", "dig", "senza", "con", "serie", "edition", "version", "italia", "amazon",
  "offerte", "offerta", "sconto", "promo", "prezzo", "migliori", "tech", "nuovo", "nuova",
  "nero", "nera", "nere", "neri", "bianco", "bianca", "bianche", "blu", "rosso", "rossa",
  "verde", "grigio", "grigia", "crema", "marrone", "oro", "oro", "argento", "rosa", "viola",
  "midnight", "ocean", "black", "white", "blue", "grey", "green", "space", "color", "colore",
  "anc", "enc", "hi", "res", "hires", "ldac", "aptx", "aac", "sbc", "multipoint", "ipx4",
  "ipx5", "ipx7", "ip54", "ip55", "ip57", "db", "ms", "hz", "khz", "mah", "usb", "type",
]);

/**
 * Chiave canonica di un prodotto: "marchio:modello-normalizzato".
 * Se il modello non è in anagrafica prova a ricavarlo dal titolo,
 * scartando le parole di marketing; se resta troppo poco, usa il
 * titolo normalizzato intero (meglio non unire che unire male).
 * @param {{title?:string, text?:string, brand?:string|null}} deal
 */
export function deriveModelKey({ title = "", text = "", brand = null } = {}) {
  const hay = `${title}\n${String(text).slice(0, 400)}`;
  const hit = matchModel(title) || matchModel(hay);
  if (hit) {
    return {
      modelKey: `${slug(hit.entry.brand)}:${slug(hit.entry.model)}`,
      model: hit.entry.model,
      brand: hit.entry.brand,
      curated: hit.entry,
    };
  }

  const core = stripAccents(title)
    .replace(/[,|/–—]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+([.,]\d+)?\s*(e|eur|euro|€|%|db|h|ore|g|gr|grammi|mm|cm|pollici|")\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");

  const tokens = core
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t) && (t.length >= 2 || /\d/.test(t)));

  // il marchio non deve finire dentro la chiave del modello
  const brandTokens = new Set(slug(brand || "").match(/[a-z]+|\d+/g) || []);
  const modelTokens = tokens.filter((t) => !brandTokens.has(t) && !(brand && slug(brand).includes(t) && t.length > 2));

  const picked = modelTokens.slice(0, 4);
  const hasDigit = picked.some((t) => /\d/.test(t));
  if (picked.length >= 2 && (hasDigit || picked.length >= 3)) {
    return {
      modelKey: `${slug(brand || "sconosciuto")}:${picked.join("")}`,
      model: picked.join(" ").toUpperCase().slice(0, 40),
      brand: brand || null,
      curated: null,
    };
  }
  // ripiego: titolo intero normalizzato (non unisce prodotti diversi)
  const full = slug(title).slice(0, 60);
  return {
    modelKey: `${slug(brand || "sconosciuto")}:t${full}`,
    model: null,
    brand: brand || null,
    curated: null,
  };
}

/* ─────────────── specifiche dal testo del post ─────────────── */

const CODE_CANON = {
  ldac: "LDAC",
  "aptx adaptive": "aptX Adaptive",
  "aptx lossless": "aptX Lossless",
  aptx: "aptX",
  lhdc: "LHDC",
  aac: "AAC",
  "hi-res": "Hi-Res",
  hires: "Hi-Res",
  "snapdragon sound": "Snapdragon Sound",
  lc3: "LC3",
  sbc: "SBC",
};

/** "ANC multimodale a 52 dB, 80 ore, IP54, LDAC" → oggetto specifiche */
export function specsFromText(text = "") {
  const t = String(text || "");
  const out = { anc: null, ancDb: null, batt: null, bt: null, ip: null, weight: null, codecs: [], multipoint: false, mics: null, notes: [] };

  const ancHit = /(?:cancellazione\s+(?:attiva\s+)?(?:del\s+|della\s+)?rumore|noise\s*cancell\w*|\bANC\b)/i.exec(t);
  if (ancHit) out.anc = "Ibrida";

  const db = /(\d{2})\s*dB\b/i.exec(t);
  if (db) {
    const n = Number(db[1]);
    if (n >= 20 && n <= 60) {
      out.ancDb = n;
      if (!out.anc) out.anc = "Ibrida";
    }
  }

  const hours = [...t.matchAll(/(\d{1,3})\s*(?:h|ore)\b/gi)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 200);
  if (hours.length) out.batt = Math.max(...hours);

  const bt = /bluetooth\s*(\d(?:[.,]\d)?)/i.exec(t);
  if (bt) out.bt = bt[1].replace(",", ".");

  const ip = /\b(IP(?:[Xx])?[0-9]{1,2})\b/i.exec(t);
  if (ip) out.ip = ip[1].toUpperCase();

  const weight = /(\d{2,3})\s*(?:g|gr|grammi)\b/i.exec(t);
  if (weight) {
    const n = Number(weight[1]);
    if (n >= 3 && n <= 500) out.weight = `${n} g`;
  }

  if (/multipoint|multi[- ]?point|doppia\s+connessione|due\s+dispositivi|2\s+dispositivi/i.test(t)) out.multipoint = true;

  for (const [k, label] of Object.entries(CODE_CANON)) {
    if (new RegExp(k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\s+/g, "\\s*"), "i").test(t)) out.codecs.push(label);
  }
  out.codecs = [...new Set(out.codecs)].filter((c, i, arr) => !(c === "AAC" && arr.includes("LDAC") && i > arr.indexOf("LDAC")));

  const mics = /(\d)\s*(?:hd\s+)?(?:microfoni|microfono|mics?|mic\b)/i.exec(t);
  if (mics) {
    const n = Number(mics[1]);
    if (n >= 1 && n <= 12) out.mics = n;
  }

  if (/ricarica\s+rapida|fast\s*charg/i.test(t)) out.notes.push("Ricarica rapida");
  if (/ipx?[4-8]/i.test(t)) out.notes.push("Resistente a sudore e pioggia");
  if (/audio\s+spaziale|spatial\s+audio/i.test(t)) out.notes.push("Audio spaziale");

  return out;
}

/** fonde specifiche curate e specifiche lette nel post (il post vince) */
export function mergeSpecs(curated, fromPost) {
  const out = { ...(curated || {}) };
  const p = fromPost || {};
  if (p.ancDb) out.anc = `Ibrida, ${p.ancDb} dB`;
  else if (!out.anc && p.anc) out.anc = p.anc;
  if (p.batt) {
    // il testo spesso indica le ore con custodia: tengo la cifra più alta
    out.batt = out.batt ? `${out.batt}` : `${p.batt} h`;
  }
  if (p.bt && !out.bt) out.bt = p.bt;
  if (p.ip && !out.ip) out.ip = p.ip;
  if (p.weight && !out.weight) out.weight = p.weight;
  if (p.multipoint) out.multipoint = true;
  if (p.mics && !out.mics) out.mics = p.mics;
  if (p.codecs?.length) {
    const set = new Set([...(out.codecs || []), ...p.codecs]);
    out.codecs = [...set];
  }
  return out;
}

/* ─────────────── pro / contro ─────────────── */

const fmtCodecs = (codecs = []) => {
  const hd = codecs.filter((c) => /LDAC|aptX|LHDC|L2HC|Hi-Res|Lossless/.test(c));
  return hd.length ? hd : codecs;
};

/** ore numeriche da stringhe tipo "8 h (30 h con custodia)" */
function battHours(batt) {
  if (!batt) return 0;
  const nums = [...String(batt).matchAll(/(\d{1,3})\s*h/gi)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

/**
 * Costruisce la scheda dettaglio di una card.
 * @param {object} deal offerta (con specs, hasAnc, category, model, brand)
 * @returns {{pros:string[], cons:string[], specs:Array, partial:boolean, known:boolean}}
 */
export function buildProfile(deal = {}) {
  const hit = matchModel(`${deal.model || ""} ${deal.title || ""}`) || matchModel(deal.title || "");
  const curated = hit?.entry || null;
  const postSpecs = deal.postSpecs || null;
  const specs = deal.specs || mergeSpecs(curated?.specs, postSpecs);
  const form = curated?.form || (deal.category === "tws" ? "tws" : deal.category === "open" ? "open" : deal.category === "sport" ? "sport" : deal.category === "gaming" ? "gaming" : "over-ear");

  const pros = [];
  const cons = [];
  const hours = battHours(specs.batt);
  // se la scheda curata cita già un aspetto, non lo ripeto in modo generico
  const says = (re) => re.test(curated?.highlight || "");
  const saysWeak = (re) => re.test(curated?.weak || "");
  const codecs = fmtCodecs(specs.codecs);
  const grams = specs.weight ? Number(String(specs.weight).replace(/\D/g, "")) : 0;
  const hasAnc = Boolean(specs.anc);

  /* ── pro ── */
  if (curated?.highlight) pros.push(curated.highlight);
  if (hasAnc && !says(/ANC|cancellazione|rumore/i)) {
    const depth = /(\d{2})\s*dB/.exec(String(specs.anc));
    pros.push(depth
      ? `Cancellazione attiva dichiarata fino a ${depth[1]} dB: efficace in treno e in ufficio`
      : "Cancellazione attiva del rumore: si viaggia molto più silenziosi");
  }
  const autonomyMentioned = says(/\d+\s*(?:h|ore)|autonomia/i);
  if (hours >= 30 && !autonomyMentioned) pros.push(`Autonomia molto alta (${specs.batt}): si carica raramente`);
  else if (hours >= 8 && !autonomyMentioned) pros.push(`Buona autonomia (${specs.batt}) per l'uso quotidiano`);
  if (specs.multipoint && !says(/multipoint|doppia connessione/i)) pros.push("Multipoint: collegati insieme PC e smartphone");
  if (codecs.some((c) => /LDAC|aptX|LHDC|L2HC|Hi-Res|Lossless/.test(c)) && !says(/LDAC|aptX|LHDC|L2HC|Hi-Res/i)) {
    pros.push(`Codec audio HD (${codecs.join(", ")}): più dettaglio in streaming`);
  }
  if (specs.ip && /IP[X]?[4-8]/.test(specs.ip) && !says(new RegExp(specs.ip, "i"))) pros.push(`Resistenza ${specs.ip}: regge sudore e pioggia`);
  if (grams && grams <= 180 && form !== "tws") pros.push(`Leggerissime (${specs.weight}) anche dopo ore`);
  if (specs.bt && Number(specs.bt) >= 5.3) pros.push(`Bluetooth ${specs.bt}: connessione stabile e consumi bassi`);
  pros.push(...FORM_PRO[form]);

  /* ── contro ── */
  if (curated?.weak) cons.push(curated.weak);
  if (!hasAnc && !saysWeak(/senza ANC|nessun ANC|niente ANC|non isola|isolamento/i)) {
    cons.push("Nessuna cancellazione attiva del rumore: isola meno in ambienti affollati");
  }
  if (!hours) cons.push("Autonomia non dichiarata nel post: da verificare sulla scheda dello store");
  else if (hours < 6) cons.push(`Autonomia contenuta (${specs.batt}): serve la custodia durante il giorno`);
  if (specs.multipoint === false && !saysWeak(/multipoint/i)) cons.push("Niente multipoint: un dispositivo alla volta");
  if (!specs.ip || specs.ip === false) cons.push("Resistenza all'acqua non dichiarata: meglio non usarla sotto la pioggia");
  if (grams >= 280) cons.push(`Peso importante (${specs.weight}): fastidio nelle sessioni lunghe`);
  if (hasAnc && !/(\d{2})\s*dB/.test(String(specs.anc))) cons.push("Profondità dell'ANC non dichiarata in dB: difficile confrontarla con le rivali");
  if (codecs.length && !codecs.some((c) => /LDAC|aptX|LHDC|L2HC|Hi-Res|Lossless/.test(c))) cons.push(`Codec senza audio HD (${codecs.join(", ")}): niente streaming lossless`);
  cons.push(...FORM_CONS[form]);

  // "parziale" se l'anagrafica non conosce il modello OPPURE il post non
  // aggiunge nessuna specifica utile (spesso i canali mettono solo il prezzo)
  const postHasSpecs = Boolean(
    postSpecs && (postSpecs.anc || postSpecs.batt || postSpecs.ip || postSpecs.weight || postSpecs.multipoint || postSpecs.codecs?.length || postSpecs.mics),
  );
  const partial = !curated || !postHasSpecs;
  return {
    pros: dedupeStrings(pros).slice(0, 2),
    cons: dedupeStrings(cons).slice(0, 2),
    specs: specList(specs, curated, postSpecs),
    partial,
    known: Boolean(curated),
    modelLabel: curated ? `${curated.brand} ${curated.model}` : deal.model || null,
  };
}

const dedupeStrings = (arr = []) => [...new Set(arr.filter(Boolean))];

/** pro/contro sempre validi per forma del prodotto (garantiscono 2+2) */
const FORM_PRO = {
  tws: ["Formato compatto: sta in tasca e si porta ovunque"],
  "over-ear": ["Padiglioni avvolgenti: comfort e isolamento migliori degli in-ear"],
  "on-ear": ["Più leggere e meno ingombranti delle over-ear"],
  open: ["Lascia passare l'ambiente: sicura in bici e per strada"],
  sport: ["Vestibilità stabile: pensata per allenamento e corsa"],
  gaming: ["Microfono e latenza pensati per giocare"],
};

const FORM_CONS = {
  tws: ["Essendo in-ear, l'isolamento dipende dai gommini scelti"],
  "over-ear": ["Ingombra nello zaino: la custodia non è tascabile"],
  "on-ear": ["I padiglioni on-ear stringono dopo un paio d'ore"],
  open: ["Chi ti sta accanto sente quello che ascolti"],
  sport: ["Suono tarato sull'allenamento: meno rifinito per l'ascolto critico"],
  gaming: ["Pensata per il gaming: resa musicale sotto le cuffie dedicate"],
};

/** righe della tabella specifiche: [etichetta, valore, fonte] */
export function specList(specs = {}, curated = null, postSpecs = null) {
  const rows = [];
  const push = (label, value, fromPost) => {
    if (!value) return;
    rows.push({ label, value: String(value), source: fromPost ? "post" : "db" });
  };
  const c = curated?.specs || {};
  push("Tipologia", curated ? labelForm(curated.form) : null, false);
  push("Cancellazione rumore", specs.anc, !c.anc && Boolean(postSpecs?.anc));
  push("Autonomia", specs.batt, !c.batt && Boolean(postSpecs?.batt));
  if (specs.bt === false) push("Connessione", "Solo USB cablato (nessun Bluetooth)", false);
  else push("Bluetooth", specs.bt, !c.bt && Boolean(postSpecs?.bt));
  if (specs.codecs?.length) push("Codec", specs.codecs.join(" · "), false);
  push("Multipoint", specs.multipoint ? "Sì" : specs.multipoint === false ? "No" : null, false);
  push("Resistenza", specs.ip, !c.ip && Boolean(postSpecs?.ip));
  push("Peso", specs.weight, !c.weight && Boolean(postSpecs?.weight));
  push("Microfoni", specs.mics ? `${specs.mics} mic` : null, false);
  if (postSpecs?.notes?.length) push("Note dal post", postSpecs.notes.join(" · "), true);
  return rows;
}

export function labelForm(form) {
  return {
    tws: "True wireless (in-ear)",
    "over-ear": "Over-ear",
    "on-ear": "On-ear",
    open: "Open-ear / clip",
    sport: "Sport",
    gaming: "Gaming",
  }[form] || "Cuffie";
}
