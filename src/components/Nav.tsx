import { ButtonLink } from "./ui/Button";
import { Logo } from "./Logo";

export function Nav() {
  return (
    <header className="site-nav">
      <div className="nav-inner">
        <Logo eager />
        <nav aria-label="Main navigation" className="flex items-center gap-7">
          <a href="#services" className="nav-secondary">Capabilities</a>
          <a href="#work" className="nav-link">Work</a>
          <a href="#process" className="nav-secondary">Our approach</a>
          <ButtonLink href="#contact" variant="outline-sm">Let&apos;s talk <span aria-hidden="true">↗</span></ButtonLink>
        </nav>
      </div>
    </header>
  );
}

