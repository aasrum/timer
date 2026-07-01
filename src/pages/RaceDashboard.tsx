import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { db } from "../db";
import { useLiveSync } from "../liveSync";
import { Screen, SyncBadge, useOnline } from "../ui";

export default function RaceDashboard() {
  const { raceId = "" } = useParams();
  const race = useLiveQuery(() => db.races.get(raceId), [raceId]);
  const sync = useLiveSync(raceId);
  const counts = useLiveQuery(async () => {
    const [participants, distances, registrations] = await Promise.all([
      db.participants.where({ raceId }).count(),
      db.distances.where({ raceId }).count(),
      db.registrations.where({ raceId }).count(),
    ]);
    return { participants, distances, registrations };
  }, [raceId]);
  const online = useOnline();

  if (race === undefined) return <Screen title="Laster…" back="/">{null}</Screen>;
  if (race === null)
    return (
      <Screen title="Ukjent løp" back="/">
        <div className="empty">Dette løpet finnes ikke.</div>
      </Screen>
    );

  return (
    <Screen title={race.name} back="/">
      <div className="row spread" style={{ margin: "8px 0" }}>
        <span className="muted tiny">{race.date}</span>
        <div className="row" style={{ gap: 8 }}>
          <SyncBadge status={sync.status} lastSyncedAt={sync.lastSyncedAt} />
          <span className={online ? "offline-badge" : "muted tiny"}>
            {online ? "● Online" : "● Offline"}
          </span>
        </div>
      </div>

      <div className="card row spread">
        <div>
          <div className="big mono">{counts?.participants ?? "–"}</div>
          <div className="muted tiny">deltakere</div>
        </div>
        <div>
          <div className="big mono">{counts?.distances ?? "–"}</div>
          <div className="muted tiny">distanser</div>
        </div>
        <div>
          <div className="big mono">{counts?.registrations ?? "–"}</div>
          <div className="muted tiny">passeringer</div>
        </div>
      </div>

      <Link className="list-item" to={`/race/${raceId}/timing`} style={link}>
        <div className="grow">
          <div className="big">⏱ Tidtaking</div>
          <div className="muted tiny">Forvarsel-kø og målregistrering</div>
        </div>
        <span aria-hidden>›</span>
      </Link>

      <Link className="list-item" to={`/race/${raceId}/results`} style={link}>
        <div className="grow">
          <div className="big">🏁 Resultater</div>
          <div className="muted tiny">Tider, sortering og eksport</div>
        </div>
        <span aria-hidden>›</span>
      </Link>

      <h2>Oppsett</h2>
      <Link className="list-item" to={`/race/${raceId}/participants`} style={link}>
        <div className="grow">Deltakere</div>
        <span aria-hidden>›</span>
      </Link>
      <Link className="list-item" to={`/race/${raceId}/import`} style={link}>
        <div className="grow">Importer startliste (CSV)</div>
        <span aria-hidden>›</span>
      </Link>
      <Link className="list-item" to={`/race/${raceId}/setup`} style={link}>
        <div className="grow">Distanser og mellomtider</div>
        <span aria-hidden>›</span>
      </Link>
      <Link className="list-item" to={`/race/${raceId}/stations`} style={link}>
        <div className="grow">Stasjoner (innlogging for enheter)</div>
        <span aria-hidden>›</span>
      </Link>
    </Screen>
  );
}

const link = { textDecoration: "none", color: "inherit" } as const;
