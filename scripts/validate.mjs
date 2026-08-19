import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(root, 'apps-script');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(sourceRoot);
const javascript = files.filter((file) => file.endsWith('.js'));
const runtimeJavaScript = javascript.filter((file) => !file.endsWith('.node.test.js'));
const failures = [];

for (const file of javascript) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`Sintaxis: ${relative(root, file)}\n${result.stderr.trim()}`);
  }
}

const declarations = new Map();
for (const file of runtimeJavaScript) {
  const source = readFileSync(file, 'utf8');
  const matcher = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  for (const match of source.matchAll(matcher)) {
    const locations = declarations.get(match[1]) ?? [];
    locations.push(relative(root, file));
    declarations.set(match[1], locations);
  }
}

for (const [name, locations] of declarations) {
  if (locations.length > 1) {
    failures.push(`Función global duplicada ${name}: ${locations.join(', ')}`);
  }
}

const combined = runtimeJavaScript.map((file) => readFileSync(file, 'utf8')).join('\n');
const forbidden = [
  [/\.setTrashed\s*\(\s*true\s*\)/, 'Borrado directo de Drive detectado'],
  [/https:\/\/script\.google\.com\/macros\/s\/AKfy[A-Za-z0-9_-]+\/exec/, 'Deployment ID fijado en código'],
  [/const\s+confirm\s*=\s*true/, 'Confirmación destructiva habilitada']
];

for (const [pattern, message] of forbidden) {
  if (pattern.test(combined)) failures.push(message);
}

const manifest = JSON.parse(readFileSync(join(sourceRoot, 'appsscript.json'), 'utf8'));
if (manifest.runtimeVersion !== 'V8') failures.push('appsscript.json debe usar runtime V8');

if (failures.length) {
  console.error(`BioOS validation: FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`BioOS validation: PASS | ${javascript.length} JS | ${declarations.size} funciones globales`);
