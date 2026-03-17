FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    libxcb1 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD gunicorn app:app --bind 0.0.0.0:$PORT
```

**Step 5** — Save the file (Ctrl+S)

**Step 6** — Open your terminal in the backend folder and run:
```
git add .
git commit -m "fix: add Dockerfile with system dependencies"
git push