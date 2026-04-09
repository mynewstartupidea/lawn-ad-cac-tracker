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
    // Each client can have up to 3 phone numbers — index all of them
    const phoneMap = new Map<string, SAClient>();

    for (const row of saRows) {
      const firstName = col(row, "FirstNam", "First Name", "FirstName", "first_name");
      const lastName  = col(row, "LastNam",  "Last Name",  "LastName",  "last_name");
      const name = [firstName, lastName].filter(Boolean).join(" ")
        || col(row, "ClientNa", "ClientName", "Name", "FullName");

      const homePhone = normalizePhone(col(row, "HomePhone", "Home Phone", "home_phone"));
      const workPhone = normalizePhone(col(row, "WorkPhone", "Work Phone", "work_phone"));
      const cellPhone = normalizePhone(col(row, "CellPhone", "Cell Phone", "cell_phone", "Mobile", "MobilePhone"));

      const address = [
        col(row, "PhysicalS", "Physical Street", "Street", "Address"),
        col(row, "PhysicalC", "Physical City",   "City"),
        col(row, "PhysicalZ", "Physical Zip",    "Zip", "ZipCode"),
      ].filter(Boolean).join(", ");

      const base: Omit<SAClient, "matchedPhone"> = {
        name: name || "Unknown",
        homePhone,
        workPhone,
        cellPhone,
        address,
      };

      // Register all non-empty phone numbers — first-write wins for duplicates
      for (const phone of [cellPhone, homePhone, workPhone]) {
        if (phone.length >= 10 && !phoneMap.has(phone)) {
          phoneMap.set(phone, { ...base, matchedPhone: phone });
        }
      }
    }

    // ── Match each CallRail call to a client ─────────────────────────────────
    interface CallRailRow {
      flyerName: string;
      trackingNumber: string;
      callerPhone: string;
      startTime: string;
      duration: number;
      client: SAClient | null;
    }

    const calls: CallRailRow[] = crRows.map(row => {
      const callerPhone = normalizePhone(
        col(row, "Phone Number", "PhoneNumber", "Caller Number", "CallerNumber", "caller_phone")
      );
      return {
        flyerName:       col(row, "Number Name", "NumberName", "Tracking Name", "TrackingName", "Campaign"),
        trackingNumber:  col(row, "Tracking Number", "TrackingNumber", "Tracking #", "tracking_number"),
        callerPhone,
        startTime:       col(row, "Start Time", "StartTime", "Date", "Call Date"),
        duration:        parseInt(col(row, "Duration (seconds)", "Duration", "DurationSeconds") || "0") || 0,
        client:          callerPhone ? (phoneMap.get(callerPhone) ?? null) : null,
      };
    });

    // ── Group by flyer (Number Name + Tracking Number) ───────────────────────
    const flyerMap = new Map<string, FlyerResult & { seenPhones: Set<string> }>();

    for (const call of calls) {
      const key = `${call.flyerName}||${call.trackingNumber}`;
      if (!flyerMap.has(key)) {
        flyerMap.set(key, {
          flyerName:      call.flyerName || "Unknown",
          trackingNumber: call.trackingNumber,
          totalCalls:     0,
          conversions:    0,
          matchedClients: [],
          seenPhones:     new Set(),
        });
      }

      const flyer = flyerMap.get(key)!;
      flyer.totalCalls++;

      // Deduplicate clients — same person may call multiple times
      if (call.client && !flyer.seenPhones.has(call.client.matchedPhone)) {
        flyer.seenPhones.add(call.client.matchedPhone);
        flyer.matchedClients.push(call.client);
        flyer.conversions++;
      }
    }

    // ── Build final results ──────────────────────────────────────────────────
    const results: FlyerResult[] = Array.from(flyerMap.values())
      .map(({ seenPhones: _s, ...rest }) => rest)   // strip the Set before JSON
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
