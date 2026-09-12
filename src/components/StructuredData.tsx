import { site, siteUrl } from "@/lib/site";

export function StructuredData() {
  const organizationId = siteUrl("/#organization");
  const websiteId = siteUrl("/#website");
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: site.name,
        url: siteUrl(),
        description: site.description,
        email: site.email,
        logo: {
          "@type": "ImageObject",
          url: siteUrl("/brand/veyrn-mark-512.png"),
          width: 512,
          height: 512,
        },
        address: { "@type": "PostalAddress", addressLocality: "Bengaluru", addressCountry: "IN" },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: site.name,
        url: siteUrl(),
        publisher: { "@id": organizationId },
        inLanguage: "en-IN",
      },
      {
        "@type": "WebPage",
        "@id": siteUrl("/#webpage"),
        url: siteUrl(),
        name: site.title,
        description: site.description,
        isPartOf: { "@id": websiteId },
        about: { "@id": organizationId },
        inLanguage: "en-IN",
      },
    ],
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
