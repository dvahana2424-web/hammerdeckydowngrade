# Hammer 4.0 (obfuscated) — One-paste installer

Branch: [`Hammer-3.8-obfuscated`](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/Hammer-3.8-obfuscated) *(URL unchanged for backward compatibility)*

Installs **Hammer 4.0** (Cloudflare CDN + license worker, obfuscated build) from `C:\Program Files (x86)\Hammer`.

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/Hammer-3.8-obfuscated/install.ps1 | iex
```

jsDelivr alternate:

```powershell
irm https://cdn.jsdelivr.net/gh/dvahana2424-web/hammerdeckydowngrade@Hammer-3.8-obfuscated/install.ps1 | iex
```

Payload: [GitHub Release v4.0-obfuscated](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v4.0-obfuscated)

## What's in Hammer 4.0

- Hammer 4.0 obfuscated self-contained build
- License verification via Cloudflare worker (no GitHub PAT in client)
- Signed CDN requests, blocked HWID check, offmode bundle via worker
- All prior UX fixes (toasts, minimize, delete filter, Steam restart on lua removal)

Payload built from `C:\Program Files (x86)\Hammer` via `package-payload.ps1`.

## What the installer does

1. Requests Administrator rights (UAC).
2. Downloads `Hammer-4.0.zip.001` + `Hammer-4.0.zip.002` and reassembles the zip.
3. Installs files to `C:\Program Files (x86)\Hammer`.
4. Creates Desktop shortcut **"Hammer 4.0"**.
5. Registers **Control Panel > Programs** uninstall via `Uninstall.exe`.

## Maintainer: refresh payload

```powershell
powershell -ExecutionPolicy Bypass -File .\package-payload.ps1
# Upload payload-out\Hammer-4.0.zip.* to release v4.0-obfuscated
```

## HTTP 429

Wait a few minutes and retry, or download manually from the [v4.0-obfuscated release](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v4.0-obfuscated).
