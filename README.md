# Steam Deck Stable 1794424036 — steamrt64 one-paste install

Works on **SteamOS (Steam Deck)**, **Bazzite**, and most other Linux distros.

This branch installs the **ELF64** Hammer libraries for the **steamrt64** client
on Steam build **1794424036**. The one-paste command downloads the stripped
ValveOFF 1.5 folder hosted on this same branch (ELF64 libraries, config, and
the current hammer-decky, with no plugin source).

1794424036 defaults to steamrt64. An empty file named
`.steam-disable-steamrt64-client` forces the 32-bit client, and ELF64 Hammer
cannot load there. This installer **deletes** that file.

It does **not** downgrade Steam and does **not** write `steam.cfg`.

Older commands are unchanged. The 32-bit command still writes the sentinel:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/bootstrap | bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/bootstrap | bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1791918634/bootstrap | bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1792618285/bootstrap | bash
```

## Install (steamrt64, Steam 1794424036)

Open **Konsole** in Desktop Mode (as your normal user, *not* root) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/bootstrap | bash
```

You will be asked for your **sudo password once**. Everything else is automatic.

## What it does

1. Detects your host (SteamOS / Bazzite / generic Linux).
2. Cleans old OneTap / SLSsteam unlocks if present (re-enables Steam auto-update).
3. Deletes `.steam-disable-steamrt64-client` under `~/.local/share/Steam`,
   `~/.steam/root`, and `~/.steam/steam` so steamrt64 can start.
4. Downloads the ValveOFF 1.5 bundle into `~/Downloads/ValveOFF 1.5/`.
5. Installs Decky Loader if missing, then Hammer + ValveOFF + hammer-decky.
6. Wires Desktop-Mode and Game-Mode `LD_AUDIT`.
7. Overlays ELF64 `hammersteam.so` (MD5 `3677322f2ef2597ef16673f3b1614c98`),
   ELF64 `library-inject.so` (MD5 `cae5920ce4b55a334646da078baa6fa4`), and the
   working 1794424036 `config.yaml`
   (`GetManifestRequestCodeOffset` `0x13a5840`,
   `UserOwnsDepotOffset` `0x18eb1a0`,
   `BuildDepotDependencyOffset` `0x1079640`).

## One-time finishing step

1. Launch Steam in Desktop Mode. Confirm Settings → Version is **1794424036**.
2. Confirm `~/.Hammer.log` has `steamrt64/steamclient.so loaded`.
3. Run ValveOFF once to activate your license:
   `~/Downloads/ValveOFF 1.5/ValveOFF`
4. Game Mode → quick-access (•••) → **Hammer Library**.

If `steamrt64/steam` is missing, launch Steam once and let the client update
finish, then launch it again.

## Quick Hammer update only (SO + config)

Close Steam first, then paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/update-hammer.sh | bash
```

That installs:

- `~/.local/share/Hammer/hammersteam.so` — ELF64
- `~/.local/share/Hammer/library-inject.so` — ELF64
- `~/.config/hammersteam/config.yaml` — steamrt64 offsets for 1794424036
- removes `.steam-disable-steamrt64-client` if it is present

Keep your local config (`.so` files only):

```bash
KEEP_CONFIG=1 curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/update-hammer.sh | bash
```

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/uninstall | bash
```
