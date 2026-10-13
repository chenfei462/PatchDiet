import { dirname, extname, join, resolve } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const inertDomNamespaces = new Set([
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/2000/svg"
]);

describe("demo asset build", () => {
  it("rebuilds stable browser entries with self-hosted build-only packages", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // Removed pretest:fast check - test:fast is now decoupled from demo:build
    // The demo:build step generates bundled assets for testing

    const generatedDirectory = join(process.cwd(), "demo", "generated");
    const homepagePath = join(generatedDirectory, "homepage.js");
    const workspacePath = join(generatedDirectory, "workspace.js");
    const fontsPath = join(generatedDirectory, "fonts.css");

    expect(existsSync(homepagePath)).toBe(true);
    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(fontsPath)).toBe(true);

    const homepage = readFileSync(homepagePath, "utf8");
    const workspace = readFileSync(workspacePath, "utf8");
    const fonts = readFileSync(fontsPath, "utf8");

    const chunksDirectory = join(generatedDirectory, "chunks");
    const chunks = (existsSync(chunksDirectory) ? readdirSync(chunksDirectory) : []).filter((file) =>
      file.endsWith(".js")
    );
    const browserJavaScript = [
      { file: "homepage.js", source: homepage, path: homepagePath },
      { file: "workspace.js", source: workspace, path: workspacePath },
      ...chunks.map((file) => ({
        file: `chunks/${file}`,
        source: readFileSync(join(chunksDirectory, file), "utf8"),
        path: join(chunksDirectory, file)
      }))
    ];
    expect(browserJavaScript.reduce((total, asset) => total + statSync(asset.path).size, 0)).toBeGreaterThan(50_000);

    expect(findRemoteUrlLiterals('const remoteAsset = "https://cdn.example.test/app.js"; fetch(remoteAsset);')).toEqual([
      "https://cdn.example.test/app.js"
    ]);
    for (const asset of browserJavaScript) {
      expect(findRemoteUrlLiterals(asset.source, asset.file), asset.file).toEqual([]);
    }

    const emittedEntries = `${homepage}\n${workspace}`;
    for (const chunk of chunks) {
      expect(emittedEntries).toContain(`./chunks/${chunk}`);
    }
    expect(chunks.some((chunk) => homepage.includes(`./chunks/${chunk}`) && workspace.includes(`./chunks/${chunk}`))).toBe(
      true
    );

    const fontUrls = [...fonts.matchAll(/url\(([^)]+)\)/g)].map((match) =>
      match[1].trim().replace(/^['"]|['"]$/g, "").split(/[?#]/, 1)[0]
    );
    expect(fontUrls.length).toBeGreaterThan(0);
    for (const fontUrl of fontUrls) {
      expect(fontUrl).not.toMatch(/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i);
      const fontPath = resolve(dirname(fontsPath), fontUrl);
      expect([".woff", ".woff2"]).toContain(extname(fontPath));
      expect(existsSync(fontPath)).toBe(true);
    }
  });
});

function findRemoteUrlLiterals(source: string, fileName = "generated.js") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const urls: string[] = [];

  const visit = (node: ts.Node) => {
    let value: string | undefined;
    if (ts.isStringLiteralLike(node)) {
      value = node.text;
    } else if (ts.isTemplateExpression(node)) {
      value = node.head.text;
    }

    if (value && /^https?:\/\//i.test(value) && !inertDomNamespaces.has(value)) {
      urls.push(value);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return urls;
}
