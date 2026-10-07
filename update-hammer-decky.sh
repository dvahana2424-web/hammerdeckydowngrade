#!/usr/bin/env bash
# update-hammer-decky.sh — install hammer-decky 0.9.24 from valveoff-1.5 branch.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff-1.5/update-hammer-decky.sh | bash
#
set -euo pipefail

REPO="dvahana2424-web/hammerdeckydowngrade"
BRANCH="${VALVEOFF_BRANCH:-valveoff-1.5}"
HAMMER_DECKY_PKG="${HAMMER_DECKY_PKG:-hammer-decky-0.9.24.tar.gz}"
HAMMER_DECKY_PKG_URL="${HAMMER_DECKY_PKG_URL:-https://raw.githubusercontent.com/dvahana2424-web/hamdeck/hammer-1.1.17/hammer-decky/${HAMMER_DECKY_PKG}}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
PLUGIN_DST="${HOME}/homebrew/plugins/hammer-decky"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[ERR] need $1" >&2; exit 1; }; }
need curl
need tar
need mkdir

TMP="$(mktemp -d "${TMPDIR:-/tmp}/hammer-decky-update.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "[..] Downloading ${HAMMER_DECKY_PKG} …"
curl -fsSL --retry 3 --retry-delay 2 \
	-o "${TMP}/${HAMMER_DECKY_PKG}" "${HAMMER_DECKY_PKG_URL}"

echo "[..] Extracting …"
tar -xzf "${TMP}/${HAMMER_DECKY_PKG}" -C "$TMP"
SRC="${TMP}/hammer-decky"
if [ ! -f "${SRC}/dist/index.js" ] || [ ! -f "${SRC}/plugin.json" ]; then
	echo "[ERR] hammer-decky missing in ${HAMMER_DECKY_PKG}." >&2
	exit 1
fi

if grep -q 'React\.createElement' "${SRC}/dist/index.js" 2>/dev/null; then
	echo "[ERR] dist uses React.createElement (broken on Decky 3.x)." >&2
	exit 1
fi

chmod 0755 "${SRC}/main.py" 2>/dev/null || true

echo "[..] Installing to ${PLUGIN_DST} …"
if [ -d "${PLUGIN_DST}" ] && [ ! -w "${PLUGIN_DST}" ]; then
	sudo rm -rf "${PLUGIN_DST}"
	sudo mkdir -p "${PLUGIN_DST}"
	sudo cp -a "${SRC}/." "${PLUGIN_DST}/"
	sudo chown -R "$(id -un):$(id -gn)" "${PLUGIN_DST}"
else
	mkdir -p "${PLUGIN_DST}"
	rm -rf "${PLUGIN_DST:?}/"*
	cp -a "${SRC}/." "${PLUGIN_DST}/"
fi

if systemctl is-active plugin_loader >/dev/null 2>&1; then
	sudo systemctl restart plugin_loader && echo "[OK] plugin_loader restarted."
else
	echo "[WARN] plugin_loader not running — restart Steam or run: sudo systemctl restart plugin_loader"
fi

echo "[OK] hammer-decky updated (0.9.24). Game Mode → ⋯ → Hammer Library."
