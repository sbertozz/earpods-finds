# Auricolari Radar 🎧

Web app statica (GitHub Pages) che raccoglie **solo offerte di auricolari e cuffie Bluetooth**
pescate dall'anteprima pubblica dei canali Telegram tech italiani.

## Cosa è cambiato: il catalogo adesso si aggiorna da solo

Prima il sito leggeva `data.json` e **niente lo rigenerava**: il workflow citato
nell'interfaccia (`.github/workflows/pages.yml`) non esisteva, quindi le offerte restavano
ferme per sempre. Ora ci sono **due livelli di aggiornamento**:

### 1. Aggiornamento nel browser, a ogni visita (zero configurazione)

Apri il sito e parte subito una scansione:

1. il browser scarica l'anteprima pubblica di ogni canale (`https://t.me/s/<canale>`)
   passando da un proxy CORS pubblico (t.me non manda gli header CORS);
2. `lib/tg.js` estrae dalle pagine solo le **offerte audio** (prezzo, prezzo pieno, sconto,
   link d'acquisto, immagine, canale, data);
3. le nuove offerte vengono unite a quelle già in `data.json` e salvate in `localStorage`,
   quindi restano visibili anche se ricarichi la pagina o il proxy è giù;
4. si ripete **ogni 3 minuti** mentre la pagina è aperta e quando torni sulla tab;
5. il pulsante **“↻ Aggiorna ora”** forza un controllo immediato.

Il badge in alto mostra lo stato (`controllo 9 canali…`, `+3 nuove offerte`, `aggiornato 2 min fa`),
e nella finestra “Canali monitorati” puoi disattivare l'aggiornamento automatico o aggiungere
canali tuoi (restano solo sul tuo browser).

Nessun server, nessuna chiave API: funziona anche solo aprendo `index.html` da GitHub Pages.

> Nota: alcuni proxy pubblici ogni tanto vengono bloccati da reti aziendali o da Telegram.
> L'app prova in sequenza 5 servizi diversi, ricorda quello che funziona e, se nessuno risponde,
> continua a mostrare l'ultimo catalogo salvato.

### 2. Aggiornamento anche di `data.json` su GitHub (opzionale, 2 minuti)

Così il catalogo è aggiornato pure per chi visita il sito quando il browser non può parlare
con Telegram (proxy bloccati) e su tutti i dispositivi.

Il workflow è pronto in **`docs/github-workflow-update-catalog.yml`**: rigenera `data.json`
**ogni 20 minuti** con `scripts/scan.mjs` e fa commit. Va copiato una volta in
`.github/workflows/update-catalog.yml` (il token di questo ambiente non ha il permesso
`workflows` per creare file lì):

1. su GitHub: **Add file → Create new file**, percorso `.github/workflows/update-catalog.yml`,
   incolla il contenuto di `docs/github-workflow-update-catalog.yml`, commit;
2. oppure da terminale, sul branch che poi unirai in `main`:
   ```bash
   mkdir -p .github/workflows
   cp docs/github-workflow-update-catalog.yml .github/workflows/update-catalog.yml
   git add .github/workflows/update-catalog.yml
   git commit -m "ci: aggiornamento automatico del catalogo"
   git push
   ```
3. in **Settings → Actions → General → Workflow permissions** lascia
   *“Read and write permissions”* (serve per il commit di `data.json`).

Puoi anche lanciarlo a mano: **Actions → Aggiorna catalogo auricolari → Run workflow**.
Per cambiare canali senza toccare il codice: **Settings → Variables → New repository variable**
`TELEGRAM_CHANNELS` con la lista separata da virgole (es. `sconticina,prezzitech,offertedale`).

### In locale

```bash
node test/run.mjs            # test del parser (fixture con markup Telegram reale)
node scripts/scan.mjs --dry  # scansione senza scrivere data.json
node scripts/scan.mjs        # rigenera data.json
npx serve .                  # oppure: python3 -m http.server 8080
```

`scripts/scan.mjs` richiede Node 18+ (fetch nativo) e non ha dipendenze npm.

## Come funziona il parsing

- `lib/tg.js` è un modulo condiviso browser/Node: regex robuste su `tgme_widget_message`
  (niente dipendenze), gestisce sia i post con **più offerte** in un unico messaggio
  (es. ScontiCina) sia quelli numerati tipo “1) … 2) …”, sia il formato compatto di Prezzi.Tech.
- Filtra tutto ciò che non è audio (TV, robot aspirapolvere, casse, smartwatch…) con
  una blocklist di categorie e una allowlist di parole chiave (cuffie, auricolari, earbuds, TWS…).
- Deduplica per titolo+prezzo: la stessa offerta pubblicata su più canali diventa una card sola
  con la sezione “anche su @canale”.
- Le offerte restano in archivio 30 giorni (max 900), prezzo/sconto ricalcolati dal testo.

## Struttura

```
index.html                 app statica (GitHub Pages)
app.js                     UI + scansione on-demand nel browser
styles.css                 stile
lib/tg.js                  parser Telegram + merge/dedupe/stats (browser + Node)
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
