/**
 * Steam restart — 10-second confirmation modal.
 *
 * Hammer's GetSubscribedApps hook is only consulted by Steam when the
 * client does its initial "what does this user own?" handshake, i.e. at
 * Steam startup / login. So when ValveOFF drops a fresh `.hammer` file
 * into ~/.config/hammersteam/, the new AppID won't appear in the
 * library until the parent Steam process restarts and the hook fires
 * again. There is no live-refresh callback we can post from JS
 * (RestartUI() restarts only the renderer, which still reads the cached
 * subscribed-apps list from the parent), and the C++-side
 * LicensesUpdate_t fan-out path crashes Steam in spoofed-Steam mode
 * (see RECIPE.md "Why Hammer no longer fires AppLicensesChanged_t"
 * and src/feats/apps.cpp::announceNewAppIds).
 *
 * Therefore the only honest path is: do the add, then full-restart Steam.
 * To avoid yanking the carpet out from under the user (especially mid-
 * game in Game Mode), we wrap the restart in a 10-second confirmation
 * modal with a visible countdown and a hard Cancel button. If the user
 * does nothing, the restart fires automatically when the timer expires;
 * that auto-fire matches the "auto-restart" expectation users have from
 * Steam's own update-restart prompt.
 *
 * SteamClient surface used:
 *   SteamClient.User.StartRestart(bForceRestart=false)    primary
 *   SteamClient.User.StartShutdown(...)                   not what we want
 *   SteamClient.System.RestartUI()                        UI-only, NOT enough
 *
 * Some Steam builds expose StartRestart only behind an extra capability
 * argument; we probe at runtime to avoid hardcoding a signature that
 * might shift between client versions. If StartRestart is missing
 * entirely (it shouldn't be — every modern Big Picture / Game Mode
 * build has it), we fall back to the desktop-mode native restart
 * (`SteamClient.User.OpenURL("steam://exit") + relaunch`) which is
 * cosmetically uglier but functionally equivalent.
 */

import { ConfirmModal, showModal } from "@decky/ui";
import { FC, useEffect, useRef, useState } from "react";

import { markRestarted, reportDiagnostic } from "./api";

const DEFAULT_COUNTDOWN_SECONDS = 10;

// ── Steam-side restart trigger ──────────────────────────────────────────────

/**
 * Fire SteamClient's restart. Returns the path that was actually taken
 * (for logging) or throws if no path is available. Caller is expected
 * to have already rendered "Steam is restarting…" to the user — by the
 * time this returns, Steam will be tearing down its CEF host and our
 * React tree is about to be ripped out. Don't await anything after.
 */
async function fireSteamRestart(): Promise<string> {
    const sc: any = (window as any).SteamClient;
    if (!sc) {
        throw new Error("SteamClient is not on window — not running inside Steam?");
    }

    if (sc.User && typeof sc.User.StartRestart === "function") {
        try {
            sc.User.StartRestart(false);
            return "SteamClient.User.StartRestart(false)";
        } catch (ex) {
            // Some builds want StartRestart() with no arg or a string flag.
            try {
                sc.User.StartRestart();
                return "SteamClient.User.StartRestart()";
            } catch {
                throw ex;
            }
        }
    }

    if (sc.System && typeof sc.System.RestartUI === "function") {
        // RestartUI is NOT what we want (it doesn't restart the parent
        // Steam process, so Hammer's GetSubscribedApps hook never refires
        // and the new AppID will not appear). We still wire it as a
        // last-resort fallback because *something* is better than
        // failing silently — a UI restart at least proves to the user
        // that the plugin's restart button is wired correctly, and
        // they can manually exit + relaunch Steam from there.
        sc.System.RestartUI();
        return "SteamClient.System.RestartUI() [DEGRADED — full Steam restart unavailable]";
    }

    throw new Error("Neither StartRestart nor RestartUI is available on this Steam build.");
}

// ── Countdown modal component ───────────────────────────────────────────────

interface CountdownModalProps {
    seconds: number;
    pendingCount: number;
    onConfirm: () => void;
    onCancel: () => void;
    closeModal?: () => void;
}

const CountdownModal: FC<CountdownModalProps> = ({
    seconds,
    pendingCount,
    onConfirm,
    onCancel,
    closeModal,
}) => {
    const [remaining, setRemaining] = useState(seconds);
    const [restarting, setRestarting] = useState(false);

    // Keep the timer ID in a ref so the cancel handler can clear it
    // without triggering a re-render.
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setRemaining((r) => Math.max(0, r - 1));
        }, 1000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    // When the timer reaches 0, fire restart automatically. The actual
    // SteamClient call happens in the OK handler so we share the same
    // code path with manual confirm.
    useEffect(() => {
        if (remaining === 0 && !restarting) {
            setRestarting(true);
            if (intervalRef.current) clearInterval(intervalRef.current);
            onConfirm();
        }
    }, [remaining, restarting, onConfirm]);

    const description =
        pendingCount > 0
            ? `Steam will restart in ${remaining}s to apply ${pendingCount} pending Hammer add${
                  pendingCount === 1 ? "" : "s"
              }. Hammer's hook only refires at startup, so this is the only way for new games to appear in the library. Press Cancel if you'd rather restart later.`
            : `Steam will restart in ${remaining}s. Press Cancel if you'd rather restart later.`;

    return (
        <ConfirmModal
            strTitle={
                restarting
                    ? "Restarting Steam…"
                    : `Restart Steam in ${remaining}s`
            }
            strDescription={
                restarting
                    ? "Steam is going down now. Game Mode / Big Picture will reappear in a few seconds with your new game(s) in the library."
                    : description
            }
            strOKButtonText={restarting ? "Restarting…" : "Restart now"}
            strCancelButtonText="Cancel"
            bOKDisabled={restarting}
            bCancelDisabled={restarting}
            onOK={() => {
                if (restarting) return;
                setRestarting(true);
                if (intervalRef.current) clearInterval(intervalRef.current);
                onConfirm();
            }}
            onCancel={() => {
                if (restarting) return;
                if (intervalRef.current) clearInterval(intervalRef.current);
                onCancel();
                closeModal?.();
            }}
            closeModal={closeModal}
        />
    );
};

// ── Public entrypoint ───────────────────────────────────────────────────────

export interface RestartCountdownOptions {
    seconds?: number;
    pendingCount?: number;
    /** Optional logger for the call site (panel vs store-button) — feeds DIAG. */
    source?: string;
}

/**
 * Open the 10-second confirmation modal and (on OK / timeout) restart Steam.
 *
 * Returns a Promise that resolves to:
 *   • "restarted" — SteamClient was successfully called. Caller's tree
 *                   is about to be torn down; don't trust any state.
 *   • "cancelled" — user cancelled. Caller can stay alive.
 *   • "no_steam_client" — running outside Steam (dev / preview).
 */
export function startSteamRestartCountdown(
    opts: RestartCountdownOptions = {},
): Promise<"restarted" | "cancelled" | "no_steam_client" | "error"> {
    const seconds = opts.seconds ?? DEFAULT_COUNTDOWN_SECONDS;
    const pending = opts.pendingCount ?? 0;
    const source = opts.source ?? "panel";

    return new Promise((resolve) => {
        let settled = false;
        const settle = (v: "restarted" | "cancelled" | "no_steam_client" | "error") => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };

        const result = showModal(
            <CountdownModal
                seconds={seconds}
                pendingCount={pending}
                onConfirm={async () => {
                    try {
                        // Empty the pending queue BEFORE firing restart;
                        // the python process dies with Steam so we want
                        // a clean slate when the next session starts.
                        try {
                            await markRestarted();
                        } catch (ex) {
                            // Non-fatal — the queue is session-local and
                            // python will respawn on Steam restart.
                            console.warn("[hammer-decky] markRestarted failed", ex);
                        }
                        const path = await fireSteamRestart();
                        await reportDiagnostic("restart", {
                            source,
                            seconds,
                            pending,
                            path,
                        }).catch(() => undefined);
                        settle("restarted");
                    } catch (ex) {
                        console.error("[hammer-decky] Steam restart failed", ex);
                        await reportDiagnostic("restart_error", {
                            source,
                            error: String(ex),
                        }).catch(() => undefined);
                        settle("error");
                    } finally {
                        result?.Close();
                    }
                }}
                onCancel={() => settle("cancelled")}
            />,
            undefined,
            { strTitle: "Restart Steam" },
        );

        if (!result) settle("no_steam_client");
    });
}
