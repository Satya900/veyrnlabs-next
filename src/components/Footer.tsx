import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="studio-footer">
      <div className="footer-top"><Logo /><p>AI engineering. Business software.<br />Verified before it ships.</p><nav aria-label="Footer navigation"><a href="#services">Capabilities</a><a href="#work">Selected work</a><a href="#studio">The studio</a><a href="#faq">FAQ</a></nav></div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} Veyrn Labs</span><span>Bengaluru, India</span><a href="mailto:hello@veyrnlabs.com">hello@veyrnlabs.com ↗</a></div>
    </footer>
  );
}
