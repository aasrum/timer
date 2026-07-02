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
import { useLiveSync } from "../liveSync";
import { Screen, SyncBadge, useToast } from "../ui";

export default function Results() {
  const { raceId = "" } = useParams();
  const sync = useLiveSync(raceId);
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

  const [distanceFilter, setDistanceFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState<"" | "M" | "K">("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const dMap = useMemo(
    () => new Map((distances ?? []).map((d) => [d.id, d])),
    [distances],
  );

  // Alle resultater for valgt distanse.
  const allResults = useMemo<ParticipantResult[]>(() => {
    if (!participants || !timingPoints || !registrations) return [];
    return participants
      .filter((p) => distanceFilter === "all" || p.distanceId === distanceFilter)
      .map((p) =>
        computeResult(p, dMap.get(p.distanceId), timingPoints, registrations),
      );
  }, [participants, timingPoints, registrations, dMap, distanceFilter]);

  // Unike kategorier på tvers av filtrerte resultater.
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const r of allResults) {
      if (r.participant.category) cats.add(r.participant.category);
    }
    return [...cats].sort();
  }, [allResults]);

  // Filtrer på kjønn og kategori.
  const filtered = useMemo(() => {
    return allResults.filter((r) => {
      if (genderFilter && r.participant.gender !== genderFilter) return false;
      if (categoryFilter && r.participant.category !== categoryFilter) return false;
      return true;
    });
  }, [allResults, genderFilter, categoryFilter]);

  const sorted = sortResults(filtered);

  const splitPoints = useMemo(() => {
    if (distanceFilter === "all") return [];
    return (timingPoints ?? [])
      .filter((tp) => tp.distanceId === distanceFilter && tp.kind === "split")
      .sort((a, b) => a.order - b.order);
  }, [timingPoints, distanceFilter]);

  if (!race)
    return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  function exportCsv() {
    const showGender = allResults.some((r) => r.participant.gender);
    const showCategory = allResults.some((r) => r.participant.category);
    const header = [
      "Plass",
      "Startnr",
      "Navn",
      ...(showGender ? ["Kjønn"] : []),
      ...(showCategory ? ["Aldersklasse"] : []),
      "Klubb",
      "Distanse",
      ...splitPoints.map((s) => s.name),
      ...splitPoints.map((s) => `${s.name} pace`),
      "Tid",
      "Pace",
    ];
    const lines = [header.join(";")];
    let rank = 0;
    for (const r of sorted) {
      if (r.status === "finished") rank++;
      const cells = [
        r.status === "finished" ? String(rank) : "",
        r.participant.bib,
        r.participant.name,
        ...(showGender ? [r.participant.gender ?? ""] : []),
        ...(showCategory ? [r.participant.category ?? ""] : []),
        r.participant.club ?? "",
        dMap.get(r.participant.distanceId)?.name ?? "",
        ...splitPoints.map((sp) => {
          const s = r.splits.find((x) => x.timingPoint.id === sp.id);
          return s?.elapsedMs != null ? formatDuration(s.elapsedMs) : "";
        }),
        ...splitPoints.map((sp) => {
          const s = r.splits.find((x) => x.timingPoint.id === sp.id);
          return s?.paceSecPerKm != null
            ? formatPace(s.paceSecPerKm * 1000, 1000)
            : "";
        }),
        r.finishElapsedMs != null ? formatDuration(r.finishElapsedMs) : "",
        r.finishPaceSecPerKm != null
          ? formatPace(r.finishPaceSecPerKm * 1000, 1000)
          : "",
      ];
      lines.push(cells.map(csvCell).join(";"));
    }
    const tag = distanceFilter === "all" ? "alle" : dMap.get(distanceFilter)?.name ?? "";
    downloadText(
      `resultater-${slug(race!.name)}-${slug(tag)}.csv`,
      lines.join("\n"),
    );
  }

  function exportEQTiming() {
    // UTF-8 BOM så Excel/EQTiming leser norske tegn riktig.
    const bom = "﻿";
    const header = [
      "Startnummer", "Fornavn", "Etternavn", "Fødselsdato", "Kjønn",
      "Klubb", "Nasjonalitet", "Øvelse", "Klasse", "Starttid",
      "Punkt", "Slutttid", "ExitStatus", "Plassering",
    ];
    const lines = [bom + header.join(";")];

    let rank = 0;
    for (const r of sorted) {
      if (r.status === "finished") rank++;
      const [fornavn, etternavn] = splitName(r.participant.name);
      const dist = dMap.get(r.participant.distanceId);
      const startClock = r.startTime != null ? formatClock(r.startTime) : "";
      const baseRow = [
        r.participant.bib,
        fornavn,
        etternavn,
        "",
        r.participant.gender ?? "",
        r.participant.club ?? "",
        r.participant.nationality ?? "",
        dist?.name ?? "",
        r.participant.category ?? "",
        startClock,
      ];

      // Én rad per mellomtid
      for (const s of r.splits) {
        if (s.passedAt == null) continue;
        lines.push(
          [...baseRow, s.timingPoint.name, formatClock(s.passedAt), "OK", ""]
            .map(csvCell).join(";"),
        );
      }

      // Én rad for mål
      if (r.finishAt != null) {
        lines.push(
          [...baseRow, "Mål", formatClock(r.finishAt), "OK",
            r.status === "finished" ? String(rank) : ""]
            .map(csvCell).join(";"),
        );
      }
    }

    downloadText(
      `eqtiming-${slug(race!.name)}.csv`,
      lines.join("\r\n"),
    );
  }

  async function exportBundle() {
    const bundle = await exportRace(raceId);
    downloadJson(`${slug(race!.name)}.lopstid.json`, bundle);
  }

  async function copyPublicLink() {
    const url = `${location.origin}${location.pathname}#/public/${raceId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Offentlig resultatlenke kopiert");
    } catch {
      prompt("Kopier lenken manuelt:", url);
    }
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

  const showGenderCol = sorted.some((r) => r.participant.gender);
  const showCategoryCol = sorted.some((r) => r.participant.category);

  let rank = 0;

  return (
    <Screen
      title="Resultater"
      back={`/race/${raceId}`}
      actions={<SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />}
    >
      {/* Distansefilter */}
      <div className="tabs">
        <button
          className={distanceFilter === "all" ? "active" : ""}
          onClick={() => { setDistanceFilter("all"); setCategoryFilter(""); }}
        >
          Alle
        </button>
        {distances?.map((d) => (
          <button
            key={d.id}
            className={distanceFilter === d.id ? "active" : ""}
            onClick={() => { setDistanceFilter(d.id); setCategoryFilter(""); }}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Kjønns- og kategorifiltere */}
      <div className="row wrap" style={{ gap: 6, margin: "8px 0" }}>
        {(["", "M", "K"] as const).map((g) => (
          <button
            key={g}
            className={`ghost small${genderFilter === g ? " active" : ""}`}
            onClick={() => setGenderFilter(g)}
          >
            {g === "" ? "Alle kjønn" : g === "M" ? "Menn" : "Kvinner"}
          </button>
        ))}
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ fontSize: 14, padding: "6px 10px", height: 36, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            <option value="">Alle klasser</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      <div className="fab-row">
        <button className="ghost" onClick={exportCsv}>
          Eksporter CSV
        </button>
        <button className="ghost" onClick={exportEQTiming}>
          EQTiming CSV
        </button>
        <button className="ghost" onClick={copyPublicLink}>
          Del resultatlenke
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
                {showGenderCol && <th>Kjønn</th>}
                {showCategoryCol && <th>Klasse</th>}
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
                    {showGenderCol && (
                      <td className="mono">{r.participant.gender ?? "–"}</td>
                    )}
                    {showCategoryCol && (
                      <td>{r.participant.category ?? "–"}</td>
                    )}
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

/** «Ola Nordmann Hansen» → ["Ola Nordmann", "Hansen"]. */
function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return [fullName.trim(), ""];
  const last = parts.pop()!;
  return [parts.join(" "), last];
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
