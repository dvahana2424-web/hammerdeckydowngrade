/**
 * Cart-process results modal.
 *
 * Shown immediately after the QAM panel's "Process cart" button
 * finishes its batch run on the backend. Lists each AppID with a
 * green tick (success — .hammer file produced, will appear after
 * Steam restart) or a red cross (failure — ValveOFF returned an error
 * message, the AppID stays in the cart so the user can retry).
 *
 * The modal also has an inline path to the next obvious step: if any
 * of the items succeeded, a "Restart Steam now" button hands off to
 * the existing 10-second restart countdown. If everything failed, we
 * just show a "Close" button — the user can read the per-line error
 * messages and decide what to do.
 *
 * We deliberately use `ModalRoot` with custom children rather than
 * `ConfirmModal`, because the per-row content needs more layout
 * flexibility than ConfirmModal's `strDescription` text affords.
 */

import { ModalRoot, showModal } from "@decky/ui";
import { FC } from "react";

import type { CartProcessResult } from "./api";
import { startSteamRestartCountdown } from "./restart";

interface CartResultsBodyProps {
    result: CartProcessResult;
    closeModal?: () => void;
    onRestart: () => void;
}

const CartResultsBody: FC<CartResultsBodyProps> = ({ result, closeModal, onRestart }) => {
    const { results, successful, failed, cart_remaining, pending_count } = result;
    const anySucceeded = successful.length > 0;

    return (
        <ModalRoot
            onCancel={() => closeModal?.()}
            onEscKeypress={() => closeModal?.()}
            bAllowFullSize={false}
            closeModal={closeModal}
        >
            <div style={{ padding: "4px 0 12px 0", maxHeight: "60vh", overflowY: "auto" }}>
                <div
                    style={{
                        fontSize: "16px",
                        fontWeight: 700,
                        marginBottom: "10px",
                    }}
                >
                    Cart processed — {successful.length} succeeded
                    {failed.length > 0 ? `, ${failed.length} failed` : ""}
                </div>

                <div
                    style={{
                        fontSize: "13px",
                        opacity: 0.8,
                        marginBottom: "14px",
                        lineHeight: 1.4,
                    }}
                >
                    {anySucceeded
                        ? `${successful.length} .hammer file${
                              successful.length === 1 ? " is" : "s are"
                          } now on disk. ${
                              pending_count > 0
                                  ? `Restart Steam to bring ${pending_count} game${
                                        pending_count === 1 ? "" : "s"
                                    } into the library.`
                                  : "Restart Steam to apply."
                          }`
                        : "No .hammer files were produced. Failed items remain in cart so you can retry."}
                </div>

                {results.length === 0 && (
                    <div style={{ opacity: 0.6, fontSize: "13px" }}>Cart was empty.</div>
                )}

                {results.map((r) => (
                    <div
                        key={r.appid}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 10px",
                            margin: "4px 0",
                            borderRadius: "4px",
                            background: r.ok
                                ? "rgba(28, 134, 60, 0.18)"
                                : "rgba(176, 32, 32, 0.18)",
                            border: `1px solid ${
                                r.ok
                                    ? "rgba(28, 134, 60, 0.35)"
                                    : "rgba(176, 32, 32, 0.35)"
                            }`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span
                                style={{
                                    width: "20px",
                                    fontSize: "16px",
                                    fontWeight: 700,
                                    color: r.ok ? "#2adb5e" : "#ff6b6b",
                                    textAlign: "center",
                                }}
                            >
                                {r.ok ? "✓" : "✗"}
                            </span>
                            <div>
                                <div style={{ fontWeight: 600 }}>
                                    {r.title || `AppID ${r.appid}`}
                                </div>
                                <div
                                    style={{
                                        fontSize: "12px",
                                        opacity: 0.75,
                                        marginTop: "2px",
                                    }}
                                >
                                    AppID {r.appid} ·{" "}
                                    {r.ok
                                        ? `stage=${r.stage} — .hammer ready`
                                        : r.error || `failed at ${r.stage}`}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

                {cart_remaining > 0 && (
                    <div
                        style={{
                            marginTop: "12px",
                            padding: "8px 12px",
                            background: "rgba(184, 109, 33, 0.15)",
                            border: "1px solid rgba(184, 109, 33, 0.35)",
                            borderRadius: "4px",
                            fontSize: "12px",
                            opacity: 0.9,
                        }}
                    >
                        {cart_remaining} item{cart_remaining === 1 ? "" : "s"} still in cart.
                        You can retry from the QAM panel after fixing the underlying issue
                        (e.g. internet drop, AppID typo).
                    </div>
                )}

                <div
                    style={{
                        display: "flex",
                        gap: "8px",
                        marginTop: "16px",
                        justifyContent: "flex-end",
                    }}
                >
                    <button
                        onClick={() => closeModal?.()}
                        style={{
                            padding: "8px 16px",
                            borderRadius: "4px",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            background: "rgba(255, 255, 255, 0.06)",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: 600,
                        }}
                    >
                        Close
                    </button>
                    {anySucceeded && (
                        <button
                            onClick={() => {
                                closeModal?.();
                                onRestart();
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: "4px",
                                border: "1px solid rgba(28, 134, 60, 0.6)",
                                background: "rgba(28, 134, 60, 0.85)",
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: "13px",
                                fontWeight: 700,
                            }}
                        >
                            Restart Steam (10s)
                        </button>
                    )}
                </div>
            </div>
        </ModalRoot>
    );
};

/**
 * Open the modal. Resolves to "restarted" / "closed" so callers can
 * decide whether to refresh their state. The promise also implicitly
 * tracks the modal's lifetime — the caller can `await` on it before
 * doing UI work that should happen after the user dismisses.
 */
export function showCartResultsModal(
    result: CartProcessResult,
    pendingCount: number,
): Promise<"restarted" | "closed"> {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (v: "restarted" | "closed") => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };

        const handle = showModal(
            <CartResultsBody
                result={result}
                onRestart={() => {
                    void startSteamRestartCountdown({
                        pendingCount: pendingCount || result.successful.length,
                        source: "cart_results_modal",
                    }).then(() => settle("restarted"));
                }}
                closeModal={() => {
                    handle?.Close();
                    settle("closed");
                }}
            />,
            undefined,
            { strTitle: "Hammer cart results" },
        );

        if (!handle) settle("closed");
    });
}
