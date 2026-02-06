.PHONY: *
.DEFAULT_GOAL := help

SHELL := /bin/bash

##@ Setup

start: deps dev ## Install deps and run dev server

deps: ## Install dependencies
	bun install

##@ Development

dev: ## Run src/index.ts directly
	bun run dev

build: ## Bundle to dist/
	bun run build

run: ## Run production bundle
	bun start

##@ Auth

login: ## OAuth PKCE login
	bun dev login

login/key: ## API key login
	bun dev login --api-key

logout: ## Remove credentials
	bun dev logout

status: ## Show auth status
	bun dev status

##@ Testing

test: ## Run all tests
	bun test tests/

test/watch: ## Run tests in watch mode
	bun test tests/ --watch

t: test ## Alias for test

##@ Code Quality

lint: ## Run ESLint
	bun run lint

lint/fix: ## Auto-fix ESLint issues
	bun run lint:fix

fmt: ## Format all code
	bun run format

fmt/check: ## Check formatting
	bun run format:check

##@ CI

can-release: lint test ## CI gate - all checks

##@ Utilities

clean: ## Clean build artifacts
	rm -rf node_modules dist

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } /^[a-zA-Z_\/-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
