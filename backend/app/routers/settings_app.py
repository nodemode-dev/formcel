from fastapi import APIRouter
from pydantic import BaseModel

from ..services import appsettings

router = APIRouter()


class AppSettingsIn(BaseModel):
    snapshot_gap: int | None = None
    version_limit: int | None = None
    external_content: bool | None = None


@router.get("/settings/app", summary="Engine-side options: version snapshots, external content, data folder")
def get_app() -> dict:
    return appsettings.public()


@router.put("/settings/app", summary="Change the engine-side options")
def put_app(body: AppSettingsIn) -> dict:
    return appsettings.update(body.model_dump())
