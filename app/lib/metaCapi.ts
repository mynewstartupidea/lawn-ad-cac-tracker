import { createHash } from "crypto";

const FB_BASE = "https://graph.facebook.com/v25.0";

// Each pixel can have its own token: a CAPI token generated in Events Manager
// only has access to the dataset it was created for.
export const PIXELS = {
  FBFL: {
    label:     "Florida",
    pixelId:   "1755980881367417",
    tokenEnv:  "META_CAPI_TOKEN_FL",
    sourceUrl: "https://www.liquid-lawn.com/weedcontrol-page-2265-8509-8171-7080-6878-4998",
    value:     99,
  },
  FBGA: {
    label:     "Georgia",
    pixelId:   "642251691534776",
    tokenEnv:  "META_CAPI_TOKEN_GA",
    sourceUrl: "https://www.liquid-lawn.com/georgiapage",
    value:     19,
  },
  FBMIAMI: {
    label:     "Miami",
    pixelId:   "950249787818613",
    tokenEnv:  "META_CAPI_TOKEN_MIAMI",
    sourceUrl: "https://www.liquid-lawn.com/lawncareforms-6164-3952-9459-2110",
    value:     99,
  },
} as const;

export type FbSource = keyof typeof PIXELS;

export function isFbSource(source: string | null | undefined): source is FbSource {
  return !!source && source in PIXELS;
}

export interface CapiUser {
  email:      string;
  phone?:     string | null;
  firstName?: string | null;
  zip?:       string | null;
  fbclid?:    string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildUserData(u: CapiUser, eventTimeSec: number): Record<string, unknown> {
  const email = u.email.toLowerCase().trim();
  const userData: Record<string, unknown> = {
    em:          [sha256(email)],
    external_id: [sha256(email)],
    country:     [sha256("us")],
  };

  let digits = (u.phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  if (digits.length >= 11) userData.ph = [sha256(digits)];

  const fn = (u.firstName ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  if (fn && fn !== "unknown") userData.fn = [sha256(fn)];

  const zip = (u.zip ?? "").trim().match(/^\d{5}/)?.[0];
  if (zip) userData.zp = [sha256(zip)];

  // fbc format is fb.1.<click time ms>.<fbclid>; Meta does not hash it
  if (u.fbclid) userData.fbc = `fb.1.${eventTimeSec * 1000}.${u.fbclid}`;

  return userData;
}

async function sendEvent(
  source: FbSource,
  event: { event_name: "Lead" | "Purchase"; event_id: string; event_time: number; custom_data?: Record<string, unknown> },
  user: CapiUser,
): Promise<{ ok: boolean; error?: string }> {
  const pixel = PIXELS[source];
  const token = process.env[pixel.tokenEnv] || (source === "FBFL" ? process.env.FACEBOOK_CAPI_TOKEN : undefined);
  if (!token) {
    console.warn(`[CAPI] ${event.event_name} skipped for ${pixel.label}: ${pixel.tokenEnv} not set`);
    return { ok: false, error: `${pixel.tokenEnv} not set` };
  }

  const payload: Record<string, unknown> = {
    data: [{
      ...event,
      action_source:    "website",
      event_source_url: pixel.sourceUrl,
      user_data:        buildUserData(user, event.event_time),
    }],
  };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const res = await fetch(`${FB_BASE}/${pixel.pixelId}/events`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(payload),
    });
    const json = await res.json() as { events_received?: number; error?: { message: string } };
    if (json.error) {
      console.error(`[CAPI] ${event.event_name} → ${pixel.label} failed:`, json.error.message);
      return { ok: false, error: json.error.message };
    }
    console.log(`[CAPI] ${event.event_name} → ${pixel.label} ok (events_received: ${json.events_received})`);
    return { ok: true };
  } catch (err) {
    console.error(`[CAPI] ${event.event_name} → ${pixel.label} network error:`, err);
    return { ok: false, error: String(err) };
  }
}

export async function sendLeadEvent(source: FbSource, user: CapiUser, eventTimeSec?: number) {
  const now = Math.floor(Date.now() / 1000);
  const eventTime = Math.min(eventTimeSec ?? now, now);
  // Meta rejects website events older than 7 days
  if (now - eventTime > 7 * 86400) {
    console.log(`[CAPI] Lead skipped for ${user.email}: contact created over 7 days ago`);
    return { ok: false, error: "older than 7 days" };
  }
  return sendEvent(source, {
    event_name: "Lead",
    event_id:   sha256(`lead-${user.email.toLowerCase().trim()}`),
    event_time: eventTime,
  }, user);
}

export function sendPurchaseEvent(source: FbSource, user: CapiUser) {
  return sendEvent(source, {
    event_name:  "Purchase",
    event_id:    sha256(`purchase-${user.email.toLowerCase().trim()}`),
    event_time:  Math.floor(Date.now() / 1000),
    custom_data: { value: PIXELS[source].value, currency: "USD", lead_event_source: "Liquid Lawn CRM" },
  }, user);
}
