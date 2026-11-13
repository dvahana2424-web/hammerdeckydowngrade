#!/usr/bin/env bash
# Reinstall hammer-decky runtime only (fixes Decky "Unexpected token 'export'").
#
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/fix-hammer-decky-plugin.sh | bash
#
set -euo pipefail

PLUGIN_DST="${HOME}/homebrew/plugins/hammer-decky"
BUNDLE="${VALVEOFF_BUNDLE_DIR:-$HOME/Downloads/ValveOFF 1.5}/hammer-decky"

dist_ok() {
	local f="$1"
	head -1 "$f" | grep -q '^const manifest =' || return 1
	! head -20 "$f" | grep -qE '^(import |export default )'
}

if [ ! -f "${BUNDLE}/dist/index.js" ]; then
	echo "[ERR] Missing ${BUNDLE}/dist/index.js — run the steamrt64 bootstrap first." >&2
	exit 1
fi
if ! dist_ok "${BUNDLE}/dist/index.js"; then
	echo "[ERR] Bundle dist/index.js does not look like a compiled Decky build." >&2
	exit 1
fi

install_runtime() {
	cp -f "${BUNDLE}/main.py" "${BUNDLE}/plugin.json" "${PLUGIN_DST}/"
	cp -f "${BUNDLE}/dist/index.js" "${PLUGIN_DST}/dist/"
	chmod 0755 "${PLUGIN_DST}/main.py"
	rm -rf "${PLUGIN_DST}/src" "${PLUGIN_DST}/node_modules" 2>/dev/null || true
	rm -f "${PLUGIN_DST}/package.json" "${PLUGIN_DST}/rollup.config.js" \
		"${PLUGIN_DST}/dist/index.js.map" 2>/dev/null || true
}

if [ -d "${PLUGIN_DST}" ] && [ ! -w "${PLUGIN_DST}" ]; then
	echo "[..] ${PLUGIN_DST} is not writable — using sudo (Decky default on SteamOS)."
	if ! sudo -v; then
		echo "[ERR] sudo required to refresh hammer-decky under ${PLUGIN_DST}" >&2
		exit 1
	fi
	sudo rm -rf "${PLUGIN_DST}"
	sudo mkdir -p "${PLUGIN_DST}/dist"
	sudo cp -f "${BUNDLE}/main.py" "${BUNDLE}/plugin.json" "${PLUGIN_DST}/"
	sudo cp -f "${BUNDLE}/dist/index.js" "${PLUGIN_DST}/dist/"
	sudo chmod 0755 "${PLUGIN_DST}/main.py"
	sudo chown -R "$(id -un):$(id -gn)" "${PLUGIN_DST}"
	sudo rm -rf "${PLUGIN_DST}/src" "${PLUGIN_DST}/node_modules" 2>/dev/null || true
	sudo rm -f "${PLUGIN_DST}/package.json" "${PLUGIN_DST}/rollup.config.js" \
		"${PLUGIN_DST}/dist/index.js.map" 2>/dev/null || true
else
	mkdir -p "${PLUGIN_DST}/dist"
	rm -rf "${PLUGIN_DST:?}/"* 2>/dev/null || true
	install_runtime
fi

echo "[OK] hammer-decky runtime installed to ${PLUGIN_DST}"
if systemctl is-active plugin_loader >/dev/null 2>&1; then
	sudo systemctl restart plugin_loader 2>/dev/null && echo "[OK] plugin_loader restarted" \
		|| echo "[WARN] Restart manually: sudo systemctl restart plugin_loader"
fi
echo "[..] Restart Steam (Desktop + Game Mode) so the QAM UI reloads."
