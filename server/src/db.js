import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, "lopstid.sqlite");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Race-tabellene lagres som opake JSON-blober (samme feltform som klientens
// Dexie-rader). Det holder skjemaet i ett sted (klienten) i stedet for å måtte
// vedlikeholde et parallelt SQL-skjema hver gang en klient-type endres.
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    defaultTimingPointId TEXT,
    pinHash TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    lastSeenAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_stations_raceId ON stations(raceId);

  CREATE TABLE IF NOT EXISTS races (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS distances (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_distances_raceId ON distances(raceId);

  CREATE TABLE IF NOT EXISTS timing_points (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_timing_points_raceId ON timing_points(raceId);

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_participants_raceId ON participants(raceId);

  CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_registrations_raceId ON registrations(raceId);

  CREATE TABLE IF NOT EXISTS queue_entries (
    id TEXT PRIMARY KEY,
    raceId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_queue_entries_raceId ON queue_entries(raceId);
`);

/**
 * Fletter innkommende rader for én tabell inn i SQLite med "siste
 * updatedAt vinner"-regelen (samme regel som klientens mergeRaceSnapshot).
 * Registreringer flettes som union på id – en rad blir aldri overskrevet av
 * en eldre versjon, uansett hvilken enhet som sender den eller når.
 */
function upsertLWW(table, row, raceId) {
  const existing = db.prepare(`SELECT updatedAt FROM ${table} WHERE id = ?`).get(row.id);
  if (existing && row.updatedAt < existing.updatedAt) return false;
  db.prepare(
    `INSERT INTO ${table} (id, raceId, updatedAt, data) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET raceId = excluded.raceId, updatedAt = excluded.updatedAt, data = excluded.data`,
  ).run(row.id, raceId, row.updatedAt, JSON.stringify(row));
  return true;
}

function upsertRegistration(row, raceId) {
  const existing = db.prepare(`SELECT updatedAt FROM registrations WHERE id = ?`).get(row.id);
  if (existing && row.updatedAt <= existing.updatedAt) return false;
  db.prepare(
    `INSERT INTO registrations (id, raceId, updatedAt, data) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET raceId = excluded.raceId, updatedAt = excluded.updatedAt, data = excluded.data`,
  ).run(row.id, raceId, row.updatedAt, JSON.stringify(row));
  return true;
}

/**
 * Slår sammen en hel snapshot fra en klient inn i databasen, og returnerer
 * serverens fullstendige, oppdaterte snapshot for løpet. Hele datasettet
 * sendes og mottas hver gang (ingen "siden sist"-markør) – det gjør
 * flettingen immun mot klokkeskjevhet mellom enheter: en enhet som har vært
 * offline lenge, eller har feil klokke, mister aldri data fordi ingenting
 * filtreres bort på vei inn eller ut.
 */
export function mergeAndReadSnapshot(raceId, incoming) {
  const tx = db.transaction(() => {
    if (incoming.race) upsertLWW("races", incoming.race, raceId);
    for (const d of incoming.distances ?? []) upsertLWW("distances", d, raceId);
    for (const tp of incoming.timingPoints ?? []) upsertLWW("timing_points", tp, raceId);
    for (const p of incoming.participants ?? []) upsertLWW("participants", p, raceId);
    for (const r of incoming.registrations ?? []) upsertRegistration(r, raceId);
    for (const q of incoming.queueEntries ?? []) {
      // Eldre klienter kan sende kørader uten updatedAt; fall tilbake på addedAt.
      upsertLWW("queue_entries", { ...q, updatedAt: q.updatedAt ?? q.addedAt }, raceId);
    }
  });
  tx();
  return readSnapshot(raceId);
}

export function readSnapshot(raceId) {
  const raceRow = db.prepare(`SELECT data FROM races WHERE id = ?`).get(raceId);
  const readAll = (table) =>
    db.prepare(`SELECT data FROM ${table} WHERE raceId = ?`).all(raceId).map((r) => JSON.parse(r.data));
  return {
    race: raceRow ? JSON.parse(raceRow.data) : null,
    distances: readAll("distances"),
    timingPoints: readAll("timing_points"),
    participants: readAll("participants"),
    registrations: readAll("registrations"),
    queueEntries: readAll("queue_entries"),
  };
}
