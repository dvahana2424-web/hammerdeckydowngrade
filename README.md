# ValveOFF 1.5 — one-paste install

Works on **SteamOS (Steam Deck)**, **Bazzite**, and most other Linux distros.

This branch (`valveoff-1.5`) is **separate from `main` (ValveOFF 1.4)**. The 1.4
install commands are unchanged on `main`.

## Install (ValveOFF 1.5)

Open **Konsole** in Desktop Mode (as your normal user, *not* root) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/bootstrap | bash
```

Or directly:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/install | bash
```

You will be asked for your **sudo password once**. Everything else is automatic.

## Uninstall (ValveOFF 1.5)

Close Steam first, then paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/uninstall | bash
```

Removes Hammer + ValveOFF + hammer-decky + unlock hooks. Config is kept unless `REMOVE_CONFIG=1`.

## What it does

1. Detects your host (SteamOS / Bazzite / generic Linux).
2. **Smart cleanup of any old OneTap / SLSsteam install:**
   - removes its Desktop-Mode unlock (`.desktop` + `LD_AUDIT` wrappers),
   - removes its Game-Mode unlock (`LD_AUDIT` in `steam-jupiter` / `steam`),
   - deletes `steam.cfg` so **Steam auto-update is re-enabled**,
   - removes `~/.local/share/SLSsteam` and `~/.config/SLSsteam`.
3. Downloads the ValveOFF 1.5 bundle into your **Downloads** folder
   (`~/Downloads/ValveOFF 1.5/`).
4. Installs **Decky Loader (latest)** if it isn't already present.
5. Installs **Hammer + ValveOFF + hammer-decky** and wires the Desktop-Mode unlock.
6. Applies the **Game-Mode unlock** (`steam-jupiter` patch on SteamOS,
   `/usr/local/bin/steam` wrapper on Bazzite/atomic).
7. Refreshes `hammersteam.so` from `valveoff-1.5/bin/` (Hammer **1.1.11** zipball-fallback build).

## One-time finishing step

1. Launch Steam in Desktop Mode (let it update if it wants — that's fine).
2. Run ValveOFF once to activate your license:
   `~/Downloads/ValveOFF 1.5/ValveOFF` (or from the KDE menu).
3. Game Mode → quick-access (•••) → **Hammer Library**.

## Manage it

```bash
cd "$HOME/Downloads/ValveOFF 1.5"
./install.sh status       # what's installed
./install.sh verify       # did Hammer load in Desktop Mode?
./install.sh uninstall    # remove everything (keeps config)
```

## Quick Hammer update (ValveOFF 1.5)

Close Steam first, then paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/update-hammer.sh | bash
```

Updates:
- `bin/hammersteam.so` → `~/.local/share/Hammer/hammersteam.so`
- `bin/library-inject.so` → `~/.local/share/Hammer/library-inject.so`
- `config/config.yaml` → `~/.config/hammersteam/config.yaml`

Keep your local config (`.so` files only):

```bash
KEEP_CONFIG=1 curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/update-hammer.sh | bash
```

## Update hammer-decky plugin only

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/update-hammer-decky.sh | bash
```

## Self-hosting the bundle

The bundle ships as split raw files on
[`valveoff-1.5`](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/valveoff-1.5)
(`valveoff-bundle.tar.gz.00.part`, `…01.part`, `…sha256`). The installer
concatenates the parts, verifies the SHA256, then refreshes `hammersteam.so` from
`valveoff-1.5/bin/`.

```bash
VALVEOFF_BUNDLE_URL=https://example.com/valveoff-bundle.tar.gz \
  curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/install | bash
```

---

## ValveOFF 1.4 (unchanged on `main`)

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/install | bash
```

Hammer update for 1.4:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/update-hammer.sh | bash
```

---

# hammerdeckydowngrade — branch `valveoff-1.5`

**Public distribution repo only** — binaries, config, install scripts, and Steam
downgrade cache. No application source code lives on this branch.

Repository: [dvahana2424-web/hammerdeckydowngrade](https://github.com/dvahana2424-web/hammerdeckydowngrade)

## Contents (1.5)

- **hammersteam.so** — Hammer **1.1.11** zipball-fallback (local depotcache → monzik CDN; includes 1.1.10 manifest pin)
- **library-inject.so** — small audit helper that loads hammersteam.so
- **config.yaml** — zipball + manifest-pin keys for Steam build `1788652215`
- **ValveOFF 1.5** — obfuscated binary with manifest pin UI

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

Same script as `main` — shared `steam-cache/`:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/downgrade-steam | bash
```
