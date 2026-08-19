/* Node-only contracts. Apps Script loads this file as a no-op. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', '03b_Net_Webhook.js'), 'utf8');
const context = {
  console,
  Utilities: { getUuid: () => 'fake-uuid' },
  ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: { JSON: 'json' } }
};
vm.createContext(context); vm.runInContext(source, context);
function assert(ok, message) { if (!ok) throw new Error(message); }
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (error) { fail++; console.error('FAIL ' + name + ': ' + error.message); } }

test('text ingress has a stable Telegram idempotency key and no message payload metadata', () => {
  const options = context._netBuildIngressOptions_({ update_id: 44, message: { message_id: 9, chat: { id: 7 } } }, 'telegram_text');
  assert(options.idempotencyKey === 'telegram:update:44', 'key must derive only from update_id');
  assert(options.metadata.kind === 'telegram_text' && options.metadata.chatId === '7', 'text metadata incomplete');
  assert(!Object.prototype.hasOwnProperty.call(options.metadata, 'text'), 'metadata must not duplicate user text');
});
test('voice ingress stores a file reference instead of base64', () => {
  const options = context._netBuildIngressOptions_({ update_id: 45, message: { message_id: 10, chat: { id: 7 } } }, 'telegram_voice', { fileId: 'voice-file', fileSizeBytes: 123 });
  assert(options.idempotencyKey === 'telegram:update:45', 'voice key unstable');
  assert(options.metadata.fileId === 'voice-file' && !('data' in options.metadata), 'voice must be deferred to worker');
});
console.log('Job-flow Node QA: PASS ' + pass + ' | FAIL ' + fail);
if (fail) process.exitCode = 1;
}
