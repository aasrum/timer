// Tynn fetch-wrapper mot synk-serveren. Alle kall er relative (/api/...) slik
// at samme kode fungerer i produksjon (Caddy ruter /api/* til API-tjenesten
// på samme domene) og lokalt (Vite dev-proxy, se vite.config.ts).

const TOKEN_KEY = "lopstid_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Feil (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AdminLoginResult {
  token: string;
  name: string;
}

export function adminLogin(username: string, password: string): Promise<AdminLoginResult> {
  return request("/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export interface StationLoginResult {
  token: string;
  stationId: string;
  raceId: string;
  name: string;
  role: string;
  defaultTimingPointId: string | null;
}

export function stationLogin(pin: string): Promise<StationLoginResult> {
  return request("/station/login", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export interface RemoteRaceInfo {
  id: string;
  name: string;
  date: string;
  status: "active" | "finished";
  updatedAt: number;
  participants: number;
  registrations: number;
}

/** Løp som finnes på serveren – uavhengig av hva denne enheten har lokalt. */
export function listRemoteRaces(): Promise<RemoteRaceInfo[]> {
  return request("/admin/races");
}

export interface StationInfo {
  id: string;
  name: string;
  role: string;
  defaultTimingPointId: string | null;
  /** Null for stasjoner opprettet før koder ble lagret gjenfinnbart. */
  pin: string | null;
  createdAt: number;
  lastSeenAt: number | null;
}

export function listStations(raceId: string): Promise<StationInfo[]> {
  return request(`/admin/races/${raceId}/stations`);
}

export function createStation(
  raceId: string,
  name: string,
  role: string,
  defaultTimingPointId: string | null,
): Promise<StationInfo & { pin: string }> {
  return request(`/admin/races/${raceId}/stations`, {
    method: "POST",
    body: JSON.stringify({ name, role, defaultTimingPointId }),
  });
}

export function regeneratePin(raceId: string, stationId: string): Promise<{ pin: string }> {
  return request(`/admin/races/${raceId}/stations/${stationId}/regenerate-pin`, {
    method: "POST",
  });
}

export function deleteStation(raceId: string, stationId: string): Promise<void> {
  return request(`/admin/races/${raceId}/stations/${stationId}`, {
    method: "DELETE",
  });
}

export interface SyncSnapshot {
  race: unknown;
  distances: unknown[];
  timingPoints: unknown[];
  participants: unknown[];
  registrations: unknown[];
  queueEntries?: unknown[];
}

export function syncRace(
  raceId: string,
  payload: SyncSnapshot,
): Promise<SyncSnapshot & { serverTime: number }> {
  return request(`/races/${raceId}/sync`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Offentlig resultat-snapshot – krever ingen innlogging. */
export function fetchPublicSnapshot(
  raceId: string,
): Promise<SyncSnapshot & { serverTime: number }> {
  return request(`/public/${raceId}`);
}
