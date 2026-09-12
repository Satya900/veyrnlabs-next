const configuredUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL || "https://veyrnlabs.com",
);

if (
  !["https:", "http:"].includes(configuredUrl.protocol) ||
  configuredUrl.username || configuredUrl.password ||
  configuredUrl.pathname !== "/" || configuredUrl.search || configuredUrl.hash
) {
  throw new Error("NEXT_PUBLIC_SITE_URL must be the site's HTTP(S) origin, without a path, credentials, query, or fragment.");
}

export const site = {
  name: "Veyrn Labs",
  url: configuredUrl.origin,
  title: "Veyrn Labs | AI Engineering & Custom Software",
  description: "AI agents, custom business software, and workflow automation. Veyrn Labs connects your operations with systems engineered and verified before delivery.",
  email: "hello@veyrnlabs.com",
};

// Public production remains indexable. Preview deployments can be crawled
// to read noindex, rather than hiding the directive behind a robots block.
export const isIndexable = process.env.VERCEL_ENV !== "preview" &&
  process.env.SITE_NOINDEX !== "true";

export function siteUrl(path = "/") {
  return new URL(path, `${site.url}/`).href;
}
