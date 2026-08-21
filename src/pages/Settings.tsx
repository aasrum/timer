import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { db } from "../db";
import { syncOnce } from "../liveSync";
import { Screen, useOnline } from "../ui";

export default function Settings() {
  const online = useOnline();
  const { auth, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <Screen title="Innstillinger" back="/">
      <div className="card">
        <div className="row spread">
          <span>Nettverk</span>
          <span className={online ? "offline-badge" : "muted"}>
            {online ? "● Online" : "● Offline"}
          </span>
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          Appen fungerer fullt offline. Data ligger lokalt på denne enheten og
          synkes automatisk med serveren når det er nett.
        </div>
      </div>

      <h2>Bruksanvisning</h2>
      <div className="card">
        {/* Vanlige lenker, ikke ruter: sidene ligger som statiske filer i
            public/hjelp og serveres ved siden av appen. */}
        <a
          className="list-item"
          href="/hjelp/malestasjon.html"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="grow">
            <div>📋 For målestasjoner</div>
            <div className="tiny muted">
              Registrering, tett målgang, rette feil
            </div>
          </div>
          <span aria-hidden>›</span>
        </a>
        <a
          className="list-item"
          href="/hjelp/arrangor.html"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="grow">
            <div>⚙ For arrangør</div>
            <div className="tiny muted">
              Oppsett, startliste, stasjoner, resultater
            </div>
          </div>
          <span aria-hidden>›</span>
        </a>
      </div>

      <h2>Innlogging</h2>
      <div className="card">
        <div className="row spread">
          <span>Innlogget som</span>
          <span className="mono">{auth.kind === "admin" ? auth.name : "–"}</span>
        </div>
        <button
          className="danger"
          style={{ width: "100%", marginTop: 12 }}
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          Logg ut
        </button>
      </div>

      <h2>Om</h2>
      <div className="card tiny muted">
        Løpstid · offline-først tidtaking. Stasjoner logger inn med en egen
        kode og registrerer uavhengig av nett; alt synkes automatisk til
        serveren og videre til alle andre enheter når de er tilkoblet.
      </div>

      <button
        className="danger"
        style={{ width: "100%", marginTop: 12 }}
        onClick={async () => {
          if (!confirm("Slette ALLE løp og data på denne enheten?")) return;
          // Forsøk å synke alt til serveren først, så usynkede
          // registreringer ikke går tapt med den lokale databasen.
          if (auth.kind !== "none") {
            try {
              const races = await db.races.toArray();
              for (const r of races) await syncOnce(r.id);
            } catch {
              if (
                !confirm(
                  "Fikk ikke synket alt til serveren. Usynkede registreringer går tapt. Slette likevel?",
                )
              )
                return;
            }
          }
          await db.delete();
          location.reload();
        }}
      >
        Slett alle data på enheten
      </button>
    </Screen>
  );
}
