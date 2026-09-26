# One project vault

The writable root is the active project's .marketing/vault, even when the plugin
runs from a cache. This is project context, not global agent memory.

- product/context.md: actual product, target audience, alternatives, positioning,
  proof and unknowns. Version substantial changes; proposed wording is not approval.
- brand/guidelines.md: voice, languages, typography, colour, logo paths, cultural
  constraints, accepted examples and rejected directions. Keep source assets exact.
- decisions/log.md: dated owner decision, scope, reason, supersedes, evidence.
  Record corrections without rewriting what was previously decided.
- research/: source URLs, dates, exact excerpts where permitted, facts vs inference,
  reference breakdowns and confidence. Inspiration is not proof of performance.
- artwork/: reusable approved assets plus an index; references are not approved assets.
- jobs/<id>/: brief.md, handoffs, research, prompts, sources, exports, review.md,
  manifest.json and receipts. Every revision gets a new revision folder.
- results/: observed metrics, dates, attribution limits and resulting decisions.

## Ownership and state

One owner per file during concurrent work. The Director integrates brand and
decision changes. Every specialist returns changed paths, evidence and open issues.
Simple state sequence: brief → producing → in-review → approved → delivered.
Rejected/revise-needed returns to producing with a new revision; blocked names
the actual blocker. The helper initializes state but does not automatically advance it.
No background job runner is implied.

Approval records identify reviewer, time, caption and ordered media hashes.
A technical pass is not owner approval. Distribution receipts attach to the exact
approved revision with destination/account/job ID and verified result.

## Asset index fields

asset_id, local_path, sha256, kind, origin (original/generated/licensed/reference),
source_url, creator, license_or_permission, permitted_use, expires_at if applicable,
prompt_path, tool/model if known, created_at, tags, approved_revision, reuse_notes.
Unknown rights remain unknown. A link to an online photo is not permission.
Use jobs for one-off art and promote genuinely reusable assets to artwork after review.

## Privacy and portability

Generated media and project records are ignored by default. Backup is an explicit
project choice. Portable export uses an allowlist and excludes the entire vault,
identity, source accounts and secrets. Retain licensed source notices in the kit.
