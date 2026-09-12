/**
 * Pack the built backend + frontend into a publishable npm package.
 *
 * Layout produced under release/aiservermanager/:
 *   bin/aiservermanager.js      # entry point for `npx aiservermanager`
 *   backend/dist/**             # compiled backend (incl. dist/files/*.ps1)
 *   backend/public/browser/**   # built Angular frontend
 *   package.json                # publishable manifest (runtime deps only)
 *   README.md
 *
 * Usage: node scripts/package-npm.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "backend", "dist");
const publicDir = path.join(rootDir, "backend", "public", "browser");
const outDir = path.join(rootDir, "release", "aiservermanager");

const required = [distDir, publicDir];
for (const dir of required) {
  if (!fs.existsSync(dir)) {
    console.error(`Missing ${path.relative(rootDir, dir)} — run "npm run build" first.`);
    process.exit(1);
  }
}

const rootManifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "bin"), { recursive: true });
fs.cpSync(distDir, path.join(outDir, "backend", "dist"), { recursive: true });
fs.cpSync(publicDir, path.join(outDir, "backend", "public", "browser"), { recursive: true });

fs.writeFileSync(
  path.join(outDir, "bin", "aiservermanager.js"),
  '#!/usr/bin/env node\nrequire("../backend/dist/index.js");\n',
  "utf-8",
);

fs.copyFileSync(path.join(rootDir, "scripts", "npm-package", "README.md"), path.join(outDir, "README.md"));

const manifest = {
  name: "aiservermanager",
  version: rootManifest.version,
  description: "GPU server monitoring and AI service manager web dashboard",
  main: "backend/dist/index.js",
  bin: { aiservermanager: "bin/aiservermanager.js" },
  files: ["bin", "backend/dist", "backend/public", "README.md"],
  scripts: { start: "node bin/aiservermanager.js" },
  keywords: ["gpu", "nvidia", "llama", "comfyui", "server", "monitoring", "dashboard"],
  author: "yar3333",
  license: "MIT",
  repository: { type: "git", url: "https://github.com/yar3333/aiservermanager" },
  engines: { node: ">=24" },
  dependencies: {
    cors: "^2.8.5",
    express: "^5.2.1",
    inversify: "^8.1.1",
    "reflect-metadata": "^0.2.2",
  },
  optionalDependencies: {
    "authenticate-pam": "^1.0.5",
  },
};
fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

console.log(`Packaged ${manifest.name} v${manifest.version} -> ${path.relative(rootDir, outDir)}`);
console.log(`Inspect:  npm pack ${path.relative(rootDir, outDir)} --dry-run`);
console.log(`Publish:  cd ${path.relative(rootDir, outDir)} && npm publish --access public`);