/**
 * Resumable, read-only Google Fit history archive.
 * Raw points live in owner-controlled Drive shards; NVRAM/vector memory stores references only.
 */
var BIOOS_FIT_ARCHIVE_FOLDER = 'BioOS_Fit_Archive';
var BIOOS_FIT_ARCHIVE_CATALOG = 'BioOS_Fit_Archive_Catalog.json';
var BIOOS_FIT_ARCHIVE_JOB_KEY = 'BIOOS_FIT_ARCHIVE_JOB_V1';
var BIOOS_FIT_ARCHIVE_PAGE_SIZE = 1000;

function Sensor_GoogleFit_beginArchiveSync_(options) {
  var opts = options || {}, props = PropertiesService.getScriptProperties(), current = _bioosFitArchiveReadJob_();
  if (current && current.status === 'RUNNING') return { ok: true, alreadyRunning: true, job: _bioosFitArchivePublicJob_(current) };
  if (current && (current.status === 'PAUSED' || current.status === 'AUTH_REQUIRED') && (!opts.mode || opts.mode === 'backfill')) {
    current.status = 'RUNNING'; current.ownerChatId = String(opts.chatId || current.ownerChatId || ''); current.lastError = '';
    _bioosFitArchiveSaveJob_(current); _bioosFitArchiveScheduleWorker_(1000);
    return { ok: true, resumed: true, job: _bioosFitArchivePublicJob_(current) };
  }
  var now = Date.now(), days = Math.max(1, Math.min(365 * 20, Number(opts.days) || 365 * 20));
  var sinceMs = Number(opts.sinceMs) || (opts.mode === 'incremental' || opts.days ? now - (Number(opts.days) || 2) * Sensor_HOURS_24_MS : Date.UTC(2014, 0, 1));
  var endMs = Number(opts.endMs) || now;
  if (!(endMs > sinceMs) || endMs - sinceMs > 365 * 20 * Sensor_HOURS_24_MS) return { ok: false, reason: 'ARCHIVE_RANGE_INVALID' };
  var listed = _bioosFitArchiveListSources_();
  if (!listed.ok) return { ok: false, reason: listed.reason, httpStatus: listed.httpStatus || null };
  if (!listed.complete) return { ok: false, reason: 'GOOGLE_FIT_SOURCE_LIST_TRUNCATED', httpStatus: null };
  var sources = (listed.sources || []).filter(function(source) { return source && source.dataStreamId && source.dataType && source.dataType.name; });
  if (!sources.length) return { ok: false, reason: 'NO_AUTHORIZED_FIT_DATA_SOURCES', httpStatus: listed.httpStatus };
  var catalog = _bioosFitArchiveReadCatalog_();
  if (catalog.readError) return { ok: false, reason: 'ARCHIVE_CATALOG_UNREADABLE' };
  catalog.schemaVersion = 1;
  catalog.provider = 'google_fit_rest';
  catalog.updatedAt = new Date().toISOString();
  catalog.sources = sources.map(_bioosFitArchiveSourceCard_);
  catalog.archiveGaps = (catalog.archiveGaps || []).filter(function(gap) {
    return Number(gap.endMs) <= sinceMs || Number(gap.sinceMs) >= endMs;
  });
  catalog.lastSync = { status: 'RUNNING', startedAt: new Date().toISOString(), sinceMs: sinceMs, endMs: endMs, sourceCount: sources.length, shardsWritten: 0, pointsCopied: 0, gaps: [] };
  _bioosFitArchiveWriteCatalog_(catalog);
  var job = { schemaVersion: 1, status: 'RUNNING', mode: opts.mode || 'backfill', sinceMs: sinceMs, endMs: endMs,
    sourceIndex: 0, sources: sources.map(_bioosFitArchiveSourceCard_), pageToken: '', retries: 0,
    startedAt: new Date().toISOString(), ownerChatId: String(opts.chatId || ''), shardsWritten: 0, pointsCopied: 0 };
  props.setProperty(BIOOS_FIT_ARCHIVE_JOB_KEY, JSON.stringify(job));
  _bioosFitArchiveScheduleWorker_(1000);
  return { ok: true, job: _bioosFitArchivePublicJob_(job) };
}

function Sensor_GoogleFit_archiveStatus_() {
  var job = _bioosFitArchiveReadJob_(), catalog = _bioosFitArchiveReadCatalog_();
  return { job: job ? _bioosFitArchivePublicJob_(job) : null, catalog: { available: !!catalog.schemaVersion, updatedAt: catalog.updatedAt || null,
    sourceCount: (catalog.sources || []).length, shardCount: (catalog.shards || []).length,
    pointCount: (catalog.lastSync && catalog.lastSync.pointsCopied) || 0, lastSync: catalog.lastSync || null } };
}

function Sensor_GoogleFit_pauseArchiveSync_() {
  var job = _bioosFitArchiveReadJob_();
  if (!job || job.status !== 'RUNNING') return { ok: true, status: job ? job.status : 'IDLE' };
  job.status = 'PAUSED'; job.pausedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(BIOOS_FIT_ARCHIVE_JOB_KEY, JSON.stringify(job));
  _bioosFitArchiveDeleteWorkerTriggers_();
  return { ok: true, job: _bioosFitArchivePublicJob_(job) };
}

/** One page per invocation: bounded execution, atomic cursor, idempotent Drive shard. */
function Sensor_GoogleFit_archiveWorker_() {
  _bioosFitArchiveDeleteWorkerTriggers_();
  try { return executeWithMutex('SCRIPT', function() {
    var job = _bioosFitArchiveReadJob_();
    if (!job || job.status !== 'RUNNING') return { status: job ? job.status : 'IDLE' };
    if (job.sourceIndex >= job.sources.length) return _bioosFitArchiveComplete_(job);
    var source = job.sources[job.sourceIndex];
    var response = _bioosFitArchiveFetchDataset_(source.dataStreamId, job.sinceMs, job.endMs, job.pageToken);
    if (!response.ok) {
      if (response.httpStatus === 401) { job.status = 'AUTH_REQUIRED'; job.lastError = response.reason; _bioosFitArchiveSaveJob_(job); _bioosFitArchiveNotify_(job, 'La lectura Google Fit requiere revisar autorización; conservé el cursor para reanudar.'); return { status: job.status, reason: response.reason }; }
      if (response.httpStatus === 429 || response.httpStatus >= 500) {
        job.retries = Number(job.retries || 0) + 1; job.lastError = response.reason;
        if (job.retries > 5) { _bioosFitArchiveRecordGap_(job, source, response); _bioosFitArchiveAdvanceSource_(job); }
        _bioosFitArchiveSaveJob_(job); _bioosFitArchiveScheduleWorker_(Math.min(300000, 1000 * Math.pow(2, job.retries)));
        return { status: job.status, retry: job.retries, reason: response.reason };
      }
      _bioosFitArchiveRecordGap_(job, source, response);
      _bioosFitArchiveAdvanceSource_(job);
    } else {
      job.retries = 0; job.lastError = '';
      var points = response.dataset.point || [];
      if (points.length) {
        var shard = _bioosFitArchiveWriteShard_(source, job, response.dataset);
        if (shard && !shard.duplicate) { job.shardsWritten++; job.pointsCopied += points.length; }
      }
      _bioosFitArchiveAppendCatalogShard_(source, job, response.dataset, response.nextPageToken);
      if (response.nextPageToken) job.pageToken = response.nextPageToken;
      else _bioosFitArchiveAdvanceSource_(job);
    }
    _bioosFitArchiveSaveJob_(job);
    _bioosFitArchiveUpdateCatalogProgress_(job);
    if (job.sourceIndex >= job.sources.length) return _bioosFitArchiveComplete_(job);
    _bioosFitArchiveScheduleWorker_(1000);
    return { status: 'RUNNING', sourceIndex: job.sourceIndex, sourceCount: job.sources.length, shardsWritten: job.shardsWritten, pointsCopied: job.pointsCopied };
  }); } catch (error) {
    var job = _bioosFitArchiveReadJob_();
    if (job && job.status === 'RUNNING') {
      job.retries = Number(job.retries || 0) + 1; job.lastError = typeof Core_normalizeError === 'function' ? Core_normalizeError(error).code : 'ARCHIVE_WORKER_FAILURE';
      if (job.retries > 5) { job.status = 'PAUSED'; job.pausedAt = new Date().toISOString(); }
      _bioosFitArchiveSaveJob_(job);
      if (job.status === 'RUNNING') _bioosFitArchiveScheduleWorker_(Math.min(300000, 1000 * Math.pow(2, job.retries)));
      else _bioosFitArchiveNotify_(job, 'Pausé la sincronización tras varios errores de Drive/API. No borré el cursor ni los archivos; revisa <code>/syncfit status</code> y reanuda con <code>/syncfit</code>.');
      return { status: job.status, reason: job.lastError };
    }
    throw error;
  }
}

function Sensor_GoogleFit_archiveDailySync_() {
  var status = Sensor_GoogleFit_archiveStatus_();
  if (status.job && status.job.status === 'RUNNING') return { skipped: true, reason: 'ARCHIVE_BACKFILL_IN_PROGRESS' };
  return Sensor_GoogleFit_beginArchiveSync_({ days: 2, mode: 'incremental' });
}

/** Exact numeric query over archived original points; no embedding or generated values. */
function Sensor_GoogleFit_queryArchiveStats_(request) {
  var req = request || {}, typeName = String(req.dataTypeName || ''), startMs = Number(req.startMs) || 0, endMs = Number(req.endMs) || Date.now();
  var catalog = _bioosFitArchiveReadCatalog_();
  if (!catalog.schemaVersion) return { available: false, state: 'NOT_INITIALIZED', records: 0, source: 'google_fit_drive_archive' };
  if (catalog.readError) return { available: false, state: 'CATALOG_UNREADABLE', records: 0, source: 'google_fit_drive_archive' };
  if (!catalog.lastSync || catalog.lastSync.status !== 'COMPLETE' && catalog.lastSync.status !== 'RUNNING') return { available: false, state: 'SYNC_NOT_STARTED', records: 0, source: 'google_fit_drive_archive' };
  var coverage = catalog.coverage || [], coverageEndMs = coverage.reduce(function(maximum, item) { return Math.max(maximum, Number(item.endMs) || 0); }, 0);
  var effectiveEndMs = coverageEndMs ? Math.min(endMs, coverageEndMs) : startMs;
  var completeCoverage = effectiveEndMs > startMs && _bioosFitArchiveCoverageComplete_(coverage, startMs, effectiveEndMs);
  var typeGaps = (catalog.archiveGaps || []).filter(function(gap) { return gap.dataType === typeName && Number(gap.endMs) > startMs && Number(gap.sinceMs) < endMs; });
  if (typeGaps.length) completeCoverage = false;
  var shards = (catalog.shards || []).filter(function(shard) { return shard.dataTypeName === typeName && Number(shard.maxTimeMs) >= startMs && Number(shard.minTimeMs) <= endMs; });
  if (!shards.length) return { available: true, state: typeGaps.length ? 'ACCESS_GAP' : completeCoverage ? 'NO_MATCHING_POINTS' : 'COVERAGE_INCOMPLETE', records: 0, source: 'google_fit_drive_archive', completeCoverage: completeCoverage, coverageEndMs: coverageEndMs || null, gaps: typeGaps };
  var count = 0, min = null, max = null, sum = 0, firstAt = null, lastAt = null, provenance = {};
  shards.forEach(function(shard) {
    var file = DriveApp.getFileById(shard.fileId), blob = Utilities.ungzip(file.getBlob()), envelope = JSON.parse(blob.getDataAsString());
    (envelope.points || []).forEach(function(point) {
      var stampNs = String(point.endTimeNanos || point.startTimeNanos || ''), stampMs = Number(stampNs.slice(0, -6));
      if (!isFinite(stampMs) || stampMs < startMs || stampMs > effectiveEndMs) return;
      var val = _bioosFitPointNumber_(point.value && point.value[0]);
      if (val === null || !isFinite(val)) return;
      count++; sum += val; min = min === null ? val : Math.min(min, val); max = max === null ? val : Math.max(max, val);
      firstAt = firstAt === null || stampMs < firstAt ? stampMs : firstAt; lastAt = lastAt === null || stampMs > lastAt ? stampMs : lastAt;
      provenance[shard.dataStreamId] = true;
    });
  });
  return { available: true, state: count ? (typeGaps.length ? 'PARTIAL_ACCESS_GAP' : 'OBSERVED') : completeCoverage ? 'NO_POINTS_IN_WINDOW' : 'COVERAGE_INCOMPLETE', metric: typeName, min: min, max: max, average: count ? sum / count : null,
    records: count, firstAt: firstAt ? new Date(firstAt).toISOString() : null, lastAt: lastAt ? new Date(lastAt).toISOString() : null,
    source: 'google_fit_drive_archive', dataStreamIds: Object.keys(provenance), syncStatus: catalog.lastSync.status, completeCoverage: completeCoverage, coverageEndMs: coverageEndMs || null, gaps: typeGaps };
}

function _bioosFitArchiveCoverageComplete_(coverage, startMs, endMs) {
  var ranges = (coverage || []).map(function(item) { return { start: Number(item.sinceMs), end: Number(item.endMs) }; }).filter(function(r) { return isFinite(r.start) && isFinite(r.end); }).sort(function(a, b) { return a.start - b.start; });
  var cursor = startMs;
  for (var i = 0; i < ranges.length && cursor < endMs; i++) {
    if (ranges[i].end < cursor) continue;
    if (ranges[i].start > cursor) return false;
    cursor = Math.max(cursor, ranges[i].end);
  }
  return cursor >= endMs;
}

function _bioosFitArchiveListSources_() {
  var token = ScriptApp.getOAuthToken(), sources = [], pageToken = '';
  do {
    var url = 'https://www.googleapis.com/fitness/v1/users/me/dataSources' + (pageToken ? '?pageToken=' + encodeURIComponent(pageToken) : '');
    var response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false });
    var status = response.getResponseCode(), body = response.getContentText();
    if (status < 200 || status >= 300) return { ok: false, reason: 'GOOGLE_FIT_SOURCES_HTTP_' + status + ':' + Sensor_GoogleFit_safeHttpError_(body), httpStatus: status, sources: [] };
    var parsed = Sensor_boundedJson_(body); sources = sources.concat(parsed.dataSource || []); pageToken = parsed.nextPageToken || '';
  } while (pageToken && sources.length < 2000);
  return { ok: true, sources: sources, complete: !pageToken };
}

function _bioosFitArchiveFetchDataset_(dataSourceId, sinceMs, endMs, pageToken) {
  var startNs = String(Math.floor(sinceMs)) + '000000', endNs = String(Math.floor(endMs)) + '000000';
  var url = 'https://www.googleapis.com/fitness/v1/users/me/dataSources/' + encodeURIComponent(dataSourceId) + '/datasets/' + startNs + '-' + endNs + '?limit=' + BIOOS_FIT_ARCHIVE_PAGE_SIZE;
  if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
  var response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: false });
  var status = response.getResponseCode(), body = response.getContentText();
  if (status < 200 || status >= 300) return { ok: false, httpStatus: status, reason: 'GOOGLE_FIT_DATASET_HTTP_' + status + ':' + Sensor_GoogleFit_safeHttpError_(body) };
  var dataset = Sensor_boundedJson_(body);
  return { ok: true, dataset: dataset, nextPageToken: dataset.nextPageToken || '' };
}

function _bioosFitArchiveRoot_() {
  var props = PropertiesService.getScriptProperties(), folderId = props.getProperty('VFS_FOLDER_ID'), parent = null;
  if (folderId) { try { parent = DriveApp.getFolderById(folderId); } catch (_) {} }
  if (!parent && typeof _getVfsNodes === 'function') parent = _getVfsNodes().folder;
  if (!parent) throw new Error('[FIT_ARCHIVE_DRIVE_ROOT_MISSING] No se encontró la carpeta privada de memoria BioOS en Drive.');
  var folders = parent.getFoldersByName(BIOOS_FIT_ARCHIVE_FOLDER);
  return folders.hasNext() ? folders.next() : parent.createFolder(BIOOS_FIT_ARCHIVE_FOLDER);
}

function _bioosFitArchiveReadCatalog_() {
  try {
    var file = _bioosFitArchiveRoot_().getFilesByName(BIOOS_FIT_ARCHIVE_CATALOG);
    return file.hasNext() ? JSON.parse(file.next().getBlob().getDataAsString()) : { schemaVersion: 1, sources: [], shards: [], lastSync: null };
  } catch (error) { return { schemaVersion: 0, sources: [], shards: [], lastSync: null, readError: Sensor_safeError_(error) }; }
}

function _bioosFitArchiveCatalogId_() { var files = _bioosFitArchiveRoot_().getFilesByName(BIOOS_FIT_ARCHIVE_CATALOG); return files.hasNext() ? files.next().getId() : ''; }

function _bioosFitArchiveWriteCatalog_(catalog) {
  var root = _bioosFitArchiveRoot_(), files = root.getFilesByName(BIOOS_FIT_ARCHIVE_CATALOG), file = files.hasNext() ? files.next() : null;
  var content = JSON.stringify(catalog);
  if (_memUtf8ByteLength_(content) > 12000000) throw new Error('[FIT_ARCHIVE_CATALOG_LIMIT] El catálogo supera el límite defensivo.');
  if (file) file.setContent(content); else root.createFile(BIOOS_FIT_ARCHIVE_CATALOG, content, MimeType.PLAIN_TEXT);
}

function _bioosFitArchiveWriteShard_(source, job, dataset) {
  var points = dataset.point || [], json = JSON.stringify({ schemaVersion: 1, provider: 'google_fit_rest', fetchedAt: new Date().toISOString(),
    source: _bioosFitArchiveSourceCard_(source), queryWindow: { startMs: job.sinceMs, endMs: job.endMs }, minStartTimeNs: dataset.minStartTimeNs || null,
    maxEndTimeNs: dataset.maxEndTimeNs || null, points: points });
  var digest = _bioosFitArchiveSha256_(json), contentHash = _bioosFitArchiveSha256_(JSON.stringify(points)), dataType = String((source.dataType || {}).name || 'unknown').replace(/[^a-z0-9_.-]/gi, '_');
  var hashSource = _bioosFitArchiveSha256_(source.dataStreamId).slice(0, 16), times = points.map(function(p) { return Number(String(p.endTimeNanos || p.startTimeNanos || '0').slice(0, -6)); }).filter(isFinite);
  var minTime = times.length ? Math.min.apply(null, times) : job.sinceMs, maxTime = times.length ? Math.max.apply(null, times) : job.endMs;
  var name = 'fit-' + dataType + '-' + hashSource + '-' + minTime + '-' + maxTime + '-' + contentHash.slice(0, 16) + '.json.gz';
  var root = _bioosFitArchiveRoot_(), existing = root.getFilesByName(name);
  if (existing.hasNext()) return { duplicate: true, fileId: existing.next().getId(), fileName: name, checksum: digest, pointCount: points.length, minTimeMs: minTime, maxTimeMs: maxTime };
  var blob = Utilities.gzip(Utilities.newBlob(json, 'application/json', name.replace(/\.gz$/, '')), name);
  var file = root.createFile(blob); file.setDescription('BioOS private Google Fit raw archive; read-only export. Data type: ' + dataType + '; points: ' + points.length + '; SHA-256: ' + digest);
  return { duplicate: false, fileId: file.getId(), fileName: name, checksum: digest, pointCount: points.length, minTimeMs: minTime, maxTimeMs: maxTime };
}

function _bioosFitArchiveAppendCatalogShard_(source, job, dataset, nextPageToken) {
  var points = dataset.point || [];
  if (!points.length) return;
  var json = JSON.stringify({ sourceId: source.dataStreamId, pointCount: points.length, minStartTimeNs: dataset.minStartTimeNs || null, maxEndTimeNs: dataset.maxEndTimeNs || null, page: Number(job.pageCount || 0) });
  var digest = _bioosFitArchiveSha256_(JSON.stringify(points));
  var dataTypeName = (source.dataType || {}).name || 'unknown';
  var minMs = Math.min.apply(null, points.map(function(p) { return Number(String(p.endTimeNanos || p.startTimeNanos || '0').slice(0, -6)); }).filter(isFinite));
  var maxMs = Math.max.apply(null, points.map(function(p) { return Number(String(p.endTimeNanos || p.startTimeNanos || '0').slice(0, -6)); }).filter(isFinite));
  var shardName = 'fit-' + String(dataTypeName).replace(/[^a-z0-9_.-]/gi, '_') + '-' + _bioosFitArchiveSha256_(source.dataStreamId).slice(0, 16) + '-' + minMs + '-' + maxMs + '-' + digest.slice(0, 16) + '.json.gz';
  var root = _bioosFitArchiveRoot_(), files = root.getFilesByName(shardName); if (!files.hasNext()) return;
  var fileId = files.next().getId(), catalog = _bioosFitArchiveReadCatalog_();
  if (catalog.readError) throw new Error('[FIT_ARCHIVE_CATALOG_UNREADABLE] No se pudo actualizar el catálogo sin riesgo de perder el índice.');
  if (!Array.isArray(catalog.shards)) catalog.shards = [];
  if (catalog.shards.some(function(item) { return item.fileId === fileId; })) return;
  catalog.shards.push({ fileId: fileId, fileName: shardName, checksum: digest, dataStreamId: source.dataStreamId, dataTypeName: dataTypeName,
    minTimeMs: minMs, maxTimeMs: maxMs, pointCount: points.length, fetchedAt: new Date().toISOString(), pageCursorPresent: !!nextPageToken });
  catalog.updatedAt = new Date().toISOString();
  _bioosFitArchiveWriteCatalog_(catalog);
  job.pageCount = Number(job.pageCount || 0) + 1;
}

function _bioosFitArchiveRecordGap_(job, source, response) {
  var catalog = _bioosFitArchiveReadCatalog_(); if (!Array.isArray(catalog.archiveGaps)) catalog.archiveGaps = [];
  catalog.archiveGaps.push({ source: source.dataStreamId, dataType: (source.dataType || {}).name || 'unknown', sinceMs: job.sinceMs, endMs: job.endMs, httpStatus: response.httpStatus, reason: String(response.reason || 'FIT_SOURCE_UNAVAILABLE'), recordedAt: new Date().toISOString() });
  catalog.archiveGaps = catalog.archiveGaps.slice(-5000);
  if (!catalog.lastSync) catalog.lastSync = { gaps: [] };
  if (!Array.isArray(catalog.lastSync.gaps)) catalog.lastSync.gaps = [];
  catalog.lastSync.gaps.push(catalog.archiveGaps[catalog.archiveGaps.length - 1]);
  _bioosFitArchiveWriteCatalog_(catalog);
}

function _bioosFitArchiveAdvanceSource_(job) { job.sourceIndex++; job.pageToken = ''; job.pageCount = 0; job.retries = 0; }
function _bioosFitArchiveSaveJob_(job) { PropertiesService.getScriptProperties().setProperty(BIOOS_FIT_ARCHIVE_JOB_KEY, JSON.stringify(job)); }
function _bioosFitArchiveReadJob_() { try { var raw = PropertiesService.getScriptProperties().getProperty(BIOOS_FIT_ARCHIVE_JOB_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
function _bioosFitArchiveSourceCard_(source) { return { dataStreamId: String(source.dataStreamId || ''), dataType: source.dataType || {}, type: source.type || '', device: source.device || null, application: source.application || null }; }
function _bioosFitArchivePublicJob_(job) { return { status: job.status, mode: job.mode, startedAt: job.startedAt, sourceIndex: job.sourceIndex, sourceCount: (job.sources || []).length,
  shardsWritten: job.shardsWritten || 0, pointsCopied: job.pointsCopied || 0, since: new Date(job.sinceMs).toISOString(), until: new Date(job.endMs).toISOString(), lastError: job.lastError || null }; }
function _bioosFitArchiveUpdateCatalogProgress_(job) { var catalog = _bioosFitArchiveReadCatalog_(); if (!catalog.lastSync) catalog.lastSync = {}; catalog.lastSync.status = job.status; catalog.lastSync.sourceIndex = job.sourceIndex; catalog.lastSync.shardsWritten = job.shardsWritten; catalog.lastSync.pointsCopied = job.pointsCopied; catalog.lastSync.updatedAt = new Date().toISOString(); _bioosFitArchiveWriteCatalog_(catalog); }
function _bioosFitArchiveComplete_(job) {
  job.status = 'COMPLETE'; job.completedAt = new Date().toISOString(); _bioosFitArchiveSaveJob_(job);
  var catalog = _bioosFitArchiveReadCatalog_(); if (!catalog.lastSync) catalog.lastSync = {};
  catalog.lastSync.status = 'COMPLETE'; catalog.lastSync.completedAt = job.completedAt; catalog.lastSync.shardsWritten = job.shardsWritten; catalog.lastSync.pointsCopied = job.pointsCopied; catalog.lastSync.sourceCount = job.sources.length;
  if (!Array.isArray(catalog.coverage)) catalog.coverage = [];
  catalog.coverage.push({ sinceMs: job.sinceMs, endMs: job.endMs, completedAt: job.completedAt, mode: job.mode, sourceCount: job.sources.length, gaps: (catalog.lastSync.gaps || []).length });
  catalog.coverage = catalog.coverage.slice(-500);
  _bioosFitArchiveWriteCatalog_(catalog); _bioosFitArchiveInstallDailyTrigger_();
  if (typeof Memory_storeSemantic === 'function') Memory_storeSemantic({ text: 'Archivo Google Fit en Drive BioOS: ' + job.sources.length + ' fuentes, ' + job.shardsWritten + ' shards y ' + job.pointsCopied + ' puntos; ventana ' + new Date(job.sinceMs).toISOString().slice(0, 10) + ' a ' + job.completedAt.slice(0, 10) + '. Catálogo durable consultable por tipo y periodo.', type: 'telemetry_archive', source: 'google_fit_drive_archive', status: 'observed', evidenceIds: [_bioosFitArchiveCatalogId_()], ttlDays: 365 });
  _bioosFitArchiveNotify_(job, 'Sincronización histórica Google Fit finalizada. Fuentes consultadas: ' + job.sources.length + '; shards raw: ' + job.shardsWritten + '; puntos copiados: ' + job.pointsCopied + '. Huecos/permisos: ' + ((catalog.lastSync.gaps || []).length) + '.');
  return { status: 'COMPLETE', shardsWritten: job.shardsWritten, pointsCopied: job.pointsCopied, gaps: (catalog.lastSync.gaps || []).length };
}
function _bioosFitArchiveNotify_(job, message) { if (job && job.ownerChatId && typeof _rawSystemNotify === 'function') _rawSystemNotify(message, job.ownerChatId); }
function _bioosFitArchiveScheduleWorker_(afterMs) {
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.some(function(t) { return t.getHandlerFunction() === 'Sensor_GoogleFit_archiveWorker_'; })) return;
  ScriptApp.newTrigger('Sensor_GoogleFit_archiveWorker_').timeBased().after(Math.max(1000, Number(afterMs) || 1000)).create();
}
function _bioosFitArchiveDeleteWorkerTriggers_() { ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'Sensor_GoogleFit_archiveWorker_'; }).forEach(function(t) { try { ScriptApp.deleteTrigger(t); } catch (_) {} }); }
function _bioosFitArchiveInstallDailyTrigger_() {
  if (ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'Sensor_GoogleFit_archiveDailySync_'; })) return;
  ScriptApp.newTrigger('Sensor_GoogleFit_archiveDailySync_').timeBased().atHour(3).everyDays(1).inTimezone('America/Costa_Rica').create();
}
function _bioosFitArchiveSha256_(text) { var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8); return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function _bioosFitPointNumber_(value) { if (!value || typeof value !== 'object') return null; var keys = ['fpVal', 'intVal', 'mapVal', 'stringVal']; for (var i = 0; i < keys.length; i++) if (value[keys[i]] !== undefined && isFinite(Number(value[keys[i]]))) return Number(value[keys[i]]); return null; }
