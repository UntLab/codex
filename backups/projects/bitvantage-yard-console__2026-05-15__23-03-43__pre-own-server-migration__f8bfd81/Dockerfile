FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BITVANTAGE_HOST=0.0.0.0 \
    BITVANTAGE_PORT=8000

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install -r /app/backend/requirements.txt

COPY . /app

EXPOSE 8000

CMD ["python", "backend/main.py"]
