"""Éditeur local du site : application web (Flask) qui lit et écrit les fichiers
du dépôt (content/, hugo.toml) et pilote Git et Hugo.

Lancement : python tools/editor/run.py
"""
from __future__ import annotations

import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import unicodedata
from datetime import date
from pathlib import Path

import markdown
import yaml
from flask import Flask, abort, jsonify, request, send_from_directory
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONTENT = ROOT / "content"
HUGO_TOML = ROOT / "hugo.toml"
PREVIEW_DIR = HERE / ".preview"
TOKEN = secrets.token_urlsafe(24)
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
MAX_IMAGE_SIDE = 2400

app = Flask(__name__, static_folder=str(HERE / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024

# ----------------------------------------------------------------------
# Schéma des contenus : pour adapter les formulaires, modifier ici.
# type : text | textarea | date | tags | bool | image | url
# ----------------------------------------------------------------------
F_TITLE = {"key": "title", "label": "Titre", "type": "text", "required": True}
F_DATE = {"key": "date", "label": "Date", "type": "date"}
F_DESC = {"key": "description", "label": "Résumé (aperçus, moteurs de recherche)", "type": "textarea"}
F_IMAGE = {"key": "image", "label": "Image de couverture", "type": "image"}
F_ALT = {"key": "image_alt", "label": "Texte alternatif de la couverture", "type": "text"}
F_DRAFT = {"key": "draft", "label": "Brouillon (non publié)", "type": "bool"}

COLLECTIONS = {
    "blog": {
        "label": "Articles",
        "singular": "article",
        "fields": [
            F_TITLE, F_DATE, F_DESC,
            {"key": "tags", "label": "Tags (séparés par des virgules)", "type": "tags"},
            F_IMAGE, F_ALT, F_DRAFT,
        ],
    },
    "book": {
        "label": "Réalisations",
        "singular": "réalisation",
        "fields": [
            F_TITLE, F_DATE, F_DESC,
            {"key": "media", "label": "Média / client", "type": "text"},
            {"key": "role", "label": "Rôle", "type": "text"},
            {"key": "categorie", "label": "Catégorie (filtre)", "type": "text"},
            {"key": "lien", "label": "Lien vers l'original", "type": "url"},
            F_IMAGE, F_ALT, F_DRAFT,
        ],
    },
    "pages": {
        "label": "Pages",
        "singular": "page",
        "fields": [
            F_TITLE,
            {"key": "chapo", "label": "Chapeau (phrase d'introduction)", "type": "text"},
        ],
    },
}


# ----------------------------------------------------------------------
# Sécurité : serveur local uniquement + jeton pour les écritures
# ----------------------------------------------------------------------
@app.before_request
def guard():
    host = (request.host or "").split(":")[0]
    if host not in ("127.0.0.1", "localhost", "[::1]"):
        abort(403)
    if request.method not in ("GET", "HEAD") and request.headers.get("X-Token") != TOKEN:
        abort(403)


def err(message: str, code: int = 400):
    return jsonify({"error": message}), code


# ----------------------------------------------------------------------
# Utilitaires fichiers
# ----------------------------------------------------------------------
def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "sans-titre"


def safe_item_path(rel: str) -> Path:
    """Chemin d'un contenu .md à l'intérieur de content/ (anti « ../ »)."""
    p = (CONTENT / rel).resolve()
    if CONTENT.resolve() not in p.parents or p.suffix != ".md":
        abort(400, "Chemin invalide")
    return p


def rel_of(p: Path) -> str:
    return p.resolve().relative_to(CONTENT.resolve()).as_posix()


def collection_of(rel: str) -> str:
    parts = rel.split("/")
    if parts[0] in ("blog", "book") and parts[-1] != "_index.md" and len(parts) > 1:
        return parts[0]
    return "pages"


def split_front_matter(text: str) -> tuple[dict, str]:
    text = text.lstrip("﻿")
    if text.startswith("---"):
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
        if m:
            try:
                data = yaml.safe_load(m.group(1)) or {}
            except yaml.YAMLError:
                data = {}
            return (data if isinstance(data, dict) else {}), m.group(2)
    return {}, text


def jstr(v: str) -> str:
    return json.dumps(v, ensure_ascii=False)


def dump_front_matter(coll: str, fields: dict, extra: dict) -> str:
    lines = ["---"]
    for f in COLLECTIONS[coll]["fields"]:
        k, t, v = f["key"], f["type"], fields.get(f["key"])
        if t == "bool":
            if k == "draft" and not v and "draft" not in fields:
                continue
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif t == "tags":
            tags = [x.strip() for x in (v or []) if x and x.strip()]
            if tags:
                lines.append(f"{k}: [{', '.join(jstr(x) for x in tags)}]")
        elif t == "date":
            if v:
                lines.append(f"{k}: {v}")
        else:
            if v not in (None, ""):
                lines.append(f"{k}: {jstr(str(v))}")
    if extra:
        lines.append(yaml.safe_dump(extra, allow_unicode=True, sort_keys=False).rstrip())
    lines.append("---")
    return "\n".join(lines) + "\n"


def images_of(p: Path) -> list[str]:
    if p.name not in ("index.md", "_index.md"):
        return []
    return sorted(
        f.name for f in p.parent.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXT
    )


def load_item(p: Path) -> dict:
    rel = rel_of(p)
    coll = collection_of(rel)
    fm, body = split_front_matter(p.read_text(encoding="utf-8"))
    known = {f["key"] for f in COLLECTIONS[coll]["fields"]}
    fields = {}
    for f in COLLECTIONS[coll]["fields"]:
        v = fm.get(f["key"])
        if f["type"] == "date" and v is not None:
            v = str(v)[:10]
        elif f["type"] == "tags":
            v = [str(x) for x in v] if isinstance(v, list) else ([] if v is None else [str(v)])
        elif f["type"] == "bool":
            v = bool(v)
        elif v is None:
            v = ""
        fields[f["key"]] = v
    extra = {k: v for k, v in fm.items() if k not in known}
    extra_yaml = yaml.safe_dump(extra, allow_unicode=True, sort_keys=False) if extra else ""
    return {
        "path": rel,
        "collection": coll,
        "fields": fields,
        "extra": extra_yaml,
        "body": body.lstrip("\n"),
        "images": images_of(p),
        "bundle": p.name in ("index.md", "_index.md"),
    }


def iter_collection(coll: str):
    if coll == "blog":
        base = CONTENT / "blog"
        for f in sorted(base.glob("*.md")):
            if f.name != "_index.md":
                yield f
        for f in sorted(base.glob("*/index.md")):
            yield f
    elif coll == "book":
        base = CONTENT / "book"
        for f in sorted(base.glob("*.md")):
            if f.name != "_index.md":
                yield f
        for f in sorted(base.glob("*/index.md")):
            yield f
    else:
        for f in sorted(CONTENT.glob("*.md")):
            yield f
        for sub in ("blog", "book"):
            f = CONTENT / sub / "_index.md"
            if f.exists():
                yield f


# ----------------------------------------------------------------------
# Pages de l'application
# ----------------------------------------------------------------------
@app.get("/")
def index():
    html = (HERE / "static" / "index.html").read_text(encoding="utf-8")
    return html.replace("__TOKEN__", TOKEN)


@app.get("/api/schema")
def api_schema():
    return jsonify(COLLECTIONS)


# ----------------------------------------------------------------------
# Contenus
# ----------------------------------------------------------------------
@app.get("/api/items/<coll>")
def api_items(coll):
    if coll not in COLLECTIONS:
        abort(404)
    out = []
    for f in iter_collection(coll):
        fm, _ = split_front_matter(f.read_text(encoding="utf-8"))
        out.append({
            "path": rel_of(f),
            "title": str(fm.get("title") or rel_of(f)),
            "date": str(fm.get("date") or "")[:10],
            "draft": bool(fm.get("draft")),
            "categorie": str(fm.get("categorie") or ""),
        })
    out.sort(key=lambda x: x["date"], reverse=True)
    return jsonify(out)


@app.get("/api/item")
def api_item():
    p = safe_item_path(request.args.get("path", ""))
    if not p.exists():
        abort(404)
    return jsonify(load_item(p))


@app.post("/api/create")
def api_create():
    data = request.get_json(force=True)
    coll = data.get("collection")
    title = (data.get("title") or "").strip()
    if coll not in ("blog", "book") or not title:
        return err("Collection ou titre manquant.")
    today = data.get("date") or date.today().isoformat()
    slug = slugify(title)
    if coll == "blog":
        base = CONTENT / "blog" / f"{today}-{slug}"
        target, n = base.with_suffix(".md"), 2
        while target.exists() or base.exists():
            base = CONTENT / "blog" / f"{today}-{slug}-{n}"
            target, n = base.with_suffix(".md"), n + 1
    else:
        folder, n = CONTENT / "book" / slug, 2
        while folder.exists():
            folder = CONTENT / "book" / f"{slug}-{n}"
            n += 1
        folder.mkdir(parents=True)
        target = folder / "index.md"
    fields = {"title": title, "date": today, "draft": True}
    target.write_text(dump_front_matter(coll, fields, {}) + "\n", encoding="utf-8")
    return jsonify(load_item(target))


@app.put("/api/item")
def api_save():
    data = request.get_json(force=True)
    p = safe_item_path(data.get("path", ""))
    if not p.exists():
        abort(404)
    coll = collection_of(rel_of(p))
    fields = data.get("fields", {})
    if not str(fields.get("title", "")).strip():
        return err("Le titre est obligatoire.")
    extra = {}
    if (data.get("extra") or "").strip():
        try:
            extra = yaml.safe_load(data["extra"]) or {}
        except yaml.YAMLError as e:
            return err(f"Champs avancés invalides (YAML) : {e}")
        if not isinstance(extra, dict):
            return err("Les champs avancés doivent être une liste « clé: valeur ».")
    body = (data.get("body") or "").replace("\r\n", "\n").rstrip() + "\n"
    p.write_text(dump_front_matter(coll, fields, extra) + "\n" + body, encoding="utf-8")
    return jsonify(load_item(p))


@app.delete("/api/item")
def api_delete():
    p = safe_item_path(request.args.get("path", ""))
    if not p.exists():
        abort(404)
    if p.name == "_index.md" or collection_of(rel_of(p)) == "pages":
        return err("Cette page ne peut pas être supprimée depuis l'éditeur.")
    if p.name == "index.md":
        shutil.rmtree(p.parent)
    else:
        p.unlink()
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Images
# ----------------------------------------------------------------------
def ensure_bundle(p: Path) -> Path:
    """Transforme blog/xxx.md en blog/xxx/index.md pour pouvoir y ranger des images."""
    if p.name in ("index.md", "_index.md"):
        return p
    folder = p.with_suffix("")
    folder.mkdir()
    new = folder / "index.md"
    p.rename(new)
    return new


def store_image(raw: bytes, original_name: str, folder: Path) -> str:
    stem = slugify(Path(original_name).stem)
    ext = Path(original_name).suffix.lower()
    if ext not in IMAGE_EXT:
        raise ValueError("Format d'image non pris en charge (jpg, png, gif, webp, svg).")
    data = raw
    if ext in (".jpg", ".jpeg", ".png", ".webp"):
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        if max(img.size) > MAX_IMAGE_SIDE:
            img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        out = io.BytesIO()
        if ext == ".png":
            img.save(out, "PNG", optimize=True)
        elif ext == ".webp":
            img.save(out, "WEBP", quality=88)
        else:
            img.convert("RGB").save(out, "JPEG", quality=86, optimize=True)
            ext = ".jpg"
        data = out.getvalue()
    name, n = f"{stem}{ext}", 2
    while (folder / name).exists():
        name = f"{stem}-{n}{ext}"
        n += 1
    (folder / name).write_bytes(data)
    return name


@app.post("/api/upload")
def api_upload():
    p = safe_item_path(request.form.get("path", ""))
    if not p.exists():
        abort(404)
    file = request.files.get("file")
    if not file:
        return err("Aucun fichier reçu.")
    p = ensure_bundle(p)
    try:
        name = store_image(file.read(), file.filename or "image.jpg", p.parent)
    except Exception as e:  # image illisible, format interdit...
        return err(str(e))
    return jsonify({"path": rel_of(p), "name": name, "images": images_of(p)})


@app.delete("/api/image")
def api_image_delete():
    p = safe_item_path(request.args.get("path", ""))
    name = Path(request.args.get("name", "")).name
    f = p.parent / name
    if p.name not in ("index.md", "_index.md") or f.suffix.lower() not in IMAGE_EXT or not f.is_file():
        abort(404)
    f.unlink()
    return jsonify({"images": images_of(p)})


@app.get("/api/media")
def api_media():
    p = safe_item_path(request.args.get("path", ""))
    name = Path(request.args.get("name", "")).name
    return send_from_directory(p.parent, name)


# ----------------------------------------------------------------------
# Aperçu Markdown
# ----------------------------------------------------------------------
@app.post("/api/preview")
def api_preview():
    data = request.get_json(force=True)
    html = markdown.markdown(data.get("body") or "", extensions=["extra", "sane_lists"])
    path = data.get("path", "")
    if path:
        from urllib.parse import quote

        def fix(m):
            return f'src="/api/media?path={quote(path)}&name={quote(m.group(1))}"'
        html = re.sub(r'src="(?!https?:|/|data:)([^"]+)"', fix, html)
    return jsonify({"html": html})


# ----------------------------------------------------------------------
# Réglages : hugo.toml
# ----------------------------------------------------------------------
SETTINGS = [
    ("", "title", "Nom du site"),
    ("params", "tagline", "Sous-titre (sous le nom)"),
    ("params", "description", "Description du site (moteurs de recherche)"),
    ("params", "email", "Adresse e-mail de contact"),
    ("params", "formspree", "Adresse Formspree du formulaire (facultatif)"),
    ("params.social", "linkedin", "LinkedIn"),
    ("params.social", "mastodon", "Mastodon"),
    ("params.social", "bluesky", "Bluesky"),
    ("params.social", "instagram", "Instagram"),
]
HEADER_RE = re.compile(r"^\s*(\[\[?)\s*([^\]\s]+)\s*\]\]?\s*(#.*)?$")
KV_RE = re.compile(r'^(\s*)([A-Za-z_][\w-]*)\s*=\s*"(.*)"\s*(#.*)?$')


def read_toml_lines() -> list[str]:
    return HUGO_TOML.read_text(encoding="utf-8").split("\n")


def get_setting(lines, section, key):
    cur = ""
    for ln in lines:
        h = HEADER_RE.match(ln)
        if h:
            cur = h.group(2) if h.group(1) == "[" else "[[" + h.group(2)
            continue
        m = KV_RE.match(ln)
        if m and cur == section and m.group(2) == key:
            try:
                return json.loads('"' + m.group(3) + '"')
            except ValueError:
                return m.group(3)
    return ""


def set_setting(lines, section, key, value):
    cur, header_idx = "", None
    for i, ln in enumerate(lines):
        h = HEADER_RE.match(ln)
        if h:
            cur = h.group(2) if h.group(1) == "[" else "[[" + h.group(2)
            if cur == section:
                header_idx = i
            continue
        m = KV_RE.match(ln)
        if m and cur == section and m.group(2) == key:
            if value == "" and section == "params.social":
                del lines[i]
            else:
                tail = f" {m.group(4)}" if m.group(4) else ""
                lines[i] = f"{m.group(1)}{key} = {jstr(value)}{tail}"
            return
    if value == "" and section == "params.social":
        return
    new = f"{key} = {jstr(value)}"
    if section == "":
        first_header = next((i for i, ln in enumerate(lines) if HEADER_RE.match(ln)), len(lines))
        lines.insert(first_header, new)
    elif header_idx is not None:
        lines.insert(header_idx + 1, "  " + new)
    else:
        lines.extend(["", f"[{section}]", "  " + new])


def parse_menu(lines):
    items, cur = [], None
    for ln in lines:
        h = HEADER_RE.match(ln)
        if h:
            cur = None
            if h.group(1) == "[[" and h.group(2) == "menus.main":
                cur = {"name": "", "ref": "", "weight": 0}
                items.append(cur)
            continue
        m = re.match(r'^\s*(name|pageRef|url)\s*=\s*"(.*)"', ln)
        if m and cur is not None:
            if m.group(1) == "name":
                cur["name"] = m.group(2)
            else:
                cur["ref"] = m.group(2)
        w = re.match(r"^\s*weight\s*=\s*(-?\d+)", ln)
        if w and cur is not None:
            cur["weight"] = int(w.group(1))
    return sorted(items, key=lambda x: x["weight"])


def write_menu(lines, items):
    starts = [i for i, ln in enumerate(lines) if re.match(r"^\s*\[\[menus\.main\]\]", ln)]
    block = ["# ------------------------------------------------------------",
             "#  Menu principal (géré par l'éditeur)",
             "# ------------------------------------------------------------"]
    for n, it in enumerate(items, 1):
        ref_key = "url" if re.match(r"^(https?:|mailto:)", it["ref"]) else "pageRef"
        block += ["", "[[menus.main]]", f"  name = {jstr(it['name'])}",
                  f"  {ref_key} = {jstr(it['ref'])}", f"  weight = {n * 10}"]
    block.append("")
    if not starts:
        return lines + [""] + block
    start, end = starts[0], starts[0]
    in_menu = False
    for i in range(start, len(lines)):
        h = HEADER_RE.match(lines[i])
        if h:
            in_menu = h.group(1) == "[[" and h.group(2) == "menus.main"
        if in_menu:
            end = i + 1
    # Retire aussi le commentaire d'en-tête qui précède le menu
    while start > 0 and lines[start - 1].strip().startswith("#"):
        start -= 1
    return lines[:start] + block + lines[end:]


@app.get("/api/settings")
def api_settings_get():
    lines = read_toml_lines()
    def url_of(f: Path) -> str:
        parts = rel_of(f).removesuffix(".md").split("/")
        if parts[-1] in ("index", "_index"):
            parts = parts[:-1]
        return "/" + "/".join(parts)

    pages = sorted({url_of(f) for f in CONTENT.rglob("*.md")})
    return jsonify({
        "values": [
            {"section": s, "key": k, "label": lab, "value": get_setting(lines, s, k)}
            for s, k, lab in SETTINGS
        ],
        "menu": parse_menu(lines),
        "pages": sorted(set(pages) | {"/"}),
    })


@app.put("/api/settings")
def api_settings_put():
    data = request.get_json(force=True)
    lines = read_toml_lines()
    allowed = {(s, k) for s, k, _ in SETTINGS}
    for v in data.get("values", []):
        if (v["section"], v["key"]) in allowed:
            set_setting(lines, v["section"], v["key"], str(v["value"]).strip())
    menu = [m for m in data.get("menu", []) if m.get("name", "").strip() and m.get("ref", "").strip()]
    lines = write_menu(lines, [{"name": m["name"].strip(), "ref": m["ref"].strip()} for m in menu])
    HUGO_TOML.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")
    return jsonify({"ok": True})


@app.get("/api/raw")
def api_raw_get():
    return jsonify({"text": HUGO_TOML.read_text(encoding="utf-8")})


@app.put("/api/raw")
def api_raw_put():
    HUGO_TOML.write_text((request.get_json(force=True).get("text") or "").replace("\r\n", "\n"), encoding="utf-8")
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Git
# ----------------------------------------------------------------------
def run(cmd: list[str], timeout: int = 120):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", LC_ALL="C")
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=env)
    except FileNotFoundError:
        return 127, f"Programme introuvable : {cmd[0]}"
    except subprocess.TimeoutExpired:
        return 124, "Délai dépassé."
    return r.returncode, (r.stdout + r.stderr).strip()


@app.get("/api/git/status")
def git_status():
    code, out = run(["git", "status", "--porcelain=v1", "-b"])
    if code != 0:
        return jsonify({"available": False, "message": out})
    lines = out.split("\n")
    branch = lines[0].removeprefix("## ")
    changes = [{"code": ln[:2].strip() or "?", "file": ln[3:]} for ln in lines[1:] if ln.strip()]
    ahead = re.search(r"ahead (\d+)", branch)
    behind = re.search(r"behind (\d+)", branch)
    return jsonify({
        "available": True, "branch": branch.split("...")[0], "changes": changes,
        "ahead": int(ahead.group(1)) if ahead else 0,
        "behind": int(behind.group(1)) if behind else 0,
    })


@app.get("/api/git/identity")
def git_identity_get():
    _, name = run(["git", "config", "user.name"])
    _, email = run(["git", "config", "user.email"])
    ok = bool(name) and bool(email) and "introuvable" not in name
    return jsonify({"configured": ok, "name": name if ok else "", "email": email if ok else ""})


@app.post("/api/git/identity")
def git_identity_set():
    data = request.get_json(force=True)
    name, email = (data.get("name") or "").strip(), (data.get("email") or "").strip()
    if not name or "@" not in email:
        return err("Nom et adresse e-mail valides requis.")
    run(["git", "config", "user.name", name])
    run(["git", "config", "user.email", email])
    return jsonify({"ok": True})


@app.post("/api/git/pull")
def git_pull():
    code, out = run(["git", "pull", "--rebase", "--autostash"])
    return jsonify({"ok": code == 0, "log": out})


@app.post("/api/git/publish")
def git_publish():
    msg = (request.get_json(force=True).get("message") or "").strip() or "Mise à jour du contenu"
    log = []
    code, out = run(["git", "add", "-A"])
    log.append(out)
    if code != 0:
        return jsonify({"ok": False, "log": "\n".join(log)})
    code, out = run(["git", "commit", "-m", msg])
    log.append(out)
    if code != 0 and "nothing to commit" not in out:
        return jsonify({"ok": False, "log": "\n".join(log)})
    code, out = run(["git", "push"])
    log.append(out)
    if code != 0 and "rejected" in out:
        log.append("\nLe dépôt distant a des changements que vous n'avez pas : cliquez d'abord sur « Récupérer », puis republiez.")
    return jsonify({"ok": code == 0, "log": "\n".join(x for x in log if x)})


# ----------------------------------------------------------------------
# Aperçu du site complet (Hugo)
# ----------------------------------------------------------------------
def find_hugo() -> str | None:
    exe = shutil.which("hugo")
    if exe:
        return exe
    for cand in (ROOT / ".tools" / "hugo" / "hugo", ROOT / ".tools" / "hugo" / "hugo.exe"):
        if cand.exists():
            return str(cand)
    return None


HUGO_VERSION = "0.147.0"  # même version que le workflow GitHub Actions


def hugo_asset_name() -> str:
    import platform
    system, machine = platform.system(), platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    if system == "Windows":
        return f"hugo_extended_{HUGO_VERSION}_windows-amd64.zip"
    if system == "Darwin":
        return f"hugo_extended_{HUGO_VERSION}_darwin-universal.tar.gz"
    return f"hugo_extended_{HUGO_VERSION}_linux-{'arm64' if arm else 'amd64'}.tar.gz"


def install_hugo() -> str:
    """Télécharge Hugo (version officielle) dans .tools/hugo/ (ignoré par Git)."""
    import tarfile
    import tempfile
    import urllib.request
    import zipfile

    asset = hugo_asset_name()
    url = f"https://github.com/gohugoio/hugo/releases/download/v{HUGO_VERSION}/{asset}"
    dest = ROOT / ".tools" / "hugo"
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / asset
        with urllib.request.urlopen(url, timeout=120) as r, open(archive, "wb") as f:
            shutil.copyfileobj(r, f)
        if asset.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extract("hugo.exe", dest)
        else:
            with tarfile.open(archive) as t:
                member = t.getmember("hugo")
                member.name = "hugo"
                t.extract(member, dest)
    exe = dest / ("hugo.exe" if asset.endswith(".zip") else "hugo")
    exe.chmod(0o755)
    return str(exe)


@app.get("/api/hugo/status")
def api_hugo_status():
    exe = find_hugo()
    return jsonify({"installed": bool(exe), "path": exe or ""})


@app.post("/api/build")
def api_build():
    hugo = find_hugo()
    prefix = ""
    if not hugo:
        try:
            hugo = install_hugo()
            prefix = f"Hugo {HUGO_VERSION} téléchargé automatiquement.\n"
        except Exception as e:
            return jsonify({"ok": False, "log": f"Téléchargement de Hugo impossible : {e}\nInstallation manuelle : https://gohugo.io/installation/"})
    if PREVIEW_DIR.exists():
        shutil.rmtree(PREVIEW_DIR)
    code, out = run([hugo, "--buildDrafts", "--buildFuture", "--baseURL", "/site/", "-d", str(PREVIEW_DIR)])
    return jsonify({"ok": code == 0, "log": prefix + out})


@app.get("/site/")
@app.get("/site/<path:p>")
def site_preview(p=""):
    target = (PREVIEW_DIR / p).resolve()
    if PREVIEW_DIR.resolve() not in target.parents and target != PREVIEW_DIR.resolve():
        abort(404)
    if target.is_dir():
        target = target / "index.html"
    if not target.exists():
        abort(404)
    resp = send_from_directory(target.parent, target.name)
    resp.headers["Cache-Control"] = "no-store"
    return resp


def main(port: int = 5173):
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5173)
