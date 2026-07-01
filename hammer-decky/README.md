# hammer-decky (Hammer Library)

Decky Loader plugin: add Steam games from **Game Mode** via **ValveOFF `--cli`**.

## Requirements

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader)
- **ValveOFF 1.4+** at `~/.local/share/Hammer/ValveOFF` (see `../ValveOFF/`)
- One-time **Desktop Mode** ValveOFF launch (license + `device_license_stem`)

## Install on Deck

```bash
cp -r tools/hammer-decky/* ~/homebrew/plugins/hammer-decky/
sudo systemctl restart plugin_loader
```

## Repo layout

| Path | Purpose |
|------|---------|
| `main.py` | Python backend (RPC, spawn ValveOFF) |
| `dist/index.js` | Built frontend (install as-is) |
| `plugin.json` | Decky manifest |
| `package.json` | Frontend deps (build only) |
| `TODO.md` | Follow-up polish list |

**Note:** TypeScript `src/` is not in this branch yet — only compiled `dist/`. See `TODO.md`.

## Status

**Working** on Steam Deck Game Mode (v0.9.11 + ValveOFF 1.4).  
**Follow-up:** UI retouch, Bazzite validation, frontend source in git — see `TODO.md`.
