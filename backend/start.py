"""
start.py — run this instead of app.py directly.
Loads environment variables from .env before starting Flask.
"""
import os

# Load .env file if it exists
env_file = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())
    print("✓ Loaded .env")
else:
    print("⚠  No .env file found — create one from env_example.txt")

# Now import and run the app
from app import app, sock
import ssl

cert = os.path.join(os.path.dirname(__file__), "localhost+1.pem")
key  = os.path.join(os.path.dirname(__file__), "localhost+1-key.pem")

if os.path.exists(cert) and os.path.exists(key):
    print("🔒 Starting with HTTPS")
    app.run(debug=True, ssl_context=(cert, key), host="127.0.0.1", port=5000)
else:
    print("⚠  No SSL certs — run mkcert localhost 127.0.0.1 first")
    app.run(debug=True, host="127.0.0.1", port=5000)