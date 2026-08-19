/**
 * @typedef {{rhrBpm:(number|null), sleepMinutes:(number|null), steps:(number|null)}} Sensor_Data
 * @typedef {{rhrBpm:boolean, sleepMinutes:boolean, steps:boolean}} Sensor_MissingData
 * @typedef {{source:string, available:boolean, fetchedAt:string, sinceMs:number, data:Sensor_Data, missing:Sensor_MissingData, degraded:boolean, reason:(string|null), metadata:Object<string,*>}} Sensor_Snapshot
 * ISensor: fetchSnapshot({sinceMs:number}): Sensor_Snapshot. Providers never call orchestration, memory, or an LLM.
 */
var Sensor_HOURS_24_MS = 24 * 60 * 60 * 1000;
var Sensor_GOOGLE_FIT_FALLBACK_MS = 32 * 60 * 60 * 1000;
var Sensor_MAX_RESPONSE_CHARS = 1000000;
function Sensor_emptyData_() { return { rhrBpm: null, sleepMinutes: null, steps: null }; }
function Sensor_missingFor_(data) { return { rhrBpm: data.rhrBpm === null, sleepMinutes: data.sleepMinutes === null, steps: data.steps === null }; }
function Sensor_snapshot(source, sinceMs, data, reason, metadata) { var normalized = Sensor_normalizeData_(data || {}), missing = Sensor_missingFor_(normalized); return { source: source, available: !reason, fetchedAt: new Date().toISOString(), sinceMs: sinceMs, data: normalized, missing: missing, degraded: !!reason || missing.rhrBpm || missing.sleepMinutes || missing.steps, reason: reason || null, metadata: metadata || {} }; }
function Sensor_unavailableSnapshot(source, reason, metadata) { return Sensor_snapshot(source, Date.now() - Sensor_HOURS_24_MS, Sensor_emptyData_(), reason, metadata); }
function Sensor_normalizeData_(input) { var v = input && typeof input === 'object' ? input : {}, out = Sensor_emptyData_(); out.rhrBpm = Sensor_numberInRange_(v.rhrBpm, 20, 240); out.sleepMinutes = Sensor_numberInRange_(v.sleepMinutes, 0, 1440); out.steps = Sensor_numberInRange_(v.steps, 0, 200000); return out; }
function Sensor_numberInRange_(value, min, max) { var n = typeof value === 'number' ? value : Number(value); return isFinite(n) && n >= min && n <= max ? n : null; }
function Sensor_logWarning_(message) { if (typeof sendSystemTelemetry === 'function') sendSystemTelemetry('WARNING', message); }
function Sensor_safeError_(error) { return String(error && error.message || error || 'unknown').slice(0, 300); }
function Sensor_isHttpsUrl_(value) { return typeof value === 'string' && /^https:\/\/[^\s/?#]+(?:[/?#]|$)/i.test(value); }
function Sensor_boundedJson_(text) { if (typeof text !== 'string' || text.length > Sensor_MAX_RESPONSE_CHARS) throw new Error('RESPONSE_SIZE_OR_TYPE_INVALID'); return JSON.parse(text); }
