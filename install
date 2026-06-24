#!/usr/bin/env bash
# update-hammer.sh — download latest Hammer binaries + config from GitHub
# and install them to the standard Hammer paths on Steam Deck / Linux.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/main/update-hammer.sh | bash
#   # or after cloning:
#   ./update-hammer.sh
#
set -euo pipefail

REPO_OWNER="dvahana2424-web"
REPO_NAME="hammerdeckydowngrade"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"

HAMMER_DIR="${HAMMER_DIR:-$HOME/.local/share/Hammer}"
CONFIG_DIR="${CONFIG_DIR:-$HOME/.config/hammersteam}"
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

steam_running() {
	pgrep -x steam >/dev/null 2>&1 \
		|| pgrep -x steamwebhelper >/dev/null 2>&1 \
		|| pgrep -f '[s]team -srt' >/dev/null 2>&1
}

main() {
	need_cmd mkdir
	need_cmd chmod
	need_cmd cp
	need_cmd date

	info "Hammer update from ${BASE_URL}"

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

	# Basic sanity checks
	[[ "$(wc -c < "$tmp/hammersteam.so")" -gt 1000000 ]] \
		|| die "hammersteam.so looks too small — aborting."
	file "$tmp/hammersteam.so" 2>/dev/null | grep -qi 'ELF' \
		|| die "hammersteam.so is not an ELF file — aborting."

	local stamp backup_dir
	stamp="$(date +%Y%m%d-%H%M%S)"
	backup_dir="$CONFIG_DIR/backups/update-$stamp"
	mkdir -p "$HAMMER_DIR" "$CONFIG_DIR" "$backup_dir"

	for f in "$HAMMER_SO" "$INJECT_SO" "$CONFIG_FILE"; do
		if [[ -f "$f" ]]; then
			cp -a "$f" "$backup_dir/"
			info "Backed up $(basename "$f") → $backup_dir/"
		fi
	done

	cp -f "$tmp/hammersteam.so"   "$HAMMER_SO"
	cp -f "$tmp/library-inject.so" "$INJECT_SO"
	cp -f "$tmp/config.yaml"      "$CONFIG_FILE"
	chmod 0755 "$HAMMER_SO" "$INJECT_SO"
	chmod 0644 "$CONFIG_FILE"

	ok "Installed:"
	ok "  $HAMMER_SO"
	ok "  $INJECT_SO"
	ok "  $CONFIG_FILE"
	ok "Backups: $backup_dir"

	if download "${BASE_URL}/VERSION.txt" "$tmp/VERSION.txt" 2>/dev/null; then
		info "Package version:"
		cat "$tmp/VERSION.txt"
	fi

	echo
	ok "Done. Restart Steam to load the new hammersteam.so."
}

main "$@"
