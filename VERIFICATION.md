# Verification

Checked 2026-09-27. Package version 0.2.0.

- Ten skills, local links and adaptation hashes pass the agency checker.
- Offline regression checks pass for clean exports, both plugin manifests, eight role briefs, hashes and revision safety.
- New review checks cover clean studio installation, no overwrite of an existing studio, canonical project binding, ordered selected files, caption/media hashes, immutable staged revisions and the stable per-job upload manifest. Private notes remain outside staging. Installed dependency symlinks are not treated as upload sources.
- The copied studio passes all 35 tests, including authenticated workspace access, verified cloud submission/read-back, idempotency, conflicts, approval reset and the selected-versus-full-archive CLI paths. Cloud clients in these tests are mocked; no new cloud site or post was deployed by the integration change.
- A fresh sample product was adapted with cloud=null. Typecheck and the production frontend/backend build passed using Node 22 and the already-installed source runtime dependencies. A fresh npm install and new cloud provisioning were not repeated or claimed.
- Clean-project testing found and fixed a language-specific test, tests relying on prior compiled output, and macOS symlink-path fingerprint mismatch in the copied runtime. The existing product runtime was left unchanged.
- Private review defaults to invited workspace members. The optional broad Google access mode is documented and not enabled by setup. This runtime serves one configured workspace per API deployment; it does not implement multi-product SaaS onboarding.
- Runtime provenance is recorded in runtimes/review-studio/UPSTREAM.json. Only allowlisted code/config templates were copied: no prior project.json, workspace media, .local credentials, cloud target, brand guide, emulator state or node_modules.

Commands:
```sh
python3 .marketing/scripts/agency.py check
python3 .marketing/tests/check.py
# In an initialized studio with dependencies installed:
npm --prefix marketing test
npm --prefix marketing run typecheck
npm --prefix marketing run build
```

The distributed bundle is rebuilt from .marketing. Plugin metadata validation does not prove a GitHub installation or a cloud deployment. No global settings, public campaign or existing GarbaRush studio were changed by this integration.

Codex plugin-creator validation passed with the existing Python 3.11/PyYAML runtime. Claude validation passed with its known folder-mode CLAUDE.md informational warning; Director skill context remains discoverable. Bundle scan found no prior cloud project, private identity, workspace directory, credential file or private-key marker.
