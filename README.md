# Steam Deck Stable 1794424036 — one-paste install

Works on **SteamOS (Steam Deck)**, **Bazzite**, and most other Linux distros.

This branch pins Hammer **1.1.21** for Steam client build **1794424036**
(Steam Deck Stable). It still downloads the ValveOFF 1.5 bundle (Decky,
hammer-decky, unlock scripts), then replaces `hammersteam.so`,
`library-inject.so`, and `config.yaml` with the copies on this branch.

1794424036 defaults to the **64-bit** SteamRT3 client (`steamrt64/steam`).
ELF32 Hammer is ignored there (`ELFCLASS32`). This installer opts out of
that client so the working 32-bit path is used:

```text
touch ~/.local/share/Steam/.steam-disable-steamrt64-client
# equivalent: STEAM_FORCE_CLIENT=ubuntu12_32
```

It does **not** downgrade Steam and does **not** write `steam.cfg`.

Older commands are unchanged:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/bootstrap | bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1791918634/bootstrap | bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1792618285/bootstrap | bash
```

## Install (Steam 1794424036)

Open **Konsole** in Desktop Mode (as your normal user, *not* root) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/bootstrap | bash
```

You will be asked for your **sudo password once**. Everything else is automatic.

## What it does

1. Detects your host (SteamOS / Bazzite / generic Linux).
2. Cleans old OneTap / SLSsteam unlocks if present (re-enables Steam auto-update).
3. Writes `.steam-disable-steamrt64-client` so Steam uses `ubuntu12_32/steam`.
4. Downloads the ValveOFF 1.5 bundle into `~/Downloads/ValveOFF 1.5/`.
5. Installs Decky Loader if missing, then Hammer + ValveOFF + hammer-decky.
6. Wires Desktop-Mode and Game-Mode `LD_AUDIT` (Hammer **should** load on this build).
7. Overlays `hammersteam.so` (MD5 `8b36458d4a8975e844d61efc13c3b4d4`),
   `library-inject.so`, and the 1794424036 `config.yaml`.

Shipped config keeps ownership + GetManifest + manifest pin **on**, and
skips hooks that SIGSEGV this client (`AutoRediscoverPatterns`,
`IClientUtils::RunIPCFrame`, protobuf `InitFromPacket`/`Send`).

## One-time finishing step

1. Launch Steam in Desktop Mode. Confirm Settings → Version is **1794424036**.
2. Confirm `~/.Hammer.log` has `ubuntu12_32/steamclient.so loaded`.
3. Run ValveOFF once to activate your license:
   `~/Downloads/ValveOFF 1.5/ValveOFF`
4. Game Mode → quick-access (•••) → **Hammer Library**.

## Quick Hammer update only

Close Steam first, then paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/update-hammer.sh | bash
```

Keep your local config (`.so` files only):

```bash
KEEP_CONFIG=1 curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/update-hammer.sh | bash
```

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/uninstall | bash
```

To go back to the 64-bit SteamRT3 client later:

```bash
STEAM_FORCE_CLIENT=steamrt64 steam
# or: rm ~/.local/share/Steam/.steam-disable-steamrt64-client
```
