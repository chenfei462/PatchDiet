import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const extensionDir = join(process.cwd(), "extensions", "vscode-patchdiet");
const manifest = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const output = join(extensionDir, "dist", "extension.mjs");
const vsix = join(extensionDir, `${manifest.name}-${manifest.version}.vsix`);

runNpm(["run", "package"], extensionDir);

if (!existsSync(output)) {
  throw new Error(`VS Code bundle missing: ${output}`);
}

if (!existsSync(vsix)) {
  throw new Error(`VS Code VSIX missing: ${vsix}`);
}

const entries = listZipEntries(readFileSync(vsix));
for (const required of [
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/README.md",
  "extension/dist/extension.mjs",
  "extension/media/patchdiet.svg"
]) {
  if (!entries.includes(required)) {
    throw new Error(`VS Code VSIX missing entry: ${required}`);
  }
}

console.log(`VS Code VSIX smoke passed: ${vsix}`);

function listZipEntries(buffer) {
  const entries = [];
  let offset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(offset + 10);
  let centralOffset = buffer.readUInt32LE(offset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("Invalid VSIX central directory");
    }

    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    entries.push(buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8"));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Invalid VSIX: missing ZIP end of central directory");
}

function runNpm(args, cwd, stdio = "inherit") {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, stdio });
    return;
  }

  execFileSync("npm", args, { cwd, stdio });
}
