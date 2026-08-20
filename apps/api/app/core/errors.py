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


class AuthenticationError(HTTPException):
    """401 for a private `/api/me/*` request whose identity could not be proven.

    Carries `WWW-Authenticate: Bearer` because that is what a 401 is *for*: it
    tells the caller which scheme to retry under. The detail says which check
    failed (missing / malformed / expired / wrong issuer) without ever echoing
    the token or any claim back to the caller.
    """

    def __init__(self, detail: str = "Authentication is required"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class AuthDisabledError(HTTPException):
    """503 for a private endpoint on a deployment that has no identity provider.

    Deliberately NOT a 401: no credential the caller could supply would help, so
    inviting them to authenticate would be a lie. Deliberately not a 404 either,
    because the route genuinely exists in the contract and this is a
    configuration state, not a missing resource. Anonymous ScoutBoy never calls
    these endpoints, so this is only ever reached by a direct API caller.
    """

    def __init__(self, detail: str = "Account features are not enabled on this deployment"):
        super().__init__(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


class ConflictError(HTTPException):
    """409 for an operation another concurrent writer prevented from completing.

    Used by the favourites merge when, after its bounded retry, some valid
    requested player is still not persisted. Returning a 200 whose disposition
    lists quietly omitted those players would be the worse outcome: the client
    clears its device copy on success, so a partial "success" is how a guest list
    gets lost. A 409 keeps the device copy and invites a retry.
    """

    def __init__(self, detail: str = "The request conflicted with a concurrent change"):
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)
