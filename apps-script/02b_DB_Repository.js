// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/** BioOS L0 repository. Owns Spreadsheet I/O and one ScriptLock per operation. */
var REPO_DB_ID_PROPERTY_='BIOOS_DB_ID', REPO_DB_NAME_PROPERTY_='BIOOS_DB_NAME', REPO_DB_NAME_DEFAULT_='BioOS_Database';
var REPO_QUEUE_NAME_='Queue_NLP', REPO_QUEUE_HEADERS_=['RECEIVED_AT','JOB_ID','IDEMPOTENCY_KEY','STATUS','ATTEMPTS','LEASE_UNTIL','MESSAGE','METADATA_JSON','LAST_ERROR'];
var REPO_QUEUE_LEGACY_HEADERS_=['TIMESTAMP','MESSAGE'], REPO_QUEUE_MAX_DEFAULT_=500;

/** Explicitly pins this deployment to one spreadsheet. */
function repoConfigureDatabase(spreadsheetId){if(!String(spreadsheetId||'').trim())throw new Error('[DB_CONFIG] spreadsheetId requerido.');return _repoWithLock_(function(){var ss=SpreadsheetApp.openById(String(spreadsheetId)),p=PropertiesService.getScriptProperties();p.setProperty(REPO_DB_ID_PROPERTY_,ss.getId());p.setProperty(REPO_DB_NAME_PROPERTY_,ss.getName());return {spreadsheetId:ss.getId(),name:ss.getName(),configured:true};});}

/** Name lookup exists only for first migration and rejects ambiguous Drive results. */
function _getDatabaseConnection(){var p=PropertiesService.getScriptProperties(),id=p.getProperty(REPO_DB_ID_PROPERTY_);if(id){try{return SpreadsheetApp.openById(id);}catch(e){throw new Error('[DB_UNAVAILABLE] BIOOS_DB_ID configurado pero inaccesible: '+_repoSafeError_(e));}}var name=p.getProperty(REPO_DB_NAME_PROPERTY_)||REPO_DB_NAME_DEFAULT_,files=DriveApp.searchFiles("title = '"+_repoEscapeDriveTitle_(name)+"' and trashed = false");if(!files.hasNext())throw new Error("[DB_NOT_CONFIGURED] No existe '"+name+"'. Ejecuta repoConfigureDatabase(spreadsheetId).");var first=files.next();if(files.hasNext())throw new Error("[DB_AMBIGUOUS] Hay más de una hoja llamada '"+name+"'. Ejecuta repoConfigureDatabase(spreadsheetId).");var ss=SpreadsheetApp.openById(first.getId());p.setProperty(REPO_DB_ID_PROPERTY_,ss.getId());p.setProperty(REPO_DB_NAME_PROPERTY_,ss.getName());return ss;}

/** Read-only; suitable for health checks because it creates nothing and never repairs caches. */
function repoGetDatabaseStatus(){var id=PropertiesService.getScriptProperties().getProperty(REPO_DB_ID_PROPERTY_);try{if(!id)return {ok:false,configured:false,reason:'BIOOS_DB_ID ausente.'};var ss=SpreadsheetApp.openById(id),q=ss.getSheetByName(REPO_QUEUE_NAME_);return {ok:!!q,configured:true,spreadsheetId:ss.getId(),queuePresent:!!q,queueRows:q?Math.max(0,q.getLastRow()-1):0};}catch(e){return {ok:false,configured:!!id,reason:_repoSafeError_(e)};}}

/** v4-compatible enqueue. New ingress can pass {idempotencyKey, metadata, jobId}. */
function repoEnqueueNLP(messageText,options){return repoEnqueueNLPBatch([{message:messageText,options:options||{}}])[0];}
/** One lock plus one setValues write for a batch. A full queue fails closed, never drops data. */
function repoEnqueueNLPBatch(entries){if(!Array.isArray(entries)||!entries.length)return [];return _repoWithLock_(function(){var s=_repoRequireQueueSheet_(_getDatabaseConnection()),existing=_repoReadQueueRows_(s),seen=_repoIndexIdempotency_(existing),max=_repoQueueMax_(),rows=[],result=[];entries.forEach(function(entry,i){var job=_repoNormaliseJob_(entry,i);if(seen[job.idempotencyKey]){result.push({accepted:false,duplicate:true,jobId:seen[job.idempotencyKey],idempotencyKey:job.idempotencyKey});return;}if(existing.length+rows.length>=max)throw new Error('[QUEUE_CAPACITY] L0 alcanzó el límite de '+max+' jobs; no se descartó ninguna entrada.');seen[job.idempotencyKey]=job.jobId;rows.push(_repoJobToRow_(job));result.push({accepted:true,duplicate:false,jobId:job.jobId,idempotencyKey:job.idempotencyKey,status:job.status});});if(rows.length)s.getRange(s.getLastRow()+1,1,rows.length,REPO_QUEUE_HEADERS_.length).setValues(rows);return result;});}

/** Legacy drain returns strings expected by 11_Net_Daemons. Durable jobs are marked terminal atomically. */
function repoDrainNLPQueue(){return _repoWithLock_(function(){var s=_repoRequireQueueSheet_(_getDatabaseConnection()),rows=_repoReadQueueRows_(s),messages=[];rows.forEach(function(j){if(j.status==='pending'||(j.status==='processing'&&j.leaseUntil&&new Date(j.leaseUntil).getTime()<=Date.now())){j.status='completed';j.attempts++;j.leaseUntil='';j.lastError='';if(j.message)messages.push(j.message);}});if(messages.length)_repoWriteQueueRows_(s,rows);return messages;});}
/** Leases pending/expired jobs without deleting durable state. */
function repoClaimNLPJobs(limit,leaseMs){var cap=Math.max(1,Math.min(Number(limit)||1,_repoQueueMax_())),lease=Math.max(0,Number(leaseMs)||0);return _repoWithLock_(function(){var s=_repoRequireQueueSheet_(_getDatabaseConnection()),rows=_repoReadQueueRows_(s),now=new Date(),until=lease?new Date(now.getTime()+lease).toISOString():'',claimed=[],dirty=false;rows.forEach(function(j){var expired=j.status==='processing'&&j.leaseUntil&&new Date(j.leaseUntil).getTime()<=now.getTime();if(claimed.length<cap&&(j.status==='pending'||expired)){j.status='processing';j.attempts++;j.leaseUntil=until;j.lastError='';claimed.push(_repoPublicJob_(j));dirty=true;}});if(dirty)_repoWriteQueueRows_(s,rows);return claimed;});}
/** Completes only previously claimed jobs. */
function repoCompleteNLPJobs(jobIds,status,errorMessage){var ids=_repoIdSet_(jobIds),terminal=status==='failed'?'failed':'completed';if(!Object.keys(ids).length)return 0;return _repoWithLock_(function(){var s=_repoRequireQueueSheet_(_getDatabaseConnection()),rows=_repoReadQueueRows_(s),changed=0;rows.forEach(function(j){if(ids[j.jobId]&&j.status==='processing'){j.status=terminal;j.leaseUntil='';j.lastError=terminal==='failed'?String(errorMessage||'').substring(0,1000):'';changed++;}});if(changed)_repoWriteQueueRows_(s,rows);return changed;});}
/** Removes queue jobs only; no nested locks and no mutation outside Queue_NLP. */
function repoEmergencyPurgeQueue(){return _repoWithLock_(function(){var s=_repoRequireQueueSheet_(_getDatabaseConnection()),count=Math.max(0,s.getLastRow()-1);if(count)s.deleteRows(2,count);return count;});}
function repoFlushTelemetryBatch(batch){if(!Array.isArray(batch)||!batch.length)return 0;return _repoWithLock_(function(){var ss=_getDatabaseConnection(),s=_requireSheet_(ss,BIOOS_CONFIG.LOGGING.TELEMETRY_SHEET,['TIMESTAMP','STATE','MESSAGE','EXEC_TIME_MS']);s.getRange(s.getLastRow()+1,1,batch.length,4).setValues(batch);return batch.length;});}

function _repoRequireQueueSheet_(ss){var s=ss.getSheetByName(REPO_QUEUE_NAME_);if(!s)return _requireSheet_(ss,REPO_QUEUE_NAME_,REPO_QUEUE_HEADERS_);_repoMigrateQueueSheet_(s);return s;}
function _repoMigrateQueueSheet_(s){var width=Math.max(REPO_QUEUE_HEADERS_.length,s.getLastColumn()||0);var h=s.getLastRow()?s.getRange(1,1,1,width).getValues()[0]:[];var isCurrent=REPO_QUEUE_HEADERS_.every(function(hdr,idx){return h[idx]===hdr;});if(isCurrent)return;var legacy=h[0]===REPO_QUEUE_LEGACY_HEADERS_[0]&&h[1]===REPO_QUEUE_LEGACY_HEADERS_[1];var old=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,Math.min(width,9)).getValues():[];s.clearContents();s.getRange(1,1,1,REPO_QUEUE_HEADERS_.length).setValues([REPO_QUEUE_HEADERS_]);s.setFrozenRows(1);if(old.length){var migrated=old.map(function(r,i){if(legacy){return _repoJobToRow_(_repoNormaliseJob_({message:String(r[1]||''),options:{receivedAt:String(r[0]||''),idempotencyKey:'legacy:'+i+':'+String(r[0]||'')}},i));}return [String(r[0]||new Date().toISOString()),String(r[1]||_repoUuid_()),String(r[2]||('migrated:'+i)),String(r[3]||'pending'),Number(r[4])||0,String(r[5]||''),String(r[6]||r[1]||r[0]||''),String(r[7]||'{}'),String(r[8]||'')];});s.getRange(2,1,migrated.length,REPO_QUEUE_HEADERS_.length).setValues(migrated);}}
function _repoReadQueueRows_(s){var n=Math.max(0,s.getLastRow()-1);if(!n)return [];return s.getRange(2,1,n,REPO_QUEUE_HEADERS_.length).getValues().map(function(r){return {receivedAt:String(r[0]||''),jobId:String(r[1]||''),idempotencyKey:String(r[2]||''),status:String(r[3]||'pending'),attempts:Number(r[4])||0,leaseUntil:String(r[5]||''),message:String(r[6]||''),metadataJson:String(r[7]||'{}'),lastError:String(r[8]||'')};});}
function _repoWriteQueueRows_(s,jobs){var count=Math.max(0,s.getLastRow()-1);if(count!==jobs.length)throw new Error('[QUEUE_STATE] Una transición de estado no puede cambiar el tamaño de L0.');if(jobs.length)s.getRange(2,1,jobs.length,REPO_QUEUE_HEADERS_.length).setValues(jobs.map(_repoJobToRow_));}
function _repoNormaliseJob_(entry,index){
  var source=entry||{},o=source.options||{},message=String(source.message===undefined?source:source.message||'');
  if(!message)throw new Error('[QUEUE_VALIDATION] El mensaje L0 no puede estar vacío.');
  var metadataObj = (o.metadata === undefined ? {} : o.metadata);
  var metadata = JSON.stringify(metadataObj);
  var cellLimit = _repoCellLimit_();

  // Bypass de celda: Si el mensaje o metadata excede el 80% del límite de Sheets, se traslada a Drive
  if(message.length > Math.floor(cellLimit * 0.8) || metadata.length > Math.floor(cellLimit * 0.8)) {
    var offloaded = _repoOffloadLargePayloadToDrive_(message, metadataObj);
    message = offloaded.message;
    metadata = JSON.stringify(offloaded.metadata);
  }

  var id=String(o.jobId||_repoUuid_());
  return {receivedAt:_repoIso_(o.receivedAt),jobId:id,idempotencyKey:String(o.idempotencyKey||('legacy:'+id)),status:'pending',attempts:0,leaseUntil:'',message:message,metadataJson:metadata,lastError:'',index:index};
}

function _repoOffloadLargePayloadToDrive_(message, metadata) {
  try {
    if (typeof DriveApp === 'undefined') return { message: message.substring(0, 35000) + '...[TRUNCATED]', metadata: metadata };
    var folder = null;
    try {
      var vfsNodes = typeof _getVfsNodes === 'function' ? _getVfsNodes() : null;
      folder = (vfsNodes && vfsNodes.folder) || null;
    } catch (_) {}
    if (!folder) {
      var fs = DriveApp.getFoldersByName('BioOS_Core');
      folder = fs.hasNext() ? fs.next() : DriveApp.getRootFolder();
    }
    var payloadContent = JSON.stringify({ message: message, metadata: metadata });
    var tempFile = folder.createFile('_tmp_l0_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.json', payloadContent, MimeType.PLAIN_TEXT);
    var fileId = tempFile.getId();

    // L1 Fast Cache: Almacenar en ScriptCache para resolución inmediata <2ms sin esperar consistencia de Drive
    try {
      if (typeof CacheService !== 'undefined') {
        var scriptCache = CacheService.getScriptCache();
        if (scriptCache && payloadContent.length < 100000) {
          scriptCache.put('_vfs_offload_' + fileId, payloadContent, 600);
        }
      }
    } catch (_) {}

    var cleanMeta = Object.assign({}, metadata, { _drive_offloaded_file_id: fileId });
    return {
      message: '[DRIVE_OFFLOADED_PAYLOAD]',
      metadata: cleanMeta
    };
  } catch (e) {
    return { message: message.substring(0, 35000) + '...[TRUNCATED]', metadata: metadata };
  }
}

/**
 * Recupera de manera resiliente el payload delegado en Google Drive tolerando
 * la latencia de indexación (consistencia eventual) de hasta 5+ segundos mediante
 * fast-cache L1, active polling y backoff exponencial con jitter.
 */
function _repoResolveOffloadedPayload_(job) {
  if (!job || !job.metadata || !job.metadata._drive_offloaded_file_id) return job;
  var fileId = String(job.metadata._drive_offloaded_file_id);

  // 1. Fast Cache Layer (L1): Comprobar ScriptCache
  try {
    if (typeof CacheService !== 'undefined') {
      var scriptCache = CacheService.getScriptCache();
      if (scriptCache) {
        var cached = scriptCache.get('_vfs_offload_' + fileId);
        if (cached) {
          var parsedCache = JSON.parse(cached);
          return {
            jobId: job.jobId,
            idempotencyKey: job.idempotencyKey,
            receivedAt: job.receivedAt,
            attempts: job.attempts,
            message: parsedCache.message || job.message,
            metadata: parsedCache.metadata || job.metadata
          };
        }
      }
    }
  } catch (_) {}

  // Si DriveApp no está disponible (ej. entorno sin VFS)
  if (typeof DriveApp === 'undefined') return job;

  // 2. Resilient Polling con Backoff Exponencial y Jitter (L2 Drive Eventual Consistency)
  var maxRetries = 6;
  var delayMs = 250;
  var lastError = null;

  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      var file = DriveApp.getFileById(fileId);
      if (!file) throw new Error('[404] Archivo nulo retornado por DriveApp.');

      var rawData = file.getBlob().getDataAsString();
      if (!rawData || !rawData.trim()) throw new Error('[EMPTY_FILE] Archivo Drive aún sin contenido.');

      var content = JSON.parse(rawData);

      // Guardar en caché L1 para consultas posteriores
      try {
        if (typeof CacheService !== 'undefined' && rawData.length < 100000) {
          var sc = CacheService.getScriptCache();
          if (sc) sc.put('_vfs_offload_' + fileId, rawData, 600);
        }
      } catch (_) {}

      return {
        jobId: job.jobId,
        idempotencyKey: job.idempotencyKey,
        receivedAt: job.receivedAt,
        attempts: job.attempts,
        message: content.message || job.message,
        metadata: content.metadata || job.metadata
      };

    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        var jitter = Math.floor(Math.random() * 100);
        var sleepTime = delayMs + jitter;
        if (typeof sendSystemTelemetry === 'function') {
          sendSystemTelemetry('WARNING', '[VFS_CONSISTENCY_WAIT] Archivo Drive (' + fileId + ') en propagación de índice (intento ' + attempt + '/' + maxRetries + '). Esperando ' + sleepTime + 'ms...');
        }
        if (typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
          Utilities.sleep(sleepTime);
        }
        delayMs = Math.min(2500, delayMs * 2);
      }
    }
  }

  // 3. Si se agotaron los reintentos, registrar y lanzar error explícito
  if (typeof sendSystemTelemetry === 'function') {
    sendSystemTelemetry('ERROR', '[VFS_CONSISTENCY_TIMEOUT] No se pudo recuperar archivo delegado en Drive (' + fileId + ') tras ' + maxRetries + ' intentos: ' + (lastError ? lastError.message : 'Error'));
  }
  throw new Error('[VFS_EVENTUAL_CONSISTENCY_PENDING] Archivo Drive ' + fileId + ' no disponible tras ' + maxRetries + ' intentos: ' + (lastError ? lastError.message : 'Timeout'));
}

function _repoJobToRow_(j){return [j.receivedAt,j.jobId,j.idempotencyKey,j.status,j.attempts,j.leaseUntil,j.message,j.metadataJson,j.lastError];}
function _repoPublicJob_(j){
  var parsed = _repoParseMetadata_(j.metadataJson);
  var job = {jobId:j.jobId,idempotencyKey:j.idempotencyKey,receivedAt:j.receivedAt,attempts:j.attempts,message:j.message,metadata:parsed};
  if (parsed && parsed._drive_offloaded_file_id) {
    return _repoResolveOffloadedPayload_(job);
  }
  return job;
}
function _repoIndexIdempotency_(jobs){var out={};jobs.forEach(function(j){if(j.idempotencyKey)out[j.idempotencyKey]=j.jobId;});return out;}
function _repoIdSet_(ids){var out={};(Array.isArray(ids)?ids:[ids]).forEach(function(id){if(id!==undefined&&id!==null)out[String(id)]=true;});return out;}
function _repoIso_(v){var d=v?new Date(v):new Date();return isNaN(d.getTime())?new Date().toISOString():d.toISOString();}
function _repoUuid_(){return typeof Utilities!=='undefined'&&Utilities.getUuid?Utilities.getUuid():String(new Date().getTime())+'-'+Math.random().toString(36).slice(2);}
function _repoParseMetadata_(v){try{return JSON.parse(v||'{}');}catch(e){return {};}}
function _repoQueueMax_(){var max=Number(PropertiesService.getScriptProperties().getProperty('BIOOS_QUEUE_MAX_ROWS'));return isFinite(max)&&max>=1?Math.floor(max):REPO_QUEUE_MAX_DEFAULT_;}
function _repoCellLimit_(){return typeof BIOOS_CONFIG!=='undefined'&&BIOOS_CONFIG.MEMORY_LIMITS&&BIOOS_CONFIG.MEMORY_LIMITS.SHEET_CELL_MAX_CHARS||50000;}
function _repoEscapeDriveTitle_(v){return String(v).replace(/'/g,"\\'");}
function _repoSafeError_(e){return String(e&&e.message?e.message:e).replace(/[\r\n]+/g,' ').substring(0,300);}
function _repoWithLock_(work){if(typeof executeWithMutex!=='function')throw new Error('[DB_LOCK] executeWithMutex no disponible.');return executeWithMutex('SCRIPT',work);}
function _requireSheet_(ss,name,headers){var s=ss.getSheetByName(name);if(!s){s=ss.insertSheet(name);s.getRange(1,1,1,headers.length).setValues([headers]);s.setFrozenRows(1);}return s;}
