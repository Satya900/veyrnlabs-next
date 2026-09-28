import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // The home page is a single canonical page; section fragments are not pages.
  // lastModified tracks each page's own content, updated by hand when that content changes.
  return isIndexable
    ? [
        {
          url: siteUrl(),
          lastModified: "2026-09-28",
          changeFrequency: "weekly",
          priority: 1,
        },
        {
          url: siteUrl("/product/real-estate-crm"),
          lastModified: "2026-09-22",
          changeFrequency: "weekly",
          priority: 0.8,
        },
        {
          url: siteUrl("/product/real-estate-crm-software"),
          lastModified: "2026-09-28",
          changeFrequency: "weekly",
          priority: 0.8,
        },
        {
          url: siteUrl("/privacy"),
          lastModified: "2026-09-26",
          changeFrequency: "monthly",
          priority: 0.3,
        },
        {
          url: siteUrl("/terms"),
          lastModified: "2026-09-26",
          changeFrequency: "monthly",
          priority: 0.3,
        },
      ]
    : [];
}
