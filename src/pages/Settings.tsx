import { useEffect, useState } from "react";
import { db, getSetting, getStationId, setSetting, uid } from "../db";
import { Screen, useOnline, useToast } from "../ui";

export default function Settings() {
  const [stationId, setStationId] = useState("");
  const [stationName, setStationName] = useState("");
  const toast = useToast();
  const online = useOnline();

  useEffect(() => {
    getStationId().then(setStationId);
    getSetting<string>("stationName", "").then(setStationName);
  }, []);

  async function saveName(name: string) {
    setStationName(name);
    await setSetting("stationName", name);
  }

  async function regenerate() {
    if (!confirm("Lag ny stasjons-ID? Brukes for å skille enheter ved fletting."))
      return;
    const id = uid();
    await setSetting("stationId", id);
    setStationId(id);
    toast("Ny stasjons-ID");
  }

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
          Appen fungerer fullt offline. Data ligger lokalt i nettleseren på denne
          enheten til du eksporterer/fletter.
        </div>
      </div>

      <h2>Denne stasjonen</h2>
      <div className="card">
        <div className="field">
          <label>Navn på stasjon (f.eks. «Mål» eller «5 km»)</label>
          <input
            value={stationName}
            onChange={(e) => saveName(e.target.value)}
            placeholder="Mål"
          />
        </div>
        <div className="field">
          <label>Stasjons-ID</label>
          <input className="mono" value={stationId} readOnly />
        </div>
        <button className="ghost small" onClick={regenerate}>
          Lag ny stasjons-ID
        </button>
      </div>

      <h2>Om</h2>
      <div className="card tiny muted">
        Løpstid · offline-først tidtaking. Hver enhet registrerer uavhengig;
        eksporter «.lopstid.json» og flett sammen på resultatsiden for å samle
        passeringer fra flere stasjoner.
      </div>

      <button
        className="danger"
        style={{ width: "100%", marginTop: 12 }}
        onClick={async () => {
          if (!confirm("Slette ALLE løp og data på denne enheten?")) return;
          await db.delete();
          location.reload();
        }}
      >
        Slett alle data på enheten
      </button>
    </Screen>
  );
}
