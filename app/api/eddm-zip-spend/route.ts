import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const maxDuration = 60;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Extracts drop key from strings like "Drop 1", "Drop 2.5", "Drop 2.5 - zipcodes" */
function normalizeDrop(raw: string): string {
  const match = String(raw).match(/drop\s*(\d+(?:\.\d+)?)/i);
  return match ? `drop${match[1]}` : "";
}

/** Get raw rows as arrays (picks sheet with most rows) */
function parseRawRows(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  let bestSheet = wb.Sheets[wb.SheetNames[0]];
  let bestCount = 0;
  for (const name of wb.SheetNames) {
    const ws   = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (rows.length > bestCount) { bestCount = rows.length; bestSheet = ws; }
  }
  return XLSX.utils.sheet_to_json<unknown[]>(bestSheet, { header: 1, defval: "" });
}

/** Find first column index matching any candidate (case-insensitive, strips spaces/dashes) */
function findColIdx(headerRow: unknown[], ...candidates: string[]): number {
  for (let j = 0; j < headerRow.length; j++) {
    const cell = String(headerRow[j] ?? "").toLowerCase().replace(/[\s_\-]/g, "");
    for (const c of candidates) {
      if (cell.includes(c.toLowerCase().replace(/[\s_\-]/g, ""))) return j;
    }
  }
  return -1;
}

/**
 * Auto-detect whether a file is File 1 (flat spend table) or File 2 (sectioned zip costs).
 *
 * File 1 signature: has a header row (within first 10 rows) with BOTH "tracking" AND "drop" columns,
 *   AND no section-header rows (rows where a single cell contains "drop" + "zip" together).
 *
 * File 2 signature: contains at least one section-header row matching "Drop N Zipcode" pattern.
 */
function detectFileType(rows: unknown[][]): "spend" | "zipcost" | "unknown" {
  let hasSectionHeader = false;
  let hasTrackingAndDropCols = false;

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    const joined = row.map(c => String(c ?? "").trim()).join(" ").toLowerCase();

    // Section header: "Drop 1 Zipcode", "Drop 2 zipcodes", "Drop 2.5 - zipcodes"
    if (/drop\s*\d/.test(joined) && /zip/i.test(joined)) {
      hasSectionHeader = true;
      break;
    }

    // Flat spend table header
    if (!hasTrackingAndDropCols && i < 10) {
      const hasTracking = findColIdx(row, "tracking") >= 0;
      const hasDrop     = findColIdx(row, "drop") >= 0;
      if (hasTracking && hasDrop) hasTrackingAndDropCols = true;
    }
  }

  if (hasSectionHeader) return "zipcost";
  if (hasTrackingAndDropCols) return "spend";
  return "unknown";
}

// ─── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const formData   = await req.formData();
    const fileA      = formData.get("spendFile") as File | null;
    const fileB      = formData.get("zipFile")   as File | null;
    const flyersJson = formData.get("flyers")    as string | null;

    if (!fileA || !fileB) {
      return NextResponse.json(
        { error: "Both files are required: Spend/Drop file and Zip Cost file." },
        { status: 400 }
      );
    }

    // Reject image files with a clear message
    const imageTypes = ["image/", "video/"];
    for (const [label, file] of [["File 1", fileA], ["File 2", fileB]] as [string, File][]) {
      if (imageTypes.some(t => file.type.startsWith(t)) || /\.(png|jpg|jpeg|gif|webp|bmp|svg|heic)$/i.test(file.name)) {
        return NextResponse.json(
          { error: `${label} is an image (${file.name}). Upload the actual CSV or Excel file here. To extract data from screenshots, use the Chat instead.` },
          { status: 400 }
        );
      }
    }

    const flyers: Array<{ flyerName: string; trackingNumber: string }> =
      flyersJson ? JSON.parse(flyersJson) : [];

    // ── Auto-detect which file is which ───────────────────────────────────────
    const rowsA = parseRawRows(await fileA.arrayBuffer());
    const rowsB = parseRawRows(await fileB.arrayBuffer());

    const typeA = detectFileType(rowsA);
    const typeB = detectFileType(rowsB);

    let spendRows: unknown[][];
    let zipRows:   unknown[][];

    if (typeA === "spend" && typeB === "zipcost") {
      spendRows = rowsA; zipRows = rowsB;
    } else if (typeA === "zipcost" && typeB === "spend") {
      spendRows = rowsB; zipRows = rowsA; // swapped — user put them in wrong slots, no problem
    } else if (typeA === "spend" && typeB === "spend") {
      return NextResponse.json({ error: "Both files look like spend/drop tables. One should be the zip cost file with 'Drop N Zipcode' section headers." }, { status: 400 });
    } else if (typeA === "zipcost" && typeB === "zipcost") {
      return NextResponse.json({ error: "Both files look like zip cost files. One should be the flat spend table with Tracking Number and Drop columns." }, { status: 400 });
    } else {
      // One or both unknown — try best guess (A=spend, B=zipcost) and let the parser fail gracefully
      spendRows = rowsA; zipRows = rowsB;
    }

    // ── Parse spend file: flat table (Amount Spent | Tracking Number | Drop) ──
    // Each row = one mailing event. Rep count per (tracking, drop) = number of matching rows.
    // Total spend per tracking = sum of all Amount Spent for that tracking.
    let spendHeaderIdx = -1;
    let amtCol = -1, trackingCol = -1, dropCol = -1;

    for (let i = 0; i < Math.min(spendRows.length, 10); i++) {
      const row = spendRows[i];
      const t = findColIdx(row, "tracking");
      const d = findColIdx(row, "drop");
      if (t >= 0 && d >= 0) {
        spendHeaderIdx = i;
        trackingCol = t;
        dropCol     = d;
        amtCol      = findColIdx(row, "amount", "spend", "cost", "price");
        break;
      }
    }

    if (spendHeaderIdx === -1) {
      return NextResponse.json(
        { error: "Could not find header row in Spend file. Expected columns: 'Amount Spent', 'Tracking Number', 'Drop'." },
        { status: 400 }
      );
    }

    // trackingDigits → { totalSpend, drops: Map<dropKey, repCount> }
    const trackingMap = new Map<string, { totalSpend: number; drops: Map<string, number> }>();

    for (let i = spendHeaderIdx + 1; i < spendRows.length; i++) {
      const row      = spendRows[i];
      const tracking = normalizeTracking(String(row[trackingCol] ?? "").trim());
      const dropKey  = normalizeDrop(String(row[dropCol] ?? "").trim());
      const amt      = amtCol >= 0 ? parseCurrency(String(row[amtCol] ?? "")) : 0;

      if (!tracking || !dropKey) continue;

      if (!trackingMap.has(tracking)) {
        trackingMap.set(tracking, { totalSpend: 0, drops: new Map() });
      }
      const entry = trackingMap.get(tracking)!;
      entry.totalSpend += amt;
      // Count rows per (tracking, drop) → rep count
      entry.drops.set(dropKey, (entry.drops.get(dropKey) ?? 0) + 1);
    }

    if (trackingMap.size === 0) {
      return NextResponse.json(
        { error: "No data found in Spend file. Check column names: 'Tracking Number', 'Drop', 'Amount Spent'." },
        { status: 400 }
      );
    }

    // ── Parse zip cost file: sectioned by drop ────────────────────────────────
    // Structure:
    //   "Drop 1 Zipcode"       ← section header
    //   Zip | Pieces | Amount  ← column header row
    //   32259 | 28569 | $9,142 ← data rows
    //   ...
    //   "Drop 2 zipcodes"      ← next section header
    //
    // dropKey → zip → cost per one mailing of that drop
    const dropZipCostMap = new Map<string, Map<string, number>>();

    let currentDropKey: string | null = null;
    let zipCol2 = -1, amtCol2 = -1;
    let expectingColHeader = false;

    for (const row of zipRows) {
      const nonEmpty = row.map(c => String(c ?? "").trim()).filter(Boolean);
      if (nonEmpty.length === 0) continue;

      const rowStr  = nonEmpty.join(" ").toLowerCase();
      const dropKey = normalizeDrop(rowStr);
      const hasZip  = /zip/i.test(rowStr);

      // Section header row: "Drop 1 Zipcode", "Drop 2.5 - zipcodes", etc.
      if (dropKey && hasZip) {
        currentDropKey      = dropKey;
        expectingColHeader  = true;
        zipCol2 = -1; amtCol2 = -1;
        if (!dropZipCostMap.has(currentDropKey)) {
          dropZipCostMap.set(currentDropKey, new Map());
        }
        continue;
      }

      // First non-empty row after a section header = column names (Zip | Pieces | Amount)
      if (expectingColHeader && currentDropKey) {
        zipCol2 = findColIdx(row, "zip", "zipcode", "route", "postal");
        amtCol2 = findColIdx(row, "amount", "cost", "spend", "price", "rate");
        expectingColHeader = false;
        continue;
      }

      // Data rows within current section
      if (currentDropKey && zipCol2 >= 0 && amtCol2 >= 0) {
        const zip = normalizeZip(String(row[zipCol2] ?? "").trim());
        const amt = parseCurrency(String(row[amtCol2] ?? ""));
        if (zip && amt > 0) {
          dropZipCostMap.get(currentDropKey)!.set(zip, amt);
        }
      }
    }

    if (dropZipCostMap.size === 0) {
      return NextResponse.json(
        { error: "No zip cost sections found. Expected sections like 'Drop 1 Zipcode' with 'Zip' and 'Amount' columns." },
        { status: 400 }
      );
    }

    // ── Compute spend per tracking and per zip ────────────────────────────────
    const spendUpdates:    Record<string, number>                 = {};
    const zipSpendUpdates: Record<string, Record<string, number>> = {};
    const summaryLines:    string[]                               = [];
    let   flyersUpdated = 0;

    for (const [tracking, { totalSpend, drops }] of trackingMap.entries()) {
      const flyer = flyers.find(f => f.trackingNumber.replace(/\D/g, "") === tracking);
      const label = flyer?.flyerName || tracking;

      // Total spend = sum of all Amount Spent rows for this tracking (File 1, authoritative)
      spendUpdates[tracking] = totalSpend;
      if (flyer) flyersUpdated++;

      // Zip breakdown:
      // For each drop this tracking participated in, multiply each zip's amount × rep count
      const zipSpend:    Record<string, number> = {};
      const missingDrops: string[]              = [];

      for (const [dropKey, repCount] of drops.entries()) {
        const zipCosts = dropZipCostMap.get(dropKey);
        if (!zipCosts) { missingDrops.push(dropKey); continue; }
        for (const [zip, costPerMailing] of zipCosts.entries()) {
          zipSpend[zip] = (zipSpend[zip] ?? 0) + costPerMailing * repCount;
        }
      }

      if (Object.keys(zipSpend).length > 0) {
        zipSpendUpdates[tracking] = zipSpend;
      }

      const zipTotal = Object.values(zipSpend).reduce((s, v) => s + v, 0);
      const zipCount = Object.keys(zipSpend).length;

      let line = `${label}: $${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total`;
      if (zipCount > 0) {
        line += `, ${zipCount} zips (zip sum $${zipTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }
      if (missingDrops.length > 0) {
        line += ` — no zip data for: ${missingDrops.join(", ")}`;
      }
      summaryLines.push(line);
    }

    return NextResponse.json({
      spendUpdates,
      zipSpendUpdates,
      summaryLines,
      trackingCount: trackingMap.size,
      dropSections:  dropZipCostMap.size,
      flyersUpdated,
    });

  } catch (err) {
    console.error("[eddm-zip-spend]", err);
    return NextResponse.json(
      { error: "Failed to process files. Check that your files are valid CSV or Excel." },
      { status: 500 }
    );
  }
}
