import hmac
import os
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

# GROBID runs as a sidecar in the same Cloud Run instance, so it is reachable on localhost.
GROBID_URL = os.getenv("GROBID_URL", "http://localhost:8070").rstrip("/")
MAX_BYTES = 50 * 1024 * 1024

# The key is shared with the LitGraph server; fail at startup rather than run unauthenticated.
API_KEY = os.environ.get("EXTRACTION_API_KEY", "").strip()
if not API_KEY:
    raise RuntimeError("EXTRACTION_API_KEY must be set")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=httpx.Timeout(50, connect=5)) as client:
        app.state.client = client
        yield


app = FastAPI(title="GROBID extraction API", lifespan=lifespan)


@app.middleware("http")
async def authenticate(request, call_next):
    if request.url.path == "/extract" and not hmac.compare_digest(
        request.headers.get("x-api-key", "").encode(), API_KEY.encode()
    ):
        return JSONResponse(status_code=401, content={"detail": "Invalid X-API-Key"})
    return await call_next(request)


@app.get("/health")
async def health():
    try:
        result = await app.state.client.get(f"{GROBID_URL}/api/isalive", timeout=5)
    except httpx.RequestError:
        raise HTTPException(503, "GROBID is unavailable")
    if result.status_code != 200 or result.text.strip().lower() != "true":
        raise HTTPException(503, "GROBID is not ready")
    return {"status": "ok", "grobid": "ready"}


@app.post("/extract", response_class=Response,
          responses={200: {"content": {"application/xml": {}}}})
async def extract(file: UploadFile = File(...),
                  mode: Literal["fulltext", "header", "references"] = "fulltext",
                  segment_sentences: bool = False):
    try:
        content = await file.read(MAX_BYTES + 1)
    finally:
        await file.close()
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "PDF exceeds the 50 MiB limit")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(415, "Upload a PDF file")
    endpoint = {"fulltext": "processFulltextDocument", "header": "processHeaderDocument",
                "references": "processReferences"}[mode]
    data = {"consolidateHeader": "0", "consolidateCitations": "0",
            "consolidateFunders": "0", "includeRawCitations": "1"}
    if mode == "fulltext":
        data["segmentSentences"] = str(int(segment_sentences))
    try:
        result = await app.state.client.post(
            f"{GROBID_URL}/api/{endpoint}", data=data,
            files={"input": (file.filename or "document.pdf", content, "application/pdf")},
            headers={"Accept": "application/xml"})
    except httpx.TimeoutException:
        raise HTTPException(504, "GROBID processing timed out")
    except httpx.RequestError:
        raise HTTPException(503, "GROBID is unavailable")
    if result.status_code == 204:
        return Response(status_code=204)
    if result.status_code != 200:
        status = 503 if result.status_code == 503 else 502
        raise HTTPException(status, f"GROBID returned HTTP {result.status_code}")
    return Response(content=result.content, media_type="application/xml")
