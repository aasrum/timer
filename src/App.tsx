import { Routes, Route } from "react-router-dom";
import { ToastProvider } from "./ui";
import Home from "./pages/Home";
import RaceDashboard from "./pages/RaceDashboard";
import RaceSetup from "./pages/RaceSetup";
import ImportStartlist from "./pages/ImportStartlist";
import Participants from "./pages/Participants";
import Timing from "./pages/Timing";
import Results from "./pages/Results";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/race/:raceId" element={<RaceDashboard />} />
        <Route path="/race/:raceId/setup" element={<RaceSetup />} />
        <Route path="/race/:raceId/import" element={<ImportStartlist />} />
        <Route path="/race/:raceId/participants" element={<Participants />} />
        <Route path="/race/:raceId/timing" element={<Timing />} />
        <Route path="/race/:raceId/results" element={<Results />} />
      </Routes>
    </ToastProvider>
  );
}
