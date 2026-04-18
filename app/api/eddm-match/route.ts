import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const maxDuration = 60;

// ─── Phone normalization ───────────────────────────────────────────────────────
// Strips all non-digit characters, removes leading country code +1 or 1
function normalizePhone(raw: unknown): string {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

// ─── Flexible column finder ────────────────────────────────────────────────────
// Tries multiple candidate names against the actual headers (case-insensitive, strips spaces/underscores)
function col(row: Record<string, unknown>, ...candidates: string[]): string {
  for (const c of candidates) {
    const normal = c.toLowerCase().replace(/[\s_]/g, "");
    for (const key of Object.keys(row)) {
      if (key.toLowerCase().replace(/[\s_]/g, "") === normal) {
        return String(row[key] ?? "").trim();
      }
    }
  }
  return "";
}

// ─── Parse any file buffer into row objects ────────────────────────────────────
// Works for .xlsx, .xls, and .csv — xlsx library handles all three.
// For multi-sheet workbooks (e.g. CallRail exports with a cover sheet + data sheet),
// picks the sheet with the most rows rather than blindly taking the first one.
function parseBuffer(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  let bestSheet = wb.Sheets[wb.SheetNames[0]];
  let bestCount = 0;

  for (const name of wb.SheetNames) {
    const ws   = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    if (rows.length > bestCount) {
      bestCount = rows.length;
      bestSheet = ws;
    }
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(bestSheet, { defval: "" });
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SAClient {
  name: string;
  matchedPhone: string;    // the phone that matched the CallRail caller
  homePhone: string;
  workPhone: string;
  cellPhone: string;
  address: string;
  zip: string;             // 5-digit zip extracted from PhysicalZ column
}

interface FlyerResult {
  flyerName: string;
  trackingNumber: string;
  totalCalls: number;
  conversions: number;
  matchedClients: SAClient[];
}

// ─── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const callrailFile = formData.get("callrail") as File | null;
    const clientFile   = formData.get("clients")  as File | null;

    if (!callrailFile || !clientFile) {
      return NextResponse.json(
        { error: "Both CallRail and client files are required" },
        { status: 400 }
      );
    }

    // ── Parse files ──────────────────────────────────────────────────────────
    const crRows = parseBuffer(await callrailFile.arrayBuffer());
    const saRows = parseBuffer(await clientFile.arrayBuffer());

    if (crRows.length === 0) {
      return NextResponse.json({ error: "CallRail file appears empty" }, { status: 400 });
    }
    if (saRows.length === 0) {
      return NextResponse.json({ error: "Client file appears empty" }, { status: 400 });
    }

    // ── Build phone → client map from Service Autopilot export ───────────────
    // A client can have up to 3 phone numbers (cell, home, work).
    // We assign each client a canonical ID (their first non-empty phone) so that
    // if the same person calls from two different registered numbers they are
    // counted as ONE conversion, not two.
    const phoneToCanonical = new Map<string, string>();   // any phone → canonical phone
    const canonicalToClient = new Map<string, SAClient>(); // canonical phone → client

    for (const row of saRows) {
      const firstName = col(row, "FirstNam", "First Name", "FirstName", "first_name");
      const lastName  = col(row, "LastNam",  "Last Name",  "LastName",  "last_name");
      const name = [firstName, lastName].filter(Boolean).join(" ")
        || col(row, "ClientNa", "ClientName", "Name", "FullName");

      const homePhone = normalizePhone(col(row, "HomePhone", "Home Phone", "home_phone"));
      const workPhone = normalizePhone(col(row, "WorkPhone", "Work Phone", "work_phone"));
      const cellPhone = normalizePhone(col(row, "CellPhone", "Cell Phone", "cell_phone", "Mobile", "MobilePhone"));

      const rawZip   = col(row, "PhysicalZ", "Physical Zip", "Zip", "ZipCode", "PostalCode");
      const zipDigits = rawZip.replace(/\D/g, "").slice(0, 5);
      const zip = zipDigits.length >= 3 ? zipDigits.padStart(5, "0") : "";

      const address = [
        col(row, "PhysicalS", "Physical Street", "Street", "Address"),
        col(row, "PhysicalC", "Physical City",   "City"),
      ].filter(Boolean).join(", ");

      // Collect all valid phones for this client (cell first = highest priority)
      const phones = [cellPhone, homePhone, workPhone].filter(p => p.length >= 10);
      if (phones.length === 0) continue;

      // First phone becomes this client's canonical identity
      const canonical = phones[0];

      if (!canonicalToClient.has(canonical)) {
        canonicalToClient.set(canonical, {
          name: name || "Unknown",
          matchedPhone: canonical,
          homePhone,
          workPhone,
          cellPhone,
          address,
          zip,
        });
      }

      // Map every phone for this client to their canonical ID
      // (first-write wins handles two different clients sharing a number)
      for (const phone of phones) {
        if (!phoneToCanonical.has(phone)) {
          phoneToCanonical.set(phone, canonical);
        }
      }
    }

    // ── Match each CallRail call to a client ─────────────────────────────────
    interface CallRailRow {
      flyerName: string;
      trackingNumber: string;
      callerPhone: string;
      canonical: string | null;   // canonical client ID if matched
      client: SAClient | null;
    }

    const calls: CallRailRow[] = crRows.map(row => {
      const callerPhone = normalizePhone(
        col(row, "Phone Number", "PhoneNumber", "Caller Number", "CallerNumber", "caller_phone")
      );
      const canonical = callerPhone ? (phoneToCanonical.get(callerPhone) ?? null) : null;
      const client    = canonical ? (canonicalToClient.get(canonical) ?? null) : null;
      return {
        flyerName:      col(row, "Number Name", "NumberName", "Tracking Name", "TrackingName", "Campaign"),
        trackingNumber: col(row, "Tracking Number", "TrackingNumber", "Tracking #", "tracking_number"),
        callerPhone,
        canonical,
        // Store the actual phone they called from so the UI can display it
        client: client ? { ...client, matchedPhone: callerPhone } : null,
      };
    });

    // ── Group by flyer (Number Name + Tracking Number) ───────────────────────
    const flyerMap = new Map<string, FlyerResult & { seenCanonicals: Set<string> }>();

    for (const call of calls) {
      const key = `${call.flyerName}||${call.trackingNumber}`;
      if (!flyerMap.has(key)) {
        flyerMap.set(key, {
          flyerName:      call.flyerName || "Unknown",
          trackingNumber: call.trackingNumber,
          totalCalls:     0,
          conversions:    0,
          matchedClients: [],
          seenCanonicals: new Set(),
        });
      }

      const flyer = flyerMap.get(key)!;
      flyer.totalCalls++;

      // Deduplicate by canonical client ID — if same person calls from cell AND home
      // phone, they still count as exactly 1 conversion for this flyer.
      if (call.client && call.canonical && !flyer.seenCanonicals.has(call.canonical)) {
        flyer.seenCanonicals.add(call.canonical);
        flyer.matchedClients.push(call.client);
        flyer.conversions++;
      }
    }

    // ── Build final results ──────────────────────────────────────────────────
    const results: FlyerResult[] = Array.from(flyerMap.values())
      .map(({ seenCanonicals: _s, ...rest }) => rest)   // strip the Set before JSON
      .sort((a, b) => b.conversions - a.conversions || b.totalCalls - a.totalCalls);

    const totalCalls    = calls.length;
    const totalMatched  = results.reduce((s, r) => s + r.conversions, 0);
    const saClientsRead = saRows.length;

    return NextResponse.json({ results, totalCalls, totalMatched, saClientsRead });

  } catch (err) {
    console.error("[eddm-match]", err);
    return NextResponse.json({ error: "Failed to process files. Check column names and try again." }, { status: 500 });
  }
}
