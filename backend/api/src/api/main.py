from fastapi import FastAPI

app = FastAPI(title="Chorus API")

@app.get('/api/health')
async def health_check():
    dicc = {'ok': True}
    return dicc

@app.get('/api/channels')
async def get_channels():
    channels = ['Channel_1', 'Channel_2', 'Channel_3']
    return {'channels': channels}


# TODO(human): write the healthz endpoint here.
# See the "Learn by Doing" message in the conversation for guidance.
