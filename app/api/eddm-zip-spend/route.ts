import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const maxDuration = 60;

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

function normalizeZip(raw: string): string {
  const digits = String(raw).replace(/\D/g, "").slice(0, 5);
  return digits.length >= 3 ? digits.padStart(5, "0") : "";
}

function normalizeTracking(raw: string): string {
  return String(raw).replace(/\D/g, "");
}

function parseCurrency(raw: string): number {
  return parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0;
}

// ─── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const formData     = await req.formData();
    const zipCostFile  = formData.get("zipCost")  as File | null;
    const dropRepsFile = formData.get("dropReps") as File | null;
    const flyersJson   = formData.get("flyers")   as string | null;

    if (!zipCostFile || !dropRepsFile) {
      return NextResponse.json(
        { error: "Both files are required: Zip Cost file and Drop/Reps file." },
        { status: 400 }
      );
    }

    const flyers: Array<{ flyerName: string; trackingNumber: string }> =
      flyersJson ? JSON.parse(flyersJson) : [];

    // ── Parse Zip Cost File ───────────────────────────────────────────────────
    // Expected columns: Zip Code, Cost Per Mailing
    const zipRows    = parseBuffer(await zipCostFile.arrayBuffer());
    const zipCostMap = new Map<string, number>(); // 5-digit zip → cost per mailing

    for (const row of zipRows) {
      const rawZip  = col(row,
        "Zip", "ZipCode", "Zip Code", "ZIP", "Zip_Code",
        "Postal Code", "PostalCode", "Zip/Postal", "Route"
      );
      const rawCost = col(row,
        "Cost", "Cost Per Mailing", "CostPerMailing", "Cost Per Drop",
        "CostPerDrop", "Amount", "Price", "Rate", "Postage", "Mail Cost",
        "Per Piece", "PerPiece", "Unit Cost"
      );
      const zip  = normalizeZip(rawZip);
      const cost = parseCurrency(rawCost);
      if (zip && cost > 0) zipCostMap.set(zip, cost);
    }

    if (zipCostMap.size === 0) {
      return NextResponse.json(
        { error: "No zip costs found in your Zip Cost file. Expected columns: 'Zip Code' and 'Cost Per Mailing'. Check your column names." },
        { status: 400 }
      );
    }

    // ── Parse Drop / Reps File ────────────────────────────────────────────────
    // Expected columns: Tracking Number, Drop (name), Zip Code(s), Times Mailed
    // Zip codes can be: one per row OR comma-separated in a single cell.
    const dropRows = parseBuffer(await dropRepsFile.arrayBuffer());

    // trackingDigits → zip → cumulative reps (handles multiple rows + multiple drops)
    const trackingZipRepsMap = new Map<string, Map<string, number>>();

    for (const row of dropRows) {
      const rawTracking = col(row,
        "Tracking Number", "TrackingNumber", "Tracking", "Tracking #",
        "Tracking No", "Phone", "Number", "Flyer", "Campaign"
      );
      const rawZips = col(row,
        "Zip", "ZipCode", "Zip Code", "Zip Codes", "ZipCodes",
        "Zips", "Postal Code", "Route Zips", "Routes"
      );
      const rawReps = col(row,
        "Times Mailed", "Reps", "Repetitions", "Times", "Count",
        "Mailings", "How Many Times", "Repeat", "Times Run", "Drops",
        "Mailed", "Quantity", "Qty", "Num Times", "Number of Times"
      );

      const trackingDigits = normalizeTracking(rawTracking);
      const reps           = parseInt(String(rawReps).replace(/\D/g, ""), 10) || 0;

      if (!trackingDigits || reps === 0) continue;

      // Parse zip codes — handles comma, semicolon, pipe, space, newline separated
      const zipTokens = rawZips.split(/[,;\|\s\n]+/).map(s => s.trim()).filter(Boolean);
      const zips = zipTokens.map(normalizeZip).filter(z => z.length >= 3);

      if (zips.length === 0) continue;

      if (!trackingZipRepsMap.has(trackingDigits)) {
        trackingZipRepsMap.set(trackingDigits, new Map());
      }
      const zipMap = trackingZipRepsMap.get(trackingDigits)!;
      for (const zip of zips) {
        zipMap.set(zip, (zipMap.get(zip) ?? 0) + reps);
      }
    }

    if (trackingZipRepsMap.size === 0) {
      return NextResponse.json(
        { error: "No drop/reps data found. Expected columns: 'Tracking Number', 'Zip Code', 'Times Mailed'. Check your column names." },
        { status: 400 }
      );
    }

    // ── Compute actual zip spends ─────────────────────────────────────────────
    const spendUpdates:    Record<string, number>                  = {};
    const zipSpendUpdates: Record<string, Record<string, number>>  = {};
    const summaryLines:    string[]                                 = [];
    let   matchedFlyers  = 0;
    let   totalMissingZips = 0;

    for (const [trackingDigits, zipRepsMap] of trackingZipRepsMap.entries()) {
      const flyer    = flyers.find(f => f.trackingNumber.replace(/\D/g, "") === trackingDigits);
      const flyerLabel = flyer?.flyerName || trackingDigits;

      const zipSpend:  Record<string, number> = {};
      let   flyerTotal = 0;
      let   missingCnt = 0;

      for (const [zip, reps] of zipRepsMap.entries()) {
        const cost = zipCostMap.get(zip);
        if (cost === undefined) { missingCnt++; totalMissingZips++; continue; }
        const actual = cost * reps;
        zipSpend[zip] = (zipSpend[zip] ?? 0) + actual;
        flyerTotal   += actual;
      }

      if (Object.keys(zipSpend).length > 0) {
        spendUpdates[trackingDigits]    = flyerTotal;
        zipSpendUpdates[trackingDigits] = zipSpend;
        if (flyer) matchedFlyers++;
        summaryLines.push(
          `${flyerLabel}: ${Object.keys(zipSpend).length} zips → $${flyerTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
          (missingCnt > 0 ? ` (${missingCnt} zip${missingCnt > 1 ? "s" : ""} had no cost data)` : "")
        );
      } else {
        summaryLines.push(`${flyerLabel}: no zip costs matched (${missingCnt} zip${missingCnt !== 1 ? "s" : ""} missing cost data)`);
      }
    }

    return NextResponse.json({
      spendUpdates,
      zipSpendUpdates,
      summaryLines,
      zipCostCount:  zipCostMap.size,
      matchedFlyers,
      totalMissingZips,
    });

  } catch (err) {
    console.error("[eddm-zip-spend]", err);
    return NextResponse.json(
      { error: "Failed to process files. Check that your files are valid CSV or Excel." },
      { status: 500 }
    );
  }
}
