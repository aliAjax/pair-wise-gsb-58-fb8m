// 测试专用 ESM 加载器：允许扩展less相对导入并即时转译 TS
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { transformSync } from "esbuild";
import { existsSync } from "node:fs";

const candidatesFor = (specifier, parentURL) => {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = resolvePath(dirname(fileURLToPath(parentURL)), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    resolvePath(base, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

export async function resolve(specifier, context, nextResolve) {
  const resolved = candidatesFor(specifier, context.parentURL);
  if (resolved) {
    return {
      url: pathToFileURL(resolved).href,
      shortCircuit: true,
      format: resolved.endsWith(".tsx") ? "tsx" : "ts",
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { code } = transformSync(source, {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "node20",
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
