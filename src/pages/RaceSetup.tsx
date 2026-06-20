import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import {
  db,
  uid,
  type Distance,
  type StartType,
  type TimingPoint,
} from "../db";
import { clockInputValue, parseTimeOfDay } from "../time";
import { Screen, useToast } from "../ui";

export default function RaceSetup() {
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
  const toast = useToast();

  if (!race) return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  async function updateRace(patch: Partial<typeof race>) {
    await db.races.update(raceId, { ...patch, updatedAt: Date.now() });
  }

  async function addDistance() {
    const now = Date.now();
    const order = (distances?.length ?? 0) + 1;
    const d: Distance = {
      id: uid(),
      raceId,
      name: `Distanse ${order}`,
      startType: "mass",
      order,
      updatedAt: now,
    };
    await db.distances.add(d);
    // Hver distanse får automatisk et mål-tidspunkt.
    const finish: TimingPoint = {
      id: uid(),
      raceId,
      distanceId: d.id,
      name: "Mål",
      kind: "finish",
      order: 1000,
      updatedAt: now,
    };
    await db.timingPoints.add(finish);
    toast("Distanse lagt til");
  }

  async function updateDistance(id: string, patch: Partial<Distance>) {
    await db.distances.update(id, { ...patch, updatedAt: Date.now() });
  }

  async function deleteDistance(id: string) {
    if (!confirm("Slette distansen og dens deltakere/tidspunkter?")) return;
    await db.transaction(
      "rw",
      db.distances,
      db.timingPoints,
      db.participants,
      async () => {
        await db.distances.delete(id);
        await db.timingPoints.where({ distanceId: id }).delete();
        await db.participants.where({ distanceId: id }).delete();
      },
    );
    toast("Distanse slettet");
  }

  async function addSplit(distanceId: string) {
    const existing = (timingPoints ?? []).filter(
      (tp) => tp.distanceId === distanceId && tp.kind === "split",
    );
    const tp: TimingPoint = {
      id: uid(),
      raceId,
      distanceId,
      name: `Mellomtid ${existing.length + 1}`,
      kind: "split",
      order: existing.length + 1,
      updatedAt: Date.now(),
    };
    await db.timingPoints.add(tp);
  }

  async function updateTP(id: string, patch: Partial<TimingPoint>) {
    await db.timingPoints.update(id, { ...patch, updatedAt: Date.now() });
  }

  async function deleteTP(id: string) {
    await db.timingPoints.delete(id);
  }

  return (
    <Screen title="Oppsett" back={`/race/${raceId}`}>
      <div className="card">
        <div className="field">
          <label>Navn på løp</label>
          <input
            value={race.name}
            onChange={(e) => updateRace({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Dato</label>
          <input
            type="date"
            value={race.date}
            onChange={(e) => updateRace({ date: e.target.value })}
          />
        </div>
        <div className="muted tiny">Alt lagres automatisk.</div>
      </div>

      <h2>Distanser</h2>
      {distances?.map((d) => {
        const points = (timingPoints ?? [])
          .filter((tp) => tp.distanceId === d.id)
          .sort((a, b) => a.order - b.order);
        const splits = points.filter((tp) => tp.kind === "split");
        return (
          <div key={d.id} className="card">
            <div className="field">
              <label>Distansenavn</label>
              <input
                value={d.name}
                onChange={(e) => updateDistance(d.id, { name: e.target.value })}
              />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow">
                <label>Lengde (m)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.lengthMeters ?? ""}
                  onChange={(e) =>
                    updateDistance(d.id, {
                      lengthMeters: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </div>
              <div className="field grow">
                <label>Starttype</label>
                <select
                  value={d.startType}
                  onChange={(e) =>
                    updateDistance(d.id, {
                      startType: e.target.value as StartType,
                    })
                  }
                >
                  <option value="mass">Fellesstart</option>
                  <option value="interval">Intervallstart</option>
                </select>
              </div>
            </div>

            {d.startType === "mass" ? (
              <div className="field">
                <label>Felles starttid (klokkeslett)</label>
                <input
                  placeholder="hh:mm:ss"
                  defaultValue={clockInputValue(d.massStartTime)}
                  onBlur={(e) => {
                    const ms = parseTimeOfDay(e.target.value, race.date);
                    updateDistance(d.id, { massStartTime: ms ?? undefined });
                  }}
                />
                <div className="tiny muted">
                  La stå tom og sett den når startskuddet går.
                </div>
              </div>
            ) : (
              <div className="tiny muted" style={{ marginBottom: 12 }}>
                Intervallstart: starttid per deltaker (settes ved import eller
                under Deltakere).
              </div>
            )}

            <label>Mellomtider</label>
            {splits.length === 0 && (
              <div className="tiny muted">Ingen mellomtider.</div>
            )}
            {splits.map((tp) => (
              <div key={tp.id} style={{ marginBottom: 8 }}>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="grow"
                    value={tp.name}
                    onChange={(e) => updateTP(tp.id, { name: e.target.value })}
                    placeholder="Navn"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    style={{ width: 100 }}
                    value={tp.distanceMeters ?? ""}
                    placeholder="m fra start"
                    onChange={(e) =>
                      updateTP(tp.id, {
                        distanceMeters: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                  <button
                    className="ghost small"
                    onClick={() => deleteTP(tp.id)}
                    aria-label="Slett mellomtid"
                  >
                    ✕
                  </button>
                </div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  Meter fra start brukes til pace og ETA-estimering.
                </div>
              </div>
            ))}
            <div className="row spread" style={{ marginTop: 10 }}>
              <button className="ghost small" onClick={() => addSplit(d.id)}>
                + Mellomtid
              </button>
              <button
                className="ghost small"
                onClick={() => deleteDistance(d.id)}
              >
                Slett distanse
              </button>
            </div>
          </div>
        );
      })}

      <button className="primary" style={{ width: "100%" }} onClick={addDistance}>
        + Legg til distanse
      </button>
    </Screen>
  );
}
