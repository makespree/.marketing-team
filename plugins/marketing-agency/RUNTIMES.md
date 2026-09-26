# Runtime integration

Verified documentation on 2026-09-27:
- [Codex packaging](https://developers.openai.com/plugins/build/plugins)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude subagents](https://code.claude.com/docs/en/sub-agents)

The build creates .codex-plugin/plugin.json and .claude-plugin/plugin.json,
skills/, and agents/ in a directory named marketing-agency. Skills use the
shared SKILL.md format. Claude agents have name/description frontmatter and inherit
the session model and permissions. No hardcoded model, tool allowlist or credentials.
Folder-mode AGENTS.md and CLAUDE.md stubs travel for subsequent clean exports.
Plugin hosts do not load these as project context; the Director skill carries the
operating instructions in both modes. Claude's validator may flag this as a warning.
Codex uses the Director skill and role briefs through its available delegation
tools; Claude-style agents/ does not by itself configure native Codex agent types.

Loading a local plugin depends on the host version. Prefer the host's local
plugin import path and verify skill discovery in a new session. We don't edit
user-level marketplaces or settings. The package command creates a local bundle,
not a marketplace listing or an installed plugin.

Write all project artifacts under the active repository's .marketing/vault.
Resolve the instruction bundle from the loaded skill location. A plugin may run
from a cache outside the project; never infer the project root from that cache.
If no .marketing exists in the active repository, use the bundled agency.py
init --project <explicit repo> --name <product>; it creates the writable vault
without modifying the installed plugin.

Reading a role profile is not spawning an agent. Record actual execution mode
(native specialists or sequential roles) in the job brief. The Director owns
integration; specialists own exactly their assigned files. They must preserve
other workers' edits. No automatic background work is claimed.

The optional runtimes/review-studio app is copied into the active project by
install-studio; it is never started or configured inside the plugin cache.
stage-review bridges hash-verified agency manifests to its ordered upload schema.
Cloud credentials, deployment targets and reviewer membership stay project-local.
