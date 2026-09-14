import { notFound } from "next/navigation";
import Workspace from "@/components/crm/Workspace";
export default function DemoPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRM_ENABLE_DEMO !== "true"
  )
    notFound();
  return <Workspace demo />;
}
