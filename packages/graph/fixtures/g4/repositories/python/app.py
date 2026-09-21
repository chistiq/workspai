import os
from flask import Flask
from service.health import status

app = Flask(__name__)


@app.get('/health')
def health():
    return status(os.name)
