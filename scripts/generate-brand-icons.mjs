import { readFile, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Reuse the image processor shipped with the project's installed Next.js.
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const source = await readFile(new URL("../public/brand/veyrn-mark.svg", import.meta.url));
const output = (path) => new URL(path, import.meta.url);

await copyFile(output("../public/brand/veyrn-mark.svg"), output("../src/app/icon.svg"));
for (const [size, path] of [
  [96, "../src/app/icon1.png"],
  [180, "../src/app/apple-icon.png"],
  [512, "../public/brand/veyrn-mark-512.png"],
]) {
  await sharp(source).resize(size, size).png().toFile(output(path).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
}

const sizes = [16, 32, 48, 64];
const images = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile(output("../src/app/favicon.ico"), Buffer.concat([header, ...images]));
console.log("Generated SVG, 96px PNG, Apple touch icon, 512px brand mark, and multi-resolution ICO.");
