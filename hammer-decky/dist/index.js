const manifest = {"name":"Hammer Library"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

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
// ── RPC bindings ──────────────────────────────────────────────────────────
const healthCheck = callable("health_check");
const listInstalled = callable("list_installed");
const isAppidAdded = callable("is_appid_added");
callable("add_game");
const removeGame = callable("remove_game");
const getPending = callable("get_pending");
const markRestarted = callable("mark_restarted");
const reportDiagnostic = callable("report_diagnostic");
const cartAdd = callable("cart_add");
const cartRemove = callable("cart_remove");
const cartClear = callable("cart_clear");
const getCart = callable("get_cart");
const processCart = callable("process_cart");
// Batch-resolve AppIDs → human-readable titles via Steam Web API
// (with a session-local cache on the backend). Used by the panel for
// the cart, pending, and installed lists, and by the in-page button
// for tooltips and toast text.
const resolveTitles = callable("resolve_titles");
const probeTitle = callable("probe_title");
const diagnosticsSnapshot = callable("diagnostics_snapshot");
// Convenience helper around `resolveTitles` that gracefully degrades
// to `AppID N` placeholders on RPC failure. Frontend code should
// generally use this instead of the raw callable.
async function resolveTitlesSafe(appids) {
    if (!appids.length)
        return {};
    try {
        return await resolveTitles(appids);
    }
    catch (ex) {
        console.warn("[hammer-decky] resolve_titles RPC failed", ex);
        const fallback = {};
        for (const a of appids)
            fallback[String(a)] = `AppID ${a}`;
        return fallback;
    }
}
// Title lookup helper that always returns *something* renderable.
function titleFor(appid, titles) {
    return titles?.[String(appid)] ?? `AppID ${appid}`;
}
// ── helpers ────────────────────────────────────────────────────────────────
function formatBytes(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function timeAgo(epoch) {
    const dt = Date.now() / 1000 - epoch;
    if (dt < 60)
        return "just now";
    if (dt < 3600)
        return `${Math.round(dt / 60)} min ago`;
    if (dt < 86400)
        return `${Math.round(dt / 3600)} hr ago`;
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
function coerceAppid(raw) {
    if (raw == null)
        return null;
    if (typeof raw === "number") {
        return Number.isFinite(raw) && raw > 0 && raw < 1000000000 ? Math.floor(raw) : null;
    }
    const s = String(raw).trim();
    if (!s)
        return null;
    if (/^\d{1,9}$/.test(s))
        return Number(s);
    const url = s.match(/store\.steampowered\.com\/app\/(\d{1,9})/i);
    if (url)
        return Number(url[1]);
    const route = s.match(/\/(?:storeapp|app|storev2\/app|store)\/(\d{1,9})/i);
    if (route)
        return Number(route[1]);
    return null;
}

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

const PLUGIN_VERSION = "0.9.3";
let state = {
    appid: null,
    sources: { url: null, route: null, dom: null },
    lastUrl: null,
    lastTitle: null,
    pluginVersion: PLUGIN_VERSION,
    updatedAt: Date.now(),
};
const listeners = new Set();
function setDetectionState(patch) {
    state = { ...state, ...patch, updatedAt: Date.now() };
    if (patch.sources) {
        state.sources = { ...state.sources, ...patch.sources };
    }
    listeners.forEach((fn) => {
        try {
            fn(state);
        }
        catch (ex) {
            console.warn("[hammer-decky] detection-state listener threw", ex);
        }
    });
}
function useDetectionState() {
    const [snap, setSnap] = SP_REACT.useState(state);
    SP_REACT.useEffect(() => {
        const fn = (s) => setSnap(s);
        listeners.add(fn);
        // Sync once in case state updated between render and effect.
        setSnap(state);
        return () => {
            listeners.delete(fn);
        };
    }, []);
    return snap;
}

var DefaultContext = {
  color: undefined,
  size: undefined,
  className: undefined,
  style: undefined,
  attr: undefined
};
var IconContext = SP_REACT.createContext && /*#__PURE__*/SP_REACT.createContext(DefaultContext);

var _excluded = ["attr", "size", "title"];
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), true).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function Tree2Element(tree) {
  return tree && tree.map((node, i) => /*#__PURE__*/SP_REACT.createElement(node.tag, _objectSpread({
    key: i
  }, node.attr), Tree2Element(node.child)));
}
function GenIcon(data) {
  return props => /*#__PURE__*/SP_REACT.createElement(IconBase, _extends({
    attr: _objectSpread({}, data.attr)
  }, props), Tree2Element(data.child));
}
function IconBase(props) {
  var elem = conf => {
    var attr = props.attr,
      size = props.size,
      title = props.title,
      svgProps = _objectWithoutProperties(props, _excluded);
    var computedSize = size || conf.size || "1em";
    var className;
    if (conf.className) className = conf.className;
    if (props.className) className = (className ? className + " " : "") + props.className;
    return /*#__PURE__*/SP_REACT.createElement("svg", _extends({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: "0"
    }, conf.attr, attr, svgProps, {
      className: className,
      style: _objectSpread(_objectSpread({
        color: props.color || conf.color
      }, conf.style), props.style),
      height: computedSize,
      width: computedSize,
      xmlns: "http://www.w3.org/2000/svg"
    }), title && /*#__PURE__*/SP_REACT.createElement("title", null, title), props.children);
  };
  return IconContext !== undefined ? /*#__PURE__*/SP_REACT.createElement(IconContext.Consumer, null, conf => elem(conf)) : elem(DefaultContext);
}

// THIS FILE IS AUTO GENERATED
function FaTrash$1 (props) {
  return GenIcon({"attr":{"viewBox":"0 0 448 512"},"child":[{"tag":"path","attr":{"d":"M432 32H312l-9.4-18.7A24 24 0 0 0 281.1 0H166.8a23.72 23.72 0 0 0-21.4 13.3L136 32H16A16 16 0 0 0 0 48v32a16 16 0 0 0 16 16h416a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16zM53.2 467a48 48 0 0 0 47.9 45h245.8a48 48 0 0 0 47.9-45L416 128H32z"},"child":[]}]})(props);
}function FaSyncAlt$1 (props) {
  return GenIcon({"attr":{"viewBox":"0 0 512 512"},"child":[{"tag":"path","attr":{"d":"M370.72 133.28C339.458 104.008 298.888 87.962 255.848 88c-77.458.068-144.328 53.178-162.791 126.85-1.344 5.363-6.122 9.15-11.651 9.15H24.103c-7.498 0-13.194-6.807-11.807-14.176C33.933 94.924 134.813 8 256 8c66.448 0 126.791 26.136 171.315 68.685L463.03 40.97C478.149 25.851 504 36.559 504 57.941V192c0 13.255-10.745 24-24 24H345.941c-21.382 0-32.09-25.851-16.971-40.971l41.75-41.749zM32 296h134.059c21.382 0 32.09 25.851 16.971 40.971l-41.75 41.75c31.262 29.273 71.835 45.319 114.876 45.28 77.418-.07 144.315-53.144 162.787-126.849 1.344-5.363 6.122-9.15 11.651-9.15h57.304c7.498 0 13.194 6.807 11.807 14.176C478.067 417.076 377.187 504 256 504c-66.448 0-126.791-26.136-171.315-68.685L48.97 471.03C33.851 486.149 8 475.441 8 454.059V320c0-13.255 10.745-24 24-24z"},"child":[]}]})(props);
}function FaPlus$1 (props) {
  return GenIcon({"attr":{"viewBox":"0 0 448 512"},"child":[{"tag":"path","attr":{"d":"M416 208H272V64c0-17.67-14.33-32-32-32h-32c-17.67 0-32 14.33-32 32v144H32c-17.67 0-32 14.33-32 32v32c0 17.67 14.33 32 32 32h144v144c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32V304h144c17.67 0 32-14.33 32-32v-32c0-17.67-14.33-32-32-32z"},"child":[]}]})(props);
}function FaHammer$1 (props) {
  return GenIcon({"attr":{"viewBox":"0 0 576 512"},"child":[{"tag":"path","attr":{"d":"M571.31 193.94l-22.63-22.63c-6.25-6.25-16.38-6.25-22.63 0l-11.31 11.31-28.9-28.9c5.63-21.31.36-44.9-16.35-61.61l-45.25-45.25c-62.48-62.48-163.79-62.48-226.28 0l90.51 45.25v18.75c0 16.97 6.74 33.25 18.75 45.25l49.14 49.14c16.71 16.71 40.3 21.98 61.61 16.35l28.9 28.9-11.31 11.31c-6.25 6.25-6.25 16.38 0 22.63l22.63 22.63c6.25 6.25 16.38 6.25 22.63 0l90.51-90.51c6.23-6.24 6.23-16.37-.02-22.62zm-286.72-15.2c-3.7-3.7-6.84-7.79-9.85-11.95L19.64 404.96c-25.57 23.88-26.26 64.19-1.53 88.93s65.05 24.05 88.93-1.53l238.13-255.07c-3.96-2.91-7.9-5.87-11.44-9.41l-49.14-49.14z"},"child":[]}]})(props);
}

/**
 * Icon shim.
 *
 * `react-icons` types every icon as `IconType = (props) => ReactNode`,
 * and `ReactNode` in `@types/react@16.14` includes `undefined`. Modern
 * TypeScript (5.3+) refuses to use such a component as a JSX element
 * because `JSX.Element` is `ReactElement | null`, not `ReactNode`.
 *
 * Rather than turn off strict mode for the whole plugin, we wrap each
 * icon we use in a tiny FC shim that strips `undefined` from the return
 * type. The runtime behaviour is unchanged (the original component is
 * still what renders), only the type signature is narrowed.
 *
 * Centralising the imports here also doubles as a "what icons do we
 * actually use?" registry — keeps the bundle small under tree-shaking.
 */
function shim(raw) {
    return raw;
}
const FaHammer = shim(FaHammer$1);
const FaPlus = shim(FaPlus$1);
const FaSyncAlt = shim(FaSyncAlt$1);
const FaTrash = shim(FaTrash$1);

const DEFAULT_COUNTDOWN_SECONDS = 10;
// ── Steam-side restart trigger ──────────────────────────────────────────────
/**
 * Fire SteamClient's restart. Returns the path that was actually taken
 * (for logging) or throws if no path is available. Caller is expected
 * to have already rendered "Steam is restarting…" to the user — by the
 * time this returns, Steam will be tearing down its CEF host and our
 * React tree is about to be ripped out. Don't await anything after.
 */
async function fireSteamRestart() {
    const sc = window.SteamClient;
    if (!sc) {
        throw new Error("SteamClient is not on window — not running inside Steam?");
    }
    if (sc.User && typeof sc.User.StartRestart === "function") {
        try {
            sc.User.StartRestart(false);
            return "SteamClient.User.StartRestart(false)";
        }
        catch (ex) {
            // Some builds want StartRestart() with no arg or a string flag.
            try {
                sc.User.StartRestart();
                return "SteamClient.User.StartRestart()";
            }
            catch {
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
const CountdownModal = ({ seconds, pendingCount, onConfirm, onCancel, closeModal, }) => {
    const [remaining, setRemaining] = SP_REACT.useState(seconds);
    const [restarting, setRestarting] = SP_REACT.useState(false);
    // Keep the timer ID in a ref so the cancel handler can clear it
    // without triggering a re-render.
    const intervalRef = SP_REACT.useRef(null);
    SP_REACT.useEffect(() => {
        intervalRef.current = setInterval(() => {
            setRemaining((r) => Math.max(0, r - 1));
        }, 1000);
        return () => {
            if (intervalRef.current)
                clearInterval(intervalRef.current);
        };
    }, []);
    // When the timer reaches 0, fire restart automatically. The actual
    // SteamClient call happens in the OK handler so we share the same
    // code path with manual confirm.
    SP_REACT.useEffect(() => {
        if (remaining === 0 && !restarting) {
            setRestarting(true);
            if (intervalRef.current)
                clearInterval(intervalRef.current);
            onConfirm();
        }
    }, [remaining, restarting, onConfirm]);
    const description = pendingCount > 0
        ? `Steam will restart in ${remaining}s to apply ${pendingCount} pending Hammer add${pendingCount === 1 ? "" : "s"}. Hammer's hook only refires at startup, so this is the only way for new games to appear in the library. Press Cancel if you'd rather restart later.`
        : `Steam will restart in ${remaining}s. Press Cancel if you'd rather restart later.`;
    return (SP_JSX.jsx(DFL.ConfirmModal, { strTitle: restarting
            ? "Restarting Steam…"
            : `Restart Steam in ${remaining}s`, strDescription: restarting
            ? "Steam is going down now. Game Mode / Big Picture will reappear in a few seconds with your new game(s) in the library."
            : description, strOKButtonText: restarting ? "Restarting…" : "Restart now", strCancelButtonText: "Cancel", bOKDisabled: restarting, bCancelDisabled: restarting, onOK: () => {
            if (restarting)
                return;
            setRestarting(true);
            if (intervalRef.current)
                clearInterval(intervalRef.current);
            onConfirm();
        }, onCancel: () => {
            if (restarting)
                return;
            if (intervalRef.current)
                clearInterval(intervalRef.current);
            onCancel();
            closeModal?.();
        }, closeModal: closeModal }));
};
/**
 * Open the 10-second confirmation modal and (on OK / timeout) restart Steam.
 *
 * Returns a Promise that resolves to:
 *   • "restarted" — SteamClient was successfully called. Caller's tree
 *                   is about to be torn down; don't trust any state.
 *   • "cancelled" — user cancelled. Caller can stay alive.
 *   • "no_steam_client" — running outside Steam (dev / preview).
 */
function startSteamRestartCountdown(opts = {}) {
    const seconds = opts.seconds ?? DEFAULT_COUNTDOWN_SECONDS;
    const pending = opts.pendingCount ?? 0;
    const source = opts.source ?? "panel";
    return new Promise((resolve) => {
        let settled = false;
        const settle = (v) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };
        const result = DFL.showModal(SP_JSX.jsx(CountdownModal, { seconds: seconds, pendingCount: pending, onConfirm: async () => {
                try {
                    // Empty the pending queue BEFORE firing restart;
                    // the python process dies with Steam so we want
                    // a clean slate when the next session starts.
                    try {
                        await markRestarted();
                    }
                    catch (ex) {
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
                }
                catch (ex) {
                    console.error("[hammer-decky] Steam restart failed", ex);
                    await reportDiagnostic("restart_error", {
                        source,
                        error: String(ex),
                    }).catch(() => undefined);
                    settle("error");
                }
                finally {
                    result?.Close();
                }
            }, onCancel: () => settle("cancelled") }), undefined, { strTitle: "Restart Steam" });
        if (!result)
            settle("no_steam_client");
    });
}

// ── Route detection (case A: native Steam React store routes) ─────────────
const APPID_ROUTE_PATTERNS = [
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
const STORE_URL_PATTERN = /https?:\/\/store\.steampowered\.com\/app\/(\d{1,9})(?:[/?#]|$)/i;
function appidFromString(s) {
    if (!s)
        return null;
    const url = String(s);
    for (const re of APPID_ROUTE_PATTERNS) {
        const m = url.match(re);
        if (m)
            return coerceAppid(m[1]);
    }
    const store = url.match(STORE_URL_PATTERN);
    if (store)
        return coerceAppid(store[1]);
    return null;
}
function appidFromCurrentLocation() {
    return appidFromString((window.location.pathname || "") +
        (window.location.search || "") +
        (window.location.hash || ""));
}
// ── DOM scrape: find a Steam store URL in any visible text node ───────────
//
// Big Picture's URL bar is something like
//   <span>https://store.steampowered.com/app/1472560/I_Am_Fish/</span>
// embedded inside Steam's CEF browser overlay chrome. We don't know
// the exact selector (it's a randomised hash class per build) so we
// just walk every element for one whose text content contains a
// store URL. Capped at 2000 elements to keep the cost bounded.
function appidFromDomScrape() {
    // Fast path: any element whose data-tooltip / aria-label / title
    // attribute happens to be the URL — common in URL bar widgets.
    const attrCandidates = document.querySelectorAll("[data-tooltip*='store.steampowered.com'], " +
        "[aria-label*='store.steampowered.com'], " +
        "[title*='store.steampowered.com']");
    for (const el of Array.from(attrCandidates)) {
        const id = appidFromString(el.getAttribute("data-tooltip")) ??
            appidFromString(el.getAttribute("aria-label")) ??
            appidFromString(el.getAttribute("title"));
        if (id != null)
            return id;
    }
    // Slow path: walk visible text nodes. Use a TreeWalker for cheap
    // skipping of non-text descendants. Bail out early as soon as a
    // match is found.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let scanned = 0;
    while (walker.nextNode()) {
        if (++scanned > 4000)
            break;
        const node = walker.currentNode;
        const text = node.nodeValue;
        if (!text || text.length < 32 || text.length > 600)
            continue;
        if (!text.includes("store.steampowered.com"))
            continue;
        const id = appidFromString(text);
        if (id != null)
            return id;
    }
    return null;
}
// ── Title-element heuristics (case A — used to anchor inline) ─────────────
const TITLE_SELECTORS = [
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
function isInsideForbidden(el) {
    let cur = el;
    while (cur) {
        for (const sel of FORBIDDEN_ANCESTOR_SELECTORS) {
            if (cur.matches?.(sel))
                return true;
        }
        cur = cur.parentElement;
    }
    return false;
}
function findTitleElement() {
    for (const sel of TITLE_SELECTORS) {
        const candidates = document.querySelectorAll(sel);
        for (const el of Array.from(candidates)) {
            if (!el.parentElement)
                continue;
            if (isInsideForbidden(el))
                continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 60 || rect.height < 16)
                continue;
            const text = (el.textContent || "").trim();
            if (!text || text.length < 2 || text.length > 200)
                continue;
            return el;
        }
    }
    return null;
}
const AddButton = ({ appid, variant }) => {
    const [phase, setPhase] = SP_REACT.useState("checking");
    const [cartCount, setCartCount] = SP_REACT.useState(0);
    const [title, setTitle] = SP_REACT.useState(null);
    const refreshState = SP_REACT.useCallback(async () => {
        try {
            const [added, cart] = await Promise.all([
                isAppidAdded(appid).catch(() => null),
                getCart().catch(() => null),
            ]);
            setCartCount(cart?.count ?? 0);
            if (added?.ok && added.added)
                setPhase("in_library");
            else if (cart && cart.appids.includes(appid))
                setPhase("in_cart");
            else
                setPhase("idle");
            // Pull the title from whichever response has it (cart
            // titles map > is_appid_added title field), or kick off
            // a fresh resolution.
            const fromCart = cart?.titles?.[String(appid)];
            const fromAdded = added?.title;
            if (fromCart)
                setTitle(fromCart);
            else if (fromAdded)
                setTitle(fromAdded);
        }
        catch (ex) {
            console.error("[hammer-decky] refreshState failed", ex);
            setPhase("idle");
        }
    }, [appid]);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        (async () => {
            await refreshState();
            if (cancelled)
                return;
            // Always make sure we have a real title — refreshState
            // only got it if cart/isAdded happened to know it.
            if (!title) {
                const map = await resolveTitlesSafe([appid]);
                if (cancelled)
                    return;
                const t = map[String(appid)];
                if (t && !t.startsWith("AppID "))
                    setTitle(t);
            }
        })();
        return () => {
            cancelled = true;
        };
        // Intentionally exclude `title` to avoid re-fetching once known.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshState, appid]);
    const onClick = SP_REACT.useCallback(async () => {
        if (phase === "checking" || phase === "busy")
            return;
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
            }
            catch (ex) {
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
            if (res.title)
                setTitle(res.title);
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
        }
        catch (ex) {
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
    const baseStyle = variant === "inline"
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
            zIndex: 2147483640,
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
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.65), 0 0 0 2px rgba(0, 0, 0, 0.25), 0 0 16px rgba(255, 80, 80, 0.35)",
            userSelect: "none",
        };
    const subText = {
        opacity: 0.65,
        fontSize: "11px",
        marginLeft: "4px",
        fontWeight: 500,
    };
    return (SP_JSX.jsxs(DFL.Focusable, { style: baseStyle, onActivate: () => void onClick(), onClick: (e) => {
            e?.stopPropagation?.();
            void onClick();
        }, title: `Hammer Library — ${title || `AppID ${appid}`} (${phase})`, children: [SP_JSX.jsx(Icon, { style: { flex: "0 0 auto" }, size: variant === "inline" ? 12 : 16 }), SP_JSX.jsx("span", { children: label }), SP_JSX.jsxs("span", { style: subText, children: ["\u00B7 ", title || `AppID ${appid}`] })] }));
};
// ── TitleAnchoredButton ────────────────────────────────────────────────────
const FALLBACK_DELAY_MS = 1500;
const TitleAnchoredButton = ({ appid }) => {
    const [host, setHost] = SP_REACT.useState(null);
    const [showFallback, setShowFallback] = SP_REACT.useState(false);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        let mountedHost = null;
        const ensureHost = () => {
            if (cancelled)
                return;
            if (mountedHost && document.body.contains(mountedHost))
                return;
            mountedHost = null;
            setHost(null);
            const title = findTitleElement();
            if (!title || !title.parentElement)
                return;
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
            console.log(`[hammer-decky] anchored button for AppID ${appid} next to`, title);
        };
        ensureHost();
        const observer = new MutationObserver(() => ensureHost());
        observer.observe(document.body, { childList: true, subtree: true });
        const fallbackTimer = window.setTimeout(() => {
            if (!cancelled && !mountedHost) {
                console.log(`[hammer-decky] no title element found for AppID ${appid} after ${FALLBACK_DELAY_MS}ms — using floating banner fallback`);
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
                }
                catch {
                    /* idempotent */
                }
                mountedHost = null;
            }
        };
    }, [appid]);
    SP_REACT.useEffect(() => {
        if (host)
            setShowFallback(false);
    }, [host]);
    if (host) {
        return SP_REACTDOM.createPortal(SP_JSX.jsx(AddButton, { appid: appid, variant: "inline" }), host);
    }
    if (showFallback) {
        return SP_JSX.jsx(AddButton, { appid: appid, variant: "floating" });
    }
    return null;
};
// ── InjectorController: multi-source URL detection ────────────────────────
const POLL_MS = 250;
const DOM_SCRAPE_MS = 750;
const InjectorController = () => {
    const [appid, setAppid] = SP_REACT.useState(null);
    // Latest AppIDs from each source so the most recent signal wins
    // even when sources disagree (e.g. URL bar still shows old page
    // mid-navigation).
    const sources = SP_REACT.useRef({ url: null, route: null, dom: null });
    const reduce = SP_REACT.useCallback(() => {
        // Priority: SteamClient.URL > route > DOM scrape. URL events
        // fire instantly on navigation; route polling has a 250ms
        // pause; DOM scrape is the slow fallback.
        const next = sources.current.url ?? sources.current.route ?? sources.current.dom ?? null;
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
            lastUrl: (window.location.pathname || "") +
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
    SP_REACT.useEffect(() => {
        const tick = () => {
            const next = appidFromCurrentLocation();
            const changed = next !== sources.current.route;
            sources.current.route = next;
            if (changed && next != null) {
                const url = (window.location.pathname || "") +
                    (window.location.search || "") +
                    (window.location.hash || "");
                console.log(`[hammer-decky] route source matched AppID ${next} (url=${url})`);
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
    SP_REACT.useEffect(() => {
        const sc = window.SteamClient;
        const reg = sc?.URL?.RegisterForSteamURLChanges;
        if (typeof reg !== "function") {
            console.log("[hammer-decky] SteamClient.URL.RegisterForSteamURLChanges not available — skipping URL-event source");
            return;
        }
        let unregister;
        try {
            const handle = reg.call(sc.URL, (...args) => {
                // Some builds pass a string; others pass an object
                // with a {url} or {url_to_open} field.
                const candidates = [];
                for (const a of args) {
                    if (typeof a === "string")
                        candidates.push(a);
                    else if (a && typeof a === "object") {
                        for (const k of [
                            "url",
                            "url_to_open",
                            "strURL",
                            "strURLToOpen",
                        ]) {
                            if (typeof a[k] === "string")
                                candidates.push(a[k]);
                        }
                    }
                }
                for (const c of candidates) {
                    const id = appidFromString(c);
                    if (id != null && id !== sources.current.url) {
                        sources.current.url = id;
                        console.log(`[hammer-decky] SteamClient.URL source matched AppID ${id} (url=${c})`);
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
            if (typeof handle === "function")
                unregister = handle;
            else if (handle && typeof handle.unregister === "function")
                unregister = () => handle.unregister();
            console.log("[hammer-decky] SteamClient.URL.RegisterForSteamURLChanges installed");
        }
        catch (ex) {
            console.warn("[hammer-decky] failed to register SteamClient.URL listener", ex);
        }
        return () => {
            try {
                unregister?.();
            }
            catch (ex) {
                console.warn("[hammer-decky] URL listener unregister failed", ex);
            }
        };
    }, [reduce]);
    // Source 3: DOM URL-bar scrape (case B fallback)
    //
    // Same anti-stale-snapshot fix as Source 1: always update
    // sources.current.dom and call reduce(), even when nothing
    // changed, so panel diagnostics stay live.
    SP_REACT.useEffect(() => {
        const tick = () => {
            const next = appidFromDomScrape();
            const changed = next !== sources.current.dom;
            sources.current.dom = next;
            if (changed && next != null)
                console.log(`[hammer-decky] DOM-scrape source matched AppID ${next}`);
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
    SP_REACT.useEffect(() => {
        const beacon = () => {
            void reportDiagnostic("injector_state", {
                appid,
                sources: { ...sources.current },
                location: (window.location.pathname || "") +
                    (window.location.search || "") +
                    (window.location.hash || ""),
                ts: Date.now(),
            }).catch(() => undefined);
        };
        beacon();
        const interval = window.setInterval(beacon, 30000);
        return () => {
            window.clearInterval(interval);
        };
    }, [appid]);
    if (appid == null)
        return null;
    return SP_JSX.jsx(TitleAnchoredButton, { appid: appid }, appid);
};
// ── installInjector: public mount/unmount API ──────────────────────────────
const ROOT_ID = "hammer-decky-injector-root";
function installInjector() {
    if (document.getElementById(ROOT_ID)) {
        console.warn("[hammer-decky] injector already mounted, skipping");
        return () => undefined;
    }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;";
    document.body.appendChild(root);
    try {
        SP_REACTDOM.render(SP_JSX.jsx(InjectorController, {}), root);
        console.log("[hammer-decky] injector mounted (v0.9.3 — always-live diagnostics + sync title resolve)");
    }
    catch (ex) {
        console.error("[hammer-decky] failed to mount injector", ex);
        try {
            root.remove();
        }
        catch {
            /* ignore */
        }
        return () => undefined;
    }
    return () => {
        try {
            SP_REACTDOM.unmountComponentAtNode(root);
        }
        catch (ex) {
            console.warn("[hammer-decky] unmountComponentAtNode failed", ex);
        }
        try {
            root.remove();
        }
        catch {
            /* idempotent */
        }
        console.log("[hammer-decky] injector unmounted");
    };
}

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
async function cleanupPoisoned() {
    const w = window;
    const store = w.appStore || w.g_AppStore;
    if (!store) {
        return { ok: false, inspected: 0, removed: [], error: "no appStore on window" };
    }
    const mapApps = store.m_mapApps;
    if (!mapApps) {
        return { ok: false, inspected: 0, removed: [], error: "no m_mapApps" };
    }
    const removed = [];
    const inspected = [];
    try {
        // Snapshot the entries we want to inspect; mutating `m_mapApps`
        // mid-iteration is undefined behaviour for both ES Map and the
        // Mobx-observed wrapper Steam ships in some builds.
        const collected = [];
        if (typeof mapApps.entries === "function") {
            for (const [k, v] of mapApps.entries()) {
                collected.push([k, v]);
                if (collected.length >= 5000)
                    break;
            }
        }
        else if (typeof mapApps.forEach === "function") {
            mapApps.forEach((v, k) => {
                if (collected.length < 5000)
                    collected.push([k, v]);
            });
        }
        for (const [k, v] of collected) {
            const numericKey = typeof k === "number" ? k : Number(k);
            if (!Number.isFinite(numericKey))
                continue;
            inspected.push(numericKey);
            const isFakeName = v && typeof v.display_name === "string" && /^AppID\s+\d+$/.test(v.display_name);
            const tagsBroken = v &&
                v.m_setStoreTags &&
                !(v.m_setStoreTags instanceof Set) &&
                typeof v.m_setStoreTags.has !== "function";
            if (isFakeName || tagsBroken) {
                try {
                    if (typeof mapApps.delete === "function") {
                        mapApps.delete(k);
                    }
                    else if (typeof mapApps.remove === "function") {
                        mapApps.remove(k);
                    }
                    removed.push(numericKey);
                }
                catch {
                    // Per-entry failures are non-fatal — we'd rather
                    // clean 99 of 100 poisoned entries than abort the
                    // whole rescue on one stubborn key.
                }
            }
        }
    }
    catch (ex) {
        await reportDiagnostic("cleanup_poisoned_error", { error: String(ex) }).catch(() => undefined);
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

/**
 * AppID / Store URL entry via ConfirmModal.
 *
 * Inline PanelSection TextField stopped accepting keyboard input after
 * recent SteamOS / SteamUI updates — the OSK focus path only works
 * reliably inside a modal on Game Mode. This matches the pattern used
 * by other Decky plugins (ConfirmModal + Field + TextField).
 */


const AppIdInputModalBody = ({ initial = "", onDone, closeModal, }) => {
    const [val, setVal] = SP_REACT.useState(initial);
    const finish = (value) => {
        onDone(value);
        closeModal?.();
    };
    return (SP_JSX.jsx(DFL.ConfirmModal, { strTitle: "Enter AppID or Store URL", strDescription: "Paste a Steam store link or type a numeric AppID. " +
            "If the keyboard does not appear, press Steam + X.", strOKButtonText: "Done", strCancelButtonText: "Cancel", bOKDisabled: !val.trim(), onOK: () => finish(val.trim()), onCancel: () => finish(null), closeModal: closeModal, children: SP_JSX.jsx(DFL.Field, { label: "AppID or Steam Store URL", children: SP_JSX.jsx(DFL.TextField, { value: val, onChange: (e) => setVal(e?.target?.value ?? ""), style: { width: "100%", minWidth: "220px" } }) }) }));
};
/** Open the input modal; resolves to trimmed text or null if cancelled. */
function showAppIdInputModal(opts = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (v) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };
        DFL.showModal(SP_JSX.jsx(AppIdInputModalBody, { initial: opts.initial ?? "", onDone: settle }));
    });
}

/**
 * Gamepad-friendly numeric AppID entry — no OS keyboard required.
 * Useful when SteamOS updates break inline TextField / on-screen keyboard.
 */

const digitBtn = {
    minWidth: "44px",
    padding: "6px 10px",
    fontWeight: 700,
};
const AppIdDigitPad = ({ value, onChange, disabled }) => {
    const press = (d) => {
        if (disabled)
            return;
        if (value.length >= 9)
            return;
        onChange(value + d);
    };
    const backspace = () => {
        if (disabled || !value)
            return;
        onChange(value.slice(0, -1));
    };
    const clear = () => {
        if (disabled)
            return;
        onChange("");
    };
    const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", flexDirection: "column", gap: "8px", width: "100%" }, children: [SP_JSX.jsxs("div", { style: { fontSize: "13px", opacity: 0.85 }, children: ["Numeric keypad (no keyboard needed):", " ", SP_JSX.jsx("span", { style: { fontWeight: 700 }, children: value || "—" })] }), SP_JSX.jsxs("div", { style: {
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: "6px",
                        width: "100%",
                    }, children: [digits.map((d) => (SP_JSX.jsx(DFL.DialogButton, { disabled: disabled, onClick: () => press(d), style: digitBtn, children: d }, d))), SP_JSX.jsx(DFL.DialogButton, { disabled: disabled || !value, onClick: backspace, style: digitBtn, children: "\u232B" }), SP_JSX.jsx(DFL.DialogButton, { disabled: disabled || !value, onClick: clear, style: digitBtn, children: "CLR" })] })] }) }));
};

const CartResultsBody = ({ result, closeModal, onRestart }) => {
    const { results, successful, failed, cart_remaining, pending_count } = result;
    const anySucceeded = successful.length > 0;
    return (SP_JSX.jsx(DFL.ModalRoot, { onCancel: () => closeModal?.(), onEscKeypress: () => closeModal?.(), bAllowFullSize: false, closeModal: closeModal, children: SP_JSX.jsxs("div", { style: { padding: "4px 0 12px 0", maxHeight: "60vh", overflowY: "auto" }, children: [SP_JSX.jsxs("div", { style: {
                        fontSize: "16px",
                        fontWeight: 700,
                        marginBottom: "10px",
                    }, children: ["Cart processed \u2014 ", successful.length, " succeeded", failed.length > 0 ? `, ${failed.length} failed` : ""] }), SP_JSX.jsx("div", { style: {
                        fontSize: "13px",
                        opacity: 0.8,
                        marginBottom: "14px",
                        lineHeight: 1.4,
                    }, children: anySucceeded
                        ? `${successful.length} .hammer file${successful.length === 1 ? " is" : "s are"} now on disk. ${pending_count > 0
                            ? `Restart Steam to bring ${pending_count} game${pending_count === 1 ? "" : "s"} into the library.`
                            : "Restart Steam to apply."}`
                        : "No .hammer files were produced. Failed items remain in cart so you can retry." }), results.length === 0 && (SP_JSX.jsx("div", { style: { opacity: 0.6, fontSize: "13px" }, children: "Cart was empty." })), results.map((r) => (SP_JSX.jsx("div", { style: {
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        margin: "4px 0",
                        borderRadius: "4px",
                        background: r.ok
                            ? "rgba(28, 134, 60, 0.18)"
                            : "rgba(176, 32, 32, 0.18)",
                        border: `1px solid ${r.ok
                            ? "rgba(28, 134, 60, 0.35)"
                            : "rgba(176, 32, 32, 0.35)"}`,
                    }, children: SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "center", gap: "10px" }, children: [SP_JSX.jsx("span", { style: {
                                    width: "20px",
                                    fontSize: "16px",
                                    fontWeight: 700,
                                    color: r.ok ? "#2adb5e" : "#ff6b6b",
                                    textAlign: "center",
                                }, children: r.ok ? "✓" : "✗" }), SP_JSX.jsxs("div", { children: [SP_JSX.jsx("div", { style: { fontWeight: 600 }, children: r.title || `AppID ${r.appid}` }), SP_JSX.jsxs("div", { style: {
                                            fontSize: "12px",
                                            opacity: 0.75,
                                            marginTop: "2px",
                                        }, children: ["AppID ", r.appid, " \u00B7", " ", r.ok
                                                ? `stage=${r.stage} — .hammer ready`
                                                : r.error || `failed at ${r.stage}`] })] })] }) }, r.appid))), cart_remaining > 0 && (SP_JSX.jsxs("div", { style: {
                        marginTop: "12px",
                        padding: "8px 12px",
                        background: "rgba(184, 109, 33, 0.15)",
                        border: "1px solid rgba(184, 109, 33, 0.35)",
                        borderRadius: "4px",
                        fontSize: "12px",
                        opacity: 0.9,
                    }, children: [cart_remaining, " item", cart_remaining === 1 ? "" : "s", " still in cart. You can retry from the QAM panel after fixing the underlying issue (e.g. internet drop, AppID typo)."] })), SP_JSX.jsxs("div", { style: {
                        display: "flex",
                        gap: "8px",
                        marginTop: "16px",
                        justifyContent: "flex-end",
                    }, children: [SP_JSX.jsx("button", { onClick: () => closeModal?.(), style: {
                                padding: "8px 16px",
                                borderRadius: "4px",
                                border: "1px solid rgba(255, 255, 255, 0.2)",
                                background: "rgba(255, 255, 255, 0.06)",
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: "13px",
                                fontWeight: 600,
                            }, children: "Close" }), anySucceeded && (SP_JSX.jsx("button", { onClick: () => {
                                closeModal?.();
                                onRestart();
                            }, style: {
                                padding: "8px 16px",
                                borderRadius: "4px",
                                border: "1px solid rgba(28, 134, 60, 0.6)",
                                background: "rgba(28, 134, 60, 0.85)",
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: "13px",
                                fontWeight: 700,
                            }, children: "Restart Steam (10s)" }))] })] }) }));
};
/**
 * Open the modal. Resolves to "restarted" / "closed" so callers can
 * decide whether to refresh their state. The promise also implicitly
 * tracks the modal's lifetime — the caller can `await` on it before
 * doing UI work that should happen after the user dismisses.
 */
function showCartResultsModal(result, pendingCount) {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (v) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };
        const handle = DFL.showModal(SP_JSX.jsx(CartResultsBody, { result: result, onRestart: () => {
                void startSteamRestartCountdown({
                    pendingCount: pendingCount || result.successful.length,
                    source: "cart_results_modal",
                }).then(() => settle("restarted"));
            }, closeModal: () => {
                handle?.Close();
                settle("closed");
            } }), undefined, { strTitle: "Hammer cart results" });
        if (!handle)
            settle("closed");
    });
}

const HammerLibraryPanel = () => {
    const [health, setHealth] = SP_REACT.useState(null);
    const [installed, setInstalled] = SP_REACT.useState([]);
    const [pending, setPending] = SP_REACT.useState({ count: 0, entries: [] });
    const [cart, setCart] = SP_REACT.useState({ count: 0, appids: [] });
    const [input, setInput] = SP_REACT.useState("");
    const [busy, setBusy] = SP_REACT.useState(false);
    const [statusLine, setStatusLine] = SP_REACT.useState(null);
    const detection = useDetectionState();
    // Title cache for the *Installed* list (not covered by getCart).
    // Backend caches titles for cart entries, but installed entries
    // come straight from disk and need an explicit resolveTitles call.
    const [installedTitles, setInstalledTitles] = SP_REACT.useState({});
    // Cached title for the "ADD THIS GAME" detected-AppID button so
    // the button label can read "Add 'Stardew Valley' to cart" rather
    // than "Add 413150 to cart".
    const [detectedTitle, setDetectedTitle] = SP_REACT.useState(null);
    // Diagnostics-section state: last `probe_title` result and last
    // `diagnostics_snapshot` blob, both rendered as small status
    // lines under their respective buttons.
    const [probeStatus, setProbeStatus] = SP_REACT.useState(null);
    const [snapshot, setSnapshot] = SP_REACT.useState(null);
    // ── refresh helpers ────────────────────────────────────────────────────
    const refreshHealth = SP_REACT.useCallback(async () => {
        try {
            setHealth(await healthCheck());
        }
        catch (ex) {
            setHealth({ ok: false, reason: "rpc_failed", error: String(ex) });
        }
    }, []);
    const refreshInstalled = SP_REACT.useCallback(async () => {
        try {
            setInstalled(await listInstalled());
        }
        catch (ex) {
            console.error("[hammer-decky] list_installed failed", ex);
        }
    }, []);
    const refreshPending = SP_REACT.useCallback(async () => {
        try {
            setPending(await getPending());
        }
        catch (ex) {
            console.error("[hammer-decky] get_pending failed", ex);
        }
    }, []);
    const refreshCart = SP_REACT.useCallback(async () => {
        try {
            setCart(await getCart());
        }
        catch (ex) {
            console.error("[hammer-decky] get_cart failed", ex);
        }
    }, []);
    const refreshAll = SP_REACT.useCallback(async () => {
        await Promise.all([
            refreshHealth(),
            refreshInstalled(),
            refreshPending(),
            refreshCart(),
        ]);
    }, [refreshHealth, refreshInstalled, refreshPending, refreshCart]);
    SP_REACT.useEffect(() => {
        void refreshAll();
        // Periodic re-poll of cart + pending so panel stays in sync
        // when the user adds via the in-page button while the panel
        // is open.
        const id = window.setInterval(() => {
            void refreshCart();
            void refreshPending();
        }, 2000);
        return () => window.clearInterval(id);
    }, [refreshAll, refreshCart, refreshPending]);
    // Resolve titles for the Installed list whenever it changes
    // (entries are added / removed). The backend keeps a session
    // cache so re-resolving the same set is cheap.
    SP_REACT.useEffect(() => {
        const ids = installed.map((g) => g.appid).filter((a) => a > 0);
        const missing = ids.filter((a) => !installedTitles[String(a)]);
        if (missing.length === 0)
            return;
        let cancelled = false;
        void (async () => {
            const resolved = await resolveTitlesSafe(missing);
            if (cancelled)
                return;
            setInstalledTitles((prev) => ({ ...prev, ...resolved }));
        })();
        return () => {
            cancelled = true;
        };
    }, [installed, installedTitles]);
    // Resolve the title for the currently-detected AppID so the
    // "ADD THIS GAME" button can render the actual game name. Refreshes
    // whenever the user navigates to a different store page.
    SP_REACT.useEffect(() => {
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
            if (cancelled)
                return;
            setDetectedTitle(map[String(appid)] ?? null);
        })();
        return () => {
            cancelled = true;
        };
    }, [detection.appid, cart.titles, installedTitles]);
    // ── actions ────────────────────────────────────────────────────────────
    const addAppidToCart = SP_REACT.useCallback(async (appid, hint) => {
        setBusy(true);
        try {
            const res = await cartAdd(appid);
            const friendly = res.title ?? hint;
            if (res.ok) {
                setStatusLine(res.added
                    ? `Added "${friendly}" to cart (${res.cart_count ?? "?"} total).`
                    : `"${friendly}" was already in cart.`);
                await refreshCart();
                return true;
            }
            setStatusLine(`Failed: ${res.error ?? "unknown"}`);
            return false;
        }
        catch (ex) {
            setStatusLine(`RPC error: ${ex}`);
            return false;
        }
        finally {
            setBusy(false);
        }
    }, [refreshCart]);
    const onOpenInputModal = SP_REACT.useCallback(async () => {
        if (busy)
            return;
        const next = await showAppIdInputModal({ initial: input });
        if (next != null)
            setInput(next);
    }, [busy, input]);
    const onAddToCart = SP_REACT.useCallback(async () => {
        if (!input.trim() || busy)
            return;
        const appid = coerceAppid(input.trim());
        if (appid == null) {
            setStatusLine("Invalid AppID or Steam Store URL.");
            return;
        }
        const ok = await addAppidToCart(appid, `AppID ${appid}`);
        if (ok)
            setInput("");
    }, [input, busy, addAppidToCart]);
    // "ADD THIS GAME" — one-tap shortcut that uses the AppID currently
    // detected by the in-page injector (URL polling / SteamClient.URL
    // event / DOM scrape). Skips the input field entirely; the user
    // doesn't have to remember or type the AppID. This is the
    // primary path for the Big Picture web-store case where the
    // floating banner sometimes can't be rendered.
    const onAddThisGame = SP_REACT.useCallback(async () => {
        if (busy)
            return;
        const appid = detection.appid;
        if (appid == null) {
            setStatusLine("No game detected on the current page. Open a Steam app page first.");
            return;
        }
        await addAppidToCart(appid, detectedTitle ?? `AppID ${appid}`);
    }, [busy, detection.appid, detectedTitle, addAppidToCart]);
    const onRemoveFromCart = SP_REACT.useCallback(async (appid) => {
        try {
            const res = await cartRemove(appid);
            if (res.ok && res.removed) {
                setStatusLine(`Removed AppID ${appid} from cart.`);
            }
            await refreshCart();
        }
        catch (ex) {
            setStatusLine(`Remove failed: ${ex}`);
        }
    }, [refreshCart]);
    const onClearCart = SP_REACT.useCallback(async () => {
        try {
            const res = await cartClear();
            if (res.ok) {
                setStatusLine(`Cart cleared (${res.cleared ?? 0} entries).`);
            }
            await refreshCart();
        }
        catch (ex) {
            setStatusLine(`Clear failed: ${ex}`);
        }
    }, [refreshCart]);
    const onProcessCart = SP_REACT.useCallback(async () => {
        if (busy || cart.count === 0)
            return;
        setBusy(true);
        setStatusLine(`Processing ${cart.count} cart item(s) via ValveOFF…`);
        try {
            const result = await processCart();
            await Promise.all([refreshCart(), refreshPending(), refreshInstalled()]);
            setStatusLine(`Cart processed — ${result.successful.length} ok, ${result.failed.length} failed`);
            toaster.toast({
                title: "Hammer cart",
                body: `${result.successful.length} of ${result.successful.length + result.failed.length} AppIDs added. Restart Steam to apply.`,
                icon: SP_JSX.jsx(FaHammer, {}),
                duration: 5000,
            });
            await showCartResultsModal(result, result.pending_count);
            // After the modal is dismissed (whether or not user
            // chose Restart), re-pull state so the panel reflects
            // any restart-related side-effects (none, on cancel) or
            // the queue having been emptied (on restart, but the
            // panel will be torn down with Steam in that case).
            await Promise.all([refreshCart(), refreshPending()]);
        }
        catch (ex) {
            setStatusLine(`Process failed: ${ex}`);
        }
        finally {
            setBusy(false);
        }
    }, [busy, cart.count, refreshCart, refreshPending, refreshInstalled]);
    const onRestart = SP_REACT.useCallback(async () => {
        const result = await startSteamRestartCountdown({
            pendingCount: pending.count,
            source: "panel_apply",
        });
        if (result === "cancelled") {
            setStatusLine("Restart cancelled. Pending queue is unchanged.");
            await refreshPending();
        }
    }, [pending.count, refreshPending]);
    const onRemoveInstalled = SP_REACT.useCallback(async (appid) => {
        try {
            const res = await removeGame(appid);
            setStatusLine(res.ok
                ? `Removed ${res.filename ?? `${appid}.hammer`}`
                : `Remove failed: ${res.error}`);
            await Promise.all([refreshInstalled(), refreshPending()]);
        }
        catch (ex) {
            setStatusLine(`Remove failed: ${ex}`);
        }
    }, [refreshInstalled, refreshPending]);
    // ── render ─────────────────────────────────────────────────────────────
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Add a game", children: [health && !health.ok && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Backend status", description: `ValveOFF unavailable: ${health.reason}${"error" in health && health.error ? ` (${health.error})` : ""}`, highlightOnFocus: true }) })), health && health.ok && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Backend", description: health.cli_ready
                                ? `Ready (v${health.version ?? "?"}) — ${health.valveoff_path}`
                                : "ValveOFF found but --cli mode unavailable. Update ValveOFF." }) })), detection.appid != null && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || health?.ok === false, onClick: () => void onAddThisGame(), children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    color: "#fff",
                                    background: "rgba(196, 38, 38, 0.95)",
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                    fontWeight: 700,
                                }, children: [SP_JSX.jsx(FaPlus, {}), detectedTitle
                                        ? `ADD THIS GAME — ${detectedTitle}`
                                        : `ADD THIS GAME — AppID ${detection.appid}`] }) }) })), detection.appid != null && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Detected on current page", description: `AppID ${detection.appid}${detectedTitle ? ` · ${detectedTitle}` : " · (resolving title…)"}` }) })), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => void onOpenInputModal(), children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-start",
                                    gap: "4px",
                                }, children: [SP_JSX.jsx("span", { style: { fontWeight: 700 }, children: input.trim()
                                            ? "Edit AppID / Store URL"
                                            : "Enter AppID or Store URL" }), SP_JSX.jsx("span", { style: { fontSize: "12px", opacity: 0.8 }, children: input.trim()
                                            ? input
                                            : "Opens keyboard modal (Steam + X if keyboard missing)" })] }) }) }), SP_JSX.jsx(AppIdDigitPad, { value: input, onChange: setInput, disabled: busy }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || !input.trim() || health?.ok === false, onClick: () => void onAddToCart(), children: busy ? (SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [SP_JSX.jsx(DFL.Spinner, { style: { width: 16, height: 16 } }), "Adding to cart\u2026"] })) : (SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [SP_JSX.jsx(FaPlus, {}), "Add to cart"] })) }) }), statusLine && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Status", description: statusLine }) }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: `Cart (${cart.count} item${cart.count === 1 ? "" : "s"})`, children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: cart.count === 0
                                ? "Cart is empty"
                                : `${cart.count} AppID${cart.count === 1 ? "" : "s"} ready to process`, description: cart.count === 0
                                ? "Tap the in-page Add to Library button on a Steam app page (or paste an AppID above)."
                                : "Press Process cart to run ValveOFF on every item. Successful ones move to Pending; failed ones stay in cart." }) }), cart.appids.slice(0, 16).map((id) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "8px",
                                width: "100%",
                            }, children: [SP_JSX.jsx("div", { style: { flex: 1 }, children: SP_JSX.jsx(DFL.Field, { label: titleFor(id, cart.titles), description: `AppID ${id} · queued` }) }), SP_JSX.jsx(DFL.DialogButton, { onClick: () => void onRemoveFromCart(id), style: { minWidth: "32px", padding: "4px 8px" }, children: SP_JSX.jsx(FaTrash, {}) })] }) }, `cart-${id}`))), cart.appids.length > 16 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "\u2026", description: `+${cart.appids.length - 16} more in cart` }) })), cart.count > 0 && (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || health?.ok === false, onClick: () => void onProcessCart(), children: busy ? (SP_JSX.jsxs(DFL.Focusable, { style: {
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                        }, children: [SP_JSX.jsx(DFL.Spinner, { style: { width: 16, height: 16 } }), "Processing\u2026"] })) : (SP_JSX.jsxs(DFL.Focusable, { style: {
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                        }, children: [SP_JSX.jsx(FaHammer, {}), "Process cart (", cart.count, ")"] })) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.DialogButton, { onClick: () => void onClearCart(), style: { width: "100%" }, disabled: busy, children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                        }, children: [SP_JSX.jsx(FaTrash, {}), "Clear cart"] }) }) })] }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Apply pending changes", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: pending.count === 0
                                ? "No pending games"
                                : `${pending.count} game${pending.count === 1 ? "" : "s"} waiting for restart`, description: pending.count === 0
                                ? "Process cart first; successful items will land here."
                                : "Hammer's hook only refires when Steam starts. Restart now to bring the new game(s) into the library." }) }), pending.entries.slice(0, 6).map((e) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: e.title || `AppID ${e.appid}`, description: `AppID ${e.appid} · added ${timeAgo(e.added_at)}` }) }, `pending-${e.appid}`))), pending.entries.length > 6 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "\u2026", description: `+${pending.entries.length - 6} more queued` }) })), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy || health?.ok === false, onClick: () => void onRestart(), children: SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [SP_JSX.jsx(FaSyncAlt, {}), "Restart Steam (10s countdown)"] }) }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: `Installed (${installed.length})`, children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.DialogButton, { onClick: () => void refreshInstalled(), style: { width: "100%" }, children: SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [SP_JSX.jsx(FaSyncAlt, {}), "Rescan disk"] }) }) }), installed.length === 0 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "No .hammer files", description: "Add a game above, or copy .hammer files into ~/.config/hammersteam/." }) })), installed.slice(0, 12).map((g) => {
                        const title = installedTitles[String(g.appid)];
                        return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "8px",
                                    width: "100%",
                                }, children: [SP_JSX.jsx("div", { style: { flex: 1 }, children: SP_JSX.jsx(DFL.Field, { label: title || `AppID ${g.appid || "?"}`, description: `${g.appid
                                                ? `AppID ${g.appid} · `
                                                : ""}${g.filename} • ${formatBytes(g.size_bytes)} • ${timeAgo(g.mtime)}` }) }), SP_JSX.jsx(DFL.DialogButton, { onClick: () => void onRemoveInstalled(g.appid), style: { minWidth: "32px", padding: "4px 8px" }, children: SP_JSX.jsx(FaTrash, {}) })] }) }, g.filename));
                    }), installed.length > 12 && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "\u2026", description: `+${installed.length - 12} more` }) }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Diagnostics", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Plugin version (frontend)", description: `v${detection.pluginVersion}` }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Backend version", description: health?.ok
                                ? `v${health.version ?? "?"}`
                                : "(backend not ready)" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Detected AppID", description: detection.appid != null
                                ? `${detection.appid} — button ${detection.lastTitle ? "anchored" : "floating fallback"}`
                                : "(none — open a Steam app page)" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Detection sources", description: `SteamClient.URL=${detection.sources.url ?? "—"} • route=${detection.sources.route ?? "—"} • DOM=${detection.sources.dom ?? "—"}` }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Last route", description: detection.lastUrl || "(empty)" }) }), detection.lastTitle && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Anchored to title", description: detection.lastTitle }) })), detection.appid != null && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => {
                                setInput(String(detection.appid));
                                setStatusLine(`Pasted AppID ${detection.appid} from current page.`);
                            }, children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }, children: [SP_JSX.jsx(FaPlus, {}), "Copy detected AppID into input"] }) }) })), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => {
                                void (async () => {
                                    const probe_id = coerceAppid(input.trim()) ??
                                        detection.appid ??
                                        413150; // Stardew Valley as a known-good
                                    setProbeStatus(`probing ${probe_id}…`);
                                    try {
                                        const res = await probeTitle(probe_id);
                                        if (res.ok) {
                                            setProbeStatus(`OK · ${probe_id} → "${res.name}" (${res.status}, ${res.elapsed ?? "?"}s)`);
                                        }
                                        else {
                                            setProbeStatus(`FAIL · ${probe_id} status=${res.status ?? "?"}${res.elapsed != null
                                                ? ` (${res.elapsed}s)`
                                                : ""}`);
                                        }
                                    }
                                    catch (ex) {
                                        setProbeStatus(`RPC error: ${ex}`);
                                    }
                                })();
                            }, children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }, children: [SP_JSX.jsx(FaSyncAlt, {}), "Force probe title (AppID = input/detected/413150)"] }) }) }), probeStatus && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Last probe", description: probeStatus }) })), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => {
                                void (async () => {
                                    try {
                                        const snap = await diagnosticsSnapshot();
                                        setSnapshot(snap);
                                    }
                                    catch (ex) {
                                        setStatusLine(`diagnostics_snapshot RPC failed: ${ex}`);
                                    }
                                })();
                            }, children: SP_JSX.jsxs(DFL.Focusable, { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }, children: [SP_JSX.jsx(FaSyncAlt, {}), "Refresh backend snapshot"] }) }) }), snapshot && (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Title-cache size", description: `${snapshot.title_cache_size} resolved title(s) in session cache` }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Field, { label: "Cache sample", description: Object.keys(snapshot.title_cache_sample).length === 0
                                        ? "(empty — title resolver hasn't successfully fetched anything yet)"
                                        : Object.entries(snapshot.title_cache_sample)
                                            .map(([id, name]) => `${id} → ${name}`)
                                            .join(" · ") }) })] }))] })] }));
};

// ── Mount-time rescue ──────────────────────────────────────────────────────
const PanelWithCleanup = () => {
    SP_REACT.useEffect(() => {
        void (async () => {
            try {
                const out = await cleanupPoisoned();
                if (out.ok && out.removed.length > 0) {
                    console.log(`[hammer-decky] auto-cleanup removed ${out.removed.length} poisoned m_mapApps entr(y/ies):`, out.removed);
                }
            }
            catch (ex) {
                console.error("[hammer-decky] auto-cleanup failed (non-fatal)", ex);
            }
        })();
    }, []);
    return SP_JSX.jsx(HammerLibraryPanel, {});
};
// ── Plugin definition ─────────────────────────────────────────────────────
var index = definePlugin(() => {
    console.log("[hammer-decky] plugin loaded (v0.9.13 — fix React/SP_REACT build for Decky 3.x QAM)");
    // Mount the in-page Add-to-Library button injector. Returns the
    // tear-down function used by `onDismount` so reinstalls / hot
    // reloads don't leave stray DOM hosts behind.
    const removeInjector = installInjector();
    return {
        name: "Hammer Library",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Hammer Library" }),
        content: SP_JSX.jsx(PanelWithCleanup, {}),
        icon: SP_JSX.jsx(FaHammer, {}),
        onDismount: () => {
            console.log("[hammer-decky] plugin unmounted");
            try {
                removeInjector();
            }
            catch (ex) {
                console.warn("[hammer-decky] removeInjector failed", ex);
            }
        },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
