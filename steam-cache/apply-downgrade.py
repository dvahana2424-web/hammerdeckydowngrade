#!/usr/bin/env python3
"""Apply a staged hammer-downgrader cache (Phase 2 only).

Used by the `downgrade-steam` one-liner after cache files are downloaded
from hammerdeckydowngrade on GitHub into ~/.cache/hammer-downgrader/.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOME = Path(os.environ["HOME"])
NATIVE_STEAM_DIR = HOME / ".steam" / "steam"
FLATPAK_STEAM_DIR = HOME / ".var" / "app" / "com.valvesoftware.Steam" / ".steam" / "steam"
CACHE_ROOT = HOME / ".cache" / "hammer-downgrader"
PACKAGE_PORT = 1666


def info(msg: str) -> None:
    print(f"[downgrade] {msg}", flush=True)


def err(msg: str) -> None:
    print(f"[downgrade] ERROR: {msg}", file=sys.stderr, flush=True)


def detect_steam() -> dict[str, Any]:
    if NATIVE_STEAM_DIR.is_dir():
        steam_dir, flavour = NATIVE_STEAM_DIR, "native"
    elif FLATPAK_STEAM_DIR.is_dir():
        steam_dir, flavour = FLATPAK_STEAM_DIR, "flatpak"
    else:
        return {"flavour": None, "steam_dir": None, "version": None}

    pkg_dir = steam_dir / "package"
    version = None
    for name in (
        "steam_client_steamdeck_stable_ubuntu12",
        "steam_client_steamdeck_publicbeta_ubuntu12",
        "steam_client_ubuntu12",
        "steam_client_publicbeta_ubuntu12",
    ):
        manifest = pkg_dir / f"{name}.manifest"
        if manifest.exists():
            try:
                txt = manifest.read_text(errors="ignore")
                m = re.search(r'"version"\s*"(\d+)"', txt)
                if m:
                    version = m.group(1)
            except OSError:
                pass
            break

    return {
        "flavour": flavour,
        "steam_dir": str(steam_dir),
        "version": version,
        "steam_cfg_path": str(steam_dir / "steam.cfg"),
    }


def check_steam_running() -> bool:
    for prog in ("steam", "steamwebhelper", "reaper"):
        try:
            r = subprocess.run(
                ["pgrep", "-x", prog],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
        if r.returncode == 0:
            return True
    return False


class PackageHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        line = fmt % args
        if "404" in line:
            err(f"pkg-srv 404: {line}")
        else:
            info(f"pkg-srv: {line}")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def start_package_server(package_dir: Path) -> ThreadingHTTPServer:
    class _H(PackageHandler):
        def __init__(self, *args: Any, **kw: Any) -> None:
            super().__init__(*args, directory=str(package_dir), **kw)

    srv = ThreadingHTTPServer(("127.0.0.1", PACKAGE_PORT), _H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, name="pkg-srv", daemon=True).start()
    info(f"Package server: http://127.0.0.1:{PACKAGE_PORT}/")
    return srv


def run_steam_textmode(flavour: str, manifest_name: str, args: list[str]) -> int:
    if flavour == "flatpak":
        base = ["flatpak", "run", "com.valvesoftware.Steam"]
    else:
        base = ["steam"]
    if flavour == "native" and not manifest_name.startswith("steam_client_steamdeck"):
        base.append("-clearbeta")
    # Strip Hammer LD_AUDIT — steam inherits it from the Deck environment
    # and the 32-bit audit shims break textmode update.
    cmd = ["env", "-u", "LD_AUDIT", "-u", "LD_PRELOAD", *base, *args]
    env = os.environ.copy()
    env.pop("LD_AUDIT", None)
    env.pop("LD_PRELOAD", None)
    env["STEAM_FRAME_FORCE_CLOSE"] = "1"
    info("$ " + " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    if proc.stdout:
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                info(f"steam | {line}")
    proc.wait()
    return proc.returncode


def main() -> int:
    if len(sys.argv) < 2:
        err("Usage: apply-downgrade.py <cache-subdir-name>")
        return 2

    cache_dir = CACHE_ROOT / sys.argv[1]
    meta_path = cache_dir / ".hammer-stage.json"
    if not meta_path.exists():
        err(f"Missing staged cache: {cache_dir}")
        return 1

    meta = json.loads(meta_path.read_text())
    manifest_name = meta["manifest_name"]
    target_version = meta["version"]

    if check_steam_running():
        err("Steam is still running. Exit Steam first, then run again.")
        return 1

    steam = detect_steam()
    if not steam["flavour"]:
        err("No Steam install found.")
        return 1

    steam_dir = Path(steam["steam_dir"])
    served_manifest = cache_dir / manifest_name
    legacy = cache_dir / f"{manifest_name}.manifest"
    if not served_manifest.exists() and legacy.exists():
        legacy.rename(served_manifest)
    if not served_manifest.exists():
        err(f"Manifest missing in cache: {served_manifest}")
        return 1

    pkg_dir = steam_dir / "package"
    pkg_dir.mkdir(parents=True, exist_ok=True)
    backup_dir = None
    if any(pkg_dir.iterdir()):
        backup_dir = steam_dir / f"package.backup-{int(time.time())}"
        info(f"Backing up package/ → {backup_dir.name}")
        shutil.copytree(pkg_dir, backup_dir)

    srv = start_package_server(cache_dir)
    try:
        cfg_path = steam_dir / "steam.cfg"
        cfg_path.write_text(
            "BootStrapperInhibitAll=enable\n"
            "BootStrapperForceSelfUpdate=disable\n"
        )
        info(f"Wrote {cfg_path}")

        steam_args = [
            "-textmode",
            "-forcesteamupdate",
            "-forcepackagedownload",
            "-overridepackageurl",
            f"http://localhost:{PACKAGE_PORT}/",
            "-exitsteam",
        ]
        info(f"Applying Steam downgrade to v{target_version} …")
        rc = run_steam_textmode(steam["flavour"], manifest_name, steam_args)

        new = detect_steam()
        if new["version"] == target_version:
            info(f"DOWNGRADE COMPLETE — Steam is now v{target_version}")
            info("Launch Steam manually in Desktop Mode to verify.")
            return 0

        err(
            f"Expected v{target_version} but Steam reports v{new['version']} "
            f"(exit code {rc})"
        )
        if backup_dir:
            err(f"Backup at: {backup_dir}")
        return 1
    finally:
        with contextlib.suppress(Exception):
            srv.shutdown()
        with contextlib.suppress(Exception):
            srv.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
