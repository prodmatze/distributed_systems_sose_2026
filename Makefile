# Chorus — developer task runner.
# Run `make` (or `make help`) to list available targets.
#
# Backend = the Docker Compose stack (postgres, redis, migrate, api, auth, nginx gateway).
# Frontend = the Next.js dev server.

COMPOSE  := docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env
FRONTEND := frontend

.DEFAULT_GOAL := help
.PHONY: help dev backend frontend up down stop restart logs ps build rebuild migrate health clean install setup obs-up obs-down obs-logs obs-smoke

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: backend frontend ## Start backend (detached) + frontend (foreground)

# The gateway pins users to chat replicas by container name (chorus-chat-1..3
# in infra/nginx/nginx.conf) and refuses to start if any of them is missing,
# so the chat tier must always come up with exactly CHAT_REPLICAS instances.
CHAT_REPLICAS := 3

backend: ## Build & start the backend stack in the background
	$(COMPOSE) up -d --build --scale chat=$(CHAT_REPLICAS)

frontend: ## Start the Next.js dev server (foreground, :3000)
	cd $(FRONTEND) && pnpm dev

up: ## Start the backend stack in the foreground (live logs, Ctrl-C to stop)
	$(COMPOSE) up --build --scale chat=$(CHAT_REPLICAS)

down: ## Stop and remove backend containers
	$(COMPOSE) down

stop: ## Stop backend containers without removing them
	$(COMPOSE) stop

restart: down backend ## Recreate the backend stack

logs: ## Follow backend logs
	$(COMPOSE) logs -f

ps: ## Show backend container status
	$(COMPOSE) ps

build: ## Build backend images without starting them
	$(COMPOSE) build

rebuild: ## Rebuild backend images from scratch (no cache)
	$(COMPOSE) build --no-cache

migrate: ## Run the one-shot DB migration only
	$(COMPOSE) run --rm migrate

health: ## Smoke-test the gateway health endpoints (needs a running backend)
	@echo "auth: $$(curl -fsS http://localhost:8080/auth/health || echo DOWN)"
	@echo "api:  $$(curl -fsS http://localhost:8080/api/health  || echo DOWN)"

clean: ## Stop backend and DELETE all data volumes (postgres + redis data is lost)
	$(COMPOSE) down -v

install: ## Install frontend dependencies (pnpm)
	cd $(FRONTEND) && pnpm install

setup: ## Create infra/compose/.env from the example if it does not exist
	@if [ ! -f infra/compose/.env ]; then \
		cp infra/compose/.env.example infra/compose/.env; \
		echo "Created infra/compose/.env — set JWT_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD before 'make backend'"; \
	else \
		echo "infra/compose/.env already exists — nothing to do"; \
	fi

COMPOSE_OBS := $(COMPOSE) --profile observability

obs-up: ## Start the stack WITH the observability layer (observer :8090, jaeger :16686)
	$(COMPOSE_OBS) up -d --build --scale chat=$(CHAT_REPLICAS)

obs-down: ## Stop the stack including observability services
	$(COMPOSE_OBS) down

obs-logs: ## Follow observer logs
	$(COMPOSE_OBS) logs -f observer

obs-smoke: ## Assert live events arrive on the observer WebSocket
	backend/observer/.venv/bin/python backend/observer/scripts/obs_smoke.py
