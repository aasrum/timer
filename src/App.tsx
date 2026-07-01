import type { ReactNode } from "react";
import { Navigate, Routes, Route, useParams } from "react-router-dom";
import { ToastProvider } from "./ui";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
import Home from "./pages/Home";
import RaceDashboard from "./pages/RaceDashboard";
import RaceSetup from "./pages/RaceSetup";
import ImportStartlist from "./pages/ImportStartlist";
import Participants from "./pages/Participants";
import Stations from "./pages/Stations";
import Timing from "./pages/Timing";
import Results from "./pages/Results";
import Settings from "./pages/Settings";

// Rot-siden avhenger av hvem som er logget inn: admin ser løpsoversikten,
// en stasjon sendes rett til sin egen tidtakingsside (de har ingen bruk for
// løpsoversikt, oppsett, deltakere eller resultater).
function Root() {
  const { auth } = useAuth();
  if (auth.kind === "none") return <Navigate to="/login" replace />;
  if (auth.kind === "station")
    return <Navigate to={`/race/${auth.raceId}/timing`} replace />;
  return <Home />;
}

// Admin-only-sider: en stasjon som prøver å navigere hit (f.eks. skriver inn
// URL-en manuelt) sendes tilbake til sin egen tidtakingsside, ikke til login
// – de ER innlogget, bare ikke autorisert for denne siden.
function RequireAdmin({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  if (auth.kind === "admin") return <>{children}</>;
  if (auth.kind === "station")
    return <Navigate to={`/race/${auth.raceId}/timing`} replace />;
  return <Navigate to="/login" replace />;
}

// Tidtakingssiden: admin har tilgang til alle løp, en stasjon kun til sitt eget.
function RequireRaceAccess({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { raceId } = useParams();
  if (auth.kind === "admin") return <>{children}</>;
  if (auth.kind === "station" && auth.raceId === raceId) return <>{children}</>;
  if (auth.kind === "station")
    return <Navigate to={`/race/${auth.raceId}/timing`} replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Root />} />
          <Route
            path="/settings"
            element={
              <RequireAdmin>
                <Settings />
              </RequireAdmin>
            }
          />
          <Route
            path="/race/:raceId"
            element={
              <RequireAdmin>
                <RaceDashboard />
              </RequireAdmin>
            }
          />
          <Route
            path="/race/:raceId/setup"
            element={
              <RequireAdmin>
                <RaceSetup />
              </RequireAdmin>
            }
          />
          <Route
            path="/race/:raceId/import"
            element={
              <RequireAdmin>
                <ImportStartlist />
              </RequireAdmin>
            }
          />
          <Route
            path="/race/:raceId/participants"
            element={
              <RequireAdmin>
                <Participants />
              </RequireAdmin>
            }
          />
          <Route
            path="/race/:raceId/stations"
            element={
              <RequireAdmin>
                <Stations />
              </RequireAdmin>
            }
          />
          <Route
            path="/race/:raceId/timing"
            element={
              <RequireRaceAccess>
                <Timing />
              </RequireRaceAccess>
            }
          />
          <Route
            path="/race/:raceId/results"
            element={
              <RequireAdmin>
                <Results />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
