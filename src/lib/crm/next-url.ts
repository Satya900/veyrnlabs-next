/** Only ever follow a same-site /crm path from a `next` param; never an absolute or protocol-relative URL. */
export function safeNextUrl(value: string | null, fallback = "/crm") {
  if (!value || !value.startsWith("/crm") || value.startsWith("//")) return fallback;
  return value;
}
