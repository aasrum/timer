import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  db,
  getStationId,
  setSetting,
  uid,
  type Distance,
  type Participant,
  type QueueEntry,
  type Registration,
} from "../db";
import { useAuth } from "../auth";
import { useLiveSync } from "../liveSync";
import { computeExpectedAt, computeResult, startTimeFor } from "../results";
import { formatClock, formatClockTenths, formatDuration, formatPace } from "../time";
import { Screen, SyncBadge, useToast } from "../ui";

export default function Timing() {
  const { raceId = "" } = useParams();
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const sync = useLiveSync(raceId);
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
  const offsetSetting = useLiveQuery(() => db.settings.get("clockOffsetMs"), []);
  const toast = useToast();

  // Klokkekorreksjon målt av synken: legges på alle tidsstempler slik at
  // registreringer fra enheter med feilstilt klokke blir sammenlignbare.
  const clockOffset = (offsetSetting?.value as number) ?? 0;

  // Stasjonens identitet: en innlogget stasjon bruker sin egen, ekte ID
  // (tildelt av admin); et admin-innlogget device faller tilbake til den
  // gamle anonyme per-nettleser-IDen, siden admin-kontoen er delt og vi
  // fortsatt vil kunne skille admin-enheter fra hverandre ved fletting.
  const [deviceId, setDeviceId] = useState<string>("");
  const [bibInput, setBibInput] = useState("");
  const [now, setNow] = useState(Date.now());
  const [showAllExpected, setShowAllExpected] = useState(false);
  const [assignInputs, setAssignInputs] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStationId().then(setDeviceId);
  }, []);

  const stationId =
    auth.kind === "station" ? auth.stationId : `admin-${deviceId.slice(0, 8)}`;
  const stationLabel =
    auth.kind === "station" ? auth.name : auth.kind === "admin" ? auth.name : "";

  // Levende klokke.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const selectedTP = (selectedSetting?.value as string) || "";

  // Velg automatisk et tidspunkt hvis ingen er valgt: foretrekk stasjonens
  // tildelte standardpunkt (kun forvalg, ikke en sperre – alle tabs er
  // fortsatt klikkbare), ellers Mål.
  useEffect(() => {
    if (!timingPoints || timingPoints.length === 0) return;
    if (selectedTP && timingPoints.some((tp) => tp.id === selectedTP)) return;
    const preferred =
      auth.kind === "station" && auth.defaultTimingPointId
        ? timingPoints.find((tp) => tp.id === auth.defaultTimingPointId)
        : undefined;
    const finish = timingPoints.find((tp) => tp.kind === "finish");
    setSetting(`tp:${raceId}`, (preferred ?? finish ?? timingPoints[0]).id);
  }, [timingPoints, selectedTP, raceId, auth]);

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

  // Bib-er som allerede er registrert ved dette punktet – brukes til å skjule
  // køoppføringer der registreringen skjedde på en annen enhet.
  // NB: må stå over den tidlige returen under, ellers varierer antall hooks
  // mellom renders og React kaster «Rendered more hooks than during the
  // previous render».
  const registeredBibs = useMemo(
    () =>
      new Set(
        (recent ?? []).filter((r) => !r.deleted && r.bib).map((r) => r.bib),
      ),
    [recent],
  );

  // Medgått tid kan bare vises for en fanget tid når det er utvetydig hvilken
  // start den hører til – altså én fellesstart-distanse i løpet.
  const startForTP = useMemo(() => {
    const mass = (distances ?? []).filter(
      (d) => d.startType === "mass" && d.massStartTime != null,
    );
    return mass.length === 1 ? mass[0].massStartTime : undefined;
  }, [distances]);

  // Tider fanget uten startnummer, eldste først: de skal knyttes i den
  // rekkefølgen løperne passerte.
  const unassigned = useMemo(
    () =>
      (recent ?? [])
        .filter((r) => !r.deleted && !r.bib)
        .sort((a, b) => a.timestamp - b.timestamp),
    [recent],
  );

  if (!race) return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  // Løpet er slettet av arrangøren. En stasjon står da igjen uten noe å gjøre
  // og bør få vite hvorfor, i stedet for å tro at oppsettet er på vei.
  if (race.deleted)
    return (
      <Screen title="Løpet er slettet" back={auth.kind === "admin" ? "/" : undefined}>
        <div className="empty">
          Arrangøren har slettet dette løpet.
          {auth.kind === "station" && (
            <div style={{ marginTop: 14 }}>
              <button
                className="ghost"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
              >
                Logg ut
              </button>
            </div>
          )}
        </div>
      </Screen>
    );

  async function addToQueue(bib: string) {
    if (!bib || !selectedTP || finished) return;
    const exists = (queue ?? []).some((q) => !q.deleted && q.bib === bib);
    if (exists) {
      toast(`#${bib} er allerede i køen`);
      return;
    }
    const now = Date.now();
    const entry: QueueEntry = {
      id: uid(),
      raceId,
      timingPointId: selectedTP,
      bib,
      addedAt: now,
      deleted: false,
      updatedAt: now,
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

  /**
   * Er startnummeret allerede registrert her? Det er nesten alltid en feil:
   * et dobbelttrykk, eller et startnummer tastet i stedet for et annet. Uten
   * denne sperren ville den nye tiden stilltiende erstattet den riktige –
   * en løper som var i mål på 37:09 kunne ende med 69:14.
   */
  function bekreftDublett(bib: string): boolean {
    const existing = (recent ?? [])
      .filter((r) => !r.deleted && r.bib === bib)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!existing) return true;
    const p = pMap.get(bib);
    const navn = p ? `${p.name} (#${bib})` : `#${bib}`;
    const start = p ? startTimeFor(p, dMap.get(p.distanceId)) : undefined;
    const gikk =
      start != null ? ` – tid ${formatDuration(existing.timestamp - start)}` : "";
    return confirm(
      `${navn} er allerede registrert ved ${tp?.name} kl ${formatClock(
        existing.timestamp,
      )}${gikk}.\n\nRegistrere på nytt? Den nye tiden blir gjeldende, og den gamle forkastes.`,
    );
  }

  /**
   * Tid uten startnummer. Ved tett målgang rekker man ikke å taste numre –
   * da fanger man passeringene i rekkefølge og knytter numrene til etterpå.
   * Tiden er det eneste som ikke kan hentes inn igjen i ettertid.
   */
  async function recordTimeOnly() {
    if (!selectedTP || finished) return;
    const ts = Date.now() + clockOffset;
    await db.registrations.add({
      id: uid(),
      raceId,
      bib: "",
      timingPointId: selectedTP,
      timestamp: ts,
      stationId,
      deleted: false,
      createdAt: ts,
      updatedAt: ts,
    });
    toast(`Tid tatt ${formatClockTenths(ts)}`);
  }

  /** Knytter et startnummer til en tid som allerede er fanget. */
  async function assignBib(reg: Registration, bib: string) {
    const b = bib.trim();
    if (!b) return;
    if (!bekreftDublett(b)) return;
    await db.registrations.update(reg.id, { bib: b, updatedAt: Date.now() });
    setAssignInputs((m) => ({ ...m, [reg.id]: "" }));
    const p = pMap.get(b);
    toast(`${formatClockTenths(reg.timestamp)} → ${p ? p.name : `#${b}`}`);
  }

  async function recordFinish(bib: string) {
    if (!selectedTP || finished) return;
    if (!bekreftDublett(bib)) return;

    const wall = Date.now();
    const ts = wall + clockOffset;
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
    // Tombstone alle køoppføringer for denne bib-en ved dette tidspunktet –
    // også de som ble lagt inn av en annen (forvarsel-)stasjon.
    const pending = (queue ?? []).filter((q) => !q.deleted && q.bib === bib);
    for (const q of pending) {
      await db.queueEntries.update(q.id, { deleted: true, updatedAt: wall });
    }
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
    await db.queueEntries.update(id, { deleted: true, updatedAt: Date.now() });
  }

  async function undo(reg: Registration) {
    await db.registrations.update(reg.id, {
      deleted: true,
      updatedAt: Date.now(),
    });
    toast(`Angret #${reg.bib}`);
  }

  // Rett et feiltastet startnummer UTEN å miste passeringstiden – vanligste
  // korreksjon på løpsdag. Angre + ny registrering ville gitt nytt tidsstempel.
  async function editBib(reg: Registration) {
    const input = prompt(
      `Rett startnummer (tiden ${formatClockTenths(reg.timestamp)} beholdes):`,
      reg.bib,
    );
    const newBib = input?.trim();
    if (!newBib || newBib === reg.bib) return;
    await db.registrations.update(reg.id, { bib: newBib, updatedAt: Date.now() });
    toast(`#${reg.bib} rettet til #${newBib}`);
  }

  async function startMass(d: Distance) {
    if (!confirm(`Starte «${d.name}» NÅ?`)) return;
    await db.distances.update(d.id, {
      massStartTime: Date.now() + clockOffset,
      updatedAt: Date.now(),
    });
    toast(`${d.name} startet!`);
  }

  // Kø: skjul tombstones og bib-er som allerede er registrert ved punktet
  // (registreringen kan ha skjedd på en annen enhet før tombstonen når frem).
  const sortedQueue = (queue ?? [])
    .filter((q) => !q.deleted && !registeredBibs.has(q.bib))
    .sort((a, b) => a.addedAt - b.addedAt);
  const recentVisible = (recent ?? [])
    .filter((r) => !r.deleted && r.bib)
    .slice(0, 10);
  const registerLabel = tp?.kind === "split" ? "Registrer" : "MÅL";
  // Avsluttet løp: ingen nye passeringer. Arrangøren kan gjenåpne.
  const finished = race?.status === "finished";
  const unstartedMass = finished
    ? []
    : (distances ?? []).filter(
        (d) => d.startType === "mass" && d.massStartTime == null,
      );

  // Forventede løpere er bare nyttig når distansen har mellomtider.
  // Uten mellomtider finnes ingen tidligere passeringer å beregne ETA fra.
  const EXPECTED_LIMIT = 15;
  const distanceHasSplits = (timingPoints ?? []).some(
    (t) => t.distanceId === tp?.distanceId && t.kind === "split",
  );
  const expectedWithEta = distanceHasSplits
    ? expectedRunners.filter((r) => r.eta != null)
    : [];
  const visibleExpected = showAllExpected
    ? expectedWithEta
    : expectedWithEta.slice(0, EXPECTED_LIMIT);
  const hiddenExpected = expectedWithEta.length - visibleExpected.length;

  return (
    <Screen
      title="Tidtaking"
      back={auth.kind === "admin" ? `/race/${raceId}` : undefined}
      home={auth.kind === "admin"}
      actions={<SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />}
    >
      <div className="card row spread">
        <div>
          <div className="tiny muted">
            Klokke{clockOffset !== 0 ? " (korrigert)" : ""}
          </div>
          <div className="big mono">{formatClockTenths(now + clockOffset)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="tiny muted">Stasjon</div>
          <div className="tiny">{stationLabel || "…"}</div>
        </div>
      </div>

      {unstartedMass.map((d) => (
        <div className="card row spread" key={d.id}>
          <div>
            <div className="tiny muted">Fellesstart – ikke startet</div>
            <div className="big">{d.name}</div>
          </div>
          <button
            className="success"
            style={{ minHeight: 64, minWidth: 110, fontSize: 20, fontWeight: 700 }}
            onClick={() => startMass(d)}
          >
            START
          </button>
        </div>
      ))}

      {auth.kind === "station" && (
        <div className="row spread" style={{ marginBottom: 8 }}>
          <span className="tiny muted">
            Rolle: {auth.role === "finish" ? "Mål" : auth.role === "split" ? "Rundetid" : "Forvarsel"}
          </span>
          <Link className="ghost small" to={`/race/${raceId}/clock`}>
            🕐 Startklokke
          </Link>
          <button
            className="ghost small"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logg ut
          </button>
        </div>
      )}

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
          {auth.kind === "station" ? (
            <>
              Venter på oppsettet fra arrangøren…
              <div className="tiny muted" style={{ marginTop: 6 }}>
                Distanser og tidspunkter kommer hit automatisk så snart de er
                lagt inn. Enheten kan stå åpen imens.
              </div>
            </>
          ) : (
            "Opprett minst én distanse med et måltidspunkt under Oppsett."
          )}
        </div>
      )}

      {finished && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ fontWeight: 600 }}>🏁 Løpet er avsluttet</div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {auth.kind === "station"
              ? "Registrering er låst. Ta kontakt med arrangøren hvis noen mangler."
              : "Registrering er låst. Gjenåpne løpet fra løpssiden hvis noen mangler."}
          </div>
        </div>
      )}

      {tp && !finished && (
        <>
          {/* Forventede løpere – kun de med beregnet ETA */}
          {expectedWithEta.length > 0 && (
            <>
              <h2>Forventede ({expectedWithEta.length})</h2>
              {visibleExpected.map(({ participant, eta, paceSecPerKm }) => {
                const d = dMap.get(participant.distanceId);
                const etaStr = formatClockTenths(eta!);
                const etaRelMin = Math.round((eta! - (now + clockOffset)) / 60000);
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

          {/* Tett målgang: fang tiden nå, finn nummeret etterpå. */}
          <button className="take-time" onClick={recordTimeOnly}>
            ⏱ TA TID
            <span className="tiny">uten startnummer – knyttes etterpå</span>
          </button>

          {unassigned.length > 0 && (
            <>
              <h2>Tider uten startnummer ({unassigned.length})</h2>
              <div className="tiny muted" style={{ marginBottom: 8 }}>
                Eldste først – samme rekkefølge som løperne passerte.
              </div>
              {unassigned.map((r, i) => {
                const kandidat = pMap.get((assignInputs[r.id] ?? "").trim());
                return (
                  <div className="unassigned-item" key={r.id}>
                    <div className="unassigned-head">
                      <span className="unassigned-index mono">{i + 1}</span>
                      <span className="unassigned-time mono">
                        {startForTP != null
                          ? formatDuration(r.timestamp - startForTP)
                          : formatClockTenths(r.timestamp)}
                      </span>
                      <span className="tiny muted">
                        kl {formatClockTenths(r.timestamp)}
                      </span>
                      <button
                        className="ghost small"
                        onClick={() => undo(r)}
                        aria-label="Forkast tiden"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="unassigned-assign">
                      <input
                        className="assign-bib"
                        inputMode="numeric"
                        placeholder="nr"
                        value={assignInputs[r.id] ?? ""}
                        onChange={(e) =>
                          setAssignInputs((m) => ({ ...m, [r.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            assignBib(r, assignInputs[r.id] ?? "");
                        }}
                      />
                      <span className="grow tiny muted">
                        {(assignInputs[r.id] ?? "").trim()
                          ? (kandidat?.name ?? "Ukjent startnummer")
                          : ""}
                      </span>
                      <button
                        className="finish-btn"
                        onClick={() => assignBib(r, assignInputs[r.id] ?? "")}
                      >
                        Knytt
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

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
                  onClick={() => recordFinish(q.bib)}
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
            const result = p
              ? computeResult(p, d, timingPoints ?? [], allRegistrations ?? [])
              : undefined;
            const passedSplits = result?.splits.filter(
              (s) => s.passedAt != null,
            );
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
                  {passedSplits && passedSplits.length > 0 && (
                    <div className="tiny muted" style={{ marginTop: 2 }}>
                      {passedSplits.map((s) => (
                        <span key={s.timingPoint.id} style={{ marginRight: 8 }}>
                          {s.timingPoint.name}:{" "}
                          <span className="mono">
                            {s.elapsedMs != null
                              ? formatDuration(s.elapsedMs)
                              : "–"}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button className="ghost small" onClick={() => editBib(r)}>
                    Rett nr
                  </button>
                  <button className="ghost small" onClick={() => undo(r)}>
                    Angre
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </Screen>
  );
}
