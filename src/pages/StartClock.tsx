import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { db, type Distance } from "../db";
import { useLiveSync } from "../liveSync";
import { formatClock } from "../time";
import { Screen, SyncBadge, useToast, useWakeLock } from "../ui";

/**
 * Startklokke: en stor, serverkorrigert klokke til å synkronisere klokker mot
 * før start, og nedtelling til starttiden for hver fellesstart-distanse.
 *
 * Nedtellingen går mot distansens massStartTime, som også ER starttiden løpet
 * regnes fra. Settes den på forhånd, blir nedtellingen og den registrerte
 * starttiden garantert samme øyeblikk – ingen egen "planlagt start" å holde
 * i sync med den virkelige.
 */
export default function StartClock() {
  const { raceId = "" } = useParams();
  const { auth } = useAuth();
  const race = useLiveQuery(() => db.races.get(raceId), [raceId]);
  const distances = useLiveQuery(
    () => db.distances.where({ raceId }).sortBy("order"),
    [raceId],
  );
  const offsetSetting = useLiveQuery(() => db.settings.get("clockOffsetMs"), []);
  const sync = useLiveSync(raceId);
  const toast = useToast();

  const [now, setNow] = useState(Date.now());
  const [beeps, setBeeps] = useState(false);

  // 10 Hz: nok til at sekundene skifter presist uten å tegne unødig ofte.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // Denne skjermen står typisk oppe på et startbord – og brukes som tidsvitne
  // foran et kamera ved mål, der den må være lesbar hele opptaket.
  useWakeLock();

  // Raden mangler helt til første synk er gjennomført – da er avviket ukjent,
  // ikke null. Verdien 0 betyr «målt, og enhetens klokke stemmer».
  const measured = offsetSetting !== undefined;
  const clockOffset = (offsetSetting?.value as number) ?? 0;
  const corrected = now + clockOffset;

  const massDistances = useMemo(
    () => (distances ?? []).filter((d) => d.startType === "mass"),
    [distances],
  );

  async function setStart(d: Distance, at: number) {
    await db.distances.update(d.id, { massStartTime: at, updatedAt: Date.now() });
    toast(`${d.name}: start kl ${formatClock(at)}`);
  }

  async function clearStart(d: Distance) {
    await db.distances.update(d.id, {
      massStartTime: undefined,
      updatedAt: Date.now(),
    });
  }

  const hh = new Date(corrected);
  const tenths = Math.floor((corrected % 1000) / 100);

  return (
    <Screen
      title="Startklokke"
      // Stasjoner har ikke tilgang til løpssiden (og ingen løpsoversikt), så
      // de sendes tilbake til tidtakingen de kom fra.
      back={
        auth.kind === "admin" ? `/race/${raceId}` : `/race/${raceId}/timing`
      }
      home={auth.kind === "admin"}
      actions={<SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />}
    >
      <div className="clock-hero">
        <div className="clock-big mono">
          {String(hh.getHours()).padStart(2, "0")}:
          {String(hh.getMinutes()).padStart(2, "0")}:
          {String(hh.getSeconds()).padStart(2, "0")}
          <span className="clock-tenths">.{tenths}</span>
        </div>
        <div className="tiny muted">
          {!measured
            ? "Enhetens egen klokke – ikke synkronisert mot serveren ennå"
            : Math.abs(clockOffset) < 500
              ? "✓ Stemmer med serverklokka"
              : `✓ Korrigert mot serverklokka (${clockOffset > 0 ? "+" : ""}${(
                  clockOffset / 1000
                ).toFixed(1)} s)`}
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          Alle enheter registrerer tider mot denne klokka. Vis den til
          startpersonell som skal stille egen klokke.
        </div>
      </div>

      {race?.status === "finished" && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          🏁 Løpet er avsluttet.
        </div>
      )}

      <div className="row spread" style={{ alignItems: "center", marginTop: 4 }}>
        <h2 style={{ margin: 0 }}>Start</h2>
        <button className="ghost small" onClick={() => setBeeps((v) => !v)}>
          {beeps ? "🔔 Lyd på" : "🔕 Lyd av"}
        </button>
      </div>

      {massDistances.length === 0 && (
        <div className="empty">
          Ingen fellesstart-distanser. Intervallstart bruker starttid per
          deltaker.
        </div>
      )}

      {massDistances.map((d) => (
        <CountdownCard
          key={d.id}
          distance={d}
          corrected={corrected}
          beeps={beeps}
          canEdit={auth.kind === "admin"}
          onSet={setStart}
          onClear={clearStart}
        />
      ))}
    </Screen>
  );
}

/** Neste hele minutt etter `from` (+ et lite slingringsmonn). */
function nextWholeMinute(from: number): number {
  return Math.ceil((from + 5000) / 60000) * 60000;
}

function CountdownCard({
  distance: d,
  corrected,
  beeps,
  canEdit,
  onSet,
  onClear,
}: {
  distance: Distance;
  corrected: number;
  beeps: boolean;
  canEdit: boolean;
  onSet: (d: Distance, at: number) => void;
  onClear: (d: Distance) => void;
}) {
  const start = d.massStartTime;
  const remaining = start != null ? start - corrected : null;
  const started = remaining != null && remaining <= 0;

  // Pip på hvert av de siste 10 sekundene, og en lang tone ved start. Basert
  // på hvilket sekund vi er inne i, så et pip ikke gjentas ved re-render.
  const lastBeep = useRef<number | null>(null);
  useEffect(() => {
    if (!beeps || remaining == null) return;
    if (remaining > 10500 || remaining < -500) return;
    const sec = Math.ceil(remaining / 1000);
    if (lastBeep.current === sec) return;
    lastBeep.current = sec;
    beep(sec <= 0 ? 880 : 440, sec <= 0 ? 600 : 120);
  }, [beeps, remaining]);

  return (
    <div className="card">
      <div className="row spread" style={{ alignItems: "baseline" }}>
        <div style={{ fontWeight: 600 }}>{d.name}</div>
        {start != null && (
          <div className="tiny muted mono">kl {formatClock(start)}</div>
        )}
      </div>

      {start == null ? (
        <div className="muted" style={{ margin: "8px 0" }}>
          Starttid ikke satt.
        </div>
      ) : (
        <div
          className={
            "countdown mono" +
            (started
              ? " countdown-started"
              : remaining! <= 10000
                ? " countdown-soon"
                : "")
          }
        >
          {started ? "+" : "−"}
          {formatCountdown(Math.abs(remaining!))}
        </div>
      )}
      {start != null && (
        <div className="tiny muted">
          {started ? "Tid siden start" : "Til start"}
        </div>
      )}

      {canEdit && (
        <div className="fab-row" style={{ marginTop: 10 }}>
          <button
            className="ghost small"
            onClick={() => onSet(d, nextWholeMinute(corrected))}
          >
            Neste hele minutt
          </button>
          {[2, 5, 10].map((m) => (
            <button
              key={m}
              className="ghost small"
              onClick={() => onSet(d, nextWholeMinute(corrected + m * 60000))}
            >
              +{m} min
            </button>
          ))}
          <button className="ghost small" onClick={() => onSet(d, corrected)}>
            Start nå
          </button>
          {start != null && (
            <button className="ghost small" onClick={() => onClear(d)}>
              Nullstill
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** mm:ss under en time, ellers h:mm:ss. Tiendeler under 10 sekunder. */
function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (ms < 10000) return `${s}.${Math.floor((ms % 1000) / 100)}`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

let audioCtx: AudioContext | null = null;

function beep(freq: number, durationMs: number) {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "square";
    // Kort inn- og utrampe, ellers knepper det hørbart.
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
    gain.gain.linearRampToValueAtTime(0, t + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durationMs / 1000 + 0.02);
  } catch {
    // Lyd er en bonus; stillhet er en akseptabel reserveløsning.
  }
}
