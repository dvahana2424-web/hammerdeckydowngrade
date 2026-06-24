# hammerdeckydowngrade

Hosted Hammer binaries and config for Steam Deck — one-command update.

Repository: [dvahana2424-web/hammerdeckydowngrade](https://github.com/dvahana2424-web/hammerdeckydowngrade)

## Quick update (Steam Deck / Linux)

Close Steam first, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/update-hammer.sh | bash
```

Or download and run locally:

```bash
curl -fsSL -O https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/update-hammer.sh
chmod +x update-hammer.sh
./update-hammer.sh
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
