/**
 * In-page Add-to-Library button injector (v0.9.1).
 *
 * The Steam Store on Big Picture / Game Mode comes in two flavours, and
 * v0.9.0 of this plugin only handled one:
 *
 *   A. **Native React store route** — `/library/storeapp/:appid`
 *      (rendered by Steam's own React tree, accessed via clicking a
 *      game card in the library / from search results / etc.). The
 *      page title is a real `<h1>` we can find in the DOM.
 *
 *   B. **Embedded webview** — `/library/storefront` (or similar) with
 *      the actual `store.steampowered.com/app/<appid>/` page rendered
 *      inside a CEF child browser. The webview's DOM is in a SEPARATE
 *      security context that this React tree cannot reach. The page
 *      title visible to the user lives inside the iframe and is
 *      unreachable from our process.
 *
 * v0.9.0 did URL polling against `window.location.pathname` which
 * matched (A) but never (B), because in (B) the outer URL is just
 * `/library/storefront` — the AppID is buried inside the iframe's URL
 * which doesn't propagate up. The user's screenshot shows them stuck in
 * case (B) and seeing no button.
 *
 * v0.9.1 detects BOTH cases with three independent signals, and renders
 * a button when any of them produces an AppID:
 *
 *   1. `window.location` polling (still catches case A — fast path).
 *
 *   2. `SteamClient.URL.RegisterForSteamURLChanges` listener (Steam's
 *      own URL-change broadcaster — the same one its UI uses to react
 *      to the user typing a URL into the address bar). When this
 *      fires with a `https://store.steampowered.com/app/<appid>/`
 *      target, we know we're in case B regardless of what the outer
 *      React route says.
 *
 *   3. **DOM scrape of the address-bar element**. Big Picture renders
 *      the visible URL ("https://store.steampowered.com/app/...") as a
 *      regular text node in Steam's outer UI shell — NOT inside the
 *      iframe. We MutationObserver-watch document.body and pull the
 *      AppID out of any element whose textContent looks like a Steam
 *      store URL. Last-resort fallback for builds where the URL
 *      callback isn't wired or returns stale state.
 *
 * The button positioning logic is unchanged — try to find the page
 * title and portal beside it; failing that, render the floating banner
 * at top-center. But we now drop the fallback delay from 3s to 1.5s
 * so users in case B (where the title is unreachable by definition)
 * get the banner faster, and the banner itself is louder (red, bigger,
 * "ADD TO LIBRARY" all caps, with cart count badge).
 */

import { toaster } from "@decky/api";
import { Focusable } from "@decky/ui";
import {
    FC,
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { createPortal, render, unmountComponentAtNode } from "react-dom";

import {
    cartAdd,
    cartRemove,
    coerceAppid,
    getCart,
    isAppidAdded,
    reportDiagnostic,
    resolveTitlesSafe,
} from "./api";
import { setDetectionState } from "./detectionState";
import { FaHammer, FaSyncAlt } from "./icons";
import { startSteamRestartCountdown } from "./restart";

// ── Route detection (case A: native Steam React store routes) ─────────────

const APPID_ROUTE_PATTERNS: RegExp[] = [
    /\/library\/storeapp\/(\d{1,9})(?:[/?#]|$)/i,
    /\/library\/app\/(\d{1,9})(?:[/?#]|$)/i,
    /\/storev2\/app\/(\d{1,9})(?:[/?#]|$)/i,
    /\/store\/(\d{1,9})(?:[/?#]|$)/i,
    /\/game\/(\d{1,9})(?:[/?#]|$)/i,
    /\/app\/(\d{1,9})(?:[/?#]|$)/i,
];

// Match a Steam store URL anywhere in a string — used both for parsing
// SteamClient URL-change events and for DOM URL-bar scraping. The
// anchored `^https?://store\.steampowered\.com` form keeps us from
// false-positiving on the user pasting an AppID into a search box.
const STORE_URL_PATTERN =
    /https?:\/\/store\.steampowered\.com\/app\/(\d{1,9})(?:[/?#]|$)/i;

function appidFromString(s: string | null | undefined): number | null {
    if (!s) return null;
    const url = String(s);
    for (const re of APPID_ROUTE_PATTERNS) {
        const m = url.match(re);
        if (m) return coerceAppid(m[1]);
    }
    const store = url.match(STORE_URL_PATTERN);
    if (store) return coerceAppid(store[1]);
    return null;
}

function appidFromCurrentLocation(): number | null {
    return appidFromString(
        (window.location.pathname || "") +
            (window.location.search || "") +
            (window.location.hash || ""),
    );
}

// ── DOM scrape: find a Steam store URL in any visible text node ───────────
//
// Big Picture's URL bar is something like
//   <span>https://store.steampowered.com/app/1472560/I_Am_Fish/</span>
// embedded inside Steam's CEF browser overlay chrome. We don't know
// the exact selector (it's a randomised hash class per build) so we
// just walk every element for one whose text content contains a
// store URL. Capped at 2000 elements to keep the cost bounded.

function appidFromDomScrape(): number | null {
    // Fast path: any element whose data-tooltip / aria-label / title
    // attribute happens to be the URL — common in URL bar widgets.
    const attrCandidates = document.querySelectorAll<HTMLElement>(
        "[data-tooltip*='store.steampowered.com'], " +
            "[aria-label*='store.steampowered.com'], " +
            "[title*='store.steampowered.com']",
    );
    for (const el of Array.from(attrCandidates)) {
        const id =
            appidFromString(el.getAttribute("data-tooltip")) ??
            appidFromString(el.getAttribute("aria-label")) ??
            appidFromString(el.getAttribute("title"));
        if (id != null) return id;
    }

    // Slow path: walk visible text nodes. Use a TreeWalker for cheap
    // skipping of non-text descendants. Bail out early as soon as a
    // match is found.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let scanned = 0;
    while (walker.nextNode()) {
        if (++scanned > 4000) break;
        const node = walker.currentNode as Text;
        const text = node.nodeValue;
        if (!text || text.length < 32 || text.length > 600) continue;
        if (!text.includes("store.steampowered.com")) continue;
        const id = appidFromString(text);
        if (id != null) return id;
    }
    return null;
}

// ── Title-element heuristics (case A — used to anchor inline) ─────────────

const TITLE_SELECTORS: string[] = [
    '[class*="apppage_AppName" i]',
    '[class*="AppHeader_AppName" i]',
    '[class*="apppage_AppHeaderTitle" i]',
    '[class*="apptitle" i]',
    '[class*="appname" i]',
    '[class*="DetailHeader_AppName" i]',
    '[class*="storepage_PageTitle" i]',
    '[class*="StoreAppPage_PageTitle" i]',
    "h1",
    "h2",
];

const HOST_CLASS = "hammer-decky-add-host";
const FORBIDDEN_ANCESTOR_SELECTORS = [
    "#hammer-decky-injector-root",
    `.${HOST_CLASS}`,
    "[class*=DeckyPluginEntry]",
    "[class*=quickAccessMenu]",
];

function isInsideForbidden(el: Element): boolean {
    let cur: Element | null = el;
    while (cur) {
        for (const sel of FORBIDDEN_ANCESTOR_SELECTORS) {
            if (cur.matches?.(sel)) return true;
        }
        cur = cur.parentElement;
    }
    return false;
}

function findTitleElement(): HTMLElement | null {
    for (const sel of TITLE_SELECTORS) {
        const candidates = document.querySelectorAll<HTMLElement>(sel);
        for (const el of Array.from(candidates)) {
            if (!el.parentElement) continue;
            if (isInsideForbidden(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 60 || rect.height < 16) continue;
            const text = (el.textContent || "").trim();
            if (!text || text.length < 2 || text.length > 200) continue;
            return el;
        }
    }
    return null;
}

// ── Add button (the actual UI) ─────────────────────────────────────────────

type ButtonPhase = "checking" | "idle" | "in_cart" | "in_library" | "busy";

interface AddButtonProps {
    appid: number;
    variant: "inline" | "floating";
}

const AddButton: FC<AddButtonProps> = ({ appid, variant }) => {
    const [phase, setPhase] = useState<ButtonPhase>("checking");
    const [cartCount, setCartCount] = useState(0);
    const [title, setTitle] = useState<string | null>(null);

    const refreshState = useCallback(async () => {
        try {
            const [added, cart] = await Promise.all([
                isAppidAdded(appid).catch(() => null),
                getCart().catch(() => null),
            ]);
            setCartCount(cart?.count ?? 0);
            if (added?.ok && added.added) setPhase("in_library");
            else if (cart && cart.appids.includes(appid)) setPhase("in_cart");
            else setPhase("idle");
            // Pull the title from whichever response has it (cart
            // titles map > is_appid_added title field), or kick off
            // a fresh resolution.
            const fromCart = cart?.titles?.[String(appid)];
            const fromAdded = added?.title;
            if (fromCart) setTitle(fromCart);
            else if (fromAdded) setTitle(fromAdded);
        } catch (ex) {
            console.error("[hammer-decky] refreshState failed", ex);
            setPhase("idle");
        }
    }, [appid]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await refreshState();
            if (cancelled) return;
            // Always make sure we have a real title — refreshState
            // only got it if cart/isAdded happened to know it.
            if (!title) {
                const map = await resolveTitlesSafe([appid]);
                if (cancelled) return;
                const t = map[String(appid)];
                if (t && !t.startsWith("AppID ")) setTitle(t);
            }
        })();
        return () => {
            cancelled = true;
        };
        // Intentionally exclude `title` to avoid re-fetching once known.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshState, appid]);

    const onClick = useCallback(async () => {
        if (phase === "checking" || phase === "busy") return;

        if (phase === "in_library") {
            await startSteamRestartCountdown({
                pendingCount: 1,
                source: variant === "inline" ? "inline_button" : "floating_button",
            });
            return;
        }

        if (phase === "in_cart") {
            setPhase("busy");
            try {
                const res = await cartRemove(appid);
                setCartCount(res.cart_count ?? cartCount);
                setPhase(res.removed ? "idle" : "in_cart");
                toaster.toast({
                    title: "Hammer cart",
                    body: res.removed
                        ? `AppID ${appid} removed from cart.`
                        : `AppID ${appid} was not in cart.`,
                    duration: 2000,
                });
            } catch (ex) {
                console.error("[hammer-decky] cart_remove failed", ex);
                setPhase("in_cart");
            }
            return;
        }

        setPhase("busy");
        try {
            const res = await cartAdd(appid);
            const count = res.cart_count ?? cartCount + 1;
            setCartCount(count);
            setPhase("in_cart");
            // Backend returns a freshly-resolved title in the response;
            // prefer that over our stale local copy.
            if (res.title) setTitle(res.title);
            const friendly = res.title || title || `AppID ${appid}`;
            await reportDiagnostic("cart_add_button", {
                appid,
                title: friendly,
                cart_count: count,
                variant,
            }).catch(() => undefined);
            toaster.toast({
                title: "Hammer cart",
                body: res.added
                    ? `Added "${friendly}" — ${count} game${count === 1 ? "" : "s"} in cart. Open Hammer Library in QAM and press Process cart.`
                    : `"${friendly}" already in cart (${count} total).`,
                duration: 3500,
            });
        } catch (ex) {
            console.error("[hammer-decky] cart_add failed", ex);
            setPhase("idle");
        }
    }, [appid, phase, cartCount, variant, title]);

    const label = (() => {
        switch (phase) {
            case "checking":
                return "Hammer…";
            case "busy":
                return "…";
            case "in_cart":
                return variant === "floating"
                    ? `IN CART (${cartCount})`
                    : `In cart (${cartCount})`;
            case "in_library":
                return variant === "floating"
                    ? "RESTART STEAM"
                    : "Restart Steam";
            case "idle":
            default:
                return variant === "floating"
                    ? "+ ADD TO LIBRARY"
                    : "Add to Library";
        }
    })();

    const accent = (() => {
        switch (phase) {
            case "in_library":
                return "rgba(28, 134, 60, 0.95)";
            case "in_cart":
                return "rgba(184, 109, 33, 0.95)";
            default:
                return "rgba(196, 38, 38, 0.95)"; // brighter red — louder
        }
    })();

    const Icon = phase === "in_library" ? FaSyncAlt : FaHammer;

    const baseStyle: CSSProperties =
        variant === "inline"
            ? {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  marginLeft: "12px",
                  background: accent,
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: 600,
                  lineHeight: "1.1",
                  cursor: phase === "busy" || phase === "checking" ? "progress" : "pointer",
                  whiteSpace: "nowrap",
                  verticalAlign: "middle",
                  textDecoration: "none",
                  userSelect: "none",
              }
            : {
                  // FLOATING BANNER — top-center, large, very obvious.
                  // Higher z-index than Steam's own UI overlay layers.
                  position: "fixed",
                  top: "8px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 2_147_483_640,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 22px",
                  background: accent,
                  color: "#fff",
                  border: "2px solid rgba(255, 255, 255, 0.35)",
                  borderRadius: "8px",
                  fontSize: "15px",
                  fontWeight: 800,
                  letterSpacing: "0.5px",
                  cursor: phase === "busy" || phase === "checking" ? "progress" : "pointer",
                  boxShadow:
                      "0 8px 24px rgba(0, 0, 0, 0.65), 0 0 0 2px rgba(0, 0, 0, 0.25), 0 0 16px rgba(255, 80, 80, 0.35)",
                  userSelect: "none",
              };

    const subText: CSSProperties = {
        opacity: 0.65,
        fontSize: "11px",
        marginLeft: "4px",
        fontWeight: 500,
    };

    return (
        <Focusable
            style={baseStyle}
            onActivate={() => void onClick()}
            onClick={(e: any) => {
                e?.stopPropagation?.();
                void onClick();
            }}
            title={`Hammer Library — ${title || `AppID ${appid}`} (${phase})`}
        >
            <Icon style={{ flex: "0 0 auto" }} size={variant === "inline" ? 12 : 16} />
            <span>{label}</span>
            <span style={subText}>· {title || `AppID ${appid}`}</span>
        </Focusable>
    );
};

// ── TitleAnchoredButton ────────────────────────────────────────────────────

const FALLBACK_DELAY_MS = 1_500;

interface TitleAnchoredButtonProps {
    appid: number;
}

const TitleAnchoredButton: FC<TitleAnchoredButtonProps> = ({ appid }) => {
    const [host, setHost] = useState<HTMLElement | null>(null);
    const [showFallback, setShowFallback] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let mountedHost: HTMLElement | null = null;

        const ensureHost = () => {
            if (cancelled) return;
            if (mountedHost && document.body.contains(mountedHost)) return;
            mountedHost = null;
            setHost(null);

            const title = findTitleElement();
            if (!title || !title.parentElement) return;

            const node = document.createElement("span");
            node.className = HOST_CLASS;
            node.dataset.hammerAppid = String(appid);
            node.style.cssText =
                "display:inline-flex;vertical-align:middle;align-items:center;line-height:1;";
            title.parentElement.insertBefore(node, title.nextSibling);
            mountedHost = node;
            setHost(node);
            const titleText = (title.textContent || "").trim().slice(0, 120);
            setDetectionState({ lastTitle: titleText || null });
            console.log(
                `[hammer-decky] anchored button for AppID ${appid} next to`,
                title,
            );
        };

        ensureHost();
        const observer = new MutationObserver(() => ensureHost());
        observer.observe(document.body, { childList: true, subtree: true });

        const fallbackTimer = window.setTimeout(() => {
            if (!cancelled && !mountedHost) {
                console.log(
                    `[hammer-decky] no title element found for AppID ${appid} after ${FALLBACK_DELAY_MS}ms — using floating banner fallback`,
                );
                setShowFallback(true);
            }
        }, FALLBACK_DELAY_MS);

        return () => {
            cancelled = true;
            observer.disconnect();
            window.clearTimeout(fallbackTimer);
            if (mountedHost) {
                try {
                    mountedHost.remove();
                } catch {
                    /* idempotent */
                }
                mountedHost = null;
            }
        };
    }, [appid]);

    useEffect(() => {
        if (host) setShowFallback(false);
    }, [host]);

    if (host) {
        return createPortal(<AddButton appid={appid} variant="inline" />, host);
    }
    if (showFallback) {
        return <AddButton appid={appid} variant="floating" />;
    }
    return null;
};

// ── InjectorController: multi-source URL detection ────────────────────────

const POLL_MS = 250;
const DOM_SCRAPE_MS = 750;

const InjectorController: FC = () => {
    const [appid, setAppid] = useState<number | null>(null);
    // Latest AppIDs from each source so the most recent signal wins
    // even when sources disagree (e.g. URL bar still shows old page
    // mid-navigation).
    const sources = useRef({ url: null, route: null, dom: null } as {
        url: number | null;
        route: number | null;
        dom: number | null;
    });

    const reduce = useCallback(() => {
        // Priority: SteamClient.URL > route > DOM scrape. URL events
        // fire instantly on navigation; route polling has a 250ms
        // pause; DOM scrape is the slow fallback.
        const next =
            sources.current.url ?? sources.current.route ?? sources.current.dom ?? null;
        setAppid((prev) => (prev === next ? prev : next));
        // Mirror to the shared detection-state singleton so the QAM
        // panel's diagnostics section can render what we're seeing.
        // Always push (even when nothing changed) so the panel's
        // "lastUrl" timestamp keeps moving — this is what told us
        // the injector was alive when the user reported "no appid
        // detected" and we needed to know whether the injector was
        // running at all.
        setDetectionState({
            appid: next,
            sources: { ...sources.current },
            lastUrl:
                (window.location.pathname || "") +
                (window.location.search || "") +
                (window.location.hash || ""),
        });
    }, []);

    // Source 1: window.location route polling (case A)
    //
    // We deliberately DO NOT bail out when the URL is unchanged —
    // v0.9.2 had a `if (url === lastUrl) return;` guard at the top
    // of tick() that meant the diagnostics state stopped updating
    // after the first tick on any page that didn't navigate, leaving
    // useDetectionState() snapshots stuck on initial nulls. Now we
    // always run the detection logic and always call reduce() so
    // the panel shows live state.
    useEffect(() => {
        const tick = () => {
            const next = appidFromCurrentLocation();
            const changed = next !== sources.current.route;
            sources.current.route = next;
            if (changed && next != null) {
                const url =
                    (window.location.pathname || "") +
                    (window.location.search || "") +
                    (window.location.hash || "");
                console.log(
                    `[hammer-decky] route source matched AppID ${next} (url=${url})`,
                );
            }
            reduce();
        };
        tick();
        const interval = window.setInterval(tick, POLL_MS);
        const onPop = () => tick();
        window.addEventListener("popstate", onPop);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener("popstate", onPop);
        };
    }, [reduce]);

    // Source 2: SteamClient.URL.RegisterForSteamURLChanges (case B)
    //
    // Steam fires this for every navigation including ones that
    // happen inside the Big Picture web-store webview. Different
    // builds pass slightly different shapes, so we accept anything
    // that looks like a URL and look up the AppID.
    useEffect(() => {
        const sc: any = (window as any).SteamClient;
        const reg = sc?.URL?.RegisterForSteamURLChanges;
        if (typeof reg !== "function") {
            console.log(
                "[hammer-decky] SteamClient.URL.RegisterForSteamURLChanges not available — skipping URL-event source",
            );
            return;
        }
        let unregister: undefined | (() => void);
        try {
            const handle = reg.call(sc.URL, (...args: any[]) => {
                // Some builds pass a string; others pass an object
                // with a {url} or {url_to_open} field.
                const candidates: string[] = [];
                for (const a of args) {
                    if (typeof a === "string") candidates.push(a);
                    else if (a && typeof a === "object") {
                        for (const k of [
                            "url",
                            "url_to_open",
                            "strURL",
                            "strURLToOpen",
                        ]) {
                            if (typeof a[k] === "string") candidates.push(a[k]);
                        }
                    }
                }
                for (const c of candidates) {
                    const id = appidFromString(c);
                    if (id != null && id !== sources.current.url) {
                        sources.current.url = id;
                        console.log(
                            `[hammer-decky] SteamClient.URL source matched AppID ${id} (url=${c})`,
                        );
                        reduce();
                        return;
                    }
                }
                // No store URL → user navigated away, clear this source.
                if (sources.current.url != null) {
                    sources.current.url = null;
                    reduce();
                }
            });
            // Decky's pattern is that the registration returns either a
            // function or an object with `unregister`. Accept both.
            if (typeof handle === "function") unregister = handle;
            else if (handle && typeof handle.unregister === "function")
                unregister = () => handle.unregister();
            console.log(
                "[hammer-decky] SteamClient.URL.RegisterForSteamURLChanges installed",
            );
        } catch (ex) {
            console.warn(
                "[hammer-decky] failed to register SteamClient.URL listener",
                ex,
            );
        }
        return () => {
            try {
                unregister?.();
            } catch (ex) {
                console.warn("[hammer-decky] URL listener unregister failed", ex);
            }
        };
    }, [reduce]);

    // Source 3: DOM URL-bar scrape (case B fallback)
    //
    // Same anti-stale-snapshot fix as Source 1: always update
    // sources.current.dom and call reduce(), even when nothing
    // changed, so panel diagnostics stay live.
    useEffect(() => {
        const tick = () => {
            const next = appidFromDomScrape();
            const changed = next !== sources.current.dom;
            sources.current.dom = next;
            if (changed && next != null)
                console.log(
                    `[hammer-decky] DOM-scrape source matched AppID ${next}`,
                );
            reduce();
        };
        tick();
        const interval = window.setInterval(tick, DOM_SCRAPE_MS);
        return () => {
            window.clearInterval(interval);
        };
    }, [reduce]);

    // Liveness beacon: report current detection state to the backend
    // every 30s and on startup. Gives us a server-side log of what
    // the injector is seeing even when the user can't get to the
    // QAM panel (e.g. the panel is closed, or we're chasing an issue
    // where the panel hasn't refreshed). Lightweight RPC; no awaits
    // block the React tick.
    useEffect(() => {
        const beacon = () => {
            void reportDiagnostic("injector_state", {
                appid,
                sources: { ...sources.current },
                location:
                    (window.location.pathname || "") +
                    (window.location.search || "") +
                    (window.location.hash || ""),
                ts: Date.now(),
            }).catch(() => undefined);
        };
        beacon();
        const interval = window.setInterval(beacon, 30_000);
        return () => {
            window.clearInterval(interval);
        };
    }, [appid]);

    if (appid == null) return null;
    return <TitleAnchoredButton key={appid} appid={appid} />;
};

// ── installInjector: public mount/unmount API ──────────────────────────────

const ROOT_ID = "hammer-decky-injector-root";

export function installInjector(): () => void {
    if (document.getElementById(ROOT_ID)) {
        console.warn("[hammer-decky] injector already mounted, skipping");
        return () => undefined;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;";
    document.body.appendChild(root);

    try {
        render(<InjectorController />, root);
        console.log(
            "[hammer-decky] injector mounted (v0.9.3 — always-live diagnostics + sync title resolve)",
        );
    } catch (ex) {
        console.error("[hammer-decky] failed to mount injector", ex);
        try {
            root.remove();
        } catch {
            /* ignore */
        }
        return () => undefined;
    }

    return () => {
        try {
            unmountComponentAtNode(root);
        } catch (ex) {
            console.warn("[hammer-decky] unmountComponentAtNode failed", ex);
        }
        try {
            root.remove();
        } catch {
            /* idempotent */
        }
        console.log("[hammer-decky] injector unmounted");
    };
}
