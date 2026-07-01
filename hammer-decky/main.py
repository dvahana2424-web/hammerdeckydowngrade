"""
Hammer Library — Decky Loader plugin (v0.9.12)

Backend bridge between the React UI (Game Mode) and ValveOFF 1.4 `--cli`.
Install copy: `~/homebrew/plugins/hammer-decky/main.py`.

Requires ValveOFF 1.4+ (license delegation, --license-probe).
See tools/hammer-decky/TODO.md for follow-up polish items.

v0.8.0 design (matches the pivot in src/feats/apps.cpp):

  Hammer's C++ filewatcher used to try to fan out a live LicensesUpdate_t
  callback when a new .hammer landed. That crashed Steam in spoofed-Steam
  mode (V_stristr SIGSEGV inside CCompatManager — see RECIPE.md). The
  stable-default path is now: Hammer ingests the new .hammer silently,
  the next IClientUser::GetSubscribedApps call (which only fires at Steam
  startup / login) picks it up, end of story.

  This means the plugin's contract with the user is: *Add → Restart →
  See*. The frontend handles the restart UX (confirmation modal +
  10-second countdown + cancel) and calls SteamClient.User.StartRestart()
  to actually do it. We never touch the parent process from Python.

The backend is intentionally narrow:
  • validate the AppID (or Steam Store URL → AppID extraction)
  • locate the ValveOFF binary (search a small set of conventional paths)
  • shell out to `ValveOFF --cli --appid <id> --json`
  • track a session-local "pending restart" queue so the panel can show
    "N games waiting for a restart"
  • report ValveOFF status back to the UI

The plugin is read-only with respect to Steam itself — it only writes
files under the user's own ~/.config/hammersteam/ and Steam's depotcache,
which is exactly what the existing GUI ValveOFF does. No Steam process
is killed from Python; no /usr/bin patching; no LD_AUDIT manipulation.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import decky  # type: ignore  # provided by Decky Loader at runtime


# ── Title resolution (Steam Web API + session cache) ────────────────────────
#
# The cart UI used to show bare AppIDs ("AppID 413150"). When the user has
# 5+ entries queued it's cognitively impossible to remember which AppID is
# which game, especially after the cart-process success/fail report.
# Steam's public Web API has no auth and no rate-limit pain at the
# volumes we care about (single tap → single AppID), so we hit it once
# per AppID per session and cache the result.
#
# We deliberately do NOT use SteamKit2 or PICS here — those would require
# wiring through ValveOFF's .NET runtime and a live Steam connection, and
# would also fail for not-yet-owned AppIDs (which is, by definition,
# every AppID the user is about to add). The Web API works for any
# public Steam app whether owned or not.
#
# Cache is *positive-only*: a successful name lookup is sticky for the
# session, but failures (404, network glitch, JSON parse error) are NOT
# cached so retries still hit the API. Cache lifetime is the python
# subprocess lifetime, which is the Steam UI process lifetime — i.e.
# "until the next Steam restart", which is exactly when we'd want it
# rebuilt anyway.

_TITLE_CACHE: dict[int, str] = {}
_TITLE_API_TIMEOUT = 6.0  # seconds — generous; we run in a thread anyway
_TITLE_BATCH_TIMEOUT = 4.0  # seconds for whole-batch wait_for cap

# Steam/Decky often strips SSL_CERT_FILE from the plugin process env.
# Konsole sessions work; Game Mode subprocesses inherit the broken env.
_SSL_CA_BUNDLE_CANDIDATES = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
)

_DMI_FIELDS = (
    "/sys/class/dmi/id/board_serial",
    "/sys/class/dmi/id/product_serial",
    "/sys/class/dmi/id/chassis_serial",
    "/sys/class/dmi/id/board_name",
    "/sys/class/dmi/id/board_vendor",
    "/sys/class/dmi/id/sys_vendor",
    "/sys/class/dmi/id/product_name",
    "/sys/class/dmi/id/product_version",
    "/sys/class/dmi/id/bios_version",
    "/sys/class/dmi/id/bios_date",
)


def _resolve_real_home() -> Path:
    """
    Resolve the home directory of the *user* whose Steam files we should
    operate on. Decky plugins normally run as the desktop user (deck),
    but if the plugin manifest ever sets `"flags": ["root"]` then `~`
    expands to /root and we'd miss the actual Steam install.
    """
    import pwd

    for var in ("SUDO_USER", "PKEXEC_USER"):
        u = os.environ.get(var)
        if u:
            try:
                return Path(pwd.getpwnam(u).pw_dir)
            except KeyError:
                pass

    uid_str = os.environ.get("PKEXEC_UID")
    if uid_str:
        try:
            return Path(pwd.getpwuid(int(uid_str)).pw_dir)
        except (ValueError, KeyError):
            pass

    h = os.environ.get("HOME")
    if h and h != "/root":
        return Path(h)

    expanded = Path(os.path.expanduser("~"))
    if str(expanded) != "/root":
        return expanded

    for fallback in ("/home/deck", "/home/bazzite"):
        if Path(fallback).is_dir():
            return Path(fallback)

    return expanded


_HOME = _resolve_real_home()

# Encrypted activation at ~/.config/hammersteam/.sess (ValveOFF DeviceAuthStore).
_LEGACY_STEM_FILE = _HOME / ".local/share/Hammer/device_license_stem"


def _ssl_ca_bundle() -> str | None:
    for p in _SSL_CA_BUNDLE_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


_GITHUB_PAT_CACHE: str | None = None
_GITHUB_PAT_RE = re.compile(rb"github_pat_[A-Za-z0-9_]{40,}")


def _github_pat_from_valveoff(exec_path: Path) -> str | None:
    """
    Read the GitHub PAT embedded in the ValveOFF binary (same token .NET uses).
    No hardcoded fallback — avoids a second leak vector in the plugin.
    """
    global _GITHUB_PAT_CACHE
    if _GITHUB_PAT_CACHE:
        return _GITHUB_PAT_CACHE

    override = _HOME / ".local/share/Hammer/github_pat"
    if override.is_file():
        try:
            tok = override.read_text(encoding="utf-8").strip()
            if tok:
                _GITHUB_PAT_CACHE = tok
                return tok
        except OSError:
            pass

    try:
        match = _GITHUB_PAT_RE.search(exec_path.read_bytes())
        if match:
            _GITHUB_PAT_CACHE = match.group(0).decode("ascii")
            return _GITHUB_PAT_CACHE
    except OSError:
        pass

    return None


def _stable_machine_key() -> str:
    """
    Mirror DeviceAuthStore.StableMachineKey — /etc/machine-id is readable in
    Game Mode; DMI sysfs often is not (breaks Desktop vs Game Mode binding).
    """
    mid = Path("/etc/machine-id")
    if mid.is_file():
        try:
            s = mid.read_text(encoding="utf-8").strip().lower()
            if len(s) >= 16:
                return s
        except OSError:
            pass
    return _binding_fingerprint_dmi()


def _binding_fingerprint_dmi() -> str:
    """Fallback when machine-id is missing (non-Linux / unusual hosts)."""
    parts: list[str] = []
    for f in _DMI_FIELDS:
        p = Path(f)
        if not p.exists():
            continue
        try:
            v = p.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not v:
            continue
        up = v.upper()
        if up in ("UNKNOWN", "DEFAULT STRING") or "TO BE FILLED" in up:
            continue
        parts.append(f"{f}={v}|")

    if parts:
        return hashlib.sha256("".join(parts).encode("utf-8")).hexdigest().upper()

    pu = Path("/sys/class/dmi/id/product_uuid")
    if pu.exists():
        try:
            raw = pu.read_text(encoding="utf-8").strip().replace("-", "").upper()
            if raw and raw not in ("NONE", "0" * 32, "F" * 32):
                return raw
        except OSError:
            pass
    return ""


def _compute_device_bind(stem: str, pat: str) -> str:
    mk = _stable_machine_key()
    msg = f"{stem.strip().upper().replace('-', '')}|{mk}".encode("utf-8")
    return hmac.new(pat.encode("utf-8"), msg, hashlib.sha256).hexdigest().lower()


def _remove_legacy_stem_file() -> None:
    try:
        if _LEGACY_STEM_FILE.is_file():
            _LEGACY_STEM_FILE.unlink()
    except OSError:
        pass


def _device_license_stem() -> str:
    """Runtime HWID for probes only — not used for delegation without .sess."""
    pu = Path("/sys/class/dmi/id/product_uuid")
    if pu.exists():
        try:
            raw = pu.read_text(encoding="utf-8").strip().replace("-", "").upper()
            if raw and raw not in ("NONE", "0" * 32, "F" * 32):
                return raw
        except OSError:
            pass

    parts: list[str] = []
    for f in _DMI_FIELDS:
        p = Path(f)
        if not p.exists():
            continue
        try:
            v = p.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not v:
            continue
        up = v.upper()
        if up in ("UNKNOWN", "DEFAULT STRING") or "TO BE FILLED" in up:
            continue
        parts.append(f"{f}={v}|")

    if not parts:
        return ""
    digest = hashlib.sha256("".join(parts).encode("utf-8")).hexdigest()
    return digest.upper()


def _decky_license_sig(stem: str, bind: str, pat: str) -> str:
    hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    msg = f"{stem}|{bind}|{hour}".encode("utf-8")
    return hmac.new(pat.encode("utf-8"), msg, hashlib.sha256).hexdigest()


async def _resolve_license_for_game(
    exec_path: Path,
    work_dir: Path,
    dotnet: Path | None,
    needs_dotnet: bool,
) -> tuple[str, dict[str, str], str | None]:
    """
    Game Mode license: encrypted .sess (device-bound) + hourly delegation HMAC.
    ValveOFF --license-probe creates .sess when licensed (no legacy stem file).

    Returns (stem, extra_env_for_spawn, error_message_or_None).
    """
    vo_stem, vo_licensed = await _valveoff_license_probe(
        exec_path, work_dir, dotnet, needs_dotnet
    )
    if vo_licensed is True:
        _remove_legacy_stem_file()

    deleg = await _valveoff_delegation_env(exec_path, work_dir, dotnet, needs_dotnet)
    if deleg is not None:
        stem, extra_env = deleg
        if vo_stem and vo_stem != stem:
            decky.logger.info(
                f"hammer-decky: runtime HWID differs from activation "
                f"(auth={stem[:12]}… runtime={vo_stem[:12]}…)"
            )
        decky.logger.info(
            f"hammer-decky: delegation via ValveOFF stem={stem[:12]}…"
        )
        return stem, extra_env, None

    if vo_licensed is True:
        stem = vo_stem or ""
        if len(stem) >= 8:
            return stem, {}, None

    decky.logger.warning(
        f"hammer-decky: delegation-env failed (probe licensed={vo_licensed!r})"
    )
    if vo_licensed is False:
        return "", {}, (
            "This device is not registered. Open ValveOFF in Desktop Mode "
            "(with internet) once to activate, then try again in Game Mode."
        )
    return "", {}, (
        "Activation missing or outdated. Open ValveOFF in Desktop Mode once "
        "(with internet) to refresh, then try again in Game Mode."
    )


def _subprocess_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """
    Clean environment for ValveOFF — never pass Steam LD_* or merged Game Mode env.
    """
    import pwd

    env: dict[str, str] = {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME": str(_HOME),
    }
    try:
        pw = pwd.getpwuid(os.getuid())
        env["USER"] = pw.pw_name
        env["LOGNAME"] = pw.pw_name
    except (KeyError, OSError):
        env["USER"] = "deck"
        env["LOGNAME"] = "deck"

    for key in ("LANG", "LC_ALL", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"):
        v = os.environ.get(key)
        if v:
            env[key] = v

    # Game Mode plugin subprocesses often lack session bus vars; derive them
    # from the deck user's uid so systemctl --user / systemd-run work.
    try:
        pw = pwd.getpwuid(os.getuid())
        runtime = f"/run/user/{pw.pw_uid}"
    except (KeyError, OSError):
        runtime = "/run/user/1000"
    if "XDG_RUNTIME_DIR" not in env and Path(runtime).is_dir():
        env["XDG_RUNTIME_DIR"] = runtime
    bus_path = f"{runtime}/bus"
    if "DBUS_SESSION_BUS_ADDRESS" not in env and Path(bus_path).exists():
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus_path}"

    ca = _ssl_ca_bundle()
    if ca:
        env["SSL_CERT_FILE"] = ca
        env["SSL_CERT_DIR"] = "/etc/ssl/certs"
        env["REQUESTS_CA_BUNDLE"] = ca

    if extra:
        env.update(extra)
    return env


async def _valveoff_delegation_env(
    exec_path: Path,
    work_dir: Path,
    dotnet: Path | None,
    needs_dotnet: bool,
) -> tuple[str, dict[str, str]] | None:
    """
    Ask ValveOFF to sign delegation (PAT stays inside the binary / obfuscated build).
    Returns (stem, env_dict) or None.
    """
    argv: list[str] = (
        [str(dotnet), str(exec_path)] if needs_dotnet else [str(exec_path)]
    ) + ["--cli", "--delegation-env", "--json"]
    try:
        proc = await _create_valveoff_process(argv, work_dir)
    except OSError:
        return None

    assert proc.stdout is not None
    async for line in _read_lines(proc.stdout):
        try:
            evt = json.loads(line)
        except json.JSONDecodeError:
            continue
        if evt.get("phase") != "delegation_env":
            continue
        payload = evt.get("payload")
        if not isinstance(payload, dict) or not payload.get("ok"):
            continue
        stem = str(payload.get("stem", "")).strip().upper().replace("-", "")
        bind = str(payload.get("bind", "")).strip().lower()
        sig = str(payload.get("sig", "")).strip().lower()
        if len(stem) >= 8 and len(bind) >= 16 and len(sig) >= 16:
            await proc.wait()
            return stem, {
                "HAMMER_DECKY_LICENSE_STEM": stem,
                "HAMMER_DECKY_LICENSE_BIND": bind,
                "HAMMER_DECKY_LICENSE_SIG": sig,
            }

    await proc.wait()
    return None


async def _valveoff_license_probe(
    exec_path: Path,
    work_dir: Path,
    dotnet: Path | None,
    needs_dotnet: bool,
) -> tuple[str, bool | None]:
    """
    Ask ValveOFF for the canonical device stem (and optional .NET license result).
    Returns (stem, licensed_or_None_if_parse_failed).
    """
    argv: list[str] = (
        [str(dotnet), str(exec_path)] if needs_dotnet else [str(exec_path)]
    ) + ["--cli", "--license-probe", "--json"]
    try:
        proc = await _create_valveoff_process(argv, work_dir)
    except OSError:
        return "", None

    stem = ""
    licensed: bool | None = None
    assert proc.stdout is not None
    async for line in _read_lines(proc.stdout):
        try:
            evt = json.loads(line)
        except json.JSONDecodeError:
            continue
        if evt.get("phase") != "license_probe":
            continue
        payload = evt.get("payload")
        if not isinstance(payload, dict):
            continue
        stem = str(payload.get("stem", "")).strip().upper().replace("-", "")
        if "licensed" in payload:
            licensed = bool(payload["licensed"])

    await proc.wait()
    return stem, licensed


async def _create_valveoff_process(
    argv: list[str],
    work_dir: Path,
    extra_env: dict[str, str] | None = None,
) -> asyncio.subprocess.Process:
    """Spawn ValveOFF directly with a clean env (no systemd-run — breaks .NET single-file TLS)."""
    env = _subprocess_env(extra_env)
    return await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=str(work_dir),
    )


def _valveoff_exec_path(path: Path, needs_dotnet: bool) -> tuple[Path, Path]:
    """Resolve symlinks; return (executable, working_directory for offmode/)."""
    resolved = path.resolve()
    work_dir = resolved.parent
    return resolved, work_dir


def _detect_steam_root() -> str | None:
    """Best-effort Steam root for --steam-root (Flatpak + native)."""
    for cand in (
        _HOME / ".local/share/Steam",
        _HOME / ".steam/steam",
        _HOME / ".steam/root",
        _HOME / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
    ):
        p = cand
        if p.is_dir() and (p / "steamapps").is_dir():
            return str(p)
    return None


def _fetch_title_blocking(appid: int) -> tuple[str | None, str]:
    """
    Fetch a single AppID title from Steam's public Web API. Synchronous
    — call via asyncio.to_thread() so we don't stall Decky's event loop
    on slow networks.

    Returns (name_or_None, status_string). The status string is for
    logging — values are 'ok', 'http_<code>', 'timeout', 'urlerror_<x>',
    'json_parse', 'no_entry', 'success_false', 'no_data', 'no_name'.
    Never raises.
    """
    import socket  # local import — only needed inside the worker thread

    url = (
        "https://store.steampowered.com/api/appdetails"
        f"?appids={appid}&filters=basic&l=english"
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "hammer-decky/0.9.3 (+steamdeck)",
            "Accept": "application/json",
        },
    )
    try:
        import ssl

        ctx = ssl.create_default_context()
        ca = _ssl_ca_bundle()
        if ca:
            ctx.load_verify_locations(cafile=ca)
        with urllib.request.urlopen(
            req, timeout=_TITLE_API_TIMEOUT, context=ctx
        ) as resp:
            code = resp.getcode()
            data = resp.read().decode("utf-8", "replace")
            if code != 200:
                return None, f"http_{code}"
    except urllib.error.HTTPError as ex:
        return None, f"http_{ex.code}"
    except (socket.timeout, TimeoutError):
        return None, "timeout"
    except urllib.error.URLError as ex:
        return None, f"urlerror_{ex.reason}"
    except OSError as ex:
        return None, f"oserror_{ex.errno}"
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return None, "json_parse"
    entry = parsed.get(str(appid))
    if not isinstance(entry, dict):
        return None, "no_entry"
    if not entry.get("success"):
        return None, "success_false"
    info = entry.get("data")
    if not isinstance(info, dict):
        return None, "no_data"
    name = info.get("name")
    if not (isinstance(name, str) and name.strip()):
        return None, "no_name"
    return name.strip()[:200], "ok"


async def _resolve_title(appid: int) -> str:
    """
    Async cache wrapper. Returns the title or an "AppID N" fallback.
    Negative results are NOT cached — see comment above. Logs the
    outcome so we can debug "title resolver dont work" cases without
    asking the user to enable verbose mode.
    """
    if appid in _TITLE_CACHE:
        return _TITLE_CACHE[appid]
    t0 = time.monotonic()
    name: str | None
    status: str
    try:
        name, status = await asyncio.to_thread(_fetch_title_blocking, appid)
    except Exception as ex:  # noqa: BLE001 — keep the resolver robust
        name, status = None, f"exception_{type(ex).__name__}"
    elapsed = time.monotonic() - t0
    if name:
        _TITLE_CACHE[appid] = name
        decky.logger.info(
            f"hammer-decky: title resolved appid={appid} -> {name!r} ({elapsed:.2f}s)"
        )
        return name
    decky.logger.warning(
        f"hammer-decky: title resolution failed appid={appid} status={status} "
        f"({elapsed:.2f}s) — falling back to 'AppID {appid}'"
    )
    return f"AppID {appid}"


async def _resolve_titles_batch(appids: list[int]) -> dict[int, str]:
    """
    Concurrent batch resolver. Cache hits short-circuit; misses fan
    out via asyncio.gather. Errors per-AppID don't kill the batch
    (return_exceptions=True turns them into a fallback string).
    """
    out: dict[int, str] = {}
    misses: list[int] = []
    for a in appids:
        if a in _TITLE_CACHE:
            out[a] = _TITLE_CACHE[a]
        else:
            misses.append(a)
    if misses:
        decky.logger.info(
            f"hammer-decky: title-batch resolving {len(misses)} miss(es): {misses}"
        )
        results = await asyncio.gather(
            *(_resolve_title(a) for a in misses),
            return_exceptions=True,
        )
        for a, r in zip(misses, results):
            if isinstance(r, Exception):
                decky.logger.warning(
                    f"hammer-decky: title-batch entry exception appid={a}: {r!r}"
                )
                out[a] = f"AppID {a}"
            else:
                out[a] = r  # type: ignore[assignment]
    return out


def _spawn_bg_title_fetch(appid: int) -> None:
    """
    Fire-and-forget title fetch with proper exception logging. Plain
    `asyncio.create_task` swallows exceptions silently if the task
    handle is dropped — which is exactly what we were doing in v0.9.2,
    explaining why <title pending> never resolved in some sessions.
    """

    async def _runner() -> None:
        try:
            await _resolve_title(appid)
        except Exception as ex:  # noqa: BLE001
            decky.logger.error(
                f"hammer-decky: bg title fetch crashed appid={appid}: {ex!r}"
            )

    try:
        asyncio.create_task(_runner())
    except RuntimeError:
        # No running loop (shouldn't happen inside an RPC handler, but
        # belt-and-braces). Worst case: title is resolved on the next
        # synchronous cart_add or get_cart path.
        decky.logger.warning(
            f"hammer-decky: bg title fetch could not be scheduled for appid={appid}"
        )


# ── ValveOFF binary discovery ────────────────────────────────────────────────
#
# We support three shapes of ValveOFF on disk:
#   1. Single-file native publish     (~/.local/share/Hammer/ValveOFF)
#   2. dotnet build output dir        (.../ValveOFF/bin/Release/net8.0/ValveOFF.dll)
#   3. Sibling install dir            (~/Applications/ValveOFF/ValveOFF[.dll])
#
# When we find a .dll, we wrap it with `dotnet`. When we find a native ELF,
# we exec it directly. The first match wins (ordered by stability).

_DOTNET_CANDIDATES: list[Path] = [
    _HOME / ".dotnet/dotnet",
    Path("/usr/local/dotnet/dotnet"),
    Path("/usr/share/dotnet/dotnet"),
    Path("/usr/bin/dotnet"),
    Path("/snap/bin/dotnet"),
]


def _find_dotnet() -> Path | None:
    """Return path to a usable `dotnet` host or None."""
    on_path = shutil.which("dotnet")
    if on_path:
        return Path(on_path)
    for cand in _DOTNET_CANDIDATES:
        if cand.is_file() and os.access(cand, os.X_OK):
            return cand
    return None


_VALVEOFF_CANDIDATES: list[Path] = [
    _HOME / ".local/share/Hammer/ValveOFF",
    _HOME / "Videos/ValveOFF 1.4/ValveOFF",
    _HOME / "Applications/ValveOFF/ValveOFF",
    _HOME / "homebrew/plugins/hammer-decky/bin/ValveOFF",
    Path("/usr/local/bin/ValveOFF"),
    Path("/usr/bin/ValveOFF"),
    # dev convenience — repo build output
    _HOME / "Pictures/project slssteam/slsteam/ValveOFF/bin/Release/net8.0/ValveOFF.dll",
    _HOME / "Pictures/project slssteam/slsteam/ValveOFF/bin/Debug/net8.0/ValveOFF.dll",
]


def _find_valveoff() -> tuple[Path, bool] | None:
    """Return (binary_path, needs_dotnet_wrapper) or None."""
    for cand in _VALVEOFF_CANDIDATES:
        if cand.is_file() and os.access(cand, os.X_OK if cand.suffix != ".dll" else os.R_OK):
            return cand, cand.suffix == ".dll"
    return None


# ── input validation ────────────────────────────────────────────────────────

_APPID_RE = re.compile(r"^\d{1,9}$")
_STORE_URL_RE = re.compile(r"^https?://store\.steampowered\.com/app/(\d{1,9})(?:[/?].*)?$")


def _coerce_appid(raw: str) -> int | None:
    """Accept either a bare AppID or a Steam Store URL."""
    raw = raw.strip()
    if _APPID_RE.match(raw):
        return int(raw)
    m = _STORE_URL_RE.match(raw)
    if m:
        return int(m.group(1))
    return None


# ── Plugin class ────────────────────────────────────────────────────────────

class Plugin:
    # Decky API v1 lets the loader pass *positional* arguments (index-based),
    # which is what the @decky/api `callable<[args...]>` shape produces on
    # the React side. Without this attribute the loader falls back to the
    # legacy v0 protocol and rejects every call with
    # "api_version 1 or newer is required to call methods with
    # index-based arguments".
    api_version = 1

    # ── Two distinct in-memory queues ─────────────────────────────────────
    #
    # `_cart` — raw AppIDs the user has clicked "Add to Library" for, but
    #           which have not yet been processed by ValveOFF. Populated
    #           by `cart_add` (called from the in-page button on the
    #           Steam Store page) and drained by `process_cart` (called
    #           from the QAM panel's "Process cart" button). Items in
    #           `_cart` have NO .hammer file on disk yet.
    #
    # `_pending` — entries for which ValveOFF has already produced a
    #              .hammer file in `~/.config/hammersteam/`. They will
    #              actually appear in the Steam library only after the
    #              next Steam restart (Hammer's GetSubscribedApps hook
    #              re-fires at startup). Drained by `mark_restarted`
    #              right before the frontend issues StartRestart().
    #
    # Both queues are session-local; the python process dies with Steam
    # so they implicitly reset on every Steam restart, which is also
    # exactly when `_pending` items become "real" library entries.
    _cart: list[int] = []
    _pending: list[dict[str, Any]] = []

    async def _main(self) -> None:
        decky.logger.info(
            "hammer-decky: backend starting (v0.9.16 — async systemctl restart, 3s countdown)"
        )
        bin_info = _find_valveoff()
        if bin_info is None:
            decky.logger.warning("hammer-decky: ValveOFF binary not found in any candidate path")
        else:
            path, dll = bin_info
            decky.logger.info(
                f"hammer-decky: ValveOFF located at {path} (dotnet={dll})"
            )

    async def _unload(self) -> None:
        decky.logger.info("hammer-decky: backend shutting down")

    # ── RPC: ping (used by frontend on mount to detect backend health) ──
    async def health_check(self) -> dict[str, Any]:
        bin_info = _find_valveoff()
        if bin_info is None:
            return {
                "ok":          False,
                "reason":      "valveoff_not_found",
                "candidates":  [str(c) for c in _VALVEOFF_CANDIDATES],
            }
        path, needs_dotnet = bin_info
        dotnet = _find_dotnet() if needs_dotnet else None
        if needs_dotnet and dotnet is None:
            return {
                "ok":     False,
                "reason": "dotnet_missing",
                "error":  "ValveOFF.dll found but `dotnet` host is not installed.",
            }

        # Probe `--cli --help` to confirm the binary is the new build
        # (older builds don't recognise --cli and exit with code 4).
        try:
            exec_path, work_dir = _valveoff_exec_path(path, needs_dotnet)
            argv = (
                [str(dotnet), str(exec_path), "--cli", "--help"]
                if needs_dotnet else [str(exec_path), "--cli", "--help"]
            )
            proc = await _create_valveoff_process(argv, work_dir)
            stdout, _stderr = await proc.communicate()
            cli_ready = proc.returncode == 0 and b"--cli" in stdout
        except FileNotFoundError as ex:
            return {"ok": False, "reason": "dotnet_missing", "error": str(ex)}
        except Exception as ex:  # noqa: BLE001  — surface anything to UI
            return {"ok": False, "reason": "probe_failed", "error": str(ex)}

        return {
            "ok":            True,
            "valveoff_path": str(path),
            "dotnet_path":   str(dotnet) if dotnet else None,
            "needs_dotnet":  needs_dotnet,
            "cli_ready":     cli_ready,
            "hammer_dir":    str(_HOME / ".config/hammersteam"),
            "version":       "0.9.12",
        }

    # ── RPC: title resolution (Steam Web API + session cache) ─────────────
    async def resolve_titles(self, appids: list[Any]) -> dict[str, str]:
        """
        Batch-resolve a list of AppIDs to canonical Steam Store titles.
        Frontend uses this for the cart, pending, and installed lists,
        plus the in-page button's tooltip and "Add 'Stardew Valley' to
        cart" button label.

        Returns a JSON-friendly map {str(appid) -> title}. Frontend
        expects string keys because object property access in JS is
        always string-coerced anyway.
        """
        cleaned: list[int] = []
        for raw in appids if isinstance(appids, list) else []:
            try:
                appid = int(raw)
            except (TypeError, ValueError):
                continue
            if 0 < appid < 1_000_000_000:
                cleaned.append(appid)
        if not cleaned:
            return {}
        try:
            titles = await asyncio.wait_for(
                _resolve_titles_batch(cleaned),
                timeout=_TITLE_BATCH_TIMEOUT,
            )
        except asyncio.TimeoutError:
            # Return whatever's already cached; the frontend will retry
            # on the next 2-second poll tick.
            titles = {a: _TITLE_CACHE.get(a, f"AppID {a}") for a in cleaned}
        return {str(a): t for a, t in titles.items()}

    # ── RPC: list installed games (.hammer files in config dir) ─────────
    async def list_installed(self) -> list[dict[str, Any]]:
        cfg_dir = _HOME / ".config/hammersteam"
        if not cfg_dir.is_dir():
            return []
        out: list[dict[str, Any]] = []
        for f in sorted(cfg_dir.glob("*.hammer")):
            try:
                stat = f.stat()
                appid_match = re.match(r"^(\d{1,9})\.hammer$", f.name)
                out.append({
                    "appid":      int(appid_match.group(1)) if appid_match else 0,
                    "filename":   f.name,
                    "size_bytes": stat.st_size,
                    "mtime":      int(stat.st_mtime),
                })
            except OSError:
                continue
        return out

    # ── RPC: check if a given appid already has a .hammer on disk ───────
    #
    # Used by the in-Steam Store-page button to switch its label between
    # "Add to Library" (no .hammer yet) and "Already Added" (file exists,
    # just needs a Steam restart).
    async def is_appid_added(self, appid: int) -> dict[str, Any]:
        try:
            appid_int = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "added": False, "error": "invalid appid"}
        target = _HOME / ".config/hammersteam" / f"{appid_int}.hammer"
        # Best-effort title resolution. Don't block UI on it: short
        # timeout and graceful fallback.
        title: str | None = _TITLE_CACHE.get(appid_int)
        if title is None:
            try:
                title = await asyncio.wait_for(_resolve_title(appid_int), timeout=2.0)
            except asyncio.TimeoutError:
                title = None
        return {
            "ok":           True,
            "appid":        appid_int,
            "added":        target.is_file(),
            "filename":     target.name,
            "path":         str(target) if target.is_file() else None,
            "size_bytes":   target.stat().st_size if target.is_file() else 0,
            "in_pending":   any(p.get("appid") == appid_int for p in self._pending),
            "in_cart":      appid_int in self._cart,
            "title":        title,
        }

    # ── RPC: cart (the "click Add to Library 5 times then process" flow) ─
    #
    # The in-page Add button is meant to be tapped quickly while
    # browsing the Steam Store; it should NOT block on a network call to
    # ValveOFF for every press. Instead it just adds the AppID to this
    # cart, and the user later opens the QAM panel and presses "Process
    # cart" to fan out to ValveOFF for all of them at once. This matches
    # the user's "parang add to card" mental model and keeps the in-page
    # button responsive.

    async def cart_add(self, appid: int) -> dict[str, Any]:
        try:
            appid_int = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid appid"}
        if appid_int <= 0 or appid_int >= 1_000_000_000:
            return {"ok": False, "error": "appid out of range"}

        # Resolve the title SYNCHRONOUSLY (with a strict 2s timeout)
        # so the toast / status line actually shows the game name on
        # first paint. v0.9.2 did this in the background and the user
        # almost always saw the "AppID N" fallback because the toast
        # rendered before the fetch completed. Even a slow network
        # gives us first byte well under 1s in practice; 2s is a
        # generous worst-case ceiling.
        title: str | None = _TITLE_CACHE.get(appid_int)
        if title is None:
            try:
                title = await asyncio.wait_for(
                    _resolve_title(appid_int),
                    timeout=2.0,
                )
            except asyncio.TimeoutError:
                title = None
                # Schedule a background retry so the next get_cart
                # poll picks up the real name even though we
                # couldn't wait any longer here.
                _spawn_bg_title_fetch(appid_int)
        # Real titles ("Stardew Valley") get cached and returned;
        # fallbacks ("AppID 413150") are still useful to send back
        # but we don't pretend they're real.
        clean_title = title if title and not title.startswith("AppID ") else None

        if appid_int in self._cart:
            decky.logger.info(
                f"hammer-decky: cart_add {appid_int} (already in cart; "
                f"title={clean_title!r}; cart now {len(self._cart)})"
            )
            return {
                "ok":         True,
                "appid":      appid_int,
                "added":      False,
                "in_cart":    True,
                "cart_count": len(self._cart),
                "title":      clean_title,
            }
        self._cart.append(appid_int)
        decky.logger.info(
            f"hammer-decky: cart_add {appid_int} ({clean_title or '<unresolved>'}; "
            f"cart now {len(self._cart)})"
        )
        return {
            "ok":         True,
            "appid":      appid_int,
            "added":      True,
            "in_cart":    True,
            "cart_count": len(self._cart),
            "title":      clean_title,
        }

    async def cart_remove(self, appid: int) -> dict[str, Any]:
        try:
            appid_int = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid appid"}
        before = len(self._cart)
        self._cart = [x for x in self._cart if x != appid_int]
        removed = before > len(self._cart)
        if removed:
            decky.logger.info(
                f"hammer-decky: cart_remove {appid_int} (cart now {len(self._cart)})"
            )
        return {
            "ok":         True,
            "appid":      appid_int,
            "removed":    removed,
            "cart_count": len(self._cart),
        }

    async def cart_clear(self) -> dict[str, Any]:
        n = len(self._cart)
        self._cart = []
        if n:
            decky.logger.info(f"hammer-decky: cart_clear ({n} entries dropped)")
        return {"ok": True, "cleared": n}

    async def get_cart(self) -> dict[str, Any]:
        # Block briefly to fetch any missing titles. Strict timeout so
        # the panel's 2-second poll never stalls the UI even on a flaky
        # network — anything we can't fetch in time gets the "AppID N"
        # fallback and the next poll will pick up the real name.
        if self._cart:
            missing = [a for a in self._cart if a not in _TITLE_CACHE]
            if missing:
                try:
                    await asyncio.wait_for(
                        _resolve_titles_batch(list(self._cart)),
                        timeout=_TITLE_BATCH_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    decky.logger.warning(
                        f"hammer-decky: get_cart title batch timed out for {missing}"
                    )
        titles = {
            str(a): _TITLE_CACHE.get(a, f"AppID {a}") for a in self._cart
        }
        return {
            "count":  len(self._cart),
            "appids": list(self._cart),
            "titles": titles,
        }

    async def process_cart(self) -> dict[str, Any]:
        """
        Run the ValveOFF add pipeline for every AppID currently in the
        cart. Returns one result entry per attempt — the frontend
        renders this as a per-line success/fail list.

        Items that succeed are removed from `_cart` (and recorded in
        `_pending` by `add_game`). Items that fail stay in `_cart` so
        the user can retry without re-typing them.
        """
        if not self._cart:
            return {
                "ok":             True,
                "results":        [],
                "successful":     [],
                "failed":         [],
                "cart_remaining": 0,
                "pending_count":  len(self._pending),
            }

        # Snapshot under iteration — `add_game` mutates `_cart` indirectly
        # via the post-loop filter, so taking a copy keeps things sane
        # if a future refactor moves the mutation into `add_game` itself.
        snapshot = list(self._cart)
        decky.logger.info(
            f"hammer-decky: process_cart starting on {len(snapshot)} entr(y/ies): {snapshot}"
        )

        # Pre-warm the title cache for the whole batch so the per-line
        # results all carry human-readable names even on a slow network.
        # Strict timeout: if the API is broken we just fall back to
        # "AppID N" for the unresolved rows rather than holding up
        # ValveOFF processing.
        try:
            await asyncio.wait_for(
                _resolve_titles_batch(snapshot),
                timeout=_TITLE_BATCH_TIMEOUT,
            )
        except asyncio.TimeoutError:
            pass

        results: list[dict[str, Any]] = []
        for appid in snapshot:
            res = await self.add_game(str(appid))
            ok = bool(res.get("ok"))
            results.append({
                "appid": appid,
                "title": _TITLE_CACHE.get(appid, f"AppID {appid}"),
                "ok":    ok,
                "stage": res.get("stage", "unknown"),
                "error": None if ok else res.get("error", "unknown error"),
                "rc":    res.get("rc"),
            })
            if ok:
                # Drop from cart on success — `_pending` already received
                # the entry inside `add_game`.
                self._cart = [x for x in self._cart if x != appid]
            # On failure: leave the entry in `_cart` so the user sees it
            # in the panel and can decide to retry or remove it.

        successful = [r["appid"] for r in results if r["ok"]]
        failed = [r["appid"] for r in results if not r["ok"]]

        decky.logger.info(
            f"hammer-decky: process_cart finished — {len(successful)} ok, "
            f"{len(failed)} failed; cart remaining {len(self._cart)}; "
            f"titles="
            + json.dumps(
                {str(r["appid"]): r["title"] for r in results},
                ensure_ascii=False,
            )
        )

        return {
            "ok":             True,
            "results":        results,
            "successful":     successful,
            "failed":         failed,
            "cart_remaining": len(self._cart),
            "pending_count":  len(self._pending),
        }

    # ── RPC: add game (single-shot path, used by panel paste-input + cart) ─
    async def add_game(self, raw_input: str, steam_root: str | None = None) -> dict[str, Any]:
        appid = _coerce_appid(raw_input)
        if appid is None:
            return {"ok": False, "stage": "validate", "error": "Invalid AppID or Steam Store URL."}

        bin_info = _find_valveoff()
        if bin_info is None:
            return {
                "ok":    False,
                "stage": "discover",
                "error": "ValveOFF binary not found. Install ValveOFF first or copy it to ~/.local/share/Hammer/.",
            }
        path, needs_dotnet = bin_info
        dotnet = _find_dotnet() if needs_dotnet else None
        if needs_dotnet and dotnet is None:
            return {
                "ok":    False,
                "stage": "discover",
                "error": "ValveOFF.dll found but `dotnet` host is not installed. Install .NET 8 runtime or publish ValveOFF as self-contained.",
            }

        exec_path, work_dir = _valveoff_exec_path(path, needs_dotnet)
        argv: list[str] = (
            [str(dotnet), str(exec_path)] if needs_dotnet else [str(exec_path)]
        ) + ["--cli", "--appid", str(appid), "--json"]

        root = steam_root or _detect_steam_root()
        if root:
            argv += ["--steam-root", root]

        stem, extra_env, lic_err = await _resolve_license_for_game(
            exec_path, work_dir, dotnet, needs_dotnet
        )
        if lic_err:
            decky.logger.info(f"hammer-decky: license blocked: {lic_err}")
            return {"ok": False, "stage": "license", "error": lic_err}

        mode = "delegation" if extra_env else "valveoff_online"
        decky.logger.info(
            f"hammer-decky: license ok stem={stem[:12]}… mode={mode}; "
            f"spawning ValveOFF: {' '.join(argv)} (cwd={work_dir})"
        )

        try:
            proc = await _create_valveoff_process(argv, work_dir, extra_env)
        except FileNotFoundError as ex:
            return {"ok": False, "stage": "spawn", "error": f"Failed to spawn: {ex}"}

        events: list[dict[str, Any]] = []
        result: dict[str, Any] = {}

        assert proc.stdout is not None
        async for line in _read_lines(proc.stdout):
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                continue
            events.append(evt)
            phase = evt.get("phase", "")
            if phase == "done":
                payload = evt.get("payload", {})
                if isinstance(payload, dict):
                    result.update(payload)
            elif phase in ("fatal", "internet", "download"):
                if isinstance(evt.get("payload"), dict) and "error" in evt["payload"]:
                    decky.logger.warning(f"hammer-decky: stage error: {evt}")

        rc = await proc.wait()
        stderr = (await proc.stderr.read()).decode("utf-8", "replace") if proc.stderr else ""
        if stderr.strip():
            decky.logger.warning(f"hammer-decky: ValveOFF stderr: {stderr[:2000]}")

        if rc == 0:
            entry = {
                "appid":          appid,
                "title":          _TITLE_CACHE.get(appid, f"AppID {appid}"),
                "hammer_file":    result.get("hammerFile"),
                "depotcache_dir": result.get("depotcacheDir"),
                "manifests":      result.get("manifestsCopied", 0),
                "added_at":       int(time.time()),
            }
            # De-dup: re-adding the same appid replaces (not duplicates) the entry.
            self._pending = [p for p in self._pending if p["appid"] != appid]
            self._pending.append(entry)

            return {
                "ok":              True,
                "stage":           "done",
                "appid":           appid,
                "pending_count":   len(self._pending),
                "result":          result,
            }

        # Surface ValveOFF's NDJSON error (license, download, etc.) instead of
        # hiding it behind the generic exit-code-1 label.
        detail: str | None = None
        for evt in reversed(events):
            phase = evt.get("phase", "")
            if phase in ("fatal", "internet", "download", "license"):
                payload = evt.get("payload")
                if isinstance(payload, dict) and payload.get("error"):
                    detail = str(payload["error"])
                    break

        if not detail and stderr.strip():
            first = stderr.strip().splitlines()[0][:240]
            detail = f"ValveOFF failed to start: {first}"

        msg = detail or {
            1: "Generic failure (see Decky log).",
            2: f"AppID {appid} not found in mirror database.",
            3: "No internet connection.",
            4: "Invalid arguments to ValveOFF (likely an internal bug).",
        }.get(rc, f"ValveOFF exited with code {rc}.")

        return {
            "ok":      False,
            "stage":   "valveoff",
            "rc":      rc,
            "error":   msg,
            "stderr":  stderr,
            "events":  events,
        }

    # ── RPC: remove a single .hammer file ───────────────────────────────
    #
    # Lets the user back out of an add without keeping the orphan file
    # around (the manifest is left in Steam's depotcache; that's harmless,
    # depotcache entries are referenced by id and Steam ignores stale ones).
    async def remove_game(self, appid: int) -> dict[str, Any]:
        try:
            appid_int = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid appid"}
        target = _HOME / ".config/hammersteam" / f"{appid_int}.hammer"
        if not target.is_file():
            return {"ok": False, "error": f"{target.name} not found"}
        try:
            target.unlink()
        except OSError as ex:
            return {"ok": False, "error": f"unlink failed: {ex}"}
        # Drop from pending if present.
        self._pending = [p for p in self._pending if p["appid"] != appid_int]
        decky.logger.info(f"hammer-decky: removed {target.name}")
        return {"ok": True, "appid": appid_int, "filename": target.name}

    # ── RPC: pending-restart queue ──────────────────────────────────────
    #
    # Every add appends to `_pending`; the frontend reads this so the QAM
    # panel banner can show "N games waiting — restart Steam to apply"
    # and the restart button knows what to remind the user about.

    async def get_pending(self) -> dict[str, Any]:
        # Backfill titles for any pending entry whose title was None
        # at insert time (legacy flow) or hasn't been resolved yet
        # (e.g. add_game ran before the Web API responded for that
        # AppID).
        out: list[dict[str, Any]] = []
        for p in self._pending:
            entry = dict(p)
            appid = entry.get("appid")
            if isinstance(appid, int) and not entry.get("title"):
                entry["title"] = _TITLE_CACHE.get(
                    appid, f"AppID {appid}"
                )
            out.append(entry)
        return {"count": len(out), "entries": out}

    async def mark_restarted(self) -> dict[str, Any]:
        """
        Called by the frontend right BEFORE issuing
        SteamClient.User.StartRestart(). Empties the queue (the next mount
        of the panel will show "no pending"). We don't wait for the
        restart to complete because the entire python process dies with
        Steam — clearing here gives the cleanest hand-off.
        """
        n = len(self._pending)
        appids = [p["appid"] for p in self._pending]
        self._pending = []
        decky.logger.info(
            f"hammer-decky: marking {n} pending entr(y/ies) as restarted: {appids}"
        )
        return {"cleared": n, "appids": appids}

    async def schedule_steam_relaunch(self) -> dict[str, Any]:
        """
        Detached watchdog — polls for healthy Game Mode Steam after a
        systemctl restart. PluginLoader outlives the Steam UI process.
        """
        cache_dir = _HOME / ".cache/hammer-decky"
        cache_dir.mkdir(parents=True, exist_ok=True)
        log_path = cache_dir / "restart-watchdog.log"

        env = _subprocess_env()
        runtime = env.get("XDG_RUNTIME_DIR", "/run/user/1000")
        dbus = env.get("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime}/bus")

        script = f"""\
set -u
LOG={str(log_path)!r}
HOME={str(_HOME)!r}
XDG_RUNTIME_DIR={runtime!r}
DBUS_SESSION_BUS_ADDRESS={dbus!r}
export HOME XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS
log() {{ echo "$(date -Iseconds) hammer-decky watchdog: $*" >> "$LOG"; }}

is_gamepad_steam() {{
  pgrep -af 'steamwebhelper.*-uimode=4 ' >/dev/null 2>&1 && return 0
  pgrep -af '/steam .*-gamepadui' >/dev/null 2>&1 && return 0
  return 1
}}

relaunch_steam() {{
  log "fallback: systemctl --user restart steam-launcher"
  if systemctl --user restart steam-launcher.service 2>>"$LOG"; then
    log "steam-launcher restart requested OK"
    return 0
  fi
  log "systemctl failed; trying direct steam -gamepadui"
  nohup steam -steamos3 -steampal -steamdeck -gamepadui >>"$LOG" 2>&1 &
  log "direct steam launch pid $!"
}}

log "started (pid $$, systemctl-restart path)"
sleep 2
for i in $(seq 1 40); do
  if is_gamepad_steam; then
    log "gamepad steam healthy (${{i}}s), done"
    exit 0
  fi
  sleep 1
done
log "gamepad steam not back after 40s — fallback relaunch"
relaunch_steam
for i in $(seq 1 20); do
  if is_gamepad_steam; then
    log "gamepad steam healthy after fallback (${{i}}s), done"
    exit 0
  fi
  sleep 1
done
log "relaunch finished but gamepad UI not confirmed"
"""

        ts = int(time.time())
        script_path = cache_dir / f"restart-watchdog-{ts}.sh"
        script_path.write_text("#!/usr/bin/env bash\n" + script, encoding="utf-8")
        script_path.chmod(0o755)
        unit = f"hammer-steam-watchdog-{ts}.service"

        proc = subprocess.Popen(
            [
                "systemd-run",
                "--user",
                f"--unit={unit}",
                "--description=Hammer Steam restart watchdog",
                "--collect",
                f"--working-directory={cache_dir}",
                str(script_path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=env,
        )
        try:
            _, stderr = proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            stderr = b"systemd-run communicate timeout"
            proc.returncode = 1
        if proc.returncode != 0:
            err = (stderr or b"").decode(errors="replace").strip()
            decky.logger.warning(
                f"hammer-decky: systemd-run watchdog failed ({proc.returncode}): "
                f"{err}; falling back to nohup script"
            )
            fb = subprocess.Popen(
                ["nohup", "bash", str(script_path)],
                start_new_session=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
            )
            decky.logger.info(
                f"hammer-decky: watchdog via nohup (pid={fb.pid}, log={log_path})"
            )
            return {"ok": True, "watchdog_pid": fb.pid, "log": str(log_path), "via": "nohup"}

        decky.logger.info(
            f"hammer-decky: steam restart watchdog scheduled (unit={unit}, "
            f"log={log_path})"
        )
        return {"ok": True, "unit": unit, "log": str(log_path), "via": "systemd-run"}

    async def restart_steam_for_hammer(self) -> dict[str, Any]:
        """
        Restart Steam for Hammer library refresh — Game Mode safe path.

        Do NOT call SteamClient.User.StartRestart() from the Decky frontend:
        in Game Mode that API leaves the user stuck on the 'Shutting Down'
        logo. Steam's own Restart menu works because it runs in a different
        context; our fix is systemctl --user restart steam-launcher, which
        is the same path steam-launcher uses on boot.
        """
        watchdog = await self.schedule_steam_relaunch()
        env = _subprocess_env()
        # Dispatch restart without blocking — systemctl restart waits for
        # the full stop+start cycle (~20s on Deck) which made the RPC hang
        # and the user stare at a blank screen for a minute.
        proc = subprocess.Popen(
            ["systemctl", "--user", "restart", "steam-launcher.service"],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        decky.logger.info(
            f"hammer-decky: systemctl restart dispatched (pid={proc.pid}, "
            f"watchdog={watchdog.get('via', '?')})"
        )
        return {
            "ok": True,
            "path": "systemctl --user restart steam-launcher (async)",
            "watchdog": watchdog,
            "dispatch_pid": proc.pid,
        }

    # Backward compat shim — earlier (v0.7) frontends called this name.
    async def clear_pending_refresh(self) -> dict[str, Any]:
        return await self.mark_restarted()

    # ── RPC: receive frontend diagnostics ───────────────────────────────
    async def report_diagnostic(self, label: str, payload: Any) -> None:
        try:
            blob = json.dumps(payload, default=str)[:8000]
        except Exception as ex:  # noqa: BLE001
            blob = f"<unserializable: {ex}>"
        decky.logger.info(f"hammer-decky DIAG[{label}]: {blob}")

    # ── RPC: dump backend state for the diagnostics panel ───────────────
    async def diagnostics_snapshot(self) -> dict[str, Any]:
        """
        One-shot backend status: cart contents (with cached titles),
        pending entries, title cache size, ValveOFF reachability.
        Used by the QAM panel's "Refresh diagnostics" button to give
        the user a single rich blob to screenshot when reporting
        issues.
        """
        bin_info = _find_valveoff()
        return {
            "version": "0.9.3",
            "valveoff_found": bin_info is not None,
            "cart": {
                "count": len(self._cart),
                "appids": list(self._cart),
                "titles": {
                    str(a): _TITLE_CACHE.get(a, f"AppID {a}")
                    for a in self._cart
                },
            },
            "pending_count": len(self._pending),
            "title_cache_size": len(_TITLE_CACHE),
            "title_cache_sample": dict(
                list(_TITLE_CACHE.items())[:8]
            ),
            "ts": int(time.time()),
        }

    # ── RPC: force a single title fetch (network probe) ─────────────────
    async def probe_title(self, appid: int) -> dict[str, Any]:
        """
        Frontend "Force resolve title" button calls this. Bypasses
        the cache entirely so we can confirm the Steam Web API path
        works end-to-end; the result IS still written into the cache
        on success, so subsequent cart_add / get_cart calls benefit.
        """
        try:
            appid_int = int(appid)
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid appid"}
        t0 = time.monotonic()
        try:
            name, status = await asyncio.wait_for(
                asyncio.to_thread(_fetch_title_blocking, appid_int),
                timeout=_TITLE_API_TIMEOUT + 1.0,
            )
        except asyncio.TimeoutError:
            name, status = None, "wait_for_timeout"
        except Exception as ex:  # noqa: BLE001
            name, status = None, f"exception_{type(ex).__name__}"
        elapsed = time.monotonic() - t0
        if name:
            _TITLE_CACHE[appid_int] = name
        decky.logger.info(
            f"hammer-decky: probe_title appid={appid_int} -> "
            f"name={name!r} status={status} elapsed={elapsed:.2f}s"
        )
        return {
            "ok":      name is not None,
            "appid":   appid_int,
            "name":    name,
            "status":  status,
            "elapsed": round(elapsed, 3),
        }


async def _read_lines(stream: asyncio.StreamReader) -> AsyncIterator[str]:
    """Yield decoded lines from an async stream, skipping blanks."""
    while True:
        raw = await stream.readline()
        if not raw:
            return
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        if line:
            yield line
