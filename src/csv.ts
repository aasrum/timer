// Enkel, robust CSV-parser for import av startlister.
// Håndterer både komma og semikolon (vanlig i norske eksporter fra Excel),
// samt felt i anførselstegn. Kolonner gjenkjennes fra norske/engelske navn.

export type CsvRow = Record<string, string>;

function detectDelimiter(headerLine: string): string {
  const semis = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;
  if (tabs > semis && tabs > commas) return "\t";
  return semis >= commas ? ";" : ",";
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): CsvRow[] {
  const clean = text.replace(/^﻿/, ""); // fjern BOM
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

// Synonymer for kolonnegjenkjenning.
const FIELD_ALIASES: Record<string, string[]> = {
  bib: ["startnummer", "startnr", "nummer", "nr", "bib", "number", "no"],
  name: ["navn", "name", "deltaker", "fullname", "fullt navn"],
  distance: ["distanse", "distance", "klasse", "class", "løp", "lop", "race"],
  startTime: ["starttid", "start", "starttime", "start time", "starttidspunkt"],
  club: ["klubb", "club", "lag", "team"],
  category: ["kategori", "category", "kjønn", "kjonn", "gender", "klasse2"],
};

export interface ColumnMapping {
  bib?: string;
  name?: string;
  distance?: string;
  startTime?: string;
  club?: string;
  category?: string;
}

/** Foreslår kolonnetilordning ut fra header-navn. */
export function guessMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());
  const mapping: ColumnMapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const found = lower.find((h) => aliases.includes(h));
    if (found) (mapping as Record<string, string>)[field] = found;
  }
  return mapping;
}
