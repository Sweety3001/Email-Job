// CSV parsing: extract valid email addresses from CSV or plain text.
// Handles: "email" column, any column containing emails, quoted fields,
// comma/semicolon/newline/whitespace separated lists.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Extract every valid email address found anywhere in the file text. */
export function extractEmails(raw: string): string[] {
  // Split on any separator (commas, semicolons, whitespace, newlines) and
  // strip common CSV quoting.
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^["']+|["']+$/g, "").trim())
    .filter((t) => t.length > 0);
  return tokens.filter((t) => EMAIL_REGEX.test(t));
}

export interface ParseResult {
  emails: string[]; // unique, lowercase
  duplicates: number;
}

export function parseEmailFile(content: string): ParseResult {
  const found = extractEmails(content).map((e) => e.toLowerCase());
  const unique = new Set(found);
  return { emails: [...unique], duplicates: found.length - unique.size };
}
