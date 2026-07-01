/**
 * Cross-component detection state.
 *
 * The button injector runs in a React root mounted into document.body
 * (so it survives all of Steam's own route changes). The QAM panel
 * runs in a separate React tree owned by Decky. Both want to know
 * the same thing: "what AppID is the user currently looking at, and
 * which detection source picked it up?".
 *
 * Rather than wire a context provider across two roots — which would
 * require either a shared parent or React's experimental
 * createTrackedSelector — we use a tiny singleton observable. The
 * injector pushes updates via `setDetectionState`, the panel
 * subscribes via `useDetectionState`. No context, no provider, no
 * cross-root wiring.
 *
 * This is also handy for users debugging "why isn't the button
 * appearing?" — opening the panel shows them exactly what each of
 * the three detection sources currently sees, which is much clearer
 * than tailing console logs.
 */

import { useEffect, useState } from "react";

export interface DetectionState {
    appid: number | null;
    sources: {
        url: number | null;
        route: number | null;
        dom: number | null;
    };
    lastUrl: string | null;
    lastTitle: string | null;
    pluginVersion: string;
    updatedAt: number;
}

const PLUGIN_VERSION = "0.9.3";

let state: DetectionState = {
    appid: null,
    sources: { url: null, route: null, dom: null },
    lastUrl: null,
    lastTitle: null,
    pluginVersion: PLUGIN_VERSION,
    updatedAt: Date.now(),
};

const listeners = new Set<(s: DetectionState) => void>();

export function setDetectionState(patch: Partial<DetectionState>): void {
    state = { ...state, ...patch, updatedAt: Date.now() };
    if (patch.sources) {
        state.sources = { ...state.sources, ...patch.sources };
    }
    listeners.forEach((fn) => {
        try {
            fn(state);
        } catch (ex) {
            console.warn("[hammer-decky] detection-state listener threw", ex);
        }
    });
}

export function getDetectionState(): DetectionState {
    return state;
}

export function useDetectionState(): DetectionState {
    const [snap, setSnap] = useState<DetectionState>(state);
    useEffect(() => {
        const fn = (s: DetectionState) => setSnap(s);
        listeners.add(fn);
        // Sync once in case state updated between render and effect.
        setSnap(state);
        return () => {
            listeners.delete(fn);
        };
    }, []);
    return snap;
}
