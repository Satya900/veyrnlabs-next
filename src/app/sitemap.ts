import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // A one-page site has one canonical page; section fragments are not pages.
  return isIndexable ? [{ url: siteUrl() }] : [];
}
