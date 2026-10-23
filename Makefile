# Gemini - shortcuts for scripts/runner.py (Git Bash / WSL / macOS / Linux).
ifeq ($(OS),Windows_NT)
    PYTHON ?= python
else
    PYTHON ?= python3
endif
RUN = $(PYTHON) scripts/runner.py

.PHONY: help install demo start stop restart status logs build serve test clean

help:
	@echo "make install   Install Python + npm packages and migrate the database"
	@echo "make demo      Create the demo business (demo / demo1234)"
	@echo "make start     Start development servers (http://localhost:3100)"
	@echo "make stop      Stop development servers"
	@echo "make status    Show server status"
	@echo "make logs      Show recent server logs"
	@echo "make build     Build the production web app"
	@echo "make serve     Run the production server (http://localhost:8100)"
	@echo "make test      Run all tests"
	@echo "make clean     Remove logs, pid files and caches"

install:
	$(RUN) install
demo:
	$(RUN) demo
start:
	$(RUN) start
stop:
	$(RUN) stop
restart:
	$(RUN) restart
status:
	$(RUN) status
logs:
	$(RUN) logs
build:
	$(RUN) build
serve:
	$(RUN) serve
test:
	$(RUN) test
clean:
	$(RUN) clean
