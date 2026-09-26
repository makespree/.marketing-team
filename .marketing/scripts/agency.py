#!/usr/bin/env python3
"""Portable agency setup and packaging. Python standard library; no network or installs."""
import argparse
import hashlib
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
PORTABLE = ("START.md", "AGENTS.md", "CLAUDE.md", "CAPABILITIES.md", "RUNTIMES.md",
            "SOURCES.md", "sources.lock.json", ".gitignore", "skills", "scripts", "tests", "licenses")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def slug(value):
    if not SLUG.fullmatch(value) or len(value) > 64:
        raise ValueError("Use a lowercase hyphenated ID of at most 64 characters.")
    return value


def digest(path):
    with path.open("rb") as stream:
        h = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create: repeated commands cannot clobber a user's revision.
    with path.open("x", encoding="utf8") as stream:
        stream.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def no_links(path):
    if path.is_symlink():
        raise ValueError(f"Symbolic links are not portable: {path}")
    if path.is_dir():
        for child in path.rglob("*"):
            if child.is_symlink():
                raise ValueError(f"Symbolic links are not portable: {child}")


def project_root(project):
    root = Path(project).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Project must be an existing directory.")
    kit = root / ".marketing"
    no_links(kit)
    return kit


def init(project, name):
    kit = project_root(project)
    if not name.strip():
        raise ValueError("Product name must not be empty.")
    identity = kit / "project.json"
    if identity.exists():
        current = json.loads(identity.read_text())
        if current["name"] != name:
            raise ValueError("This vault belongs to another product. Export a clean kit instead.")
    else:
        if (kit / "vault").exists() and any(p.name != "README.md" for p in (kit / "vault").iterdir()):
            raise ValueError("Unidentified existing vault: inspect it before initialization.")
        save(identity, {"schema": 1, "project_id": str(uuid.uuid4()), "name": name})
    kit.mkdir(parents=True, exist_ok=True)
    if not (kit / ".gitignore").exists():
        (kit / ".gitignore").write_text((KIT / ".gitignore").read_text())
    vault = kit / "vault"
    for folder in ("product", "brand", "decisions", "research", "artwork", "jobs", "results"):
        (vault / folder).mkdir(parents=True, exist_ok=True)
    templates = KIT / "skills/agency-director/references/templates"
    defaults = {
        "product/context.md": f"# {name}\nStatus: unreviewed\nVersion: v1\n\nProduct truth, audience, positioning and proof have not yet been researched.\n",
        "brand/guidelines.md": (templates / "brand.md").read_text(),
        "decisions/log.md": "# Decisions\n\nNo owner decisions recorded yet.\n",
        "artwork/index.json": "[]\n",
    }
    for relative, content in defaults.items():
        path = vault / relative
        if not path.exists():
            with path.open("x", encoding="utf8") as stream:
                stream.write(content)
    return kit


def job(project, job_id):
    kit = project_root(project)
    if not (kit / "project.json").is_file():
        raise ValueError("Initialize the project before creating a job.")
    path = kit / "vault/jobs" / slug(job_id)
    path.mkdir(parents=True, exist_ok=False)
    template = KIT / "skills/agency-director/references/templates/brief.md"
    (path / "brief.md").write_text(template.read_text())
    for folder in ("research", "prompts", "sources", "revisions/v1/exports", "receipts"):
        (path / folder).mkdir(parents=True)
    return path


def selected_file(revision, relative):
    p = Path(relative)
    if p.is_absolute() or ".." in p.parts:
        raise ValueError("Select paths relative to this revision, without '..'.")
    full = revision / p
    for part in (full, *full.parents):
        if part == revision.parent:
            break
        if part.is_symlink():
            raise ValueError("Selected files must not use symbolic links.")
    resolved = full.resolve(strict=True)
    if not resolved.is_relative_to(revision.resolve()) or not resolved.is_file():
        raise ValueError("Selected file is outside the revision or is not a regular file.")
    return resolved


def manifest(project, job_id, revision_id, caption, files, language, placement):
    kit = project_root(project)
    revision = kit / "vault/jobs" / slug(job_id) / "revisions" / slug(revision_id)
    if not revision.is_dir():
        raise ValueError("Create the job/revision before preparing its manifest.")
    no_links(revision)
    identity = json.loads((kit / "project.json").read_text())
    caption_path = selected_file(revision, caption)
    selected = [selected_file(revision, name) for name in files]
    if not selected or len(set(selected)) != len(selected) or caption_path in selected:
        raise ValueError("Select unique media files, separate from the caption.")
    media = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".mp4", ".mov", ".webm", ".wav", ".mp3", ".pdf"}
    if any(p.suffix.lower() not in media or not p.stat().st_size for p in selected):
        raise ValueError("Select nonempty image, video, audio or PDF exports only.")
    result = {
        "schema": 1, "project_id": identity["project_id"], "job_id": job_id,
        "revision": revision_id, "review_status": "needs-review",
        "language": language, "placement": placement,
        "caption": caption_path.read_text(encoding="utf8"), "caption_sha256": digest(caption_path),
        "files": [{"path": p.relative_to(revision).as_posix(), "sha256": digest(p), "bytes": p.stat().st_size} for p in selected],
        "distribution": None,
    }
    target = revision / "manifest.json"
    if target.exists():
        if json.loads(target.read_text()) != result:
            raise ValueError("This revision has a different manifest. Create a new revision; preserve approval/history.")
    else:
        save(target, result)
    return target


def copy_kit(target):
    target = Path(target).absolute()
    if target.exists() or target.is_symlink():
        raise ValueError("Destination must not exist; no overwrite is performed.")
    if target.resolve().is_relative_to(KIT.resolve()) or KIT.resolve().is_relative_to(target.resolve()):
        # dist is intentionally permitted only through package's external staging.
        raise ValueError("Export destination must be outside the source kit.")
    for name in PORTABLE:
        source = KIT / name
        if not source.exists():
            raise ValueError(f"Missing portable source: {name}")
        no_links(source)
    target.mkdir(parents=True)
    for name in PORTABLE:
        source, dest = KIT / name, target / name
        if source.is_dir():
            shutil.copytree(source, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            shutil.copy2(source, dest)
    (target / "vault").mkdir()
    shutil.copy2(KIT / "vault/README.md", target / "vault/README.md")
    return target


def package(out):
    # Stage outside KIT so exports cannot recursively copy their own output.
    import tempfile
    out = Path(out).absolute()
    dest = out / "marketing-agency"
    archive = out / "marketing-agency.zip"
    if dest.exists() or dest.is_symlink() or archive.exists() or archive.is_symlink():
        raise ValueError("Package output already exists; use a fresh output directory.")
    with tempfile.TemporaryDirectory(prefix="agency-package-") as temp:
        stage = copy_kit(Path(temp) / "marketing-agency")
        common = {"name": "marketing-agency", "version": "0.1.0", "description": "A portable creative agency with a Director, expert bench, reusable skills and project vault.", "author": {"name": "Samay Patel"}, "skills": "./skills/"}
        save(stage / ".codex-plugin/plugin.json", {**common, "interface": {
            "displayName": "Marketing Agency",
            "shortDescription": "Strategy, creative production and review in one project vault",
            "longDescription": "Coordinate research, positioning, launches, copy, artwork, reference adaptations and review using ten reusable skills and an eight-role bench. Project records stay in the active project's vault. Production uses the host's available tools.",
            "developerName": "Samay Patel", "category": "Productivity",
            "capabilities": ["Interactive", "Read", "Write"],
            "defaultPrompt": ["Help me market this product.", "Adapt this reference to our brand.", "Review this campaign and suggest the next move."]}})
        save(stage / ".claude-plugin/plugin.json", common)
        profiles = stage / "skills/agency-director/references/agents"
        agents = stage / "agents"
        agents.mkdir()
        for profile in sorted(profiles.glob("*.md")):
            content = profile.read_text()
            description = next(x.removeprefix("Responsibility: ") for x in content.splitlines() if x.startswith("Responsibility: "))
            # Claude resolves the plugin root variable; relative markdown links also
            # point into the same package for readers and non-Claude consumers.
            content = content.replace("../experts/", "../skills/agency-director/references/experts/")
            prefix = f"---\nname: agency-{profile.stem}\ndescription: {description}\n---\n\nRead ${{CLAUDE_PLUGIN_ROOT}}/skills/agency-director/SKILL.md for project-vault and handoff rules.\n\n"
            (agents / profile.name).write_text(prefix + content)
        hashes = {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob("*")) if p.is_file()}
        save(stage / "package-hashes.json", hashes)
        out.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, dest)
        with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(dest.rglob("*")):
                if p.is_file():
                    z.write(p, "marketing-agency/" + p.relative_to(dest).as_posix())
    return archive


def check(root=KIT):
    no_links(root / "skills")
    skills = list((root / "skills").glob("*/SKILL.md"))
    for skill in skills:
        text = skill.read_text()
        front = re.match(r"---\n(.*?)\n---", text, re.S)
        if not front or f"name: {skill.parent.name}\n" not in front.group(0):
            raise ValueError(f"Invalid skill name/frontmatter: {skill}")
        if not re.search(r"^description: \S.+$", front.group(1), re.M):
            raise ValueError(f"Missing description: {skill}")
    for p in root.rglob("*.md"):
        if any(x in p.relative_to(root).parts for x in ("vault", "dist", ".cache")):
            continue
        for link in re.findall(r"\]\(([^)]+)\)", p.read_text()):
            if "://" in link or link.startswith("#"):
                continue
            if not (p.parent / link.split("#")[0]).exists():
                raise ValueError(f"Broken local link in {p}: {link}")
    lock = json.loads((root / "sources.lock.json").read_text())
    if digest(root / lock["license_path"]) != lock["license_sha256"]:
        raise ValueError("Upstream license notice changed.")
    for item in lock["adaptations"]:
        if digest(root / item["path"]) != item["adapted_sha256"]:
            raise ValueError(f"Adaptation changed; update provenance deliberately: {item['path']}")
    return f"Checked {len(skills)} skills, local document links and adaptation hashes."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("init"); p.add_argument("--project", required=True); p.add_argument("--name", required=True)
    p = commands.add_parser("job"); p.add_argument("--project", required=True); p.add_argument("--id", required=True)
    p = commands.add_parser("manifest")
    for key in ("project", "job", "revision", "caption", "language"):
        p.add_argument("--" + key, required=True)
    p.add_argument("--files", nargs="+", required=True)
    p.add_argument("--placement", choices=("feed", "reel", "story", "web", "other"), required=True)
    for name in ("export", "package"):
        commands.add_parser(name).add_argument("--out", required=True)
    commands.add_parser("check")
    a = parser.parse_args()
    if a.command == "init": result = init(a.project, a.name)
    elif a.command == "job": result = job(a.project, a.id)
    elif a.command == "manifest": result = manifest(a.project, a.job, a.revision, a.caption, a.files, a.language, a.placement)
    elif a.command == "export": result = copy_kit(Path(a.out) / ".marketing")
    elif a.command == "package": result = package(a.out)
    else: result = check()
    print(result)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(str(error))
