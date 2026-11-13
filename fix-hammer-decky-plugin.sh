#!/usr/bin/env bash
# Fixes Decky "Unexpected token 'export'" by installing package.json
# with "type": "module". Without that, Decky evals dist/index.js.
#
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/fix-hammer-decky-plugin.sh | bash
#
set -euo pipefail

PLUGIN_DST="${HOME}/homebrew/plugins/hammer-decky"
BUNDLE="${VALVEOFF_BUNDLE_DIR:-$HOME/Downloads/ValveOFF 1.5}/hammer-decky"

write_pkg() {
	local dest="$1"
	cat > "$dest" <<'EOF'
{
  "name": "hammer-decky",
  "version": "0.9.24",
  "type": "module"
}
EOF
}

if [ ! -f "${PLUGIN_DST}/dist/index.js" ] && [ ! -f "${BUNDLE}/dist/index.js" ]; then
	echo "[ERR] No hammer-decky dist/index.js in ${PLUGIN_DST} or ${BUNDLE}." >&2
	exit 1
fi

run() {
	if [ -w "${PLUGIN_DST}" ]; then
		"$@"
	else
		sudo "$@"
	fi
}

if [ ! -w "${PLUGIN_DST}" ]; then
	echo "[..] ${PLUGIN_DST} is root-owned — sudo once."
	sudo -v
fi

if [ ! -f "${PLUGIN_DST}/dist/index.js" ] && [ -f "${BUNDLE}/dist/index.js" ]; then
	run mkdir -p "${PLUGIN_DST}/dist"
	run cp -f "${BUNDLE}/main.py" "${BUNDLE}/plugin.json" "${PLUGIN_DST}/"
	run cp -f "${BUNDLE}/dist/index.js" "${PLUGIN_DST}/dist/"
	run chmod 0755 "${PLUGIN_DST}/main.py"
fi

tmp="$(mktemp)"
write_pkg "$tmp"
run cp -f "$tmp" "${PLUGIN_DST}/package.json"
rm -f "$tmp"
run chmod 0644 "${PLUGIN_DST}/package.json"

echo "[OK] ${PLUGIN_DST}/package.json is type=module"
if systemctl is-active plugin_loader >/dev/null 2>&1; then
	sudo systemctl restart plugin_loader && echo "[OK] plugin_loader restarted" \
		|| echo "[WARN] Run: sudo systemctl restart plugin_loader"
fi
echo "[..] Fully quit Steam, then open it again (Desktop and Game Mode)."
