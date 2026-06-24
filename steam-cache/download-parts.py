#!/usr/bin/env python3
"""Download steam-cache archive parts with progress bar, speed, and ETA."""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


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


class DownloadProgress:
    def __init__(self, dest_dir: Path, part_names: list[str], total_bytes: int) -> None:
        self.dest_dir = dest_dir
        self.part_names = part_names
        self.total_bytes = max(1, total_bytes)
        self.lock = threading.Lock()
        self.active: dict[str, str] = {}
        self.done: set[str] = set()
        self.failed: list[str] = []

    def bytes_done(self) -> int:
        n = 0
        for name in self.part_names:
            final = self.dest_dir / name
            partial = self.dest_dir / f"{name}.part"
            with suppress_oserror():
                if final.exists():
                    n += final.stat().st_size
                elif partial.exists():
                    n += partial.stat().st_size
        return min(n, self.total_bytes)

    def set_active(self, name: str, state: str) -> None:
        with self.lock:
            if state:
                self.active[name] = state
            else:
                self.active.pop(name, None)

    def mark_done(self, name: str) -> None:
        with self.lock:
            self.active.pop(name, None)
            self.done.add(name)

    def mark_failed(self, name: str) -> None:
        with self.lock:
            self.active.pop(name, None)
            self.failed.append(name)

    def active_label(self) -> str:
        with self.lock:
            if not self.active:
                return ""
            # Show up to 2 in-flight part names.
            names = sorted(self.active)[:2]
            extra = len(self.active) - len(names)
            label = ", ".join(names)
            if extra > 0:
                label += f" +{extra}"
            return label


class suppress_oserror:
    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> bool:
        return exc_type is OSError


def download_part(url: str, dest: Path, name: str, prog: DownloadProgress,
                  retries: int = 4) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        prog.mark_done(name)
        return

    tmp = dest.with_suffix(dest.suffix + ".part")
    prog.set_active(name, "downloading")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hammer-downgrade/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as out:
                while True:
                    chunk = resp.read(512 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            if tmp.stat().st_size == 0:
                raise OSError("empty download")
            tmp.replace(dest)
            prog.mark_done(name)
            return
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            prog.set_active(name, f"retry {attempt}/{retries}")
            tmp.unlink(missing_ok=True)
            time.sleep(min(2 * attempt, 10))
            if attempt == retries:
                prog.mark_failed(name)
                raise RuntimeError(f"{name}: {e}") from e


def progress_reporter(prog: DownloadProgress, stop: threading.Event, tty: bool) -> None:
    t0 = time.monotonic()
    last_bytes = 0
    last_t = t0
    while not stop.is_set():
        now = time.monotonic()
        nbytes = prog.bytes_done()
        dt = now - last_t
        inst_speed = (nbytes - last_bytes) / dt if dt > 0 else 0.0
        last_bytes = nbytes
        last_t = now
        avg_speed = nbytes / (now - t0) if now > t0 else 0.0
        speed = inst_speed if inst_speed > 0 else avg_speed
        remaining = max(0, prog.total_bytes - nbytes)
        eta = remaining / speed if speed > 0 else 0.0
        pct = nbytes / prog.total_bytes
        active = prog.active_label()
        line = (
            f"{progress_bar(pct)} {pct * 100:5.1f}%  "
            f"{human_bytes(nbytes)}/{human_bytes(prog.total_bytes)}  "
            f"{human_bytes(speed)}/s  ETA {format_eta(eta)}"
        )
        if active:
            line += f"  ({active})"
        if tty:
            sys.stderr.write("\r\033[K[downgrade-steam] " + line)
            sys.stderr.flush()
        else:
            # Non-TTY: log every ~5s
            if int(now - t0) % 5 == 0 and dt >= 0.2:
                print("[downgrade-steam] " + line, flush=True)
        stop.wait(0.2)
    if tty:
        sys.stderr.write("\n")
        sys.stderr.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--dest-dir", required=True)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--parallel", type=int, default=4)
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text())
    dest_dir = Path(args.dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    parts: list[tuple[str, str, str]] = []
    for rel in manifest["parts"]:
        name = Path(rel).name
        url = f"{args.base_url.rstrip('/')}/steam-cache/{args.version}/{rel}"
        parts.append((name, rel, url))

    total_bytes = int(manifest.get("archive_bytes", 0))
    prog = DownloadProgress(dest_dir, [p[0] for p in parts], total_bytes)
    tty = sys.stderr.isatty()

    cached = sum(1 for n, _, _ in parts if (dest_dir / n).exists() and (dest_dir / n).stat().st_size > 0)
    print(
        f"[downgrade-steam] Downloading {len(parts)} parts "
        f"({human_bytes(total_bytes)} total, {cached} already cached) …",
        flush=True,
    )

    stop = threading.Event()
    reporter = threading.Thread(target=progress_reporter, args=(prog, stop, tty), daemon=True)
    reporter.start()

    try:
        with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
            futures = {
                pool.submit(download_part, url, dest_dir / name, name, prog): name
                for name, _, url in parts
            }
            for fut in as_completed(futures):
                fut.result()
    except RuntimeError as e:
        stop.set()
        reporter.join(timeout=1)
        print(f"[downgrade-steam] ERROR: {e}", file=sys.stderr)
        return 1
    finally:
        stop.set()
        reporter.join(timeout=2)

    if prog.failed:
        print(f"[downgrade-steam] ERROR: failed parts: {', '.join(prog.failed)}", file=sys.stderr)
        return 1

    print("[downgrade-steam] All parts downloaded.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
