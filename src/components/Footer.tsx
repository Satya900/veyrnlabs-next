import Link from "next/link";
import { Logo } from "./Logo";
import { site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="studio-footer">
      <div className="footer-top">
        <Logo href="/#top" />
        <p>
          Veyrn CRM. For real estate teams.
          <br />
          Every lead. A clearer next step.
        </p>
        <nav aria-label="Footer navigation">
          <Link href="/#features">Features</Link>
          <Link href="/product/real-estate-crm-software">
            CRM software &amp; pricing
          </Link>
          <Link href="/product/real-estate-crm">Custom real estate CRM</Link>
          <Link href="/#onboarding">Onboarding</Link>
          <Link href="/crm/login">Sign in</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms &amp; conditions</Link>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Veyrn Labs</span>
        <span>Bengaluru, India</span>
        <a href={`mailto:${site.email}`}>{site.email} ↗</a>
      </div>
    </footer>
  );
}
