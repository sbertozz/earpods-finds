# Auricolari Radar 🎧

Web app statica (GitHub Pages) che raccoglie **solo offerte di auricolari e cuffie Bluetooth**
pescate dall'anteprima pubblica dei canali Telegram tech italiani.

## Cosa è cambiato: il catalogo adesso si aggiorna da solo

Prima il sito leggeva `data.json` e **niente lo rigenerava**: il workflow citato
nell'interfaccia (`.github/workflows/pages.yml`) non esisteva, quindi le offerte restavano
ferme per sempre. Ora ci sono **due livelli di aggiornamento**:

### 1. Aggiornamento nel browser, a ogni visita (zero configurazione)

**Primo paint immediato.** Lo snapshot completo del catalogo (offerte + canali + data) è salvato
in **IndexedDB** (`ar_db`): alla riapertura la pagina è piena prima ancora che parta una richiesta
di rete. `data.json` viene poi riletto in background, senza bloccare niente.

**Proxy in gara, non in fila.** `t.me` non manda gli header CORS, quindi il browser deve passare
da un proxy pubblico. Prima i proxy venivano provati uno dopo l'altro con timeout da 14 s: se i
primi tre erano lenti, la pagina restava ferma. Ora su ogni canale partono **5 proxy in
parallelo** con timeout di **4,5 s**: vince il primo che risponde con markup valido, gli altri
vengono abortiti. Un canale "morto" costa 4,5 s, non 70.

**Scansione a rotazione, non 9 richieste insieme.** Il refresh gira ogni **30 s** e controlla
**2–3 canali per volta**: in circa 90 secondi tutti i canali sono stati ripassati, senza mai
martellare i proxy né bloccare la UI. “↻ Aggiorna ora” invece forza subito **tutti** i canali.
Se un canale non risponde, lo riprova al giro successivo e nel frattempo restano visibili i dati
in cache.

In sintesi, per ogni visita:

1. snapshot da IndexedDB → la griglia è subito visibile;
2. `data.json` riletto in background (aggiornato dal workflow, vedi sotto);
3. rotazione dei canali ogni 30 s che arricchisce il catalogo con le novità;
4. il badge in alto racconta lo stato (`controllo 3 canali…`, `+2 nuove offerte`,
   `aggiornato 4 min fa`); nella finestra “Canali monitorati” puoi spegnere l'auto-refresh o
   aggiungere canali tuoi (restano solo sul tuo browser).

Nessun server, nessuna chiave API: funziona anche solo aprendo `index.html` da GitHub Pages.

### 2. Aggiornamento server-side di `data.json` (la parte davvero robusta)

Questa è la parte che tiene in piedi tutto: **anche se tutti i proxy CORS sono giù**, il catalogo
resta fresco perché è GitHub a rigenerarlo. Il workflow è in
**`.github/workflows/update-catalog.yml`** (copia di riferimento in
`docs/github-workflow-update-catalog.yml`) e gira **ogni 12 minuti**: scarica `t.me/s/<canale>`
direttamente lato server, rigenera `data.json` con `scripts/scan.mjs`, fa girare i test e committa.

#### Attivarlo in 2 minuti

1. **Controlla che il file ci sia** nel branch: `.github/workflows/update-catalog.yml`
   (se il tuo GitHub non l'ha accettato nel push, crealo a mano con
   **Add file → Create new file**, incollando il contenuto di `docs/github-workflow-update-catalog.yml`).
2. **Permessi di scrittura**: *Settings → Actions → General → Workflow permissions* →
   seleziona **Read and write permissions** → *Save*. Serve per il commit di `data.json`.
3. **Abilita il workflow**: tab **Actions** → se compare il banner
   *“Workflows aren't being run on this forked repository”* o *“I understand my workflows, go ahead and enable them”*,
   clicca **Enable** / **I understand…**.
4. **Prima esecuzione a mano**: *Actions → «Aggiorna catalogo auricolari» → Run workflow →
   Run workflow*. In ~1 minuto vedi il job verde e `data.json` aggiornato nel repo.
5. Fatto: da lì in poi gira da solo ogni 12 minuti. GitHub può ritardare di qualche minuto nei
   momenti di punta (è normale, lo scheduler non è in tempo reale).

Senza il passaggio 2 il job fallisce in fondo con `remote: Permission to ... denied`
(il commit di `data.json` non passa). Se non vuoi dare write al workflow, in alternativa
puoi tenerlo in sola lettura e scaricare l'artefatto, ma per l'aggiornamento automatico
servono i permessi di scrittura.

#### Comandi utili

- **Aggiornare subito a mano**: *Actions → «Aggiorna catalogo auricolari» → Run workflow*.
- **Cambiare i canali senza toccare il codice**: *Settings → Secrets and variables → Actions →
  Variables → New repository variable*, nome `TELEGRAM_CHANNELS`, valore con la lista separata da
  virgole (es. `sconticina,prezzitech,offertedale`).
- **Finestra dell'archivio**: variabile `ARCHIVE_DAYS` (default `30`).
- **Rigenerare `data.json` in locale senza rete** (normalizza le offerte già salvate):
  ```bash
  node scripts/scan.mjs --rebuild
  ```

### In locale

```bash
node test/run.mjs            # test del parser, dedupe e schede pro/contro
node scripts/scan.mjs --dry  # scansione senza scrivere data.json
node scripts/scan.mjs        # rigenera data.json (richiede rete verso t.me)
node scripts/scan.mjs --rebuild  # normalizza data.json offline (senza rete)
npx serve .                  # oppure: python3 -m http.server 8080
```

`scripts/scan.mjs` richiede Node 18+ (fetch nativo) e non ha dipendenze npm.

## Come funziona il parsing

- `lib/tg.js` è un modulo condiviso browser/Node: regex robuste su `tgme_widget_message`
  (niente dipendenze), gestisce sia i post con **più offerte** in un unico messaggio
  (es. ScontiCina) sia quelli numerati tipo “1) … 2) …”, sia il formato compatto di Prezzi.Tech.
- Filtra tutto ciò che non è audio (TV, robot aspirapolvere, casse, smartwatch…) con
  una blocklist di categorie e una allowlist di parole chiave (cuffie, auricolari, earbuds, TWS…).
- **Deduplica per modello, non per titolo**: `lib/models.js` riconosce ~85 modelli diffusi
  (AirPods Pro 2/3, Sony WH-1000XM5/XM4, Bose QC Ultra, Pixel Buds Pro 2/2a, FreeBuds SE 3 vs
  SE 5 Max, Edifier W820NB, Soundcore P20i/P31i/P41i…) e costruisce una chiave
  `marchio:modello`. Lo stesso prodotto segnalato da tre canali diventa **una card sola**, con il
  **prezzo migliore** del gruppo, i badge `@canale A, @canale B` e `segnalato 3 volte`.
  Anche i doppioni dentro lo stesso post vengono eliminati.
- **Marca e categoria dedotte dal modello**, non solo dal titolo: “Auricolari true wireless Pixel
  Buds Pro 2” → Google / TWS; “HUAWEI CUFFIE TRUE WIRELESS” (dove il modello sta nel testo) →
  Huawei / FreeBuds SE 3. La categoria resta la forma fisica (`tws`, `cuffie`, `open`, `sport`,
  `gaming`): l'ANC è un flag separato (`hasAnc`), quindi un modello ANC non sparisce più dal
  filtro “Cuffie over-ear” e il chip “🔇 ANC” continua a funzionare.
- **Store sempre riconosciuto**: hashtag (`#Amazon`), riga `🛍 Amazon`, `Venduto e spedito da …`,
  dominio del link e — per i link accorciati (`prezzi.tech/go`, `ofclub.click`, `scontify.net`) —
  il testo del post. Niente più etichetta generica “Store”.
- **Pro e contro al tocco**: toccando una card si apre un pannello sopra “Vai all'offerta” con
  **2 pro e 2 contro** e la tabella delle specifiche (ANC in dB, autonomia, Bluetooth, codec,
  multipoint, IP, peso, microfoni). I valori arrivano dalle specifiche lette nel post (marcate
  `post`) e dall'anagrafica curata dei modelli. Per i modelli meno noti la scheda lo dice
  esplicitamente: nei post Telegram le specifiche spesso mancano, quindi la tabella può essere
  parziale.
- Le offerte restano in archivio 30 giorni (max 900), prezzo/sconto ricalcolati dal testo.
  Le card “fantasma” (righe di venditore come titolo, importi di risparmio scambiati per prezzi)
  vengono scartate in fase di normalizzazione.

## Struttura

```
index.html                 app statica (GitHub Pages)
app.js                     UI + scansione on-demand nel browser
styles.css                 stile
lib/tg.js                  parser Telegram + merge/dedupe/stats (browser + Node)
lib/models.js              anagrafica ~85 modelli + specifiche + pro/contro
scripts/scan.mjs           CLI che rigenera data.json
test/run.mjs               test del parser (npm-free, `node test/run.mjs`)
.github/workflows/update-catalog.yml   aggiornamento periodico di data.json
data.json                  snapshot del catalogo servito dal sito
```

## Note

- I prezzi sono quelli indicati nei post al momento della pubblicazione: verifica sempre
  sullo store. I link possono essere affiliati dei canali originali.
- `t.me/s/…` mostra solo gli ultimi messaggi di un canale: per i canali privati serve
  un bot amministratore. Il sito è pensato per canali **pubblici** con anteprima web attiva.
