import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import { db } from "../db";
import {
  createStation,
  deleteStation,
  listStations,
  regeneratePin,
  type StationInfo,
} from "../api";
import { Screen, useToast } from "../ui";

const ROLES: { value: string; label: string }[] = [
  { value: "finish", label: "Mål" },
  { value: "split", label: "Rundetid / mellomtid" },
  { value: "queue", label: "Forvarsel" },
];

export default function Stations() {
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
  const dMap = useMemo(
    () => new Map((distances ?? []).map((d) => [d.id, d])),
    [distances],
  );

  const [stations, setStations] = useState<StationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [role, setRole] = useState("finish");
  const [defaultTp, setDefaultTp] = useState("");
  const [newPin, setNewPin] = useState<{ name: string; pin: string } | null>(null);
  const toast = useToast();

  async function reload() {
    setLoading(true);
    try {
      setStations(await listStations(raceId));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Kunne ikke laste stasjoner");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  async function add() {
    if (!name.trim()) return;
    try {
      const st = await createStation(raceId, name.trim(), role, defaultTp || null);
      setNewPin({ name: st.name, pin: st.pin });
      setName("");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Kunne ikke opprette stasjon");
    }
  }

  async function regen(id: string, stName: string) {
    if (!confirm(`Lag ny kode for «${stName}»? Den gamle koden slutter å virke.`))
      return;
    try {
      const res = await regeneratePin(raceId, id);
      setNewPin({ name: stName, pin: res.pin });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Kunne ikke lage ny kode");
    }
  }

  async function remove(id: string, stName: string) {
    if (!confirm(`Slette stasjonen «${stName}»?`)) return;
    try {
      await deleteStation(raceId, id);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Kunne ikke slette");
    }
  }

  return (
    <Screen title="Stasjoner" back={`/race/${raceId}`}>
      <div className="tiny muted" style={{ marginBottom: 12 }}>
        {race?.name}: opprett en innlogging per enhet som skal stå ute og
        registrere (mål, mellomtid eller forvarsel-kø). Hver stasjon logger inn
        med en 6-sifret kode og fortsetter å virke offline etterpå.
      </div>

      {newPin && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          <div className="tiny muted">Kode for «{newPin.name}» (vises kun nå)</div>
          <div className="big mono" style={{ letterSpacing: "0.15em" }}>
            {newPin.pin}
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Skriv den ned eller vis den til enheten før du lukker dette.
          </div>
          <button
            className="ghost small"
            style={{ marginTop: 8 }}
            onClick={() => setNewPin(null)}
          >
            Lukk
          </button>
        </div>
      )}

      <div className="card">
        <label>Ny stasjon</label>
        <div className="field">
          <input
            placeholder="Navn, f.eks. «Mål»"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow">
            <label>Rolle</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field grow">
            <label>Standard tidspunkt</label>
            <select value={defaultTp} onChange={(e) => setDefaultTp(e.target.value)}>
              <option value="">— ingen, velg selv —</option>
              {(timingPoints ?? []).map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {dMap.get(tp.distanceId)?.name}: {tp.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="primary"
          style={{ width: "100%", marginTop: 8 }}
          onClick={add}
        >
          + Opprett stasjon
        </button>
      </div>

      <h2>Stasjoner ({stations.length})</h2>
      {loading && <div className="tiny muted">Laster…</div>}
      {!loading && stations.length === 0 && (
        <div className="empty">Ingen stasjoner ennå.</div>
      )}
      {stations.map((s) => {
        const tp = (timingPoints ?? []).find((t) => t.id === s.defaultTimingPointId);
        return (
          <div className="list-item" key={s.id}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div className="tiny muted">
                {ROLES.find((r) => r.value === s.role)?.label ?? s.role}
                {tp && ` · ${dMap.get(tp.distanceId)?.name}: ${tp.name}`}
                <br />
                {s.lastSeenAt
                  ? `Sist synket ${new Date(s.lastSeenAt).toLocaleString("no-NO")}`
                  : "Aldri synket"}
              </div>
            </div>
            <button className="ghost small" onClick={() => regen(s.id, s.name)}>
              Ny kode
            </button>
            <button className="ghost small" onClick={() => remove(s.id, s.name)}>
              Slett
            </button>
          </div>
        );
      })}
    </Screen>
  );
}
