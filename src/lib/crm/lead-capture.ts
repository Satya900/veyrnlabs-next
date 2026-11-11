// Turns an enquiry from any source (our hosted form, a website form, or a Zapier / Pabbly /
// Make webhook carrying Facebook Lead Ads, Google Ads or portal fields) into lead fields.
// Field names are matched loosely ("Full Name", "full_name" and "fullName" are the same), and
// anything unrecognised is kept in the notes so custom form questions aren't lost.

export type Enquiry = {
  name: string;
  phone: string;
  email: string;
  lookingFor: string;
  budget: number | null;
  notes: string;
  source: string;
  /** A filled honeypot field: a bot, so nothing is saved. */
  spam: boolean;
};

const ALIASES: Record<string, string[]> = {
  name: ["name", "fullname", "yourname", "customername", "leadname", "contactname"],
  first: ["firstname", "fname", "givenname"],
  last: ["lastname", "lname", "surname", "familyname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "whatsapp", "whatsappnumber", "contact", "contactnumber", "contactno", "tel", "telephone", "cell"],
  email: ["email", "emailaddress", "emailid", "mail"],
  lookingFor: ["lookingfor", "requirement", "requirements", "property", "propertytype", "project", "projectname", "service", "interestedin", "interest", "configuration", "bhk", "unittype"],
  budget: ["budget", "budgetrange", "price", "pricerange", "yourbudget"],
  location: ["location", "city", "area", "locality", "preferredlocation", "preferredarea"],
  message: ["message", "notes", "note", "comments", "comment", "enquiry", "inquiry", "query", "details", "description"],
  source: ["source", "leadsource", "utmsource", "platform", "channel"],
  campaign: ["campaign", "campaignname", "utmcampaign", "formname", "adname", "adsetname"],
  honeypot: ["website", "gotcha", "botfield", "hpfield"],
  ignore: ["consent", "redirect", "token", "submit", "createdtime", "id", "leadid", "formid", "adid", "pageid"],
};
const FIELD = new Map<string, string>();
for (const [field, names] of Object.entries(ALIASES)) for (const n of names) FIELD.set(n, field);

const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (v: unknown, max: number) =>
  (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * "80 lakh", "80L", "1.2 Cr", "₹75,00,000", "60-80 lakhs" → rupees (the higher end of a range).
 * Null when there's no number in it.
 */
export function parseBudget(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "");
  const unit = /\b(cr|crore|crores)\b|\d\s*cr\b/.test(t)
    ? 1e7
    : /\b(l|lac|lacs|lakh|lakhs)\b|\d\s*(l|lac|lakh)\b/.test(t)
      ? 1e5
      : /\d\s*k\b/.test(t)
        ? 1e3
        : 1;
  const numbers = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (!numbers.length) return null;
  const rupees = Math.round(Math.max(...numbers) * unit);
  return rupees >= 1 && rupees <= 1e12 ? rupees : null;
}

export function parseEnquiry(input: Record<string, unknown>, fallbackSource = ""): Enquiry {
  const found: Record<string, string> = {};
  const extra: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    // Zapier's Facebook Lead Ads step can send answers as [{name, values: [...]}].
    if (rawKey === "field_data" && Array.isArray(rawValue)) {
      for (const item of rawValue as { name?: unknown; values?: unknown }[]) {
        if (typeof item?.name === "string") parseOne(item.name, item.values, found, extra);
      }
      continue;
    }
    parseOne(rawKey, rawValue, found, extra);
  }
  const name = found.name || [found.first, found.last].filter(Boolean).join(" ");
  const location = found.location ? `Location: ${found.location}` : "";
  const campaign = found.campaign ? `Campaign: ${found.campaign}` : "";
  const budgetText = found.budget ?? "";
  return {
    name: clean(name, 200),
    phone: clean(found.phone, 40),
    email: clean(found.email, 200).toLowerCase(),
    lookingFor: clean(found.lookingFor, 200),
    budget: budgetText ? parseBudget(budgetText) : null,
    notes: [found.message, location, budgetText ? `Budget: ${budgetText}` : "", campaign, ...extra]
      .filter(Boolean)
      .join("\n")
      .slice(0, 5000),
    source: clean(found.source || fallbackSource, 100),
    spam: Boolean(found.honeypot),
  };
}

function parseOne(rawKey: string, rawValue: unknown, found: Record<string, string>, extra: string[]) {
  const value = clean(Array.isArray(rawValue) ? rawValue.join(", ") : rawValue, 1000);
  if (!value) return;
  const field = FIELD.get(key(rawKey));
  if (field === "ignore") return;
  if (field && !found[field]) found[field] = value;
  else if (!field && extra.length < 20 && rawKey.length <= 100) extra.push(`${rawKey.replace(/_/g, " ")}: ${value}`);
}
