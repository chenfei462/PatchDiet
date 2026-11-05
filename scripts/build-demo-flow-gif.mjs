import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const frameDir = join(process.cwd(), "docs", "assets", "launch-gif", "browser-frames");
const outPath = join(process.cwd(), "docs", "assets", "launch-gif", "patchdiet-demo-flow.gif");
const frames = readdirSync(frameDir)
  .filter((name) => name.endsWith(".png"))
  .sort();

if (frames.length === 0) {
  throw new Error("No browser frames found. Capture frames into docs/assets/launch-gif/browser-frames first.");
}

const concatFile = join(frameDir, "frames.txt");
const frameDuration = Math.min(3, 60 / frames.length);
const lines = frames.flatMap((name) => [
  `file '${join(frameDir, name).replaceAll("\\", "/")}'`,
  `duration ${frameDuration.toFixed(3)}`
]);
lines.push(`file '${join(frameDir, frames.at(-1)).replaceAll("\\", "/")}'`);
writeFileSync(concatFile, lines.join("\n"), "ascii");

const ffmpeg = findBinary("ffmpeg");
execFileSync(ffmpeg, [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatFile,
  "-vf",
  "scale=960:-1:flags=lanczos,fps=2,trim=duration=60,setpts=PTS-STARTPTS",
  outPath
], { stdio: "ignore" });

console.log("Wrote docs/assets/launch-gif/patchdiet-demo-flow.gif");

function findBinary(name) {
  try {
    return execFileSync(process.platform === "win32" ? "where.exe" : "which", [name], {
      encoding: "utf8"
    }).split(/\r?\n/).find(Boolean) ?? name;
  } catch {
    return name;
  }
}
