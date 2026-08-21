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

function tpDistanceM(tp: TimingPoint, distance: Distance | undefined): number | undefined {
  if (tp.kind === "finish") return distance?.lengthMeters;
  return tp.distanceMeters;
}

export interface SplitResult {
  timingPoint: TimingPoint;
  passedAt?: number;
  elapsedMs?: number;
  distanceM?: number;
  paceSecPerKm?: number;
}

/** To passeringer for samme startnummer på samme punkt, langt fra hverandre. */
export interface RegistrationConflict {
  timingPoint: TimingPoint;
  count: number;
  /** Tid mellom første og siste passering. */
  spreadMs: number;
  firstAt: number;
  lastAt: number;
}

export interface ParticipantResult {
  participant: Participant;
  distance?: Distance;
  startTime?: number;
  finishAt?: number;
  finishElapsedMs?: number;
  finishDistanceM?: number;
  finishPaceSecPerKm?: number;
  splits: SplitResult[];
  status: "finished" | "started" | "no-start";
  /**
   * Punkter der samme startnummer er registrert flere ganger med stor
   * avstand i tid. To enheter som fanger samme passering ligger sekunder
   * fra hverandre; et feiltastet startnummer ligger minutter unna. Kun det
   * siste er verdt å varsle om.
   */
  conflicts: RegistrationConflict[];
}

/** Over denne avstanden regnes to passeringer som en reell konflikt. */
export const CONFLICT_THRESHOLD_MS = 30000;

export function computeResult(
  participant: Participant,
  distance: Distance | undefined,
  timingPoints: TimingPoint[],
  registrations: Registration[],
  /**
   * Tidspunktet resultatene regnes ut for. En starttid kan settes i forkant
   * (startklokka oppfordrer til nettopp det, for å telle ned mot den) – uten
   * `now` ville en løper med i morgen som starttid vist som "underveis" i
   * dag, siden startTimeFor da allerede returnerer en verdi.
   */
  now: number = Date.now(),
): ParticipantResult {
  const start = startTimeFor(participant, distance);
  const points = timingPoints
    .filter((tp) => tp.distanceId === participant.distanceId)
    .sort((a, b) => a.order - b.order);

  const splits: SplitResult[] = [];
  const conflicts: RegistrationConflict[] = [];
  let finishAt: number | undefined;
  for (const tp of points) {
    const reg = latestRegistration(registrations, participant.bib, tp.id);
    const passedAt = reg?.timestamp;

    // Se etter flere passeringer på samme punkt. En feiltasting som treffer
    // et startnummer som alt er i mål, ville ellers stilltiende overskrive
    // den riktige tiden med en mye senere.
    const atPoint = registrations.filter(
      (r) => !r.deleted && r.bib === participant.bib && r.timingPointId === tp.id,
    );
    if (atPoint.length > 1) {
      const times = atPoint.map((r) => r.timestamp);
      const firstAt = Math.min(...times);
      const lastAt = Math.max(...times);
      if (lastAt - firstAt > CONFLICT_THRESHOLD_MS) {
        conflicts.push({
          timingPoint: tp,
          count: atPoint.length,
          spreadMs: lastAt - firstAt,
          firstAt,
          lastAt,
        });
      }
    }

    const elapsedMs =
      passedAt != null && start != null ? passedAt - start : undefined;
    const distanceM = tpDistanceM(tp, distance);
    const paceSecPerKm =
      elapsedMs != null && distanceM != null && distanceM > 0
        ? elapsedMs / distanceM
        : undefined;
    if (tp.kind === "finish") {
      finishAt = passedAt;
    } else {
      splits.push({ timingPoint: tp, passedAt, elapsedMs, distanceM, paceSecPerKm });
    }
  }

  const finishElapsedMs =
    finishAt != null && start != null ? finishAt - start : undefined;
  const finishDistanceM = distance?.lengthMeters;
  const finishPaceSecPerKm =
    finishElapsedMs != null && finishDistanceM != null && finishDistanceM > 0
      ? finishElapsedMs / finishDistanceM
      : undefined;

  const status: ParticipantResult["status"] =
    finishAt != null
      ? "finished"
      : start != null && start <= now
        ? "started"
        : "no-start";

  return {
    participant,
    distance,
    startTime: start,
    finishAt,
    finishElapsedMs,
    finishDistanceM,
    finishPaceSecPerKm,
    splits,
    status,
    conflicts,
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

export interface ExpectedRunner {
  participant: Participant;
  eta: number | undefined;
  paceSecPerKm: number | undefined;
}

/**
 * Beregner forventede løpere ved et gitt tidspunkt basert på passert pace.
 * Returnerer deltakere som ennå ikke er registrert ved tidspunktet, sortert
 * etter ETA (de uten ETA sist, sortert på startnr).
 */
export function computeExpectedAt(
  targetTP: TimingPoint,
  participants: Participant[],
  distanceMap: Map<string, Distance>,
  allTimingPoints: TimingPoint[],
  registrations: Registration[],
): ExpectedRunner[] {
  // Bygg oppslagskart (bib:tpId → beste registrering) for effektiv lookup.
  const regMap = new Map<string, Registration>();
  for (const r of registrations) {
    if (r.deleted) continue;
    const key = `${r.bib}:${r.timingPointId}`;
    const existing = regMap.get(key);
    if (!existing || r.timestamp > existing.timestamp) regMap.set(key, r);
  }
  const getLatest = (bib: string, tpId: string) =>
    regMap.get(`${bib}:${tpId}`);

  const result: ExpectedRunner[] = [];

  for (const participant of participants) {
    if (participant.distanceId !== targetTP.distanceId) continue;
    if (getLatest(participant.bib, targetTP.id)) continue;

    const distance = distanceMap.get(participant.distanceId);
    const startTime = startTimeFor(participant, distance);

    const points = allTimingPoints
      .filter((tp) => tp.distanceId === participant.distanceId)
      .sort((a, b) => a.order - b.order);

    const targetIdx = points.findIndex((tp) => tp.id === targetTP.id);
    if (targetIdx < 0) continue;

    const priorPoints = points.slice(0, targetIdx);

    let lastTimestamp: number | undefined;
    let lastDistanceM: number | undefined;

    for (const tp of [...priorPoints].reverse()) {
      const reg = getLatest(participant.bib, tp.id);
      if (reg) {
        lastTimestamp = reg.timestamp;
        lastDistanceM = tpDistanceM(tp, distance);
        break;
      }
    }

    const targetDistanceM = tpDistanceM(targetTP, distance);

    let eta: number | undefined;
    let paceSecPerKm: number | undefined;

    if (
      lastTimestamp != null &&
      startTime != null &&
      lastDistanceM != null &&
      lastDistanceM > 0 &&
      targetDistanceM != null &&
      targetDistanceM > lastDistanceM
    ) {
      const elapsed = lastTimestamp - startTime;
      if (elapsed > 0) {
        const paceMsPerM = elapsed / lastDistanceM;
        eta = lastTimestamp + paceMsPerM * (targetDistanceM - lastDistanceM);
        paceSecPerKm = elapsed / lastDistanceM;
      }
    }

    result.push({ participant, eta, paceSecPerKm });
  }

  result.sort((a, b) => {
    if (a.eta != null && b.eta != null) return a.eta - b.eta;
    if (a.eta != null) return -1;
    if (b.eta != null) return 1;
    return numericBib(a.participant.bib) - numericBib(b.participant.bib);
  });

  return result;
}

function numericBib(bib: string): number {
  const n = parseInt(bib, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}
