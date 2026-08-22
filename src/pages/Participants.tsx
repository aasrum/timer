import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db, uid, type Participant } from "../db";
import { useLiveSync } from "../liveSync";
import { clockInputValue, parseTimeOfDay } from "../time";
import { PersistedInput, Screen, SyncBadge, useToast } from "../ui";

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
  const registrations = useLiveQuery(
    () => db.registrations.where({ raceId }).toArray(),
    [raceId],
  );
  const toast = useToast();
  const [filter, setFilter] = useState<string>("all");
  // Deltakere lagt til i denne økten, i den rekkefølgen de ble opprettet.
  const [nyeIder, setNyeIder] = useState<string[]>([]);
  const fokusId = useRef<string | null>(null);

  // Bytter man distansefane er de nye radene ikke lenger nødvendigvis
  // relevante; da sorteres alt normalt igjen.
  useEffect(() => {
    setNyeIder([]);
  }, [filter]);

  // Startnummer som er registrert ute i løypa, men som ikke står i
  // startlisten – f.eks. en etteranmeldt løper. Uten denne listen ville
  // tidene deres blitt liggende usynlige, siden resultatene bygges fra
  // deltakerlisten.
  const ukjenteNumre = (() => {
    const kjente = new Set((participants ?? []).map((p) => p.bib));
    const teller = new Map<string, number>();
    for (const r of registrations ?? []) {
      if (r.deleted || !r.bib || kjente.has(r.bib)) continue;
      teller.set(r.bib, (teller.get(r.bib) ?? 0) + 1);
    }
    return [...teller.entries()]
      .map(([bib, antall]) => ({ bib, antall }))
      .sort((a, b) => Number(a.bib) - Number(b.bib) || a.bib.localeCompare(b.bib));
  })();

  if (!race) return <Screen title="Laster…" back={`/race/${raceId}`}>{null}</Screen>;

  const distMap = new Map((distances ?? []).map((d) => [d.id, d]));
  const synlige = (participants ?? []).filter(
    (p) => filter === "all" || p.distanceId === filter,
  );

  // Rader som er lagt til nå holdes øverst i stedet for å sortere seg inn
  // mens man skriver. Et tomt startnummer teller som 0 og ville ellers ligget
  // nederst i den synkende lista, for så å hoppe opp straks første siffer er
  // tastet. Rekkefølgen de ble lagt til i beholdes, så ingenting flytter seg
  // når man legger til flere.
  const nySet = new Set(nyeIder);
  // Synkende: høyeste startnummer først. Etteranmeldte får som regel de
  // høyeste numrene, og havner dermed øverst der man leter etter dem.
  const sorterte = synlige
    .filter((p) => !nySet.has(p.id))
    .sort((a, b) => Number(b.bib) - Number(a.bib) || b.bib.localeCompare(a.bib));
  const nye = nyeIder
    .map((id) => synlige.find((p) => p.id === id))
    .filter((p): p is Participant => p != null);
  const shown = [...nye, ...sorterte];

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
    setNyeIder((v) => [...v, p.id]);
    // Sett markøren i nummerfeltet, så man kan taste med én gang.
    fokusId.current = p.id;
  }

  async function remove(id: string) {
    await db.participants.delete(id);
    toast("Deltaker slettet");
  }

  /** Gjør et registrert, men ukjent startnummer om til en deltaker. */
  async function leggTilFraNummer(bib: string) {
    const distanceId = filter !== "all" ? filter : distances?.[0]?.id;
    if (!distanceId) {
      toast("Opprett en distanse først");
      return;
    }
    await db.participants.add({
      id: uid(),
      raceId,
      bib,
      // Midlertidig navn, ikke tomt: uten det står raden navnløs i
      // resultatlisten og i eksporten hvis navnet aldri blir fylt inn.
      name: `Ukjent #${bib}`,
      distanceId,
      updatedAt: Date.now(),
    });
    toast(`#${bib} lagt til – skriv inn navnet`);
  }

  return (
    <Screen
      title="Deltakere"
      back={`/race/${raceId}`}
      home
      actions={<SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />}
    >
      {ukjenteNumre.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ fontWeight: 600 }}>
            ⚠ {ukjenteNumre.length} startnummer uten deltaker
          </div>
          <div className="tiny muted" style={{ margin: "4px 0 10px" }}>
            Disse er registrert ute i løypa, men står ikke i startlisten.
            Tidene er lagret – legg dem til her for å få dem med i
            resultatene, og skriv inn navnet etterpå.
          </div>
          {ukjenteNumre.map((u) => (
            <div className="row spread" key={u.bib} style={{ marginBottom: 6 }}>
              <span>
                <span className="mono" style={{ fontWeight: 700 }}>
                  #{u.bib}
                </span>
                <span className="tiny muted">
                  {" "}
                  · {u.antall} {u.antall === 1 ? "passering" : "passeringer"}
                </span>
              </span>
              <button
                className="ghost small"
                onClick={() => leggTilFraNummer(u.bib)}
              >
                Legg til deltaker
              </button>
            </div>
          ))}
        </div>
      )}

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

      {/* Står rett over listen, siden nye rader legger seg øverst. */}
      <button
        className="primary"
        style={{ width: "100%", marginBottom: 12 }}
        onClick={addParticipant}
      >
        + Legg til deltaker
      </button>

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
                <PersistedInput
                  className="mono"
                  inputMode="numeric"
                  value={p.bib}
                  onValueChange={(v) => update(p.id, { bib: v })}
                  inputRef={(el) => {
                    // Nyopprettet rad: hopp hit og gjør feltet klart å taste i.
                    if (el && fokusId.current === p.id) {
                      fokusId.current = null;
                      el.focus();
                      el.scrollIntoView({ block: "center", behavior: "smooth" });
                    }
                  }}
                />
              </div>
              <div className="field grow">
                <label>Navn</label>
                <PersistedInput
                  value={p.name}
                  onValueChange={(v) => update(p.id, { name: v })}
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
                <PersistedInput
                  value={p.category ?? ""}
                  placeholder="f.eks. M40"
                  onValueChange={(v) =>
                    update(p.id, { category: v || undefined })
                  }
                />
              </div>
              <div className="field grow">
                <label>Klubb</label>
                <PersistedInput
                  value={p.club ?? ""}
                  onValueChange={(v) => update(p.id, { club: v || undefined })}
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
        className="ghost"
        style={{ width: "100%", marginTop: 12 }}
        onClick={() => navigate(`/race/${raceId}`)}
      >
        ← Tilbake til løpet
      </button>
    </Screen>
  );
}
