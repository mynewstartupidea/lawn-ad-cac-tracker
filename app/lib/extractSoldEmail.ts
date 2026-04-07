// Email regex — matches standard email addresses
// \b at the end stops the TLD from greedily eating adjacent text (e.g. .comJohnSmith)
const EMAIL_RE = /[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}\b/;

// Extracts an email from any message where "sold" appears at/near the start
// (case-insensitive), regardless of leading punctuation, spacing, or formatting.
//
// Examples that all work:
//   sold: john@gmail.com
//   SOLD john@gmail.com
//   sold.   john@gmail.com
//   (SOLD: john@gmail.com\nJohn Smith - Mr.)
//   [SOLD] john@gmail.com
//   sold <mailto:john@gmail.com|john@gmail.com>
export function extractSoldEmail(text: string): string | null {
  // Strip leading non-letter characters so "(SOLD:..." and "[SOLD]..." work
  const stripped = text.trimStart().replace(/^[^a-zA-Z]+/, "");
  if (!stripped.toLowerCase().startsWith("sold")) return null;

  // Strip Slack's mailto wrapper: <mailto:email|email> → email
  const cleaned = text
    .replace(/<mailto:[^|>]*\|([^>]+)>/g, "$1")
    .replace(/<mailto:([^>]+)>/g, "$1");

  const match = cleaned.match(EMAIL_RE);
  if (!match) return null;

  return match[0].toLowerCase();
}
