# /// script
# requires-python = ">=3.11"
# dependencies = ["fastapi", "uvicorn", "jinja2"]
# ///
"""Jeeves Pages — dynamic page module server."""
import importlib.util
import inspect
import traceback
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE = Path(__file__).parent.parent
TEMPLATES = BASE / "templates"
STATIC = BASE / "static"
PAGES_DIR = BASE / "pages"

app = FastAPI(title="Jeeves")
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES))


def _slug_title(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").title()


def _load_module(name: str, path: Path):
    """Load a Python module from a file path. Returns the module."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _read_meta(slug: str, mod) -> dict:
    return {
        "slug": slug,
        "title": getattr(mod, "TITLE", _slug_title(slug)),
        "icon": getattr(mod, "ICON", "📄"),
        "pinned": bool(getattr(mod, "PINNED", False)),
        "position": int(getattr(mod, "POSITION", 99)),
    }


def _error_meta(slug: str) -> dict:
    return {
        "slug": slug,
        "title": _slug_title(slug),
        "icon": "📄",
        "pinned": False,
        "position": 99,
    }


def discover_pages() -> list[dict]:
    """Scan pages/ for top-level .py files and directories with __init__.py."""
    if not PAGES_DIR.is_dir():
        return []
    pages = []
    # Flat files: pages/foo.py
    for path in sorted(PAGES_DIR.glob("*.py")):
        if path.name.startswith("_"):
            continue
        slug = path.stem
        try:
            mod = _load_module(f"pages.{slug}", path)
            pages.append(_read_meta(slug, mod))
        except Exception:
            pages.append(_error_meta(slug))
    # Directories: pages/foo/__init__.py
    for entry in sorted(PAGES_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        init = entry / "__init__.py"
        if not init.is_file():
            continue
        slug = entry.name
        # Skip if a flat file already claimed this slug
        if any(p["slug"] == slug for p in pages):
            continue
        try:
            mod = _load_module(f"pages.{slug}", init)
            pages.append(_read_meta(slug, mod))
        except Exception:
            pages.append(_error_meta(slug))
    pages.sort(key=lambda p: (p["position"], p["title"]))
    return pages


def resolve_module(slug: str, subpath: str = ""):
    """Resolve a request path to a page module.

    Lookup order:
    1. pages/slug/subpath.py  (exact sub-page file)
    2. pages/slug/__init__.py (directory index, subpath passed to render)
    3. pages/slug.py          (flat file, only when no subpath)

    Returns (module, remaining_path) or (None, None).
    """
    pkg_dir = PAGES_DIR / slug
    if pkg_dir.is_dir():
        # Try exact sub-page file first
        if subpath:
            sub_file = pkg_dir / f"{subpath}.py"
            if sub_file.is_file() and not subpath.startswith("_"):
                return _load_module(f"pages.{slug}.{subpath}", sub_file), ""
        # Fall back to __init__.py
        init = pkg_dir / "__init__.py"
        if init.is_file():
            return _load_module(f"pages.{slug}", init), subpath
    # Flat file (only without subpath)
    if not subpath:
        flat = PAGES_DIR / f"{slug}.py"
        if flat.is_file() and not slug.startswith("_"):
            return _load_module(f"pages.{slug}", flat), ""
    return None, None


async def _render_page(request: Request, slug: str, subpath: str = ""):
    all_pages = discover_pages()
    nav_pages = [p for p in all_pages if p["pinned"]]
    page_meta = next((p for p in all_pages if p["slug"] == slug), None)

    try:
        mod, remaining = resolve_module(slug, subpath)
        if mod is None:
            return HTMLResponse("Not found", status_code=404)

        render = getattr(mod, "render", None)
        if render is None:
            return HTMLResponse("Page has no render() function", status_code=500)

        if inspect.iscoroutinefunction(render):
            content = await render(request)
        else:
            content = render(request)

        title = getattr(mod, "TITLE", _slug_title(slug))

        return templates.TemplateResponse("base.html", {
            "request": request,
            "title": title,
            "active": slug,
            "nav_pages": nav_pages,
            "content": content,
        })
    except Exception:
        tb = traceback.format_exc()
        title = page_meta["title"] if page_meta else slug
        return templates.TemplateResponse("error.html", {
            "request": request,
            "title": f"Error: {title}",
            "active": slug,
            "nav_pages": nav_pages,
            "traceback": tb,
            "page_title": title,
        }, status_code=500)


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    pages = discover_pages()
    nav_pages = [p for p in pages if p["pinned"]]
    return templates.TemplateResponse("home.html", {
        "request": request, "title": "Jeeves", "active": "/",
        "nav_pages": nav_pages, "pages": pages,
    })


@app.get("/{slug}", response_class=HTMLResponse)
async def page_root(request: Request, slug: str):
    return await _render_page(request, slug)


@app.get("/{slug}/{subpath:path}", response_class=HTMLResponse)
async def page_sub(request: Request, slug: str, subpath: str):
    return await _render_page(request, slug, subpath)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
