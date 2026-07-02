// Parser for EQ Timing / Emit sitt startliste-XML-format:
// <startliste><start fornavn=".." etternavn=".." team=".." startno=".."
//              klasse="M40-44" nasjon="NOR" starttid="00:00:00" .. /></startliste>

export interface EmitRunner {
  bib: string;
  name: string;
  club?: string;
  gender?: string;
  category?: string;
  nationality?: string;
  /** "HH:MM:SS" eller tom streng. "00:00:00" tolkes som ikke satt. */
  startTime: string;
}

export function looksLikeEmitXml(text: string): boolean {
  return text.includes("<startliste");
}

export function parseEmitXml(text: string): EmitRunner[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Ugyldig XML");
  }
  const runners: EmitRunner[] = [];
  for (const el of doc.querySelectorAll("start")) {
    const attr = (name: string) => el.getAttribute(name)?.trim() ?? "";
    const bib = attr("startno");
    if (!bib) continue;
    const klasse = attr("klasse");
    // Kjønn utledes av klassens første bokstav (M40-44 → M, K/D → K).
    const first = klasse.charAt(0).toUpperCase();
    const gender =
      first === "M" ? "M" : first === "K" || first === "D" ? "K" : undefined;
    const starttid = attr("starttid");
    runners.push({
      bib,
      name: [attr("fornavn"), attr("etternavn")].filter(Boolean).join(" ") || `#${bib}`,
      club: attr("team") || undefined,
      gender,
      category: klasse || undefined,
      nationality: attr("nasjon") || undefined,
      startTime: starttid && starttid !== "00:00:00" ? starttid : "",
    });
  }
  return runners;
}
