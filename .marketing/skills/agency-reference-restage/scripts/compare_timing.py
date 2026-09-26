#!/usr/bin/env python3
"""Compare reviewed timing JSONs: {fps, duration_seconds, cuts_seconds: [...]}.

This compares supplied timestamps, not video content. No cut detection is implied.
"""
import argparse
import json
import math
from pathlib import Path


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("Timing input must be a JSON object.")
    def number(value):
        return type(value) in (int, float) and math.isfinite(value)
    fps, duration, cuts = data.get("fps"), data.get("duration_seconds"), data.get("cuts_seconds")
    if not number(fps) or not 0 < fps <= 1000 or not number(duration) or duration <= 0:
        raise ValueError("FPS and duration must be finite positive numbers.")
    if not isinstance(cuts, list) or any(not number(c) or not 0 < c < duration for c in cuts):
        raise ValueError("Cuts must be finite timestamps inside the video duration.")
    if cuts != sorted(set(cuts)):
        raise ValueError("Cuts must be unique and in increasing order.")
    return fps, duration, cuts


def compare(reference, actual, tolerance_frames=1):
    rfps, rd, rc = validate(reference)
    afps, ad, ac = validate(actual)
    if type(tolerance_frames) is not int or not 0 <= tolerance_frames <= 10:
        raise ValueError("Tolerance must be an integer from 0 to 10 frames.")
    tolerance = tolerance_frames / rfps + 1e-9
    matched, missed, extra = [], [], []
    i = j = 0
    # ponytail: ordered tolerance matching, suitable for reviewed shot tables;
    # use a sequence alignment method if deliberately reordered edits are needed.
    while i < len(rc) and j < len(ac):
        delta = ac[j] - rc[i]
        if abs(delta) <= tolerance:
            matched.append({"reference": rc[i], "actual": ac[j], "delta_frames": round(delta * rfps, 6)})
            i += 1; j += 1
        elif delta < 0:
            extra.append(ac[j]); j += 1
        else:
            missed.append(rc[i]); i += 1
    missed.extend(rc[i:]); extra.extend(ac[j:])
    fps_match = math.isclose(rfps, afps, rel_tol=1e-6)
    duration_match = abs(ad - rd) <= tolerance
    return {"passed": fps_match and duration_match and not missed and not extra,
            "fps_match": fps_match, "duration_match": duration_match,
            "duration_delta_seconds": ad - rd, "tolerance_frames": tolerance_frames,
            "matched": matched, "missed": missed, "extra": extra,
            "scope": "Declared timing only; creative fidelity and audio are not tested."}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("reference"); p.add_argument("actual")
    p.add_argument("--tolerance-frames", type=int, default=1)
    args = p.parse_args()
    try:
        result = compare(json.loads(Path(args.reference).read_text()), json.loads(Path(args.actual).read_text()), args.tolerance_frames)
    except (ValueError, OSError, TypeError) as error:
        raise SystemExit(str(error))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passed"] else 1)
