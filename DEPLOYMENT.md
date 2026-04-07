# Deployment Guide

This guide covers how to deploy the Nakama backend and React frontend for Grid Clash.

## 1. What is already prepared

The repository now includes:

- local Docker development stack in `docker-compose.yml`
- production-oriented Docker template in `docker-compose.prod.yml`
- backend environment template in `.env.backend.example`
- frontend public-host environment template in `frontend/.env.production.example`
- Nakama Lua runtime modules in `nakama/modules/`

## 2. Backend deployment options

Recommended providers:

- DigitalOcean Droplet or App Platform
- AWS EC2 / ECS / Fargate
- GCP Compute Engine / Cloud Run
- Azure VM / Container Apps

The simplest path for assignment submission is:

- deploy Nakama + PostgreSQL on a Linux VPS
- deploy the React frontend separately on Vercel or Netlify

## 3. Backend deployment on a Linux VPS

### Provision the server

Minimum practical setup:

- Ubuntu 22.04 LTS
- 2 vCPU
- 2 GB RAM
- open ports `80`, `443`, `7350`, and optionally `7351`

### Install Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
```

### Copy the project to the server

Use Git or SCP to place the repo on the machine, for example:

```bash
/home/ubuntu/grid-clash
```

### Create backend environment file

```bash
cp .env.backend.example .env.backend
```

Update all placeholder secrets in `.env.backend`.

Important values to change:

- `NAKAMA_POSTGRES_PASSWORD`
- `NAKAMA_SERVER_KEY`
- `NAKAMA_SESSION_ENCRYPTION_KEY`
- `NAKAMA_REFRESH_ENCRYPTION_KEY`
- `NAKAMA_RUNTIME_HTTP_KEY`
- `NAKAMA_CONSOLE_PASSWORD`
- `NAKAMA_CONSOLE_SIGNING_KEY`
- `NAKAMA_SOCKET_SERVER_KEY`

### Start Nakama + PostgreSQL

```bash
docker compose --env-file .env.backend -f docker-compose.prod.yml up -d
```

### Verify backend

```bash
docker compose --env-file .env.backend -f docker-compose.prod.yml ps
docker compose --env-file .env.backend -f docker-compose.prod.yml logs -f nakama
```

Look for:

- `Startup done`

## 4. TLS / reverse proxy

For public deployment, place Nginx or Caddy in front of Nakama.

Recommended public exposure:

- frontend on `https://your-frontend-domain`
- Nakama HTTP API and websocket on `https://your-nakama-domain`
- Nakama console only if needed, preferably restricted by IP or basic auth

If using Nginx, proxy:

- `/v2/` to `http://127.0.0.1:7350`
- `/ws` to `http://127.0.0.1:7350`

Make sure websocket upgrade headers are enabled.

## 5. Frontend deployment

Recommended platforms:

- Vercel
- Netlify
- Cloudflare Pages

### Frontend environment variables

Use `frontend/.env.production.example` as the template.

Set:

- `VITE_NAKAMA_HOST`
- `VITE_NAKAMA_PORT`
- `VITE_NAKAMA_SCHEME`
- `VITE_NAKAMA_SERVER_KEY`

Example:

```env
VITE_NAKAMA_HOST=nakama.example.com
VITE_NAKAMA_PORT=443
VITE_NAKAMA_SCHEME=https
VITE_NAKAMA_SERVER_KEY=change-this-server-key
```

### Build command

```bash
cd frontend
npm install
npm run build
```

### Publish directory

```text
frontend/dist
```

## 6. Deployment documentation to submit

Include these in your assignment submission:

- backend public URL or IP
- frontend public URL
- Nakama console URL if you choose to expose it
- test credentials for two players, if required
- short runbook for starting/stopping services

## 7. Suggested final verification checklist

Before submission, verify:

1. Two users can register and login.
2. One user can create a room.
3. Another user can join by room code.
4. Auto-match pairs two waiting players.
5. Moves are rejected if invalid or out of turn.
6. Disconnecting one player resolves the match correctly.
7. Two different rooms can run at the same time.
8. Wins/losses/streaks persist across refresh/relogin.
9. Global rankings update after completed matches.
10. The frontend works on a phone-sized viewport.

## 8. Limitation note

This repository is deployment-ready from a documentation and configuration standpoint, but the actual live cloud deployment must still be executed from your own cloud account.
