# Optional Firebase review studio

This is the existing standalone React/Vite + Firebase review app, reused as the agency's delivery destination. It supports private PNG/JPEG/WebP/MP4, captions, ordered carousels, Google sign-in for invited reviewers, approve/request-changes/reject and revision history. The existing Skills and Analytics views travel with the app; no external accounts, metrics or publishing authority are configured.

## Run locally

Install with the agency's install-studio helper into a product's marketing/ folder. Use an existing compatible marketing folder unchanged when present.

```sh
node marketing/cli.mjs adapt --name "Your product"
node marketing/cli.mjs install
node marketing/cli.mjs start
```

Requires Node 22 and Java 21+ for local Firebase emulators. Use the project's launcher when required. install uses a project-local npm cache and locked dependencies; no global runtime is installed. start prints the local URL and a local-only reviewer. Keep project.json/workspace data private to this project. Never adapt a clone of the same configured project to fix a moved path; see AGENTS.md.

## One-time cloud setup

Use an owner-selected Firebase project, Storage bucket, Firestore database, web app and separate Hosting site. These resources, IAM and any billing remain external prerequisites. Do not silently create them. Each product gets its own workspace and deployment config. This runtime serves one configured workspace per API deployment. Use a separate Firebase project for each product by default. A product app and its review studio can share a project with distinct API codebases. Do not deploy two products unchanged to the same Firebase project: they would replace the same marketingApi Function. Multiple product workspaces behind one API are not implemented.

1. Enable Google Auth and App Check (reCAPTCHA Enterprise). Configure the review site's authorized origin. Prefer Firebase's project.firebaseapp.com authDomain unless the matching OAuth redirect is configured.
2. Set project.json.cloud with public projectId, optional databaseId, storageBucket, authDomain, apiKey, appId, appCheckSiteKey and allowedOrigins. scripts/project.mjs validates these fields. Keep developer credentials outside source; the Firebase CLI's authorized local account supplies uploads. A browser login is not a developer credential.
3. Copy firebase.cloud.example.json to firebase.cloud.json and replace the site placeholder. Create ignored .env.PROJECT_ID with MARKETING_ENV=cloud and MARKETING_REVIEW_ENABLED=1 and MARKETING_ACCESS_MODE=invited. Review Functions source/codebase, Hosting site and region before deployment.
4. Configure private bucket IAM and Firestore/Storage protection. The included deny-all rules suit a dedicated setup. Never overwrite a shared application's rules; inspect and integrate its protection separately. Media is served by an authenticated API with no public download token.
5. Grant approved reviewer accounts a marketingWorkspaces array containing this workspaceId in Firebase Auth custom claims. Merge unrelated existing claims. Google sign-in alone grants no access. The API checks live membership. Do not enable MARKETING_ACCESS_MODE=google for a private invited-only studio; that optional mode admits any verified Google account. Do not copy the emulator password or account to cloud.
6. Build with npm --prefix marketing run typecheck, node marketing/node_modules/typescript/bin/tsc -p marketing/tsconfig.server.json, and node marketing/node_modules/vite/bin/vite.js build marketing --mode cloud. Then, only with deployment authorization, use the local Firebase CLI with --config marketing/firebase.cloud.json --project EXPLICIT_PROJECT --only functions:marketing,hosting --non-interactive.
7. Verify invited-user login, denial for an uninvited account, private media loading, review decision/history and changed-content approval reset. Record the actual URL and evidence; configuration/build success is not deployment proof.

## Deliver and revise

```sh
node marketing/cli.mjs deliver-selected marketing/workspace/agency/JOB/manifest.json
# Revision, after reading the current card:
node marketing/cli.mjs deliver-selected marketing/workspace/agency/JOB/manifest.json --post-id UUID --expected-version N
```

The agency stage-review helper supplies exact titles, captions and ordered files. Languages must be configured in project.json. Limits: 20 MiB/file, 1–10 feed files, one Story/Reel file, MP4 for Reels. Existing cloud validators check byte signatures. Only a verified cloud receipt completes delivery. On an uncertain submission, reuse the same manifest identity and reconcile; never create a duplicate card as a retry.

Full source backup is optional: cli.mjs deliver runs media-cloud.mjs sync across ALL media in workspace/. Obtain applicable authorization for that wider scope; never point it at an entire agency vault. Default deliver-selected already stores and verifies the exact final media privately.

Firestore keeps posts, asset records, decisions and immutable history under marketingWorkspaces/{workspaceId}; Storage keeps private media under marketing/{workspaceId}. Approval never publishes or schedules. New revisions preserve history and require review. Retention cleanup is not automated.

## Checks

npm --prefix marketing test; npm --prefix marketing run typecheck; npm --prefix marketing run build. tests/emulator.mjs covers local API boundaries with the studio running. No model/renderer, cloud provisioning or unattended publisher is installed by this runtime.

UPSTREAM.json records the copied source hashes and deliberate adaptations. No prior product project.json, cloud config, media, guides, .local directory or credentials are included.
