import { createHash } from "crypto";

const FB_BASE = "https://graph.facebook.com/v25.0";

// SHA-256 hash as required by Meta for PII fields
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashEmail(email: string): string {
  return sha256(email.toLowerCase().trim());
}

function hashPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  // Meta requires E.164 — prepend US country code if we have a bare 10-digit number
  if (digits.length === 10) digits = "1" + digits;
  return sha256(digits);
}

interface CapiEventOptions {
  pixelId:         string;
  email:           string;
  phone?:          string;
  value:           number;
  currency?:       string;
  eventTime?:      number;
  eventSourceUrl?: string;
}

export async function sendSoldConversion(opts: CapiEventOptions): Promise<{ ok: boolean; error?: string }> {
  // Use dedicated CAPI token if available, fall back to main access token
  const accessToken = process.env.FACEBOOK_CAPI_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!accessToken) return { ok: false, error: "No access token" };

  const eventTime = opts.eventTime ?? Math.floor(Date.now() / 1000);

  const userData: Record<string, unknown> = {
    em: [hashEmail(opts.email)],
  };
  if (opts.phone) {
    userData.ph = [hashPhone(opts.phone)];
  }

  // event_id deduplicates against any browser pixel Purchase events for the same user
  const eventId = sha256(`${opts.email}-${eventTime}-${opts.pixelId}`);

  const payload = {
    data: [
      {
        event_name:       "Purchase",
        event_time:       eventTime,
        event_id:         eventId,
        action_source:    "website",
        event_source_url: "https://www.liquid-lawn.com",
        custom_data: {
          lead_event_source: "Liquid Lawn CRM",
          value:             opts.value,
          currency:          opts.currency ?? "USD",
        },
        user_data: userData,
      },
    ],
  };

  const url = `${FB_BASE}/${opts.pixelId}/events?access_token=${accessToken}`;
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  const json = await res.json() as { events_received?: number; error?: { message: string } };

  if (json.error) {
    console.error(`[CAPI] Error for pixel ${opts.pixelId}:`, json.error.message);
    return { ok: false, error: json.error.message };
  }

  console.log(`[CAPI] Sent to pixel ${opts.pixelId} — events_received: ${json.events_received}`);
  return { ok: true };
}
