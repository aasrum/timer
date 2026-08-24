import { Router } from "express";
import { db, mergeAndReadSnapshot } from "../db.js";
import { requireRaceAccess } from "../auth.js";

export const syncRouter = Router();

syncRouter.post("/races/:raceId/sync", requireRaceAccess, (req, res) => {
  const { raceId } = req.params;
  const incoming = req.body || {};

  if (req.auth.kind === "station") {
    db.prepare(`UPDATE stations SET lastSeenAt = ? WHERE id = ?`).run(Date.now(), req.auth.sub);
  }

  const snapshot = mergeAndReadSnapshot(raceId, incoming);
  res.json({ serverTime: Date.now(), ...snapshot });
});
