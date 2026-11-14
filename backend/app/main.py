from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.api import sessions
from app.core.config import get_settings
from app.core.sessions import add_session_cookie
from app.services import interview
from app.services.state_machine import InvalidTransition

app = FastAPI(title="InterAct API", version="0.1.0")
add_session_cookie(app, get_settings())
app.include_router(sessions.router)

ERROR_STATUS = {
    interview.NotFound: status.HTTP_404_NOT_FOUND,
    interview.Conflict: status.HTTP_409_CONFLICT,
    InvalidTransition: status.HTTP_409_CONFLICT,
    interview.InvalidInput: status.HTTP_422_UNPROCESSABLE_CONTENT,
    interview.LLMUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
}


def _error_response(_: Request, error: Exception) -> JSONResponse:
    return JSONResponse(status_code=ERROR_STATUS[type(error)], content={"detail": str(error)})


for error_type in ERROR_STATUS:
    app.add_exception_handler(error_type, _error_response)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
