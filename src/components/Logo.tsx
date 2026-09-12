import Image from "next/image";
import logo from "../../public/brand/veyrn-labs-logo-dark-v1.png";

export function LogoMark() {
  return (
    <span className="logo-symbol">
      <Image src={logo} alt="Veyrn Labs" sizes="220px" className="logo-symbol-image" />
    </span>
  );
}

export function Logo({ eager = false }: { eager?: boolean }) {
  return (
    <a href="#top" className="site-logo" aria-label="Veyrn Labs home">
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
