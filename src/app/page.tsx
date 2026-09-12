import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { FAQ } from "@/components/FAQ";
import { WhatWeBuild } from "@/components/WhatWeBuild";
import { AiProposes } from "@/components/AiProposes";
import { SelectedWork } from "@/components/SelectedWork";
import { HowWeWork } from "@/components/HowWeWork";
import { Founder } from "@/components/Founder";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { StructuredData } from "@/components/StructuredData";

export default function Home() {
  return (
    <>
      <StructuredData />
      <a href="#main" className="skip-link">Skip to content</a><Nav />
      <main id="main">
        <Hero />

        <WhatWeBuild />
        <SelectedWork />
        <AiProposes />
        <HowWeWork />
        <Founder />
        <FAQ />
        <Contact />
      </main>
      <Footer />
    </>
  );
}


