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
