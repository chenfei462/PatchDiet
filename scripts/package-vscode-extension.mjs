import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDir);
const extensionDir = join(root, "extensions", "vscode-patchdiet");
const manifest = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const outputPath = join(extensionDir, `${manifest.name}-${manifest.version}.vsix`);
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const packageFiles = [
  {
    name: "[Content_Types].xml",
    content: [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
      "  <Default Extension=\"json\" ContentType=\"application/json\" />",
      "  <Default Extension=\"md\" ContentType=\"text/markdown\" />",
      "  <Default Extension=\"mjs\" ContentType=\"application/javascript\" />",
      "  <Default Extension=\"svg\" ContentType=\"image/svg+xml\" />",
      "  <Default Extension=\"vsixmanifest\" ContentType=\"text/xml\" />",
      "</Types>"
    ].join("\n")
  },
  {
    name: "extension.vsixmanifest",
    content: renderVsixManifest(manifest)
  },
  {
    name: "extension/package.json",
    content: readFileSync(join(extensionDir, "package.json"))
  },
  {
    name: "extension/README.md",
    content: readFileSync(join(extensionDir, "README.md"))
  },
  {
    name: "extension/dist/extension.mjs",
    content: readFileSync(join(extensionDir, "dist", "extension.mjs"))
  },
  {
    name: "extension/media/patchdiet.svg",
    content: readFileSync(join(extensionDir, "media", "patchdiet.svg"))
  }
];

// Helper function to resolve import.meta.url in package-vscode-extension.mjs context
const extensionMetaUrl = new URL('../extensions/vscode-patchdiet/extension.mjs', import.meta.url).href;

for (const required of [
  join(extensionDir, "dist", "extension.mjs"),
  join(extensionDir, "media", "patchdiet.svg")
]) {
  if (!existsSync(required)) {
    throw new Error(`Missing VS Code extension package input: ${required}`);
  }
}

mkdirSync(extensionDir, { recursive: true });
writeFileSync(outputPath, createZip(packageFiles));
console.log(`VS Code VSIX package written to ${outputPath}`);

function renderVsixManifest(packageJson) {
  const publisher = escapeXml(packageJson.publisher ?? "patchdiet");
  const name = escapeXml(packageJson.name);
  const displayName = escapeXml(packageJson.displayName ?? packageJson.name);
  const version = escapeXml(packageJson.version);
  const description = escapeXml(packageJson.description ?? "");
  const engine = escapeXml(toVsixEngineRange(packageJson.engines?.vscode));

  return [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<PackageManifest Version=\"2.0.0\" xmlns=\"http://schemas.microsoft.com/developer/vsx-schema/2011\">",
    "  <Metadata>",
    `    <Identity Language=\"en-US\" Id=\"${name}\" Version=\"${version}\" Publisher=\"${publisher}\" />`,
    `    <DisplayName>${displayName}</DisplayName>`,
    `    <Description xml:space=\"preserve\">${description}</Description>`,
    "    <Tags>patchdiet,pr-cleanup,ai</Tags>",
    "    <Categories>Other</Categories>",
    "  </Metadata>",
    "  <Installation>",
    `    <InstallationTarget Id=\"Microsoft.VisualStudio.Code\" Version=\"${engine}\" />`,
    "  </Installation>",
    "  <Dependencies />",
    "  <Assets>",
    "    <Asset Type=\"Microsoft.VisualStudio.Code.Manifest\" Path=\"extension/package.json\" Addressable=\"true\" />",
    "    <Asset Type=\"Microsoft.VisualStudio.Services.Content.Details\" Path=\"extension/README.md\" Addressable=\"true\" />",
    "  </Assets>",
    "</PackageManifest>"
  ].join("\n");
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll("\\", "/"), "utf8");
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toVsixEngineRange(value = "*") {
  if (value === "*") {
    return "[0.0.0,)";
  }

  const caret = /^\^(\d+\.\d+\.\d+)$/.exec(value);
  if (caret?.[1]) {
    return `[${caret[1]},)`;
  }

  const minimum = /^>=(\d+\.\d+\.\d+)$/.exec(value);
  if (minimum?.[1]) {
    return `[${minimum[1]},)`;
  }

  if (/^\[\d+\.\d+\.\d+,.*\)$/.test(value)) {
    return value;
  }

  throw new Error(`Unsupported VS Code engine range for VSIX manifest: ${value}`);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
