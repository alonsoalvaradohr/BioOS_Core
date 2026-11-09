# ADR-002: runtime brain, Xiaomi telemetry, and semantic retrieval

- Status: `IMPLEMENTED_LOCALLY_PENDING_RELEASE`
- Date: `2026-11-09`
- Scope: the BioOS runtime brain (orchestrator, physiology, sleep, and nutrition agents), separate from the repository-development harness.

## Current observed state

- Production is on BioOS 8.7.1. The source provider `health_connect` returns `HEALTH_CONNECT_ANDROID_BRIDGE_NOT_INSTALLED`; Apps Script cannot read Health Connect on Alonso's phone by itself.
- The repository has a Google Fit REST reader and OAuth scopes, but the sensor engine defaulted to `health_connect`, whose implementation was only an unavailable stub. This cut off the old Google Fit ingestion path unless the script property explicitly selected `google_fit_legacy`.
- L1 keeps only 10 working events. The runtime now has an L3 semantic-memory adapter: source/status/expiry atoms with versioned 96-dimensional local feature vectors and cosine retrieval. It does not call an external embedding API.
- The pure outcome ledger now has an NVRAM persistence adapter; only explicit user-confirmed results become completed outcomes.
- There is no pretrained transformer embedding provider, remote vector index, or Android application in this repository. The Cloudflare Worker that fronts Telegram is also not source-controlled here.
- `scripts.run` currently fails because its OAuth client and Apps Script project do not share the same standard Google Cloud project. This affects owner-run Apps Script API operations; it is separate from Health Connect permissions.

## 1. Xiaomi Watch 2 -> BioOS data path

Restore the route Alonso already used first, then migrate without interrupting data:

```text
Xiaomi Watch 2 -> Mi Fitness -> Google Fit account (existing user-authorized sync)
  -> BioOS Apps Script Google Fit REST OAuth reader -> sensor provider -> orchestrator

Long-term Android-first path:
Xiaomi Watch 2 -> Mi Fitness -> Health Connect -> BioOS Bridge (Android)
  -> authenticated ingress -> verified snapshot store -> sensor provider -> orchestrator
```

Alonso reports Mi Fitness is already linked to Google Fit and BioOS previously read that feed. Xiaomi documents a **Profile -> Third-party data -> Google Fit** connector for supported wearables, requires Xiaomi cloud sync, and syncs relevant activity data; field availability varies by product, app version, region, and account. The Watch 2 pairs with Mi Fitness and has optical heart-rate, accelerometer, gyroscope, sleep monitoring, and dual-band GNSS hardware. Xiaomi says it records sleep stages and sleep heart rate and produces detailed exercise summaries in Mi Fitness. That does not mean every field is exported to Google Fit. BioOS must inspect the feed and preserve its source. Never infer RHR from workout heart rate.

The source retains a Google Fit REST reader. The defect was provider selection: the deployed default selected the unimplemented Health Connect stub. The immediate code fix queries existing Google Fit whenever Health Connect is selected but has no bridge. `/doctor` remains the live validation. Google marks Fit APIs for deprecation during 2026 and recommends Health Connect for Android collection; Google Fit is a compatibility route while this user's stream is confirmed and migrated.

The future Health Connect bridge should request read access only for types BioOS consumes: steps, distance, total calories, sleep sessions, exercise sessions, heart-rate records, and optional weight if Alonso elects to use it. Do not request write access, routes/location, mail, calendar, or other health categories for this bridge. Capture each `DataOrigin`, record timestamp, zone/unit, and sync time. Discover the Xiaomi package/data origin on-device; do not assume or hard-code `com.xiaomi.wearable`. Deduplicate by Health Connect record ID and stable session ID. Keep provider timestamps distinct from bridge upload timestamps.

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
4. **Outcome ledger**: durable decision/action/result links persisted through NVRAM. `/resultado ...` records a completed session only when Alonso explicitly confirms it; automatic recommendations never count as completion.

L1 remains a short-lived working buffer, not the durable brain. Runtime ingestion now stores NLP-extracted plans, symptoms, load, and nutrition as `reported` atoms and retrieves a small top-k into orchestration context. `/recordar`, `/memoria`, `/olvidar ID`, and `/resultado` provide direct control. Plans and symptoms expire quickly; long-lived notes expire within one year. Responses distinguish user reports from observed telemetry. Never promote a plan to completed workout without user confirmation.

### Vector, matrix, tensor

An embedding for one memory is a vector of `d` numbers. BioOS now stores one versioned local 96D vector per memory atom. The bounded candidate set forms an `N x 96` matrix at search time; cosine similarity ranks matches. This is feature hashing plus a small Spanish synonym map, not a pretrained language model, so recall is semantic only for known aliases and still depends on term overlap. A future model can replace it under a new vector version. Time series remain structured records. Tensors are unnecessary for this single-user retrieval workload.

### Free and private runtime implementation

The initial vectors are computed inside Apps Script and stored in the existing owner-controlled NVRAM Drive file, so there is no external embedding call, vector index, extra credential, or billing. NVRAM has a 4 MB hard cap and semantic memory is capped at 300 atoms. If retrieval is empty, the orchestrator keeps its existing recent L1/structured context.

A future BGE-M3 + Vectorize path remains optional only after confirming Worker source, ownership, retention, and free quota. Vectorize stores embeddings and embeddings can still reveal health information. Do not silently enable billing.

## Rollout phases and acceptance checks

1. **Restore current sensor route**: release the Google Fit failover and run `/doctor`; document live source, freshness, and which fields Xiaomi actually syncs.
2. **Future Android bridge**: if needed when Google Fit no longer works, discover Mi Fitness Health Connect origins, request minimal read permissions, and implement authenticated ingress.
3. **Memory release acceptance**: save a note with `/recordar`, locate it in `/memoria` and a relevant briefing, then delete it with `/olvidar ID`.
4. **Outcome acceptance**: confirm `/resultado` writes a ledger record and no suggested workout is counted as completed.

The Health Connect client/Worker still do not exist and no production enrollment was performed. Memory and Fit failover code are local changes until a release is deployed.

## Primary references

- [Xiaomi: Mi Fitness third-party sync to Google Fit](https://www.mi.com/mx/support/faq/details/KA-744156/)
- [Xiaomi Watch 2 specifications](https://www.mi.com/ae-en/product/xiaomi-watch-2/specs/)
- [Xiaomi Watch 2 FAQ: sleep and exercise records](https://www.mi.com/fr/support/faq/details/KA-141374/)
- [Google Health: third-party device data, including Xiaomi/Mi Fitness](https://support.google.com/googlehealth/answer/14236613)
- [Health Connect architecture and permissions](https://developer.android.com/health-and-fitness/health-connect/architecture)
- [Health Connect background reads](https://developer.android.com/health-and-fitness/health-connect/read-data)
- [Android Keystore non-exportable keys and signatures](https://developer.android.com/privacy-and-security/keystore)
- [Cloudflare BGE-M3 model](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Cloudflare Workers AI data handling](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Cloudflare Vectorize pricing and limits](https://developers.cloudflare.com/vectorize/platform/pricing/), [limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Gemini API unpaid service terms](https://ai.google.dev/gemini-api/terms)
- [Apps Script `scripts.run` requirements](https://developers.google.com/apps-script/api/how-tos/execute)
