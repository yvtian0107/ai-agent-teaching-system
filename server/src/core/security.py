from typing import Any

import jwt


def decode_jwt_token(token: str, secret: str) -> dict[str, Any]:
    """Decode a Supabase JWT token.

    Supabase user tokens carry ``aud: "authenticated"``; we must tell
    PyJWT to accept that audience, otherwise ``jwt.decode`` raises
    ``InvalidAudienceError`` and auth silently falls back to the
    (slower) Supabase API call.
    """
    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience="authenticated",
    )
