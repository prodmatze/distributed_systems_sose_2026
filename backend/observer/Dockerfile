FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY observer/pyproject.toml /app/observer/
COPY observer/src /app/observer/src
RUN pip install /app/observer

EXPOSE 8000

CMD ["uvicorn", "observer.main:app", "--host", "0.0.0.0", "--port", "8000"]
