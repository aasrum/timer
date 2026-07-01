import bcrypt from "bcryptjs";
import { Router } from "express";
import { db } from "../db.js";
import { rateLimit, signStationToken } from "../auth.js";

export const stationRouter = Router();

stationRouter.post("/station/login", rateLimit, (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: "Mangler kode" });

  // pinHash er ikke indeksert på klartekst-pin (den lagres aldri i klartekst),
  // så vi må sjekke bcrypt mot hver stasjon. Antall stasjoner per løp er lite
  // (titalls, ikke tusenvis), så dette er billig nok i praksis.
  const stations = db.prepare(`SELECT * FROM stations`).all();
  const station = stations.find((s) => bcrypt.compareSync(String(pin).trim(), s.pinHash));
  if (!station) return res.status(401).json({ error: "Feil kode" });

  db.prepare(`UPDATE stations SET lastSeenAt = ? WHERE id = ?`).run(Date.now(), station.id);

  const token = signStationToken(station);
  res.json({
    token,
    stationId: station.id,
    raceId: station.raceId,
    name: station.name,
    role: station.role,
    defaultTimingPointId: station.defaultTimingPointId,
  });
});
