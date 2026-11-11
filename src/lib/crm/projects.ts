// Projects & brochures: validation shared by the API, plus how a stored file becomes the public
// link WhatsApp fetches. No environment reads except the Supabase URL passed in.
import { parseBudget } from "./lead-capture.ts";

export const PROJECT_STATUSES = ["upcoming", "launched", "under_construction", "ready", "sold_out"] as const;
export const AVAILABILITY = ["available", "few_left", "sold_out"] as const;
export const FILE_KINDS = ["brochure", "floor_plan", "price_sheet", "photo", "other"] as const;
export const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const FILES_BUCKET = "crm-files";

export type Project = {
  id: string;
  name: string;
  location: string;
  developer: string;
  status: (typeof PROJECT_STATUSES)[number];
  possession: string;
  rera: string;
  description: string;
  amenities: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
export type ProjectUnit = {
  id?: string;
  project_id?: string;
  name: string;
  size: string;
  price_min: number | null;
  price_max: number | null;
  availability: (typeof AVAILABILITY)[number];
  position?: number;
};
export type ProjectFile = {
  id: string;
  project_id: string;
  kind: (typeof FILE_KINDS)[number];
  name: string;
  mime: string;
  size_bytes: number;
  created_at: string;
  url: string;
};

const text = (value: unknown, label: string, max: number, required = false) => {
  if (value != null && typeof value !== "string") throw new Error(`Invalid ${label}.`);
  const v = (value ?? "").trim();
  if (required && !v) throw new Error(`Enter the ${label}.`);
  if (v.length > max) throw new Error(`Keep the ${label} under ${max} characters.`);
  return v;
};
const oneOf = <T extends readonly string[]>(value: unknown, options: T, fallback: T[number]): T[number] =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T[number]) : fallback;

export function validateProject(input: Record<string, unknown>) {
  return {
    name: text(input.name, "project name", 120, true),
    location: text(input.location, "location", 200),
    developer: text(input.developer, "developer", 120),
    status: oneOf(input.status, PROJECT_STATUSES, "launched"),
    possession: text(input.possession, "possession date", 60),
    rera: text(input.rera, "RERA number", 80),
    description: text(input.description, "description", 3000),
    amenities: text(input.amenities, "amenities", 1000),
  };
}

/** A price typed as "85 L", "1.2 Cr", "8500000" or a number; empty means "on request". */
export function priceValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseBudget(String(value));
  if (n == null || !Number.isFinite(n) || n < 1 || n > 1e12) throw new Error(`Couldn't read the price "${value}".`);
  return Math.round(n);
}

export function validateUnits(input: unknown): ProjectUnit[] {
  if (!Array.isArray(input) || input.length > 30) throw new Error("A project can have up to 30 unit types.");
  return input.map((raw, position) => {
    const u = (raw ?? {}) as Record<string, unknown>;
    let priceMin = priceValue(u.price_min);
    let priceMax = priceValue(u.price_max);
    if (priceMin != null && priceMax != null && priceMax < priceMin) [priceMin, priceMax] = [priceMax, priceMin];
    return {
      name: text(u.name, "unit type", 60, true),
      size: text(u.size, "size", 60),
      price_min: priceMin,
      price_max: priceMax,
      availability: oneOf(u.availability, AVAILABILITY, "available"),
      position,
    };
  });
}

/** "Lakeside Brochure (Final).pdf" → "lakeside-brochure-final.pdf" with a random prefix. */
export function storagePath(org: string, project: string, fileName: string, mime: string) {
  const ext = FILE_TYPES[mime];
  if (!ext) throw new Error("Upload a PDF, JPG, PNG or WebP file.");
  const base =
    fileName
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "file";
  return `${org}/${project}/${crypto.randomUUID().slice(0, 8)}-${base}.${ext}`;
}

export const publicFileUrl = (supabaseUrl: string, path: string) =>
  `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${FILES_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

/** 4500000 → "45 L", 12500000 → "1.25 Cr" (matches the database's crm_inr_short). */
export function inrShort(amount: number) {
  const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, "");
  if (amount >= 1e7) return `${trim(amount / 1e7)} Cr`;
  if (amount >= 1e5) return `${trim(amount / 1e5)} L`;
  return amount.toLocaleString("en-IN");
}
export function priceRange(u: Pick<ProjectUnit, "price_min" | "price_max">) {
  if (u.price_min != null && u.price_max != null && u.price_max > u.price_min)
    return `₹${inrShort(u.price_min)}–${inrShort(u.price_max)}`;
  const one = u.price_min ?? u.price_max;
  return one != null ? `₹${inrShort(one)}` : "Price on request";
}
