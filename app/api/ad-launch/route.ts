import { NextResponse } from "next/server";
import OpenAI from "openai";
import { AD_ACCOUNTS, AdAccount } from "../../lib/adAccounts";

const FB_BASE = "https://graph.facebook.com/v21.0";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdCopy {
  primary_text: string;
  headline: string;
  description: string;
  image_prompt: string;
  ad_name: string;
}

interface QualityCheck {
  name: string;
  pass: boolean;
  note: string;
}

interface QualityResult {
  pass: boolean;
  score: number;
  checks: QualityCheck[];
  feedback: string;
  suggestions: string;
}

// ─── Agent 1: Ad Copy Generator ──────────────────────────────────────────────

async function generateAdCopy(
  openai: OpenAI,
  instruction: string,
  ctx: typeof AD_ACCOUNTS[AdAccount],
  feedback?: string
): Promise<AdCopy> {
  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are an expert Facebook/Instagram ad copywriter for Liquid Lawn, a professional lawn care company in ${ctx.location}.

Current offer: ${ctx.offer}
Landing page: ${ctx.landingUrl}
Brand: ${ctx.label}

Rules:
- Write scroll-stopping copy that speaks to homeowners embarrassed by their lawn
- Use short punchy sentences. No fluff. Create urgency
- The exact offer price (${ctx.offerShort}) MUST appear in the primary text
- Headline should be under 40 characters, punchy and curiosity-driven
- Primary text should have a strong hook in the first line, then a pain point, then the solution, then the offer, then urgency
- image_prompt: describe a realistic photo of a beautiful healthy green lawn in ${ctx.location} for a Facebook ad
- ad_name format: "AI Ad ${today} - [short descriptor]"

Return ONLY valid JSON with exactly these fields:
{
  "primary_text": "...",
  "headline": "...",
  "description": "...",
  "image_prompt": "...",
  "ad_name": "..."
}`,
      },
      {
        role: "user",
        content: feedback
          ? `Instruction: ${instruction}\n\nPrevious version was rejected. QC feedback:\n${feedback}\n\nRevise the ad to fix these issues.`
          : instruction,
      },
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(res.choices[0].message.content ?? "{}") as AdCopy;
}

// ─── Agent 2: Quality Checker ─────────────────────────────────────────────────

async function runQualityCheck(
  openai: OpenAI,
  adCopy: AdCopy,
  ctx: typeof AD_ACCOUNTS[AdAccount]
): Promise<QualityResult> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a senior performance marketer with 10+ years running Facebook ads for home services and lawn care companies. You review ads before they go live. You are strict, direct, and think like a CMO.

Brand: ${ctx.label} | Location: ${ctx.location} | Offer: ${ctx.offer}

You check each of these criteria independently:
1. Spelling & Grammar — zero tolerance for any errors
2. Offer Accuracy — the exact offer (${ctx.offerShort}) must be clearly stated
3. Headline Quality — punchy, creates curiosity or urgency, professional, max 40 chars ideal
4. Primary Text Hook — does the first line stop the scroll?
5. Pain Point & Solution — does it address why a homeowner's lawn looks bad and how we fix it?
6. Brand Fit — sounds like a professional lawn care company, not spammy or aggressive
7. CTA Alignment — does the copy naturally lead to clicking?

Overall pass = ALL 7 checks pass. If any fail, overall is false.

Return ONLY valid JSON:
{
  "pass": true|false,
  "score": 1-10,
  "checks": [
    { "name": "Spelling & Grammar", "pass": true|false, "note": "brief note" },
    { "name": "Offer Accuracy", "pass": true|false, "note": "brief note" },
    { "name": "Headline Quality", "pass": true|false, "note": "brief note" },
    { "name": "Primary Text Hook", "pass": true|false, "note": "brief note" },
    { "name": "Pain Point & Solution", "pass": true|false, "note": "brief note" },
    { "name": "Brand Fit", "pass": true|false, "note": "brief note" },
    { "name": "CTA Alignment", "pass": true|false, "note": "brief note" }
  ],
  "feedback": "Concise actionable feedback for copywriter if anything failed",
  "suggestions": "Specific improvement suggestions"
}`,
      },
      {
        role: "user",
        content: `Review this ad:

Headline: ${adCopy.headline}
Primary Text: ${adCopy.primary_text}
Description: ${adCopy.description}
Ad Name: ${adCopy.ad_name}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(res.choices[0].message.content ?? "{}") as QualityResult;
}

// ─── fal.ai Image Generation ──────────────────────────────────────────────────

async function generateImage(prompt: string, falKey: string): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: `${prompt}. Professional real estate style photography, bright natural sunlight, lush healthy green grass, high resolution, Facebook ad, no text overlays.`,
      image_size: "landscape_16_9",
      num_images: 1,
      num_inference_steps: 4,
    }),
  });

  const data = await res.json();
  if (!data.images?.[0]?.url) throw new Error(`fal.ai error: ${JSON.stringify(data)}`);
  return data.images[0].url as string;
}

// ─── Upload image hash to Facebook ───────────────────────────────────────────

async function uploadImageToFacebook(
  imageUrl: string,
  accountId: string,
  accessToken: string
): Promise<string> {
  const res = await fetch(`${FB_BASE}/act_${accountId}/adimages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: imageUrl, access_token: accessToken }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB image upload: ${data.error.message}`);
  const imageData = Object.values(data.images ?? {})[0] as { hash: string };
  return imageData.hash;
}

// ─── Read targeting from existing active ad set ───────────────────────────────

async function getExistingTargeting(accountId: string, accessToken: string) {
  const res = await fetch(
    `${FB_BASE}/act_${accountId}/adsets?fields=targeting&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&limit=1&access_token=${accessToken}`
  );
  const data = await res.json();
  return data.data?.[0]?.targeting ?? { geo_locations: { countries: ["US"] } };
}

// ─── Create Facebook Campaign → Ad Set → Creative → Ad ───────────────────────

async function createFacebookCampaign(
  adCopy: AdCopy,
  imageHash: string,
  ctx: typeof AD_ACCOUNTS[AdAccount],
  accessToken: string,
  videoId?: string
) {
  const targeting = await getExistingTargeting(ctx.accountId, accessToken);
  const landingUrl = ctx.landingUrl.replace("{{ad.name}}", encodeURIComponent(adCopy.ad_name));

  // 1. Campaign
  const campRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: adCopy.ad_name,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: [],
      access_token: accessToken,
    }),
  });
  const camp = await campRes.json();
  if (camp.error) throw new Error(`Campaign: ${camp.error.message}`);

  // 2. Ad Set
  const adSetRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/adsets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${adCopy.ad_name} - Ad Set`,
      campaign_id: camp.id,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LANDING_PAGE_VIEWS",
      daily_budget: 5000,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      status: "PAUSED",
      access_token: accessToken,
    }),
  });
  const adSet = await adSetRes.json();
  if (adSet.error) throw new Error(`Ad Set: ${adSet.error.message}`);

  // 3. Creative — video if videoId provided, image otherwise
  const storySpec = videoId
    ? {
        page_id: ctx.pageId,
        instagram_user_id: ctx.instagramUserId,
        video_data: {
          video_id: videoId,
          message: adCopy.primary_text,
          title: adCopy.headline,
          link_description: adCopy.description,
          image_hash: imageHash,
          call_to_action: { type: ctx.cta, value: { link: landingUrl } },
        },
      }
    : {
        page_id: ctx.pageId,
        instagram_user_id: ctx.instagramUserId,
        link_data: {
          image_hash: imageHash,
          link: landingUrl,
          message: adCopy.primary_text,
          name: adCopy.headline,
          description: adCopy.description,
          call_to_action: { type: ctx.cta },
        },
      };

  const creativeRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/adcreatives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${adCopy.ad_name} - Creative`,
      object_story_spec: storySpec,
      access_token: accessToken,
    }),
  });
  const creative = await creativeRes.json();
  if (creative.error) throw new Error(`Creative: ${creative.error.message}`);

  // 4. Ad
  const adRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/ads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: adCopy.ad_name,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: "PAUSED",
      access_token: accessToken,
    }),
  });
  const ad = await adRes.json();
  if (ad.error) throw new Error(`Ad: ${ad.error.message}`);

  return { campaignId: camp.id, adSetId: adSet.id, creativeId: creative.id, adId: ad.id };
}

// ─── Main Route ───────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const fbToken   = process.env.FACEBOOK_ACCESS_TOKEN;
  const falKey    = process.env.FAL_API_KEY;

  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 400 });
  if (!fbToken)   return NextResponse.json({ error: "FACEBOOK_ACCESS_TOKEN not configured" }, { status: 400 });

  const { instruction, account = "florida", videoId } = await req.json() as {
    instruction: string;
    account: AdAccount;
    videoId?: string;
  };

  const ctx = AD_ACCOUNTS[account];
  if (!ctx) return NextResponse.json({ error: "Invalid account" }, { status: 400 });

  const openai = new OpenAI({ apiKey: openaiKey });
  const log: Record<string, unknown> = { account, instruction };

  // Quality passes if: all checks pass OR score >= 7 and critical checks (spelling + offer) pass
  function isQualityGood(q: QualityResult): boolean {
    if (q.pass) return true;
    if (q.score < 7) return false;
    const critical = ["Spelling & Grammar", "Offer Accuracy"];
    return critical.every(name => q.checks.find(c => c.name === name)?.pass === true);
  }

  try {
    // Round 1: generate copy
    let adCopy = await generateAdCopy(openai, instruction, ctx);
    let quality = await runQualityCheck(openai, adCopy, ctx);
    log.rounds = [{ round: 1, adCopy, quality }];

    // Round 2: if quality not good enough, revise once
    if (!isQualityGood(quality)) {
      adCopy  = await generateAdCopy(openai, instruction, ctx, quality.feedback);
      quality = await runQualityCheck(openai, adCopy, ctx);
      (log.rounds as unknown[]).push({ round: 2, adCopy, quality });
    }

    log.finalAdCopy  = adCopy;
    log.finalQuality = quality;
    log.qualityGood  = isQualityGood(quality);

    // Generate image
    let imageUrl  = "";
    let imageHash = "";
    if (falKey) {
      imageUrl     = await generateImage(adCopy.image_prompt, falKey);
      log.imageUrl = imageUrl;
      // Try uploading AI image to Facebook
      try {
        imageHash     = await uploadImageToFacebook(imageUrl, ctx.accountId, fbToken);
        log.imageHash = imageHash;
        log.imageSource = "ai_generated";
      } catch (uploadErr) {
        // Fall back to existing approved image hash — campaign still launches
        imageHash = ctx.fallbackImageHash;
        log.imageHash       = imageHash;
        log.imageSource     = "fallback_existing";
        log.imageUploadNote = "AI image generated but FB upload needs Advanced Access — used existing approved image. AI preview available in imageUrl.";
        console.warn("[ad-launch] FB image upload failed, using fallback hash:", uploadErr);
      }
    } else {
      // No fal key — use fallback
      imageHash = ctx.fallbackImageHash;
      log.imageHash   = imageHash;
      log.imageSource = "fallback_existing";
    }

    // Create campaign (starts PAUSED for review)
    if (isQualityGood(quality) && imageHash) {
      const campaign = await createFacebookCampaign(adCopy, imageHash, ctx, fbToken, videoId);
      log.campaign = campaign;
      log.status   = "created_paused";
    } else {
      log.status = "quality_failed";
    }

    return NextResponse.json({ success: true, ...log });
  } catch (err) {
    console.error("[ad-launch]", err);
    return NextResponse.json({ success: false, error: String(err), ...log }, { status: 500 });
  }
}
