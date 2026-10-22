from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.quotes import cache, datatypes, ecb, net, service, settings
from ..services.quotes.model import QuoteError

router = APIRouter(prefix="/api", tags=["market data"])


class SettingsIn(BaseModel):
    provider: str | None = None
    fx: str | None = None
    keys: dict[str, str | None] = Field(default_factory=dict)
    bases: dict[str, str | None] = Field(default_factory=dict)
    ttl: dict[str, float] = Field(default_factory=dict)
    rpm: dict[str, int] = Field(default_factory=dict)
    delay: dict[str, int] = Field(default_factory=dict)


@router.get("/settings/quotes")
def get_settings() -> dict:
    return {**settings.public(), "requests": dict(net.counts), "cached": cache.size()}


@router.put("/settings/quotes")
def put_settings(body: SettingsIn) -> dict:
    try:
        return settings.update(body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(422, str(e))


class TestIn(BaseModel):
    provider: str = ""
    symbol: str = "AAPL"


@router.post("/settings/quotes/test")
def test_provider(body: TestIn) -> dict:
    out: dict = {}
    try:
        e = ecb.latest("EUR", "USD", True)
        out["ecb"] = {"ok": True, "note": f"EUR/USD {e['rate']:.4f} on {e['date']}"}
    except QuoteError as err:
        out["ecb"] = {"ok": False, "note": str(err)}
    if body.provider:
        mod = service.PROV.get(body.provider)
        if mod is None:
            raise HTTPException(422, "The provider is stooq, alphavantage or finnhub.")
        try:
            q = mod.quote(body.symbol)
            out["provider"] = {"ok": True, "note": f"{body.symbol.upper()} {q.get('price')}"}
        except QuoteError as err:
            out["provider"] = {"ok": False, "note": str(err)}
    return out


class RefreshIn(BaseModel):
    stocks: str | None = None
    currencies: str | None = None


@router.get("/datatypes/refresh-settings")
def get_refresh(workbook: str) -> dict:
    return settings.refresh_get(workbook)


@router.put("/datatypes/refresh-settings")
def put_refresh(workbook: str, body: RefreshIn) -> dict:
    try:
        return settings.refresh_put(workbook, body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(422, str(e))


class ResolveIn(BaseModel):
    kind: str = "stock"
    texts: list[str] = Field(max_length=500)
    fresh: bool = False


@router.post("/datatypes/resolve")
def resolve(body: ResolveIn) -> dict:
    if body.kind not in ("stock", "currency"):
        raise HTTPException(422, "The data type is stock or currency.")
    out = []
    for t in body.texts:
        try:
            matches = datatypes.resolve(body.kind, t, body.fresh)
            out.append({"text": t, "matches": matches, "note": "" if matches else "No match. Check the spelling or search with a company name or ticker."})
        except QuoteError as e:
            out.append({"text": t, "matches": [], "note": str(e), "failed": True})
    return {"results": out}


class RecordsIn(BaseModel):
    kind: str = "stock"
    entities: list[str] = Field(max_length=500)
    fresh: bool = True


@router.post("/datatypes/records")
def records(body: RecordsIn) -> dict:
    if body.kind not in ("stock", "currency"):
        raise HTTPException(422, "The data type is stock or currency.")
    out = []
    for e in body.entities:
        try:
            out.append({"entity": e, "record": datatypes.record(body.kind, e, body.fresh), "note": ""})
        except QuoteError as err:
            out.append({"entity": e, "record": None, "note": str(err)})
    return {"results": out}
