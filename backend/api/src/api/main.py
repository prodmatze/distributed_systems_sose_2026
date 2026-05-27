from fastapi import FastAPI

app = FastAPI(title="Chorus API")


@app.get("/api/health")
async def health_check():
    return {"ok": True}


@app.get("/api/channels")
async def get_channels():
    return ["Channel_1", "Channel_2", "Channel_3"]
