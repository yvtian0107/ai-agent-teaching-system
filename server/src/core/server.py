import uvicorn
from src.core.settings import settings


def start():
    """Start the server via uvicorn."""
    uvicorn.run(
        "src.app:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
