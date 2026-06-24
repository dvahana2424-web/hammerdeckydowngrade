# hammerdeckydowngrade

Hosted Hammer binaries and config for Steam Deck — one-command update.

Repository: [dvahana2424-web/hammerdeckydowngrade](https://github.com/dvahana2424-web/hammerdeckydowngrade)

## Quick update (Steam Deck / Linux)

Close Steam first, then paste **one** of these in Konsole:

**Shortest (GitHub Pages — like headcrab):**
```bash
curl -fsSL https://hammerdeckydowngrade.pages.dev/install | bash
```

**GitHub.io mirror:**
```bash
curl -fsSL https://dvahana2424-web.github.io/hammerdeckydowngrade/install | bash
```

**Raw GitHub (always works, no Pages needed):**
```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/install | bash
```

Or download and run locally:

```bash
curl -fsSL -O https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/install
chmod +x install
./install
```

## What gets installed

| Remote file | Local path |
|-------------|------------|
| `bin/hammersteam.so` | `~/.local/share/Hammer/hammersteam.so` |
| `bin/library-inject.so` | `~/.local/share/Hammer/library-inject.so` |
| `config/config.yaml` | `~/.config/hammersteam/config.yaml` |

Existing files are backed up to `~/.config/hammersteam/backups/update-<timestamp>/` before overwrite.

## Contents

- **hammersteam.so** — Hammer LD_AUDIT library (includes `??` pattern fix + Jun 2026 Steam vaddrs)
- **library-inject.so** — small audit helper that loads hammersteam.so
- **config.yaml** — working patterns/offsets for Steam build `1782257239`

See `VERSION.txt` for build metadata.

## Manual install

```bash
mkdir -p ~/.local/share/Hammer ~/.config/hammersteam
cp bin/hammersteam.so ~/.local/share/Hammer/
cp bin/library-inject.so ~/.local/share/Hammer/
cp config/config.yaml ~/.config/hammersteam/
chmod 755 ~/.local/share/Hammer/*.so
```

Restart Steam after updating.

## Steam downgrade (build 1781041600)

Downgrade SteamOS Deck stable client to build **1781041600** using cached
packages from [hammer-downgrader](https://github.com/dvahana2424-web/hamdeck/tree/hammer-1.1.6/Hammer%20cloud%20save/hamdeck-hammer-1.1.3/tools/hammer-downgrader).

**Exit Steam first**, then paste in Konsole:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/downgrade-steam | bash
```

What it does:
1. Downloads ~675 MB staged cache from `steam-cache/1781041600/` on this repo
2. Extracts to `~/.cache/hammer-downgrader/steam_client_steamdeck_stable_ubuntu12-f55f159fb197/`
3. Runs Steam in textmode pointed at the local cache (same as hammer-downgrader **Apply**)
4. Writes `steam.cfg` to inhibit auto-update

Options:
- `SKIP_APPLY=1` — download/cache only, no Steam textmode apply
- `PARALLEL=2` — fewer parallel downloads if network is flaky

Cache only (no apply):
```bash
SKIP_APPLY=1 curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/downgrade-steam | bash
```
