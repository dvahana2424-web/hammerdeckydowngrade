/**
 * Hammer Library — Decky Loader plugin (v0.9.0).
 *
 * What this plugin gives the user:
 *
 *   1. A "Hammer Library" section in the Quick Access Menu (QAM) with
 *      a paste-AppID/URL field, a cart view, a "Process cart" button,
 *      and a 10-second restart countdown.
 *
 *   2. A floating "Add to Library" button injected directly into the
 *      title row of every Steam app detail page (Big Picture / Game
 *      Mode / Desktop overlay). Each tap is an "add to cart" — the
 *      AppID gets remembered locally and the user can keep browsing.
 *      A second tap on the same page toggles the AppID back out of
 *      the cart, like Steam's own "Add to Cart" / "Remove" toggle.
 *
 *   3. A 10-second countdown modal for restarting Steam, exposed both
 *      from the QAM panel ("Apply pending") and as the "Restart Steam"
 *      button on the cart-results modal that appears after Process cart.
 *      The modal is cancellable, so users can keep adding before
 *      applying.
 *
 * Architecture:
 *
 *   • The in-page button is mounted from `installInjector()` (called
 *     once, here in `definePlugin`) into a hidden React root in
 *     `document.body`. That root polls window.location for app-page
 *     URLs and uses a MutationObserver to find the title element
 *     and createPortal the button next to it. The whole pipeline
 *     lives in `src/buttonInjector.tsx` — read that file's header
 *     comment for the why-this-architecture story.
 *
 *   • The Python backend (`main.py`) keeps two session-local queues:
 *     `_cart` (raw AppIDs awaiting ValveOFF) and `_pending` (AppIDs
 *     whose .hammer file is on disk awaiting a Steam restart). The
 *     QAM panel renders both, the in-page button only writes to
 *     `_cart`, and the restart countdown drains `_pending` on its
 *     way out.
 *
 *   • Why a Steam restart at all? Hammer's GetSubscribedApps hook
 *     only fires at Steam startup; the live-refresh callback path
 *     crashes Steam's CCompatManager in spoofed-Steam mode. See
 *     RECIPE.md "Why Hammer no longer fires AppLicensesChanged_t"
 *     for the full crash story; the short version is "we tried, it
 *     SIGSEGVs in V_stristr". A 10-second restart is honest UX; the
 *     plugin makes it fast and obvious instead of a hidden manual
 *     step.
 *
 * On mount we also run a one-shot rescue (`cleanupPoisoned`) that
 * wipes fake AppOverview entries left behind by v0.4-0.7 of this
 * plugin. Safe no-op on clean installs.
 */

import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { useEffect } from "react";

import { installInjector } from "./buttonInjector";
import { cleanupPoisoned } from "./cleanup";
import { FaHammer } from "./icons";
import { HammerLibraryPanel } from "./panel";

// ── Mount-time rescue ──────────────────────────────────────────────────────

const PanelWithCleanup = () => {
    useEffect(() => {
        void (async () => {
            try {
                const out = await cleanupPoisoned();
                if (out.ok && out.removed.length > 0) {
                    console.log(
                        `[hammer-decky] auto-cleanup removed ${out.removed.length} poisoned m_mapApps entr(y/ies):`,
                        out.removed,
                    );
                }
            } catch (ex) {
                console.error("[hammer-decky] auto-cleanup failed (non-fatal)", ex);
            }
        })();
    }, []);
    return <HammerLibraryPanel />;
};

// ── Plugin definition ─────────────────────────────────────────────────────

export default definePlugin(() => {
    console.log(
        "[hammer-decky] plugin loaded (v0.9.13 — fix React/SP_REACT build for Decky 3.x QAM)",
    );

    // Mount the in-page Add-to-Library button injector. Returns the
    // tear-down function used by `onDismount` so reinstalls / hot
    // reloads don't leave stray DOM hosts behind.
    const removeInjector = installInjector();

    return {
        name: "Hammer Library",
        titleView: <div className={staticClasses.Title}>Hammer Library</div>,
        content: <PanelWithCleanup />,
        icon: <FaHammer />,
        onDismount: () => {
            console.log("[hammer-decky] plugin unmounted");
            try {
                removeInjector();
            } catch (ex) {
                console.warn("[hammer-decky] removeInjector failed", ex);
            }
        },
    };
});
