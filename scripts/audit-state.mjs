import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const rom = readJson('BioOS_ROM.json'); const nvram = readJson('BioOS_NVRAM.json');
const expected = ['fisiologo','somnologo','ejecutivo','endocrinologo','psicologo_cog'];
const prompts = rom.agent_prompts || {};
const backupsRoot = join(root, 'data', 'backups');
const backups = existsSync(backupsRoot) ? readdirSync(backupsRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /BioOS_(ROM|NVRAM)/.test(entry.name))
  .map((entry) => { const path = join(entry.parentPath || entry.path, entry.name); return { file: relative(root, path), bytes: statSync(path).size }; }) : [];
const l1 = ((nvram.L1_Working || {}).session_events || []); const archives = ((nvram.L2_Episodic || {}).weekly_archives || []); const lake = ((nvram.L2_Episodic || {}).raw_data_lake || []);
const report = {
  auditedAt: new Date().toISOString(), configTarget: '8.6.0',
  rom: { version: rom._version || null, promptIds: Object.keys(prompts).sort(), missingSpecialistPrompts: expected.filter((id) => !String(prompts[id] || '').trim()) },
  nvram: { bytes: statSync(join(root, 'BioOS_NVRAM.json')).size, schema: Number(nvram._bioos_memory_schema || 0), hasL0: !!nvram.L0_Ingestion_Cursors, counts: { l1Events: l1.length, l2Archives: archives.length, l2RawLake: lake.length }, latestL1Timestamp: l1.at(-1)?.timestamp || null, latestL2Timestamp: archives.at(-1)?.timestamp || null },
  backups,
  blockers: []
};
if (report.nvram.schema !== 2) report.blockers.push('NVRAM_REQUIRES_EXPLICIT_MIGRATION');
if (report.rom.missingSpecialistPrompts.length) report.blockers.push('ROM_SPECIALIST_PROMPTS_INCOMPLETE');
console.log(JSON.stringify(report, null, 2));