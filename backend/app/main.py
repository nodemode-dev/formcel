from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import config
from .routers import collab, commands, workbooks
from .version import VERSION

try:
    import formcel_engine
except ImportError:
    formcel_engine = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.ensure_data_dir()
    yield


app = FastAPI(title="FormCel engine", version=VERSION, lifespan=lifespan)
app.include_router(workbooks.router)
app.include_router(commands.router)
app.include_router(collab.router)


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
