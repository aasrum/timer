import {
  db,
  type Race,
  type Distance,
  type TimingPoint,
  type Participant,
  type Registration,
} from "./db";

// Eksport/import for fletting av flere uavhengige stasjoner.
// Filformat: ett race med alle tilhørende tabeller. Fletting er konfliktfri:
//  - races/distances/timingPoints/participants: last-write-wins på updatedAt
//  - registrations: union på id; tombstone (deleted) og nyeste updatedAt vinner

export interface RaceBundle {
  format: "lopstid";
  version: 1;
  exportedAt: number;
  race: Race;
  distances: Distance[];
  timingPoints: TimingPoint[];
  participants: Participant[];
  registrations: Registration[];
}

export async function exportRace(raceId: string): Promise<RaceBundle> {
  const race = await db.races.get(raceId);
  if (!race) throw new Error("Fant ikke løpet");
  const [distances, timingPoints, participants, registrations] =
    await Promise.all([
      db.distances.where({ raceId }).toArray(),
      db.timingPoints.where({ raceId }).toArray(),
      db.participants.where({ raceId }).toArray(),
      db.registrations.where({ raceId }).toArray(),
    ]);
  return {
    format: "lopstid",
    version: 1,
    exportedAt: Date.now(),
    race,
    distances,
    timingPoints,
    participants,
    registrations,
  };
}

export interface MergeStats {
  registrationsAdded: number;
  registrationsUpdated: number;
  participantsUpserted: number;
}

export async function importBundle(bundle: RaceBundle): Promise<MergeStats> {
  if (bundle.format !== "lopstid") {
    throw new Error("Ukjent filformat");
  }
  const stats: MergeStats = {
    registrationsAdded: 0,
    registrationsUpdated: 0,
    participantsUpserted: 0,
  };

  await db.transaction(
    "rw",
    db.races,
    db.distances,
    db.timingPoints,
    db.participants,
    db.registrations,
    async () => {
      // Løp + struktur: last-write-wins.
      const existingRace = await db.races.get(bundle.race.id);
      if (!existingRace || bundle.race.updatedAt >= existingRace.updatedAt) {
        await db.races.put(bundle.race);
      }
      for (const d of bundle.distances) {
        const ex = await db.distances.get(d.id);
        if (!ex || d.updatedAt >= ex.updatedAt) await db.distances.put(d);
      }
      for (const tp of bundle.timingPoints) {
        const ex = await db.timingPoints.get(tp.id);
        if (!ex || tp.updatedAt >= ex.updatedAt) await db.timingPoints.put(tp);
      }
      for (const p of bundle.participants) {
        const ex = await db.participants.get(p.id);
        if (!ex || p.updatedAt >= ex.updatedAt) {
          await db.participants.put(p);
          stats.participantsUpserted++;
        }
      }
      // Registreringer: union på id, nyeste updatedAt vinner.
      for (const r of bundle.registrations) {
        const ex = await db.registrations.get(r.id);
        if (!ex) {
          await db.registrations.put(r);
          stats.registrationsAdded++;
        } else if (r.updatedAt > ex.updatedAt) {
          await db.registrations.put(r);
          stats.registrationsUpdated++;
        }
      }
    },
  );

  return stats;
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
