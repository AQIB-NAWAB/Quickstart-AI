.PHONY: up down logs ps smoke playground integrity migrate-all voice-migrate identity-migrate workspace-migrate agent-migrate conversation-migrate web-fetch-migrate knowledge-migrate knowledge-smoke memory-migrate secrets-migrate workflow-migrate campaign-migrate lead-migrate eval-migrate data-plane-up data-plane-down data-plane-logs data-plane-smoke sip-config sip-up sip-down sip-logs sip-check

COMPOSE = docker compose

up: data-plane-up
down: data-plane-down
logs: data-plane-logs
smoke: data-plane-smoke

integrity:
	@chmod +x scripts/check-repository-integrity.py
	@python3 scripts/check-repository-integrity.py

knowledge-smoke:
	@chmod +x scripts/smoke-knowledge-data-plane.sh
	@./scripts/smoke-knowledge-data-plane.sh

playground:
	@chmod +x scripts/local-playground.sh
	@./scripts/local-playground.sh

identity-migrate:
	pnpm --filter @quickstart/service-identity build
	pnpm --filter @quickstart/service-identity migrate

workspace-migrate:
	pnpm --filter @quickstart/service-workspace build
	pnpm --filter @quickstart/service-workspace migrate

agent-migrate:
	pnpm --filter @quickstart/service-agent build
	pnpm --filter @quickstart/service-agent migrate

conversation-migrate:
	pnpm --filter @quickstart/service-conversation build
	pnpm --filter @quickstart/service-conversation migrate

web-fetch-migrate:
	pnpm --filter @quickstart/service-web-fetch build
	pnpm --filter @quickstart/service-web-fetch migrate

knowledge-migrate:
	pnpm --filter @quickstart/service-knowledge build
	pnpm --filter @quickstart/service-knowledge migrate

memory-migrate:
	pnpm --filter @quickstart/service-memory build
	pnpm --filter @quickstart/service-memory migrate

secrets-migrate:
	pnpm --filter @quickstart/service-secrets build
	pnpm --filter @quickstart/service-secrets migrate

workflow-migrate:
	pnpm --filter @quickstart/service-workflow build
	pnpm --filter @quickstart/service-workflow migrate

campaign-migrate:
	pnpm --filter @quickstart/service-campaign build
	pnpm --filter @quickstart/service-campaign migrate

lead-migrate:
	pnpm --filter @quickstart/service-lead build
	pnpm --filter @quickstart/service-lead migrate

eval-migrate:
	pnpm --filter @quickstart/service-eval build
	pnpm --filter @quickstart/service-eval migrate

usage-migrate:
	pnpm --filter @quickstart/service-usage build
	pnpm --filter @quickstart/service-usage migrate

audit-migrate:
	pnpm --filter @quickstart/service-audit build
	pnpm --filter @quickstart/service-audit migrate

web-acquisition-migrate: web-fetch-migrate

data-plane-up:
	$(COMPOSE) up -d --wait

data-plane-down:
	$(COMPOSE) down

data-plane-logs:
	$(COMPOSE) logs -f

data-plane-smoke:
	@chmod +x scripts/smoke-data-plane.sh
	@./scripts/smoke-data-plane.sh

ps:
	$(COMPOSE) ps

voice-migrate:
	pnpm --filter @quickstart/service-voice build
	pnpm --filter @quickstart/service-voice migrate

lead-generation-migrate:
	pnpm --filter @quickstart/service-lead-generation build
	pnpm --filter @quickstart/service-lead-generation migrate

migrate-all: identity-migrate workspace-migrate agent-migrate conversation-migrate \
	web-fetch-migrate knowledge-migrate memory-migrate secrets-migrate \
	workflow-migrate campaign-migrate lead-migrate voice-migrate \
	lead-generation-migrate eval-migrate usage-migrate audit-migrate
	@echo "All migrations applied successfully."

sip-config:
	@chmod +x deploy/sip/render-config.sh
	@deploy/sip/render-config.sh

sip-up: sip-config
	$(COMPOSE) -f deploy/sip/docker-compose.yml up -d --wait

sip-down:
	$(COMPOSE) -f deploy/sip/docker-compose.yml down

sip-logs:
	$(COMPOSE) -f deploy/sip/docker-compose.yml logs -f

sip-check:
	@node scripts/check-sip-stack.mjs $${SIP_HOST:-127.0.0.1}
