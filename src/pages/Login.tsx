import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminLogin, stationLogin } from "../api";
import { useAuth } from "../auth";
import { Screen, useToast } from "../ui";

export default function Login() {
  const [mode, setMode] = useState<"station" | "admin">("station");
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  async function submitStation(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    setBusy(true);
    try {
      const res = await stationLogin(pin.trim());
      setAuth({
        kind: "station",
        token: res.token,
        stationId: res.stationId,
        raceId: res.raceId,
        name: res.name,
        role: res.role,
        defaultTimingPointId: res.defaultTimingPointId,
      });
      toast(`Logget inn som ${res.name}`);
      navigate(`/race/${res.raceId}/timing`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Feil kode");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdmin(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    try {
      const res = await adminLogin(username.trim(), password);
      setAuth({ kind: "admin", token: res.token, name: res.name });
      toast(`Velkommen, ${res.name}`);
      navigate("/");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Feil brukernavn eller passord");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Løpstid">
      <div className="tabs">
        <button
          className={mode === "station" ? "active" : ""}
          onClick={() => setMode("station")}
        >
          Stasjon
        </button>
        <button
          className={mode === "admin" ? "active" : ""}
          onClick={() => setMode("admin")}
        >
          Admin
        </button>
      </div>

      {mode === "station" && (
        <form className="card" onSubmit={submitStation}>
          <div className="field">
            <label>Stasjonskode</label>
            <input
              className="bib-entry"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="––––––"
            />
          </div>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={busy || !pin.trim()}
          >
            Logg inn
          </button>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            Skriv inn den 6-sifrede koden du har fått fra arrangøren. Denne
            enheten fortsetter å virke offline etter at du har logget inn.
          </div>
        </form>
      )}

      {mode === "admin" && (
        <form className="card" onSubmit={submitAdmin}>
          <div className="field">
            <label>Brukernavn</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label>Passord</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={busy || !username || !password}
          >
            Logg inn
          </button>
        </form>
      )}
    </Screen>
  );
}
