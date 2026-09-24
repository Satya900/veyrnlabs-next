import Link from "next/link";
import { ButtonLink } from "./ui/Button";
import { Logo } from "./Logo";

export function Nav() {
  return (
    <header className="site-nav">
      <div className="nav-inner">
        <Logo eager href="/#top" />
        <nav aria-label="Main navigation" className="flex items-center gap-7">
          <Link href="/#features" className="nav-secondary">
            Features
          </Link>
          <Link href="/#pricing" className="nav-link">
            Pricing
          </Link>
          <Link href="/#onboarding" className="nav-secondary">
            Onboarding
          </Link>
          <Link href="/crm/login" className="nav-link">
            Sign in
          </Link>
          <div className="hidden sm:block">
            <ButtonLink href="/#contact" variant="outline-sm">
              Get started <span aria-hidden="true">↗</span>
            </ButtonLink>
          </div>
        </nav>
      </div>
    </header>
  );
}
