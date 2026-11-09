const configuredUrl = process.env.BIOOS_WEB_APP_URL;
if (!configuredUrl) {
  console.error('Define BIOOS_WEB_APP_URL para consultar el endpoint explícitamente configurado.');
  process.exit(2);
}

const url = new URL(configuredUrl);
if (url.protocol !== 'https:' || !url.hostname.endsWith('google.com')) {
  console.error('BIOOS_WEB_APP_URL debe ser un endpoint HTTPS de Google Apps Script.');
  process.exit(2);
}
url.searchParams.set('action', 'ping');

try {
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify({ status: response.status, body }, null, 2));
  if (!response.ok || !body || body.status !== 'ONLINE') process.exitCode = 1;
} catch (error) {
  console.error(`No se pudo consultar el endpoint: ${error.message}`);
  process.exitCode = 1;
}
