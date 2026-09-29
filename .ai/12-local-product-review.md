# Local product review — September 6, 2026

> Historical September 6 implementation review. Keep its results dated.
> Current verification is in [07-verification.md](07-verification.md);
> remaining work is assigned in [18-parallel-execution-plan.md](18-parallel-execution-plan.md).
> Portable restore exists; folder-mirror restore remains a separate open task.

## Release scope

Voltline is a single-user estimating workspace on one computer. This review
focuses on recovering bid data, preventing conflicting edits, and making the
existing estimating workflow understandable. It does not establish readiness
for a hosted team product or validate AI accuracy on real drawings.

Existing uncommitted scope-printing changes and documentation were preserved.

## Findings addressed

| Priority | Finding | Change |
| --- | --- | --- |
| Critical | Read/modify/write queries could overwrite concurrent updates because each query reads and rewrites the whole table collection. | Serialize complete operations with a same-tab queue and an origin-wide Web Lock. Storage operations and recovery reads use the same lock. |
| Critical | Multiple editors could price from stale shared catalog data and allocate conflicting revision numbers. | Allow one editing tab per browser profile. A second tab explains how to release and retry access. Backups require all editors to return to Projects. |
| Critical | Replacing an assembly's components used separate delete and insert operations, so failure could remove a valid saved list. | Validate and replace the complete list in one commit. Invalid references or quantities preserve the saved list and surface an error. |
| High | There was no portable recovery workflow including the plan PDFs. | Download a versioned backup with a SHA-256 integrity check, preview its contents, validate the record graph and file coverage, and restore all records and PDFs in one IndexedDB transaction. Occupied workspaces refuse replacement. |
| High | Project removal was immediately destructive. | Archive and restore projects; permanent deletion is available only in the archive with the existing confirmation. |
| Medium | Data protection controls disappeared on small screens. | Move protection and recovery into the dashboard content. |
| Medium | Folder write failures were only console messages. | Surface mirror failures and expired permissions separately from primary database saves. |
| Medium | Recent-project dates did not reflect changes to bid data. | Update the owning project's timestamp when its records change. |
| Medium | New users had to infer the estimating workflow. | Add an expandable setup guide linking each step to Takeoff, Database, Scope, or Summary. |
| Medium | Internal project navigation could leave before pending saves finished. | Disable application back links until the save state is healthy and show the actual save error in the workspace. |

## Remaining release limits

- Local access is not server authentication. There are no team roles, shared
  cloud data, off-device automatic backups, or cross-device conflict handling.
- AI routes still require server authentication in production. Their current
  tests use mocked responses; real-plan accuracy is unverified.
- Portable backup files are limited to 256 MB, with a conservative 128 MB PDF
  budget before encoding. They are unencrypted. Store them appropriately.
- Restore intentionally requires an empty workspace; it does not merge catalogs
  or replace current projects. Use a fresh browser profile for a recovery drill.
- The portable importer accepts Download backup files. Existing recovery-folder
  JSON/journals are a separate format and still need a dedicated restore tool.
- The recovery-folder mirror remains a second local copy. It is not an off-device
  backup, and its permission or target drive can become unavailable.
- Real estimating acceptance still requires comparing representative bids,
  calibrated measurements and supplier pricing with estimator-approved results.
- Mobile users can manage projects and backups. The drawing workspace still
  targets a desktop-sized display and a pointer.

## Verification

The baseline was 377 passing unit tests. New regression coverage checks backup
round trips, binary preservation, damaged/unsupported input, graph completeness,
concurrent writes, project recency, archive/restore, restoration into a new
browser profile, and exclusive editing access. Final results are recorded after
the complete checks finish.
