import {
  db,
  type Race,
  type Distance,
  type TimingPoint,
  type Participant,
  type QueueEntry,
  type Registration,
} from "./db";

// Eksport/import/synk for fletting av flere uavhengige stasjoner.
// Konfliktfrie flettingsregler, uansett om snapshot kommer fra en fil eller
// nettverkssynk mot serveren:
//  - race/distances/timingPoints/participants: siste updatedAt vinner
//  - registrations: union på id; tombstone (deleted) og nyeste updatedAt vinner

export interface RaceSnapshot {
  race: Race | null;
  distances: Distance[];
  timingPoints: TimingPoint[];
  participants: Participant[];
  registrations: Registration[];
  /** Valgfri for bakoverkompatibilitet med eldre eksportfiler. */
  queueEntries?: QueueEntry[];
}

export interface RaceBundle extends Omit<RaceSnapshot, "race"> {
  format: "lopstid";
  version: 1;
  exportedAt: number;
  race: Race;
}

export async function readLocalSnapshot(raceId: string): Promise<RaceSnapshot> {
  const [race, distances, timingPoints, participants, registrations, rawQueue] =
    await Promise.all([
      db.races.get(raceId).then((r) => r ?? null),
      db.distances.where({ raceId }).toArray(),
      db.timingPoints.where({ raceId }).toArray(),
      db.participants.where({ raceId }).toArray(),
      db.registrations.where({ raceId }).toArray(),
      db.queueEntries.where({ raceId }).toArray(),
    ]);
  // Normaliser gamle kørader fra før synk-feltene fantes.
  const queueEntries = rawQueue.map((q) => ({
    ...q,
    deleted: q.deleted ?? false,
    updatedAt: q.updatedAt ?? q.addedAt,
  }));
  return { race, distances, timingPoints, participants, registrations, queueEntries };
}

export async function exportRace(raceId: string): Promise<RaceBundle> {
  const snapshot = await readLocalSnapshot(raceId);
  if (!snapshot.race) throw new Error("Fant ikke løpet");
  return {
    format: "lopstid",
    version: 1,
    exportedAt: Date.now(),
    ...snapshot,
    race: snapshot.race,
  };
}

export interface MergeStats {
  registrationsAdded: number;
  registrationsUpdated: number;
  participantsUpserted: number;
}

/**
 * Fletter en snapshot (fra fil-import eller nettverkssynk) inn i lokal DB.
 * Samme konfliktfrie regler uansett kilde.
 */
export async function mergeRaceSnapshot(snapshot: RaceSnapshot): Promise<MergeStats> {
  const stats: MergeStats = {
    registrationsAdded: 0,
    registrationsUpdated: 0,
    participantsUpserted: 0,
  };

  await db.transaction(
    "rw",
    [
      db.races,
      db.distances,
      db.timingPoints,
      db.participants,
      db.registrations,
      db.queueEntries,
    ],
    async () => {
      if (snapshot.race) {
        const existingRace = await db.races.get(snapshot.race.id);
        if (!existingRace || snapshot.race.updatedAt >= existingRace.updatedAt) {
          await db.races.put(snapshot.race);
        }
        // Slettet løp: behold tombstonen (så den fortsetter å propagere), men
        // kast alle underliggende data. Uten dette ville denne enheten sendt
        // deltakere og passeringer tilbake opp og gjenopplivet innholdet.
        const merged = await db.races.get(snapshot.race.id);
        if (merged?.deleted) {
          const rid = merged.id;
          await Promise.all([
            db.distances.where({ raceId: rid }).delete(),
            db.timingPoints.where({ raceId: rid }).delete(),
            db.participants.where({ raceId: rid }).delete(),
            db.registrations.where({ raceId: rid }).delete(),
            db.queueEntries.where({ raceId: rid }).delete(),
          ]);
          return;
        }
      }
      for (const d of snapshot.distances) {
        const ex = await db.distances.get(d.id);
        if (!ex || d.updatedAt >= ex.updatedAt) await db.distances.put(d);
      }
      for (const tp of snapshot.timingPoints) {
        const ex = await db.timingPoints.get(tp.id);
        if (!ex || tp.updatedAt >= ex.updatedAt) await db.timingPoints.put(tp);
      }
      for (const p of snapshot.participants) {
        const ex = await db.participants.get(p.id);
        if (!ex || p.updatedAt >= ex.updatedAt) {
          await db.participants.put(p);
          stats.participantsUpserted++;
        }
      }
      // Registreringer: union på id, nyeste updatedAt vinner.
      for (const r of snapshot.registrations) {
        const ex = await db.registrations.get(r.id);
        if (!ex) {
          await db.registrations.put(r);
          stats.registrationsAdded++;
        } else if (r.updatedAt > ex.updatedAt) {
          await db.registrations.put(r);
          stats.registrationsUpdated++;
        }
      }
      // Forvarsel-kø: samme regel som registreringer.
      for (const q of snapshot.queueEntries ?? []) {
        const ex = await db.queueEntries.get(q.id);
        const qUpdated = q.updatedAt ?? q.addedAt;
        const exUpdated = ex ? (ex.updatedAt ?? ex.addedAt) : -1;
        if (!ex || qUpdated > exUpdated) await db.queueEntries.put(q);
      }
    },
  );

  return stats;
}

export async function importBundle(bundle: RaceBundle): Promise<MergeStats> {
  if (bundle.format !== "lopstid") {
    throw new Error("Ukjent filformat");
  }
  return mergeRaceSnapshot(bundle);
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  triggerDownload(filename, blob);
}

export function downloadText(
  filename: string,
  text: string,
  mime = "text/csv;charset=utf-8",
): void {
  triggerDownload(filename, new Blob(["﻿" + text], { type: mime }));
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
