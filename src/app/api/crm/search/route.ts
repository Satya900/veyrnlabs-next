import { session } from "@/lib/crm/server";

const LEAD_COLUMNS = ["name", "company", "email", "phone"] as const;
const CLIENT_COLUMNS = ["name", "company", "email"] as const;

function dedupe<T extends { id: string }>(rows: T[], limit: number) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export async function GET(request: Request) {
  const auth = await session();
  if (!auth)
    return Response.json({ error: "Please sign in to continue." }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2)
    return Response.json(
      { leads: [], clients: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  const pattern = `%${q.slice(0, 200)}%`;
  const [leadResults, clientResults] = await Promise.all([
    Promise.all(
      LEAD_COLUMNS.map((col) =>
        auth.db
          .from("crm_leads")
          .select("id,name,company,email,phone")
          .ilike(col, pattern)
          .order("created_at", { ascending: false })
          .limit(8),
      ),
    ),
    Promise.all(
      CLIENT_COLUMNS.map((col) =>
        auth.db
          .from("crm_clients")
          .select("id,name,company,email")
          .ilike(col, pattern)
          .order("created_at", { ascending: false })
          .limit(8),
      ),
    ),
  ]);
  if (leadResults.some((r) => r.error) || clientResults.some((r) => r.error))
    return Response.json({ error: "Search is unavailable right now." }, { status: 503 });
  return Response.json(
    {
      leads: dedupe(leadResults.flatMap((r) => r.data ?? []), 8),
      clients: dedupe(clientResults.flatMap((r) => r.data ?? []), 8),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
