# Hammer 4.1 (obfuscated) — One-paste installer

Branch: [`Hammer-3.8-obfuscated`](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/Hammer-3.8-obfuscated) *(URL unchanged for backward compatibility)*

Installs **Hammer 4.1** (Cloudflare CDN, obfuscated build) to `C:\Program Files (x86)\Hammer`.

Open **Windows PowerShell** (UAC admin prompt appears automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/Hammer-3.8-obfuscated/install.ps1 | iex
```

jsDelivr alternate:

```powershell
irm https://cdn.jsdelivr.net/gh/dvahana2424-web/hammerdeckydowngrade@Hammer-3.8-obfuscated/install.ps1 | iex
```

**Payload source:** Cloudflare CDN (`hammer-cdn` worker) — not GitHub releases.

## What's in Hammer 4.1

- Download token gate on CDN archives (HWID + abnormal.db)
- Built-in SteamDB browser (Hammer Library Adder)
- netwink registry bypass for abnormal.db blocked users
- Signed worker APIs, obfuscated self-contained build

## What the installer does

1. Requests Administrator rights (UAC).
2. Downloads `Hammer-4.1.zip.001` from Cloudflare CDN.
3. Reassembles and extracts to `C:\Program Files (x86)\Hammer`.
4. Creates Desktop shortcut **"Hammer 4.1"**.
5. Registers **Control Panel > Programs** uninstall entry.

## Maintainer: refresh payload

From the [hammer](https://github.com/dvahana2424-web/hammer) repo (`hammer-4.1` branch):

```powershell
powershell -ExecutionPolicy Bypass -File .\publish-obfuscated.ps1
powershell -ExecutionPolicy Bypass -File .\installer\package-payload.ps1
# Copy Hammer-4.1.zip.* to this repo and push, OR upload to sojorepo/installer/
cd cloudflare\hammer-cdn && npx wrangler deploy
```

CDN URL:

`https://hammer-cdn.monzikmonzik.workers.dev/v1/public/installer/Hammer-4.1.zip.001`
