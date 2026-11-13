#!/usr/bin/env bash
# Installa il workflow di aggiornamento automatico del catalogo.
# GitHub rifiuta i file in .github/workflows/ se il token non ha il permesso
# "workflows": questo script copia il template e fa il commit sul branch corrente.
#
#   bash scripts/install-workflow.sh
#   git push            # (poi apri la PR / mergia su main)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/github-workflow-update-catalog.yml"
DEST_DIR="$ROOT/.github/workflows"
DEST="$DEST_DIR/update-catalog.yml"

[ -f "$SRC" ] || { echo "✗ manca $SRC"; exit 1; }
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
echo "✓ creato .github/workflows/update-catalog.yml"

if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$ROOT" add .github/workflows/update-catalog.yml
  git -C "$ROOT" commit -m "ci: aggiornamento automatico del catalogo ogni 12 minuti" || true
  echo "✓ commit creato: ora fai 'git push' e mergia su main"
else
  echo "→ aggiungi il file al repo e fai commit"
fi

cat <<'MSG'

Ultimi 2 passi (una volta sola, su GitHub):
  1. Settings → Actions → General → Workflow permissions → "Read and write permissions" → Save
  2. tab Actions → "Aggiorna catalogo auricolari" → Run workflow  (prima esecuzione a mano)
Da lì in poi data.json si aggiorna da solo ogni 12 minuti.
MSG
