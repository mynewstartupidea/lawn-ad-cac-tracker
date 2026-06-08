import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const maxDuration = 60;

function normalizePhone(raw: unknown): string {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits : "";
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

function col(row: Record<string, unknown>, ...candidates: string[]): string {
  for (const c of candidates) {
    const normal = c.toLowerCase().replace(/[\s_\-]/g, "");
    for (const key of Object.keys(row)) {
      if (key.toLowerCase().replace(/[\s_\-]/g, "") === normal) {
        return String(row[key] ?? "").trim();
      }
    }
  }
  return "";
}

function parseBuffer(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  let bestSheet = wb.Sheets[wb.SheetNames[0]];
  let bestCount = 0;
  for (const name of wb.SheetNames) {
    const ws   = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    if (rows.length > bestCount) { bestCount = rows.length; bestSheet = ws; }
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(bestSheet, { defval: "" });
}

export interface AttrAdResult {
  adName: string;
  sales: number;
  emailMatches: number;
  phoneMatches: number;
}

export interface AttrResponse {
  results: AttrAdResult[];
  totalLeads: number;
  totalClients: number;
  totalSales: number;
  emailMatchCount: number;
  phoneMatchCount: number;
  unmatched: number;
  error?: string;
}

export async function POST(req: Request) {
  try {
    const formData    = await req.formData();
    const ghlFile     = formData.get("ghlFile")     as File | null;
    const clientsFile = formData.get("clientsFile") as File | null;

    if (!ghlFile || !clientsFile) {
      return NextResponse.json(
        { error: "Both GHL leads and clients files are required" },
        { status: 400 },
      );
    }

    const ghlRows    = parseBuffer(await ghlFile.arrayBuffer());
    const clientRows = parseBuffer(await clientsFile.arrayBuffer());

    if (ghlRows.length    === 0) return NextResponse.json({ error: "GHL leads file appears empty or unreadable" },  { status: 400 });
    if (clientRows.length === 0) return NextResponse.json({ error: "Clients file appears empty or unreadable" },    { status: 400 });

    // ── Parse GHL leads → email/phone → ad name maps ──────────────────────────
    const emailToAd = new Map<string, string>(); // first lead per email wins
    const phoneToAd = new Map<string, string>(); // first lead per phone wins
    let validLeads  = 0;

    for (const row of ghlRows) {
      const email  = normalizeEmail(col(row, "Email", "Email Address", "Contact Email", "EmailAddress", "email_address"));
      const phone  = normalizePhone(col(row, "Phone", "Phone Number", "Mobile", "Mobile Phone", "Cell", "phone_number"));
      const adName = (
        col(row, "Ad Name", "AdName", "ad_name") ||
        col(row, "UTM Content", "utm_content", "UTMContent") ||
        col(row, "Source", "Lead Source", "LeadSource") ||
        col(row, "Campaign", "Campaign Name") ||
        "Unknown"
      ).trim() || "Unknown";

      if (!email && !phone) continue;
      validLeads++;

      if (email && !emailToAd.has(email)) emailToAd.set(email, adName);
      if (phone && !phoneToAd.has(phone)) phoneToAd.set(phone, adName);
    }

    // ── Match each client to an ad ────────────────────────────────────────────
    const adSales = new Map<string, { emailMatches: number; phoneMatches: number; seen: Set<string> }>();
    let emailMatchCount = 0;
    let phoneMatchCount = 0;
    let unmatched       = 0;

    for (const row of clientRows) {
      const email  = normalizeEmail(col(row, "Email", "Email Address", "Customer Email", "EmailAddress", "email_address"));
      // Collect all phone columns — check all of them
      const phones = [
        col(row, "Phone", "Phone Number", "phone_number"),
        col(row, "Mobile", "Mobile Phone", "Cell Phone", "Cell"),
        col(row, "Home Phone", "Home"),
        col(row, "Work Phone", "Work"),
      ].map(normalizePhone).filter(p => p.length >= 10);

      const clientId = email || phones[0] || "";
      if (!clientId) { unmatched++; continue; }

      let matchedAd:  string | null = null;
      let matchType: "email" | "phone" | null = null;

      if (email && emailToAd.has(email)) {
        matchedAd = emailToAd.get(email)!;
        matchType = "email";
      }
      if (!matchedAd) {
        for (const phone of phones) {
          if (phoneToAd.has(phone)) {
            matchedAd = phoneToAd.get(phone)!;
            matchType = "phone";
            break;
          }
        }
      }

      if (!matchedAd) { unmatched++; continue; }

      if (!adSales.has(matchedAd)) {
        adSales.set(matchedAd, { emailMatches: 0, phoneMatches: 0, seen: new Set() });
      }
      const entry = adSales.get(matchedAd)!;
      if (entry.seen.has(clientId)) continue; // same client, skip dupe
      entry.seen.add(clientId);

      if (matchType === "email") { entry.emailMatches++; emailMatchCount++; }
      else                        { entry.phoneMatches++; phoneMatchCount++; }
    }

    const results: AttrAdResult[] = Array.from(adSales.entries())
      .map(([adName, d]) => ({
        adName,
        sales:        d.emailMatches + d.phoneMatches,
        emailMatches: d.emailMatches,
        phoneMatches: d.phoneMatches,
      }))
      .sort((a, b) => b.sales - a.sales);

    return NextResponse.json({
      results,
      totalLeads:      validLeads,
      totalClients:    clientRows.length,
      totalSales:      emailMatchCount + phoneMatchCount,
      emailMatchCount,
      phoneMatchCount,
      unmatched,
    } satisfies AttrResponse);

  } catch (err) {
    console.error("[ad-attribution]", err);
    return NextResponse.json(
      { error: "Failed to process files. Check column names and try again." },
      { status: 500 },
    );
  }
}
