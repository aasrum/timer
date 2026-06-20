import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams, useNavigate } from "react-router-dom";
import { db, uid, type Distance, type Participant } from "../db";
import { parseTimeOfDay } from "../time";
import {
  guessMapping,
  parseCsv,
  type ColumnMapping,
  type CsvRow,
} from "../csv";
import { Screen, useToast } from "../ui";

export default function ImportStartlist() {
  const { raceId = "" } = useParams();
  const race = useLiveQuery(() => db.races.get(raceId), [raceId]);
  const navigate = useNavigate();
  const toast = useToast();

  const [text, setText] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultStart, setDefaultStart] = useState<"mass" | "interval">("mass");

  const rows = useMemo<CsvRow[]>(() => {
    try {
      return text.trim() ? parseCsv(text) : [];
    } catch {
      return [];
    }
  }, [text]);

  const headers = useMemo(
    () => (rows[0] ? Object.keys(rows[0]) : []),
    [rows],
  );

  function loadText(value: string) {
    setText(value);
    const parsed = value.trim() ? parseCsv(value) : [];
    const hs = parsed[0] ? Object.keys(parsed[0]) : [];
    setMapping(guessMapping(hs));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    loadText(await file.text());
  }

  async function runImport() {
    if (!race) return;
    if (!mapping.bib) {
      toast("Velg kolonne for startnummer");
      return;
    }
    const existingDistances = await db.distances.where({ raceId }).toArray();
    const byName = new Map(
      existingDistances.map((d) => [d.name.toLowerCase(), d]),
    );
    let order = existingDistances.length;
    const newDistances: Distance[] = [];

    function resolveDistance(name: string | undefined): string {
      const key = (name || "Distanse").trim();
      const found = byName.get(key.toLowerCase());
      if (found) return found.id;
      const d: Distance = {
        id: uid(),
        raceId,
        name: key,
        startType: defaultStart,
        order: ++order,
        updatedAt: Date.now(),
      };
      byName.set(key.toLowerCase(), d);
      newDistances.push(d);
      return d.id;
    }

    const existingParticipants = await db.participants
      .where({ raceId })
      .toArray();
    const pByBib = new Map(existingParticipants.map((p) => [p.bib, p]));

    const toPut: Participant[] = [];
    let count = 0;
    for (const row of rows) {
      const bib = (mapping.bib ? row[mapping.bib] : "").trim();
      if (!bib) continue;
      const distanceId = resolveDistance(
        mapping.distance ? row[mapping.distance] : undefined,
      );
      const startRaw = mapping.startTime ? row[mapping.startTime] : "";
      const startTime =
        startRaw && race ? parseTimeOfDay(startRaw, race.date) ?? undefined : undefined;
      const existing = pByBib.get(bib);
      toPut.push({
        id: existing?.id ?? uid(),
        raceId,
        bib,
        name: (mapping.name ? row[mapping.name] : "").trim() || `#${bib}`,
        distanceId,
        club: mapping.club ? row[mapping.club]?.trim() || undefined : undefined,
        category: mapping.category
          ? row[mapping.category]?.trim() || undefined
          : undefined,
        startTime: startTime ?? existing?.startTime,
        updatedAt: Date.now(),
      });
      count++;
    }

    await db.transaction("rw", db.distances, db.participants, async () => {
      if (newDistances.length) await db.distances.bulkPut(newDistances);
      await db.participants.bulkPut(toPut);
    });
    toast(`Importerte ${count} deltakere`);
    navigate(`/race/${raceId}/participants`);
  }

  const fields: { key: keyof ColumnMapping; label: string }[] = [
    { key: "bib", label: "Startnummer *" },
    { key: "name", label: "Navn" },
    { key: "distance", label: "Distanse/klasse" },
    { key: "startTime", label: "Starttid (intervall)" },
    { key: "club", label: "Klubb" },
    { key: "category", label: "Kategori" },
  ];

  return (
    <Screen title="Importer startliste" back={`/race/${raceId}`}>
      <div className="card">
        <div className="field">
          <label>Last opp CSV-fil</label>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
        </div>
        <div className="field">
          <label>…eller lim inn CSV her</label>
          <textarea
            rows={5}
            placeholder="startnummer;navn;distanse;starttid"
            value={text}
            onChange={(e) => loadText(e.target.value)}
          />
        </div>
        <div className="tiny muted">
          Komma, semikolon eller tab støttes. Første rad må være kolonneoverskrifter.
        </div>
      </div>

      {headers.length > 0 && (
        <>
          <h2>Koble kolonner</h2>
          <div className="card">
            {fields.map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label}</label>
                <select
                  value={(mapping[f.key] as string) ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [f.key]: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">— ikke i bruk —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field">
              <label>Standard starttype for nye distanser</label>
              <select
                value={defaultStart}
                onChange={(e) =>
                  setDefaultStart(e.target.value as "mass" | "interval")
                }
              >
                <option value="mass">Fellesstart</option>
                <option value="interval">Intervallstart</option>
              </select>
            </div>
          </div>

          <h2>Forhåndsvisning ({rows.length} rader)</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Nr</th>
                  <th>Navn</th>
                  <th>Distanse</th>
                  <th>Start</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    <td>{mapping.bib ? r[mapping.bib] : ""}</td>
                    <td>{mapping.name ? r[mapping.name] : ""}</td>
                    <td>{mapping.distance ? r[mapping.distance] : ""}</td>
                    <td>{mapping.startTime ? r[mapping.startTime] : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="primary"
            style={{ width: "100%" }}
            onClick={runImport}
          >
            Importer {rows.length} deltakere
          </button>
        </>
      )}
    </Screen>
  );
}
