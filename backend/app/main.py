from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
from contextlib import asynccontextmanager

from app.config import settings
from app.routes import wiki, query, ingest
from app.routes import admin as admin_routes
from app.auth import routes as auth_routes
from app.storage import users as user_store
from app.storage import audit
from app.storage import sessions as session_store
from app.storage import wiki_index
from app.auth.password import hash_password
from app import errors


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bootstrap admin account from env vars on first startup
    user_store.bootstrap_admin(settings.admin_username, hash_password(settings.admin_password))
    audit.init()
    session_store.init()
    wiki_index.init()

    # Loud warning if running on insecure defaults
    weak = settings.weak_defaults_in_use()
    if weak:
        import sys
        print("\n" + "=" * 70, file=sys.stderr)
        print("⚠️  SECURITY WARNING — Insecure defaults detected:", file=sys.stderr)
        for k in weak:
            print(f"   - {k} is using its default / empty value", file=sys.stderr)
        print("   Update .env BEFORE exposing this service publicly.", file=sys.stderr)
        print("=" * 70 + "\n", file=sys.stderr)

    yield


app = FastAPI(title="LLM Wiki API", version="1.0.0", lifespan=lifespan)
errors.register(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(wiki.router, prefix="/api")
app.include_router(query.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(auth_routes.router)
app.include_router(admin_routes.router)

# jobs endpoint
from app.storage import jobs as job_store
from fastapi import HTTPException

@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job 不存在")
    return job


@app.get("/api/health")
async def health():
    wiki_dir = settings.wiki_dir
    pages = list(wiki_dir.glob("*.md")) if wiki_dir.exists() else []
    return {
        "status": "ok",
        "wiki_pages": len(pages),
        "wiki_dir": str(wiki_dir),
    }


@app.get("/api/raw/{filename:path}")
async def serve_raw(filename: str):
    path = settings.raw_dir / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="檔案不存在")
    try:
        path.resolve().relative_to(settings.raw_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="存取被拒")
    return FileResponse(path, filename=path.name)
