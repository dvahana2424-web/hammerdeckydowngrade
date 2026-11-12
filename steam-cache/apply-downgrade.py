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


def write_steamrt64_manifest_alias(cache_dir: Path, ubuntu_manifest: Path) -> Path | None:
    """Modern Deck Stable asks for steamrt64 even when opting out of the RT3 launcher.

    Serve the Headcrab ubuntu12 package list under the steamrt64 channel name so
    -overridepackageurl does not 404 and fall back to Valve's live CDN.
    """
    if not ubuntu_manifest.exists():
        return None
    text = ubuntu_manifest.read_text(errors="ignore")
    # First quoted token is the platform tag ("ubuntu12" → "steamrt64").
    aliased = re.sub(r'^"[^"]+"', '"steamrt64"', text, count=1, flags=re.M)
    if "steamdeck_publicbeta" in ubuntu_manifest.name:
        out_name = "steam_client_steamdeck_publicbeta_steamrt64"
    elif "steamdeck" in ubuntu_manifest.name:
        out_name = "steam_client_steamdeck_stable_steamrt64"
    elif "publicbeta" in ubuntu_manifest.name:
        out_name = "steam_client_publicbeta_steamrt64"
    else:
        out_name = "steam_client_steamrt64"
    out = cache_dir / out_name
    out.write_text(aliased)
    info(f"Aliased package channel: {out_name} ← {ubuntu_manifest.name}")
    return out


def start_package_server(package_dir: Path) -> ThreadingHTTPServer:
    class _H(PackageHandler):
        def __init__(self, *args: Any, **kw: Any) -> None:
            super().__init__(*args, directory=str(package_dir), **kw)

    srv = ThreadingHTTPServer(("127.0.0.1", PACKAGE_PORT), _H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, name="pkg-srv", daemon=True).start()
    info(f"Package server: http://127.0.0.1:{PACKAGE_PORT}/")
    return srv


def resolve_steam_bin(flavour: str) -> list[str]:
    """Prefer a launcher that does NOT re-export Hammer LD_AUDIT.

    On Steam Deck, `/usr/bin/steam` → `steam-jupiter`, which ValveOFF may patch
    to `export LD_AUDIT=.../hammersteam.so`. That re-injects 32-bit audit libs
    into the updater and commonly ends in "Steam needs to be online to update".
    """
    if flavour == "flatpak":
        return ["flatpak", "run", "com.valvesoftware.Steam"]

    # Prefer steam.sh inside the Steam data dir — never /usr/bin/steam (→ steam-jupiter).
    candidates = [
        HOME / ".steam" / "steam" / "steam.sh",
        HOME / ".local" / "share" / "Steam" / "steam.sh",
        Path("/usr/lib/steam/bin_steam.sh"),
    ]
    for c in candidates:
        if c.is_file() and os.access(c, os.X_OK):
            return [str(c)]
    return ["steam"]


def run_steam_textmode(flavour: str, manifest_name: str, args: list[str]) -> int:
    base = resolve_steam_bin(flavour)
    if flavour == "native" and not manifest_name.startswith("steam_client_steamdeck"):
        base.append("-clearbeta")

    # Minimal clean env — do not inherit LD_AUDIT from the parent installer shell.
    keep = (
        "HOME", "USER", "LOGNAME", "PATH", "DISPLAY", "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL",
        "XAUTHORITY", "STEAM_RUNTIME", "STEAM_RUNTIME_SCOUT",
    )
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env["STEAM_FRAME_FORCE_CLOSE"] = "1"
    env["LD_AUDIT"] = ""
    env["LD_PRELOAD"] = ""

    cmd = [*base, *args]
    info("$ " + " ".join(cmd))
    info("(clean env; LD_AUDIT cleared)")
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

    # Headcrab: opt out of the steamrt64/steamrt3c *launcher* (steam.sh checks this).
    # Note: the updater may still REQUEST the steamrt64 *package channel* — we alias that below.
    disable_flag = steam_dir / ".steam-disable-steamrt64-client"
    disable_flag.write_text("")
    info(f"Wrote {disable_flag.name} (opt out of steamrt64 launcher)")

    # Temporarily hide steamrt64/steam so steam.sh cannot reexec into RT3.
    steamrt_bin = steam_dir / "steamrt64" / "steam"
    steamrt_bin_hidden = steam_dir / "steamrt64" / "steam.hammer-hidden"
    hid_steamrt = False
    if steamrt_bin.exists() and not steamrt_bin_hidden.exists():
        with contextlib.suppress(OSError):
            steamrt_bin.rename(steamrt_bin_hidden)
            hid_steamrt = True
            info("Temporarily hid steamrt64/steam during downgrade")

    # Wipe package/ so Steam cannot keep preferring live steamrt64 manifests.
    # Staged packages are served from the local HTTP cache, not this folder.
    info("Clearing package/ (Headcrab-style) …")
    for child in list(pkg_dir.iterdir()):
        with contextlib.suppress(OSError):
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

    # Seed beta + ubuntu12 manifest; also seed steamrt64 alias so either request works.
    (pkg_dir / "beta").write_text("steamdeck_stable")
    seeded = pkg_dir / manifest_name
    seeded.write_text(served_manifest.read_text(errors="ignore"))
    (pkg_dir / f"{manifest_name}.manifest").write_text(seeded.read_text())
    info(f"Seeded {manifest_name} (+ .manifest) @ v{target_version}")

    alias_path = write_steamrt64_manifest_alias(cache_dir, served_manifest)
    if alias_path is not None:
        # Also seed into package/ so Steam's local channel probe sees the target build.
        (pkg_dir / alias_path.name).write_text(alias_path.read_text())
        (pkg_dir / f"{alias_path.name}.manifest").write_text(alias_path.read_text())

    srv = start_package_server(cache_dir)
    try:
        cfg_path = steam_dir / "steam.cfg"
        # Do NOT inhibit updates until AFTER a successful local apply.
        # With BootStrapperInhibitAll already set, a failed localhost fetch surfaces
        # as the familiar "Steam needs to be online to update" fatal dialog.
        with contextlib.suppress(OSError):
            if cfg_path.exists():
                cfg_path.unlink()
                info(f"Removed {cfg_path} for duration of local package apply")

        steam_args = [
            "-textmode",
            "-forcesteamupdate",
            "-forcepackagedownload",
            "-overridepackageurl",
            f"http://127.0.0.1:{PACKAGE_PORT}/",
            "-exitsteam",
        ]
        info(f"Applying Steam downgrade to v{target_version} …")
        info(f"Launcher bypasses steam-jupiter (avoids Hammer LD_AUDIT re-export)")
        rc = run_steam_textmode(steam["flavour"], manifest_name, steam_args)

        # Lock updates + keep steamrt64 launcher opt-out after apply.
        disable_flag.write_text("")
        cfg_path.write_text(
            "BootStrapperInhibitAll=enable\n"
            "BootStrapperForceSelfUpdate=disable\n"
        )
        info(f"Wrote {cfg_path} (updates locked)")

        from steam_channel import pick_active_channel, read_channel_version

        active = pick_active_channel(pkg_dir)
        active_ver = read_channel_version(pkg_dir, active) if active else None
        target_channel_ver = read_channel_version(pkg_dir, manifest_name)
        alias_ver = None
        if alias_path is not None:
            alias_ver = read_channel_version(pkg_dir, alias_path.name)

        info(f"Post-apply active channel: {active} (build {active_ver})")
        info(f"Post-apply {manifest_name}: {target_channel_ver}")
        if alias_path is not None:
            info(f"Post-apply {alias_path.name}: {alias_ver}")

        # Success if ANY live channel reports the target build (ubuntu12 or aliased steamrt64).
        ok = target_version in {
            v for v in (active_ver, target_channel_ver, alias_ver) if v
        }
        if ok:
            info(f"DOWNGRADE COMPLETE — Steam is now v{target_version}")
            info("Launch Steam manually in Desktop Mode to verify Settings → Version.")
            return 0

        err(
            f"Expected v{target_version}, but active={active} "
            f"active_ver={active_ver} ubuntu12={target_channel_ver} "
            f"steamrt64_alias={alias_ver} (exit code {rc})"
        )
        if backup_dir:
            err(f"Backup at: {backup_dir}")
        return 1
    finally:
        if hid_steamrt and steamrt_bin_hidden.exists() and not steamrt_bin.exists():
            with contextlib.suppress(OSError):
                steamrt_bin_hidden.rename(steamrt_bin)
                info("Restored steamrt64/steam")
        with contextlib.suppress(Exception):
            srv.shutdown()
        with contextlib.suppress(Exception):
            srv.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
