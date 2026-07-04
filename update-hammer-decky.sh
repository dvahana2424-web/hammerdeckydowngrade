#!/usr/bin/env bash
# update-hammer-decky.sh — install hammer-decky from the split ValveOFF bundle.
# This public repo does NOT host plugin source and has NO GitHub Release — the
# compiled bundle lives as split raw files on `main` (legacy `bundle-linux` may lag).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/update-hammer-decky.sh | bash
#
set -euo pipefail

REPO="dvahana2424-web/hammerdeckydowngrade"
BUNDLE_BRANCH="${VALVEOFF_BUNDLE_BRANCH:-main}"
BUNDLE_FILE="valveoff-bundle.tar.gz"
BUNDLE_RAW_BASE="${VALVEOFF_BUNDLE_RAW_BASE:-https://raw.githubusercontent.com/${REPO}/${BUNDLE_BRANCH}}"
BUNDLE_PARTS="${VALVEOFF_BUNDLE_PARTS:-00 01}"
BUNDLE_URL="${VALVEOFF_BUNDLE_URL:-}"
BUNDLE_DIRNAME="ValveOFF 1.4"
PLUGIN_DST="${HOME}/homebrew/plugins/hammer-decky"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[ERR] need $1" >&2; exit 1; }; }
need curl
need tar
need mkdir

TMP="$(mktemp -d "${TMPDIR:-/tmp}/hammer-decky-update.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$BUNDLE_URL" ]; then
	echo "[..] Downloading ${BUNDLE_FILE} from ${BUNDLE_URL} …"
	if ! curl -fL --retry 3 --retry-delay 2 -o "${TMP}/${BUNDLE_FILE}" "$BUNDLE_URL"; then
		echo "[ERR] Failed to download bundle: ${BUNDLE_URL}" >&2
		exit 1
	fi
else
	echo "[..] Downloading split bundle from ${BUNDLE_RAW_BASE} (parts: ${BUNDLE_PARTS}) …"
	: > "${TMP}/${BUNDLE_FILE}"
	for part in $BUNDLE_PARTS; do
		url="${BUNDLE_RAW_BASE}/${BUNDLE_FILE}.${part}.part"
		echo "[..]   part ${part} …"
		if ! curl -fL --retry 3 --retry-delay 2 "$url" >> "${TMP}/${BUNDLE_FILE}"; then
			echo "[ERR] Failed to download part ${part}: ${url}" >&2
			exit 1
		fi
	done
	want="$(curl -fsSL "${BUNDLE_RAW_BASE}/${BUNDLE_FILE}.sha256" 2>/dev/null | awk '{print $1}' | head -1 || true)"
	if [ -n "$want" ] && command -v sha256sum >/dev/null 2>&1; then
		got="$(sha256sum "${TMP}/${BUNDLE_FILE}" | awk '{print $1}')"
		[ "$want" = "$got" ] || { echo "[ERR] Checksum mismatch (want $want got $got)." >&2; exit 1; }
		echo "[OK] Checksum verified."
	fi
fi

echo "[..] Extracting hammer-decky from bundle …"
tar -xzf "${TMP}/${BUNDLE_FILE}" -C "$TMP" "${BUNDLE_DIRNAME}/hammer-decky"

SRC="${TMP}/${BUNDLE_DIRNAME}/hammer-decky"
if [ ! -f "${SRC}/dist/index.js" ] || [ ! -f "${SRC}/plugin.json" ]; then
	echo "[ERR] hammer-decky missing in bundle." >&2
	exit 1
fi

if grep -q 'React\.createElement' "${SRC}/dist/index.js" 2>/dev/null; then
	echo "[ERR] Bundle hammer-decky dist uses React.createElement (broken on Decky 3.x)." >&2
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

echo "[OK] hammer-decky updated from bundle. Open Game Mode → ⋯ → Hammer Library."
