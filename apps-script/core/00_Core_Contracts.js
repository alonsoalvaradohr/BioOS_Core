// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * BioOS Core contracts.  These typedefs are documentation-only: Apps Script
 * has a shared global runtime, so contracts must not create runtime state.
 *
 * @typedef {{
 *   requestId: string,
 *   eventId: string,
 *   idempotencyKey: string,
 *   operation: string,
 *   startedAtMs: number,
 *   deadlineMs: number,
 *   source: string,
 *   correlation: Object<string, string>
 * }} Core_RequestContext
 *
 * @typedef {{
 *   code: string,
 *   category: string,
 *   message: string,
 *   retryable: boolean,
 *   details: Object<string, *>,
 *   causeName: string
 * }} Core_ErrorInfo
 *
 * @typedef {{ok: true, value: *, meta: Object<string, *>}}
 * Core_OkResult
 *
 * @typedef {{ok: false, error: Core_ErrorInfo, meta: Object<string, *>}}
 * Core_ErrorResult
 *
 * @typedef {Core_OkResult|Core_ErrorResult} Core_Result
 *
 * @typedef {{
 *   allowMarkdownFence: (boolean|undefined),
 *   expectedType: (string|undefined),
 *   validator: (function(*): (boolean|Core_Result)|undefined),
 *   maxChars: (number|undefined)
 * }} Core_StructuredJsonOptions
 */

/**
 * Stable names for cross-module operations.  Values, rather than free-form
 * strings, make telemetry joins and policy decisions auditable.
 */
const CORE_OPERATION = Object.freeze({
  WEBHOOK: 'webhook',
  QUEUE_WORKER: 'queue_worker',
  MEMORY_MUTATION: 'memory_mutation',
  LLM_GENERATION: 'llm_generation',
  TASK_CREATION: 'task_creation',
  HEALTH_CHECK: 'health_check'
});
