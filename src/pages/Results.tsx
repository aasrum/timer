import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import { db, uid } from "../db";
import {
  computeResult,
  sortResults,
  type ParticipantResult,
} from "../results";
import {
  formatClock,
  formatClockTenths,
  formatDuration,
  formatPace,
  parseTimeOfDay,
} from "../time";
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
  // «deltakerId:tidspunktId» for cellen som redigeres, eller null.
  const [rediger, setRediger] = useState<string | null>(null);
  // Mellomtidskolonner på/av. På, så enkeltdistanse ser ut som før; av gir
  // en ren liste med bare sluttider, som er det man vil ha på papir.
  const [visSplits, setVisSplits] = useState(true);

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
  const conflictCount = sorted.filter((r) => r.conflicts.length > 0).length;

  // Registrerte tider som ikke havner i resultatlisten fordi startnummeret
  // ikke finnes blant deltakerne, eller fordi tiden ennå ikke er knyttet til
  // et nummer. Begge deler er tapte tider hvis de ikke oppdages.
  const løseTider = useMemo(() => {
    const kjente = new Set((participants ?? []).map((p) => p.bib));
    const ukjenteBibs = new Set<string>();
    let utenNummer = 0;
    for (const r of registrations ?? []) {
      if (r.deleted) continue;
      if (!r.bib) utenNummer++;
      else if (!kjente.has(r.bib)) ukjenteBibs.add(r.bib);
    }
    return { ukjente: [...ukjenteBibs].sort(), utenNummer };
  }, [registrations, participants]);

  /**
   * Mellomtidskolonner. På tvers av distanser tas distansenavnet med i
   * overskriften, siden to distanser gjerne har hvert sitt punkt som begge
   * heter «5 km». Celler for løpere på en annen distanse står tomme.
   */
  const splitPoints = useMemo(() => {
    if (!visSplits) return [];
    const aktuelle = (timingPoints ?? []).filter(
      (tp) =>
        tp.kind === "split" &&
        (distanceFilter === "all" || tp.distanceId === distanceFilter),
    );
    const flereDistanser =
      distanceFilter === "all" && new Set(aktuelle.map((t) => t.distanceId)).size > 1;
    return aktuelle
      .sort(
        (a, b) =>
          (dMap.get(a.distanceId)?.order ?? 0) - (dMap.get(b.distanceId)?.order ?? 0) ||
          a.order - b.order,
      )
      .map((tp) => ({
        ...tp,
        label: flereDistanser
          ? `${dMap.get(tp.distanceId)?.name ?? ""} ${tp.name}`.trim()
          : tp.name,
      }));
  }, [timingPoints, distanceFilter, visSplits, dMap]);

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
      ...splitPoints.map((s) => s.label),
      ...splitPoints.map((s) => `${s.label} pace`),
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

  /**
   * Setter passeringstiden for en deltaker ved ett punkt, i etterkant.
   *
   * Under løpet stemples tiden til «nå». Etterpå – når man retter mot video
   * eller legger inn en passering ingen rakk å registrere – må tidspunktet
   * kunne oppgis direkte. Finnes det en registrering fra før, flyttes den;
   * ellers opprettes en ny. Andre registreringer på samme punkt merkes som
   * slettet, slik at rettingen ikke etterlater en konflikt.
   */
  async function setTid(
    bib: string,
    timingPointId: string,
    klokkeslett: string,
  ) {
    const ts = parseTimeOfDay(klokkeslett, race!.date);
    if (ts == null) {
      toast("Ugyldig klokkeslett. Bruk tt:mm:ss");
      return;
    }
    const eksisterende = (registrations ?? []).filter(
      (r) => !r.deleted && r.bib === bib && r.timingPointId === timingPointId,
    );
    const nyeste = eksisterende.sort((a, b) => b.timestamp - a.timestamp)[0];
    const now = Date.now();
    if (nyeste) {
      await db.registrations.update(nyeste.id, { timestamp: ts, updatedAt: now });
      // Rydd bort eventuelle dubletter, så raden ikke blir stående flagget.
      for (const r of eksisterende.filter((x) => x.id !== nyeste.id)) {
        await db.registrations.update(r.id, { deleted: true, updatedAt: now });
      }
    } else {
      await db.registrations.add({
        id: uid(),
        raceId,
        bib,
        timingPointId,
        timestamp: ts,
        stationId: "manuell",
        deleted: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    setRediger(null);
    toast(`#${bib}: tid satt til ${formatClock(ts)}`);
  }

  /** Fjerner passeringen ved punktet helt. */
  async function fjernTid(bib: string, timingPointId: string) {
    const treff = (registrations ?? []).filter(
      (r) => !r.deleted && r.bib === bib && r.timingPointId === timingPointId,
    );
    if (!treff.length) return;
    if (!confirm(`Fjerne passeringen for #${bib}?`)) return;
    for (const r of treff) {
      await db.registrations.update(r.id, { deleted: true, updatedAt: Date.now() });
    }
    setRediger(null);
    toast(`#${bib}: passering fjernet`);
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
      home
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

      {(løseTider.ukjente.length > 0 || løseTider.utenNummer > 0) && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ fontWeight: 600 }}>⚠ Tider som ikke er med i listen</div>
          {løseTider.ukjente.length > 0 && (
            <div className="tiny" style={{ marginTop: 6 }}>
              Startnummer uten deltaker:{" "}
              <span className="mono">
                {løseTider.ukjente.map((b) => `#${b}`).join(", ")}
              </span>
              <div className="muted">
                Legg dem til under Deltakere for å få dem med.
              </div>
            </div>
          )}
          {løseTider.utenNummer > 0 && (
            <div className="tiny" style={{ marginTop: 6 }}>
              {løseTider.utenNummer}{" "}
              {løseTider.utenNummer === 1 ? "tid er" : "tider er"} fanget uten
              startnummer.
              <div className="muted">
                Knytt dem til startnummer på tidtakingsskjermen.
              </div>
            </div>
          )}
        </div>
      )}

      {conflictCount > 0 && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ fontWeight: 600 }}>
            ⚠ {conflictCount} {conflictCount === 1 ? "deltaker" : "deltakere"} har
            flere passeringer på samme punkt
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Som regel et startnummer tastet i stedet for et annet. Den seneste
            passeringen er brukt – kontroller de merkede radene før du
            publiserer resultatene.
          </div>
        </div>
      )}

      <div className="fab-row">
        <button
          className={visSplits ? "" : "ghost"}
          onClick={() => setVisSplits((v) => !v)}
        >
          {visSplits ? "⊟ Skjul mellomtider" : "⊞ Vis mellomtider"}
        </button>
        <button className="ghost" onClick={() => window.print()}>
          🖨 Skriv ut
        </button>
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

      {/* Bare synlig på papir: forteller hvilket utvalg arket viser. */}
      <div className="kun-utskrift utskrift-topp">
        <h1>{race.name}</h1>
        <div className="utskrift-linje">
          {[
            race.date,
            distanceFilter === "all"
              ? "Alle distanser"
              : dMap.get(distanceFilter)?.name,
            genderFilter === "M" ? "Menn" : genderFilter === "K" ? "Kvinner" : null,
            categoryFilter || null,
            `${sorted.filter((r) => r.status === "finished").length} fullførte`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div className="utskrift-linje tiny">
          Skrevet ut {new Date().toLocaleString("no-NO")}
        </div>
      </div>

      {sorted.length === 0 && <div className="empty">Ingen resultater ennå.</div>}

      {sorted.length > 0 && (
        <div className="card resultat-tabell" style={{ overflowX: "auto" }}>
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
                    {s.label}
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
                      {r.conflicts.map((c) => (
                        <div
                          key={c.timingPoint.id}
                          className="tiny"
                          style={{ color: "var(--warning)" }}
                          title={`${c.count} passeringer ved ${c.timingPoint.name}: ${formatClock(
                            c.firstAt,
                          )} og ${formatClock(c.lastAt)}. Seneste er brukt.`}
                        >
                          ⚠ {c.count} passeringer ved {c.timingPoint.name} (
                          {formatDuration(c.spreadMs)} fra hverandre)
                        </div>
                      ))}
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
                      const key = `${r.participant.id}:${sp.id}`;
                      return (
                        <td key={sp.id} className="num mono">
                          {rediger === key ? (
                            <TidRedigering
                              startTime={r.startTime}
                              naavaerende={s?.passedAt}
                              raceDate={race!.date}
                              onLagre={(t) => setTid(r.participant.bib, sp.id, t)}
                              onFjern={() => fjernTid(r.participant.bib, sp.id)}
                              onAvbryt={() => setRediger(null)}
                            />
                          ) : (
                            <button
                              className="tid-knapp"
                              onClick={() => setRediger(key)}
                              title="Trykk for å rette tiden"
                            >
                              {s?.elapsedMs != null ? (
                                <>
                                  {formatDuration(s.elapsedMs)}
                                  {s.paceSecPerKm != null && (
                                    <div className="tiny muted">
                                      {formatPace(s.paceSecPerKm * 1000, 1000)}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <span className="muted">–</span>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="num mono">
                      {(() => {
                        const målTp = (timingPoints ?? []).find(
                          (t) =>
                            t.kind === "finish" &&
                            t.distanceId === r.participant.distanceId,
                        );
                        if (!målTp) return <span className="muted">–</span>;
                        const key = `${r.participant.id}:${målTp.id}`;
                        if (rediger === key) {
                          return (
                            <TidRedigering
                              startTime={r.startTime}
                              naavaerende={r.finishAt}
                              raceDate={race!.date}
                              onLagre={(t) =>
                                setTid(r.participant.bib, målTp.id, t)
                              }
                              onFjern={() =>
                                fjernTid(r.participant.bib, målTp.id)
                              }
                              onAvbryt={() => setRediger(null)}
                            />
                          );
                        }
                        return (
                          <button
                            className="tid-knapp"
                            onClick={() => setRediger(key)}
                            title="Trykk for å rette eller legge inn tiden"
                          >
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
                              <span className="muted">underveis</span>
                            ) : r.finishAt != null ? (
                              <span className="muted">
                                {formatClock(r.finishAt)} (ingen start)
                              </span>
                            ) : (
                              <span className="muted">–</span>
                            )}
                          </button>
                        );
                      })()}
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

/**
 * Redigering av én passeringstid. Man skriver klokkeslettet slik det står på
 * videoen eller stoppeklokka, og ser løpstiden det gir før man lagrer.
 */
function TidRedigering({
  startTime,
  naavaerende,
  raceDate,
  onLagre,
  onFjern,
  onAvbryt,
}: {
  startTime?: number;
  naavaerende?: number;
  raceDate: string;
  onLagre: (klokkeslett: string) => void;
  onFjern: () => void;
  onAvbryt: () => void;
}) {
  const [tekst, setTekst] = useState(
    naavaerende != null ? formatClockTenths(naavaerende) : "",
  );
  const tolket = parseTimeOfDay(tekst, raceDate);
  const medgatt =
    tolket != null && startTime != null ? tolket - startTime : undefined;

  return (
    <div className="tid-rediger">
      <input
        autoFocus
        className="mono"
        value={tekst}
        placeholder="tt:mm:ss"
        onChange={(e) => setTekst(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onLagre(tekst);
          if (e.key === "Escape") onAvbryt();
        }}
      />
      <div className="tiny" style={{ minHeight: "1.4em" }}>
        {tekst.trim() === "" ? (
          <span className="muted">klokkeslett ved passering</span>
        ) : tolket == null ? (
          <span style={{ color: "var(--danger)" }}>ugyldig</span>
        ) : medgatt == null ? (
          <span className="muted">ingen starttid</span>
        ) : medgatt < 0 ? (
          <span style={{ color: "var(--danger)" }}>før start</span>
        ) : (
          <span style={{ color: "var(--success)" }}>
            → {formatDuration(medgatt)}
          </span>
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button
          className="success small"
          onClick={() => onLagre(tekst)}
          disabled={tolket == null}
        >
          Lagre
        </button>
        <button className="ghost small" onClick={onAvbryt}>
          Avbryt
        </button>
        {naavaerende != null && (
          <button className="ghost small" onClick={onFjern}>
            Fjern
          </button>
        )}
      </div>
    </div>
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
