# Yogganga

[![Android APK](https://github.com/SergioJuniorCE/Yogganga/actions/workflows/android-apk.yml/badge.svg)](https://github.com/SergioJuniorCE/Yogganga/actions/workflows/android-apk.yml)
[![Latest release](https://img.shields.io/github/v/release/SergioJuniorCE/Yogganga?label=latest)](https://github.com/SergioJuniorCE/Yogganga/releases/latest)
[![Nightly](https://img.shields.io/badge/nightly-download-blue)](https://github.com/SergioJuniorCE/Yogganga/releases/tag/nightly)

A self-hosted manga library, Arr-style in spirit: a small server owns the
catalogue and downloads chapters, and an Expo app is the reader.

```
MangaDex API
     │
     ▼
server/  Node 24+, Hono, node:sqlite
  ├─ accounts + sessions
  ├─ per-user follows and reading progress
  ├─ background poller → download queue
  └─ data/files/<mangaId>/<chapterId>/001.jpg
     │
     ▼
app/  Expo + React Native (iOS / Android)
  ├─ library + continue reading
  ├─ browse MangaDex
  ├─ vertical reader with resume
  └─ offline chapter cache on the device
```

This is a pnpm workspace driven by Turborepo. There are two packages:
`@yogganga/server` and `@yogganga/app`.

## Quick start

```bash
pnpm install

cp server/.env.example server/.env
# set MANGA_INVITE_CODE in server/.env

pnpm dev
```

`pnpm dev` runs the API in watch mode and Metro side by side. To run them
separately:

```bash
pnpm dev:server
pnpm dev:app
```

Node 24+ is required: the server uses the built-in SQLite driver and runs
TypeScript directly, so there is no build step and no native dependency.

## Server

Listens on `0.0.0.0:8787` and writes to `server/data/`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database + downloaded pages |
| `MANGA_INVITE_CODE` | unset | Required for friends to create accounts |
| `POLL_HOURS` | `6` | How often followed series are checked |
| `LANGUAGES` | `en` | Comma-separated translated languages |
| `QUALITY` | `data` | `data` or `data-saver` |
| `DOWNLOAD_CONCURRENCY` | `2` | Chapters downloaded in parallel |

`server/.env` is loaded automatically if it exists.

Turborepo runs in strict env mode, so any new server variable must also be
added to `globalPassThroughEnv` in `turbo.json` or it will be stripped before
the task sees it.

## App

```bash
pnpm dev:app
```

Scan the QR code with Expo Go, or press `a` / `i` to open an emulator. To skip
typing the server address on every fresh install:

```bash
EXPO_PUBLIC_SERVER_URL=http://192.168.1.20:8787 pnpm dev:app
```

### First login

The first account created on a fresh server needs no invite code. It becomes
the owner, and everything else is available to it immediately. After that,
registration requires `MANGA_INVITE_CODE` — remove the variable to close
signups entirely.

## Accounts, not a shared password

- Passwords are hashed with `scrypt` (per-user salt, 64-byte key) and compared
  in constant time.
- Sessions are 32 random bytes; only their SHA-256 is stored in the database.
  The token lives in `expo-secure-store` on the phone.
- Login attempts are throttled to 10 failures per 15 minutes per IP + username.
- Every route except health, login, and register requires a session, including
  the image files.
- Sessions last 180 days and are revoked on sign out.

Follows and reading progress are per user. Downloads are shared: a chapter is
fetched once and everyone streams the same files. If any follower's download
rule covers a chapter, the server downloads it.

## Letting friends in

**Tailscale (recommended).** Install it on the server and on their phones, then
use the Tailscale hostname or IP in the app. Nothing is exposed to the internet.

**Reverse proxy.** If you need public access, put Caddy or nginx in front with
TLS. Do not expose plain HTTP — the bearer token is the only thing protecting
the library.

## API

```
POST /api/auth/register     { username, password, invite }
POST /api/auth/login        { username, password } → { token, user }
POST /api/auth/logout
GET  /api/auth/me

GET  /api/search?q=&limit=&offset=
GET  /api/manga/:id[?refresh=1]

GET  /api/library
PUT  /api/library/:id       { downloadMode: "new" | "all" | "none" }
DELETE /api/library/:id
POST /api/library/:id/mode  { downloadMode }

GET  /api/history?limit=
GET  /api/chapters/:id
PUT  /api/chapters/:id/progress  { page, totalPages, completed }
POST /api/chapters/:id/download
POST /api/refresh
GET  /files/...
```

All of these except health/login/register need `Authorization: Bearer <token>`.

## Repo commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Server watch + Metro |
| `pnpm dev:server` | Server only |
| `pnpm dev:app` | Expo only |
| `pnpm start` | Server without watch |
| `pnpm typecheck` | `tsc --noEmit` in both packages |

## Known limits

- One server is one shared library. Users have their own follows and progress,
  but not their own storage.
- MangaDex lists the same chapter once per scanlation group; the server keeps
  the version with the most pages, then the most recent upload.
- Resume position uses an estimated page height, so it can land a page off in
  chapters with unusual page sizes.
- No notifications, no OPDS, no per-user "mark all read" yet.
- There is no password-reset flow. To let someone start over, delete their row
  in `server/data/manga.db` (`DELETE FROM users WHERE username = '...'`) and
  they can register again with the invite code.
- MangaDex content is largely fan scanlation. Buy the volumes you care about.
