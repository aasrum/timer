import type {
  Distance,
  Participant,
  Registration,
  TimingPoint,
} from "./db";

// Utregning av resultater. Holdt rent (ingen DB-tilgang) så det er lett å teste
// og gjenbruke. Sluttid = passeringstid − starttid, der starttid er enten
// distansens fellesstart eller deltakerens individuelle starttid.

export function startTimeFor(
  participant: Participant,
  distance: Distance | undefined,
): number | undefined {
  if (distance?.startType === "interval") return participant.startTime;
  return distance?.massStartTime;
}

/** Siste ikke-slettede registrering for en bib på et gitt tidspunkt. */
export function latestRegistration(
  registrations: Registration[],
  bib: string,
  timingPointId: string,
): Registration | undefined {
  let best: Registration | undefined;
  for (const r of registrations) {
    if (r.deleted) continue;
    if (r.bib !== bib || r.timingPointId !== timingPointId) continue;
    if (!best || r.timestamp > best.timestamp) best = r;
  }
  return best;
}

export interface SplitResult {
  timingPoint: TimingPoint;
  passedAt?: number;
  elapsedMs?: number;
}

export interface ParticipantResult {
  participant: Participant;
  distance?: Distance;
  startTime?: number;
  finishAt?: number;
  finishElapsedMs?: number;
  splits: SplitResult[];
  status: "finished" | "started" | "no-start";
}

export function computeResult(
  participant: Participant,
  distance: Distance | undefined,
  timingPoints: TimingPoint[],
  registrations: Registration[],
): ParticipantResult {
  const start = startTimeFor(participant, distance);
  const points = timingPoints
    .filter((tp) => tp.distanceId === participant.distanceId)
    .sort((a, b) => a.order - b.order);

  const splits: SplitResult[] = [];
  let finishAt: number | undefined;
  for (const tp of points) {
    const reg = latestRegistration(registrations, participant.bib, tp.id);
    const passedAt = reg?.timestamp;
    const elapsedMs =
      passedAt != null && start != null ? passedAt - start : undefined;
    if (tp.kind === "finish") finishAt = passedAt;
    else splits.push({ timingPoint: tp, passedAt, elapsedMs });
  }
  const finishElapsedMs =
    finishAt != null && start != null ? finishAt - start : undefined;

  const status: ParticipantResult["status"] =
    finishAt != null ? "finished" : start != null ? "started" : "no-start";

  return {
    participant,
    distance,
    startTime: start,
    finishAt,
    finishElapsedMs,
    splits,
    status,
  };
}

/** Sorterer resultater: fullførte (på tid) først, så øvrige på startnr. */
export function sortResults(results: ParticipantResult[]): ParticipantResult[] {
  return [...results].sort((a, b) => {
    const af = a.finishElapsedMs;
    const bf = b.finishElapsedMs;
    if (af != null && bf != null) return af - bf;
    if (af != null) return -1;
    if (bf != null) return 1;
    return numericBib(a.participant.bib) - numericBib(b.participant.bib);
  });
}

function numericBib(bib: string): number {
  const n = parseInt(bib, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}
