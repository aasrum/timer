import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import {
  db,
  getStationId,
  setSetting,
  uid,
  type Participant,
  type QueueEntry,
  type Registration,
} from "../db";
import { computeExpectedAt, startTimeFor } from "../results";
import { formatClockTenths, formatDuration, formatPace } from "../time";
import { Screen, useToast } from "../ui";

export default function Timing() {
  const { raceId = "" } = useParams();
  const race = useLiveQuery(() => db.races.get(raceId), [raceId]);
  const distances = useLiveQuery(
    () => db.distances.where({ raceId }).sortBy("order"),
    [raceId],
  );
  const timingPoints = useLiveQuery(
    () => db.timingPoints.where({ raceId }).sortBy("order"),
    [raceId],
  );
  const participants = useLiveQuery(
    () => db.participants.where({ raceId }).toArray(),
    [raceId],
  );
  const selectedSetting = useLiveQuery(
    () => db.settings.get(`tp:${raceId}`),
    [raceId],
  );
  const allRegistrations = useLiveQuery(
    () => db.registrations.where({ raceId }).toArray(),
    [raceId],
  );
  const toast = useToast();

  const [stationId, setStationId] = useState<string>("");
  const [bibInput, setBibInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const [showAllExpected, setShowAllExpected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStationId().then(setStationId);
  }, []);

  // Levende klokke.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const selectedTP = (selectedSetting?.value as string) || "";

  // Velg automatisk et tidspunkt (helst Mål) hvis ingen er valgt.
  useEffect(() => {
    if (!timingPoints || timingPoints.length === 0) return;
    if (selectedTP && timingPoints.some((tp) => tp.id === selectedTP)) return;
    const finish = timingPoints.find((tp) => tp.kind === "finish");
    setSetting(`tp:${raceId}`, (finish ?? timingPoints[0]).id);
  }, [timingPoints, selectedTP, raceId]);

  const queue = useLiveQuery(
    () =>
      selectedTP
        ? db.queueEntries
            .where({ raceId, timingPointId: selectedTP })
            .toArray()
        : Promise.resolve([] as QueueEntry[]),
    [raceId, selectedTP],
  );

  const recent = useLiveQuery(
    () =>
      selectedTP
        ? db.registrations
            .where({ raceId, timingPointId: selectedTP })
            .reverse()
            .sortBy("timestamp")
        : Promise.resolve([] as Registration[]),
    [raceId, selectedTP],
  );

  const pMap = useMemo(
    () => new Map((participants ?? []).map((p) => [p.bib, p])),
    [participants],
  );
  const dMap = useMemo(
    () => new Map((distances ?? []).map((d) => [d.id, d])),
    [distances],
  );

  const tp = timingPoints?.find((t) => t.id === selectedTP);
  const matched: Participant | undefined = bibInput
    ? pMap.get(bibInput.trim())
    : undefined;

  const expectedRunners = useMemo(() => {
    if (!tp || !participants || !timingPoints || !allRegistrations || !distances)
      return [];
    return computeExpectedAt(tp, participants, dMap, timingPoints, allRegistrations);
  }, [tp, participants, timingPoints, allRegistrations, dMap, distances]);

  if (!race) return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  async function addToQueue(bib: string) {
    if (!bib || !selectedTP) return;
    const exists = (queue ?? []).some((q) => q.bib === bib);
    if (exists) {
      toast(`#${bib} er allerede i køen`);
      return;
    }
    const entry: QueueEntry = {
      id: uid(),
      raceId,
      timingPointId: selectedTP,
      bib,
      addedAt: Date.now(),
    };
    await db.queueEntries.add(entry);
  }

  async function addBibToQueue() {
    const bib = bibInput.trim();
    if (!bib) return;
    await addToQueue(bib);
    setBibInput("");
    inputRef.current?.focus();
  }

  async function recordFinish(bib: string, queueId?: string) {
    if (!selectedTP) return;
    const ts = Date.now();
    const reg: Registration = {
      id: uid(),
      raceId,
      bib,
      timingPointId: selectedTP,
      timestamp: ts,
      stationId,
      deleted: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.registrations.add(reg);
    if (queueId) await db.queueEntries.delete(queueId);
    const p = pMap.get(bib);
    const d = p ? dMap.get(p.distanceId) : undefined;
    const start = p ? startTimeFor(p, d) : undefined;
    toast(
      start != null
        ? `#${bib} ${formatDuration(ts - start)}`
        : `#${bib} ${formatClockTenths(ts)}`,
    );
  }

  async function recordNow() {
    const bib = bibInput.trim();
    if (!bib) return;
    await recordFinish(bib);
    setBibInput("");
    inputRef.current?.focus();
  }

  async function removeQueue(id: string) {
    await db.queueEntries.delete(id);
  }

  async function undo(reg: Registration) {
    await db.registrations.update(reg.id, {
      deleted: true,
      updatedAt: Date.now(),
    });
    toast(`Angret #${reg.bib}`);
  }

  const sortedQueue = [...(queue ?? [])].sort((a, b) => a.addedAt - b.addedAt);
  const recentVisible = (recent ?? []).filter((r) => !r.deleted).slice(0, 10);
  const registerLabel = tp?.kind === "split" ? "Registrer" : "MÅL";

  // Bare vis løpere der vi har beregnet ETA fra faktiske mellomtider.
  // Løpere uten ETA (ingen tidligere passeringer) vises ikke – det
  // ville gitt en ubrukelig liste på hundrevis av navn.
  const EXPECTED_LIMIT = 15;
  const expectedWithEta = expectedRunners.filter((r) => r.eta != null);
  const visibleExpected = showAllExpected
    ? expectedWithEta
    : expectedWithEta.slice(0, EXPECTED_LIMIT);
  const hiddenExpected = expectedWithEta.length - visibleExpected.length;

  return (
    <Screen title="Tidtaking" back={`/race/${raceId}`}>
      <div className="card row spread">
        <div>
          <div className="tiny muted">Klokke</div>
          <div className="big mono">{formatClockTenths(now)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="tiny muted">Stasjon</div>
          <div className="mono tiny">{stationId.slice(0, 6) || "…"}</div>
        </div>
      </div>

      <div className="tabs">
        {(timingPoints ?? []).map((t) => {
          const d = dMap.get(t.distanceId);
          return (
            <button
              key={t.id}
              className={t.id === selectedTP ? "active" : ""}
              onClick={() => setSetting(`tp:${raceId}`, t.id)}
            >
              {d?.name}: {t.name}
            </button>
          );
        })}
      </div>

      {!tp && (
        <div className="empty">
          Opprett minst én distanse med et måltidspunkt under Oppsett.
        </div>
      )}

      {tp && (
        <>
          {/* Forventede løpere – kun de med beregnet ETA */}
          {expectedWithEta.length > 0 && (
            <>
              <h2>Forventede ({expectedWithEta.length})</h2>
              {visibleExpected.map(({ participant, eta, paceSecPerKm }) => {
                const d = dMap.get(participant.distanceId);
                const etaStr = formatClockTenths(eta!);
                const etaRelMin = Math.round((eta! - now) / 60000);
                return (
                  <div
                    key={participant.id}
                    className="list-item"
                    style={{ gap: 8 }}
                  >
                    <div
                      className="mono"
                      style={{ minWidth: 48, fontWeight: 700, fontSize: 18 }}
                    >
                      {participant.bib}
                    </div>
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{participant.name}</div>
                      <div className="tiny muted">
                        {[d?.name, participant.club].filter(Boolean).join(" · ")}
                        {paceSecPerKm != null && (
                          <span>
                            {" "}· {formatPace(paceSecPerKm * 1000, 1000)}
                          </span>
                        )}
                      </div>
                      <div
                        className="tiny mono"
                        style={{
                          color:
                            etaRelMin <= 2
                              ? "var(--warning)"
                              : "var(--muted)",
                        }}
                      >
                        ETA {etaStr}{" "}
                        ({etaRelMin >= 0
                          ? `om ${etaRelMin} min`
                          : `${Math.abs(etaRelMin)} min siden`})
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button
                        className="ghost small"
                        onClick={() => addToQueue(participant.bib)}
                      >
                        Kø ↵
                      </button>
                      <button
                        className="ghost small"
                        style={{
                          background: "var(--success)",
                          border: "none",
                          color: "var(--text)",
                        }}
                        onClick={() => recordFinish(participant.bib)}
                      >
                        {registerLabel}
                      </button>
                    </div>
                  </div>
                );
              })}
              {hiddenExpected > 0 && (
                <button
                  className="ghost small"
                  style={{ width: "100%", marginBottom: 8 }}
                  onClick={() => setShowAllExpected(true)}
                >
                  Vis {hiddenExpected} til ↓
                </button>
              )}
              {showAllExpected && expectedWithEta.length > EXPECTED_LIMIT && (
                <button
                  className="ghost small"
                  style={{ width: "100%", marginBottom: 8 }}
                  onClick={() => setShowAllExpected(false)}
                >
                  Vis færre ↑
                </button>
              )}
            </>
          )}

          <div className="card">
            <label>Startnummer (forvarsel)</label>
            <input
              ref={inputRef}
              className="bib-entry"
              inputMode="numeric"
              autoFocus
              value={bibInput}
              onChange={(e) => setBibInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addBibToQueue();
              }}
              placeholder="––"
            />
            {bibInput.trim() && (
              <div className="row spread" style={{ marginTop: 6 }}>
                <span className={matched ? "" : "muted"}>
                  {matched
                    ? `${matched.name}${
                        matched.club ? " · " + matched.club : ""
                      }`
                    : "Ukjent startnummer"}
                </span>
              </div>
            )}
            <div className="fab-row">
              <button className="primary" onClick={addBibToQueue}>
                Legg i kø ↵
              </button>
              <button className="success" onClick={recordNow}>
                Registrer nå
              </button>
            </div>
            <div className="tiny muted">
              Legg i kø når deltakeren nærmer seg. Trykk {registerLabel} når hen passerer.
            </div>
          </div>

          <h2>I kø ({sortedQueue.length})</h2>
          {sortedQueue.length === 0 && (
            <div className="tiny muted" style={{ marginBottom: 12 }}>
              Køen er tom.
            </div>
          )}
          {sortedQueue.map((q) => {
            const p = pMap.get(q.bib);
            const d = p ? dMap.get(p.distanceId) : undefined;
            return (
              <div className="queue-item" key={q.id}>
                <div className="bib mono">{q.bib}</div>
                <div className="who">
                  <div className="name">{p?.name ?? "Ukjent"}</div>
                  <div className="tiny muted">
                    {[d?.name, p?.club].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button
                  className="ghost small"
                  onClick={() => removeQueue(q.id)}
                  aria-label="Fjern fra kø"
                >
                  ✕
                </button>
                <button
                  className="finish-btn"
                  onClick={() => recordFinish(q.bib, q.id)}
                >
                  {registerLabel}
                </button>
              </div>
            );
          })}

          <h2>Siste registrerte</h2>
          {recentVisible.length === 0 && (
            <div className="tiny muted">Ingen ennå.</div>
          )}
          {recentVisible.map((r) => {
            const p = pMap.get(r.bib);
            const d = p ? dMap.get(p.distanceId) : undefined;
            const start = p ? startTimeFor(p, d) : undefined;
            return (
              <div className="list-item" key={r.id}>
                <div className="bib mono" style={{ minWidth: 56 }}>
                  {r.bib}
                </div>
                <div className="grow">
                  <div>{p?.name ?? "Ukjent"}</div>
                  <div className="tiny muted mono">
                    {start != null
                      ? formatDuration(r.timestamp - start)
                      : formatClockTenths(r.timestamp)}
                  </div>
                </div>
                <button className="ghost small" onClick={() => undo(r)}>
                  Angre
                </button>
              </div>
            );
          })}
        </>
      )}
    </Screen>
  );
}
