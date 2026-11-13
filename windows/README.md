# Windows container + tray app

This runs the Yogganga server as a Docker/Podman container and installs a
small tray app for status and control. It is not a native Windows service; see
[Startup and the service tradeoff](#startup-and-the-service-tradeoff).

## Requirements

- Windows 11.
- One container engine:
  - [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the
    WSL 2 backend, or
  - [Podman](https://podman.io/) with a working `podman compose` provider.
- The repository checked out locally, with `server/data` on the local disk
  (not a network share).

Node and pnpm are not required on the host for the container; the image
installs its own dependencies. They are still required for `pnpm dev` and
`pnpm typecheck`.

Docker Desktop is used first when both engines are installed. Pass
`-Engine podman` or `-Engine docker` to force one.

## Install

Edit `server\.env` first (at minimum `MANGA_INVITE_CODE`), then from an
elevated PowerShell:

```powershell
cd C:\Users\sergi\dev\Yogganga
powershell -ExecutionPolicy Bypass -File windows\install.ps1 `
  -ServerUrl http://jr-pc-windows.tail2a35f7.ts.net:8787
```

`-ServerUrl` is optional. Without it the script asks Tailscale for this
machine's MagicDNS name and falls back to `http://<computer-name>:8787`.

Preview without changing anything:

```powershell
powershell -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun
```

The dry run does not need administrator rights and does not create files,
containers, firewall rules, or autostart entries.

The installer:

1. Finds Docker or Podman and starts it if needed.
2. Creates `server\.env` from `.env.example` if it does not exist.
3. Builds `yogganga-server:local` from the repository.
4. Runs `compose up -d --force-recreate`, with `server\data` bind-mounted to
   `/app/server/data`.
5. Waits for `http://127.0.0.1:8787/api/health`.
6. Adds the `Yogganga Server (TCP 8787)` inbound firewall rule for Private and
   Domain networks.
7. Compiles the tray app with the .NET Framework compiler included in Windows,
   copies it to `%LOCALAPPDATA%\Yogganga\`, writes `tray.ini`, and registers it
   under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
8. Starts the tray.

Useful switches:

| Switch | Effect |
| --- | --- |
| `-Engine docker\|podman\|auto` | Choose the container engine |
| `-ServerUrl <url>` | URL shown/copied by the tray |
| `-SkipFirewall` | Do not touch Windows Firewall |
| `-SkipTray` | Container only; do not install/register the tray |
| `-NoTrayLaunch` | Install the tray but do not start it now |

## Tray app

The tray icon is a colored dot: green running, red stopped, amber changing,
gray for engine/container unavailable. Right-click for:

- Start, stop, restart the container.
- Start Docker Desktop / the Podman machine when the engine is down.
- Open the server in a browser or copy its URL.
- Open `server\data`.
- Show the last 200 log lines in Notepad.
- Exit.

The tray does not need administrator rights: it talks to the user's Docker or
Podman CLI. Closing the menu does not stop it; use Exit to remove the icon.

The tray starts the container at sign-in. If you stop it from the tray, it
stays stopped until you start it again or sign in again.

## Startup and the service tradeoff

The container uses `restart: unless-stopped`, and the tray is registered to
start at user sign-in. At sign-in the tray starts Docker Desktop or the Podman
machine if needed, and starts the container if it is stopped.

This means **nothing runs before a user signs in**. A native Windows service
would start at boot without a desktop session, but it cannot use Docker
Desktop's per-user engine without similar plumbing. If boot-without-login is a
hard requirement, a native service is the better fit.

The tray's `HKCU` Run entry applies to the account that ran the installer.
Run the installer from the account that will own the tray. Elevated
PowerShell keeps the same user in the usual UAC consent flow.

## Data and logs

- Database and chapters: `server\data` on the host.
- Container logs: **Show recent logs** in the tray, or:

  ```powershell
  docker logs --tail 200 yogganga
  # or
  podman logs --tail 200 yogganga
  ```

- Stop the container before copying `server\data` for a backup. SQLite uses WAL
  mode, and copying a live database can produce a torn backup.
- **Do not run `pnpm start`/`pnpm dev:server` against the same `server\data`
  while the container is running.** SQLite locking does not cross the
  Windows/WSL boundary reliably, and two writers can corrupt the database.
  Stop the container first.
- Keep `PORT=8787` and `DATA_DIR=./data` in `server\.env` when using the
  container. The Compose port mapping and healthcheck assume 8787.
- Compose reads `server\.env` when it creates the container. After editing it,
  rerun `windows\install.ps1` (or `compose up -d --force-recreate`); a tray
  restart only restarts the existing process.

## Updating

```powershell
git pull
powershell -ExecutionPolicy Bypass -File windows\install.ps1
```

The installer rebuilds the image and recreates the container. `server\data`
is preserved. No `pnpm install` is needed on the host for this path.

## Uninstall

From an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1
```

This stops the tray, removes the container and local image, removes the
firewall rule and tray autostart, and deletes the tray install directory.
`server\data` is kept unless you add `-RemoveData`. Docker Desktop/Podman and
its WSL data are left alone. Preview with `-DryRun`.

## Troubleshooting

**The tray is gray and says Docker/Podman is not running.** Start it from the
tray menu, or open Docker Desktop / run `podman machine start`. The tray retries
every few seconds.

**The phone cannot connect.** From the PC, `Invoke-RestMethod
http://127.0.0.1:8787/api/health` should return `{"ok":true,...}`. If it does,
check that Tailscale is connected on both devices and shows the expected
`100.x` address. The firewall rule only covers Private/Domain profiles; if the
Tailscale adapter is marked Public, change the network profile or adjust the
rule. Use the tray's **Copy server URL**.

**Port 8787 is already in use.** Stop the terminal server:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen |
  Select-Object OwningProcess
```

Then stop that process and restart the container from the tray.

**`podman compose` is missing.** Install a Compose provider (Docker Compose or
`podman-compose`), then rerun with `-Engine podman`. Docker Desktop already
ships Compose.

**The container exists but the tray says not installed.** Run the installer
again; `compose up` recreates it. If Docker was replaced by Podman (or the
reverse), rerun the installer with the matching `-Engine` so `tray.ini` points
at the right CLI.

**I need the server before login.** Use a native Windows service instead of
this Docker setup. That is the one thing this design does not provide.

## Files

| Path | Purpose |
| --- | --- |
| `Dockerfile` | Node 26 image; runs `src/index.ts` directly |
| `compose.yaml` | Container, ports, data bind mount, healthcheck, restart policy |
| `.dockerignore` | Keeps the app, data, and secrets out of the build context |
| `windows\install.ps1` | Installer and `-DryRun` |
| `windows\uninstall.ps1` | Uninstaller and `-DryRun` |
| `windows\tray\YoggangaTray.cs` | Tray app source |
| `windows\tray\build.ps1` | Compiles the tray with the built-in .NET Framework compiler |

## Security notes

- The server is published on `0.0.0.0:8787` like `pnpm start`; rely on
  Tailscale or a TLS reverse proxy, not the firewall alone.
- The container drops all Linux capabilities and sets
  `no-new-privileges`. It still runs as root inside the container; the data
  bind mount is the only host path it can write.
- `server\.env` is not copied into the image; Compose injects it at runtime.
- The installer's firewall rule is the only host firewall change, and the
  uninstaller removes it.
