import { AccountForm } from "@/components/crm/AccountForm";
import { accountsEnabled } from "@/lib/crm/accounts";
export const dynamic = "force-dynamic";
export default function SignupPage() {
  return <AccountForm enabled={accountsEnabled()} />;
}
