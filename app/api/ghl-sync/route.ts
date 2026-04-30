import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

const GHL_BASE     = "https://services.leadconnectorhq.com";
const GHL_VERSION  = "2021-07-28";

interface GhlAttribution {
  utmContent?:  string;
  utmCampaign?: string;
  utmSource?:   string;
  medium?:      string;
  isFirst?:     boolean;
}

interface GhlContact {
  id:          string;
  email:       string | null;
  firstName:   string | null;
  lastName:    string | null;
  phone:       string | null;
  tags:        string[];
  dateAdded:   string;
  attributions?: GhlAttribution[];
}

interface GhlMeta {
  total:        number;
  nextPageUrl?: string | null;
  startAfter?:  number;
  startAfterId?: string;
}

function isReal(val: string | null | undefined): val is string {
  if (!val) return false;
  const t = val.trim();
  if (!t) return false;
  if (t.startsWith("{{") && t.endsWith("}}")) return false; // unresolved GHL variable
  return true;
}

function extractAdName(attributions: GhlAttribution[] = []): string {
  // Prefer the first-touch attribution with utmContent
  const first = attributions.find(a => a.isFirst);
  if (isReal(first?.utmContent)) return first!.utmContent!.trim();

  // Fallback: any attribution with utmContent
  for (const a of attributions) {
    if (isReal(a.utmContent)) return a.utmContent!.trim();
  }

  // Last resort: campaign name from first-touch
  if (isReal(first?.utmCampaign)) return first!.utmCampaign!.trim();

  return "Unknown Ad";
}

function extractSource(tags: string[]): string {
  for (const tag of tags) {
    const t = tag.trim();
    if (/^FB[\s_-]?FL/i.test(t)) return "FBFL";
    if (/^FB[\s_-]?GA/i.test(t)) return "FBGA";
    if (/^google$/i.test(t) || /^gg$/i.test(t)) return "Google";
    if (/^ig$/i.test(t)) return "Instagram";
    if (/^organic$/i.test(t)) return "Organic";
    if (/^eddm$/i.test(t)) return "EDDM";
  }
  // Infer from attribution medium
  return "ghl";
}

async function fetchPage(apiKey: string, locationId: string, startAfter?: number, startAfterId?: string) {
  const params = new URLSearchParams({ locationId, limit: "100" });
  if (startAfter)    params.set("startAfter",    String(startAfter));
  if (startAfterId)  params.set("startAfterId",  startAfterId);

  const res = await fetch(`${GHL_BASE}/contacts/?${params}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Version":       GHL_VERSION,
    },
  });

  const json = await res.json() as { contacts?: GhlContact[]; meta?: GhlMeta };
  return {
    contacts: json.contacts ?? [],
    meta:     json.meta,
  };
}

async function runSync(sinceDate: Date): Promise<{ inserted: number; updated: number; skipped: number; pages: number }> {
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) throw new Error("GHL_API_KEY and GHL_LOCATION_ID required");

  console.log("[GHL Sync] starting, since:", sinceDate.toISOString());

  // Load all existing lead emails so we can skip fetching them again
  const { data: existingRows } = await supabase.from("leads").select("email, ad_name");
  const existingMap = new Map<string, string>();
  for (const r of existingRows ?? []) {
    existingMap.set(r.email, r.ad_name);
  }

  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;
  let pages    = 0;
  let startAfter: number | undefined;
  let startAfterId: string | undefined;
  let stop = false;

  while (!stop) {
    const { contacts, meta } = await fetchPage(apiKey, locationId, startAfter, startAfterId);
    pages++;

    if (!contacts.length) break;

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { email: string; ad_name: string; source: string; first_name: string; phone: string }[] = [];

    for (const c of contacts) {
      const email     = (c.email     ?? "").toLowerCase().trim();
      const phone     = (c.phone     ?? "").trim();
      const firstName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();

      // Require email + phone + name — skip Messenger/incomplete contacts
      if (!email || !email.includes("@") || !phone || !firstName) { skipped++; continue; }

      const dateAdded = new Date(c.dateAdded);
      if (dateAdded < sinceDate) { stop = true; break; }

      const adName = extractAdName(c.attributions ?? []);
      const source = extractSource(c.tags ?? []);

      const existingAdName = existingMap.get(email);

      if (existingAdName === undefined) {
        // New lead — insert with original GHL signup date
        toInsert.push({ email, first_name: firstName, phone, ad_name: adName, source, created_at: c.dateAdded });
        existingMap.set(email, adName);
      } else if (adName !== "Unknown Ad" && existingAdName !== adName) {
        // GHL is source of truth — update if GHL has a real ad name that differs from DB
        toUpdate.push({ email, ad_name: adName, source, first_name: firstName, phone });
        existingMap.set(email, adName);
      } else {
        skipped++;
      }
    }

    // Batch insert new leads
    if (toInsert.length) {
      const { error } = await supabase.from("leads").insert(toInsert);
      if (error) console.error("[GHL Sync] insert error:", error.message);
      else inserted += toInsert.length;
    }

    // Update leads that had "Unknown Ad"
    for (const u of toUpdate) {
      const { error } = await supabase
        .from("leads")
        .update({ ad_name: u.ad_name, source: u.source, first_name: u.first_name, phone: u.phone })
        .eq("email", u.email);
      if (error) console.error("[GHL Sync] update error:", error.message);
      else updated++;
    }

    console.log(`[GHL Sync] page ${pages}: ${contacts.length} contacts, +${toInsert.length} new, ~${toUpdate.length} updated`);

    // Pagination
    if (!meta?.startAfter || !meta?.startAfterId || stop) break;
    startAfter    = meta.startAfter;
    startAfterId  = meta.startAfterId;

    // Safety cap: max 50 pages (5000 contacts) per run
    if (pages >= 50) break;
  }

  console.log(`[GHL Sync] done — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}, pages: ${pages}`);

  return { inserted, updated, skipped, pages };
}

// GET — called by Vercel cron every hour, syncs last 2 hours
export async function GET() {
  try {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const result = await runSync(since);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[GHL Sync cron] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — manual trigger, defaults to last 90 days (full backfill)
export async function POST(req: Request) {
  try {
    let sinceDate: Date;
    try {
      const body = await req.json() as { since?: string };
      sinceDate = body.since ? new Date(body.since) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    } catch {
      sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    }
    const result = await runSync(sinceDate);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[GHL Sync] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
