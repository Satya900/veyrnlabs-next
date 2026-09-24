import type { Metadata } from "next";
import { AccountForm } from "@/components/crm/AccountForm";
import { accountsEnabled } from "@/lib/crm/accounts";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer" };
export default function JoinPage() {
  return <AccountForm enabled={accountsEnabled()} join />;
}
