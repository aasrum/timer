import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchPublicSnapshot } from "../api";
import type {
  Distance,
  Participant,
  Race,
  Registration,
  TimingPoint,
} from "../db";
import {
  computeResult,
  sortResults,
  type ParticipantResult,
} from "../results";
import { formatClock, formatDuration } from "../time";

interface PublicData {
  race: Race;
  distances: Distance[];
  timingPoints: TimingPoint[];
  participants: Participant[];
  registrations: Registration[];
}

const REFRESH_MS = 15000;

/**
 * Offentlig, lesbar resultatside – ingen innlogging, ingen lokal lagring.
 * Henter snapshot rett fra serveren og oppdaterer seg selv hvert 15. sekund.
 */
export default function PublicResults() {
  const { raceId = "" } = useParams();
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const snap = await fetchPublicSnapshot(raceId);
        if (stopped) return;
        setData(snap as unknown as PublicData);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err.message : "Kunne ikke hente resultater");
        }
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [raceId]);

  const dMap = useMemo(
    () => new Map((data?.distances ?? []).map((d) => [d.id, d])),
    [data],
  );

  const sorted = useMemo<ParticipantResult[]>(() => {
    if (!data) return [];
    const results = data.participants
      .filter((p) => filter === "all" || p.distanceId === filter)
      .map((p) =>
        computeResult(p, dMap.get(p.distanceId), data.timingPoints, data.registrations),
      );
    return sortResults(results);
  }, [data, dMap, filter]);

  const splitPoints = useMemo(() => {
    if (!data || filter === "all") return [];
    return data.timingPoints
      .filter((tp) => tp.distanceId === filter && tp.kind === "split")
      .sort((a, b) => a.order - b.order);
  }, [data, filter]);

  let rank = 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{data?.race.name ?? "Resultater"}</h1>
        {updatedAt && (
          <span className="tiny muted mono">{formatClock(updatedAt)}</span>
        )}
      </header>

      {error && !data && <div className="empty">{error}</div>}
      {!error && !data && <div className="empty">Laster…</div>}

      {data && (
        <>
          <div className="row spread" style={{ margin: "8px 0" }}>
            <span className="muted tiny">{data.race.date}</span>
            <span className="tiny muted">Oppdateres automatisk</span>
          </div>

          <div className="tabs">
            <button
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              Alle
            </button>
            {data.distances
              .sort((a, b) => a.order - b.order)
              .map((d) => (
                <button
                  key={d.id}
                  className={filter === d.id ? "active" : ""}
                  onClick={() => setFilter(d.id)}
                >
                  {d.name}
                </button>
              ))}
          </div>

          {sorted.length === 0 && (
            <div className="empty">Ingen resultater ennå.</div>
          )}

          {sorted.length > 0 && (
            <div className="card" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nr</th>
                    <th>Navn</th>
                    <th>Klasse</th>
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
                            <div className="tiny muted">
                              {r.participant.club}
                            </div>
                          )}
                        </td>
                        <td>{r.participant.category ?? ""}</td>
                        {splitPoints.map((sp) => {
                          const s = r.splits.find(
                            (x) => x.timingPoint.id === sp.id,
                          );
                          return (
                            <td key={sp.id} className="num mono">
                              {s?.elapsedMs != null
                                ? formatDuration(s.elapsedMs)
                                : "–"}
                            </td>
                          );
                        })}
                        <td className="num mono">
                          {r.status === "dns" || r.status === "dnf" ? (
                            <span className="utfall">
                              {r.status.toUpperCase()}
                            </span>
                          ) : r.finishElapsedMs != null ? (
                            formatDuration(r.finishElapsedMs)
                          ) : r.status === "started" ? (
                            <span className="muted">underveis</span>
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
        </>
      )}
    </div>
  );
}
