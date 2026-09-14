import type { Metadata } from "next";
import "./crm.css";

export const metadata: Metadata = {
  title: "Workspace | Veyrn Labs",
  description: "Veyrn Labs private client workspace",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <div className="crm-root">{children}</div>;
}
