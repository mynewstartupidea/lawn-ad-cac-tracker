import { createSign } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
}

export interface DriveAdMatch {
  file: DriveFile;
  launched: boolean;
  fbAdName?: string;
  matchScore: number;
}

// ── Google service account auth (no extra npm packages) ────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const now        = Math.floor(Date.now() / 1000);

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const header  = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode({
    iss:   email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now,
  });

  const signingInput = `${header}.${payload}`;
  const signer       = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(privateKey, "base64url");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  `${signingInput}.${signature}`,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token as string;
}

// ── List files in a Drive folder ───────────────────────────────────────────

async function fetchDriveFiles(folderId: string, token: string): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q:        `'${folderId}' in parents and trashed = false`,
      fields:   "nextPageToken,files(id,name,mimeType,createdTime)",
      pageSize: "200",
      orderBy:  "createdTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res  = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error.message ?? "Google Drive API error");

    allFiles.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

// ── Fuzzy matching ─────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(mp4|mov|avi|mkv|jpg|jpeg|png|gif|webp|pdf|psd|ai|svg|doc|docx|txt|zip|rar)$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(w => w.length > 2));
}

function jaccardScore(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union        = new Set([...wa, ...wb]).size;
  return intersection / union;
}

function findBestFbMatch(fileName: string, fbNames: string[]): { fbName?: string; score: number } {
  let bestScore = 0;
  let bestName: string | undefined;

  for (const fbName of fbNames) {
    const score = jaccardScore(fileName, fbName);
    if (score > bestScore) { bestScore = score; bestName = fbName; }
  }

  return bestScore >= 0.25 ? { fbName: bestName, score: bestScore } : { score: bestScore };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    return NextResponse.json(
      { error: "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are not set in Vercel environment variables." },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const folderId = searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "No folderId provided." }, { status: 400 });
  }

  try {
    const [token, fbAdsResult] = await Promise.all([
      getGoogleAccessToken(),
      supabase.from("ad_spends").select("ad_name").eq("source", "facebook"),
    ]);

    const driveFiles = await fetchDriveFiles(folderId, token);
    const fbAdNames: string[] = (fbAdsResult.data ?? []).map(r => r.ad_name as string);

    const matches: DriveAdMatch[] = driveFiles.map(file => {
      const { fbName, score } = findBestFbMatch(file.name, fbAdNames);
      return { file, launched: !!fbName, fbAdName: fbName, matchScore: Math.round(score * 100) };
    });

    const launched    = matches.filter(m => m.launched).length;
    const notLaunched = matches.length - launched;

    return NextResponse.json({ matches, summary: { total: matches.length, launched, notLaunched } });
  } catch (err) {
    console.error("[drive-ads]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
