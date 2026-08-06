from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status


class QueryValidationError(HTTPException):
    """422 in FastAPI's own validation-error body shape.

    Some query values can only be checked against the domain or against config
    (accepted sort modes, configured role keys, position groups, a coherent price
    range). Declaring those statically on a route would either duplicate the domain
    or move business logic into the handler, so services raise this instead. The
    body is deliberately indistinguishable from a natively declared 422, so a
    caller parses one shape for every rejected query value.
    """

    def __init__(self, field: str, value: Any, message: str):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[
                {
                    "type": "value_error",
                    "loc": ["query", field],
                    "msg": message,
                    "input": value,
                }
            ],
        )


class NotFoundError(HTTPException):
    def __init__(self, detail: str = "Resource not found"):
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class BadRequestError(HTTPException):
    def __init__(self, detail: str = "Bad request"):
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


class UnauthorizedError(HTTPException):
    def __init__(self, detail: str = "Admin token required"):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
