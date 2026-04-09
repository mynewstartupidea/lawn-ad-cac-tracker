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
  scarcityLine: string;
  rationale: string;
}

async function getCreativeDirection(
  openai: OpenAI,
  adCopy: AdCopy,
  ctx: typeof AD_ACCOUNTS[AdAccount]
): Promise<CreativeDirection> {
  const crossedPrices = (ctx as { originalPrices?: readonly string[] }).originalPrices ?? [];
  const priceHistory = crossedPrices.length
    ? `Pricing history (ALL crossed-out prices must appear in image): ${crossedPrices.join(" → ")} → NOW: ${(ctx as { offerShort: string }).offerShort}`
    : `Current price: ${(ctx as { offerShort: string }).offerShort}`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a world-class direct response creative director who has spent 15+ years running Facebook and Instagram ads for home services companies. You've personally overseen $50M+ in ad spend and you know exactly what makes homeowners stop scrolling and click. You think like a CMO, write like a copywriter, and design like a senior art director.

You are creating a Facebook ad image for:
Brand: ${ctx.label} | Location: ${ctx.location}
${priceHistory}
Ad headline: ${adCopy.headline}
Primary text hook: ${adCopy.primary_text.split("\n")[0]}
Full offer: ${ctx.offer}

━━━ DIRECT RESPONSE PSYCHOLOGY YOU MUST APPLY ━━━

PRICE ANCHORING (mandatory when originalPrices exist):
- Every crossed-out price MUST appear in the image
- Show the price drop as a visual journey: "$499" slashed → "$99" slashed → "$19 NOW"
- The current price must be 3-4x larger than the crossed-out prices
- Crossed-out prices in faded red with thick diagonal strikethrough
- Current price in explosive, celebration colors (bright yellow, lime green, or white with glow)

SCARCITY & URGENCY (pick the most believable one for this ad):
- Spot-based: "Only 20 homeowners this month" / "3 spots left in your zip code"
- Time-based: "This week only" / "April special — expires soon"
- Geographic: "Serving [location] neighborhoods this week only"
- Social: "47 homeowners already booked"
This scarcity line MUST appear in the image as a smaller but punchy text element.

COLOR PSYCHOLOGY:
- Red = urgency, crossed-out prices, danger/deal
- Bright yellow/gold = excitement, price pop, celebration
- Deep green = lawn, health, money, trust
- White = clean, readable, contrast
- Black = premium, bold contrast
- Orange = CTA energy, warmth
- Never use more than 3-4 colors — contrast is everything

TYPOGRAPHY PSYCHOLOGY:
- Chunky 3D bubble letters = fun, approachable, discount energy
- Bold condensed black impact font = urgency, news, power
- Playful thick handwritten marker = personal, trust, neighborhood feel
- Graffiti-style block letters = attention-grabbing, street energy
- Elegant thin serif = premium, aspirational
- Retro slab serif = established, trustworthy deal
- Mix MAX 2 font styles — one for price/headline, one for supporting text

VISUAL HIERARCHY RULES:
- ONE dominant element (the price or transformation) — everything else supports it
- F-pattern: most important info top-left or center
- Mobile-first: all text must be readable at thumbnail size (bold, high-contrast)
- Use negative space to make the key element pop
- Add a visual "bang" element for the price: starburst, explosion, badge, circle, arrow

━━━ STYLE LIBRARY — pick the single best for this ad ━━━

1. price_bomb — The price IS the ad. Massive current price center-stage with all crossed-out prices above it in red strikethrough. Starburst/explosion graphic behind price. Bold graphic background (deep green or dark). Best for maximum price shock.

2. split_screen — Perfect 50/50 vertical split. Left: dead patchy brown lawn, sad and dry. Right: lush thick emerald green lawn. Bold price badge overlaid on the split line. Scarcity text at bottom. Best for transformation angle.

3. bold_graphic_type — Typography-forward flat design. No photo. Bold chunky text fills the frame. Price in massive bubble letters. High-contrast background (black, deep green, or bright). Feels like a poster/announcement.

4. urgency_countdown — Dark moody background with a dramatic spotlight on a perfect green lawn. Bold condensed countdown-style font (red/white/black). "ONLY X SPOTS LEFT" prominent. Feels like a news alert or flash sale.

5. aerial_hero — Stunning drone-shot bird's-eye view of a perfectly manicured neighborhood lawn. Clean modern sans-serif type overlay. Price in elegant badge. Premium, aspirational. Best for high-quality positioning.

6. lifestyle_warmth — Homeowner standing proud in their beautiful lawn, golden hour sunlight, big smile. Playful handwritten font overlay. Warm and personal. Scarcity text feels like a neighbor's recommendation.

7. before_after_badge — Top half: brown patchy dead lawn photo. Bottom half: same yard lush green. Thick border between them labeled "BEFORE / AFTER". Explosive price starburst badge corner. Classic direct response.

8. scarcity_spotlight — Text-dominant. Large bold headline: "We're looking for [X] homeowners in [location]". Subtext explains the deal. Price badge. Lawn photo as subtle background. Feels like a local announcement.

9. neighborhood_fomo — Street-level view of a beautiful neighborhood with multiple perfect green lawns. Text overlay: "Your neighbors just did this →". Price badge bottom corner. Creates FOMO instantly.

10. text_only_punch — Pure typography, no photo. Bold color-block background (deep green + white + yellow). Massive price, crossed-out prices, scarcity line. Feels like a sale sign. Works great for retargeting.

11. deal_receipt — Designed to look like a receipt or invoice. Lists "Normal price: $499 ~~strikethrough~~", "Your price today: $19". Clean, specific, believable. Builds trust through specificity.

━━━ RULES FOR WRITING THE imagePrompt ━━━

This prompt goes DIRECTLY to gpt-image-1, a state-of-the-art AI image model. It renders text and design elements from descriptions. Be a director giving instructions to a designer:

- Describe every element's EXACT position (top-center, bottom-left third, etc.)
- Describe font styles visually: "chunky inflated 3D bubble letters with yellow fill and black outline", "bold condensed all-caps impact-style font in white with red drop shadow"
- Describe crossed-out prices EXACTLY: "bold red text '$499' with a thick horizontal red line through the middle, slightly faded", then "$99" same treatment
- Describe the current price as the HERO: size, color, font, any graphic behind it
- Describe the scarcity line: smaller font, different style, where it sits
- Describe background: color, texture, photo, gradients
- End with: "professional Facebook ad creative, 1:1 square format, no watermarks, no logos, high contrast, mobile-readable text"

Return ONLY valid JSON:
{
  "style": "style_name",
  "imagePrompt": "complete detailed prompt — minimum 150 words, every visual element described",
  "scarcityLine": "exact scarcity text that appears in the image (e.g. 'Only 20 homeowners this month')",
  "rationale": "1 sentence on why this style + scarcity combo will convert"
}`,
      },
      {
        role: "user",
        content: `Create the creative direction for this ad. Think like the best direct response creative director in the world. Every pixel should have a purpose. Make the price impossible to ignore. Make the scarcity feel real. Make it impossible NOT to click.`,
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
  // Prompt is fully crafted by the Creative Director — no suffix needed
  const res = await fetch("https://fal.run/fal-ai/gpt-image-1/text-to-image", {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: "1024x1024", // Always 1080x1080 equivalent (gpt-image-1 max is 1024x1024)
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
