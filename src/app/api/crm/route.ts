import { jsonBody, loadWorkspace, sameOrigin, session } from "@/lib/crm/server";
import { validateLead } from "@/lib/crm/model";
import type { WorkspaceChanges } from "@/lib/crm/workspace";

export async function GET() {
  const auth = await session();
  if (!auth)
    return Response.json(
      { error: "Please sign in to continue." },
      { status: 401 },
    );
  try {
    const data = await loadWorkspace(auth);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Unable to load the workspace. Check the database migration and connection.",
      },
      { status: 503 },
    );
  }
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
    let changes: WorkspaceChanges = {};
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
            .select("*")
            .single()
        : await auth.db.from("crm_leads").insert(rows).select("*");
      if (!result.error) {
        const leads = action === "import" ? result.data : [result.data];
        changes = { leads };
        // Import can insert up to 500 rows; fetching each one's "Lead
        // created" activity individually isn't worth the round trips, so
        // only fetch it for the common single-lead case.
        if (action === "saveLead") {
          const { data: activity } = await auth.db
            .from("crm_activities")
            .select("*")
            .eq("lead_id", result.data.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          if (activity) changes.activities = [activity];
        }
      }
    } else if (action === "stage") {
      if (typeof body.stage_id !== "string") throw new Error("Choose a stage.");
      result = await auth.db
        .from("crm_leads")
        .update({ stage_id: body.stage_id })
        .eq("id", id)
        .select("*")
        .single();
      if (!result.error) {
        const { data: activity } = await auth.db
          .from("crm_activities")
          .select("*")
          .eq("lead_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        changes = { leads: [result.data], activities: activity ? [activity] : [] };
      }
    } else if (action === "bulkStage") {
      if (
        !Array.isArray(body.ids) ||
        body.ids.length < 1 ||
        body.ids.length > 200 ||
        body.ids.some(
          (leadId: unknown) =>
            typeof leadId !== "string" || !/^[0-9a-f-]{36}$/i.test(leadId),
        )
      )
        throw new Error("Select between 1 and 200 leads.");
      if (typeof body.stage_id !== "string") throw new Error("Choose a stage.");
      result = await auth.db
        .from("crm_leads")
        .update({ stage_id: body.stage_id })
        .in("id", body.ids)
        .select("*");
      if (!result.error) {
        const { data: activities } = await auth.db
          .from("crm_activities")
          .select("*")
          .in("lead_id", body.ids);
        changes = { leads: result.data, activities: activities ?? [] };
      }
    } else if (action === "convert") {
      result = await auth.db.rpc("crm_convert_lead", { lead: id });
      if (!result.error) {
        const [{ data: client }, { data: lead }, { data: activities }] = await Promise.all([
          auth.db.from("crm_clients").select("*").eq("id", result.data).single(),
          auth.db.from("crm_leads").select("*").eq("id", id).single(),
          auth.db
            .from("crm_activities")
            .select("*")
            .eq("lead_id", id)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        changes = {
          clients: client ? [client] : [],
          leads: lead ? [lead] : [],
          activities: activities ?? [],
        };
      }
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
        .insert({ lead_id: id, body: body.body.trim(), kind: body.kind })
        .select("*")
        .single();
      if (!result.error) changes = { activities: [result.data] };
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
        .insert({ lead_id: id, title: body.title.trim(), due_at: body.due_at })
        .select("*")
        .single();
      if (!result.error) changes = { tasks: [result.data] };
    } else if (action === "completeTask") {
      if (typeof body.completed !== "boolean")
        throw new Error("Invalid task status.");
      result = await auth.db
        .from("crm_tasks")
        .update({ completed: body.completed })
        .eq("id", id)
        .select("*")
        .single();
      if (!result.error) changes = { tasks: [result.data] };
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
            .select("*")
            .single()
        : await auth.db
            .from("crm_stages")
            .insert({
              name: body.name.trim(),
              position: body.position,
              kind: "open",
            })
            .select("*")
            .single();
      if (!result.error) changes = { stages: [result.data] };
    } else if (action === "saveView") {
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 60 ||
        typeof body.search !== "string" ||
        typeof body.source !== "string" ||
        typeof body.owner !== "string"
      )
        throw new Error("Enter a name for this view.");
      result = await auth.db
        .from("crm_saved_views")
        .insert({
          member_id: auth.member.id,
          name: body.name.trim(),
          search: body.search.slice(0, 200),
          source: body.source.slice(0, 200),
          owner: body.owner.slice(0, 200),
        })
        .select("*")
        .single();
      if (!result.error) changes = { saved_views: [result.data] };
    } else if (action === "deleteView") {
      if (typeof id !== "string") throw new Error("Missing saved view id.");
      result = await auth.db.from("crm_saved_views").delete().eq("id", id);
      if (!result.error) changes = { deleted_saved_views: [id] };
    } else throw new Error("Unknown action.");
    if (result.error)
      return Response.json(
        {
          error:
            "Could not save this change. Check access, duplicate records, and whether this lead is already converted.",
        },
        { status: 400 },
      );
    return Response.json({ ok: true, changes });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save." },
      { status: 400 },
    );
  }
}
