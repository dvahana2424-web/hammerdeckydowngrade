#!/usr/bin/env bash
# update-hammer-decky.sh — download latest hammer-decky from main and install.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/update-hammer-decky.sh | bash
#
set -euo pipefail

REPO="dvahana2424-web/hammerdeckydowngrade"
BRANCH="main"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
PLUGIN_DST="${HOME}/homebrew/plugins/hammer-decky"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[ERR] need $1" >&2; exit 1; }; }
need curl
need mkdir

TMP="$(mktemp -d "${TMPDIR:-/tmp}/hammer-decky-update.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "[..] Downloading hammer-decky from ${BASE}/hammer-decky/ …"
for f in main.py plugin.json package.json README.md; do
	curl -fsSL "${BASE}/hammer-decky/${f}" -o "${TMP}/${f}"
done
mkdir -p "${TMP}/dist"
curl -fsSL "${BASE}/hammer-decky/dist/index.js" -o "${TMP}/dist/index.js"
curl -fsSL "${BASE}/hammer-decky/dist/index.js.map" -o "${TMP}/dist/index.js.map" 2>/dev/null || true

chmod 0755 "${TMP}/main.py"

if [ ! -f "${TMP}/dist/index.js" ] || [ ! -f "${TMP}/plugin.json" ]; then
	echo "[ERR] Download incomplete." >&2
	exit 1
fi

if grep -q 'React\.createElement' "${TMP}/dist/index.js" 2>/dev/null; then
	echo "[ERR] Downloaded dist uses React.createElement (broken on Decky 3.x)." >&2
	echo "      Wait for v0.9.13+ on main or report upstream." >&2
	exit 1
fi

echo "[..] Installing to ${PLUGIN_DST} …"
if [ -d "${PLUGIN_DST}" ] && [ ! -w "${PLUGIN_DST}" ]; then
	sudo rm -rf "${PLUGIN_DST}"
	sudo mkdir -p "${PLUGIN_DST}"
	sudo cp -a "${TMP}/." "${PLUGIN_DST}/"
	sudo chown -R "$(id -un):$(id -gn)" "${PLUGIN_DST}"
else
	mkdir -p "${PLUGIN_DST}"
	rm -rf "${PLUGIN_DST:?}/"*
	cp -a "${TMP}/." "${PLUGIN_DST}/"
fi

if systemctl is-active plugin_loader >/dev/null 2>&1; then
	sudo systemctl restart plugin_loader && echo "[OK] plugin_loader restarted."
else
	echo "[WARN] plugin_loader not running — restart Steam or run: sudo systemctl restart plugin_loader"
fi

echo "[OK] hammer-decky updated. Open Game Mode → ⋯ → Hammer Library."
