import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const ACTIVE_DIR = path.join(ROOT, 'docs', 'tickets', 'active');
const CLOSED_DIR = path.join(ROOT, 'docs', 'tickets', 'closed');
const TEMPLATE_PATH = path.join(ROOT, 'docs', 'tickets', 'TEMPLATE.md');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(message) {
  console.error(`Harness: ${message}`);
  process.exitCode = 1;
}

function ticketPath(id) {
  if (!/^BIOOS-\d{8}-\d{2,}$/.test(id || '')) throw new Error('ID inválido. Usa BIOOS-YYYYMMDD-NN.');
  const active = path.join(ACTIVE_DIR, `${id}.md`);
  const closed = path.join(CLOSED_DIR, `${id}.md`);
  return fs.existsSync(active) ? active : (fs.existsSync(closed) ? closed : active);
}

function parseScope(markdown, heading) {
  const section = markdown.match(new RegExp(`^### ${heading}\\s*$([\\s\\S]*?)(?=^### |^## |$(?![\\s\\S]))`, 'm'))?.[1] || '';
  return section.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!match) return [];
    const item = match[1].replace(/^`|`$/g, '').trim();
    return item && !item.startsWith('<') ? [item] : [];
  });
}

function globRegex(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { out += '.*'; i += 1; }
    else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${out}$`);
}

function changedFiles() {
  const tracked = git(['diff', '--name-only', 'HEAD']).split(/\r?\n/).filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
  return [...new Set([...tracked, ...untracked].map((p) => p.replace(/\\/g, '/')))];
}

function createTicket(id, title) {
  const target = ticketPath(id);
  if (!title || title.startsWith('<')) throw new Error('Falta --title "meta observable".');
  if (fs.existsSync(target) || fs.existsSync(path.join(CLOSED_DIR, `${id}.md`))) throw new Error(`Ya existe un ticket con ID ${id}.`);
  const date = id.slice(6, 10) + '-' + id.slice(10, 12) + '-' + id.slice(12, 14);
  let body = fs.readFileSync(TEMPLATE_PATH, 'utf8').replace(/^\uFEFF/, '').replace(/^# Ticket BioOS/m, `# ${id} — ${title}`);
  body = body.replace('`BIOOS-YYYYMMDD-NN`', `\`${id}\``)
    .replace('- ID: `BIOOS-YYYYMMDD-NN`', `- ID: \`${id}\``)
    .replace('- Título: `<acción y objeto>`', `- Título: ${title}`)
    .replace('- Fecha: `AAAA-MM-DD`', `- Fecha: \`${date}\``);
  fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
  console.log(`Ticket creado: ${path.relative(ROOT, target)}`);
}

function checkTicket(id) {
  const target = ticketPath(id);
  if (!fs.existsSync(target)) throw new Error(`No existe ${path.relative(ROOT, target)}.`);
  const markdown = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
  const status = markdown.match(/^- Estado:\s*`?([A-Z_]+)`?\s*$/m)?.[1];
  const required = [
    ['Título', /^- Título:\s*(?!<).+/m],
    ['Modo', /^- Modo:\s*`?(DIAGNOSIS|IMPLEMENTATION|REVIEW)`?/m],
    ['Fecha', /^- Fecha:\s*`?\d{4}-\d{2}-\d{2}`?/m],
    ['Rama/commit inicial', /^- Repo \/ rama \/ commit inicial:\s*(?!<).+/m],
    ['Evidencia inicial', /^- Qué ocurre ahora, con fuente\/fecha\/número si existe:\s*(?!$)/m],
    ['Resultado observable', /^- Qué debe ocurrir y cómo lo observa Alonso:\s*(?!$)/m]
  ];
  const missing = required.filter(([, regex]) => !regex.test(markdown)).map(([name]) => name);
  if (!['DIAGNOSIS', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'DONE', 'BLOCKED'].includes(status)) missing.push('Estado válido');
  const inScope = parseScope(markdown, 'Scope in');
  const outScope = parseScope(markdown, 'Scope out');
  if (!inScope.length) missing.push('al menos un patrón Scope in');
  if (!outScope.length) missing.push('al menos una ruta o acción Scope out');
  const criteria = markdown.match(/^- \[([ xX])\] .+$/gm) || [];
  if (!criteria.length) missing.push('criterios de aceptación');
  const ticketPaths = new Set([
    path.relative(ROOT, path.join(ACTIVE_DIR, `${id}.md`)).replace(/\\/g, '/'),
    path.relative(ROOT, path.join(CLOSED_DIR, `${id}.md`)).replace(/\\/g, '/')
  ]);
  const changed = changedFiles().filter((file) => !ticketPaths.has(file));
  const outside = changed.filter((file) => !inScope.some((glob) => globRegex(glob).test(file)) || outScope.some((glob) => globRegex(glob).test(file)));
  if (status === 'READY_FOR_REVIEW' || status === 'DONE') {
    if (criteria.some((line) => !/^\- \[[xX]\]/.test(line))) missing.push('todos los criterios marcados para DONE');
  }
  if (status === 'DONE') {
    for (const label of ['OBJETIVO', 'PUNTO', 'VISTO', 'CAUSA', 'SIGUIENTE']) {
      if (!new RegExp(`^${label}:\\s*(?!<).+`, 'm').test(markdown)) missing.push(`línea de cierre ${label}`);
    }
    if (!/Comandos no ejecutados y razón .*NOT RUN|Comandos ejecutados y resultado literal\/resumen:\s*(?!$).+/m.test(markdown)) {
      missing.push('evidencia de validación o NOT RUN explicado');
    }
  }
  console.log(`Ticket ${id} | estado=${status || 'inválido'} | archivos cambiados=${changed.length}`);
  if (missing.length) throw new Error(`Campos incompletos: ${missing.join(', ')}.`);
  if (outside.length) throw new Error(`Cambios fuera del alcance: ${outside.join(', ')}.`);
  console.log('PASS: campos requeridos y alcance de archivos válidos.');
}

function context() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
  const config = fs.readFileSync(path.join(ROOT, 'apps-script', '00_Sys_Config.js'), 'utf8');
  const version = config.match(/VERSION\s*:\s*["']([^"']+)["']/)?.[1] || 'unknown';
  const branch = git(['branch', '--show-current']) || '(detached)';
  const commit = git(['rev-parse', '--short=12', 'HEAD']);
  const dirty = changedFiles();
  console.log([
    `BioOS Core | package=${pkg.version} | runtime-source=${version}`,
    `Repo=${ROOT}`,
    `Git=${branch}@${commit} | ${dirty.length ? `${dirty.length} archivo(s) modificado(s)` : 'árbol limpio'}`,
    'Fuentes: AGENTS.md → docs/agent-harness/README.md → docs/ROADMAP.md → ticket activo → código/evidencia.',
    'Límite vigente: Health Connect Xiaomi sin puente; no declarar telemetría conectada ni publicar producción.'
  ].join('\n'));
}

function policy() {
  const requiredFiles = ['AGENTS.md', 'docs/agent-harness/README.md', 'docs/tickets/TEMPLATE.md'];
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
  const config = fs.readFileSync(path.join(ROOT, 'apps-script', '00_Sys_Config.js'), 'utf8');
  const sourceVersion = config.match(/VERSION\s*:\s*["']([^"']+)["']/)?.[1];
  if (!pkg.scripts.harness || !pkg.scripts.ticket) missing.push('npm harness/ticket commands');
  if (!sourceVersion || sourceVersion !== pkg.version) missing.push('package version matching BIOOS_CONFIG.VERSION');
  if (missing.length) throw new Error(`Harness incompleto: ${missing.join(', ')}.`);
  console.log(`PASS: harness policy files present; package/runtime version=${sourceVersion}.`);
}

function usage() {
  console.log('Uso:\n  npm run harness -- context\n  npm run harness -- policy\n  npm run ticket -- new BIOOS-YYYYMMDD-NN --title "Meta observable"\n  npm run ticket -- check BIOOS-YYYYMMDD-NN');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'context') context();
  else if (command === 'policy') policy();
  else if (command === 'ticket:new' || command === 'new') {
    const id = args[0];
    const titleIndex = args.indexOf('--title');
    createTicket(id, titleIndex >= 0 ? args[titleIndex + 1] : '');
  } else if (command === 'ticket:check' || command === 'check') checkTicket(args[0]);
  else usage();
} catch (error) {
  fail(error.message);
}
