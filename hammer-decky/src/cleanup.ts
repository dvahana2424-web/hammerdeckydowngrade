/**
 * Legacy rescue: clean up poisoned m_mapApps entries.
 *
 * v0.4 / v0.5 / v0.6 of this plugin tried to fake a library refresh by
 * writing AppOverview-shaped objects into `appStore.m_mapApps` directly.
 * That approach was abandoned in v0.7 (and superseded by the C++-side
 * filewatcher in Hammer itself, which v0.8 also rolled back to a
 * "manual restart" model after the LicensesUpdate_t fan-out crashed
 * Steam — see RECIPE.md). The leftover fake entries are still in users'
 * Steam state until they reboot the Deck, and they crash the library
 * renderer when the user navigates to Library because their
 * `m_setStoreTags` is a plain JSON object (not a real Set) and the
 * renderer calls `.has()` on it.
 *
 * `cleanupPoisoned` walks `m_mapApps`, identifies anything that matches
 * the v0.4/0.5 fake fingerprint, and deletes it. Auto-runs once on
 * plugin mount so existing installs self-heal silently.
 *
 * Detection fingerprint (matches anything we ever wrote):
 *   - display_name === "AppID <appid>" (our v0.4/0.5 placeholder), OR
 *   - m_setStoreTags exists but isn't a real Set and has no .has() method.
 *
 * Real Steam AppOverview entries have a working `m_setStoreTags` (a Set)
 * and never use the literal "AppID NNNN" display_name — so the cleanup
 * is a no-op on healthy installs.
 */

import { reportDiagnostic } from "./api";

export interface CleanupOutcome {
    ok: boolean;
    inspected: number;
    removed: number[];
    error?: string;
}

export async function cleanupPoisoned(): Promise<CleanupOutcome> {
    const w = window as any;
    const store = w.appStore || w.g_AppStore;
    if (!store) {
        return { ok: false, inspected: 0, removed: [], error: "no appStore on window" };
    }
    const mapApps = store.m_mapApps;
    if (!mapApps) {
        return { ok: false, inspected: 0, removed: [], error: "no m_mapApps" };
    }

    const removed: number[] = [];
    const inspected: number[] = [];

    try {
        // Snapshot the entries we want to inspect; mutating `m_mapApps`
        // mid-iteration is undefined behaviour for both ES Map and the
        // Mobx-observed wrapper Steam ships in some builds.
        const collected: Array<[any, any]> = [];
        if (typeof mapApps.entries === "function") {
            for (const [k, v] of mapApps.entries()) {
                collected.push([k, v]);
                if (collected.length >= 5000) break;
            }
        } else if (typeof mapApps.forEach === "function") {
            mapApps.forEach((v: any, k: any) => {
                if (collected.length < 5000) collected.push([k, v]);
            });
        }

        for (const [k, v] of collected) {
            const numericKey = typeof k === "number" ? k : Number(k);
            if (!Number.isFinite(numericKey)) continue;
            inspected.push(numericKey);

            const isFakeName =
                v && typeof v.display_name === "string" && /^AppID\s+\d+$/.test(v.display_name);
            const tagsBroken =
                v &&
                v.m_setStoreTags &&
                !(v.m_setStoreTags instanceof Set) &&
                typeof v.m_setStoreTags.has !== "function";

            if (isFakeName || tagsBroken) {
                try {
                    if (typeof mapApps.delete === "function") {
                        mapApps.delete(k);
                    } else if (typeof mapApps.remove === "function") {
                        mapApps.remove(k);
                    }
                    removed.push(numericKey);
                } catch {
                    // Per-entry failures are non-fatal — we'd rather
                    // clean 99 of 100 poisoned entries than abort the
                    // whole rescue on one stubborn key.
                }
            }
        }
    } catch (ex) {
        await reportDiagnostic("cleanup_poisoned_error", { error: String(ex) }).catch(
            () => undefined,
        );
        return { ok: false, inspected: inspected.length, removed: [], error: String(ex) };
    }

    if (removed.length > 0) {
        await reportDiagnostic("cleanup_poisoned", {
            inspected: inspected.length,
            removed_count: removed.length,
            removed_appids: removed,
        }).catch(() => undefined);
    }

    return { ok: true, inspected: inspected.length, removed };
}
