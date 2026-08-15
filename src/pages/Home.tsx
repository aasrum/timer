import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { listRemoteRaces, type RemoteRaceInfo } from "../api";
import { useAuth } from "../auth";
import { db, uid, type Race } from "../db";
import { syncOnce } from "../liveSync";
import { todayISO } from "../time";
import { Screen, useOnline, useToast } from "../ui";

export default function Home() {
  const races = useLiveQuery(
    () =>
      db.races
        .orderBy("updatedAt")
        .reverse()
        .filter((r) => !r.deleted)
        .toArray(),
    [],
  );
  const navigate = useNavigate();
  const online = useOnline();
  const { auth } = useAuth();
  const toast = useToast();

  const [remote, setRemote] = useState<RemoteRaceInfo[]>([]);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);

  // Hent serverens løpsliste. Løpene selv bor i denne enhetens IndexedDB, så
  // en admin på en ny eller tømt enhet har ingen lokalt – da må de kunne
  // hentes ned igjen herfra.
  const loadRemote = useCallback(async () => {
    if (auth.kind !== "admin" || !online) return;
    setFetching(true);
    try {
      setRemote(await listRemoteRaces());
    } catch {
      // Stille: hjemskjermen skal fungere offline uten feilmeldinger.
    } finally {
      setFetching(false);
    }
  }, [auth.kind, online]);

  useEffect(() => {
    loadRemote();
  }, [loadRemote]);

  async function createRace() {
    const now = Date.now();
    const race: Race = {
      id: uid(),
      name: "Nytt løp",
      date: todayISO(),
      createdAt: now,
      updatedAt: now,
    };
    await db.races.add(race);
    navigate(`/race/${race.id}/setup`);
  }

  // Hent et løp som ligger på serveren, men ikke på denne enheten.
  async function pullRace(r: RemoteRaceInfo) {
    setPulling(r.id);
    try {
      await syncOnce(r.id);
      toast(`«${r.name}» hentet til denne enheten`);
      navigate(`/race/${r.id}`);
    } catch {
      toast("Kunne ikke hente løpet. Er du på nett?");
    } finally {
      setPulling(null);
    }
  }

  const localIds = new Set((races ?? []).map((r) => r.id));
  const missing = remote.filter((r) => !localIds.has(r.id));

  return (
    <Screen
      title="Løpstid"
      actions={
        <Link className="back-link" to="/settings" aria-label="Innstillinger">
          ⚙
        </Link>
      }
    >
      <div className="row spread" style={{ margin: "8px 0" }}>
        <span className={online ? "offline-badge" : "muted tiny"}>
          {online ? "● Online" : "● Offline – alt lagres lokalt"}
        </span>
      </div>

      <button className="primary" style={{ width: "100%" }} onClick={createRace}>
        + Nytt løp
      </button>

      {/* Overskriften droppes når enheten ikke har lokale løp, så en fersk
          enhet ikke viser en tom «Løp»-seksjon over serverlisten. */}
      {(races?.length ?? 0) > 0 && <h2>Løp</h2>}
      {races && races.length === 0 && missing.length === 0 && (
        <div className="empty">
          {fetching
            ? "Ser etter løp…"
            : "Ingen løp ennå. Opprett ditt første løp for å komme i gang."}
        </div>
      )}
      {races?.map((r) => (
        <Link
          key={r.id}
          to={`/race/${r.id}`}
          className="list-item"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="grow">
            <div className="big">
              {r.name}
              {r.status === "finished" && (
                <span className="tiny muted"> · avsluttet</span>
              )}
            </div>
            <div className="muted tiny">{r.date}</div>
          </div>
          <span aria-hidden>›</span>
        </Link>
      ))}

      {missing.length > 0 && (
        <>
          <h2>På serveren</h2>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            Disse løpene ligger på serveren, men ikke på denne enheten.
          </div>
          {missing.map((r) => (
            <div className="list-item" key={r.id}>
              <div className="grow">
                <div className="big">{r.name}</div>
                <div className="muted tiny">
                  {r.date} · {r.participants} deltakere · {r.registrations}{" "}
                  passeringer
                </div>
              </div>
              <button
                className="ghost small"
                disabled={pulling === r.id}
                onClick={() => pullRace(r)}
              >
                {pulling === r.id ? "Henter…" : "Hent hit"}
              </button>
            </div>
          ))}
        </>
      )}
    </Screen>
  );
}
