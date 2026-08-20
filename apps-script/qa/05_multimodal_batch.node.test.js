/* Node-only multimodal regression. Apps Script loads this file as a no-op. */
if (typeof require !== 'undefined') {
const fs = require('fs'); const path = require('path'); const vm = require('vm');
function assert(ok, message) { if (!ok) throw new Error(message); }
let captured;
const context = {
  console,
  executeWithResilience: (_name, fn) => fn(),
  recordProvenance: (value, source) => ({ value, source }),
  invokeUniversalLLM: (_prompt, payload) => { captured = payload; return { sintomatologia_fisica: [], carga_alostatica_percibida: [], adherencia_nutricional: [], intenciones_futuras: [] }; },
  _downloadTelegramVoice: () => 'QUJDRA=='
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '11_Net_Daemons.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '05_Bio_Compiler.js'), 'utf8'), context);
const envelope = context._workerBuildPayload_([
  { message: 'Dormí mejor', metadata: { kind: 'telegram_text', updateId: '1' }, idempotencyKey: 'a' },
  { message: '[VOICE_MESSAGE]', metadata: { kind: 'telegram_voice', fileId: 'voice-1', mimeType: 'audio/ogg', updateId: '2' }, jobId: 'j2', idempotencyKey: 'b' }
]);
const decoded = JSON.parse(envelope);
assert(decoded._type === 'bioos_ingress_batch' && decoded.items.length === 2, 'worker did not create typed batch');
context.compileQualitativeFeedback(envelope);
assert(Array.isArray(captured), 'compiler did not create Gemini multimodal parts');
assert(captured.some((part) => part.inlineData && part.inlineData.data === 'QUJDRA=='), 'audio part missing');
assert(captured.some((part) => part.text && part.text.includes('Dormí mejor')), 'associated text missing');
console.log('Multimodal batch Node QA: PASS');
}