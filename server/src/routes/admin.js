import bcrypt from "bcryptjs";
import { Router } from "express";
import { db } from "../db.js";
import { generatePin, rateLimit, requireAdmin, signAdminToken, uid } from "../auth.js";

export const adminRouter = Router();

adminRouter.post("/admin/login", rateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Mangler brukernavn eller passord" });
  }
  const admin = db.prepare(`SELECT * FROM admins WHERE username = ?`).get(username);
  if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({ error: "Feil brukernavn eller passord" });
  }
  const token = signAdminToken(admin);
  res.json({ token, name: admin.username });
});

adminRouter.post("/admin/races/:raceId/stations", requireAdmin, (req, res) => {
  const { raceId } = req.params;
  const { name, role, defaultTimingPointId } = req.body || {};
  if (!name || !role) {
    return res.status(400).json({ error: "Mangler navn eller rolle" });
  }
  const pin = generatePin();
  const pinHash = bcrypt.hashSync(pin, 10);
  const station = {
    id: uid(),
    raceId,
    name,
    role,
    defaultTimingPointId: defaultTimingPointId || null,
    pinHash,
    pin,
    createdAt: Date.now(),
    lastSeenAt: null,
  };
  db.prepare(
    `INSERT INTO stations (id, raceId, name, role, defaultTimingPointId, pinHash, pin, createdAt, lastSeenAt)
     VALUES (@id, @raceId, @name, @role, @defaultTimingPointId, @pinHash, @pin, @createdAt, @lastSeenAt)`,
  ).run(station);
  res.json({
    id: station.id,
    name: station.name,
    role: station.role,
    defaultTimingPointId: station.defaultTimingPointId,
    createdAt: station.createdAt,
    lastSeenAt: station.lastSeenAt,
    pin,
  });
});

// Koden sendes med i listen (aldri hashen) slik at arrangøren kan lese den om
// igjen under løpet. Krever admin-token, som allerede kan lage ny kode uansett.
adminRouter.get("/admin/races/:raceId/stations", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, role, defaultTimingPointId, pin, createdAt, lastSeenAt FROM stations WHERE raceId = ? ORDER BY createdAt`,
    )
    .all(req.params.raceId);
  res.json(rows);
});

adminRouter.post("/admin/races/:raceId/stations/:stationId/regenerate-pin", requireAdmin, (req, res) => {
  const { raceId, stationId } = req.params;
  const station = db.prepare(`SELECT id FROM stations WHERE id = ? AND raceId = ?`).get(stationId, raceId);
  if (!station) return res.status(404).json({ error: "Fant ikke stasjonen" });
  const pin = generatePin();
  const pinHash = bcrypt.hashSync(pin, 10);
  db.prepare(`UPDATE stations SET pinHash = ?, pin = ? WHERE id = ?`).run(
    pinHash,
    pin,
    stationId,
  );
  res.json({ pin });
});

adminRouter.delete("/admin/races/:raceId/stations/:stationId", requireAdmin, (req, res) => {
  const { raceId, stationId } = req.params;
  db.prepare(`DELETE FROM stations WHERE id = ? AND raceId = ?`).run(stationId, raceId);
  res.status(204).end();
});
