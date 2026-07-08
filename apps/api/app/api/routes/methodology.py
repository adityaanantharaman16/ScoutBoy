from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import MethodologyResponse
from app.services import methodology_service

router = APIRouter(prefix="/methodology", tags=["methodology"])


@router.get("", response_model=MethodologyResponse)
def methodology():
    return methodology_service.get_methodology()
