/**
 * Hammer Library — Quick Access Menu panel (v0.9.0).
 *
 * Four sections:
 *
 *   1. Add a game (manual)   — paste-an-AppID/URL → cart_add. Same flow
 *                              as the in-page button: it just queues
 *                              the AppID; ValveOFF doesn't run yet.
 *
 *   2. Cart (N items)        — the queue populated by the in-page
 *                              "Add to Library" button and / or the
 *                              paste-input above. Each row has a
 *                              "remove" button. The big "Process
 *                              cart" button below it fans out to
 *                              ValveOFF for every cart item and
 *                              shows a success/fail summary modal.
 *
 *   3. Apply pending changes — entries that already have a .hammer
 *                              file on disk (i.e. successful cart
 *                              processing in this session). Clicking
 *                              "Restart Steam" opens the 10-second
 *                              countdown.
 *
 *   4. Installed             — every .hammer file currently in
 *                              ~/.config/hammersteam/, with a
 *                              per-row delete button.
 *
 * Together these mirror the user's original brief: "kada Add to
 * Library parang add to cart … 5 yung na-add … click to ADD then
 * sasabihin mga successful add at fail."
 */

import { toaster } from "@decky/api";
import {
    ButtonItem,
    DialogButton,
    Field,
    Focusable,
    PanelSection,
    PanelSectionRow,
    Spinner,
} from "@decky/ui";
import { FC, useCallback, useEffect, useState } from "react";

import { showAppIdInputModal } from "./appIdInputModal";
import { AppIdDigitPad } from "./appIdDigitPad";

import {
    cartAdd,
    cartClear,
    cartRemove,
    coerceAppid,
    diagnosticsSnapshot,
    formatBytes,
    getCart,
    getPending,
    healthCheck,
    listInstalled,
    probeTitle,
    processCart,
    removeGame,
    resolveTitlesSafe,
    timeAgo,
    titleFor,
    type CartContents,
    type DiagnosticsSnapshot,
    type HealthResult,
    type InstalledGame,
    type PendingResult,
    type TitleMap,
} from "./api";
import { showCartResultsModal } from "./cartResultsModal";
import { useDetectionState } from "./detectionState";
import { FaHammer, FaPlus, FaSyncAlt, FaTrash } from "./icons";
import { startSteamRestartCountdown } from "./restart";

export const HammerLibraryPanel: FC = () => {
    const [health, setHealth] = useState<HealthResult | null>(null);
    const [installed, setInstalled] = useState<InstalledGame[]>([]);
    const [pending, setPending] = useState<PendingResult>({ count: 0, entries: [] });
    const [cart, setCart] = useState<CartContents>({ count: 0, appids: [] });
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [statusLine, setStatusLine] = useState<string | null>(null);
    const detection = useDetectionState();
    // Title cache for the *Installed* list (not covered by getCart).
    // Backend caches titles for cart entries, but installed entries
    // come straight from disk and need an explicit resolveTitles call.
    const [installedTitles, setInstalledTitles] = useState<TitleMap>({});
    // Cached title for the "ADD THIS GAME" detected-AppID button so
    // the button label can read "Add 'Stardew Valley' to cart" rather
    // than "Add 413150 to cart".
    const [detectedTitle, setDetectedTitle] = useState<string | null>(null);
    // Diagnostics-section state: last `probe_title` result and last
    // `diagnostics_snapshot` blob, both rendered as small status
    // lines under their respective buttons.
    const [probeStatus, setProbeStatus] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);

    // ── refresh helpers ────────────────────────────────────────────────────

    const refreshHealth = useCallback(async () => {
        try {
            setHealth(await healthCheck());
        } catch (ex) {
            setHealth({ ok: false, reason: "rpc_failed", error: String(ex) });
        }
    }, []);

    const refreshInstalled = useCallback(async () => {
        try {
            setInstalled(await listInstalled());
        } catch (ex) {
            console.error("[hammer-decky] list_installed failed", ex);
        }
    }, []);

    const refreshPending = useCallback(async () => {
        try {
            setPending(await getPending());
        } catch (ex) {
            console.error("[hammer-decky] get_pending failed", ex);
        }
    }, []);

    const refreshCart = useCallback(async () => {
        try {
            setCart(await getCart());
        } catch (ex) {
            console.error("[hammer-decky] get_cart failed", ex);
        }
    }, []);

    const refreshAll = useCallback(async () => {
        await Promise.all([
            refreshHealth(),
            refreshInstalled(),
            refreshPending(),
            refreshCart(),
        ]);
    }, [refreshHealth, refreshInstalled, refreshPending, refreshCart]);

    useEffect(() => {
        void refreshAll();
        // Periodic re-poll of cart + pending so panel stays in sync
        // when the user adds via the in-page button while the panel
        // is open.
        const id = window.setInterval(() => {
            void refreshCart();
            void refreshPending();
        }, 2_000);
        return () => window.clearInterval(id);
    }, [refreshAll, refreshCart, refreshPending]);

    // Resolve titles for the Installed list whenever it changes
    // (entries are added / removed). The backend keeps a session
    // cache so re-resolving the same set is cheap.
    useEffect(() => {
        const ids = installed.map((g) => g.appid).filter((a) => a > 0);
        const missing = ids.filter((a) => !installedTitles[String(a)]);
        if (missing.length === 0) return;
        let cancelled = false;
        void (async () => {
            const resolved = await resolveTitlesSafe(missing);
            if (cancelled) return;
            setInstalledTitles((prev) => ({ ...prev, ...resolved }));
        })();
        return () => {
            cancelled = true;
        };
    }, [installed, installedTitles]);

    // Resolve the title for the currently-detected AppID so the
    // "ADD THIS GAME" button can render the actual game name. Refreshes
    // whenever the user navigates to a different store page.
    useEffect(() => {
        const appid = detection.appid;
        if (appid == null) {
            setDetectedTitle(null);
            return;
        }
        // Optimistic: if the cart already has it, the title is in
        // cart.titles and we can avoid a roundtrip.
        const cached = cart.titles?.[String(appid)] ?? installedTitles[String(appid)];
        if (cached) {
            setDetectedTitle(cached);
            return;
        }
        let cancelled = false;
        void (async () => {
            const map = await resolveTitlesSafe([appid]);
            if (cancelled) return;
            setDetectedTitle(map[String(appid)] ?? null);
        })();
        return () => {
            cancelled = true;
        };
    }, [detection.appid, cart.titles, installedTitles]);

    // ── actions ────────────────────────────────────────────────────────────

    const addAppidToCart = useCallback(
        async (appid: number, hint: string) => {
            setBusy(true);
            try {
                const res = await cartAdd(appid);
                const friendly = res.title ?? hint;
                if (res.ok) {
                    setStatusLine(
                        res.added
                            ? `Added "${friendly}" to cart (${res.cart_count ?? "?"} total).`
                            : `"${friendly}" was already in cart.`,
                    );
                    await refreshCart();
                    return true;
                }
                setStatusLine(`Failed: ${res.error ?? "unknown"}`);
                return false;
            } catch (ex) {
                setStatusLine(`RPC error: ${ex}`);
                return false;
            } finally {
                setBusy(false);
            }
        },
        [refreshCart],
    );

    const onOpenInputModal = useCallback(async () => {
        if (busy) return;
        const next = await showAppIdInputModal({ initial: input });
        if (next != null) setInput(next);
    }, [busy, input]);

    const onAddToCart = useCallback(async () => {
        if (!input.trim() || busy) return;
        const appid = coerceAppid(input.trim());
        if (appid == null) {
            setStatusLine("Invalid AppID or Steam Store URL.");
            return;
        }
        const ok = await addAppidToCart(appid, `AppID ${appid}`);
        if (ok) setInput("");
    }, [input, busy, addAppidToCart]);

    // "ADD THIS GAME" — one-tap shortcut that uses the AppID currently
    // detected by the in-page injector (URL polling / SteamClient.URL
    // event / DOM scrape). Skips the input field entirely; the user
    // doesn't have to remember or type the AppID. This is the
    // primary path for the Big Picture web-store case where the
    // floating banner sometimes can't be rendered.
    const onAddThisGame = useCallback(async () => {
        if (busy) return;
        const appid = detection.appid;
        if (appid == null) {
            setStatusLine(
                "No game detected on the current page. Open a Steam app page first.",
            );
            return;
        }
        await addAppidToCart(appid, detectedTitle ?? `AppID ${appid}`);
    }, [busy, detection.appid, detectedTitle, addAppidToCart]);

    const onRemoveFromCart = useCallback(
        async (appid: number) => {
            try {
                const res = await cartRemove(appid);
                if (res.ok && res.removed) {
                    setStatusLine(`Removed AppID ${appid} from cart.`);
                }
                await refreshCart();
            } catch (ex) {
                setStatusLine(`Remove failed: ${ex}`);
            }
        },
        [refreshCart],
    );

    const onClearCart = useCallback(async () => {
        try {
            const res = await cartClear();
            if (res.ok) {
                setStatusLine(`Cart cleared (${res.cleared ?? 0} entries).`);
            }
            await refreshCart();
        } catch (ex) {
            setStatusLine(`Clear failed: ${ex}`);
        }
    }, [refreshCart]);

    const onProcessCart = useCallback(async () => {
        if (busy || cart.count === 0) return;
        setBusy(true);
        setStatusLine(`Processing ${cart.count} cart item(s) via ValveOFF…`);
        try {
            const result = await processCart();
            await Promise.all([refreshCart(), refreshPending(), refreshInstalled()]);
            setStatusLine(
                `Cart processed — ${result.successful.length} ok, ${result.failed.length} failed`,
            );
            toaster.toast({
                title: "Hammer cart",
                body: `${result.successful.length} of ${
                    result.successful.length + result.failed.length
                } AppIDs added. Restart Steam to apply.`,
                icon: <FaHammer />,
                duration: 5000,
            });
            await showCartResultsModal(result, result.pending_count);
            // After the modal is dismissed (whether or not user
            // chose Restart), re-pull state so the panel reflects
            // any restart-related side-effects (none, on cancel) or
            // the queue having been emptied (on restart, but the
            // panel will be torn down with Steam in that case).
            await Promise.all([refreshCart(), refreshPending()]);
        } catch (ex) {
            setStatusLine(`Process failed: ${ex}`);
        } finally {
            setBusy(false);
        }
    }, [busy, cart.count, refreshCart, refreshPending, refreshInstalled]);

    const onRestart = useCallback(async () => {
        const result = await startSteamRestartCountdown({
            pendingCount: pending.count,
            source: "panel_apply",
        });
        if (result === "cancelled") {
            setStatusLine("Restart cancelled. Pending queue is unchanged.");
            await refreshPending();
        }
    }, [pending.count, refreshPending]);

    const onRemoveInstalled = useCallback(
        async (appid: number) => {
            try {
                const res = await removeGame(appid);
                setStatusLine(
                    res.ok
                        ? `Removed ${res.filename ?? `${appid}.hammer`}`
                        : `Remove failed: ${res.error}`,
                );
                await Promise.all([refreshInstalled(), refreshPending()]);
            } catch (ex) {
                setStatusLine(`Remove failed: ${ex}`);
            }
        },
        [refreshInstalled, refreshPending],
    );

    // ── render ─────────────────────────────────────────────────────────────

    return (
        <>
            <PanelSection title="Add a game">
                {health && !health.ok && (
                    <PanelSectionRow>
                        <Field
                            label="Backend status"
                            description={`ValveOFF unavailable: ${health.reason}${
                                "error" in health && health.error ? ` (${health.error})` : ""
                            }`}
                            highlightOnFocus
                        />
                    </PanelSectionRow>
                )}
                {health && health.ok && (
                    <PanelSectionRow>
                        <Field
                            label="Backend"
                            description={
                                health.cli_ready
                                    ? `Ready (v${health.version ?? "?"}) — ${health.valveoff_path}`
                                    : "ValveOFF found but --cli mode unavailable. Update ValveOFF."
                            }
                        />
                    </PanelSectionRow>
                )}

                {detection.appid != null && (
                    <PanelSectionRow>
                        <ButtonItem
                            layout="below"
                            disabled={busy || health?.ok === false}
                            onClick={() => void onAddThisGame()}
                        >
                            <Focusable
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    color: "#fff",
                                    background: "rgba(196, 38, 38, 0.95)",
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                    fontWeight: 700,
                                }}
                            >
                                <FaPlus />
                                {detectedTitle
                                    ? `ADD THIS GAME — ${detectedTitle}`
                                    : `ADD THIS GAME — AppID ${detection.appid}`}
                            </Focusable>
                        </ButtonItem>
                    </PanelSectionRow>
                )}
                {detection.appid != null && (
                    <PanelSectionRow>
                        <Field
                            label="Detected on current page"
                            description={`AppID ${detection.appid}${
                                detectedTitle ? ` · ${detectedTitle}` : " · (resolving title…)"
                            }`}
                        />
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        disabled={busy}
                        onClick={() => void onOpenInputModal()}
                    >
                        <Focusable
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: "4px",
                            }}
                        >
                            <span style={{ fontWeight: 700 }}>
                                {input.trim()
                                    ? "Edit AppID / Store URL"
                                    : "Enter AppID or Store URL"}
                            </span>
                            <span style={{ fontSize: "12px", opacity: 0.8 }}>
                                {input.trim()
                                    ? input
                                    : "Opens keyboard modal (Steam + X if keyboard missing)"}
                            </span>
                        </Focusable>
                    </ButtonItem>
                </PanelSectionRow>

                <AppIdDigitPad value={input} onChange={setInput} disabled={busy} />

                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        disabled={busy || !input.trim() || health?.ok === false}
                        onClick={() => void onAddToCart()}
                    >
                        {busy ? (
                            <Focusable
                                style={{ display: "flex", alignItems: "center", gap: "8px" }}
                            >
                                <Spinner style={{ width: 16, height: 16 }} />
                                Adding to cart…
                            </Focusable>
                        ) : (
                            <Focusable
                                style={{ display: "flex", alignItems: "center", gap: "8px" }}
                            >
                                <FaPlus />
                                Add to cart
                            </Focusable>
                        )}
                    </ButtonItem>
                </PanelSectionRow>

                {statusLine && (
                    <PanelSectionRow>
                        <Field label="Status" description={statusLine} />
                    </PanelSectionRow>
                )}
            </PanelSection>

            <PanelSection title={`Cart (${cart.count} item${cart.count === 1 ? "" : "s"})`}>
                <PanelSectionRow>
                    <Field
                        label={
                            cart.count === 0
                                ? "Cart is empty"
                                : `${cart.count} AppID${cart.count === 1 ? "" : "s"} ready to process`
                        }
                        description={
                            cart.count === 0
                                ? "Tap the in-page Add to Library button on a Steam app page (or paste an AppID above)."
                                : "Press Process cart to run ValveOFF on every item. Successful ones move to Pending; failed ones stay in cart."
                        }
                    />
                </PanelSectionRow>

                {cart.appids.slice(0, 16).map((id) => (
                    <PanelSectionRow key={`cart-${id}`}>
                        <Focusable
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "8px",
                                width: "100%",
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <Field
                                    label={titleFor(id, cart.titles)}
                                    description={`AppID ${id} · queued`}
                                />
                            </div>
                            <DialogButton
                                onClick={() => void onRemoveFromCart(id)}
                                style={{ minWidth: "32px", padding: "4px 8px" }}
                            >
                                <FaTrash />
                            </DialogButton>
                        </Focusable>
                    </PanelSectionRow>
                ))}
                {cart.appids.length > 16 && (
                    <PanelSectionRow>
                        <Field
                            label="…"
                            description={`+${cart.appids.length - 16} more in cart`}
                        />
                    </PanelSectionRow>
                )}

                {cart.count > 0 && (
                    <>
                        <PanelSectionRow>
                            <ButtonItem
                                layout="below"
                                disabled={busy || health?.ok === false}
                                onClick={() => void onProcessCart()}
                            >
                                {busy ? (
                                    <Focusable
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                        }}
                                    >
                                        <Spinner style={{ width: 16, height: 16 }} />
                                        Processing…
                                    </Focusable>
                                ) : (
                                    <Focusable
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                        }}
                                    >
                                        <FaHammer />
                                        Process cart ({cart.count})
                                    </Focusable>
                                )}
                            </ButtonItem>
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <DialogButton
                                onClick={() => void onClearCart()}
                                style={{ width: "100%" }}
                                disabled={busy}
                            >
                                <Focusable
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                    }}
                                >
                                    <FaTrash />
                                    Clear cart
                                </Focusable>
                            </DialogButton>
                        </PanelSectionRow>
                    </>
                )}
            </PanelSection>

            <PanelSection title="Apply pending changes">
                <PanelSectionRow>
                    <Field
                        label={
                            pending.count === 0
                                ? "No pending games"
                                : `${pending.count} game${pending.count === 1 ? "" : "s"} waiting for restart`
                        }
                        description={
                            pending.count === 0
                                ? "Process cart first; successful items will land here."
                                : "Hammer's hook only refires when Steam starts. Restart now to bring the new game(s) into the library."
                        }
                    />
                </PanelSectionRow>

                {pending.entries.slice(0, 6).map((e) => (
                    <PanelSectionRow key={`pending-${e.appid}`}>
                        <Field
                            label={e.title || `AppID ${e.appid}`}
                            description={`AppID ${e.appid} · added ${timeAgo(e.added_at)}`}
                        />
                    </PanelSectionRow>
                ))}
                {pending.entries.length > 6 && (
                    <PanelSectionRow>
                        <Field
                            label="…"
                            description={`+${pending.entries.length - 6} more queued`}
                        />
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        disabled={busy || health?.ok === false}
                        onClick={() => void onRestart()}
                    >
                        <Focusable style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <FaSyncAlt />
                            Restart Steam (10s countdown)
                        </Focusable>
                    </ButtonItem>
                </PanelSectionRow>
            </PanelSection>

            <PanelSection title={`Installed (${installed.length})`}>
                <PanelSectionRow>
                    <DialogButton
                        onClick={() => void refreshInstalled()}
                        style={{ width: "100%" }}
                    >
                        <Focusable style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <FaSyncAlt />
                            Rescan disk
                        </Focusable>
                    </DialogButton>
                </PanelSectionRow>

                {installed.length === 0 && (
                    <PanelSectionRow>
                        <Field
                            label="No .hammer files"
                            description="Add a game above, or copy .hammer files into ~/.config/hammersteam/."
                        />
                    </PanelSectionRow>
                )}

                {installed.slice(0, 12).map((g) => {
                    const title = installedTitles[String(g.appid)];
                    return (
                        <PanelSectionRow key={g.filename}>
                            <Focusable
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "8px",
                                    width: "100%",
                                }}
                            >
                                <div style={{ flex: 1 }}>
                                    <Field
                                        label={title || `AppID ${g.appid || "?"}`}
                                        description={`${
                                            g.appid
                                                ? `AppID ${g.appid} · `
                                                : ""
                                        }${g.filename} • ${formatBytes(
                                            g.size_bytes,
                                        )} • ${timeAgo(g.mtime)}`}
                                    />
                                </div>
                                <DialogButton
                                    onClick={() => void onRemoveInstalled(g.appid)}
                                    style={{ minWidth: "32px", padding: "4px 8px" }}
                                >
                                    <FaTrash />
                                </DialogButton>
                            </Focusable>
                        </PanelSectionRow>
                    );
                })}
                {installed.length > 12 && (
                    <PanelSectionRow>
                        <Field label="…" description={`+${installed.length - 12} more`} />
                    </PanelSectionRow>
                )}
            </PanelSection>

            <PanelSection title="Diagnostics">
                <PanelSectionRow>
                    <Field
                        label="Plugin version (frontend)"
                        description={`v${detection.pluginVersion}`}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <Field
                        label="Backend version"
                        description={
                            health?.ok
                                ? `v${health.version ?? "?"}`
                                : "(backend not ready)"
                        }
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <Field
                        label="Detected AppID"
                        description={
                            detection.appid != null
                                ? `${detection.appid} — button ${
                                      detection.lastTitle ? "anchored" : "floating fallback"
                                  }`
                                : "(none — open a Steam app page)"
                        }
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <Field
                        label="Detection sources"
                        description={`SteamClient.URL=${
                            detection.sources.url ?? "—"
                        } • route=${detection.sources.route ?? "—"} • DOM=${
                            detection.sources.dom ?? "—"
                        }`}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <Field
                        label="Last route"
                        description={detection.lastUrl || "(empty)"}
                    />
                </PanelSectionRow>
                {detection.lastTitle && (
                    <PanelSectionRow>
                        <Field
                            label="Anchored to title"
                            description={detection.lastTitle}
                        />
                    </PanelSectionRow>
                )}
                {detection.appid != null && (
                    <PanelSectionRow>
                        <ButtonItem
                            layout="below"
                            disabled={busy}
                            onClick={() => {
                                setInput(String(detection.appid));
                                setStatusLine(
                                    `Pasted AppID ${detection.appid} from current page.`,
                                );
                            }}
                        >
                            <Focusable
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }}
                            >
                                <FaPlus />
                                Copy detected AppID into input
                            </Focusable>
                        </ButtonItem>
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        disabled={busy}
                        onClick={() => {
                            void (async () => {
                                const probe_id =
                                    coerceAppid(input.trim()) ??
                                    detection.appid ??
                                    413150; // Stardew Valley as a known-good
                                setProbeStatus(`probing ${probe_id}…`);
                                try {
                                    const res = await probeTitle(probe_id);
                                    if (res.ok) {
                                        setProbeStatus(
                                            `OK · ${probe_id} → "${res.name}" (${res.status}, ${
                                                res.elapsed ?? "?"
                                            }s)`,
                                        );
                                    } else {
                                        setProbeStatus(
                                            `FAIL · ${probe_id} status=${
                                                res.status ?? "?"
                                            }${
                                                res.elapsed != null
                                                    ? ` (${res.elapsed}s)`
                                                    : ""
                                            }`,
                                        );
                                    }
                                } catch (ex) {
                                    setProbeStatus(`RPC error: ${ex}`);
                                }
                            })();
                        }}
                    >
                        <Focusable
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}
                        >
                            <FaSyncAlt />
                            Force probe title (AppID = input/detected/413150)
                        </Focusable>
                    </ButtonItem>
                </PanelSectionRow>
                {probeStatus && (
                    <PanelSectionRow>
                        <Field
                            label="Last probe"
                            description={probeStatus}
                        />
                    </PanelSectionRow>
                )}

                <PanelSectionRow>
                    <ButtonItem
                        layout="below"
                        disabled={busy}
                        onClick={() => {
                            void (async () => {
                                try {
                                    const snap = await diagnosticsSnapshot();
                                    setSnapshot(snap);
                                } catch (ex) {
                                    setStatusLine(
                                        `diagnostics_snapshot RPC failed: ${ex}`,
                                    );
                                }
                            })();
                        }}
                    >
                        <Focusable
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}
                        >
                            <FaSyncAlt />
                            Refresh backend snapshot
                        </Focusable>
                    </ButtonItem>
                </PanelSectionRow>
                {snapshot && (
                    <>
                        <PanelSectionRow>
                            <Field
                                label="Title-cache size"
                                description={`${snapshot.title_cache_size} resolved title(s) in session cache`}
                            />
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <Field
                                label="Cache sample"
                                description={
                                    Object.keys(snapshot.title_cache_sample).length === 0
                                        ? "(empty — title resolver hasn't successfully fetched anything yet)"
                                        : Object.entries(snapshot.title_cache_sample)
                                              .map(
                                                  ([id, name]) => `${id} → ${name}`,
                                              )
                                              .join(" · ")
                                }
                            />
                        </PanelSectionRow>
                    </>
                )}
            </PanelSection>
        </>
    );
};
