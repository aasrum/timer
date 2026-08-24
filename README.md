# Løpstid

Offline-først webapp (PWA) for tidtaking på løp. Bygget for å være robust på en
målgang med dårlig eller ingen nettdekning: alt lagres lokalt i nettleseren med
en gang, og flere uavhengige stasjoner kan flettes sammen i ettertid.

## Hovedfunksjoner

- **Løp med flere distanser** og valgfrie mellomtider.
- **Fellesstart** (felles starttid per distanse) og **intervallstart**
  (individuell starttid per deltaker).
- **Import av startlister** fra CSV (komma/semikolon/tab, norske og engelske
  kolonnenavn gjenkjennes automatisk).
- **Forvarsel-kø:** en person taster startnummer når deltakeren nærmer seg, og
  bygger en ordnet liste med navn/klubb. En person i mål trykker den store
  MÅL-knappen ved riktig startnummer når deltakeren passerer.
- **Angre** på siste registreringer.
- **Autolagring** av alle felt (skrives direkte til IndexedDB, krasj-trygt).
- **Flere stasjoner:** hver enhet registrerer uavhengig. Eksporter
  `.lopstid.json` og flett sammen på resultatsiden – konfliktfritt, fordi hver
  passering har egen ID og stasjons-ID.
- **Resultater** med plassering, mellomtider og CSV-eksport.
- **Installerbar PWA** som fungerer 100 % offline etter første lasting.

## Teknologi

React + TypeScript + Vite, Dexie (IndexedDB) for lokal lagring med reaktive
spørringer, og `vite-plugin-pwa` for service worker / offline.

## Utvikling

```bash
npm install
npm run dev          # utviklingsserver
npm run build        # typesjekk + produksjonsbygg til dist/
npm run preview      # forhåndsvis produksjonsbygg
```

## Drift på Hetzner (timer.ntggeilo.no)

1. Pek DNS for `timer.ntggeilo.no` (A/AAAA) til serverens IP.
2. Åpne port 80 og 443 i brannmuren.
3. På serveren:

   ```bash
   git clone <repo> timer && cd timer
   docker compose up -d --build
   ```

Caddy skaffer og fornyer TLS-sertifikat automatisk via Let's Encrypt, så appen
blir tilgjengelig på `https://timer.ntggeilo.no`. HTTPS er nødvendig for at
PWA-en skal kunne installeres og kjøre offline.

Ved oppdatering: `git pull && docker compose up -d --build`.

## Bruk i praksis

1. **Opprett løp** og legg til distanser under *Oppsett*. Hver distanse får
   automatisk et måltidspunkt; legg til mellomtider ved behov.
2. **Importer startliste** (CSV) eller legg til deltakere manuelt. Ved
   intervallstart importeres/settes starttid per deltaker; ved fellesstart
   settes starttiden på distansen (kan settes idet startskuddet går).
3. **Tidtaking:** velg tidspunkt (f.eks. *Mål*). Tast startnummer i forvarsel og
   trykk «Legg i kø». Trykk MÅL når deltakeren passerer. Bruk «Registrer nå» for
   passeringer uten forvarsel.
4. **Flere stasjoner:** kjør én enhet per punkt (mål, mellomtid 5 km, osv.).
   Etterpå: eksporter `.lopstid.json` fra hver enhet og flett dem inn på én enhet
   via *Resultater → Flett inn*.
5. **Resultater:** se tider per distanse og eksporter CSV.

> Tips: gi hver enhet et stasjonsnavn under *Innstillinger*. Siden hver stasjon
> bruker sin egen klokke, bør enhetenes klokker være synkronisert (samme
> tidskilde / NTV) for at flettede tider skal stemme på tidels nivå.

## Veikart

- Kamera ved mål med tidsstemplet opptak for etterkontroll ved tette
  målganger; senere eventuelt automatisk OCR av startnummer som forslag til
  forvarsel-køen.
- Valgfri sky-synk i sanntid mellom stasjoner (i tillegg til fil-fletting).
- Justerbar klokkeforskyvning per stasjon ved etterkorrigering.
