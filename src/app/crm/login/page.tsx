import { configured } from "@/lib/crm/server";
import Login from "@/components/crm/Login";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return (
    <Login
      configured={configured()}
      showDemo={
        process.env.NODE_ENV !== "production" ||
        process.env.CRM_ENABLE_DEMO === "true"
      }
    />
  );
}
