import { notFound } from "next/navigation";
import Workspace from "@/components/crm/Workspace";
import type { View } from "@/components/crm/types";

const views: Record<string, View> = { leads: "Leads", clients: "Clients", settings: "Settings", whatsapp: "WhatsApp" };

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRM_ENABLE_DEMO !== "true"
  )
    notFound();
  const { view } = await searchParams;
  return <Workspace demo initialView={views[view ?? ""] ?? "Overview"} />;
}
