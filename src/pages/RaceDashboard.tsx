import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { db } from "../db";
import { syncOnce, useLiveSync } from "../liveSync";
import { Screen, SyncBadge, useOnline, useToast } from "../ui";

export default function RaceDashboard() {
  const { raceId = "" } = useParams();
  const { auth } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
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

  const finished = race?.status === "finished";

  async function setStatus(status: "active" | "finished") {
    await db.races.update(raceId, { status, updatedAt: Date.now() });
    toast(status === "finished" ? "Løpet er avsluttet" : "Løpet er gjenåpnet");
    // Send tilstanden ut til stasjonene med én gang i stedet for å vente på
    // neste intervall – poenget med å avslutte er at det skjer nå.
    if (navigator.onLine) void syncOnce(raceId).catch(() => {});
  }

  async function deleteRace() {
    const n = counts?.registrations ?? 0;
    const p = counts?.participants ?? 0;
    if (
      !confirm(
        `Slette «${race?.name}» for godt?\n\n${p} deltakere og ${n} passeringer blir borte på alle enheter og på serveren. Dette kan ikke angres.\n\nEksporter resultatene først hvis du vil beholde dem.`,
      )
    )
      return;
    if (!online) {
      toast("Du må være på nett for å slette et løp");
      return;
    }
    // Tombstone: slettingen må sendes som data for å nå de andre enhetene.
    await db.races.update(raceId, { deleted: true, updatedAt: Date.now() });
    try {
      await syncOnce(raceId);
      toast("Løpet er slettet");
    } catch {
      toast("Slettet lokalt – synkes til de andre enhetene når du er på nett");
    }
    navigate("/");
  }

  if (race === undefined) return <Screen title="Laster…" back="/">{null}</Screen>;
  if (race === null || race.deleted)
    return (
      <Screen title={race?.deleted ? "Løpet er slettet" : "Ukjent løp"} back="/">
        <div className="empty">
          {race?.deleted
            ? "Dette løpet er slettet."
            : "Dette løpet finnes ikke."}
        </div>
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

      {finished && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <div style={{ fontWeight: 600 }}>🏁 Løpet er avsluttet</div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Stasjonene kan ikke registrere flere passeringer. Resultatene er
            fortsatt tilgjengelige, og du kan gjenåpne hvis en etternøler
            mangler.
          </div>
        </div>
      )}

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

      {/* Avslutting og sletting er arrangørens ansvar, ikke stasjonenes. */}
      {auth.kind === "admin" && (
        <>
          <h2>Løpet</h2>
          <button
            className={finished ? "ghost" : "primary"}
            style={{ width: "100%" }}
            onClick={() => setStatus(finished ? "active" : "finished")}
          >
            {finished ? "Gjenåpne løpet" : "🏁 Avslutt løpet"}
          </button>
          <div className="tiny muted" style={{ margin: "6px 0 14px" }}>
            {finished
              ? "Gjenåpner registrering på alle stasjoner."
              : "Låser registrering på alle stasjoner, så ingen passeringer kan komme til ved et uhell etterpå."}
          </div>
          <button className="danger" style={{ width: "100%" }} onClick={deleteRace}>
            Slett løpet
          </button>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Sletter løpet på serveren og på alle enheter. Eksporter
            resultatene først.
          </div>
        </>
      )}
    </Screen>
  );
}

const link = { textDecoration: "none", color: "inherit" } as const;
