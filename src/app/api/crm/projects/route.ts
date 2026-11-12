import { jsonBody, sameOrigin, session, supabase } from "@/lib/crm/server";
import {
  FILE_KINDS,
  FILE_TYPES,
  FILES_BUCKET,
  MAX_FILE_BYTES,
  publicFileUrl,
  storagePath,
  validateProject,
  validateUnits,
} from "@/lib/crm/projects";

const headers = { "Cache-Control": "private, no-store" };
const ID = /^[0-9a-f-]{36}$/i;

/** Every project with its units and files (links included), for everyone in the workspace. */
export async function GET() {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const [projects, units, files, leads] = await Promise.all([
    auth.db.from("crm_projects").select("*").order("archived").order("name"),
    auth.db.from("crm_project_units").select("*").order("position"),
    auth.db.from("crm_project_files").select("id,project_id,kind,name,mime,size_bytes,storage_path,created_at").order("created_at"),
    auth.db.from("crm_leads").select("project_id").not("project_id", "is", null).limit(10000),
  ]);
  if (projects.error || units.error || files.error)
    return Response.json({ error: "Apply the projects migration first." }, { status: 503, headers });
  const base = process.env.SUPABASE_URL ?? "";
  const leadCounts: Record<string, number> = {};
  for (const l of leads.data ?? []) if (l.project_id) leadCounts[l.project_id] = (leadCounts[l.project_id] ?? 0) + 1;
  return Response.json(
    {
      projects: projects.data,
      units: units.data,
      files: files.data.map(({ storage_path, ...f }) => ({ ...f, url: publicFileUrl(base, storage_path) })),
      leadCounts,
      canEdit: auth.member.role !== "team",
    },
    { headers },
  );
}

/**
 * Owners and admins manage inventory. Writes use the service role, always scoped to the
 * caller's workspace. Files upload straight from the browser to storage with a signed URL
 * (so large brochures don't pass through this server), then addFile records them.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await session();
  if (!auth) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (auth.member.role === "team")
    return Response.json({ error: "Ask an owner or admin to change projects." }, { status: 403 });
  const db = supabase(undefined, true);
  const org = auth.organizationId;
  const ownProject = async (id: unknown) => {
    if (typeof id !== "string" || !ID.test(id)) throw new Error("Choose a project.");
    const { data } = await db.from("crm_projects").select("id").eq("organization_id", org).eq("id", id).maybeSingle();
    if (!data) throw new Error("Project not found.");
    return id;
  };
  try {
    const body = await jsonBody(request, 30_000);
    if (body.action === "saveProject") {
      const fields = validateProject((body.project ?? {}) as Record<string, unknown>);
      const units = body.units === undefined ? null : validateUnits(body.units);
      let id = body.id;
      if (id) {
        id = await ownProject(id);
        const { error } = await db.from("crm_projects").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw new Error("Couldn't save the project.");
      } else {
        const { count } = await db.from("crm_projects").select("id", { count: "exact", head: true }).eq("organization_id", org);
        if ((count ?? 0) >= 200) throw new Error("A workspace can have up to 200 projects. Archive or delete old ones.");
        const { data, error } = await db.from("crm_projects").insert({ ...fields, organization_id: org }).select("id").single();
        if (error) throw new Error("Couldn't add the project.");
        id = data.id;
      }
      if (units) {
        // Replace the unit list as a whole: it's small and edited as one table.
        const { error: delError } = await db.from("crm_project_units").delete().eq("organization_id", org).eq("project_id", id);
        if (delError) throw new Error("Couldn't save the unit types.");
        if (units.length) {
          const { error } = await db
            .from("crm_project_units")
            .insert(units.map((u) => ({ ...u, organization_id: org, project_id: id })));
          if (error) throw new Error("Couldn't save the unit types.");
        }
      }
      return Response.json({ ok: true, id }, { headers });
    }
    if (body.action === "archive") {
      const id = await ownProject(body.id);
      await db.from("crm_projects").update({ archived: body.archived === true, updated_at: new Date().toISOString() }).eq("id", id);
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "deleteProject") {
      const id = await ownProject(body.id);
      const { data: files } = await db.from("crm_project_files").select("storage_path").eq("project_id", id);
      if (files?.length) await db.storage.from(FILES_BUCKET).remove(files.map((f) => f.storage_path));
      const { error } = await db.from("crm_projects").delete().eq("id", id);
      if (error) throw new Error("Couldn't delete the project.");
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "uploadUrl") {
      const project = await ownProject(body.projectId);
      const mime = typeof body.mime === "string" ? body.mime : "";
      const size = Number(body.size);
      if (!FILE_TYPES[mime]) throw new Error("Upload a PDF, JPG, PNG or WebP file.");
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Error("Files can be up to 15 MB.");
      const { count } = await db.from("crm_project_files").select("id", { count: "exact", head: true }).eq("project_id", project);
      if ((count ?? 0) >= 30) throw new Error("A project can have up to 30 files.");
      const path = storagePath(org, project, typeof body.fileName === "string" ? body.fileName : "", mime);
      const { data, error } = await db.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new Error("File uploads aren't available yet. Apply the projects migration.");
      return Response.json({ uploadUrl: data.signedUrl, path }, { headers });
    }
    if (body.action === "addFile") {
      const project = await ownProject(body.projectId);
      const path = typeof body.path === "string" ? body.path : "";
      if (!path.startsWith(`${org}/${project}/`)) throw new Error("Invalid upload.");
      const kind = FILE_KINDS.includes(body.kind as (typeof FILE_KINDS)[number]) ? body.kind : "brochure";
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Brochure";
      // Trust the stored object, not the browser, for its type and size.
      const { data: info, error: infoError } = await db.storage.from(FILES_BUCKET).info(path);
      const mime = (info as { contentType?: string } | null)?.contentType ?? "";
      const size = Number((info as { size?: number } | null)?.size);
      if (infoError || !FILE_TYPES[mime] || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
        await db.storage.from(FILES_BUCKET).remove([path]);
        throw new Error("The upload didn't complete. Try again with a PDF or image up to 15 MB.");
      }
      const { error } = await db.from("crm_project_files").insert({
        organization_id: org,
        project_id: project,
        kind,
        name,
        storage_path: path,
        mime,
        size_bytes: size,
      });
      if (error) throw new Error("Couldn't save the file.");
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "renameFile" || body.action === "deleteFile") {
      if (typeof body.id !== "string" || !ID.test(body.id)) throw new Error("Choose a file.");
      const { data: file } = await db.from("crm_project_files").select("id,storage_path").eq("organization_id", org).eq("id", body.id).maybeSingle();
      if (!file) throw new Error("File not found.");
      if (body.action === "renameFile") {
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
        if (!name) throw new Error("Enter a file name.");
        const kind = FILE_KINDS.includes(body.kind as (typeof FILE_KINDS)[number]) ? body.kind : undefined;
        await db.from("crm_project_files").update({ name, ...(kind ? { kind } : {}) }).eq("id", file.id);
      } else {
        await db.storage.from(FILES_BUCKET).remove([file.storage_path]);
        await db.from("crm_project_files").delete().eq("id", file.id);
      }
      return Response.json({ ok: true }, { headers });
    }
    throw new Error("Unknown action.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "That didn't work." },
      { status: 400, headers },
    );
  }
}
