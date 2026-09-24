import { accountsEnabled } from "@/lib/crm/accounts";
import { ResetPassword } from "@/components/crm/ResetPassword";
export const dynamic = "force-dynamic";
export default function ResetPasswordPage() {
  return <ResetPassword enabled={accountsEnabled()} />;
}
