import Link from "next/link";
import { ButtonLink } from "./ui/Button";
import { Logo } from "./Logo";

export function Nav() {
  return (
    <header className="site-nav">
      <div className="nav-inner">
        <Logo eager href="/#top" />
        <nav aria-label="Main navigation" className="flex items-center gap-7">
          <Link href="/#services" className="nav-secondary">
            Capabilities
          </Link>
          <Link href="/#work" className="nav-link">
            Work
          </Link>
          <Link
            href="/product/real-estate-crm-software"
            className="nav-secondary"
          >
            Real estate CRM
          </Link>
          <Link href="/#process" className="nav-secondary">
            Our approach
          </Link>
          <ButtonLink href="/#contact" variant="outline-sm">
            Let&apos;s talk <span aria-hidden="true">↗</span>
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
