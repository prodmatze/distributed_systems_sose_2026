# Chorus — developer task runner.
# Run `make` (or `make help`) to list available targets.
#
# Backend = the Docker Compose stack (postgres, redis, migrate, api, auth, nginx gateway).
# Frontend = the Next.js dev server.

COMPOSE  := docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env
FRONTEND := frontend

# ── Host port overrides (local dev) ─────────────────────────────────────
# By default the stack publishes conventional host ports: gateway 8080,
# postgres 5432, redis 6379, observer 8090, jaeger 16686. Run ANY target with
# ALTPORTS=1 to shift every host-published port into a high range, leaving the
# defaults free for another app running on the same machine:
#     make obs-up ALTPORTS=1
#     make dev    ALTPORTS=1 FRONTEND_PORT=3001
# Only the HOST side of each mapping moves — container-internal wiring
# (postgres:5432, gateway:80, service DNS) is unchanged, so nothing inside the
# stack needs reconfiguring, and the frontend is pointed at the shifted gateway
# automatically. Individual ports can also be set, e.g. GATEWAY_PORT=18080.
ifeq ($(ALTPORTS),1)
GATEWAY_PORT  ?= 18080
POSTGRES_PORT ?= 15432
REDIS_PORT    ?= 16379
OBSERVER_PORT ?= 18090
JAEGER_PORT   ?= 18686
endif
GATEWAY_PORT  ?= 8080
POSTGRES_PORT ?= 5432
REDIS_PORT    ?= 6379
OBSERVER_PORT ?= 8090
JAEGER_PORT   ?= 16686
FRONTEND_PORT ?= 3000
# Exported so `docker compose` interpolates them into the ports: mappings.
export GATEWAY_PORT POSTGRES_PORT REDIS_PORT OBSERVER_PORT JAEGER_PORT

.DEFAULT_GOAL := help
.PHONY: help dev demo backend frontend up down stop restart logs ps build rebuild migrate health clean install setup obs-up obs-down obs-logs obs-smoke ports

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: backend frontend ## Start backend (detached) + frontend (foreground)

demo: obs-up frontend ## Everything: backend, observability layer, and the frontend

# The gateway pins users to chat replicas by container name (chorus-chat-1..3
# in infra/nginx/nginx.conf) and refuses to start if any of them is missing,
# so the chat tier must always come up with exactly CHAT_REPLICAS instances.
CHAT_REPLICAS := 3

backend: ## Build & start the backend stack in the background
	$(COMPOSE) up -d --build --scale chat=$(CHAT_REPLICAS)

frontend: ## Start the Next.js dev server (honors FRONTEND_PORT + ALTPORTS)
	cd $(FRONTEND) && NEXT_PUBLIC_API_URL=http://localhost:$(GATEWAY_PORT) PORT=$(FRONTEND_PORT) pnpm dev

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
	@echo "auth: $$(curl -fsS http://localhost:$(GATEWAY_PORT)/auth/health || echo DOWN)"
	@echo "api:  $$(curl -fsS http://localhost:$(GATEWAY_PORT)/api/health  || echo DOWN)"

ports: ## Show the host ports the stack will publish (add ALTPORTS=1 to preview shifted)
	@echo "gateway   $(GATEWAY_PORT)   postgres $(POSTGRES_PORT)   redis $(REDIS_PORT)   observer $(OBSERVER_PORT)   jaeger $(JAEGER_PORT)   frontend $(FRONTEND_PORT)"

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

obs-up: ## Start the stack WITH the observability layer (observer/jaeger; ALTPORTS shifts host ports)
	$(COMPOSE_OBS) up -d --build --scale chat=$(CHAT_REPLICAS)

obs-down: ## Stop the stack including observability services
	$(COMPOSE_OBS) down

obs-logs: ## Follow observer logs
	$(COMPOSE_OBS) logs -f observer

obs-smoke: ## Assert live events arrive on the observer WebSocket
	backend/observer/.venv/bin/python backend/observer/scripts/obs_smoke.py
