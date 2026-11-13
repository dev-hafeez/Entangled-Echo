FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY services/ml/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/ml ./services/ml
COPY storage/models.json ./storage/models.json

ENV PORT=8001
EXPOSE 8001

HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8001/health || exit 1

CMD ["python", "-m", "uvicorn", "services.ml.main:app", "--host", "0.0.0.0", "--port", "8001"]
