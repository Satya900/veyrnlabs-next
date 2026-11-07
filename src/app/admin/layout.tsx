import type { Metadata } from "next";
import "../crm/crm.css";

// Deliberately generic: this layout also wraps the 404 non-admins see.
export const metadata: Metadata = {
  title: "Veyrn CRM",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

// Outside /crm on purpose: that segment's loading boundary streams a 200 before the admin
// check runs, so notFound() there couldn't send a real 404.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="crm-root">{children}</div>;
}
