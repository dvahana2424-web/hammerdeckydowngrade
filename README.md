# Hammer 3.9 (obfuscated) — One-paste installer

Branch: [`Hammer-3.8-obfuscated`](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/Hammer-3.8-obfuscated) *(URL unchanged for backward compatibility)*

Installs **Hammer 3.9** (Cloudflare CDN, obfuscated build) from `C:\Program Files (x86)\Hammer`.

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/Hammer-3.8-obfuscated/install.ps1 | iex
```

jsDelivr alternate:

```powershell
irm https://cdn.jsdelivr.net/gh/dvahana2424-web/hammerdeckydowngrade@Hammer-3.8-obfuscated/install.ps1 | iex
```

Payload: [GitHub Release v3.9-obfuscated](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v3.9-obfuscated)

## What's in Hammer 3.9

- Cloudflare CDN worker for game DB + sojorepo (no GitHub PAT in client for games)
- Hammer 3.9 obfuscated self-contained build
- Unlock Mode 3 fixes, session caching, CDN branch-check fix
- All 3.8 UX fixes (minimize, delete filter, Steam restart on lua removal)

Payload built from `C:\Program Files (x86)\Hammer` via `package-payload.ps1`.

## What the installer does

1. Requests Administrator rights (UAC).
2. Downloads `Hammer-3.9.zip.001` + `Hammer-3.9.zip.002` and reassembles the zip.
3. Installs files to `C:\Program Files (x86)\Hammer`.
4. Creates Desktop shortcut **"Hammer 3.9"**.
5. Registers **Control Panel > Programs** uninstall via `Uninstall.exe`.

## Maintainer: refresh payload

```powershell
powershell -ExecutionPolicy Bypass -File .\package-payload.ps1
# Upload payload-out\Hammer-3.9.zip.* to release v3.9-obfuscated
```

## HTTP 429

Wait a few minutes and retry, or download manually from the [v3.9-obfuscated release](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v3.9-obfuscated).
