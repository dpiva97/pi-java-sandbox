# pi-java-sandbox

Disposable Docker-based Pi launcher for WSL Java/Spring Boot development, with JDK 25 and optional Testcontainers access.

## Tech stack
- Bash launcher, installer and container entrypoint; JavaScript ES modules for tests.
- Docker multi-stage image: Eclipse Temurin JDK 25 and Node.js 24 (Debian Bookworm).
- Pi coding agent installed through npm; Docker builds the runtime image.
- This repository is tooling, not a Java/Spring Boot application.

## Package manager + common commands
- No project package manager or `package.json`; npm installs Pi inside the image.
- Install launcher: `./install.sh`.
- Build image: `docker build -t pi-java-sandbox .`.
- Rebuild and launch: `./pi-sandbox --rebuild` (builds with `--pull --no-cache`).
- Test (documented): `node --test tests/*.test.mjs` (Node.js 22+; no npm dependencies).
- Lint: not configured. Documented Bash syntax check: `bash -n install.sh pi-sandbox pi-entrypoint.sh`.

## Repository structure
- `tests/`: contract tests for installation, launcher arguments and entrypoint behavior.
- Root `pi-sandbox`, `install.sh`, `pi-entrypoint.sh`: launcher, symlink installer and package-loading entrypoint.
- Root `Dockerfile`, `pi-packages.txt`: runtime image and configured Pi package sources.
- `README.md`: WSL setup, usage, persistence, security and verification instructions.
- `.idea/`: IDE configuration.

## CI
- None detected; no push/PR jobs configured.

## Conventions
- Bash scripts use `set -euo pipefail`.
- Tests use Node's built-in `node:test` and `node:assert/strict`, named `*.test.mjs`.
- Contract tests use temporary fixtures and process-boundary fakes to avoid real Docker/network operations.
