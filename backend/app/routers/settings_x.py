from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import extmarket, ossched

router = APIRouter()


class ScheduleIn(BaseModel):
    enabled: bool
    minutes: int = Field(default=15, ge=1, le=1440)
    activate: bool = True


@router.get("/settings/schedule", summary="State of the operating system refresh schedule")
def get_schedule() -> dict:
    return ossched.status()


@router.put("/settings/schedule", summary="Turn the operating system refresh schedule on or off")
def put_schedule(body: ScheduleIn) -> dict:
    try:
        if body.enabled:
            return {**ossched.enable(body.minutes, body.activate), **{"status": ossched.status()}}
        return {**ossched.disable(body.activate), "status": ossched.status()}
    except (ValueError, OSError) as e:
        raise HTTPException(422, f"The schedule could not be changed: {e}")


class RegistryIn(BaseModel):
    url: str = Field(default="", max_length=2000)
    key: str = Field(default="", max_length=200)
    require_signature: bool = False


@router.get("/settings/registry", summary="Extension registry settings")
def get_registry() -> dict:
    s = extmarket.settings()
    return {**s, "fingerprint": extmarket.fingerprint(s["key"]) if s["key"] else ""}


@router.put("/settings/registry", summary="Set the extension registry address and pinned publisher key")
def put_registry(body: RegistryIn) -> dict:
    try:
        s = extmarket.save(body.url, body.key, body.require_signature)
    except extmarket.MarketError as e:
        raise HTTPException(422, str(e))
    return {**s, "fingerprint": extmarket.fingerprint(s["key"]) if s["key"] else ""}


@router.get("/extensions/catalog", summary="Browse the extension registry")
def catalog(q: str = "", category: str = "") -> dict:
    try:
        return extmarket.catalog(q, category)
    except extmarket.MarketError as e:
        raise HTTPException(422, str(e))


class MarketInstallIn(BaseModel):
    id: str = Field(min_length=1, max_length=200)


@router.post("/extensions/market/install", status_code=201, summary="Install or update an extension from the registry")
def market_install(body: MarketInstallIn) -> dict:
    try:
        return extmarket.install(body.id)
    except extmarket.MarketError as e:
        raise HTTPException(422, str(e))
