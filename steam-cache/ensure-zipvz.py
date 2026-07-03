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


def human_bytes(n: float) -> str:
    n = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            if unit == "B":
                return f"{int(n)} {unit}"
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GiB"


def format_eta(seconds: float) -> str:
    if seconds < 0 or seconds > 86400 * 7:
        return "--:--"
    s = int(seconds + 0.5)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def progress_bar(pct: float, width: int = 32) -> str:
    pct = max(0.0, min(1.0, pct))
    filled = int(width * pct)
    return "[" + "#" * filled + "-" * (width - filled) + "]"


def zipvz_size_hint(name: str) -> int:
    m = re.search(r"_(\d+)$", name)
    return int(m.group(1)) if m else 0


def fetch_with_progress(url: str, dest: Path, total_hint: int, label: str,
                        tty: bool, retries: int = 5) -> int:
    tmp = dest.with_suffix(dest.suffix + ".part")
    t0 = time.monotonic()
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Valve/Steam HTTP Client 1.0"}
            )
            with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as out:
                total = int(r.headers.get("Content-Length", 0)) or total_hint
                done = 0
                last_draw = 0.0
                while True:
                    chunk = r.read(512 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    now = time.monotonic()
                    if tty and total > 0 and now - last_draw >= 0.15:
                        elapsed = now - t0
                        speed = done / elapsed if elapsed > 0 else 0
                        eta = (total - done) / speed if speed > 0 else 0
                        pct = done / total
                        line = (
                            f"\r\033[K[ensure-zipvz] {progress_bar(pct)} {pct * 100:5.1f}%  "
                            f"{human_bytes(done)}/{human_bytes(total)}  "
                            f"{human_bytes(speed)}/s  ETA {format_eta(eta)}  {label}"
                        )
                        sys.stderr.write(line)
                        sys.stderr.flush()
                        last_draw = now
            if tty:
                sys.stderr.write("\n")
                sys.stderr.flush()
            tmp.replace(dest)
            return dest.stat().st_size
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"[ensure-zipvz] attempt {attempt} failed for {dest.name}: {e}")
            tmp.unlink(missing_ok=True)
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

    tty = sys.stderr.isatty()
    text = manifest.read_text(errors="ignore")
    zipvz = re.findall(r'"zipvz"\s*"([^"]+)"', text)
    missing = [z for z in zipvz if not (cache_dir / z).exists()]
    if not missing:
        print(f"[ensure-zipvz] all {len(zipvz)} zipvz files present")
        return 0

    total_hint = sum(zipvz_size_hint(z) for z in missing)
    print(
        f"[ensure-zipvz] fetching {len(missing)} missing zipvz file(s) "
        f"(~{human_bytes(total_hint)}) …",
        flush=True,
    )
    downloaded = 0
    t0 = time.monotonic()
    for i, name in enumerate(missing, 1):
        dest = cache_dir / name
        hint = zipvz_size_hint(name)
        short = name if len(name) <= 48 else name[:45] + "..."
        print(f"[ensure-zipvz] [{i}/{len(missing)}] {short}", flush=True)
        sz = fetch_with_progress(CDN + name, dest, hint, short, tty)
        downloaded += sz
        elapsed = time.monotonic() - t0
        speed = downloaded / elapsed if elapsed > 0 else 0
        print(f"[ensure-zipvz]   ok {human_bytes(sz)}  (total {human_bytes(downloaded)}, avg {human_bytes(speed)}/s)")
    print("[ensure-zipvz] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
