# Marketing Agency

A standalone, portable creative agency for Claude Code or Codex.

Start with [.marketing/START.md](.marketing/START.md). The Director coordinates
an eight-role bench, ten skills, researched expert lenses and one project vault.
This folder is independent of any application repository or cloud service.

## Use it

### Claude Code

~~~sh
claude plugin marketplace add makespree/.marketing-team
claude plugin install marketing-agency@marketing-agency
~~~

Open a new session in your product's project, then invoke:

~~~text
/marketing-agency:agency-director
~~~

### Codex

~~~sh
codex plugin marketplace add https://github.com/makespree/.marketing-team.git
~~~

Open `/plugins` in Codex, select the Marketing Agency marketplace, and install
`marketing-agency`. Start a new session in your product's project and ask to use
the agency-director skill. UI availability depends on your Codex version.

### Any agent with file access

~~~sh
git clone https://github.com/makespree/.marketing-team.git marketing-team
python3 marketing-team/.marketing/scripts/agency.py export --out /path/to/your/project
~~~

Then tell your coding agent:

> Read .marketing/START.md. Understand this product and help me market it.

You can ask for strategy only, an original campaign, a reference adaptation,
artwork, a launch plan, a critique or a revision. The Director uses the requested
stage and brings in only the relevant expertise.

## Build and check

~~~sh
python3 .marketing/scripts/agency.py check
python3 .marketing/tests/check.py
python3 .marketing/scripts/agency.py package --out dist
~~~

The package supports Codex and Claude manifests. Python 3.9+ is enough for the
helpers. Models, image/video engines and publishing connectors are supplied by
your coding environment; this package does not run an autonomous background agency.
Generated plugin agents support Claude's native agent discovery. Codex uses the
Director and role briefs with its available delegation tools.

After a project has used the vault, use the clean export command in START.md to
carry the agency elsewhere. Do not copy that project's identity or private artwork.

Source reuse and licenses: [.marketing/SOURCES.md](.marketing/SOURCES.md).

## Maintaining the distributed plugin

Edit `.marketing/`, which is the source. `plugins/marketing-agency/` is the
generated, checked-in bundle required for GitHub marketplace installation.
Build into a fresh output directory, review it, then replace the distributed
bundle. Keep both copies in the same commit. Never edit only the generated copy.
Project vaults and research scratch are excluded from this repository.
