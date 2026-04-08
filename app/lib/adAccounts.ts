// Canonical account context — used by both the chat and ad-launch routes

export const AD_ACCOUNTS = {
  florida: {
    accountId:       "435459903489885",
    pageId:          "1860398430899950",
    instagramUserId: "17841406994453363",
    offer:           "$99 (normally $499) — 6-in-1 lawn treatment covering weeds, fungus, thinning grass, bare areas, and overall lawn health in one visit",
    offerShort:      "$99",
    landingUrl:      "https://www.liquid-lawn.com/weedcontrol-page-2265-8509-8171-7080-6878-4998?utm_content={{ad.name}}",
    cta:             "LEARN_MORE",
    location:        "Florida",
    label:           "Liquid Lawn Florida",
  },
  georgia: {
    accountId:       "1467364857363196",
    pageId:          "1860398430899950",
    instagramUserId: "17841406994453363",
    offer:           "$19 first lawn treatment — professional weed control and lawn care service",
    offerShort:      "$19",
    landingUrl:      "https://www.liquid-lawn.com/georgiapage?utm_content={{ad.name}}",
    cta:             "GET_OFFER_VIEW",
    location:        "Georgia",
    label:           "Liquid Lawn Georgia",
  },
} as const;

export type AdAccount = keyof typeof AD_ACCOUNTS;
