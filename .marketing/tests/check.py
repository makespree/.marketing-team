#!/usr/bin/env python3
"""Offline regression check: portability, revision preservation, packaging and timing."""
import importlib.util
import json
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


agency = load("agency", ROOT / "scripts/agency.py")
timing = load("timing", ROOT / "skills/agency-reference-restage/scripts/compare_timing.py")


def rejects(call):
    try:
        call()
    except (ValueError, OSError):
        return
    raise AssertionError("Unsafe or invalid operation was accepted")


def main():
    print(agency.check())
    with tempfile.TemporaryDirectory(prefix="agency-check-") as temp:
        base = Path(temp)
        project = base / "product-one"
        project.mkdir()
        kit = agency.init(project, "Product One")
        identity = (kit / "project.json").read_bytes()
        context = kit / "vault/product/context.md"
        context.write_text("PRIVATE PRODUCT FACTS\n")
        agency.init(project, "Product One")
        assert (kit / "project.json").read_bytes() == identity
        assert context.read_text() == "PRIVATE PRODUCT FACTS\n"
        rejects(lambda: agency.init(project, "Product Two"))
        rejects(lambda: agency.job(project, "../escape"))
        job = agency.job(project, "launch")
        rejects(lambda: agency.job(project, "launch"))
        revision = job / "revisions/v1"
        (revision / "caption.txt").write_text("Draft caption")
        # An SVG is real media, but this check does not claim a visual review.
        art = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>'
        (revision / "exports/first.svg").write_text(art)
        (revision / "exports/second.svg").write_text(art.replace("blue", "red"))
        (revision / "private-notes.txt").write_text("EXCLUDED")
        selected = ["exports/second.svg", "exports/first.svg"]
        args = (project, "launch", "v1", "caption.txt", selected, "en", "feed")
        path = agency.manifest(*args)
        original = path.read_bytes()
        data = json.loads(original)
        assert [p["path"] for p in data["files"]] == selected
        assert data["review_status"] == "needs-review" and data["distribution"] is None
        assert all(p["sha256"] == agency.digest(revision / p["path"]) for p in data["files"])
        assert agency.manifest(*args).read_bytes() == original
        rejects(lambda: agency.manifest(project, "launch", "v1", "caption.txt", [selected[0]] * 2, "en", "feed"))
        rejects(lambda: agency.selected_file(revision, "../../brief.md"))
        rejects(lambda: agency.selected_file(revision, str(context)))
        (revision / "exports/leak.svg").symlink_to(context)
        rejects(lambda: agency.selected_file(revision, "exports/leak.svg"))
        (revision / "exports/leak.svg").unlink()
        (revision / "caption.txt").write_text("Changed caption")
        rejects(lambda: agency.manifest(*args))
        assert path.read_bytes() == original
        print("PASS: project identity, non-overwrite, selected files, hashes and revision safety")

        # The review bridge copies only hashed selections, preserving order/history.
        import base64
        studio = agency.install_studio(project)
        assert not (studio / "project.json").exists() and not (studio / ".local").exists()
        rejects(lambda: agency.install_studio(project))
        config = {"sourceBinding": agency.hashlib.sha256(str(project.resolve()).encode()).hexdigest()[:12], "languages": [{"code": "en"}]}
        agency.save(studio / "project.json", config)
        # Installed npm bins are symlinks, but never part of staging/backup.
        (studio / "node_modules").mkdir()
        (studio / "node_modules/tool").symlink_to(context)
        review_job = agency.job(project, "review-card")
        rev = review_job / "revisions/v1"
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
        (rev / "exports/one.png").write_bytes(image)
        (rev / "exports/two.png").write_bytes(image + b"\n")
        (rev / "caption.txt").write_text("Caption")
        (rev / "private.txt").write_text("Do not upload")
        agency.manifest(project, "review-card", "v1", "caption.txt", ["exports/two.png", "exports/one.png"], "en", "feed")
        staged = agency.stage_review(project, "review-card", "v1", "Title")
        body = json.loads(staged.read_text())
        assert [Path(f).name for f in body["files"]] == ["01-two.png", "02-one.png"]
        assert not list((studio / "workspace").rglob("private.txt"))
        assert agency.stage_review(project, "review-card", "v1", "Title") == staged
        rejects(lambda: agency.stage_review(project, "review-card", "v1", "Changed title"))
        import shutil
        shutil.copytree(rev, review_job / "revisions/v2")
        rev2 = review_job / "revisions/v2"
        (rev2 / "manifest.json").unlink()
        (rev2 / "caption.txt").write_text("Revised caption")
        agency.manifest(project, "review-card", "v2", "caption.txt", ["exports/one.png"], "en", "feed")
        assert agency.stage_review(project, "review-card", "v2", "Title") == staged
        assert (staged.parent / "revisions/v1/submission.json").exists()
        assert json.loads(staged.read_text())["caption"] == "Revised caption"
        (rev2 / "exports/one.png").write_bytes(image + b"changed")
        rejects(lambda: agency.stage_review(project, "review-card", "v2", "Title"))
        (studio / "project.json").write_text(json.dumps({**config, "sourceBinding": "another-project"}))
        rejects(lambda: agency.stage_review(project, "review-card", "v1", "Title"))
        print("PASS: clean studio install, binding, selected staging, order, hashes and stable revision identity")

        # Exercise a used source kit, not just an empty export.
        source = agency.copy_kit(base / "used-source/.marketing")
        agency.init(source.parent, "Private brand")
        (source / "vault/private.txt").write_text("SECRET VAULT SENTINEL")
        (source / ".env").write_text("SECRET ENV SENTINEL")
        (source / "cloud.json").write_text("SECRET CLOUD SENTINEL")
        old_root = agency.KIT
        agency.KIT = source
        try:
            clean = agency.copy_kit(base / "clean/.marketing")
            assert sorted(p.name for p in (clean / "vault").iterdir()) == ["README.md"]
            for name in ("project.json", ".env", "cloud.json"):
                assert not (clean / name).exists()
            rejects(lambda: agency.copy_kit(clean))
            rejects(lambda: agency.copy_kit(source / "nested"))
            archive = agency.package(base / "bundle")
        finally:
            agency.KIT = old_root
        bundle = archive.parent / "marketing-agency"
        agency.check(bundle)
        bundled = load("bundled_agency", bundle / "scripts/agency.py")
        from_plugin = bundled.copy_kit(base / "from-plugin/.marketing")
        assert (from_plugin / "CLAUDE.md").is_file()
        assert not (from_plugin / "project.json").exists()
        for runtime in ("codex", "claude"):
            manifest = json.loads((bundle / f".{runtime}-plugin/plugin.json").read_text())
            assert manifest["name"] == bundle.name and manifest["skills"] == "./skills/"
        assert len(list((bundle / "agents").glob("*.md"))) == 8
        hashes = json.loads((bundle / "package-hashes.json").read_text())
        assert all(agency.digest(bundle / p) == h for p, h in hashes.items())
        with zipfile.ZipFile(archive) as z:
            assert len(z.namelist()) == len(hashes) + 1
            assert all(name.startswith("marketing-agency/") for name in z.namelist())
            assert all(b"SENTINEL" not in z.read(name) for name in z.namelist() if not name.endswith("tests/check.py"))
        rejects(lambda: agency.package(base / "bundle"))
        print("PASS: clean export excludes project/cloud/private files; both manifests, eight agents and ZIP hashes")

    ref = {"fps": 30, "duration_seconds": 6, "cuts_seconds": [1.5, 3, 4.5]}
    assert timing.compare(ref, ref)["passed"]
    assert timing.compare(ref, {**ref, "cuts_seconds": [1.5 + 1 / 30, 3, 4.5]})["passed"]
    for changed in ({"fps": 24}, {"duration_seconds": 7}, {"cuts_seconds": [1.5, 4.5]}, {"cuts_seconds": [1, 1.5, 3, 4.5]}):
        assert not timing.compare(ref, {**ref, **changed})["passed"]
    assert not timing.compare({**ref, "cuts_seconds": [1, 1.02]}, {**ref, "cuts_seconds": [1.01]})["passed"]
    for bad in ([], {**ref, "fps": True}, {**ref, "fps": float("nan")}, {**ref, "cuts_seconds": [1, 1]}, {**ref, "cuts_seconds": [6]}):
        rejects(lambda: timing.compare(ref, bad))
    rejects(lambda: timing.compare(ref, ref, -1))
    print("PASS: timing tolerances, one-to-one cuts, FPS/duration mismatch and malformed input")
    print("All offline checks passed. No model, renderer, plugin installation or external service was exercised.")


if __name__ == "__main__":
    main()
