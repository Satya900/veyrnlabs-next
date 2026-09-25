import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/crm"] },
    sitemap: isIndexable ? siteUrl("/sitemap.xml") : undefined,
  };
}
