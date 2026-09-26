# Verification

Checked 2026-09-27. Package version 0.1.0.

- Ten skills pass the skill-creator frontmatter validator.
- Offline regression checks pass: project identity, idempotent initialization,
  duplicate-job protection, ordered selected-file manifests, file hashes, immutable
  revision manifests, traversal/symlink rejection and timing comparisons.
- Clean exports from a populated kit exclude its vault, identity and unlisted cloud
  or environment files. Clean export also works from the built plugin.
- The plugin contains eight Claude agent profiles, both runtime manifests, ten
  skills, license/provenance records and a file hash inventory. ZIP content is checked.
- Codex's plugin-creator validator passes. Claude's plugin validator passes with an
  informational warning: the folder-mode CLAUDE.md at plugin root is not loaded as
  project context. The Director skill carries those instructions; the file is kept
  so a plugin can export a complete folder-mode kit.
- Source application workspace was left unchanged when creating this package.

Commands from this standalone folder:
~~~sh
python3 .marketing/scripts/agency.py check
python3 .marketing/tests/check.py
claude plugin validate dist/marketing-agency
~~~

The package and repository marketplace catalogs are validated locally. An actual
installation from GitHub remains a separate check. No live specialist session,
generated media, rendered film or campaign
performance is claimed. Those require the host's production tools and an actual brief.

The regression checks use Python's standard library. The external Codex/skill
validators were run using the already-installed Python 3.11 with PyYAML; no new
runtime, dependency or user-level configuration was installed.
