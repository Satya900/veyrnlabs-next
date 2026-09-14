import { jsonBody, sameOrigin, session } from "@/lib/crm/server";
import { validateLead } from "@/lib/crm/model";

export async function GET() {
  const auth = await session();
  if (!auth)
    return Response.json(
      { error: "Please sign in to continue." },
      { status: 401 },
    );
  const names = [
    "leads",
    "clients",
    "tasks",
    "activities",
    "stages",
    "members",
  ] as const;
  const data: Record<string, unknown> = { user: auth.member };
  for (const name of names) {
    // Page through PostgREST's default row limit so reports/exports do not silently truncate.
    const rows: unknown[] = [];
    let offset = 0;
    while (true) {
      const result = await auth.db
        .from(`crm_${name}`)
        .select("*")
        .order("id")
        .range(offset, offset + 499);
      if (result.error)
        return Response.json(
          {
            error:
              "Unable to load the workspace. Check the database migration and connection.",
          },
          { status: 503 },
        );
      rows.push(...result.data);
      if (result.data.length < 500) break;
      offset += 500;
    }
    data[name] = rows;
  }
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth)
    return Response.json(
      {
        error:
          "Your session has expired. Sign in again; your unsaved form is still open.",
      },
      { status: 401 },
    );
  try {
    const body = await jsonBody(request, 3_000_000);
    const { action, id } = body;
    if (
      id !== undefined &&
      (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    )
      throw new Error("Invalid record identifier.");
    let result;
    if (action === "saveLead" || action === "import") {
      const inputs = action === "import" ? body.rows : [body.lead];
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 500)
        throw new Error("Provide between 1 and 500 leads.");
      const { data: stages } = await auth.db
        .from("crm_stages")
        .select("id")
        .eq("kind", "open")
        .order("position")
        .limit(1);
      const rows = inputs.map((input) => {
        if (!input || typeof input !== "object")
          throw new Error("Invalid lead.");
        return {
          ...validateLead(input),
          stage_id: input.stage_id || stages?.[0]?.id,
          owner_id:
            auth.member.role === "team"
              ? auth.member.id
              : input.owner_id || null,
        };
      });
      result = id
        ? await auth.db
            .from("crm_leads")
            .update(rows[0])
            .eq("id", id)
            .select("id")
            .single()
        : await auth.db.from("crm_leads").insert(rows).select("id");
    } else if (action === "stage") {
      if (typeof body.stage_id !== "string") throw new Error("Choose a stage.");
      result = await auth.db
        .from("crm_leads")
        .update({ stage_id: body.stage_id })
        .eq("id", id)
        .select("id")
        .single();
    } else if (action === "convert") {
      result = await auth.db.rpc("crm_convert_lead", { lead: id });
    } else if (action === "activity") {
      if (
        typeof body.body !== "string" ||
        !body.body.trim() ||
        body.body.length > 5000 ||
        !["note", "call", "meeting"].includes(String(body.kind))
      )
        throw new Error(
          "Enter a note, call, or meeting summary (up to 5,000 characters).",
        );
      result = await auth.db
        .from("crm_activities")
        .insert({ lead_id: id, body: body.body.trim(), kind: body.kind });
    } else if (action === "task") {
      if (
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.length > 300 ||
        typeof body.due_at !== "string" ||
        !Number.isFinite(Date.parse(body.due_at))
      )
        throw new Error("Enter a task title and valid due date.");
      result = await auth.db
        .from("crm_tasks")
        .insert({ lead_id: id, title: body.title.trim(), due_at: body.due_at });
    } else if (action === "completeTask") {
      if (typeof body.completed !== "boolean")
        throw new Error("Invalid task status.");
      result = await auth.db
        .from("crm_tasks")
        .update({ completed: body.completed })
        .eq("id", id)
        .select("id")
        .single();
    } else if (action === "saveStage") {
      if (auth.member.role === "team")
        return Response.json(
          { error: "Only owners and admins can configure stages." },
          { status: 403 },
        );
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 60 ||
        !Number.isInteger(body.position) ||
        Number(body.position) < 0 ||
        Number(body.position) > 1000
      )
        throw new Error("Enter a stage name and position between 0 and 1000.");
      result = id
        ? await auth.db
            .from("crm_stages")
            .update({ name: body.name.trim(), position: body.position })
            .eq("id", id)
            .select("id")
            .single()
        : await auth.db
            .from("crm_stages")
            .insert({
              name: body.name.trim(),
              position: body.position,
              kind: "open",
            });
    } else throw new Error("Unknown action.");
    if (result.error)
      return Response.json(
        {
          error:
            "Could not save this change. Check access, duplicate records, and whether this lead is already converted.",
        },
        { status: 400 },
      );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save." },
      { status: 400 },
    );
  }
}
