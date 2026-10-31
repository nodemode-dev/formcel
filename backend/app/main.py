import mimetypes
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import config
from .local_guard import LocalGuard
import asyncio

from .routers import automation, collab, commands, fonts, printpreview, quotes, review, share, spell, tplthumb, workbooks
from .services import scheduler
from .version import VERSION

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")

try:
    import formcel_engine
except ImportError:
    formcel_engine = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.ensure_data_dir()
    task = asyncio.create_task(scheduler.loop())
    yield
    task.cancel()


app = FastAPI(title="FormCel engine", version=VERSION, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
app.add_middleware(LocalGuard, origins=config.window_origins())
app.include_router(tplthumb.router)
app.include_router(workbooks.router)
app.include_router(printpreview.router)
app.include_router(commands.router)
app.include_router(collab.router)
app.include_router(review.router)
app.include_router(share.router)
app.include_router(spell.router)
app.include_router(fonts.router)
app.include_router(automation.router)
app.include_router(automation.v1)
app.include_router(quotes.router)


def engine_info() -> dict:
    if formcel_engine is None:
        return {"loaded": False, "version": None}
    probe = formcel_engine.Workbook()
    probe.set("XFD1048576", "1,234.5")
    return {
        "loaded": True,
        "version": formcel_engine.version(),
        "grid": [formcel_engine.MAX_ROWS, formcel_engine.MAX_COLS],
        "probe": probe.get("XFD1048576"),
    }


@app.get("/api/health")
def health() -> dict:
    eng = engine_info()
    return {"ok": eng["loaded"], "app": "formcel", "version": VERSION, "engine": eng, "data_dir": str(config.DATA_DIR)}


@app.get("/api/version")
def version() -> dict:
    return {"app": "formcel", "version": VERSION}


if config.WINDOW_DIR is not None and config.WINDOW_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=config.WINDOW_DIR, html=True), name="window")
