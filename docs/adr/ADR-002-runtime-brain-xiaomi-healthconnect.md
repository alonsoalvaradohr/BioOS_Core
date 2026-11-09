# ADR-002: runtime brain, Xiaomi telemetry, and semantic retrieval

- Status: `ACCEPTED_FOR_IMPLEMENTATION`
- Date: `2026-11-09`
- Scope: the BioOS runtime brain (orchestrator, physiology, sleep, and nutrition agents), separate from the repository-development harness.

## Current observed state

- Production is on BioOS 8.7.1. The source provider `health_connect` returns `HEALTH_CONNECT_ANDROID_BRIDGE_NOT_INSTALLED`; Apps Script cannot read Health Connect on Alonso's phone by itself.
- Mi Fitness / Health Connect data is not connected to the deployed sensor engine. Existing Google Fit and Mobvoi code is not a Xiaomi Watch 2 integration.
- `BioOS_NVRAM.json` has L0-L4, but L1 keeps only 10 working events. The morning builder now reads recent L1 intents; this is short-term context, not a durable semantic memory.
- `apps-script/memory/01_Outcome_Ledger.js` prepares and validates outcome records as pure functions. It has no NVRAM/Drive persistence adapter and is not yet consumed by the orchestrator.
- There is no embedding provider, vector index, semantic retrieval adapter, or Android application in this repository. The Cloudflare Worker that fronts Telegram is also not source-controlled here.
- `scripts.run` currently fails because its OAuth client and Apps Script project do not share the same standard Google Cloud project. This affects owner-run Apps Script API operations; it is separate from Health Connect permissions.

## 1. Xiaomi Watch 2 -> BioOS data path

Use the supported route:

```text
Xiaomi Watch 2 -> Mi Fitness -> Android Health Connect -> BioOS Bridge (Android)
  -> authenticated Cloudflare Worker -> authenticated Apps Script doPost
  -> verified snapshot store -> sensor provider -> orchestrator
```

Xiaomi's documented Mi Fitness flow connects through **Profile -> Third-party data -> Health Connect** and requires Mi Fitness cloud sync for supported devices. Google documents Xiaomi watch/tracker data shared through Health Connect, including exercise heart rate, steps, distance, energy, sleep duration/stages/schedule, workout summaries, and weight. It also documents data that is not shared, including HRV, SpO2, VO2 max, and minute/hour energy. Therefore BioOS must not promise those metrics or manufacture RHR from exercise heart rate. Availability is device/app/version dependent and must be inspected on Alonso's phone.

The bridge should request read access only for the types BioOS actually consumes: steps, distance, total calories, sleep sessions, exercise sessions, heart-rate records, and optional weight if Alonso elects to use it. Do not request write access, routes/location, mail, calendar, or other health categories for this bridge. Capture each `DataOrigin`, record timestamp, zone/unit, and sync time. Discover the Xiaomi package/data origin on-device; do not assume or hard-code `com.xiaomi.wearable`. Deduplicate by Health Connect record ID and stable session ID. Keep provider timestamps distinct from bridge upload timestamps.

Foreground sync is the baseline. Background sync is optional and must gracefully fall back to foreground sync if Health Connect's separate background-read permission is absent or unavailable. Use Android WorkManager for deferred upload; do not poll continuously. For steps/calories, aggregate a defined day window and source set; do not add Mi Fitness aggregates to phone-native aggregates without deduplication.

The Apps Script provider returns only verified records within a freshness window. A missing value remains `null`; absent Health Connect RHR remains unavailable. Stale snapshots report `stale`, not zero and not live.

## 2. Authentication and trust boundaries

Health Connect grants the Android bridge per-data-type read permissions. It does not grant Apps Script access to the phone database and it does not require BioOS to collect the user's Mi Fitness password or Xiaomi OAuth token. The user connects Mi Fitness to Health Connect inside Mi Fitness, then separately approves BioOS Bridge's read permissions in Android.

For bridge-to-server authentication:

1. On first pairing, BioOS issues a random, single-use pairing code through Alonso's already-authorized private Telegram chat. The code expires after 10 minutes and is not logged.
2. The bridge generates an ECDSA P-256 signing key in Android Keystore. Its private key remains non-exportable; the public key and a device identifier are registered against the pairing code.
3. Each upload signs the method/path, timestamp, monotonic sequence, request ID, and SHA-256 body digest. The Worker verifies the signature, a short timestamp window, sequence/idempotency, payload schema, size, source, and allowed data types. It rejects replays and unknown devices.
4. The Worker forwards a normalized snapshot to Apps Script with a **separate** server-to-server HMAC secret. Apps Script validates the HMAC and freshness before accepting it. Store the HMAC in Worker secrets and Apps Script Script Properties; never ship it in the Android APK, Telegram webhook secret, Git, logs, or user-visible URLs.
5. Store public device keys and replay/idempotency state in a durable registry. Revoke a device key on unlink; provide a visible pause/revoke action in the bridge.

Do not reuse `TELEGRAM_SECRET_TOKEN` for the bridge. It authenticates a different principal and transport. Current `doPost` only accepts Telegram-shaped messages, so implementation must add a separate strict bridge envelope before the `update.message` check while keeping Telegram's current authentication path isolated. Apps Script does not expose the incoming HTTP headers in `doPost`; the Worker-to-GAS HMAC therefore has to be carried in a signed body envelope and verified server-side, not trusted because it came from a `workers.dev` URL.

The previous Apps Script API 403 is unrelated: `scripts.run` requires the calling OAuth client and Apps Script project to share a standard Google Cloud project, and its OAuth token must cover the script's scopes. The current manifest has a broad set of Fitness read/write, Drive, Sheets, Calendar, Tasks, and Gmail scopes. Before using `scripts.run` routinely, reduce scopes to actual runtime needs, link the intended standard Cloud project, enable Apps Script API there, and re-authorize. Do not confuse that owner-control setup with Health Connect's user permission screen.

## 3. The runtime second brain

### Separate records from embeddings

Use four distinct stores/contracts:

1. **Structured telemetry**: timestamped sensor records/sessions with source and units. Do not embed every step or heart-rate sample.
2. **Semantic memory atoms**: compact user-reported plans, confirmed outcomes, preferences, symptoms, stable constraints, and decisions. Each atom contains an ID, type, text, timestamp/validity, `source`, evidence IDs, state (`reported`, `observed`, `confirmed`, `superseded`), confidence, and retention policy.
3. **Vector index**: one dense embedding per semantic atom (or compact chunk), plus an opaque atom ID and minimal filter metadata. Original memory text remains in the owner-controlled durable store; vector metadata contains no raw biometrics, chat ID, or secrets.
4. **Outcome ledger**: durable decision/action/result links. Integrate the existing pure outcome-ledger module into the memory adapter; it must not infer that a prescribed workout was completed.

L1 remains a short-lived working buffer, not the durable brain. Retrieval should run for direct user requests and scheduled briefings, fetch a small top-k of relevant active atoms, then attach their source/status in the internal evidence payload. The response must distinguish Alonso-reported facts from sensor-observed facts. Expire stale plans, supersede changed preferences, deduplicate repeated records, and support explicit `/forget`/unlink behavior. Only user confirmation may promote a planned workout to completed outcome.

### Vector, matrix, tensor

An embedding for one memory is a vector of `d` numbers. Stacking `N` memory vectors creates an `N x d` matrix, which a vector index searches by cosine similarity. A tensor is useful for batched/multi-view model computations, but storing a 3D tensor is not required for BioOS semantic recall. Store one versioned vector per memory atom; keep time-series as structured records. Record the embedding model/version and re-index when that model changes. Measure the returned dimension before creating the index because vector index dimensions are immutable.

### Free-first implementation choice

Use the existing Cloudflare edge account only after its Worker source and ownership are confirmed. Cloudflare documents Workers AI `@cf/baai/bge-m3` as multilingual and zero-data-retention for inference, plus an included free daily neuron allocation; Vectorize has a free allocation for stored and queried vector dimensions. Vectorize is stateful storage: embeddings remain in the index by design, and embeddings can still reveal health information. Store minimum semantic text, opaque IDs, and short retention; do not treat vectors as anonymous. Add strict budgets and fail over to structured/context keyword recall when quotas or the provider are unavailable. Do not silently enable billing.

Do not send BioOS health records to Gemini API's unpaid tier: Google's current terms say unpaid input/output may be used to improve services and reviewed by people, and instruct developers not to submit sensitive or personal information. A paid privacy tier is an alternative only if Alonso later accepts a cost. Local embeddings are the privacy-first fallback if Cloudflare's free quota, account terms, or privacy boundary is unacceptable.

Suggested free-tier caps for one user's system: embed only durable semantic atoms (not raw sensor samples), query once per orchestration, compact/merge old active atoms with provenance retained, cap index records and alert on quota. Quotas are provider limits, not guaranteed future pricing or an uptime SLA.

## Rollout phases and acceptance checks

1. **Android bridge**: discover Health Connect availability, Mi Fitness origin names, and actual fields on Alonso's phone; request minimal permissions; display per-source sync age and revocation status.
2. **Authenticated ingress**: add source-controlled Worker, pairing/revocation, signed requests, replay/idempotency, strict schema, HMAC GAS envelope, and negative auth checks. No user data before enrollment.
3. **Verified sensor snapshot**: persist bounded snapshots, use provenance/freshness, integrate provider and `/doctor`. Show no RHR if only exercise HR arrives.
4. **Memory persistence**: wire outcome ledger and semantic atoms through one transactional adapter; retain factual provenance and expiration.
5. **Vector recall**: provision the multilingual embedding model and vector index, validate cross-language retrieval with a small offline corpus, enforce top-k/source/confidence/recency and quotas, then attach citations to the orchestrator context.
6. **Production acceptance**: owner-visible permission report, end-to-end sync timestamp, duplicate replay rejected, revoked device rejected, stale snapshots marked stale, and a user-reported plan recalled by the next briefing without being labeled verified.

No Android client or Cloudflare Worker code currently exists in this repository, and no production enrollment/permission has been performed. These are explicit implementation items, not active connections.

## Primary references

- [Xiaomi: Mi Fitness and Health Connect setup](https://www.mi.com/es/support/faq/details/KA-1131535/)
- [Google Health: third-party device data, including Xiaomi/Mi Fitness](https://support.google.com/googlehealth/answer/14236613)
- [Health Connect architecture and permissions](https://developer.android.com/health-and-fitness/health-connect/architecture)
- [Health Connect background reads](https://developer.android.com/health-and-fitness/health-connect/read-data)
- [Android Keystore non-exportable keys and signatures](https://developer.android.com/privacy-and-security/keystore)
- [Cloudflare BGE-M3 model](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Cloudflare Workers AI data handling](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Cloudflare Vectorize pricing and limits](https://developers.cloudflare.com/vectorize/platform/pricing/), [limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Gemini API unpaid service terms](https://ai.google.dev/gemini-api/terms)
- [Apps Script `scripts.run` requirements](https://developers.google.com/apps-script/api/how-tos/execute)
