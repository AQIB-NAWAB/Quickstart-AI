/** Conservatively parse a complete address spoken in one turn; partial addresses stay with the model. */
export function extractSpokenEmail(input: string): string | null {
  const normalized = input.toLowerCase()
    .replace(/\b(?:my\s+)?(?:e\s*mail|email|address)(?:\s+address)?\s*(?:is called|starts(?:\s+with)?|would be|is|it's|:)?\s*/g, " ")
    .replace(/\b(?:at\s+the\s+rate\s+of|at\s+the\s+rate|at\s+sign|at)\b/g, " @ ")
    .replace(/\b(?:dot|period|full\s+stop)\b/g, " . ")
    .replace(/\bunderscore\b/g, " _ ")
    .replace(/\b(?:dash|hyphen)\b/g, " - ")
    .replace(/\b(?:it's|it is|is|please)\b/g, " ")
    .trim();
  const pieces = normalized.split("@");
  if (pieces.length !== 2) return null;
  const local = pieces[0].replace(/\s+/g, "").replace(/^[,;:]+|[,;:]+$/g, "");
  const domain = pieces[1].replace(/\s+/g, "").replace(/[,;:!?]+$/g, "").replace(/\.$/, "");
  const email = `${local}@${domain}`;
  return /^[a-z0-9][a-z0-9._%+\-]*@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/.test(email) && email.length <= 254 ? email : null;
}
