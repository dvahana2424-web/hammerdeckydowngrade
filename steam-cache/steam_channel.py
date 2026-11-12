"""Detect the live Steam client channel (Steam Deck steamrt64 vs legacy ubuntu12)."""
from __future__ import annotations

import re
from pathlib import Path

MANIFEST_CANDIDATES = (
    "steam_client_steamdeck_stable_steamrt64",
    "steam_client_steamdeck_publicbeta_steamrt64",
    "steam_client_steamdeck_stable_ubuntu12",
    "steam_client_steamdeck_publicbeta_ubuntu12",
    "steam_client_ubuntu12",
    "steam_client_publicbeta_ubuntu12",
)

LOCAL_TO_UPSTREAM = {
    "steam_client_steamdeck_stable_ubuntu12": "steam_client_ubuntu12",
    "steam_client_steamdeck_publicbeta_ubuntu12": "steam_client_publicbeta_ubuntu12",
    "steam_client_ubuntu12": "steam_client_ubuntu12",
    "steam_client_publicbeta_ubuntu12": "steam_client_publicbeta_ubuntu12",
}


def pick_active_channel(pkg_dir: Path) -> str | None:
    """Channel with the newest .installed or .manifest (matches Steam UI build)."""
    best_name: str | None = None
    best_mtime = -1.0
    for name in MANIFEST_CANDIDATES:
        for suffix in (".installed", ".manifest"):
            path = pkg_dir / f"{name}{suffix}"
            if not path.exists():
                continue
            mtime = path.stat().st_mtime
            if mtime > best_mtime:
                best_mtime = mtime
                best_name = name
            break
    return best_name


def read_channel_version(pkg_dir: Path, channel: str) -> str | None:
    manifest = pkg_dir / f"{channel}.manifest"
    if not manifest.exists():
        return None
    try:
        txt = manifest.read_text(errors="ignore")
    except OSError:
        return None
    m = re.search(r'"version"\s*"(\d+)"', txt)
    return m.group(1) if m else None


def downgrade_manifest_name(active: str | None) -> str:
    """Headcrab pins ubuntu12 manifests; map steamrt64 installs to that stack."""
    if not active:
        return "steam_client_steamdeck_stable_ubuntu12"
    if active.endswith("_steamrt64"):
        if "steamdeck_stable" in active:
            return "steam_client_steamdeck_stable_ubuntu12"
        if "steamdeck_publicbeta" in active:
            return "steam_client_steamdeck_publicbeta_ubuntu12"
        if "publicbeta" in active:
            return "steam_client_publicbeta_ubuntu12"
        return "steam_client_ubuntu12"
    return active
