#!/usr/bin/env bash
# update-hammer.sh — ELF64 Hammer for Steam Deck Stable 1794424036 steamrt64.
# Downloads hammersteam.so, library-inject.so, and config.yaml from this branch
# and removes .steam-disable-steamrt64-client so the 64-bit client can start.
#
# One-paste update (close Steam first):
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/update-hammer.sh | bash
#
# Keep your local config.yaml (only update the .so files):
#   KEEP_CONFIG=1 curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steamrt64-1794424036/update-hammer.sh | bash
#
# What this build ships:
#   - ELF64 hammersteam.so MD5 5de5a51d3fef752bf00d751c08a77007
#   - ELF64 library-inject.so MD5 cae5920ce4b55a334646da078baa6fa4
#   - config.yaml for steamclient build 1794424036
#       GetManifestRequestCodeOffset 0x13aed60
#       UserOwnsDepotOffset 0x18eb1a0
#       BuildDepotDependencyOffset 0x1079640
#
# The 32-bit command is unchanged. Do not use it for this client:
#   curl -fsSL https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/steam-1794424036/update-hammer.sh | bash
#
set -euo pipefail

REPO_OWNER="dvahana2424-web"
REPO_NAME="hammerdeckydowngrade"
BRANCH="steamrt64-1794424036"
BASE_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"
EXPECTED_HAMMER_MD5="5de5a51d3fef752bf00d751c08a77007"
EXPECTED_INJECT_MD5="cae5920ce4b55a334646da078baa6fa4"

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

# The empty sentinel forces ubuntu12_32. ELF64 Hammer cannot load there.
clear_steamrt64_sentinel() {
	local steam_dir removed=0 sentinel
	info "Looking for .steam-disable-steamrt64-client …"
	for steam_dir in \
		"$HOME/.local/share/Steam" \
		"$HOME/.steam/steam" \
		"$HOME/.steam/root" \
		"$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam" \
		"$HOME/.var/app/com.valvesoftware.Steam/.steam/steam"; do
		[ -d "$steam_dir" ] || continue
		sentinel="$steam_dir/.steam-disable-steamrt64-client"
		if [ -e "$sentinel" ] || [ -L "$sentinel" ]; then
			rm -f -- "$sentinel"
			ok "Removed 32-bit client sentinel: $sentinel"
			removed=1
		fi
	done
	if [ "$removed" = 0 ]; then
		ok "No .steam-disable-steamrt64-client sentinel (steamrt64 stays enabled)"
	fi
	if [ -x "$HOME/.local/share/Steam/steamrt64/steam" ]; then
		ok "steamrt64 client is on disk"
	else
		warn "steamrt64 is not downloaded yet. Launch Steam once and let it update."
	fi
}

verify_config_offsets() {
	local cfg="$1"
	local key
	for key in \
		'GetManifestRequestCodeOffset: 0x13aed60' \
		'UserOwnsDepotOffset: 0x18eb1a0' \
		'BuildDepotDependencyOffset: 0x1079640'
	do
		if grep -q "$key" "$cfg"; then
			ok "config.yaml has $key"
		else
			warn "config.yaml missing $key"
		fi
	done
}

main() {
	need_cmd mkdir
	need_cmd chmod
	need_cmd cp
	need_cmd date

	info "Hammer steamrt64 update from ${BASE_URL}"
	info "Target Steam: Deck Stable 1794424036 (64-bit steamrt64 client)"

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
	file "$tmp/hammersteam.so" 2>/dev/null | grep -q 'ELF 64-bit' \
		|| die "hammersteam.so is not ELF64 — refusing to install."
	file "$tmp/library-inject.so" 2>/dev/null | grep -q 'ELF 64-bit' \
		|| die "library-inject.so is not ELF64 — refusing to install."

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
	ok "  $HAMMER_SO  (ELF64 steamrt64 MD5 $EXPECTED_HAMMER_MD5)"
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
		verify_config_offsets "$CONFIG_FILE"
	fi
	ok "Backups: $backup_dir"

	clear_steamrt64_sentinel

	if download "${BASE_URL}/VERSION.txt" "$tmp/VERSION.txt" 2>/dev/null; then
		info "Package version:"
		cat "$tmp/VERSION.txt"
	fi

	echo
	ok "Done. Restart Steam."
	ok "Confirm ~/.Hammer.log has:"
	ok "  - steamrt64/steamclient.so loaded"
	ok "  - UserOwnsDepot and GetManifest installed"
}

main "$@"
