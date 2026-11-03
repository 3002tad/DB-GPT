import logging
import os
from typing import Optional

from fastapi import Header, HTTPException, Request

from dbgpt._private.pydantic import BaseModel

logger = logging.getLogger(__name__)


class UserRequest(BaseModel):
    user_id: Optional[str] = None
    user_no: Optional[str] = None
    real_name: Optional[str] = None
    # same with user_id
    user_name: Optional[str] = None
    user_channel: Optional[str] = None
    role: Optional[str] = "normal"
    nick_name: Optional[str] = None
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    nick_name_like: Optional[str] = None


def get_user_from_headers(request: Request, user_id: Optional[str] = Header(None)):
    try:
        actor = getattr(request.state, "pipeline_actor", None)
        if actor is not None:
            return UserRequest(
                user_id=actor.id,
                role="admin" if actor.role == "super_admin" else "analyst",
                nick_name=actor.id,
                real_name=actor.id,
            )
        if os.getenv("DBGPT_PIPELINE_IDENTITY_URL", "").strip():
            raise HTTPException(status_code=401, detail="Authenticated user required")
        # Mock User Info
        if user_id:
            return UserRequest(
                user_id=user_id, role="admin", nick_name=user_id, real_name=user_id
            )
        else:
            return UserRequest(
                user_id="001", role="admin", nick_name="dbgpt", real_name="dbgpt"
            )
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("Authentication failed!")
        raise Exception(f"Authentication failed. {str(e)}")
