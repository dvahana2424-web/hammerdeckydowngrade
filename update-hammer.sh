#!/usr/bin/env bash
# update-hammer.sh — Hammer 1.1.21 for Steam Deck Stable 1794424036.
# Downloads hammersteam.so, library-inject.so, config.yaml from this branch
# and forces the 32-bit ubuntu12_32 client (steamrt64 opt-out).
#
# One-paste update (close Steam first):
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/update-hammer.sh | bash
#
# Keep your local config.yaml (only update the .so files):
#   KEEP_CONFIG=1 curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/update-hammer.sh | bash
#
# Older Steam builds — do not use this script:
#   steam-1791918634 / steam-1792618285 / valveoff-1.5
#
set -euo pipefail

REPO_OWNER="dvahana2424-web"
REPO_NAME="hammerdeckydowngrade"
BRANCH="steam-1794424036"
BASE_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"
EXPECTED_HAMMER_MD5="8b36458d4a8975e844d61efc13c3b4d4"
EXPECTED_INJECT_MD5="fc644f3120d401fefef2d1764f8fa4cd"

HAMMER_DIR="${HAMMER_DIR:-$HOME/.local/share/Hammer}"

resolve_hammer_config_dir() {
	if [ -n "${HAMMER_CONFIG_DIR:-}" ]; then
		echo "$HAMMER_CONFIG_DIR"
		return 0
	fi
	if [ -n "${XDG_CONFIG_HOME:-}" ]; then
		echo "${XDG_CONFIG_HOME}/hammersteam"
		return 0
	fi
	echo "${HOME}/.config/hammersteam"
}

CONFIG_DIR="${CONFIG_DIR:-$(resolve_hammer_config_dir)}"
CONFIG_FILE="$CONFIG_DIR/config.yaml"

HAMMER_SO="$HAMMER_DIR/hammersteam.so"
INJECT_SO="$HAMMER_DIR/library-inject.so"

if [[ -t 1 ]]; then
	C_RST=$'\033[0m'; C_BOLD=$'\033[1m'
	C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_CYN=$'\033[36m'
else
	C_RST=; C_BOLD=; C_GRN=; C_YEL=; C_RED=; C_CYN=
fi

info()  { printf '%b\n' "${C_CYN}[hammer-update]${C_RST} $*"; }
ok()    { printf '%b\n' "${C_GRN}[hammer-update]${C_RST} $*"; }
warn()  { printf '%b\n' "${C_YEL}[hammer-update]${C_RST} $*"; }
err()   { printf '%b\n' "${C_RED}[hammer-update]${C_RST} $*" >&2; }

die() { err "$@"; exit 1; }

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

download() {
	local url="$1" dest="$2"
	info "Downloading $(basename "$dest") …"
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$dest" "$url"
	else
		die "Need curl or wget to download files."
	fi
	[[ -s "$dest" ]] || die "Download failed or empty: $url"
}

file_md5() {
	md5sum "$1" 2>/dev/null | awk '{print $1}'
}

steam_running() {
	pgrep -x steam >/dev/null 2>&1 \
		|| pgrep -x steamwebhelper >/dev/null 2>&1 \
		|| pgrep -f '[s]team -srt' >/dev/null 2>&1
}

force_ubuntu12_client() {
	local steam_dir wrote=0
	info "Opting out of steamrt64 (1794424036 defaults to ELF64 SteamRT3) …"
	for steam_dir in \
		"$HOME/.local/share/Steam" \
		"$HOME/.steam/steam" \
		"$HOME/.steam/root" \
		"$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam" \
		"$HOME/.var/app/com.valvesoftware.Steam/.steam/steam"; do
		[ -d "$steam_dir" ] || continue
		: > "$steam_dir/.steam-disable-steamrt64-client"
		ok "Forced ubuntu12_32 → $steam_dir/.steam-disable-steamrt64-client"
		wrote=1
	done
	if [ "$wrote" = 0 ]; then
		mkdir -p "$HOME/.local/share/Steam"
		: > "$HOME/.local/share/Steam/.steam-disable-steamrt64-client"
		ok "Forced ubuntu12_32 → $HOME/.local/share/Steam/.steam-disable-steamrt64-client"
	fi
	info "Equivalent flag: STEAM_FORCE_CLIENT=ubuntu12_32"
}

main() {
	need_cmd mkdir
	need_cmd chmod
	need_cmd cp
	need_cmd date

	info "Hammer 1.1.21 update from ${BASE_URL}"
	info "Target Steam: Deck Stable 1794424036 (32-bit ubuntu12_32 client)"

	if steam_running; then
		warn "Steam appears to be running."
		warn "Close Steam first (Exit Steam), then run this script again."
		warn "Continuing anyway in 5 seconds — Ctrl+C to cancel …"
		sleep 5
	fi

	local tmp
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/hammer-update.XXXXXX")"
	trap 'rm -rf "$tmp"' EXIT

	download "${BASE_URL}/bin/hammersteam.so"   "$tmp/hammersteam.so"
	download "${BASE_URL}/bin/library-inject.so" "$tmp/library-inject.so"
	download "${BASE_URL}/config/config.yaml"   "$tmp/config.yaml"

	[[ "$(wc -c < "$tmp/hammersteam.so")" -gt 1000000 ]] \
		|| die "hammersteam.so looks too small — aborting."
	file "$tmp/hammersteam.so" 2>/dev/null | grep -q 'ELF 32-bit' \
		|| die "hammersteam.so is not ELF32 — refusing to install (steamrt64 ELF64 Hammer is not the user path)."

	local got
	got="$(file_md5 "$tmp/hammersteam.so")"
	[[ "$got" = "$EXPECTED_HAMMER_MD5" ]] \
		|| die "hammersteam.so MD5 $got != $EXPECTED_HAMMER_MD5 — aborting."
	got="$(file_md5 "$tmp/library-inject.so")"
	[[ "$got" = "$EXPECTED_INJECT_MD5" ]] \
		|| die "library-inject.so MD5 $got != $EXPECTED_INJECT_MD5 — aborting."

	local stamp backup_dir
	stamp="$(date +%Y%m%d-%H%M%S)"
	backup_dir="$CONFIG_DIR/backups/update-$stamp"
	mkdir -p "$HAMMER_DIR" "$CONFIG_DIR" "$backup_dir"

	for f in "$HAMMER_SO" "$INJECT_SO"; do
		if [[ -f "$f" ]]; then
			cp -a "$f" "$backup_dir/"
			info "Backed up $(basename "$f") → $backup_dir/"
		fi
	done

	cp -f "$tmp/hammersteam.so"   "$HAMMER_SO"
	cp -f "$tmp/library-inject.so" "$INJECT_SO"
	chmod 0755 "$HAMMER_SO" "$INJECT_SO"

	ok "Installed:"
	ok "  $HAMMER_SO  (ELF32 MD5 $EXPECTED_HAMMER_MD5)"
	ok "  $INJECT_SO"

	if [[ -f "$CONFIG_FILE" ]] && [[ "${KEEP_CONFIG:-0}" = "1" ]]; then
		warn "KEEP_CONFIG=1 — leaving your existing config.yaml untouched."
	else
		if [[ -f "$CONFIG_FILE" ]]; then
			cp -a "$CONFIG_FILE" "$backup_dir/"
			info "Backed up config.yaml → $backup_dir/"
		fi
		cp -f "$tmp/config.yaml" "$CONFIG_FILE"
		chmod 0644 "$CONFIG_FILE"
		ok "  $CONFIG_FILE"
	fi
	ok "Backups: $backup_dir"

	force_ubuntu12_client

	if download "${BASE_URL}/VERSION.txt" "$tmp/VERSION.txt" 2>/dev/null; then
		info "Package version:"
		cat "$tmp/VERSION.txt"
	fi

	echo
	ok "Done. Restart Steam. Confirm ~/.Hammer.log has ubuntu12_32/steamclient.so loaded."
}

main "$@"
