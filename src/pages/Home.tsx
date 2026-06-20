import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { db, uid, type Race } from "../db";
import { todayISO } from "../time";
import { Screen, useOnline } from "../ui";

export default function Home() {
  const races = useLiveQuery(
    () => db.races.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const navigate = useNavigate();
  const online = useOnline();

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

      <h2>Løp</h2>
      {races && races.length === 0 && (
        <div className="empty">
          Ingen løp ennå. Opprett ditt første løp for å komme i gang.
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
            <div className="big">{r.name}</div>
            <div className="muted tiny">{r.date}</div>
          </div>
          <span aria-hidden>›</span>
        </Link>
      ))}
    </Screen>
  );
}
