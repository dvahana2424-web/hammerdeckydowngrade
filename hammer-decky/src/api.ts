/**
 * Hammer Library — RPC bindings.
 *
 * Single source of truth for everything the React side calls on the
 * Python backend. Keeping these here (rather than scattered in the
 * panels that consume them) means the type definitions can be reused
 * across the QAM panel, the Steam Store route patch, and the restart
 * countdown modal without each component re-declaring the shape of a
 * `health_check` response.
 *
 * The signatures here MUST match the @decky.callable methods on
 * `Plugin` in `main.py`. If they drift, the loader will surface a
 * vague "method not found" / "argument mismatch" error at call time
 * — so when adding a new RPC, update both files at once.
 */

import { callable } from "@decky/api";

// ── Response shapes ────────────────────────────────────────────────────────

export type HealthResult =
    | {
          ok: true;
          valveoff_path: string;
          needs_dotnet: boolean;
          cli_ready: boolean;
          hammer_dir: string;
          dotnet_path?: string | null;
          version?: string;
      }
    | { ok: false; reason: string; error?: string; candidates?: string[] };

export type InstalledGame = {
    appid: number;
    filename: string;
    size_bytes: number;
    mtime: number;
};

export type AddGameResult = {
    ok: boolean;
    stage: string;
    appid?: number;
    error?: string;
    rc?: number;
    stderr?: string;
    pending_count?: number;
    result?: { hammerFile?: string; depotcacheDir?: string; manifestsCopied?: number };
};

export type IsAddedResult = {
    ok: boolean;
    appid?: number;
    added: boolean;
    filename?: string;
    path?: string | null;
    size_bytes?: number;
    in_pending?: boolean;
    in_cart?: boolean;
    title?: string | null;
    error?: string;
};

export type CartActionResult = {
    ok: boolean;
    appid?: number;
    added?: boolean;
    removed?: boolean;
    in_cart?: boolean;
    cart_count?: number;
    cleared?: number;
    title?: string | null;
    error?: string;
};

// Map of stringified AppID → resolved title. Backend always uses
// string keys for JSON portability; consumers should look up via
// `titles[String(appid)]` to avoid implicit-coercion footguns.
export type TitleMap = { [appid: string]: string };

export type CartContents = {
    count: number;
    appids: number[];
    titles?: TitleMap;
};

export type CartProcessLine = {
    appid: number;
    title?: string | null;
    ok: boolean;
    stage: string;
    error?: string | null;
    rc?: number | null;
};

export type CartProcessResult = {
    ok: boolean;
    results: CartProcessLine[];
    successful: number[];
    failed: number[];
    cart_remaining: number;
    pending_count: number;
};

export type PendingEntry = {
    appid: number;
    title: string | null;
    hammer_file?: string;
    depotcache_dir?: string;
    manifests?: number;
    added_at: number;
};

export type PendingResult = {
    count: number;
    entries: PendingEntry[];
};

export type RemoveGameResult = {
    ok: boolean;
    appid?: number;
    filename?: string;
    error?: string;
};

// ── RPC bindings ──────────────────────────────────────────────────────────

export const healthCheck = callable<[], HealthResult>("health_check");
export const listInstalled = callable<[], InstalledGame[]>("list_installed");
export const isAppidAdded = callable<[appid: number], IsAddedResult>("is_appid_added");
export const addGame = callable<[input: string, steamRoot?: string], AddGameResult>("add_game");
export const removeGame = callable<[appid: number], RemoveGameResult>("remove_game");
export const getPending = callable<[], PendingResult>("get_pending");
export const markRestarted = callable<[], { cleared: number; appids: number[] }>("mark_restarted");
export const reportDiagnostic = callable<[label: string, payload: any], void>("report_diagnostic");

export const cartAdd = callable<[appid: number], CartActionResult>("cart_add");
export const cartRemove = callable<[appid: number], CartActionResult>("cart_remove");
export const cartClear = callable<[], CartActionResult>("cart_clear");
export const getCart = callable<[], CartContents>("get_cart");
export const processCart = callable<[], CartProcessResult>("process_cart");

// Batch-resolve AppIDs → human-readable titles via Steam Web API
// (with a session-local cache on the backend). Used by the panel for
// the cart, pending, and installed lists, and by the in-page button
// for tooltips and toast text.
export const resolveTitles = callable<[appids: number[]], TitleMap>("resolve_titles");

// One-shot bypass-the-cache probe — used by the Diagnostics
// "Force resolve title" button so the user can confirm the Steam
// Web API path works on their network without restarting the
// plugin or clicking through the cart flow.
export type ProbeTitleResult = {
    ok: boolean;
    appid?: number;
    name?: string | null;
    status?: string;
    elapsed?: number;
    error?: string;
};
export const probeTitle = callable<[appid: number], ProbeTitleResult>("probe_title");

// Backend state dump used by the "Refresh diagnostics" button. Returns
// cart, pending, title-cache stats so the user has one screenshot-able
// blob to send when reporting issues.
export type DiagnosticsSnapshot = {
    version: string;
    valveoff_found: boolean;
    cart: { count: number; appids: number[]; titles: TitleMap };
    pending_count: number;
    title_cache_size: number;
    title_cache_sample: TitleMap;
    ts: number;
};
export const diagnosticsSnapshot = callable<[], DiagnosticsSnapshot>(
    "diagnostics_snapshot",
);

// Convenience helper around `resolveTitles` that gracefully degrades
// to `AppID N` placeholders on RPC failure. Frontend code should
// generally use this instead of the raw callable.
export async function resolveTitlesSafe(appids: number[]): Promise<TitleMap> {
    if (!appids.length) return {};
    try {
        return await resolveTitles(appids);
    } catch (ex) {
        console.warn("[hammer-decky] resolve_titles RPC failed", ex);
        const fallback: TitleMap = {};
        for (const a of appids) fallback[String(a)] = `AppID ${a}`;
        return fallback;
    }
}

// Title lookup helper that always returns *something* renderable.
export function titleFor(
    appid: number,
    titles?: TitleMap | null,
): string {
    return titles?.[String(appid)] ?? `AppID ${appid}`;
}

// ── helpers ────────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(epoch: number): string {
    const dt = Date.now() / 1000 - epoch;
    if (dt < 60) return "just now";
    if (dt < 3600) return `${Math.round(dt / 60)} min ago`;
    if (dt < 86400) return `${Math.round(dt / 3600)} hr ago`;
    return `${Math.round(dt / 86400)} d ago`;
}

/**
 * Extract a numeric AppID from a Steam pathname or a free-form text input.
 *
 * Recognises:
 *   • bare numeric strings           ("413150")
 *   • Steam Store URLs               ("https://store.steampowered.com/app/413150/Stardew_Valley/")
 *   • Big Picture / Game Mode routes ("/library/storeapp/413150",
 *                                     "/library/app/413150",
 *                                     "/store/413150",
 *                                     "/storev2/app/413150")
 *
 * Returns null on anything else. Used by both the QAM panel (paste-box
 * input) and the route-patch button (URL pattern → appid).
 */
export function coerceAppid(raw: string | number | null | undefined): number | null {
    if (raw == null) return null;
    if (typeof raw === "number") {
        return Number.isFinite(raw) && raw > 0 && raw < 1_000_000_000 ? Math.floor(raw) : null;
    }
    const s = String(raw).trim();
    if (!s) return null;
    if (/^\d{1,9}$/.test(s)) return Number(s);

    const url = s.match(/store\.steampowered\.com\/app\/(\d{1,9})/i);
    if (url) return Number(url[1]);

    const route = s.match(/\/(?:storeapp|app|storev2\/app|store)\/(\d{1,9})/i);
    if (route) return Number(route[1]);

    return null;
}
