import { useEffect, useRef, useState } from "react";
import { syncRace, type SyncSnapshot } from "./api";
import { getSetting, setSetting } from "./db";
import { mergeRaceSnapshot, readLocalSnapshot, type RaceSnapshot } from "./sync";
import { useAuth } from "./auth";

export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";

/**
 * Synker ett løp mot serveren: sender hele det lokale datasettet og mottar
 * hele serverens datasett tilbake i samme kall, flettet med de samme
 * konfliktfrie reglene som manuell fil-fletting (sync.ts).
 *
 * Full snapshot hver gang – ingen "siden sist"-markør. Det gjør synken
 * immun mot klokkeskjevhet mellom enheter: en markør basert på updatedAt
 * (som er satt av hver enhets egen klokke) kan i verste fall ekskludere en
 * forsinket/feilstilt enhets data for alltid. Her er hver synk en fullstendig
 * tilstands-utveksling, så ingenting kan gå tapt uansett hvor lenge en enhet
 * har vært offline eller hvor feil klokken dens er.
 */
export async function syncOnce(raceId: string): Promise<void> {
  const local = await readLocalSnapshot(raceId);
  const t0 = Date.now();
  const remote = await syncRace(raceId, local as unknown as SyncSnapshot);
  const t1 = Date.now();
  // Klokkekorreksjon: estimér avvik mellom denne enheten og serveren ved å
  // anta at serverens tidsstempel ble tatt midt i rundturen. Lagres som
  // innstilling og legges på registreringstidspunkter, slik at tider fra
  // enheter med feilstilt klokke blir sammenlignbare.
  const offset = Math.round(remote.serverTime - (t0 + t1) / 2);
  const prev = await getSetting<number>("clockOffsetMs", 0);
  if (Math.abs(offset - prev) > 250) await setSetting("clockOffsetMs", offset);
  await mergeRaceSnapshot(remote as unknown as RaceSnapshot);
}

const SYNC_INTERVAL_MS = 15000;

export function useLiveSync(raceId: string | undefined): {
  status: SyncStatus;
  lastSyncedAt: number | null;
} {
  const { auth } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!raceId || auth.kind === "none") return;

    let stopped = false;

    async function tick() {
      if (inFlight.current || stopped) return;
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      inFlight.current = true;
      setStatus("syncing");
      try {
        await syncOnce(raceId as string);
        if (!stopped) {
          setStatus("ok");
          setLastSyncedAt(Date.now());
        }
      } catch {
        if (!stopped) setStatus("error");
      } finally {
        inFlight.current = false;
      }
    }

    tick();
    const interval = setInterval(tick, SYNC_INTERVAL_MS);
    const onOnline = () => tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [raceId, auth.kind]);

  return { status, lastSyncedAt };
}
