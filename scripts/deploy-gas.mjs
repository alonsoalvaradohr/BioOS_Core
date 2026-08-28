import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const home = process.env.USERPROFILE || process.env.HOME;
const claspRcPath = path.join(home, '.clasprc.json');
const claspConfigPath = path.join(process.cwd(), '.clasp.json');

const claspConfig = JSON.parse(fs.readFileSync(claspConfigPath, 'utf8'));
const scriptId = claspConfig.scriptId;

console.log('============================================================');
console.log('🚀 INICIANDO DESPLIEGUE A PRODUCCIÓN REAL (Google Apps Script)');
console.log(`📌 Script ID: ${scriptId}`);
console.log('============================================================\n');

// 1. REFRESCAR TOKEN OAUTH2
async function refreshAndGetToken() {
  const rc = JSON.parse(fs.readFileSync(claspRcPath, 'utf8'));
  const def = rc.tokens.default;

  const params = new URLSearchParams();
  params.append('client_id', def.client_id);
  params.append('client_secret', def.client_secret);
  params.append('refresh_token', def.refresh_token);
  params.append('grant_type', 'refresh_token');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Fallo al refrescar token OAuth2: ' + JSON.stringify(data));
  }

  def.access_token = data.access_token;
  def.expiry_date = Date.now() + (data.expires_in * 1000);
  fs.writeFileSync(claspRcPath, JSON.stringify(rc, null, 2), 'utf8');
  console.log('🔑 Token OAuth2 refrescado exitosamente.');
  return data.access_token;
}

// 2. RECOLECTAR ARCHIVOS LOCALES
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

async function deploy() {
  const token = await refreshAndGetToken();

  // PASO 1: Subir archivos (PUT /content)
  const localFiles = collectLocalFiles(path.join(process.cwd(), 'apps-script'));
  console.log(`📦 Empaquetados ${localFiles.length} archivos para subir.`);

  const putRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ files: localFiles })
  });

  const putData = await putRes.json();
  if (!putRes.ok) {
    throw new Error('Fallo al subir archivos a Apps Script: ' + JSON.stringify(putData));
  }
  console.log('✅ Archivos subidos exitosamente a Google Apps Script.');

  // PASO 2: Crear nueva versión inmutable (POST /versions)
  const versionDescription = `BioOS v6.1.0-PROD-LIVE - Real World SRE & Live Webhook Wiring (${new Date().toISOString()})`;
  const verRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/versions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ description: versionDescription })
  });

  const verData = await verRes.json();
  if (!verRes.ok) {
    throw new Error('Fallo al crear versión inmutable: ' + JSON.stringify(verData));
  }
  const newVersionNumber = verData.versionNumber;
  console.log(`🏷️ Nueva Versión Inmutable Creada: Version ${newVersionNumber} ("${versionDescription}")`);

  // PASO 3: Listar y Actualizar Deployments (PUT /deployments/{id})
  const depListRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/deployments`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const depListData = await depListRes.json();

  const deployments = depListData.deployments || [];
  console.log(`🔄 Actualizando ${deployments.length} despliegues activos a la Version ${newVersionNumber}...`);

  const updatedDeployments = [];

  for (const dep of deployments) {
    const isHead = !dep.deploymentConfig || dep.deploymentConfig.versionNumber === undefined;
    if (isHead) {
      console.log(`- Deployment HEAD (${dep.deploymentId}) ya apunta al código actual.`);
      updatedDeployments.push({ deploymentId: dep.deploymentId, version: '@HEAD' });
      continue;
    }

    const updateRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/deployments/${dep.deploymentId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deploymentConfig: {
          scriptId: scriptId,
          versionNumber: newVersionNumber,
          description: versionDescription
        }
      })
    });

    const updateData = await updateRes.json();
    if (updateRes.ok) {
      console.log(`✅ Deployment ${dep.deploymentId} actualizado a Version ${newVersionNumber}`);
      updatedDeployments.push({ deploymentId: dep.deploymentId, version: newVersionNumber });
    } else {
      console.warn(`⚠️ No se pudo actualizar deployment ${dep.deploymentId}:`, updateData);
    }
  }

  console.log('\n🎉 ¡DESPLIEGUE A PRODUCCIÓN REAL COMPLETADO CON ÉXITO!');
  console.log('============================================================\n');

  return {
    versionNumber: newVersionNumber,
    description: versionDescription,
    deployments: updatedDeployments
  };
}

deploy().catch(err => {
  console.error('❌ ERROR FATAL EN EL DESPLIEGUE:', err);
  process.exitCode = 1;
});
