# ValveOFF — one-paste install

Works on **SteamOS (Steam Deck)**, **Bazzite**, and most other Linux distros.

## Install

Open **Konsole** in Desktop Mode (as your normal user, *not* root) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/install | bash
```

You will be asked for your **sudo password once**. Everything else is automatic.

## What it does

1. Detects your host (SteamOS / Bazzite / generic Linux).
2. **Smart cleanup of any old OneTap / SLSsteam install:**
   - removes its Desktop-Mode unlock (`.desktop` + `LD_AUDIT` wrappers),
   - removes its Game-Mode unlock (`LD_AUDIT` in `steam-jupiter` / `steam`),
   - deletes `steam.cfg` so **Steam auto-update is re-enabled**,
   - removes `~/.local/share/SLSsteam` and `~/.config/SLSsteam`.
3. Downloads the ValveOFF bundle into your **Downloads** folder
   (`~/Downloads/ValveOFF 1.4/`).
4. Installs **Decky Loader (latest)** if it isn't already present.
5. Installs **Hammer + ValveOFF + hammer-decky** and wires the Desktop-Mode unlock.
6. Applies the **Game-Mode unlock** (`steam-jupiter` patch on SteamOS,
   `/usr/local/bin/steam` wrapper on Bazzite/atomic).

## One-time finishing step

1. Launch Steam in Desktop Mode (let it update if it wants — that's fine).
2. Run ValveOFF once to activate your license:
   `~/Downloads/ValveOFF 1.4/ValveOFF` (or from the KDE menu).
3. Game Mode → quick-access (•••) → **Hammer Library**.

## Manage it

```bash
cd "$HOME/Downloads/ValveOFF 1.4"
./install.sh status       # what's installed
./install.sh verify       # did Hammer load in Desktop Mode?
./install.sh uninstall    # remove everything (keeps config)
```

## Self-hosting the bundle

The big bundle ships as a GitHub Release asset (`valveoff-bundle.tar.gz`).
Point the installer elsewhere with:

```bash
VALVEOFF_BUNDLE_URL=https://example.com/valveoff-bundle.tar.gz \
  curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/install | bash
```

---

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
