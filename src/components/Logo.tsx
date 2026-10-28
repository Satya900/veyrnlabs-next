import Image from "next/image";
import logo from "../../public/brand/veyrn-labs-logo-dark-v1.png";

export function LogoMark() {
  return (
    <span className="logo-symbol">
      <Image
        src={logo}
        alt="Veyrn Labs"
        sizes="220px"
        className="logo-symbol-image"
      />
    </span>
  );
}

export function Logo({
  eager = false,
  href = "#top",
}: {
  eager?: boolean;
  href?: string;
}) {
  return (
    <a href={href} className="site-logo" aria-label="Veyrn Labs home">
      <Image
        src={logo}
        alt="Veyrn Labs"
        sizes="(max-width: 700px) 150px, 220px"
        loading={eager ? "eager" : "lazy"}
        className="site-logo-image"
      />
    </a>
  );
}

/**
 * The app-icon tile beside a live-text wordmark. The raster master above is drawn on a
 * graphite background that only disappears against the dark site, so light surfaces
 * (the CRM workspace) use this instead. Mark geometry is public/brand/veyrn-mark.svg.
 */
export function VectorLogo({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="vector-logo" aria-label="Veyrn Labs home">
      <svg viewBox="0 0 512 512" className="vector-logo-mark" aria-hidden="true">
        <rect width="512" height="512" rx="96" fill="#10120f" />
        <g transform="translate(-78 -118)" fill="#d5f688">
          <path d="M119 267h105c21 0 37 9 49 29l115 190-20 33h-68c-24 0-39-10-51-30Z" />
          <path d="m337 362 59-98c9-15 25-22 47-22h97L400 466Z" />
        </g>
      </svg>
      <span className="vector-logo-word">
        <b>veyrn</b> labs
      </span>
    </a>
  );
}
