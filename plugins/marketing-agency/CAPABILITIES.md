# Capability map

| Task | Skill | Typical specialist |
|---|---|---|
| Discuss, brief, route, resume | agency-director | Director |
| Product truth and positioning | agency-product-marketing | Launch strategist |
| Customer and cultural research | agency-customer-research | Research strategist |
| Launch narrative and rollout | agency-launch | Launch strategist |
| Content territories and share mechanics | agency-content-strategy | Research + creative |
| Copy, scripts and captions | agency-copywriting | Creative director |
| Measurement and experiment plans | agency-analytics | Distribution strategist |
| Supplied reel/image/carousel adaptation | agency-reference-restage | Motion + art |
| Original assets, graphic systems, carousels | agency-visual-production | Art director |
| Final media, claim and handoff review | agency-content-review | Quality reviewer |

The six business skills are condensed MIT-licensed adaptations; source and hashes
are in SOURCES.md and sources.lock.json. They are intentionally not a bulk install
of the entire upstream library.

## Runtime discovery, once per job

Record actual available capabilities in the brief: image generation/editing,
browser capture, audio playback, video renderer, font files and export tools.
Use an installed engine's own skill before operating it.
Use whichever generation and rendering capabilities the active project authorizes.
Codex image generation and Hyperframes are examples, not required dependencies.
These are optional runtime dependencies, not bundled or guaranteed.
The agency does not download providers or silently replace unavailable tools
with paid services. Produce a usable brief/source handoff if a renderer is absent.

The generic restage method includes a timestamp comparison helper. It does not
pretend to detect every cut, understand a reference, or validate creative quality.
Use the installed video-analysis tools, inspect the frames, and supply reviewed
cut times. Real UI demonstrations require actual captures, not generated screens.

## Optional private review studio
The bundled Firebase app provides invited Google sign-in, private media, ordered
carousels, captions, review decisions and revision history after project-specific
setup. install-studio copies clean code; stage-review copies selected hash-verified
exports. Neither command deploys. The runtime README and Director Firebase
workflow cover setup, receipts and revision handoff.
