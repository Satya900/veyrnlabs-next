import { notFound } from "next/navigation";
import { platformAdmin, supabase } from "@/lib/crm/server";
import { PlatformAdmin, type Overview } from "@/components/crm/PlatformAdmin";

export const dynamic = "force-dynamic";

// Product-owner view across every workspace. Anyone not on CRM_PLATFORM_ADMIN_EMAILS gets a
// plain 404, so the page's existence isn't revealed.
export default async function AdminPage() {
  const admin = await platformAdmin();
  if (!admin) notFound();
  const { data, error } = await supabase(undefined, true).rpc("crm_platform_overview");
  if (error || !data)
    return (
      <main className="crm-admin">
        <p className="crm-error">The overview couldn&apos;t load. Apply the platform overview migration and reload.</p>
      </main>
    );
  return <PlatformAdmin overview={data as Overview} email={admin.email} />;
}
