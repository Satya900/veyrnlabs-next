import type { Metadata } from "next";
import "../crm/crm.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

// Public enquiry forms that agents share (Instagram bio, ads, QR codes) or embed on a website.
export default function EnquiryLayout({ children }: { children: React.ReactNode }) {
  return <div className="crm-root crm-enquiry-root">{children}</div>;
}
