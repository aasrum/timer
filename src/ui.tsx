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

// ── Tekstfelt som lagres asynkront ────────────────────────────────────────────

/**
 * Inndatafelt for verdier som ligger i databasen.
 *
 * Et vanlig kontrollert felt (`value={p.bib}`) får verdien tilbake via en
 * asynkron lagring. Mellom tastetrykket og svaret rendres feltet med den
 * gamle verdien, og markøren havner i starten – taster man «23» blir det
 * «32». Her eies teksten lokalt mens feltet har fokus, så markøren ligger i
 * fred; databasen skrives fortsatt ved hvert tastetrykk. Utenfor fokus følger
 * feltet databasen, slik at endringer fra andre enheter fortsatt vises.
 */
export function PersistedInput({
  value,
  onValueChange,
  inputRef,
  ...rest
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (v: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);

  return (
    <input
      {...rest}
      ref={inputRef}
      value={local}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        onValueChange(e.target.value);
      }}
    />
  );
}

// ── Hold skjermen tent ────────────────────────────────────────────────────────

/**
 * Hindrer at skjermen slukker mens en skjerm står oppe under et løp – både
 * målestasjoner og startklokka står gjerne urørt i timevis.
 *
 * Krever HTTPS, og støttes ikke overalt (iOS fra 16.4). Slår det feil, slukker
 * skjermen som normalt; sett «Auto-lås: Aldri» på enheten som reserve.
 * Låsen mistes når fanen skjules, så den tas igjen når man er tilbake.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      if (stopped) return;
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Ikke støttet, avslått, eller batterisparing – ikke noe å gjøre.
      }
    };
    request();
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
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
