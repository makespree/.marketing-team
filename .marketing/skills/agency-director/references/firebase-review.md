# Firebase review workflow

Use this when the user wants generated creatives privately uploaded for a team to sign in, inspect and approve. Reuse a compatible project marketing/ studio first. For a new project, install the optional bundled runtime once; never replace an existing studio or inherit another product's Firebase settings.

## Ownership and source of truth

The agency Director and project vault own research, brand rules, briefs, source artwork and production revisions. The studio owns cloud media receipts, reviewer membership, review decisions and post history. Mirror post IDs, exact versions/hashes, feedback and receipts into the originating job. A local file called approved is not proof of a cloud approval.

Flow: brief → produce → self-review → stage selected files → private upload → human review → revised content → new review → separately authorized distribution. A human may approve, request changes or reject through the existing web app. Agents do not approve on the user's behalf or infer publication permission.

## Existing project

Read marketing/AGENTS.md and marketing/project.json. Verify the current product, repository, workspace, cloud project and review URL. Keep the working deployment. On another checkout of the SAME project, verify identity before rebinding its source path; do not run adapt, which archives context and resets cloud settings for a different product.

Follow existing project preparation and delivery hooks when they impose additional requirements. The original studio's deliver command archives ALL media in its workspace; preserve applicable owner authorization for that wider scope. Do not copy the full agency vault into that workspace. Reuse already-delivered cards for revisions, rather than uploading duplicates.

## New project, once

Resolve TOOL to scripts/agency.py in the loaded agency bundle. Resolve PROJECT from the active product directory, never from a plugin cache. The installed plugin remains read-only.

```sh
python3 TOOL install-studio --project PROJECT
node PROJECT/marketing/cli.mjs adapt --name "Product name"
node PROJECT/marketing/cli.mjs install
node PROJECT/marketing/cli.mjs start
```

These commands prepare a local studio, not a hosted website. Use the host's launcher when required. Node 22 and Java 21+ are prerequisites; no global runtime is installed. Read the copied marketing/README.md for the one-time cloud setup: Firebase Auth, Firestore, private Storage, App Check, an explicit Hosting site and invited-reviewer claims. Finish concrete config/build checks before requesting any still-missing deployment authority. Never create projects, incur spend or deploy merely because the plugin is installed.

The runtime's firebase.cloud.example.json is a template with an unresolved site, not a deployable target. Build success and config presence are not proof of a functioning private review website. Verify invited and unauthorized access, private image/video loading, review decisions/history and approval reset after changing content. Keep the actual URL and setup evidence in the project's vault.

## Every content run

For a cloud-configured studio, run prepare-content and read the selected versioned instruction snapshot before production. Save IDs, versions and hashes in the job. This is optional team guidance, not automatic cloud enrollment of every agency or third-party skill. Executable helpers remain local.

One agency job maps to one review card. For a campaign with a reel, carousel and poster, use separate post jobs linked by the campaign brief. Keep the same job ID and manifest path across revisions. The agency's existing manifest command selects files and hashes them, but cannot upload or approve them.

```sh
python3 TOOL manifest --project PROJECT --job friendship-carousel --revision v1 --caption caption.txt --files exports/01.png exports/02.png --language en --placement feed
python3 TOOL stage-review --project PROJECT --job friendship-carousel --revision v1 --title "Friendship carousel"
node PROJECT/marketing/cli.mjs deliver-selected PROJECT/marketing/workspace/agency/friendship-carousel/manifest.json
```

The helper checks project binding, identity, byte hashes, configured language, supported media and limits; it copies only the selected files in their explicit order. Private notes and other jobs stay in the vault. Staging is local and is not delivery. Caption/media changes require a new revision. Stage outputs use immutable revision directories with a stable per-job manifest pointer.

The bundled deliver-selected command uses the existing verified cloud submission path without the whole-workspace archive hook. It stores selected final media in the private bucket and metadata/caption/order/history in Firestore. The app serves media through authenticated requests. A bucket upload alone does not create a review card. Full source backup is a separate explicit option via deliver or media-cloud.mjs sync; explain its whole-workspace scope before using it unless already authorized.

A successful receipt must contain environment=cloud, the intended projectId/workspaceId, post id, version, review status and verified=true. Copy it from marketing/.local/WORKSPACE/cloud-submissions/POST_ID.json into .marketing/vault/jobs/JOB/receipts/. Retain the source manifest hashes. Never paste credentials into the vault or commit them with the plugin.

## Feedback and revisions

Read the current authenticated card, reviewer feedback and version. Repair the specified issue in v2, regenerate the agency manifest, stage the new files, and submit the SAME card:

```sh
node PROJECT/marketing/cli.mjs deliver-selected PROJECT/marketing/workspace/agency/friendship-carousel/manifest.json --post-id EXISTING_UUID --expected-version CURRENT_VERSION
```

The existing version check rejects stale edits; changed content resets approval and retains history. An unchanged retry is idempotent. If the result is uncertain, reconcile the existing card before retrying; never invent a receipt or create a new job ID as a retry. Keep local files on failure and report the exact failed step, with no silent emulator fallback.

This workflow does not poll feedback in the background, publish, schedule or buy ads. Resume from real feedback when asked; configure automation separately if the owner requests it.
