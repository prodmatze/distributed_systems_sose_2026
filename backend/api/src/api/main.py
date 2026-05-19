from fastapi import FastAPI
from api.schemas import RegisterRequest, TokenResponse, LoginRequest, UserResponse

app = FastAPI(title="Chorus API")

@app.get('/api/health')
async def health_check():
    dicc = {'ok': True}
    return dicc

@app.get('/api/channels')
async def get_channels():
    channels = ['Channel_1', 'Channel_2', 'Channel_3']
    return {'channels': channels}

@app.post('/api/auth/register')
def register_user(payload: RegisterRequest) -> TokenResponse:
    response = UserResponse()
    return response
