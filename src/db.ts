import Dexie, { type Table } from "dexie";

// ── Datamodell ───────────────────────────────────────────────────────────────
// Designprinsipp: hver registrering (passering) har egen UUID og en stasjons-ID.
// Det gjør at flere uavhengige stasjoner kan eksportere hver sin fil og flettes
// konfliktfritt (union på id, tombstone vinner). Vi lagrer alltid absolutte
// tidsstempler (epoch ms), aldri ferdig utregnet varighet – da kan starttider og
// korreksjoner endres i ettertid uten å miste data.

export type StartType = "mass" | "interval";

export interface Race {
  id: string;
  name: string;
  /** ISO-dato (yyyy-mm-dd) som brukes som basis for klokkeslett. */
  date: string;
  createdAt: number;
  updatedAt: number;
}

export interface Distance {
  id: string;
  raceId: string;
  name: string;
  lengthMeters?: number;
  startType: StartType;
  /** Fellesstart: starttidspunkt (epoch ms). Ubrukt ved intervallstart. */
  massStartTime?: number;
  order: number;
  updatedAt: number;
}

export type TimingPointKind = "split" | "finish";

export interface TimingPoint {
  id: string;
  raceId: string;
  /** Tidspunkter er per distanse. */
  distanceId: string;
  name: string;
  kind: TimingPointKind;
  /** Distanse fra start i meter. Brukes til pace-utregning og ETA-estimering. */
  distanceMeters?: number;
  order: number;
  updatedAt: number;
}

export interface Participant {
  id: string;
  raceId: string;
  bib: string;
  name: string;
  distanceId: string;
  club?: string;
  /** Kjønn: "M" (menn) | "K" (kvinner) | "" (ikke oppgitt). */
  gender?: string;
  /** Nasjonskode, f.eks. "NOR". Brukes ved EQ Timing-eksport. */
  nationality?: string;
  /** Aldersklasse / kategori, f.eks. "M40", "K20-29". */
  category?: string;
  /** Intervallstart: individuell starttid (epoch ms). */
  startTime?: number;
  updatedAt: number;
}

/** En faktisk passering (mellomtid eller mål). Mergebar enhet. */
export interface Registration {
  id: string;
  raceId: string;
  bib: string;
  timingPointId: string;
  /** Epoch ms da deltakeren passerte. */
  timestamp: number;
  /** Hvilken enhet/stasjon som registrerte – muliggjør fletting og klokkekorreksjon. */
  stationId: string;
  /** Tombstone for angring som overlever fletting. */
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Forvarsel-kø: forventede passeringer. Synkes mellom enheter slik at en
 * forvarsel-stasjon lenger ute i løypa mater køen til målstasjonen.
 * Tombstone (deleted) + updatedAt gjør at også fjerning propagerer.
 * Feltene er valgfrie for bakoverkompatibilitet med rader fra før synk.
 */
export interface QueueEntry {
  id: string;
  raceId: string;
  timingPointId: string;
  bib: string;
  addedAt: number;
  deleted?: boolean;
  updatedAt?: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class LopstidDB extends Dexie {
  races!: Table<Race, string>;
  distances!: Table<Distance, string>;
  timingPoints!: Table<TimingPoint, string>;
  participants!: Table<Participant, string>;
  registrations!: Table<Registration, string>;
  queueEntries!: Table<QueueEntry, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super("lopstid");
    this.version(1).stores({
      races: "id, updatedAt",
      distances: "id, raceId, order",
      timingPoints: "id, raceId, distanceId, order",
      participants: "id, raceId, [raceId+bib], distanceId",
      registrations:
        "id, raceId, [raceId+timingPointId], [raceId+bib], bib, stationId",
      queueEntries: "id, raceId, [raceId+timingPointId]",
      settings: "key",
    });
  }
}

export const db = new LopstidDB();

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── Settings-hjelpere (bl.a. stasjons-identitet på denne enheten) ─────────────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** Stabil stasjons-ID for denne enheten/nettleseren. */
export async function getStationId(): Promise<string> {
  let id = await getSetting<string | null>("stationId", null);
  if (!id) {
    id = uid();
    await setSetting("stationId", id);
  }
  return id;
}
