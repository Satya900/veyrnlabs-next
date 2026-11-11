import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { configured, supabase } from "@/lib/crm/server";
import { EnquiryForm } from "@/components/crm/EnquiryForm";

export const dynamic = "force-dynamic";

async function business(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !configured()) return null;
  const { data } = await supabase(undefined, true)
    .from("crm_lead_capture")
    .select("enabled,crm_organizations(name)")
    .eq("token", token)
    .maybeSingle();
  const org = data?.crm_organizations as { name?: string } | { name?: string }[] | null | undefined;
  const name = Array.isArray(org) ? org[0]?.name : org?.name;
  return data?.enabled && name ? name : null;
}

export async function generateMetadata({ params }: PageProps<"/f/[token]">): Promise<Metadata> {
  const name = await business((await params).token);
  return { title: name ? `Enquire with ${name}` : "Enquiry form" };
}

export default async function EnquiryPage({ params, searchParams }: PageProps<"/f/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const name = await business(token);
  if (!name) notFound();
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 100) : "");
  return (
    <EnquiryForm
      token={token}
      business={name}
      source={one(query.source) || "Enquiry form"}
      embedded={one(query.embed) === "1"}
    />
  );
}
