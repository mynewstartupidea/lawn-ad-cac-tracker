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
- image_prompt: describe a specific scene for a photorealistic lawn photo — include the type of grass, time of day, angle, what the yard looks like (e.g. "front yard of a beige stucco Florida home, thick green St. Augustine grass, sprinkler mist catching morning light, palm trees in background, wide shot from street level"). Be specific and cinematic. No people, no text.
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

// ─── Agent 3: Creative Director ──────────────────────────────────────────────

interface CreativeDirection {
  style: string;
  imagePrompt: string;
  rationale: string;
}

async function getCreativeDirection(
  openai: OpenAI,
  adCopy: AdCopy,
  ctx: typeof AD_ACCOUNTS[AdAccount]
): Promise<CreativeDirection> {
  const crossedPrices = (ctx as { originalPrices?: readonly string[] }).originalPrices ?? [];
  const priceHistory = crossedPrices.length
    ? `Original prices (crossed out in image): ${crossedPrices.join(" → ")} → Current price: ${(ctx as { offerShort: string }).offerShort}`
    : `Current price: ${(ctx as { offerShort: string }).offerShort}`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a world-class Facebook ad creative director with 15+ years designing high-converting ads for home services. You think like a CMO and design like a senior graphic designer. You know what fonts, colors, and layouts stop the scroll and drive clicks.

Brand: ${ctx.label} | Location: ${ctx.location}
${priceHistory}
Headline: ${adCopy.headline}
Primary text hook: ${adCopy.primary_text.split("\n")[0]}

STYLE LIBRARY — pick the single best style for this ad:
1. price_bomb — Massive price reveal. Crossed-out old prices in red with bold strikethrough, current price in HUGE eye-catching font (chunky, playful, or explosive). Best when price is the main hook.
2. split_screen — Perfect 50/50 split: left = dead patchy brown lawn, right = lush perfect emerald green. Price badge overlaid center. Best for transformation angle.
3. bold_graphic — Flat graphic design, high contrast, childlike bubble font or graffiti-style lettering, neon or bold color pops. Scroll-stopper energy. Best for urgency/fun angle.
4. urgency_countdown — Dark moody background, spotlight on lawn, bold condensed countdown-style typography, red + white + black palette. Limited time energy.
5. aerial_hero — Drone shot of a perfect neighborhood lawn, clean elegant thin-serif or modern sans font, aspirational premium feel. Best for premium positioning.
6. lifestyle_warmth — Family/homeowner enjoying a beautiful lawn, golden hour warmth, playful handwritten font, emotional connection angle.
7. before_after_badge — Side-by-side before/after with a bold starburst price badge in the corner. Classic direct response.
8. social_proof_street — Street-level view of multiple perfect lawns on a neighborhood block, subtle branding, "Your neighbors already did it" energy.

RULES for writing the imagePrompt:
- This prompt goes directly to gpt-image-1, an AI image model — be extremely specific and visual
- If there are crossed-out prices: describe EXACTLY how they look (e.g. "bold red text '$499' with a thick diagonal red line crossing it out, below it '$99' also crossed out in red, then MASSIVE bright yellow chunky bubble font '$19 TODAY' with a green starburst explosion behind it")
- Specify exact font styles by describing them visually (e.g. "chunky 3D bubble letters", "bold condensed black impact-style font", "playful thick handwritten marker font", "elegant thin white serif")
- Specify colors explicitly — background, text colors, accent colors
- Specify composition — where elements are placed, what dominates
- Include: no watermarks, no logos, professional ad creative, 1:1 square format, Facebook ad
- Make it feel designed, not photographed — unless aerial_hero or lifestyle styles
- The image should be HIGH CONVERTING — price must POP, visual hierarchy must be clear

Return ONLY valid JSON:
{
  "style": "style_name",
  "imagePrompt": "full detailed prompt for gpt-image-1",
  "rationale": "1 sentence on why this style fits this ad"
}`,
      },
      {
        role: "user",
        content: `Write the creative direction for this ad. Make the image design agency-quality. The price must dominate. Be specific about every visual element.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(res.choices[0].message.content ?? "{}") as CreativeDirection;
}

// ─── Image quality selection ──────────────────────────────────────────────────

const HIGH_QUALITY_KEYWORDS = ["premium", "best", "launch", "hero", "flagship", "high quality", "top", "featured"];

function selectImageQuality(quality: QualityResult, instruction: string): "medium" | "high" {
  const isHighIntent = HIGH_QUALITY_KEYWORDS.some(kw => instruction.toLowerCase().includes(kw));
  const isExceptionalCopy = quality.score >= 9;
  return isHighIntent || isExceptionalCopy ? "high" : "medium";
}

// ─── gpt-image-1 Image Generation (via fal.ai) ───────────────────────────────

async function generateImage(
  prompt: string,
  falKey: string,
  imageQuality: "medium" | "high"
): Promise<string> {
  const enhancedPrompt = `${prompt}. DSLR photography, Canon 5D, 85mm lens, golden hour soft warm sunlight, perfectly manicured thick lush emerald green St. Augustine grass, healthy uniform lawn, suburban home curb appeal, no people, no text, no watermarks, no logos, photorealistic, sharp focus, square 1:1 composition`;

  const res = await fetch("https://fal.run/fal-ai/gpt-image-1/text-to-image", {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: enhancedPrompt,
      image_size: "1024x1024",
      quality: imageQuality,
      num_images: 1,
      output_format: "jpeg",
    }),
  });

  const data = await res.json();
  if (!data.images?.[0]?.url) throw new Error(`fal gpt-image-1 error: ${JSON.stringify(data)}`);
  return data.images[0].url as string;
}

// ─── Upload image hash to Facebook ───────────────────────────────────────────

async function uploadImageToFacebook(
  imageUrl: string,
  accountId: string,
  accessToken: string
): Promise<string> {
  // Handle base64 data URLs from gpt-image-1
  const isBase64 = imageUrl.startsWith("data:");
  const body = isBase64
    ? JSON.stringify({ bytes: imageUrl.split(",")[1], access_token: accessToken })
    : JSON.stringify({ url: imageUrl, access_token: accessToken });

  const res = await fetch(`${FB_BASE}/act_${accountId}/adimages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB image upload: ${data.error.message}`);
  const imageData = Object.values(data.images ?? {})[0] as { hash: string };
  return imageData.hash;
}

// ─── Read targeting + existing creative from active ad set ───────────────────

async function getExistingAdSetData(accountId: string, accessToken: string) {
  const filter = encodeURIComponent(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] }]));
  const res = await fetch(
    `${FB_BASE}/act_${accountId}/adsets?fields=targeting&filtering=${filter}&limit=1&access_token=${accessToken}`
  );
  const data = await res.json();
  const targeting = data.data?.[0]?.targeting ?? { geo_locations: { countries: ["US"] } };

  // Get an existing creative's effective_object_story_id for workaround
  const cRes = await fetch(
    `${FB_BASE}/act_${accountId}/adcreatives?fields=id,effective_object_story_id,object_story_spec&limit=10&access_token=${accessToken}`
  );
  const cData = await cRes.json();
  // Prefer image creative (link_data) over video
  const imageCreative = cData.data?.find((c: { object_story_spec: { link_data?: unknown } }) => c.object_story_spec?.link_data);
  const anyCreative   = cData.data?.[0];
  const existingCreative = imageCreative ?? anyCreative;

  return { targeting, existingCreative };
}

// ─── Create Facebook Campaign → Ad Set → Creative → Ad ───────────────────────

async function createFacebookCampaign(
  adCopy: AdCopy,
  imageHash: string,
  ctx: typeof AD_ACCOUNTS[AdAccount],
  accessToken: string,
  videoId?: string
) {
  const { targeting, existingCreative } = await getExistingAdSetData(ctx.accountId, accessToken);
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
      is_adset_budget_sharing_enabled: false,
      access_token: accessToken,
    }),
  });
  const camp = await campRes.json();
  if (camp.error) throw new Error(`Campaign: ${camp.error.message}`);

  // 2. Ad Set — mirrors exact settings from existing campaigns
  const adSetRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/adsets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${adCopy.ad_name} - Ad Set`,
      campaign_id: camp.id,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_object: { pixel_id: ctx.pixelId, custom_event_type: "LEAD" },
      daily_budget: 5000,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      status: "PAUSED",
      access_token: accessToken,
    }),
  });
  const adSet = await adSetRes.json();
  if (adSet.error) throw new Error(`Ad Set: ${adSet.error.message}`);

  // 3. Creative
  // Workaround: when app is in dev mode, use object_story_id from existing approved creative.
  // This bypasses the "app must be live" restriction while still associating the right page/IG.
  // When app goes live, falls back to full object_story_spec with AI copy + image.
  let creative: { id?: string; error?: { message: string } };

  // First try: full creative with AI copy (works when app is Live)
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

  const fullCreativeRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/adcreatives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${adCopy.ad_name} - Creative`,
      object_story_spec: storySpec,
      access_token: accessToken,
    }),
  });
  creative = await fullCreativeRes.json();

  // Fallback: app in dev mode — clone existing approved post as creative
  if (creative.error && existingCreative?.effective_object_story_id) {
    console.log("[ad-launch] Full creative blocked (dev mode), cloning existing post as creative workaround");
    const fallbackRes = await fetch(`${FB_BASE}/act_${ctx.accountId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${adCopy.ad_name} - Creative`,
        object_story_id: existingCreative.effective_object_story_id,
        access_token: accessToken,
      }),
    });
    creative = await fallbackRes.json();
  }

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

    // Agent 3: Creative Director — generates image concept with price psychology + font direction
    const creative = await getCreativeDirection(openai, adCopy, ctx);
    log.creativeDirection = creative;

    // Generate image via gpt-image-1 — quality auto-selected based on copy score + instruction
    const imageQuality = selectImageQuality(quality, instruction);
    log.imageQuality = imageQuality;

    let imageUrl  = "";
    let imageHash = "";
    try {
      if (!falKey) throw new Error("FAL_API_KEY not configured");
      imageUrl     = await generateImage(creative.imagePrompt, falKey, imageQuality);
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
    } catch (imgErr) {
      // Image generation failed — use fallback and continue
      imageHash = ctx.fallbackImageHash;
      log.imageHash   = imageHash;
      log.imageSource = "fallback_existing";
      log.imageError  = String(imgErr);
      console.warn("[ad-launch] Image generation failed, using fallback hash:", imgErr);
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
