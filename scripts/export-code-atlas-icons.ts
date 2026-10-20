// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A one-shot icon export script.
// Code Atlas fork: renders assets/code-atlas/code-atlas-icon.svg into every
// brand slot the desktop and web builds read (see scripts/lib/brand-assets.ts),
// so the upstream build pipeline stays untouched.
//
//   node scripts/export-code-atlas-icons.ts
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import sharp from "sharp";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const sourceSvg = NodePath.join(repoRoot, "assets/code-atlas/code-atlas-icon.svg");

async function renderSquare(size: number): Promise<Buffer> {
  const svg = await NodeFs.readFile(sourceSvg);
  return sharp(svg, { density: Math.max(72, (72 * size) / 1024) * 1.5 })
    .resize(size, size)
    .png()
    .toBuffer();
}

// macOS (pre-Tahoe layout): an 824px body centred on a transparent 1024 canvas.
async function renderMacIcon(): Promise<Buffer> {
  const body = await renderSquare(824);
  return sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: body, left: 100, top: 100 }])
    .png()
    .toBuffer();
}

// Minimal ICO container that embeds PNG images (supported since Windows Vista).
function encodeIco(images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function main() {
  const write = async (relativePath: string, data: Buffer) => {
    const target = NodePath.join(repoRoot, relativePath);
    await NodeFs.writeFile(target, data);
    console.log(`wrote ${relativePath}`);
  };
  const mac = await renderMacIcon();
  const full = await renderSquare(1024);
  const favicon16 = await renderSquare(16);
  const favicon32 = await renderSquare(32);
  const appleTouch = await renderSquare(180);
  const ico = encodeIco([
    { size: 16, png: favicon16 },
    { size: 32, png: favicon32 },
    { size: 48, png: await renderSquare(48) },
    { size: 256, png: await renderSquare(256) },
  ]);

  // Production, development and nightly slots all show the Code Atlas mark.
  for (const [macPath, iosPath, universalPath, prefix] of [
    [
      "assets/prod/black-macos-1024.png",
      "assets/prod/black-ios-1024.png",
      "assets/prod/black-universal-1024.png",
      "assets/prod/t3-black",
    ],
    [
      "assets/dev/blueprint-macos-1024.png",
      "assets/dev/blueprint-ios-1024.png",
      "assets/dev/blueprint-universal-1024.png",
      "assets/dev/blueprint",
    ],
    [
      "assets/nightly/nightly-macos-1024.png",
      "assets/nightly/nightly-ios-1024.png",
      "assets/nightly/nightly-universal-1024.png",
      "assets/nightly/nightly",
    ],
  ] as const) {
    await write(macPath, mac);
    await write(iosPath, full);
    await write(universalPath, full);
    await write(`${prefix}-web-favicon-16x16.png`, favicon16);
    await write(`${prefix}-web-favicon-32x32.png`, favicon32);
    await write(`${prefix}-web-apple-touch-180.png`, appleTouch);
    await write(`${prefix}-web-favicon.ico`, ico);
    await write(`${prefix}-windows.ico`, ico);
  }
  await write("apps/web/public/favicon-16x16.png", favicon16);
  await write("apps/web/public/favicon-32x32.png", favicon32);
  await write("apps/web/public/apple-touch-icon.png", appleTouch);
  await write("apps/web/public/favicon.ico", ico);
  await write("assets/code-atlas/code-atlas-macos-1024.png", mac);
}

await main();
