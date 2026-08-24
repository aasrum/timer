import { Router } from "express";
import { readSnapshot } from "../db.js";

export const publicRouter = Router();

// Åpen, lesbar resultatvisning: ingen innlogging, men løps-IDen er en UUID
// som bare arrangøren kan dele. Forvarsel-køen holdes utenfor – den er
// operativ intern-tilstand, ikke noe publikum skal se.
publicRouter.get("/public/:raceId", (req, res) => {
  const snapshot = readSnapshot(req.params.raceId);
  if (!snapshot.race || snapshot.race.deleted) {
    return res.status(404).json({ error: "Ukjent løp" });
  }
  const { queueEntries: _queue, ...visible } = snapshot;
  res.json({ serverTime: Date.now(), ...visible });
});
