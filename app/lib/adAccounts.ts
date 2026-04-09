// Canonical account context — used by both the chat and ad-launch routes

export const AD_ACCOUNTS = {
  florida: {
    accountId:       "435459903489885",
    pageId:          "1860398430899950",
    instagramUserId: "17841406994453363",
    offer:           "$99 (normally $499) — 6-in-1 lawn treatment covering weeds, fungus, thinning grass, bare areas, and overall lawn health in one visit",
    offerShort:      "$99",
    originalPrices:  ["$499"],
    landingUrl:      "https://www.liquid-lawn.com/weedcontrol-page-2265-8509-8171-7080-6878-4998?utm_content={{ad.name}}",
    cta:             "LEARN_MORE",
    location:        "Florida",
    label:           "Liquid Lawn Florida",
    fallbackImageHash: "2310b876955b9ebbcf5d4adce07c733d",
    pixelId:           "1755980881367417",
  },
  georgia: {
    accountId:       "1467364857363196",
    pageId:          "1860398430899950",
    instagramUserId: "17841406994453363",
    offer:           "$19 first lawn treatment — professional weed control and lawn care service",
    offerShort:      "$19",
    originalPrices:  ["$499", "$99"],
    landingUrl:      "https://www.liquid-lawn.com/georgiapage?utm_content={{ad.name}}",
    cta:             "GET_OFFER_VIEW",
    location:        "Georgia",
    label:           "Liquid Lawn Georgia",
    fallbackImageHash: "685c0408f252f3ead5e2aabde65e3735",
    pixelId:           "642251691534776",
  },
} as const;

export type AdAccount = keyof typeof AD_ACCOUNTS;
