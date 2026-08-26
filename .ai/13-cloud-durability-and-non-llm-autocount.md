# Cloud durability and non-LLM auto-count

Last updated: 2026-08-26

## Product decision

Voltline should be cloud-backed, local-first, and explicit about save state. “Never lose information” cannot be promised literally: a user can delete every copy, an account can be closed, or all retained backups can be damaged. The engineering target is **near-zero acknowledged data loss** with independently recoverable copies.

An edit is acknowledged in this order:

1. Commit the edit and an immutable mutation ID to the browser's durable IndexedDB transaction.
2. Update the interface and show `Saved on this device` only after that commit.
3. Send the mutation to the cloud with the same ID. The server applies it once in a database transaction and returns an acknowledgement.
4. Mark the local outbox record as synchronized.
5. If a recovery folder is connected, append the mutation to that folder and refresh its `latest.json` snapshot. Plan PDFs are mirrored to the folder separately.

This ordering matters. A cloud-first request can fail before an edit is durable anywhere; an interface that says “saved” before a local transaction completes can lose an acknowledged edit on a tab or machine crash.

## Copies and recovery

| Copy | Purpose | Failure it covers |
| --- | --- | --- |
| IndexedDB + persistent-storage request | Immediate working copy and outbox | Internet outage, cloud outage, tab crash |
| User-selected `Voltline Recovery` folder | User-controlled append-only journal, baselines, current snapshot, and PDFs | Browser profile loss or storage eviction |
| Supabase Postgres | Authoritative synchronized estimate and revision history | Device loss and multi-device access |
| Supabase PITR plus off-site logical dumps | Point-in-time database recovery | Bad deploy, accidental edit/deletion, database incident |
| Separate object-storage replication | Recovery of plan PDFs | Storage-object deletion; database backups do not contain Storage objects |

Supabase's database backups do **not** restore files stored through the Storage API, so plan PDFs need their own replication and retention policy. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

The browser copy must request persistent storage because best-effort origin data can be evicted. Persistent storage is only removed by explicit user action, subject to browser behavior. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [MDN origin-private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

The recovery folder is a second copy, not the primary database. File-system access needs a secure context, browser support, and user permission; permission can lapse. See [MDN File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API).

## Cloud synchronization contract to implement

- Every mutation gets a UUID before it changes local state.
- The cloud stores mutation receipts with a unique `(user_id, mutation_id)` constraint.
- A transaction checks the receipt, applies the change, advances the entity revision, and inserts the receipt atomically.
- Retries use the same mutation UUID. Never retry a failed write with a new identity.
- Conflicts compare `base_revision` with the current cloud revision. Never use blind last-write-wins for bid values.
- Deletes are tombstones until the retention window closes; they are not immediate hard deletes.
- Issued bid snapshots are append-only and cannot be updated by the application role.
- The UI distinguishes `Saved on this device`, `Syncing`, `Cloud protected`, `Conflict`, and `Recovery copy unavailable`.
- A restore drill must be automated and run on a schedule. A backup that has not been restored and verified is only a hope.

Current Supabase clients automatically retry safe reads in some transient cases, but writes still need Voltline's own durable outbox and idempotency handling. Current Supabase projects also require explicit thought about Data API grants and RLS; authentication by itself is not row authorization. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and the [Supabase changelog](https://supabase.com/changelog).

## Auto-count without an LLM

Yes. Most plan-symbol counting should not start with a large language or vision-language model. The best design is a cascade that uses the cheapest deterministic evidence first.

### Stage 1: inspect the PDF itself

1. Read Optional Content Groups (OCGs), which Acrobat presents as layers.
2. Extract searchable text, font runs, vector paths, XObjects, annotations, transforms, and clipping regions.
3. Look for repeated Form XObjects or identical vector-path signatures. A repeated symbol instance can sometimes be counted exactly without raster vision.
4. Use the sheet legend and nearby text to associate a repeated graphic signature with a takeoff item.
5. Respect OCG visibility and let the estimator isolate useful authoring layers.

PDF layers are optional and may be flattened. Their names are not standardized, so the system must also analyze page operators and text rather than assuming a layer called “Power” always exists. PDF.js exposes `getOptionalContentConfig`, `getOperatorList`, and rendering with an optional-content configuration. See the [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) and [Adobe's OCG documentation](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdflsdk/apireference/PD_Layer/PDOCG.html).

### Stage 2: deterministic template matching

When the estimator boxes one clean symbol, use normalized cross-correlation at several scales and rotations. Apply non-maximum suppression and show every candidate for review. This is fast, explainable, and excellent when the PDF uses the same symbol artwork repeatedly. OpenCV documents the underlying [template-matching methods](https://docs.opencv.org/4.x/de/da9/tutorial_template_matching.html).

### Stage 3: small task-specific object detector

Template matching becomes brittle when symbols are rotated, drawn at different scales, obscured by lines, or produced by different design firms. Train a small detector on plan crops and synthetic degradations, export it to ONNX, and run it locally:

- WebGPU when available for speed.
- WebAssembly as the broad fallback.
- Server GPU only for unusually large pages or unsupported browsers.

ONNX Runtime Web supports local browser inference and documents WebGPU/WASM tradeoffs in its [web tutorial](https://onnxruntime.ai/docs/tutorials/web/) and [WebGPU guide](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). A construction-drawing research example reported strong results using synthetic degradation, which supports this direction but does not remove the need to validate on Voltline's real plans: [Computer Vision for Engineering Drawings](https://arxiv.org/abs/2312.13620).

### About the recent NVIDIA model

The likely model is NVIDIA's **LocateAnything**, a recent 3B-parameter visual-grounding model. It is interesting for open-vocabulary detection and document understanding, and its fast mode reports improved throughput, but 3B parameters is not “super lightweight” for an offline browser counter. Its model card also describes it as research/development software. Use it as a labeling or fallback experiment, not Voltline's default production counter. Sources: [LocateAnything paper](https://research.nvidia.com/labs/lpr/locate-anything/LocateAnything.pdf) and [NVIDIA model card](https://huggingface.co/nvidia/LocateAnything-3B).

NVIDIA TAO can train, distill, export, and optimize smaller detectors to ONNX/TensorRT. RT-DETR is supported and accepts COCO-style training data. This is more relevant if Voltline later ships a desktop/server NVIDIA path than for universal in-browser inference. See [TAO Deploy](https://docs.nvidia.com/tao/tao-toolkit/latest/text/tao_deploy/tao_deploy_overview.html) and [TAO RT-DETR](https://docs.nvidia.com/tao/tao-toolkit/latest/text/cv_finetuning/pytorch/object_detection/rt_detr.html).

### Stage 4: VLM/LLM fallback only

Use a larger model for tasks that genuinely need semantic reasoning: interpreting a novel legend, deciding whether a graphical mark is a device or a note, or proposing a mapping for an unknown symbol family. It should propose pending takeoffs, never silently finalize bid quantities.

## Data needed before model training

Real project PDFs are not required to build the PDF inspection and template-matching foundation. They are required before anyone can claim reliable auto-count accuracy. When projects become available, retain:

- original vector PDFs rather than screenshots;
- estimator-selected example boxes;
- confirmed, rejected, and missed detections;
- symbol class, page scale, rotation, and design-firm/source metadata;
- a project-level train/validation/test split so pages from the same job cannot leak across splits.

Measure per-class precision and recall, count error per sheet, review time saved, false positives per 1,000 candidates, and failures by source/scale/rotation. A single overall “accuracy” number is not enough for estimating risk.

## Current implementation status

- Done: IndexedDB primary store for tables and PDFs, append-only local mutation journal, migration from the old localStorage records, persistent-storage request UI, optional recovery folder with baseline/current JSON, per-mutation journal files, and mirrored plan PDFs.
- Done: area/system/phase fields on takeoff layers.
- Done: proposal entries for inclusions, exclusions, allowances, and alternates; printable proposal preview; snapshot payload version 2 captures the entries.
- Done: PDF OCG discovery/visibility controls and page structure signals for text/vector-versus-raster routing.
- Cloud-ready but not connected: migration adds proposal entries and the previously missing bid snapshot table with RLS and explicit grants.
- Still required: cloud outbox processor, mutation receipt/RPC contract, conflict UI, restore/import workflow, storage replication, PITR configuration, and restore drills.
- Still required: deterministic vector-signature counter, multiscale template matching, ONNX model runner, labeling workflow, and real-plan evaluation.

## Actions required from Ethan

1. Create or choose the production Supabase organization/project and provide the project URL plus publishable key through local environment variables. Do not send a service-role key to the browser.
2. Choose a Supabase plan/retention target. For serious bids, enable PITR and decide how many days of database history must be recoverable.
3. Choose a separate destination and retention rule for plan-PDF replication; Supabase database backups do not include Storage objects.
4. In Voltline, click **Protect browser storage** and choose a **Recovery folder** on every estimating machine. Keep that folder inside a separately backed-up location if possible.
5. Decide the commercial rule for allowances and alternates: included in base, add/deduct, accepted/unaccepted, and whether overhead/profit/tax applies. Until then, their proposal amounts stay outside base-bid math.
6. When sample jobs exist, provide at least several PDFs from different design firms and scales plus verified counts. Remove or authorize any confidential information before using them for model training.
7. Decide the minimum supported hardware/browser set. WebGPU on Edge/Chrome plus WASM fallback is the current recommendation.
8. Approve the model/runtime licenses before distribution. Do not select a detector solely from benchmark speed.
