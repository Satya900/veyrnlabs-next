# Search Console readiness

The technical SEO changes in this repository need to be deployed before Google can see them. Localhost cannot be submitted for public indexing.

## Production configuration

Set NEXT_PUBLIC_SITE_URL to the final HTTPS origin, normally https://veyrnlabs.com. No path, query string, or fragment. The same origin supplies canonical, social metadata, structured data, and sitemap URLs.

Keep SITE_NOINDEX unset (or false) on production. Set SITE_NOINDEX=true on non-production public deployments. Vercel preview deployments automatically receive noindex. These values affect the build, so rebuild after changing them.

Configure the hosting provider to permanently redirect HTTP and the alternate hostname (www or non-www) to the chosen HTTPS origin. Canonical tags express a preference but do not configure DNS or redirects.

## What is implemented

- Matching split-V favicon: SVG, 96px PNG, multi-resolution ICO (16/32/48/64), and 180px Apple touch icon.
- Crawlable 512px organization logo and branded 1200×630 social preview.
- Descriptive page title and description, canonical URL, Open Graph, and Twitter metadata.
- Organization, WebSite, and WebPage JSON-LD, based on visible business information.
- Explicit production indexing directives; preview noindex support.
- Root robots.txt and sitemap.xml. This is one page, so the sitemap correctly contains one URL; section anchors are not separate pages.
- Main content is server rendered; FAQ and project details work without client JavaScript.
- Optional GOOGLE_SITE_VERIFICATION environment variable for the HTML verification method. Use only the content token, not the complete meta tag. Do not set a placeholder token.

No ranking guarantees, invented reviews, or unverified social profiles are included. SEO requires ongoing content and performance work after launch.

## Submit after deployment

1. Open Google Search Console and add a Domain property for veyrnlabs.com.
2. Add Google's exact DNS TXT record at the domain's DNS provider and complete verification. Domain verification covers protocols and subdomains. Keep the TXT record after verification.
3. Alternatively, use an HTTPS URL-prefix property and set GOOGLE_SITE_VERIFICATION to Google's supplied token, then rebuild and deploy before verifying.
4. Visit the production homepage, /robots.txt, /sitemap.xml, /favicon.ico, /icon1.png, and /opengraph-image. Confirm they are publicly reachable without authentication. The homepage should return 200; a nonexistent URL should return 404.
5. In the Sitemaps report, submit https://veyrnlabs.com/sitemap.xml (adjust if a different canonical domain is chosen).
6. Inspect the homepage URL, run Test Live URL, and request indexing once the live test succeeds.
7. Check structured data with Google's Rich Results Test or Schema Markup Validator.
8. Monitor Page Indexing, Sitemaps, and Core Web Vitals after Google has collected data.

Google decides when and whether a page is indexed or a favicon is shown. Live crawling, Search Console verification, domain redirects, and real-user Core Web Vitals cannot be established solely from a successful local build.

## Local checks

Run npm run lint and npm run build.
Start the production app with npm run start -- --port 3002.
Run node scripts/check-seo.mjs http://localhost:3002 https://veyrnlabs.com.
For a deployed audit, use the production origin as both arguments.
Regenerate icon sizes with node scripts/generate-brand-icons.mjs.

## Official references

Validation on 12 September 2026: lint and production build passed. The production-server SEO check passed for metadata, indexing directives, canonical URLs, JSON-LD, robots, sitemap, favicon resolutions, social image dimensions, and a real 404. The social preview was visually inspected. Public https://veyrnlabs.com returned ERR_NAME_NOT_RESOLVED in the browser; production accessibility and domain redirects remain unverified until DNS and deployment are ready.

- [Search Essentials](https://developers.google.com/search/docs/essentials)
- [Favicon requirements](https://developers.google.com/search/docs/appearance/favicon-in-search)
- [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [Site names](https://developers.google.com/search/docs/appearance/site-names)
- [Sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Ownership verification](https://support.google.com/webmasters/answer/9008080)
