import Link from "next/link";
import { Logo } from "./Logo";
import { site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="studio-footer">
      <div className="footer-top">
        <Logo href="/#top" />
        <p>
          AI engineering. Business software.
          <br />
          Verified before it ships.
        </p>
        <nav aria-label="Footer navigation">
          <Link href="/#services">Capabilities</Link>
          <Link href="/product/real-estate-crm-software">
            CRM software &amp; pricing
          </Link>
          <Link href="/product/real-estate-crm">Custom real estate CRM</Link>
          <Link href="/#work">Selected work</Link>
          <Link href="/#studio">The studio</Link>
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
