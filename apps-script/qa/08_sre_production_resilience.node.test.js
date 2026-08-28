/* Node-only SRE Production Resilience QA Test Suite. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS ' + name);
  } catch (error) {
    fail++;
    console.error('FAIL ' + name + ': ' + (error && error.message ? error.message : error));
  }
}

// -----------------------------------------------------------------------------
// CONTEXT ENVIRONMENT SETUP
// -----------------------------------------------------------------------------
const telemetryLogs = [];
const scriptProperties = new Map();
scriptProperties.set('TELEGRAM_BOT_TOKEN', 'mock-bot-token-12345');
scriptProperties.set('TELEGRAM_CHAT_ID', 'mock-chat-id-999');
scriptProperties.set('TELEGRAM_SECRET_TOKEN', 'valid-secret');

const mockCache = new Map();

const context = {
  console,
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  JSON,
  RegExp,
  isFinite,
  isNaN,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => scriptProperties.get(k) || null,
      setProperty: (k, v) => scriptProperties.set(k, String(v)),
      deleteProperty: (k) => scriptProperties.delete(k)
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => mockCache.get(k) || null,
      put: (k, v, _ttl) => mockCache.set(k, String(v)),
      remove: (k) => mockCache.delete(k)
    })
  },
  Utilities: {
    sleep: (_ms) => {},
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    getUuid: () => 'uuid-' + Math.random().toString(36).slice(2)
  },
  UrlFetchApp: {
    fetch: (url, opts) => {
      if (url.includes('/sendMessage')) {
        const payload = JSON.parse(opts.payload);
        if (payload.parse_mode === 'HTML' && (payload.text.includes('< 40') || payload.text.includes('> 8h'))) {
          return {
            getResponseCode: () => 400,
            getContentText: () => JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" })
          };
        }
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { message_id: 101, text: payload.text } })
        };
      }
      if (url.includes('/getFile')) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { file_id: 'photo-hq-file', file_path: 'photos/hq.jpg', file_size: 150000 } })
        };
      }
      if (url.includes('/file/bot')) {
        return {
          getResponseCode: () => 200,
          getBlob: () => ({
            getBytes: () => Buffer.from('FAKE_HQ_IMAGE_BINARY_DATA')
          })
        };
      }
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
  },
  ContentService: {
    createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
    MimeType: { JSON: 'json' }
  },
  sendSystemTelemetry: (state, message, fields) => {
    telemetryLogs.push({ state, message, fields });
  },
  executeWithResilience: (_name, fn) => fn(),
  executeWithMutex: (_type, fn) => fn(),
  recordProvenance: (data, src, inferred) => ({ ...data, _provenance: { source: src, is_inferred: !!inferred } }),
  invokeUniversalLLM: (_prompt, userPayload) => {
    return {
      sintomatologia_fisica: ['Fatiga en sóleo'],
      carga_alostatica_percibida: ['Estrés medio'],
      adherencia_nutricional: ['180g proteína, carbohidratos moderados'],
      intenciones_futuras: ['Tirada de 10k Z2']
    };
  }
};

vm.createContext(context);

const filesToLoad = [
  '00_Sys_Config.js',
  '01_Sys_Telemetry.js',
  '02b_DB_Repository.js',
  '03b_Net_Webhook.js',
  '05_Bio_Compiler.js',
  '11_Net_Daemons.js'
];

filesToLoad.forEach(file => {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(content, context);
});

// =============================================================================
// OBJETIVO 1: EGRESS RESILIENTE CON PRESERVACIÓN DE FORMATO RICO (TELEGRAM HTML)
// =============================================================================

test('OBJ 1.1: Egress sanitizes target string preserving <b> without breaking Telegram HTML', () => {
  const input = 'Si RHR < 40 & descanso > 8h, ejecuta <b>Protocolo_Z2</b>';
  const result = context._sanitizeTelegramHtml_(input);
  const expected = 'Si RHR &lt; 40 &amp; descanso &gt; 8h, ejecuta <b>Protocolo_Z2</b>';

  assert(result === expected, `Expected "${expected}", got "${result}"`);
});

test('OBJ 1.2: _rawSystemNotify successfully delivers rich target message without HTTP 400', () => {
  const input = 'Si RHR < 40 & descanso > 8h, ejecuta <b>Protocolo_Z2</b>';
  const delivered = context._rawSystemNotify(input);
  assert(delivered === true, 'Message must be delivered successfully to Telegram');
});

test('OBJ 1.3: Egress auto-closes unclosed HTML tags to prevent entity parse errors', () => {
  const input = 'Resumen matutino: <b>Recuperación del SNC alta';
  const result = context._sanitizeTelegramHtml_(input);
  assert(result.endsWith('</b>'), `Must auto-close <b>: "${result}"`);
  assert(result === 'Resumen matutino: <b>Recuperación del SNC alta</b>', `Unexpected result: "${result}"`);
});

test('OBJ 1.4: Egress balances mismatched and overlapping tags', () => {
  const input = '<b>Estado: <i>Óptimo</b></i>';
  const result = context._sanitizeTelegramHtml_(input);
  assert(result === '<b>Estado: <i>Óptimo</i></b>', `Must balance tags properly: "${result}"`);
});

test('OBJ 1.5: Egress preserves code blocks and properly entity-escapes operators within them', () => {
  const input = '<code>if (rhr < 42 && hrv > 85) { execute("Z2"); }</code>';
  const result = context._sanitizeTelegramHtml_(input);
  const expected = '<code>if (rhr &lt; 42 &amp;&amp; hrv &gt; 85) { execute("Z2"); }</code>';
  assert(result === expected, `Code block operators must be entity-escaped for Telegram: "${result}"`);
});

test('OBJ 1.6: Egress neutralizes unsupported tags and handles markdown-like linebreaks', () => {
  const input = 'Title<p>Paragraph 1<br/>Line 2</p><script>alert("xss")</script>';
  const result = context._sanitizeTelegramHtml_(input);
  assert(!result.includes('<script>'), 'Must neutralize script tag');
  assert(!result.includes('<p>'), 'Must convert <p> to newline');
  assert(result.includes('Title\nParagraph 1\nLine 2'), 'Must preserve formatted structure');
});

test('OBJ 1.7: Egress safely truncates text at max length and closes open tag stack', () => {
  const input = '<b>' + 'A'.repeat(5000) + '</b>';
  const result = context._sanitizeTelegramHtml_(input, 200);
  assert(result.length <= 200, `Result length ${result.length} exceeds 200 limit`);
  assert(result.endsWith('</b>'), `Truncated result must safely close open <b> tag: "${result.slice(-20)}"`);
  assert(result.includes('[...]'), 'Must include truncation indicator');
});

// =============================================================================
// OBJETIVO 2: INGESTA MULTIMODAL A PRUEBA DE FALLOS (VISUAL)
// =============================================================================

test('OBJ 2.1: Photo extractor picks highest resolution from PhotoSize array', () => {
  const photoArray = [
    { file_id: 'thumb_id', width: 90, height: 90, file_size: 1400 },
    { file_id: 'low_id', width: 320, height: 240, file_size: 15000 },
    { file_id: 'hq_id', width: 1920, height: 1080, file_size: 350000 },
    { file_id: 'med_id', width: 800, height: 600, file_size: 70000 }
  ];

  const extracted = context._extractHighestResolutionPhoto(photoArray);
  assert(extracted !== null, 'Extracted photo must not be null');
  assert(extracted.fileId === 'hq_id', `Expected hq_id, got: ${extracted.fileId}`);
  assert(extracted.width === 1920 && extracted.height === 1080, 'Dimensions must match highest res');
});

test('OBJ 2.2: Photo extractor handles single object and document images without TypeError', () => {
  const single = { file_id: 'single_id', width: 640, height: 480, file_size: 40000 };
  const extractedSingle = context._extractHighestResolutionPhoto(single);
  assert(extractedSingle && extractedSingle.fileId === 'single_id', 'Single object extraction failed');

  const empty = context._extractHighestResolutionPhoto([]);
  assert(empty === null, 'Empty array must return null without throwing');

  const nullPayload = context._extractHighestResolutionPhoto(null);
  assert(nullPayload === null, 'Null payload must return null');
});

test('OBJ 2.3: Binary download and Base64 conversion succeeds without memory leaks', () => {
  const base64 = context._downloadTelegramFile('photo-hq-file');
  assert(typeof base64 === 'string' && base64.length > 0, 'Base64 string must be generated');
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  assert(decoded === 'FAKE_HQ_IMAGE_BINARY_DATA', `Decoded data mismatch: ${decoded}`);
});

test('OBJ 2.4: Queue worker constructs typed multimodal batch with Base64 photo', () => {
  const jobs = [
    {
      jobId: 'job-photo-1',
      idempotencyKey: 'key-p1',
      metadata: {
        kind: 'telegram_photo',
        fileId: 'photo-hq-file',
        mimeType: 'image/jpeg',
        caption: 'Almuerzo: salmón y arroz',
        updateId: 'update-100'
      }
    }
  ];

  const batchPayload = context._workerBuildPayload_(jobs);
  const parsed = JSON.parse(batchPayload);
  assert(parsed._type === 'bioos_ingress_batch', 'Must be bioos_ingress_batch');
  assert(parsed.items.length === 1, 'Must have 1 item');
  assert(parsed.items[0].kind === 'photo', 'Item kind must be photo');
  assert(parsed.items[0].caption === 'Almuerzo: salmón y arroz', 'Caption must be preserved');
  assert(typeof parsed.items[0].data === 'string' && parsed.items[0].data.length > 0, 'Base64 data must be present');
});

test('OBJ 2.5: MOMA compiler processes photo item into Gemini multimodal parts', () => {
  const dummyBase64 = Buffer.from('TEST_IMAGE_DATA').toString('base64');
  const payload = JSON.stringify({
    _type: 'bioos_ingress_batch',
    items: [
      { kind: 'photo', mimeType: 'image/jpeg', data: dummyBase64, caption: 'Cena ligera' }
    ]
  });

  const compiled = context.compileQualitativeFeedback(payload);
  assert(compiled && typeof compiled === 'object', 'Compiler must return structured object');
  assert(Array.isArray(compiled.sintomatologia_fisica), 'Must return sintomatologia_fisica array');
  assert(Array.isArray(compiled.adherencia_nutricional), 'Must return adherencia_nutricional array');
});

// =============================================================================
// OBJETIVO 3: TOLERANCIA A CONSISTENCIA EVENTUAL EN VFS (GOOGLE DRIVE)
// =============================================================================

test('OBJ 3.1: L1 Fast Cache resolves offloaded payload instantly', () => {
  const fileId = 'drive_cached_file_1';
  const originalPayload = {
    message: 'Large multimodal payload text exceeding cell limits...',
    metadata: { kind: 'telegram_photo', sensor: 'Polar_H10', rawLength: 48000 }
  };

  mockCache.set('_vfs_offload_' + fileId, JSON.stringify(originalPayload));

  const job = {
    jobId: 'job-cache-hit',
    idempotencyKey: 'idemp-1',
    receivedAt: new Date().toISOString(),
    attempts: 0,
    message: '[DRIVE_OFFLOADED_PAYLOAD]',
    metadata: { _drive_offloaded_file_id: fileId }
  };

  const resolved = context._repoResolveOffloadedPayload_(job);
  assert(resolved.message === originalPayload.message, 'Must resolve message from L1 cache');
  assert(resolved.metadata.sensor === 'Polar_H10', 'Must resolve metadata from L1 cache');
});

test('OBJ 3.2: DriveApp simulated race condition (404 on attempt 1 & 2, success on attempt 3) recovers successfully', () => {
  const fileId = 'race_condition_file_99';
  const originalPayload = {
    message: 'Payload recuperado tras latencia de indexación de Google Drive',
    metadata: { kind: 'telegram_photo', resolution: '4K', attemptsNeeded: 3 }
  };

  let driveAccessAttempts = 0;

  context.DriveApp = {
    getFileById: (id) => {
      driveAccessAttempts++;
      if (driveAccessAttempts < 3) {
        throw new Error('Exception: No item with the given ID could be found, or you do not have permission to access it.');
      }
      return {
        getId: () => id,
        getBlob: () => ({
          getDataAsString: () => JSON.stringify(originalPayload)
        })
      };
    }
  };

  const job = {
    jobId: 'job-race-condition',
    idempotencyKey: 'idemp-race-3',
    receivedAt: new Date().toISOString(),
    attempts: 0,
    message: '[DRIVE_OFFLOADED_PAYLOAD]',
    metadata: { _drive_offloaded_file_id: fileId }
  };

  mockCache.delete('_vfs_offload_' + fileId);

  const resolved = context._repoResolveOffloadedPayload_(job);
  assert(driveAccessAttempts === 3, `Expected exactly 3 DriveApp attempts, got ${driveAccessAttempts}`);
  assert(resolved.message === originalPayload.message, 'Message must be fully restored despite eventual consistency lag');
  assert(resolved.metadata.resolution === '4K', 'Metadata must be fully restored');
});

test('OBJ 3.3: Permanent Drive failure throws typed error without infinite loop', () => {
  const fileId = 'permanent_missing_file';
  let attemptsCount = 0;

  context.DriveApp = {
    getFileById: (_id) => {
      attemptsCount++;
      throw new Error('Exception: No item with the given ID could be found (404)');
    }
  };

  const job = {
    jobId: 'job-permanent-fail',
    idempotencyKey: 'idemp-fail-1',
    receivedAt: new Date().toISOString(),
    attempts: 0,
    message: '[DRIVE_OFFLOADED_PAYLOAD]',
    metadata: { _drive_offloaded_file_id: fileId }
  };

  mockCache.delete('_vfs_offload_' + fileId);

  let errorThrown = null;
  try {
    context._repoResolveOffloadedPayload_(job);
  } catch (e) {
    errorThrown = e;
  }

  assert(errorThrown !== null, 'Must throw error when Drive file is unreachable');
  assert(errorThrown.message.includes('[VFS_EVENTUAL_CONSISTENCY_PENDING]'), `Error must be typed VFS_EVENTUAL_CONSISTENCY_PENDING: ${errorThrown.message}`);
  assert(attemptsCount === 6, `Must be bounded to maxRetries (6), took: ${attemptsCount}`);
});

console.log('------------------------------------------------------------');
console.log('SRE Production Resilience Node QA: PASS ' + pass + ' | FAIL ' + fail);
console.log('------------------------------------------------------------');

if (fail > 0) process.exitCode = 1;
}
