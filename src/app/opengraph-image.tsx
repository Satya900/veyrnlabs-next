/* eslint-disable @next/next/no-img-element -- ImageResponse renders img directly; next/image is not supported here. */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { site } from "@/lib/site";

export const alt = "Veyrn Labs. AI that works. Software that moves business.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const mark = await readFile(join(process.cwd(), "public/brand/veyrn-mark-512.png"));
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#10120f", color: "#f1f0e9", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><img src={markSrc} width={64} height={64} alt="" /><span style={{ fontSize: 35 }}>veyrn labs</span></div>
        <span style={{ fontSize: 16, color: "#d5f688", letterSpacing: 3 }}>AI ENGINEERING & SOFTWARE</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 76, lineHeight: 1.08, letterSpacing: -3 }}><span>AI that works.</span><span>Software that</span><span style={{ color: "#d5f688" }}>moves business.</span></div>
      <div style={{ display: "flex", borderTop: "1px solid #394031", paddingTop: 24, justifyContent: "space-between", fontSize: 18, color: "#b2b6ad" }}><span>Verified before it ships.</span><span>{new URL(site.url).hostname}</span></div>
    </div>,
    size,
  );
}
