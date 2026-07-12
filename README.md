# Hammer 3.8 (obfuscated) — One-paste installer

Branch: [`Hammer-3.8-obfuscated`](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/Hammer-3.8-obfuscated)

Based on `Hammer-3.8-fixed-connection`, with the **obfuscated** Hammer 3.8 build from `C:\Program Files (x86)\Hammer`.

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/Hammer-3.8-obfuscated/install.ps1 | iex
```

jsDelivr alternate:

```powershell
irm https://cdn.jsdelivr.net/gh/dvahana2424-web/hammerdeckydowngrade@Hammer-3.8-obfuscated/install.ps1 | iex
```

Payload mirrors: [GitHub Release v3.8-obfuscated](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v3.8-obfuscated) (primary) and this branch.

## What's in this build

- License / connection fix (ValveOFF-style)
- UI layout lock (minimize works; no forced fullscreen)
- Delete Game IDs: title filter, fixed first-row overlap, deletes unlock lua + auto Steam restart
- Embedded `hammer.ico`
- **Obfuscar** rename protection (self-contained, no separate .NET install)

Payload refreshed from `C:\Program Files (x86)\Hammer\Hammer.exe` (latest obfuscated build).

## What it does

1. Requests Administrator rights (UAC).
2. Downloads the payload (`Hammer-3.8.zip.001`, `Hammer-3.8.zip.002`) and reassembles it.
3. Installs the files to `C:\Program Files (x86)\Hammer`.
4. Creates a Desktop shortcut **"Hammer 3.8"** using `hammer.ico`.
5. Registers an entry in **Control Panel > Programs and Features** that uninstalls via `Uninstall.exe`.

## If you get HTTP 429

The installer downloads payload files from the [v3.8-obfuscated release](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v3.8-obfuscated) first. If that fails, wait a few minutes and run the command again.
