import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const home = process.env.USERPROFILE || process.env.HOME;
if (!home) throw new Error('No se encontró el directorio del usuario.');
const claspRcPath = path.join(home, '.clasprc.json');
const claspConfig = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8'));
const scriptId = claspConfig.scriptId;
const deploymentIds = String(process.env.BIOOS_GAS_DEPLOYMENT_IDS || process.env.BIOOS_GAS_DEPLOYMENT_ID || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
if (!deploymentIds.length) throw new Error('Define BIOOS_GAS_DEPLOYMENT_ID o BIOOS_GAS_DEPLOYMENT_IDS para seleccionar deployments explícitamente.');
const executionDeploymentId = String(process.env.BIOOS_GAS_EXECUTION_DEPLOYMENT_ID || '').trim();
if (!executionDeploymentId) throw new Error('Define BIOOS_GAS_EXECUTION_DEPLOYMENT_ID para reutilizar el deployment owner API existente.');

const configSource = fs.readFileSync(path.join(root, 'apps-script', '00_Sys_Config.js'), 'utf8');
const versionMatch = configSource.match(/VERSION\s*:\s*["']([^"']+)["']/);
if (!versionMatch) throw new Error('No se pudo leer BIOOS_CONFIG.VERSION.');
const bioosVersion = versionMatch[1];
const releaseTag = process.env.GITHUB_REF_NAME;
if (releaseTag && /^v\d/.test(releaseTag) && releaseTag.slice(1) !== bioosVersion) {
  throw new Error(`El tag ${releaseTag} no coincide con BIOOS_CONFIG.VERSION (${bioosVersion}).`);
}
const gitSha = process.env.GITHUB_SHA
  ? process.env.GITHUB_SHA.substring(0, 12)
  : execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const versionDescription = `BioOS ${bioosVersion} (${gitSha})`;

function collectLocalFiles(directory, baseDirectory = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(baseDirectory, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (['qa', 'node_modules', '.git'].includes(entry.name)) return [];
      return collectLocalFiles(fullPath, baseDirectory);
    }
    if (!entry.isFile() || relativePath.endsWith('.node.test.js') || relativePath.endsWith('.md')) return [];
    if (entry.name === 'appsscript.json') {
      return [{ name: 'appsscript', type: 'JSON', source: fs.readFileSync(fullPath, 'utf8') }];
    }
    if (entry.name.endsWith('.js') || entry.name.endsWith('.gs')) {
      return [{ name: relativePath.replace(/\.(js|gs)$/, ''), type: 'SERVER_JS', source: fs.readFileSync(fullPath, 'utf8') }];
    }
    if (entry.name.endsWith('.html')) {
      return [{ name: relativePath.replace(/\.html$/, ''), type: 'HTML', source: fs.readFileSync(fullPath, 'utf8') }];
    }
    return [];
  });
}

async function refreshAndGetToken() {
  const rc = JSON.parse(fs.readFileSync(claspRcPath, 'utf8'));
  const tokenConfig = rc && rc.tokens && rc.tokens.default;
  if (!tokenConfig || !tokenConfig.client_id || !tokenConfig.client_secret || !tokenConfig.refresh_token) {
    throw new Error('La credencial clasp local no contiene tokens OAuth completos.');
  }
  const params = new URLSearchParams({
    client_id: tokenConfig.client_id,
    client_secret: tokenConfig.client_secret,
    refresh_token: tokenConfig.refresh_token,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('No se pudo renovar OAuth para Google Apps Script.');
  // Keep credentials read-only on disk; do not persist the short-lived token.
  return data.access_token;
}

async function apiRequest(token, route, options = {}) {
  const response = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Apps Script API ${response.status} en ${route}: ${JSON.stringify(body)}`);
  return body;
}

async function deploy() {
  if (!fs.existsSync(claspRcPath)) throw new Error('No existe ~/.clasprc.json; autentica clasp en este entorno.');
  const token = await refreshAndGetToken();
  const deploymentList = await apiRequest(token, '/deployments');
  const deployments = Array.isArray(deploymentList.deployments) ? deploymentList.deployments : [];
  const selected = deploymentIds.map((id) => deployments.find((item) => item.deploymentId === id));
  const executionDeployment = deployments.find((item) => item.deploymentId === executionDeploymentId);
  if (selected.some((item) => !item)) throw new Error('Uno o más deployments seleccionados no existen; no se subieron archivos.');
  if (!executionDeployment) throw new Error('El deployment owner API seleccionado no existe; no se subieron archivos.');
  if (!(executionDeployment.entryPoints || []).some((point) => point.entryPointType === 'EXECUTION_API')) {
    throw new Error('BIOOS_GAS_EXECUTION_DEPLOYMENT_ID no apunta a un deployment EXECUTION_API; no se subieron archivos.');
  }
  if (selected.some((item) => !item.deploymentConfig || item.deploymentConfig.versionNumber === undefined)) {
    throw new Error('Un deployment seleccionado apunta a HEAD; el pipeline solo actualiza deployments versionados.');
  }

  const files = collectLocalFiles(path.join(root, 'apps-script'));
  if (!files.length) throw new Error('No hay archivos Apps Script para desplegar.');
  console.log(`Subiendo ${files.length} archivos para BioOS ${bioosVersion}.`);
  await apiRequest(token, '/content', { method: 'PUT', body: JSON.stringify({ files }) });

  const version = await apiRequest(token, '/versions', { method: 'POST', body: JSON.stringify({ description: versionDescription }) });
  if (!version.versionNumber) throw new Error('La API no devolvió un número de versión.');

  for (const id of deploymentIds) {
    await apiRequest(token, `/deployments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        deploymentConfig: {
          scriptId,
          versionNumber: version.versionNumber,
          description: versionDescription
        }
      })
    });
  }

  await apiRequest(token, `/deployments/${encodeURIComponent(executionDeploymentId)}`, {
    method: 'PUT',
    body: JSON.stringify({ deploymentConfig: { scriptId, versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: versionDescription + ' (owner API)' } })
  });
  console.log(`Actualizados ${deploymentIds.length} deployments web y el owner API existente al código ${bioosVersion} (versión GAS ${version.versionNumber}).`);
}

deploy().catch((error) => {
  console.error('Despliegue cancelado:', error.message);
  process.exitCode = 1;
});
