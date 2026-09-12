import os
from service.health import status

@app.get('/health')
def health():
    return status(os.name)
