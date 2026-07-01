import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET må settes i miljøvariabler");
}

const ADMIN_TOKEN_TTL = "90d";
const STATION_TOKEN_TTL = "365d";

export const uid = () => crypto.randomUUID();

/** Genererer en 6-sifret stasjonskode, f.eks. "042817". */
export function generatePin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// ── Admin-bootstrap ────────────────────────────────────────────────────────
// Ett fast adminbrukernavn/passord settes via miljøvariabler ved oppstart.
// Det gjør at admin-innlogging fungerer uten en egen registreringsside, og at
// passordet kan endres ved å oppdatere miljøvariabelen og restarte tjenesten.

export function ensureBootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      "ADMIN_USERNAME/ADMIN_PASSWORD er ikke satt – admin-innlogging vil ikke fungere.",
    );
    return;
  }
  const existing = db.prepare(`SELECT id, passwordHash FROM admins WHERE username = ?`).get(username);
  const matches = existing && bcrypt.compareSync(password, existing.passwordHash);
  if (matches) return;
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  if (existing) {
    db.prepare(`UPDATE admins SET passwordHash = ?, updatedAt = ? WHERE id = ?`).run(
      passwordHash,
      now,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO admins (id, username, passwordHash, updatedAt) VALUES (?, ?, ?, ?)`,
    ).run(uid(), username, passwordHash, now);
  }
}

export function signAdminToken(admin) {
  return jwt.sign({ kind: "admin", sub: admin.id, name: admin.username }, JWT_SECRET, {
    expiresIn: ADMIN_TOKEN_TTL,
  });
}

export function signStationToken(station) {
  return jwt.sign(
    {
      kind: "station",
      sub: station.id,
      raceId: station.raceId,
      name: station.name,
      role: station.role,
      defaultTimingPointId: station.defaultTimingPointId ?? null,
    },
    JWT_SECRET,
    { expiresIn: STATION_TOKEN_TTL },
  );
}

function verifyToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function requireAdmin(req, res, next) {
  const claims = verifyToken(req);
  if (!claims || claims.kind !== "admin") {
    return res.status(401).json({ error: "Krever admin-innlogging" });
  }
  req.auth = claims;
  next();
}

/** Tillater admin, eller en stasjon som tilhører :raceId i URL-en. */
export function requireRaceAccess(req, res, next) {
  const claims = verifyToken(req);
  if (!claims) return res.status(401).json({ error: "Ikke innlogget" });
  if (claims.kind === "admin") {
    req.auth = claims;
    return next();
  }
  if (claims.kind === "station" && claims.raceId === req.params.raceId) {
    req.auth = claims;
    return next();
  }
  return res.status(403).json({ error: "Ingen tilgang til dette løpet" });
}

// ── Enkel rate-limiting for innloggingsforsøk ──────────────────────────────
// Nok til å hindre grov gjetting av 6-sifrede koder fra samme IP; ikke ment
// som forsvar mot en distribuert angriper. Trusselbildet er et lokalt løp,
// ikke en bank.

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

export function rateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.since > WINDOW_MS) {
    attempts.set(key, { count: 1, since: now });
    return next();
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: "For mange forsøk, prøv igjen senere" });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.since > WINDOW_MS) attempts.delete(key);
  }
}, WINDOW_MS).unref();
