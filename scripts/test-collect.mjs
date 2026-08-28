import fs from 'fs';
import path from 'path';

const home = process.env.USERPROFILE || process.env.HOME;
const claspRcPath = path.join(home, '.clasprc.json');
const claspConfigPath = path.join(process.cwd(), '.clasp.json');

const claspConfig = JSON.parse(fs.readFileSync(claspConfigPath, 'utf8'));
const scriptId = claspConfig.scriptId;

function getAccessToken() {
  const rc = JSON.parse(fs.readFileSync(claspRcPath, 'utf8'));
  return rc.tokens.default.access_token;
}

function collectLocalFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'qa' || entry.name === 'node_modules' || entry.name === '.git') continue;
      files = files.concat(collectLocalFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      if (relPath.endsWith('.node.test.js') || relPath.endsWith('.md')) continue;

      if (entry.name === 'appsscript.json') {
        files.push({
          name: 'appsscript',
          type: 'JSON',
          source: fs.readFileSync(fullPath, 'utf8')
        });
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.gs')) {
        // En GAS, los archivos en subcarpetas usan nombre con barra, ej. "core/01_Core_Constants"
        const nameWithoutExt = relPath.replace(/\.(js|gs)$/, '');
        files.push({
          name: nameWithoutExt,
          type: 'SERVER_JS',
          source: fs.readFileSync(fullPath, 'utf8')
        });
      } else if (entry.name.endsWith('.html')) {
        const nameWithoutExt = relPath.replace(/\.html$/, '');
        files.push({
          name: nameWithoutExt,
          type: 'HTML',
          source: fs.readFileSync(fullPath, 'utf8')
        });
      }
    }
  }

  return files;
}

const localFiles = collectLocalFiles(path.join(process.cwd(), 'apps-script'));
console.log(`Collected ${localFiles.length} local files for deployment.`);
console.log('Sample files:', localFiles.slice(0, 5).map(f => `${f.name} (${f.type})`));
