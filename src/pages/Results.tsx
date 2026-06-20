import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import { db } from "../db";
import {
  computeResult,
  sortResults,
  type ParticipantResult,
} from "../results";
import { formatClock, formatDuration, formatPace } from "../time";
import {
  downloadJson,
  downloadText,
  exportRace,
  importBundle,
  type RaceBundle,
} from "../sync";
import { Screen, useToast } from "../ui";

export default function Results() {
  const { raceId = "" } = useParams();
  const race = useLiveQuery(() => db.races.get(raceId), [raceId]);
  const distances = useLiveQuery(
    () => db.distances.where({ raceId }).sortBy("order"),
    [raceId],
  );
  const timingPoints = useLiveQuery(
    () => db.timingPoints.where({ raceId }).toArray(),
    [raceId],
  );
  const participants = useLiveQuery(
    () => db.participants.where({ raceId }).toArray(),
    [raceId],
  );
  const registrations = useLiveQuery(
    () => db.registrations.where({ raceId }).toArray(),
    [raceId],
  );
  const toast = useToast();
  const [filter, setFilter] = useState("all");

  const dMap = useMemo(
    () => new Map((distances ?? []).map((d) => [d.id, d])),
    [distances],
  );

  const results = useMemo<ParticipantResult[]>(() => {
    if (!participants || !timingPoints || !registrations) return [];
    return participants
      .filter((p) => filter === "all" || p.distanceId === filter)
      .map((p) =>
        computeResult(p, dMap.get(p.distanceId), timingPoints, registrations),
      );
  }, [participants, timingPoints, registrations, dMap, filter]);

  const sorted = sortResults(results);

  const splitPoints = useMemo(() => {
    if (filter === "all") return [];
    return (timingPoints ?? [])
      .filter((tp) => tp.distanceId === filter && tp.kind === "split")
      .sort((a, b) => a.order - b.order);
  }, [timingPoints, filter]);

  if (!race)
    return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  function exportCsv() {
    const header = [
      "Plass",
      "Startnr",
      "Navn",
      "Klubb",
      "Distanse",
      ...splitPoints.map((s) => s.name),
      "Tid",
    ];
    const lines = [header.join(";")];
    let rank = 0;
    for (const r of sorted) {
      if (r.status === "finished") rank++;
      const cells = [
        r.status === "finished" ? String(rank) : "",
        r.participant.bib,
        r.participant.name,
        r.participant.club ?? "",
        dMap.get(r.participant.distanceId)?.name ?? "",
        ...splitPoints.map((sp) => {
          const s = r.splits.find((x) => x.timingPoint.id === sp.id);
          return s?.elapsedMs != null ? formatDuration(s.elapsedMs) : "";
        }),
        r.finishElapsedMs != null ? formatDuration(r.finishElapsedMs) : "",
      ];
      lines.push(cells.map(csvCell).join(";"));
    }
    const tag = filter === "all" ? "alle" : dMap.get(filter)?.name ?? "";
    downloadText(`resultater-${slug(race!.name)}-${slug(tag)}.csv`, lines.join("\n"));
  }

  async function exportBundle() {
    const bundle = await exportRace(raceId);
    downloadJson(`${slug(race!.name)}.lopstid.json`, bundle);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text()) as RaceBundle;
      const stats = await importBundle(bundle);
      toast(
        `Flettet: +${stats.registrationsAdded} passeringer, ${stats.registrationsUpdated} oppdatert`,
      );
    } catch (err) {
      toast("Kunne ikke lese filen");
      console.error(err);
    } finally {
      e.target.value = "";
    }
  }

  let rank = 0;

  return (
    <Screen title="Resultater" back={`/race/${raceId}`}>
      <div className="tabs">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Alle
        </button>
        {distances?.map((d) => (
          <button
            key={d.id}
            className={filter === d.id ? "active" : ""}
            onClick={() => setFilter(d.id)}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div className="fab-row">
        <button className="ghost" onClick={exportCsv}>
          Eksporter CSV
        </button>
        <button className="ghost" onClick={exportBundle}>
          Eksporter (flett)
        </button>
      </div>
      <div className="card">
        <label>Flett inn fra annen stasjon (.lopstid.json)</label>
        <input type="file" accept=".json,application/json" onChange={onImport} />
        <div className="tiny muted">
          Henter passeringer fra andre enheter inn i dette løpet.
        </div>
      </div>

      {sorted.length === 0 && <div className="empty">Ingen resultater ennå.</div>}

      {sorted.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Nr</th>
                <th>Navn</th>
                {splitPoints.map((s) => (
                  <th key={s.id} className="num">
                    {s.name}
                  </th>
                ))}
                <th className="num">Tid</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                if (r.status === "finished") rank++;
                return (
                  <tr key={r.participant.id}>
                    <td className="mono">
                      {r.status === "finished" ? rank : ""}
                    </td>
                    <td className="mono">{r.participant.bib}</td>
                    <td>
                      {r.participant.name}
                      {r.participant.club && (
                        <div className="tiny muted">{r.participant.club}</div>
                      )}
                    </td>
                    {splitPoints.map((sp) => {
                      const s = r.splits.find(
                        (x) => x.timingPoint.id === sp.id,
                      );
                      return (
                        <td key={sp.id} className="num mono">
                          {s?.elapsedMs != null ? (
                            <>
                              {formatDuration(s.elapsedMs)}
                              {s.paceSecPerKm != null && (
                                <div className="tiny muted">
                                  {formatPace(s.paceSecPerKm * 1000, 1000)}
                                </div>
                              )}
                            </>
                          ) : "–"}
                        </td>
                      );
                    })}
                    <td className="num mono">
                      {r.finishElapsedMs != null ? (
                        <>
                          {formatDuration(r.finishElapsedMs)}
                          {r.finishPaceSecPerKm != null && (
                            <div className="tiny muted">
                              {formatPace(r.finishPaceSecPerKm * 1000, 1000)}
                            </div>
                          )}
                        </>
                      ) : r.status === "started" ? (
                        <span className="muted">startet</span>
                      ) : r.finishAt != null ? (
                        <span className="muted">
                          {formatClock(r.finishAt)} (ingen start)
                        </span>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}

function csvCell(v: string): string {
  if (/[;"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
