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
    from steam_channel import pick_active_channel, read_channel_version

    active = pick_active_channel(pkg_dir)
    version = read_channel_version(pkg_dir, active) if active else None

    return {
        "flavour": flavour,
        "steam_dir": str(steam_dir),
        "version": version,
        "active_channel": active,
        "steam_cfg_path": str(steam_dir / "steam.cfg"),
    }


def _proc_state(pid: int) -> str | None:
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().split()[2]
    except OSError:
        return None


def check_steam_running() -> bool:
    """True if a live (non-zombie) steam / steamwebhelper / reaper is up."""
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
        if r.returncode != 0:
            continue
        for pid_s in r.stdout.split():
            with contextlib.suppress(ValueError):
                state = _proc_state(int(pid_s))
                if state and state != "Z":
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
        err("Steam is still running (live process, not a zombie).")
        err("Close Steam first (tray → Exit), or run:")
        err("  steam -shutdown; sleep 3; killall -9 steam steam.sh steamwebhelper")
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

    # Headcrab: force the ubuntu12 client stack (modern Deck defaults to steamrt64).
    disable_flag = steam_dir / ".steam-disable-steamrt64-client"
    disable_flag.write_text("")
    info(f"Wrote {disable_flag.name} (force ubuntu12 client channel)")

    # Wipe package/ so Steam cannot keep preferring steamrt64 manifests.
    # Staged packages are served from the local HTTP cache, not this folder.
    info("Clearing package/ (Headcrab-style) …")
    for child in list(pkg_dir.iterdir()):
        with contextlib.suppress(OSError):
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

    # Seed beta channel + target manifest so Steam asks for ubuntu12 packages.
    (pkg_dir / "beta").write_text("steamdeck_stable")
    seeded = pkg_dir / manifest_name
    seeded.write_text(served_manifest.read_text(errors="ignore"))
    (pkg_dir / f"{manifest_name}.manifest").write_text(seeded.read_text())
    info(f"Seeded {manifest_name} (+ .manifest) @ v{target_version}")

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

        # Re-assert lock + steamrt64 disable after Steam may have rewritten files.
        disable_flag.write_text("")
        cfg_path.write_text(
            "BootStrapperInhibitAll=enable\n"
            "BootStrapperForceSelfUpdate=disable\n"
        )

        from steam_channel import pick_active_channel, read_channel_version

        new = detect_steam()
        active = pick_active_channel(pkg_dir)
        active_ver = read_channel_version(pkg_dir, active) if active else None
        target_channel_ver = read_channel_version(pkg_dir, manifest_name)
        steamrt_left = any(pkg_dir.glob("*steamrt64*"))

        info(f"Post-apply active channel: {active} (build {active_ver})")
        info(f"Post-apply {manifest_name}: {target_channel_ver}")
        if steamrt_left:
            info("steamrt64 package files still present — removing leftovers …")
            for p in pkg_dir.glob("*steamrt64*"):
                with contextlib.suppress(OSError):
                    p.unlink()

        # Success = target ubuntu12 channel is at the requested build.
        # Do NOT treat a stale leftover ubuntu12 manifest as success while
        # steamrt64 remains the live client (that was the previous false OK).
        ok = target_channel_ver == target_version and (
            active is None
            or active == manifest_name
            or (active_ver == target_version and "steamrt64" not in (active or ""))
        )
        if ok:
            info(f"DOWNGRADE COMPLETE — Steam is now v{target_version}")
            info("Launch Steam manually in Desktop Mode to verify Settings → Version.")
            return 0

        err(
            f"Expected v{target_version} on {manifest_name}, but active={active} "
            f"active_ver={active_ver} channel_ver={target_channel_ver} "
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
