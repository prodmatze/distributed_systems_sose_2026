FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY shared/pyproject.toml /app/shared/
COPY shared/src /app/shared/src
RUN pip install /app/shared

COPY chat/pyproject.toml /app/chat/
COPY chat/src /app/chat/src
RUN pip install /app/chat

EXPOSE 8000

CMD ["uvicorn", "chat.main:app", "--host", "0.0.0.0", "--port", "8000"]
