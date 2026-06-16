from fastapi import FastAPI

from api.routers import channels, users

app = FastAPI(title="Chorus API")

app.include_router(channels.router)
app.include_router(users.router)


@app.get("/api/health")
async def health_check():
    return {"ok": True}
