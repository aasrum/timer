# Løpstid-server

Liten synk- og innloggingsserver for Løpstid. Holder én admin-konto og en
liste over stasjoner (enheter) per løp, og fletter data fra alle tilkoblede
enheter inn i en SQLite-database.

## Lokal kjøring

```sh
cd server
npm install
DATA_DIR=./data JWT_SECRET=dev-secret ADMIN_USERNAME=admin ADMIN_PASSWORD=admin123 npm start
```

Kjør så `npm run dev` i prosjektroten – Vite sin dev-proxy sender `/api/*`
videre til `http://localhost:8080` (se `vite.config.ts`).

## Miljøvariabler

| Variabel         | Påkrevd | Beskrivelse                                             |
| ---------------- | ------- | -------------------------------------------------------- |
| `JWT_SECRET`      | ja      | Tilfeldig streng brukt til å signere innloggingstokens.   |
| `ADMIN_USERNAME`  | ja      | Brukernavn for admin-kontoen.                             |
| `ADMIN_PASSWORD`  | ja      | Passord for admin-kontoen. Endres ved restart av tjenesten. |
| `DATA_DIR`        | nei     | Hvor SQLite-filen lagres. Default `/data`.                |
| `PORT`            | nei     | Default `8080`.                                           |

## Datamodell

- `admins` / `stations`: innlogging.
- `races` / `distances` / `timing_points` / `participants` / `registrations`:
  hver rad lagres som en opak JSON-blob (samme feltform som klientens
  IndexedDB-rader) pluss `id`/`raceId`/`updatedAt` for indeksering.

## Synk-protokoll

Hvert kall til `POST /api/races/:raceId/sync` sender **hele** enhetens
lokale datasett for løpet, og får **hele** serverens datasett tilbake i
responsen – ikke bare det som er endret "siden sist". Det er bevisst enkelt:
uten en "siden sist"-markør kan ikke klokkeskjevhet mellom enheter noensinne
føre til at data blir permanent ekskludert fra synkroniseringen. Kostnaden er
noe høyere båndbreddebruk per synk, som er uproblematisk ved denne appens
skala (et enkelt løp, typisk hundrevis til noen tusen deltakere/passeringer).

Flettereglene er identiske med den manuelle fil-eksporten/importen i
`src/sync.ts` på klienten: siste `updatedAt` vinner for struktur-tabeller,
og registreringer flettes som union på id (tombstone + nyeste `updatedAt`).

## Backup

Tjenesten kopierer SQLite-databasen til `<DATA_DIR>/backups/` hver 6. time
og beholder de 30 nyeste. Dette er en enkel første forsvarslinje, ikke en
erstatning for ekte off-site backup.
