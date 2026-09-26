---
name: agency-reference-restage
description: Adapt supplied video, carousel or image references to a project's own story, preserving the requested design and timing while producing original or authorized assets.
---

# Reference restage

Read the current job brief and the actual reference, not just its description.
Use the active project's .marketing/vault; source skills may run from a plugin cache.

## Understand the mechanism
For video: inspect duration, frame rate, active picture, shot boundaries, typography,
motion, subject anchors, audio onset/offset, reading holds and payoff. Watch the full
reference with sound when available; record any unavailable inspection.
For carousels: inspect every slide, the swipe incentive, continuity, reveal order
and how the final slide pays back the first. For a still: hierarchy, material,
composition, contrast, message and brand placement.
Record what is observed separately from why you think it works.

## Adapt deliberately
Write a short original → ours mapping using preserve / borrow / explore /
pass conditions. Preserve the qualities the user explicitly values. Don't force a
product pitch into brand art or change the reference's rhythm merely to add features.
Get a direction decision only when it is unresolved; authorization already supplied
does not need repeating. Unsupported or restricted factual elements need a different
treatment, not a fabricated substitute.

## Produce
Make an asset inventory: exact supplied assets; original/generated art; licensed
photographs; typography; sound; actual product captures. Record provenance and use scope.
Never mistake a reference image for permission to rebrand the underlying artwork.
Preserve authorized logos as exact source layers. Generated scenes must not be
described as documentary photography. A soundtrack available in an app does not
automatically cover every account, region, commercial use or paid ad.
Use an installed production skill/engine; no renderer or generator is bundled here.

For stop motion, prefer a fixed backdrop and separate props when that preserves
continuity. Define real choreography and stepped poses, not just a stack of icons.
Normalize subject anchors across poses using visible bounds, baseline and scale.
Inspect any contact-sheet slices for adjacent-cell bleed. Check real alpha; painted
checkerboards are not transparency. Regenerate or use an authorized editing tool.

## Verify
Compare reference and export at the same story moments. Check hierarchy, framing,
motion energy, timing, anatomy, copy, material, sound and emotional payoff.
For strict timing, review a cut table and compare timestamps with
scripts/compare_timing.py. It checks declared cut timing, duration and FPS only.
It cannot establish scene similarity or detect cuts; inspect encoded frames yourself.
Variable frame rate references must be mapped by timestamps or normalized explicitly.
If the approved brief changes the duration/end, compare only the intended adaptation.

Use two reviewed JSON files with the same schema, for example:
~~~json
{"fps": 30, "duration_seconds": 6, "cuts_seconds": [1.5, 3, 4.5]}
~~~
Run from this skill's directory:
~~~sh
python3 scripts/compare_timing.py reference.json actual.json --tolerance-frames 1
~~~
Exit 0 means declared timing passes; exit 1 means a mismatch or invalid input.

Deliver an editable composition, final export, optional silent master, source ledger,
exact prompt/copy, timing evidence and review notes in the job. No studio, format,
20 MB ceiling, festival language or specific renderer is assumed across projects.
