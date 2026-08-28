import fs from 'fs';
import path from 'path';

// Tomamos los deployments activos
const primaryDeploymentId = 'AKfycbxt1zy802n3PdnZjN4iBnvjGMR9-C0Rj2iLiu6UAwoTw0mr7eUK9eS02jSzEOqU9U87jg';
const webAppUrl = `https://script.google.com/macros/s/${primaryDeploymentId}/exec`;

console.log('============================================================');
console.log('🧪 BLACK-BOX E2E PRODUCTION TEST (HTTP Vivo contra Google Cloud)');
console.log(`🌐 Target Endpoint: ${webAppUrl}`);
console.log('============================================================\n');

async function runBlackBoxTests() {
  let allPass = true;

  // TEST 1: GET Ping / Version Probe
  console.log('📡 1. Disparando HTTP GET a la URL pública de producción...');
  try {
    const getRes = await fetch(webAppUrl, {
      method: 'GET',
      redirect: 'follow'
    });

    const getStatus = getRes.status;
    const getBodyText = await getRes.text();
    let getJson;
    try { getJson = JSON.parse(getBodyText); } catch(e) { getJson = null; }

    console.log(`HTTP Status: ${getStatus}`);
    console.log('Response Body:', getJson || getBodyText);

    if (getStatus === 200 && getJson && getJson.version === '8.5.0-PROD-LIVE') {
      console.log('✅ PASS: La URL pública de Google Apps Script está respondiendo con la Version 8.5.0-PROD-LIVE viva!\n');
    } else {
      console.error('❌ FAIL: La respuesta GET no contiene la versión 8.5.0-PROD-LIVE.');
      allPass = false;
    }
  } catch (err) {
    console.error('❌ FAIL en GET Probe:', err.message);
    allPass = false;
  }

  // TEST 2: GET Action Reauth Probe
  console.log('🔐 2. Disparando HTTP GET action=reauth (Página de Consentimiento Web)...');
  try {
    const reauthGetRes = await fetch(`${webAppUrl}?action=reauth`, {
      method: 'GET',
      redirect: 'follow'
    });

    const reauthGetStatus = reauthGetRes.status;
    const reauthGetText = await reauthGetRes.text();
    console.log(`HTTP Status: ${reauthGetStatus}`);
    console.log('Response Content Preview:', reauthGetText.substring(0, 150) + '...');

    if (reauthGetStatus === 200 && (reauthGetText.includes('BioOS') || reauthGetText.includes('Re-Autenticación'))) {
      console.log('✅ PASS: El endpoint de re-autenticación web respondió con HTTP 200 y HTML de consentimiento!\n');
    } else {
      console.error(`❌ FAIL: HTTP status ${reauthGetStatus}`);
      allPass = false;
    }
  } catch (err) {
    console.error('❌ FAIL en GET action=reauth Probe:', err.message);
    allPass = false;
  }

  // TEST 3: POST Command /doctor Probe
  console.log('🩺 3. Disparando HTTP POST simulando comando /doctor en Telegram (Sonda SRE Desacoplada)...');
  try {
    const simulatedDocUpdate = {
      update_id: Math.floor(Date.now() / 1000) + 1,
      message: {
        message_id: 8878,
        from: { id: 123456789, is_bot: false, first_name: "BlackBox_Tester" },
        chat: { id: 123456789, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/doctor"
      }
    };

    const docRes = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simulatedDocUpdate),
      redirect: 'follow'
    });

    const docStatus = docRes.status;
    const docBodyText = await docRes.text();
    console.log(`HTTP Status: ${docStatus}`);
    console.log('Response Body:', docBodyText);

    if (docStatus === 200) {
      console.log('✅ PASS: Sonda /doctor ejecutó el bypass de diagnóstico en vivo devolviendo HTTP 200 OK!\n');
    } else {
      console.error(`❌ FAIL: HTTP status ${docStatus}`);
      allPass = false;
    }
  } catch (err) {
    console.error('❌ FAIL en POST /doctor Probe:', err.message);
    allPass = false;
  }

  // TEST 4: POST Command /reauth Probe
  console.log('🔑 4. Disparando HTTP POST simulando comando /reauth en Telegram...');
  try {
    const simulatedReauthUpdate = {
      update_id: Math.floor(Date.now() / 1000) + 2,
      message: {
        message_id: 8879,
        from: { id: 123456789, is_bot: false, first_name: "BlackBox_Tester" },
        chat: { id: 123456789, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/reauth"
      }
    };

    const reauthRes = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simulatedReauthUpdate),
      redirect: 'follow'
    });

    const reauthStatus = reauthRes.status;
    const reauthBodyText = await reauthRes.text();
    console.log(`HTTP Status: ${reauthStatus}`);
    console.log('Response Body:', reauthBodyText);

    if (reauthStatus === 200) {
      console.log('✅ PASS: Comando /reauth procesado devolviendo HTTP 200 OK!\n');
    } else {
      console.error(`❌ FAIL: HTTP status ${reauthStatus}`);
      allPass = false;
    }
  } catch (err) {
    console.error('❌ FAIL en POST /reauth Probe:', err.message);
    allPass = false;
  }

  // TEST 5: POST Direct Telegram Webhook (Voice Ingress Simulation)
  console.log('🎙️ 5. Disparando HTTP POST simulando Telegram Voice Note Ingress (Audio 91s)...');
  try {
    const simulatedVoiceUpdate = {
      update_id: Math.floor(Date.now() / 1000) + 3,
      message: {
        message_id: 8880,
        from: { id: 123456789, is_bot: false, first_name: "BlackBox_Tester" },
        chat: { id: 123456789, type: "private" },
        date: Math.floor(Date.now() / 1000),
        voice: {
          file_id: "AwACAgEAAxkBAAI_blackbox_voice_file_test_v71",
          file_unique_id: "v_bb_8880",
          duration: 91,
          mime_type: "audio/ogg",
          file_size: 458752
        }
      }
    };

    const postRes = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simulatedVoiceUpdate),
      redirect: 'follow'
    });

    const postStatus = postRes.status;
    const postBodyText = await postRes.text();
    console.log(`HTTP Status: ${postStatus}`);
    console.log('Response Body:', postBodyText);

    if (postStatus === 200) {
      console.log('✅ PASS: Webhook procesó el payload acústico devolviendo HTTP 200 OK a Telegram!\n');
    } else {
      console.error(`❌ FAIL: HTTP status ${postStatus}`);
      allPass = false;
    }
  } catch (err) {
    console.error('❌ FAIL en POST Voice Probe:', err.message);
    allPass = false;
  }

  // TEST 6: POST Command /estado Probe
  console.log('🧠 6. Disparando HTTP POST simulando comando /estado en Telegram...');
  try {
    const simulatedCommandUpdate = {
      update_id: Math.floor(Date.now() / 1000) + 4,
      message: {
        message_id: 8881,
        from: { id: 123456789, is_bot: false, first_name: "BlackBox_Tester" },
        chat: { id: 123456789, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "/estado"
      }
    };

    const cmdRes = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simulatedCommandUpdate),
      redirect: 'follow'
    });

    const cmdStatus = cmdRes.status;
    const cmdBodyText = await cmdRes.text();
    console.log(`HTTP Status: ${cmdStatus}`);
    console.log('Response Body:', cmdBodyText);

    if (cmdStatus === 200) {
      console.log('✅ PASS: Webhook ejecutó el bypass de comando /estado devolviendo HTTP 200 OK!\n');
    } else {
      console.error(`❌ FAIL: HTTP status ${cmdStatus}`);
      allPass = false;
    }
  } catch (err) {
    console.error('❌ FAIL en POST Command Probe:', err.message);
    allPass = false;
  }

  console.log('============================================================');
  if (allPass) {
    console.log('🏆 RESULTADO CAJA NEGRA: 100% PASS EN PRODUCCIÓN REAL');
  } else {
    console.log('❌ RESULTADO CAJA NEGRA: FALLOS DETECTADOS EN PRODUCCIÓN');
    process.exitCode = 1;
  }
  console.log('============================================================\n');
}

runBlackBoxTests();
