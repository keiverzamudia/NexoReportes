# Despliegue en el servidor (Linux + Docker)

Guía corta para `keiver@srcorpodev04` (172.16.1.85).

## 1. Preparar Docker (una sola vez)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker keiver
newgrp docker
docker --version && docker compose version
```

## 2. Primer despliegue

```bash
cd ~/programacion/reportes/NexoReportes
git pull

cp .env.production.example .env
openssl rand -hex 32     # JWT_SECRET
openssl rand -hex 32     # JWT_REFRESH_SECRET
openssl rand -hex 24     # POSTGRES_PASSWORD
nano .env                # pegar los secretos, Profit y la IP real

docker compose up -d --build
docker compose ps
curl http://localhost:4100/api/health
```

Abrir desde otra PC de la red: `http://172.16.1.85:4100`

## 3. Importar las fechas y el forecast del sistema viejo

El snapshot viaja en el repo (`deploy/legacy-data.json`):

```bash
docker compose run --rm api node /app/scripts/import-legacy.mjs /app/deploy/legacy-data.json
```

Si el sistema viejo cambió después de generar el snapshot, se re-exporta en Windows:

```powershell
node scripts/export-legacy.mjs --db="C:/Users/desarrollador02/Documents/porgramacion/Reportes/apps/api/prisma/nexo.db" --out=deploy/legacy-data.json
```

…se hace commit/push y en el servidor se corre el `docker compose run` de nuevo (es idempotente).

## 4. Actualizaciones del día a día

```bash
cd ~/programacion/reportes/NexoReportes
./scripts/deploy.sh
```

Hace: backup `pg_dump` → `git pull --ff-only` → `docker compose up -d --build` → limpieza.

## 5. Operación

```bash
docker compose logs -f api          # logs de la API
docker compose logs -f web          # logs del frontend
docker compose ps                   # estado
docker compose restart api          # reiniciar solo la API
docker compose down                 # apagar (los datos quedan en el volumen pgdata)
./scripts/deploy.sh                 # desplegar cambios
```

Backup manual de la base:

```bash
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > backups/nexo-$(date +%F).sql.gz
```

## 6. Reglas para no romper datos

- **Nunca** `docker compose down -v` (borra el volumen `pgdata`).
- **Nunca** `prisma migrate reset` ni `db push --force-reset`.
- El contenedor `api` ejecuta `prisma db push` al arrancar; si un cambio de esquema
  fuera destructivo, falla y se detiene en vez de borrar datos.
- Si se pierde la sesión de todos los usuarios tras un deploy, revisar que
  `JWT_SECRET`/`JWT_REFRESH_SECRET` no hayan cambiado en `.env`.
