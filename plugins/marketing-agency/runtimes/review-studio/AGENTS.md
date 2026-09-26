# Project review studio
Read README.md and the active project's Marketing Agency Director workflow.
This runtime stores and reviews content. Creative direction stays with the agency.
Use the host launcher if required. Never install global runtimes or reuse a different project's cloud settings.
For a new product, run cli.mjs adapt before install/start. For a clone of the SAME project, verify the repository identity and preserve the existing workspace/cloud; update sourceBinding to scripts/project.mjs fingerprint(parent), not adapt.
Cloud preparation: cli.mjs prepare-content downloads versioned team instructions; record selected revisions/hashes in the brief. Empty libraries are valid. New local guides under skills/ are registered by cli.mjs skills-publish. Executable tools are not installed by cloud Markdown.
Default private delivery is cli.mjs deliver-selected MANIFEST. It uploads only ordered manifest media and verifies Storage and the Firestore review card. cli.mjs deliver additionally archives ALL workspace media; use it only when that wider backup is authorized. Keep source drafts in the agency vault unless selected for backup.
Retain environment/cloud project/workspace/post ID/version/status/verified receipts in the originating agency job. Revisions need the live post ID and expected version. Approval does not publish. Never approve your own output on behalf of a user.
Publishing, scheduling, ads and connector operations need their own applicable authorization; no credential or standing authority is bundled. Never log tokens or commit private keys. Runtime scripts are not a permission grant.
Cloud deployment needs a reviewed project/site/config and applicable owner authorization. Do not overwrite rules in a shared Firebase project. Reviewer login alone does not grant developer access or workspace membership.
Set MARKETING_ACCESS_MODE=invited for private review. The optional google access mode admits any verified Google account and must not be enabled implicitly. Each API deployment serves one configured workspace; separate product Firebase projects avoid replacing the same marketingApi Function.
