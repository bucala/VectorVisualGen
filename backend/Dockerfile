# Použijeme stabilný Python image
FROM python:3.11-slim

# Inštalácia systémových závislostí pre spracovanie SVG a grafiky
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Kopírovanie závislostí
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopírovanie kódu
COPY . .

# Spustenie aplikácie (FastAPI)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
