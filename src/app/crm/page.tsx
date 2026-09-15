import { redirect } from "next/navigation";
import { configured, loadWorkspace, session } from "@/lib/crm/server";
import Workspace from "@/components/crm/Workspace";
export const dynamic = "force-dynamic";
export default async function CrmPage() {
  if (!configured()) redirect("/crm/login");
  const auth = await session();
  if (!auth) redirect("/crm/login");
  // Best-effort: if this fails, Workspace falls back to its own client-side
  // fetch (and error/retry UI) rather than failing the whole page.
  const initialData = await loadWorkspace(auth).catch(() => null);
  return <Workspace demo={false} initialData={initialData} />;
}
