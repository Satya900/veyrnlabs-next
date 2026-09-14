import { redirect } from "next/navigation";
import { configured, session } from "@/lib/crm/server";
import Workspace from "@/components/crm/Workspace";
export const dynamic = "force-dynamic";
export default async function CrmPage() {
  if (!configured() || !(await session())) redirect("/crm/login");
  return <Workspace demo={false} />;
}
