from app import app, sock
import ssl
import os

cert = os.path.join(os.path.dirname(__file__), "localhost+1.pem")
key  = os.path.join(os.path.dirname(__file__), "localhost+1-key.pem")

# Production (Railway) — no local certs, bind to 0.0.0.0
if os.environ.get("RAILWAY_ENVIRONMENT") or not (os.path.exists(cert) and os.path.exists(key)):
    print("🚀 Starting in production mode")
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)
else:
    print("🔒 Starting with HTTPS (local dev)")
    app.run(debug=True, ssl_context=(cert, key), host="127.0.0.1", port=5000)
