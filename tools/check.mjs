import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = JSON.parse(await readFile(path.join(root, 'SOURCES.json'), 'utf8'));
for (const file of sources.files) {
  const body = await readFile(path.join(root, file.local));
  const actual = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  if (actual !== file.git_blob) throw new Error(`Upstream mismatch: ${file.local}`);
}
let checked = 0;
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(filename);
    else if (/\.(m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${filename}`);
      checked++;
    }
  }
}
await checkDirectory(path.join(root, 'dist'));
await checkDirectory(path.join(root, 'tools'));
const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
if (/https?:[^"']+\.(?:js|css|woff2?)/.test(html)) throw new Error('Unexpected external runtime dependency');
console.log(`PASS: upstream ${sources.files.length} files unchanged; ${checked} JavaScript files parsed; no external runtime assets.`);
