import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // The home page is a single canonical page; section fragments are not pages.
  return isIndexable
    ? [{ url: siteUrl() }, { url: siteUrl("/privacy") }, { url: siteUrl("/terms") }]
    : [];
}
