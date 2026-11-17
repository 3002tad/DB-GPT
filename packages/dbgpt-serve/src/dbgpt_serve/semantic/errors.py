"""Public error boundary for Semantic Center routes."""

import logging
import traceback
from uuid import uuid4

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from dbgpt_serve.core import Result

logger = logging.getLogger(__name__)


class SemanticRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                return await original(request)
            except RequestValidationError:
                raise
            except HTTPException as exc:
                if exc.status_code < 500:
                    raise
                return self._failure(request, exc, exc.status_code)
            except Exception as exc:
                return self._failure(request, exc, 500)

        return handler

    @staticmethod
    def _failure(request, exc, status):
        error_id = uuid4().hex[:12]
        # Stack locations are useful for diagnosis; exception messages, SQL,
        # parameters, URLs and request bodies can contain credentials or data.
        logger.error(
            "semantic_request_failed error_id=%s method=%s error_type=%s stack=%s",
            error_id, request.method, type(exc).__name__,
            "".join(traceback.format_tb(exc.__traceback__)),
        )
        language = request.headers.get("accept-language", "vi").lower()
        if language.startswith("en"):
            message = "Unable to process the semantic request. Contact the administrator with reference"
        elif language.startswith("zh"):
            message = "无法处理语义请求。请联系管理员并提供错误编号"
        else:
            message = "Không thể xử lý yêu cầu ngữ nghĩa. Vui lòng liên hệ quản trị viên với mã"
        result = Result.failed(
            msg=f"{message}: {error_id}", err_code="SEMANTIC_REQUEST_FAILED"
        )
        return JSONResponse(
            status_code=status, content=result.to_dict(),
            headers={"X-Error-ID": error_id, "Cache-Control": "no-store"},
        )
