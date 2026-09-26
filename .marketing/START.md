# Marketing Agency

A portable agency for a project, driven by the coding agent you already use.
Talk to the Director: "Read .marketing/START.md and help launch this product."

## Start here

Read [the Director skill](skills/agency-director/SKILL.md). It selects specialists
and methods for the task. It is also the entry point for discussion, critique,
research, original campaigns, supplied references and revisions.

- [Expert bench](skills/agency-director/references/bench.md)
- [Workflow routing](skills/agency-director/references/workflows.md)
- [Project vault contract](skills/agency-director/references/vault.md)
- [Available skills and engines](CAPABILITIES.md)
- [Sources, licenses and adaptations](SOURCES.md)

## First use in a project

Run with Python 3, from the project's root:
~~~sh
python3 .marketing/scripts/agency.py init --project . --name "Your product"
~~~
This creates an empty project vault. The Director then studies the real product
and drafts its context. Initialization does not invent your brand or audience.
Re-running preserves existing work; a different product name is rejected.
Use the host repository's launcher when it requires one.

## Carry it to another project

~~~sh
python3 .marketing/scripts/agency.py export --out /path/to/clean-kit
~~~
Copy clean-kit/.marketing into the next project. Export excludes the used vault,
project identity, credentials, cloud settings, caches and generated media.
Do not copy a used project vault into another brand.

## Plugins

~~~sh
python3 .marketing/scripts/agency.py package --out .marketing/dist
~~~
Produces a self-contained marketing-agency plugin and ZIP with Codex and Claude
Code manifests. Claude plugin agents are generated from the same bench files.
To test in Claude Code: claude --plugin-dir .marketing/dist/marketing-agency
Then invoke /marketing-agency:agency-director.

For Codex, import the generated local plugin using the available plugin UI/CLI.
No user-level installation is performed by these scripts. Direct file invocation
works without installing a plugin. Package validation is not proof of installation
or of a live multi-agent run. See [runtime notes](RUNTIMES.md).

## What travels

Agency instructions, specialist profiles, researched expert lenses, methods,
templates, source/license records and small helper scripts travel.
Product identity, approved artwork, decisions, research, jobs and results live in
the project vault. Generated work stays local and ignored by Git by default.
There is no bundled model, paid provider, daemon, scheduler or publishing service.

## Maintain this package

The source of truth is this .marketing folder. Run:
~~~sh
python3 .marketing/scripts/agency.py check
python3 .marketing/tests/check.py
~~~
The package has no dependency on a host repository, Firebase project, studio or publisher.
