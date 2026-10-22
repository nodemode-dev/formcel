from fastapi import APIRouter

from ..services import sysfonts

router = APIRouter(prefix="/api/fonts")


@router.get("")
def list_fonts(refresh: bool = False) -> dict:
    names = sysfonts.families(refresh)
    return {"families": names, "count": len(names)}
