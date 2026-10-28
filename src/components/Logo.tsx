// Vector brand marks. The raster master (public/brand/veyrn-labs-logo-dark-v1.png) is
// drawn on a graphite background, so on the light site the app-icon tile carries the
// brand colours and the wordmark is live text. Geometry is public/brand/veyrn-mark.svg.
export function LogoMark({ className = "logo-mark" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="96" fill="#10120f" />
      <g transform="translate(-78 -118)" fill="#d5f688">
        <path d="M119 267h105c21 0 37 9 49 29l115 190-20 33h-68c-24 0-39-10-51-30Z" />
        <path d="m337 362 59-98c9-15 25-22 47-22h97L400 466Z" />
      </g>
    </svg>
  );
}

export function Logo({ href = "#top" }: { href?: string }) {
  return (
    <a href={href} className="site-logo" aria-label="Veyrn Labs home">
      <LogoMark />
      <span className="site-logo-word">
        <b>veyrn</b> labs
      </span>
    </a>
  );
}
