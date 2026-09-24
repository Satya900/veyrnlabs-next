const configuredUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL || "https://veyrnlabs.com",
);

if (
  !["https:", "http:"].includes(configuredUrl.protocol) ||
  configuredUrl.username ||
  configuredUrl.password ||
  configuredUrl.pathname !== "/" ||
  configuredUrl.search ||
  configuredUrl.hash
) {
  throw new Error(
    "NEXT_PUBLIC_SITE_URL must be the site's HTTP(S) origin, without a path, credentials, query, or fragment.",
  );
}

export const site = {
  name: "Veyrn Labs",
  url: configuredUrl.origin,
  title: "Veyrn CRM | Real Estate Lead Management by Veyrn Labs",
  description:
    "A CRM for real estate teams. Organise property enquiries, client conversations, and follow-ups with Veyrn CRM. Explore Pro and Pro Plus plans and request onboarding.",
  email: "satyabrata@veyrnlabs.com",
  discoveryCallUrl: "https://calendar.app.google/wyhAbVw49rkcG3M78",
};

// Public production remains indexable. Preview deployments can be crawled
// to read noindex, rather than hiding the directive behind a robots block.
export const isIndexable =
  process.env.VERCEL_ENV !== "preview" && process.env.SITE_NOINDEX !== "true";

export function siteUrl(path = "/") {
  return new URL(path, `${site.url}/`).href;
}
