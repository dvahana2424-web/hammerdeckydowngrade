#!/usr/bin/env python3
"""Stage a Steam client build into ~/.cache/hammer-downgrader/ (download only).

Used by headcrab-downgrade-only — no SLSsteam, no steam.sh patching.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HOME = Path(os.environ["HOME"])
NATIVE_STEAM_DIR = HOME / ".steam" / "steam"
FLATPAK_STEAM_DIR = HOME / ".var" / "app" / "com.valvesoftware.Steam" / ".steam" / "steam"
CACHE_ROOT = HOME / ".cache" / "hammer-downgrader"
STEAM_CDN = "http://media.steampowered.com/client/"
ST_REPO_RAW = "https://raw.githubusercontent.com/SteamTracking/SteamTracking"

LOCAL_TO_UPSTREAM = {
    "steam_client_steamdeck_stable_ubuntu12": "steam_client_ubuntu12",
    "steam_client_steamdeck_publicbeta_ubuntu12": "steam_client_publicbeta_ubuntu12",
    "steam_client_ubuntu12": "steam_client_ubuntu12",
    "steam_client_publicbeta_ubuntu12": "steam_client_publicbeta_ubuntu12",
}

MANIFEST_CANDIDATES = (
    "steam_client_steamdeck_stable_ubuntu12",
    "steam_client_steamdeck_publicbeta_ubuntu12",
    "steam_client_ubuntu12",
    "steam_client_publicbeta_ubuntu12",
)


def info(msg: str) -> None:
    print(f"[stage] {msg}", file=sys.stderr, flush=True)


def err(msg: str) -> None:
    print(f"[stage] ERROR: {msg}", file=sys.stderr, flush=True)


def detect_steam() -> dict:
    if NATIVE_STEAM_DIR.is_dir():
        steam_dir, flavour = NATIVE_STEAM_DIR, "native"
    elif FLATPAK_STEAM_DIR.is_dir():
        steam_dir, flavour = FLATPAK_STEAM_DIR, "flatpak"
    else:
        return {"flavour": None, "steam_dir": None, "manifest_name": None}

    pkg_dir = steam_dir / "package"
    manifest_name = None
    for name in MANIFEST_CANDIDATES:
        if (pkg_dir / f"{name}.manifest").exists() or (pkg_dir / f"{name}.installed").exists():
            manifest_name = name
            break
    if manifest_name is None:
        manifest_name = MANIFEST_CANDIDATES[0]

    return {
        "flavour": flavour,
        "steam_dir": str(steam_dir),
        "manifest_name": manifest_name,
    }


def http_get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "headcrab-downgrade-only/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def manifest_to_urls(manifest_text: str) -> list[str]:
    files = re.findall(r'"file"\s*"([^"]+)"', manifest_text)
    seen, out = set(), []
    for f in files:
        if f not in seen:
            seen.add(f)
            out.append(STEAM_CDN + f)
    return out


def cache_dir_for(manifest_name: str, sha: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", f"{manifest_name}-{sha[:12]}")
    d = CACHE_ROOT / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def download_one(url: str, dest_dir: Path, idx: int, total: int) -> tuple[bool, str]:
    name = url.rsplit("/", 1)[-1]
    out = dest_dir / name
    tmp = dest_dir / (name + ".part")
    if out.exists() and out.stat().st_size > 0:
        info(f"  [{idx}/{total}] cached  {name}")
        return True, name
    info(f"  [{idx}/{total}] start   {name}")
    try:
        data = http_get(url)
        tmp.write_bytes(data)
        tmp.rename(out)
        info(f"  [{idx}/{total}] done    {name}  ({len(data)} bytes)")
        return True, name
    except Exception as e:
        err(f"  [{idx}/{total}] FAILED  {name}  ({e})")
        with __import__("contextlib").suppress(Exception):
            tmp.unlink()
        return False, name


def main() -> int:
    p = argparse.ArgumentParser(description="Stage Steam client packages for downgrade")
    p.add_argument("--version", required=True, help="Target build number, e.g. 1788652215")
    p.add_argument("--sha", required=True, help="SteamTracking git SHA for ClientManifest")
    p.add_argument("--manifest-name", default="", help="Local manifest channel name (auto-detect if empty)")
    p.add_argument("--parallel", type=int, default=4)
    args = p.parse_args()

    steam = detect_steam()
    if not steam["flavour"]:
        err("No Steam install found.")
        return 1

    manifest_name = args.manifest_name or steam["manifest_name"]
    upstream = LOCAL_TO_UPSTREAM.get(manifest_name, manifest_name)
    cache_dir = cache_dir_for(manifest_name, args.sha)

    info(f"Target build: {args.version}")
    info(f"Channel: {manifest_name} (upstream: {upstream})")
    info(f"Cache: {cache_dir}")

    manifest_url = f"{ST_REPO_RAW}/{args.sha}/ClientManifest/{upstream}"
    info(f"Fetching manifest: {manifest_url}")
    try:
        manifest_text = http_get(manifest_url, timeout=60).decode("utf-8", errors="ignore")
    except Exception as e:
        err(f"Manifest download failed: {e}")
        return 1

    m = re.search(r'"version"\s*"(\d+)"', manifest_text)
    if not m:
        err("Could not parse version from manifest")
        return 1
    manifest_version = m.group(1)
    if manifest_version != args.version:
        err(f"Manifest version {manifest_version} != requested {args.version}")
        return 1

    manifest_dst = cache_dir / manifest_name
    manifest_dst.write_text(manifest_text)
    info(f"Wrote {manifest_dst.name}")

    urls = manifest_to_urls(manifest_text)
    if not urls:
        err("No package URLs in manifest")
        return 1
    info(f"Downloading {len(urls)} files (parallel={args.parallel}) …")

    failed = 0
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futs = {
            pool.submit(download_one, u, cache_dir, i + 1, len(urls)): u
            for i, u in enumerate(urls)
        }
        for fut in as_completed(futs):
            ok, _ = fut.result()
            if not ok:
                failed += 1

    if failed:
        err(f"{failed} download(s) failed — re-run to retry cached files")
        return 1

    meta = {
        "manifest_name": manifest_name,
        "upstream": upstream,
        "sha": args.sha,
        "version": args.version,
        "staged_at": dt.datetime.now().isoformat(timespec="seconds"),
        "steam_flavour": steam["flavour"],
        "steam_dir": steam["steam_dir"],
    }
    (cache_dir / ".hammer-stage.json").write_text(json.dumps(meta, indent=2))
    info(f"STAGE OK — cache subdir: {cache_dir.name}")
    print(cache_dir.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
