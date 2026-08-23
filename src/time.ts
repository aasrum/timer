// Tids-hjelpere. Vi jobber konsekvent i epoch ms og formaterer ved behov.

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** Klokkeslett HH:MM:SS fra epoch ms. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Klokkeslett med tideler HH:MM:SS.t fra epoch ms. */
export function formatClockTenths(ms: number): string {
  const d = new Date(ms);
  const t = Math.floor(d.getMilliseconds() / 100);
  return `${formatClock(ms)}.${t}`;
}

/**
 * Varighet som [h:]mm:ss.t. Negative verdier vises med minus (vanligvis tegn på
 * feil starttid). Avrundes til tideler.
 */
export function formatDuration(ms: number): string {
  const neg = ms < 0;
  let total = Math.round(Math.abs(ms) / 100); // tideler
  const tenths = total % 10;
  total = Math.floor(total / 10); // hele sekunder
  const seconds = total % 60;
  total = Math.floor(total / 60);
  const minutes = total % 60;
  const hours = Math.floor(total / 60);
  const body =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;
  return `${neg ? "-" : ""}${body}.${tenths}`;
}

/**
 * Tolker en starttid-streng mot en basisdato (race.date, yyyy-mm-dd).
 * Godtar "HH:MM", "HH:MM:SS", "HH:MM:SS.t". Returnerer epoch ms eller null.
 */
export function parseTimeOfDay(input: string, baseDate: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, hh, mm, ss, frac] = m;
  const [y, mo, d] = baseDate.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const ms = frac ? Number((frac + "000").slice(0, 3)) : 0;
  const dt = new Date(y, mo - 1, d, Number(hh), Number(mm), Number(ss ?? 0), ms);
  return dt.getTime();
}

/**
 * Varighet som tt:mm:ss med tosifret time – formatet EQ Timing venter i
 * tidskolonnene sine. Rundes til nærmeste sekund.
 */
export function formatHms(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

/**
 * Tolker en varighet: «mm:ss», «h:mm:ss», begge med valgfrie tideler.
 * Brukt når noen oppgir løpstiden fra en stoppeklokke i stedet for
 * klokkeslettet ved passering. Returnerer ms eller null.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, hh, mm, ss, frac] = m;
  const ms = frac ? Number((frac + "000").slice(0, 3)) : 0;
  return (
    (Number(hh ?? 0) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 + ms
  );
}

/** Pace som mm:ss/km fra varighet og distanse i meter. */
export function formatPace(elapsedMs: number, distanceM: number): string {
  if (distanceM <= 0) return "–";
  const secPerKm = elapsedMs / distanceM; // ms/m = sec/km
  const minutes = Math.floor(secPerKm / 60);
  const seconds = Math.floor(secPerKm % 60);
  return `${minutes}:${pad(seconds)}/km`;
}

/** ISO-dato (yyyy-mm-dd) for i dag, i lokal tid. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Henter inn et HH:MM:SS-felt for redigering fra epoch ms. */
export function clockInputValue(ms: number | undefined): string {
  if (ms == null) return "";
  return formatClockTenths(ms);
}
