#!/usr/bin/env python3
"""Download missing zipvz package files for a staged downgrader cache."""
from __future__ import annotations

import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CDN = "http://media.steampowered.com/client/"


def fetch(url: str, dest: Path, retries: int = 5) -> int:
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Valve/Steam HTTP Client 1.0"}
            )
            with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
            return dest.stat().st_size
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"[ensure-zipvz] attempt {attempt} failed for {dest.name}: {e}")
            time.sleep(2 * attempt)
    raise RuntimeError(f"download failed: {url}")


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: ensure-zipvz.py <cache-dir>", file=sys.stderr)
        return 2

    cache_dir = Path(sys.argv[1])
    manifest = cache_dir / "steam_client_steamdeck_stable_ubuntu12"
    if not manifest.exists():
        print(f"[ensure-zipvz] no manifest in {cache_dir}", file=sys.stderr)
        return 1

    text = manifest.read_text(errors="ignore")
    zipvz = re.findall(r'"zipvz"\s*"([^"]+)"', text)
    missing = [z for z in zipvz if not (cache_dir / z).exists()]
    if not missing:
        print(f"[ensure-zipvz] all {len(zipvz)} zipvz files present")
        return 0

    print(f"[ensure-zipvz] fetching {len(missing)} missing zipvz file(s) …")
    for i, name in enumerate(missing, 1):
        dest = cache_dir / name
        print(f"[ensure-zipvz] [{i}/{len(missing)}] {name}")
        sz = fetch(CDN + name, dest)
        print(f"[ensure-zipvz]   ok ({sz} bytes)")
    print("[ensure-zipvz] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
