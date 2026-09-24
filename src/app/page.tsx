import { Nav } from "@/components/Nav";
import { CRMHome } from "@/components/CRMHome";
import { Footer } from "@/components/Footer";
import { StructuredData } from "@/components/StructuredData";

export default function Home() {
  return (
    <>
      <StructuredData />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <CRMHome />
      </main>
      <Footer />
    </>
  );
}
