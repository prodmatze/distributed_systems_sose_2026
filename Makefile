# Chorus — developer task runner.
# Run `make` (or `make help`) to list available targets.
#
# Backend = the Docker Compose stack (postgres, redis, migrate, api, auth, nginx gateway).
# Frontend = the Next.js dev server.

COMPOSE  := docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env
FRONTEND := frontend

.DEFAULT_GOAL := help
.PHONY: help dev backend frontend up down stop restart logs ps build rebuild migrate health clean install setup

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: backend frontend ## Start backend (detached) + frontend (foreground)

backend: ## Build & start the backend stack in the background
	$(COMPOSE) up -d --build

frontend: ## Start the Next.js dev server (foreground, :3000)
	cd $(FRONTEND) && pnpm dev

up: ## Start the backend stack in the foreground (live logs, Ctrl-C to stop)
	$(COMPOSE) up --build

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
