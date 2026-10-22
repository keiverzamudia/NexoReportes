#!/usr/bin/env bash
# ============================================================
# Despliegue simple: pull + backup de PostgreSQL + rebuild.
# Uso:  ./scripts/deploy.sh
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Backup de PostgreSQL"
mkdir -p backups
if docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "backups/nexo-${STAMP}.sql.gz"
  echo "    backups/nexo-${STAMP}.sql.gz"
  # Conservar los últimos 10 backups.
  ls -1t backups/nexo-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  echo "    (db no está corriendo: primer despliegue, se omite)"
fi

echo "==> Actualizando código"
git pull --ff-only

echo "==> Reconstruyendo y levantando"
docker compose up -d --build

echo "==> Limpieza de imágenes huérfanas"
docker image prune -f >/dev/null

echo "==> Estado"
docker compose ps
echo
echo "Listo. App: http://$(hostname -I | awk '{print $1}'):4100"
