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
import { useLiveSync } from "../liveSync";
import { Screen, SyncBadge, useToast } from "../ui";

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
  // Synk her også: dette er siden man står på mens enhetene logges inn, så
  // oppsettet må ha nådd serveren før kodene tas i bruk.
  const sync = useLiveSync(raceId);

  const [stations, setStations] = useState<StationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [role, setRole] = useState("finish");
  const [defaultTp, setDefaultTp] = useState("");
  const [newPin, setNewPin] = useState<{ name: string; pin: string } | null>(null);
  const [codesHidden, setCodesHidden] = useState(false);
  const toast = useToast();

  // Foreslå navn ut fra rolle og valgt tidspunkt: «Mål», «Mellomtid 1»,
  // «Forvarsel». Med flere distanser tas distansenavnet med, siden «Mål»
  // alene da ikke sier hvilken løype stasjonen står i.
  const suggestedName = useMemo(() => {
    const tp = (timingPoints ?? []).find((t) => t.id === defaultTp);
    let base: string;
    if (role === "queue") base = tp ? `Forvarsel ${tp.name}` : "Forvarsel";
    else if (tp) base = tp.name;
    else base = role === "split" ? "Mellomtid" : "Mål";
    // Med flere distanser sier «Mål» alene ikke hvilken løype stasjonen står
    // i, så distansen tas med i parentes.
    const distance =
      tp && (distances ?? []).length > 1 ? dMap.get(tp.distanceId)?.name : undefined;
    const candidate = distance ? `${base} (${distance})` : base;
    // Unngå to stasjoner med samme navn – to enheter kan stå på samme punkt.
    const taken = new Set(stations.map((s) => s.name));
    if (!taken.has(candidate)) return candidate;
    for (let i = 2; i < 50; i++) {
      if (!taken.has(`${candidate} #${i}`)) return `${candidate} #${i}`;
    }
    return candidate;
  }, [role, defaultTp, timingPoints, distances, dMap, stations]);

  // Så lenge feltet ikke er redigert manuelt, følger det forslaget.
  const effectiveName = nameTouched ? name : suggestedName;

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
    const finalName = effectiveName.trim();
    if (!finalName) return;
    try {
      const st = await createStation(raceId, finalName, role, defaultTp || null);
      setNewPin({ name: st.name, pin: st.pin });
      setName("");
      setNameTouched(false);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Kunne ikke opprette stasjon");
    }
  }

  async function copyPin(pin: string) {
    try {
      await navigator.clipboard.writeText(pin);
      toast("Kode kopiert");
    } catch {
      toast(`Kode: ${pin}`);
    }
  }

  async function regen(id: string, stName: string) {
    if (!confirm(`Lag ny kode for «${stName}»? Den gamle koden slutter å virke.`))
      return;
    try {
      const res = await regeneratePin(raceId, id);
      setNewPin({ name: stName, pin: res.pin });
      await reload();
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
    <Screen
      title="Stasjoner"
      back={`/race/${raceId}`}
      home
      actions={<SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />}
    >
      <div className="tiny muted" style={{ marginBottom: 12 }}>
        {race?.name}: opprett en innlogging per enhet som skal stå ute og
        registrere (mål, mellomtid eller forvarsel-kø). Hver stasjon logger inn
        med en 6-sifret kode og fortsetter å virke offline etterpå.
      </div>

      {newPin && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          <div className="tiny muted">Kode for «{newPin.name}»</div>
          <div className="big mono" style={{ letterSpacing: "0.15em" }}>
            {newPin.pin}
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Koden står også i listen nedenfor så lenge løpet varer.
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
            value={effectiveName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
          />
          <div className="tiny muted" style={{ marginTop: 2 }}>
            {nameTouched
              ? "Egendefinert navn."
              : "Foreslått ut fra rolle og tidspunkt – skriv over hvis du vil."}
          </div>
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

      <div className="row spread" style={{ alignItems: "center", marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>Stasjoner ({stations.length})</h2>
        {stations.some((s) => s.pin) && (
          <button
            className="ghost small"
            onClick={() => setCodesHidden((v) => !v)}
          >
            {codesHidden ? "Vis koder" : "Skjul koder"}
          </button>
        )}
      </div>
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
              {s.pin ? (
                <button
                  className="pin-chip"
                  onClick={() => copyPin(s.pin!)}
                  title="Trykk for å kopiere"
                >
                  {codesHidden ? "••••••" : s.pin}
                </button>
              ) : (
                <div className="tiny muted">
                  Kode ikke lagret – trykk «Ny kode» for å få en du kan se.
                </div>
              )}
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
