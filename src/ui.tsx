import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";

// ── Toast (lett tilbakemelding ved registrering/lagring) ──────────────────────

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 1800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ── Skjerm-ramme med topplinje ────────────────────────────────────────────────

export function Screen({
  title,
  back,
  home,
  actions,
  children,
}: {
  title: string;
  back?: string;
  /**
   * Vis snarvei til løpsoversikten. Tilbake-pilen går bare ett nivå opp, så
   * uten denne er det tre trykk hjem fra f.eks. startklokka. Utelates for
   * stasjoner, som ikke har noen oversikt å gå til.
   */
  home?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        {back != null && (
          <Link className="back-link" to={back} aria-label="Tilbake">
            ‹
          </Link>
        )}
        {home && (
          <Link className="home-link" to="/" aria-label="Til løpsoversikten">
            ⌂
          </Link>
        )}
        <h1>{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  );
}

// ── Synk-status-badge ──────────────────────────────────────────────────────

export function SyncBadge({
  status,
  lastSyncedAt,
}: {
  status: "idle" | "syncing" | "ok" | "error" | "offline";
  lastSyncedAt: number | null;
}) {
  if (status === "idle") return null;
  const label =
    status === "syncing"
      ? "Synker…"
      : status === "offline"
        ? "Offline"
        : status === "error"
          ? "Synk feilet"
          : lastSyncedAt
            ? "Synket"
            : "";
  if (!label) return null;
  const color =
    status === "ok"
      ? "var(--success)"
      : status === "error"
        ? "var(--danger)"
        : "var(--muted)";
  return (
    <span className="tiny" style={{ color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ── Online/offline-indikator ──────────────────────────────────────────────────

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
