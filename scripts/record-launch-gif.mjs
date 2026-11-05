import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const outDir = join(process.cwd(), "docs", "assets", "launch-gif");
const fontFile = findFontFile();
mkdirSync(outDir, { recursive: true });

const frames = [
  "00-05s: README hero shows 'Your AI wrote 400 lines. You only need to review 80.'",
  "05-12s: Run npm run demo and open the local demo URL.",
  "12-22s: The sample receipt is already loaded: 5 files / 33 lines -> 2 files / 14 lines, 58% review noise removed, 4m estimated attention saved.",
  "22-34s: Scroll candidates: README.md, docs/agent-plan.md, dist/cart.generated.js.",
  "34-44s: Paste https://github.com/octocat/Hello-World/pull/6 and click Analyze diff.",
  "44-52s: Show honest public PR preview with no dramatic fake shrink.",
  "52-60s: Show Diet Card sample and GitHub App comment direction: 58% review noise removed, 4m estimated attention saved."
];

writeFileSync(
  join(outDir, "storyboard.md"),
  [
    "# PatchDiet 60-Second GIF Storyboard",
    "",
    ...frames.map((frame) => `- ${frame}`),
    "",
    "Recording command suggestion:",
    "",
    "```bash",
    "npm run demo",
    "# Record the browser viewport with ScreenToGif, Kap, or ffmpeg.",
    "```",
    ""
  ].join("\n"),
  "utf8"
);

const svgFrames = [
  frameSvg("Your AI wrote 400 lines.", "You only need to review 80.", "PatchDiet / PR Auto-Cleaner"),
  frameSvg("Load the sample diff.", "5 files -> 2 files", "33 changed lines -> 14"),
  frameSvg("Deletion candidates", "README.md / docs/agent-plan.md / dist/cart.generated.js", "Review signal, skip noise"),
  frameSvg("Public PR URL fetch", "octocat/Hello-World#6", "Honest preview: no fake shrink"),
  frameSvg("Diet Card", "58% review noise removed", "Share the verified cleanup receipt")
];

for (const [index, frame] of svgFrames.entries()) {
  writeFileSync(join(outDir, `frame-${String(index + 1).padStart(2, "0")}.svg`), frame, "utf8");
}

try {
  const ffmpeg = findFfmpeg();
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x0c100e:s=960x540:d=60:r=2",
      "-vf",
      launchGifFilter(),
      join(outDir, "patchdiet-launch.gif")
    ],
    { stdio: "ignore" }
  );
  console.log("Wrote docs/assets/launch-gif/storyboard.md and patchdiet-launch.gif");
} catch {
  console.log("Wrote docs/assets/launch-gif/storyboard.md and SVG frames. Install ffmpeg to build patchdiet-launch.gif.");
}

function findFfmpeg() {
  try {
    return execFileSync(process.platform === "win32" ? "where.exe" : "which", ["ffmpeg"], {
      encoding: "utf8"
    }).split(/\r?\n/).find(Boolean) ?? "ffmpeg";
  } catch {
    return "ffmpeg";
  }
}

function launchGifFilter() {
  const base = [
    "drawgrid=width=120:height=100:thickness=1:color=0x1d2b22@0.85",
    text("PatchDiet / PR Auto-Cleaner", 48, 72, 22, 0, 60, "0x9cf36b")
  ];
  const scenes = [
    ["Your AI wrote 400 lines.", "You only need to review 80.", "README hero: contrast first, safety second.", 0, 12],
    ["Load the sample diff.", "5 files -> 2 files", "33 changed lines -> 14 changed lines.", 12, 24],
    ["Deletion candidates", "README.md / docs / generated artifact", "Review signal, skip noise.", 24, 36],
    ["Public PR URL fetch", "octocat/Hello-World#6", "Honest preview: no fake shrink claim.", 36, 48],
    ["Diet Card + GitHub App", "58% review noise removed", "Share the verified cleanup receipt.", 48, 60]
  ];

  return [
    ...base,
    ...scenes.flatMap(([title, subtitle, caption, start, end]) => [
      text(title, 48, 210, 56, start, end, "0xf5f1e8"),
      text(subtitle, 48, 292, 42, start, end, "0xf5f1e8"),
      "drawbox=x=48:y=374:w=790:h=72:color=0x111814@1:t=fill:enable='gte(t\\," + start + ")*lt(t\\," + end + ")'",
      "drawbox=x=48:y=374:w=790:h=72:color=0x314138@1:t=2:enable='gte(t\\," + start + ")*lt(t\\," + end + ")'",
      text(caption, 76, 420, 24, start, end, "0xa9b4ac")
    ]),
    "fps=2"
  ].join(",");
}

function text(value, x, y, size, start, end, color) {
  const fontOption = fontFile ? `fontfile='${fontFile.replace(":", "\\:")}'` : "font='monospace'";
  return [
    "drawtext=",
    fontOption,
    ":",
    `text='${escapeDrawText(value)}'`,
    `:x=${x}`,
    `:y=${y}`,
    `:fontsize=${size}`,
    `:fontcolor=${color}`,
    `:enable='gte(t\\,${start})*lt(t\\,${end})'`
  ].join("");
}

function findFontFile() {
  const candidates = process.platform === "win32"
    ? ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/arial.ttf"]
    : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/Library/Fonts/Arial Unicode.ttf"
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

function escapeDrawText(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll(",", "\\,");
}

function frameSvg(title, subtitle, caption) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#0c100e"/>
  <path d="M0 80H960M0 180H960M0 280H960M0 380H960M120 0V540M300 0V540M480 0V540M660 0V540M840 0V540" stroke="#1d2b22" stroke-width="1"/>
  <text x="48" y="72" fill="#9cf36b" font-family="Consolas, monospace" font-size="22">PatchDiet / PR Auto-Cleaner</text>
  ${svgText(title, 48, 210, 70, 864, "#f5f1e8", "Georgia, serif", "700")}
  ${svgText(subtitle, 48, 300, 54, 864, "#f5f1e8", "Georgia, serif", "700")}
  <rect x="48" y="374" width="760" height="72" fill="#111814" stroke="#314138"/>
  ${svgText(caption, 76, 420, 26, 704, "#a9b4ac", "Consolas, monospace")}
</svg>`;
}

function svgText(value, x, y, size, maxWidth, color, fontFamily, fontWeight = "400") {
  const maxChars = Math.max(8, Math.floor(maxWidth / (size * 0.58)));
  const lines = wrapText(value, maxChars);
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * Math.ceil(size * 1.15)}" fill="${color}" font-family="${fontFamily}" font-size="${size}" font-weight="${fontWeight}">${escapeXml(line)}</text>`
  ).join("\n  ");
}

function wrapText(value, maxChars) {
  const lines = [];
  let current = "";
  for (const word of value.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
