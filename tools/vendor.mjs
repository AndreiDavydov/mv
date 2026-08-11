/**
 * Bundles the handful of npm dependencies into plain ESM files under /vendor.
 *
 * The published site has no build step: `labels/` and `app/` are static files
 * that import from `/vendor/*.js` directly. This script is the only thing that
 * ever touches node_modules, and its output is committed.
 *
 *   npm run vendor
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'vendor');

/** Each entry becomes vendor/<name>.js exporting the listed names. */
const targets = [
  { name: 'qrcode', entry: "export { create, toCanvas, toDataURL } from 'qrcode/lib/browser.js';" },
  { name: 'idb', entry: "export * from 'idb';" },
  { name: 'jsqr', entry: "export { default as jsQR } from 'jsqr';" },
  { name: 'fflate', entry: "export { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';" },
];

await mkdir(outdir, { recursive: true });

for (const { name, entry } of targets) {
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: `${name}.entry.js`, loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
    banner: { js: `/* vendored: ${name} — regenerate with \`npm run vendor\`, do not edit */` },
  });
  const [file] = result.outputFiles;
  await writeFile(join(outdir, `${name}.js`), file.text);
  console.log(`vendor/${name}.js  ${(file.contents.length / 1024).toFixed(1)} kB`);
}
