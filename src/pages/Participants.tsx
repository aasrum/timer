import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db, uid, type Participant } from "../db";
import { useLiveSync } from "../liveSync";
import { clockInputValue, parseTimeOfDay } from "../time";
import { Screen, SyncBadge, useToast } from "../ui";

export default function Participants() {
  const { raceId = "" } = useParams();
  const navigate = useNavigate();
  const sync = useLiveSync(raceId);
  const race = useLiveQuery(() => db.races.get(raceId), [raceId]);
  const distances = useLiveQuery(
    () => db.distances.where({ raceId }).sortBy("order"),
    [raceId],
  );
  const participants = useLiveQuery(
    () => db.participants.where({ raceId }).toArray(),
    [raceId],
  );
  const toast = useToast();
  const [filter, setFilter] = useState<string>("all");

  if (!race) return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  const distMap = new Map((distances ?? []).map((d) => [d.id, d]));
  const shown = (participants ?? [])
    .filter((p) => filter === "all" || p.distanceId === filter)
    .sort((a, b) => Number(a.bib) - Number(b.bib) || a.bib.localeCompare(b.bib));

  async function update(id: string, patch: Partial<Participant>) {
    await db.participants.update(id, { ...patch, updatedAt: Date.now() });
  }

  async function addParticipant() {
    const distanceId = filter !== "all" ? filter : distances?.[0]?.id;
    if (!distanceId) {
      toast("Opprett en distanse først");
      return;
    }
    const p: Participant = {
      id: uid(),
      raceId,
      bib: "",
      name: "",
      distanceId,
      updatedAt: Date.now(),
    };
    await db.participants.add(p);
  }

  async function remove(id: string) {
    await db.participants.delete(id);
    toast("Deltaker slettet");
  }

  return (
    <Screen
      title="Deltakere"
      back={`/race/${raceId}`}
      home
      actions={<SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />}
    >
      <div className="tabs">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Alle ({participants?.length ?? 0})
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

      {shown.length === 0 && (
        <div className="empty">
          Ingen deltakere. Importer en startliste eller legg til manuelt.
        </div>
      )}

      {shown.map((p) => {
        const d = distMap.get(p.distanceId);
        const interval = d?.startType === "interval";
        return (
          <div className="card" key={p.id}>
            <div className="row" style={{ gap: 8 }}>
              <div className="field" style={{ width: 90 }}>
                <label>Nr</label>
                <input
                  className="mono"
                  inputMode="numeric"
                  value={p.bib}
                  onChange={(e) => update(p.id, { bib: e.target.value })}
                />
              </div>
              <div className="field grow">
                <label>Navn</label>
                <input
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                />
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <div className="field grow">
                <label>Distanse</label>
                <select
                  value={p.distanceId}
                  onChange={(e) => update(p.id, { distanceId: e.target.value })}
                >
                  {distances?.map((dd) => (
                    <option key={dd.id} value={dd.id}>
                      {dd.name}
                    </option>
                  ))}
                </select>
              </div>
              {interval && (
                <div className="field grow">
                  <label>Starttid</label>
                  <input
                    className="mono"
                    placeholder="hh:mm:ss"
                    defaultValue={clockInputValue(p.startTime)}
                    onBlur={(e) =>
                      update(p.id, {
                        startTime:
                          parseTimeOfDay(e.target.value, race.date) ?? undefined,
                      })
                    }
                  />
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <div className="field" style={{ width: 90 }}>
                <label>Kjønn</label>
                <select
                  value={p.gender ?? ""}
                  onChange={(e) =>
                    update(p.id, { gender: e.target.value || undefined })
                  }
                >
                  <option value="">–</option>
                  <option value="M">M</option>
                  <option value="K">K</option>
                </select>
              </div>
              <div className="field grow">
                <label>Aldersklasse</label>
                <input
                  value={p.category ?? ""}
                  placeholder="f.eks. M40"
                  onChange={(e) =>
                    update(p.id, { category: e.target.value || undefined })
                  }
                />
              </div>
              <div className="field grow">
                <label>Klubb</label>
                <input
                  value={p.club ?? ""}
                  onChange={(e) =>
                    update(p.id, { club: e.target.value || undefined })
                  }
                />
              </div>
            </div>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="ghost small" onClick={() => remove(p.id)}>
                Slett
              </button>
            </div>
          </div>
        );
      })}

      <button
        className="primary"
        style={{ width: "100%" }}
        onClick={addParticipant}
      >
        + Legg til deltaker
      </button>

      <button
        className="ghost"
        style={{ width: "100%", marginTop: 12 }}
        onClick={() => navigate(`/race/${raceId}`)}
      >
        ← Tilbake til løpet
      </button>
    </Screen>
  );
}
