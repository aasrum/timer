#!/usr/bin/env bash
# Polle-basert auto-deploy: hentes av systemd-timeren hvert minutt.
# Gjør ingenting (og bruker ~0 ressurser) når ingenting er pushet.
set -euo pipefail

REPO_DIR=/opt/timer
# Grenen serveren skal følge. Bytt til "main" når PR-en merges og main
# blir produksjonsgren.
BRANCH=claude/race-timing-webapp-gjx43b

cd "$REPO_DIR"
git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "Ny versjon: $LOCAL -> $REMOTE, bygger og ruller ut..."
git checkout -q "$BRANCH"
git reset --hard "origin/$BRANCH"
docker compose up -d --build
echo "Utrulling ferdig."
