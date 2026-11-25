// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * QA fakes. These classes are deliberately in-memory only. Do not add Apps
 * Script service calls here: this is the boundary that keeps QA off production.
 */
function QA_assert(condition, message) {
  if (!condition) throw new Error('[QA_ASSERT] ' + message);
}

function QA_clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function QA_FakeLock() {
  this.held = false;
  this.acquireCount = 0;
}

QA_FakeLock.prototype.run = function (operation) {
  if (this.held) throw new Error('[QA_LOCK_REENTRANT] Nested lock acquisition rejected.');
  this.held = true;
  this.acquireCount++;
  try {
    return operation();
  } finally {
    this.held = false;
  }
};

function QA_FakeMemory(initialNvram) {
  this.lock = new QA_FakeLock();
  this.nvram = QA_clone(initialNvram);
  this.writeCount = 0;
}

QA_FakeMemory.prototype.read = function () {
  return QA_clone(this.nvram);
};

QA_FakeMemory.prototype.mutate = function (mutator) {
  var self = this;
  return this.lock.run(function () {
    var draft = QA_clone(self.nvram);
    var result = mutator(draft);
    QA_assert(result !== undefined, 'El mutator debe devolver el estado NVRAM resultante.');
    QA_assert(result.L1_Working, 'NVRAM requiere L1_Working.');
    self.nvram = QA_clone(result);
    self.writeCount++;
    return self.read();
  });
};

function QA_FakeQueue() {
  this.jobs = [];
  this.keys = {};
}

QA_FakeQueue.prototype.enqueue = function (job) {
  QA_assert(job && job.idempotencyKey, 'Cada job requiere idempotencyKey.');
  if (this.keys[job.idempotencyKey]) return { accepted: false, duplicate: true, jobId: this.keys[job.idempotencyKey] };
  var stored = QA_clone(job);
  stored.jobId = stored.jobId || 'job-' + (this.jobs.length + 1);
  stored.status = 'pending';
  stored.attempts = 0;
  this.keys[stored.idempotencyKey] = stored.jobId;
  this.jobs.push(stored);
  return { accepted: true, duplicate: false, jobId: stored.jobId };
};

QA_FakeQueue.prototype.claim = function (limit) {
  var claimed = [];
  var cap = Math.max(1, Number(limit) || 1);
  this.jobs.forEach(function (job) {
    if (claimed.length >= cap || job.status !== 'pending') return;
    job.status = 'processing';
    job.attempts++;
    claimed.push(QA_clone(job));
  });
  return claimed;
};

QA_FakeQueue.prototype.complete = function (jobId, status) {
  var terminal = status === 'failed' ? 'failed' : 'completed';
  var job = null;
  this.jobs.forEach(function (candidate) { if (candidate.jobId === jobId) job = candidate; });
  QA_assert(job, 'No se puede completar un job inexistente.');
  QA_assert(job.status === 'processing', 'Solo un job reclamado puede alcanzar un estado terminal.');
  job.status = terminal;
  return QA_clone(job);
};

function QA_FakeTelemetry() {
  this.buffer = [];
  this.persisted = [];
  this.failWrites = false;
}

QA_FakeTelemetry.prototype.event = function (event) {
  this.buffer.push(QA_clone(event));
};

QA_FakeTelemetry.prototype.flush = function () {
  var batch = this.buffer.slice();
  if (this.failWrites) return { flushed: 0, pending: this.buffer.length, retryable: true };
  this.persisted = this.persisted.concat(batch);
  this.buffer.splice(0, batch.length);
  return { flushed: batch.length, pending: this.buffer.length, retryable: false };
};
