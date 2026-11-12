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
7. Overlays `hammersteam.so` (MD5 `70ea62414ba675cf624f9d4702140a19`,
   LaunchApp-only VFT for Steamless), `library-inject.so`, and the
   1794424036 `config.yaml` with verified RunIPCFrame pattern
   `e8 ? ? ? ? 81 c6 ? ? ? ? 53 81 ec 80 07 00 00` (@ `0x0170d350`).

Shipped config keeps ownership + GetManifest + manifest pin **on**, enables
Steamless via `IClientAppManager::RunIPCFrame`, and skips hooks that
SIGSEGV this client (`AutoRediscoverPatterns`, `IClientUtils::RunIPCFrame`,
protobuf `InitFromPacket`/`Send`, other RunIPCFrame families).

## One-time finishing step

1. Launch Steam in Desktop Mode. Confirm Settings → Version is **1794424036**.
2. Confirm `~/.Hammer.log` has `ubuntu12_32/steamclient.so loaded`.
3. Run ValveOFF once to activate your license:
   `~/Downloads/ValveOFF 1.5/ValveOFF`
4. Game Mode → quick-access (•••) → **Hammer Library**.

## Quick Hammer update only (SO + config — for testers)

Close Steam first, then paste:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/update-hammer.sh | bash
```

That installs:
- `~/.local/share/Hammer/hammersteam.so` — LaunchApp-only (Steamless-safe)
- `~/.config/hammersteam/config.yaml` — RunIPCFrame unique pattern enabled
- steamrt64 opt-out sentinel

Keep your local config (`.so` files only — not recommended for Steamless test):

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
