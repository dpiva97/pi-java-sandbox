# Pi for Spring Boot and Testcontainers

Run [Pi](https://pi.dev/) with **JDK 25** from any project directory in **WSL**.
Each invocation creates a new container and removes it on exit. Pi's config,
login, sessions and Maven cache are shared across runs through named volumes.
Docker access for Testcontainers is **opt-in** with `--docker`.

## Requirements

- WSL with Docker Desktop running Linux containers and WSL integration enabled.
- The `docker` command must work in your WSL shell.
- Git in WSL and access to the private skills repository on GitLab (see below).
- A working `mvnw` script in projects that run Maven tests. Maven and the Docker
  CLI are not installed inside the image; Testcontainers uses the Docker API.

The image runs as the non-root `node` user (UID/GID 1000). Your WSL project files
must be writable by that user, normally the first WSL user. If your WSL user has
another UID, arrange project and volume permissions before running; do not use
`chmod 777` as a workaround.

## Install the launcher

From this repository, in WSL:

```bash
./install.sh
```

The installer creates `~/.local/bin/pi-sandbox` as a symlink to this repository.
It can be run again safely and refuses to overwrite a different existing command.
It does not build the image, require sudo or change your shell configuration.
If `~/.local/bin` is not in your PATH, it prints the line to add to `~/.bashrc`;
then reload with `source ~/.bashrc`.

Keep this repository in place: the symlink uses it as the image build context,
regardless of which project you launch from. Alternatively, invoke the launcher
by its absolute path without installing it.

## Run from a project

```bash
cd ~/projects/my-app
pi-sandbox                    # pi + JDK 25, no Docker socket
pi-sandbox --docker           # also allow Testcontainers to use Docker
pi-sandbox --rebuild          # refresh the image, then run
pi-sandbox --docker --rebuild  # both options
pi-sandbox --help
```

The first run builds `pi-java-sandbox` automatically if the image is missing.
Subsequent runs reuse it. `--rebuild` uses `docker build --pull --no-cache` to
refresh the base images and pi installation, including after Dockerfile changes.
It does not delete the persistent volumes. It also updates the shared skills
checkout with `git pull --ff-only`. Rebuilding requires network access.

Pass pi arguments after `--`:

```bash
pi-sandbox --docker -- --continue
```

The project is mounted at **the same absolute path inside and outside** the
container, and pi starts there. This preserves paths for Testcontainers bind
mounts and gives pi the project directory name for the terminal tab title
(e.g. `pi - my-app`, optionally with the session name). Your terminal must allow
applications to update its title; in Windows Terminal, leave
`"suppressApplicationTitle": false` in the profile. A manually renamed tab may
also override the application title. Project paths with spaces work; commas are
not supported by the launcher's Docker `--mount` syntax.

For faster Docker bind mounts, keep the project in WSL (for example,
`~/projects/my-app`) instead of under `/mnt/c`.
In IntelliJ IDEA on Windows, choose **File > Open** and enter
`\\wsl.localhost\Ubuntu\home\<user>\projects\my-app` (adjust the distribution and user).

## Shared skills

The launcher clones `https://gitlab.intesys.it/davide.piva/skills.git` on the
**WSL host** into `~/.local/share/pi-sandbox/skills` on first use. It mounts the
checkout read-only at `/home/node/.agents/skills/intesys`, where Pi recursively
discovers `SKILL.md` files. This works with existing `pi-agent-home` volumes;
no Dockerfile change or volume reset is needed.

Configure GitLab authentication in your host Git credential helper before
launching, or enter your GitLab username and access token when Git prompts.
Credentials are not copied into the image or container. Do not embed tokens
in the repository URL. If you already use an SSH key for GitLab, select SSH:

```bash
export PI_SANDBOX_SKILLS_REPO=git@gitlab.intesys.it:davide.piva/skills.git
pi-sandbox
```

`PI_SANDBOX_SKILLS_REPO` selects the URL for the initial clone only. Set
`PI_SANDBOX_SKILLS_DIR` to an absolute path to use an existing checkout or a
different clone location. The path must not contain commas and its files must
be readable by the container's UID 1000.

Subsequent runs reuse the checkout without contacting GitLab. To update it,
run `pi-sandbox --rebuild`, or `git -C ~/.local/share/pi-sandbox/skills pull --ff-only`.
Clone/update failures stop the launcher with an error; local changes are never
reset. Avoid concurrent first launches or updates of the shared checkout.
Skills appear as `/skill:<name>` commands; review their instructions and scripts
before use, since they can instruct Pi to execute code.

## Login and tests

Inside pi, sign in with `/login openai-codex` or `/login opencode`.
When launched with `--docker`, run your project's tests:

```text
!./mvnw test
!./mvnw verify
```

`--docker` mounts `/var/run/docker.sock`, adds its group to the container's
supplementary groups, and sets
`TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` for Docker Desktop.
If the socket is elsewhere, set its absolute path before launching:

```bash
PI_SANDBOX_DOCKER_SOCKET=/path/to/docker.sock pi-sandbox --docker
```

The launcher targets a local Docker Desktop daemon with WSL integration, not
remote Docker contexts. The Testcontainers host override assumes Docker Desktop.

## Persistence and security

| Volume | Container path | Contents |
|--------|----------------|----------|
| `pi-agent-home` | `/home/node/.pi/agent` | pi config, credentials and sessions |
| `pi-maven-cache` | `/home/node/.m2` | Maven repository and configuration |

These are the same volume names as the previous manual command, so existing
logins and caches are retained. Multiple containers can run at once; avoid
concurrent edits to the same project or shared configuration. `--rebuild` does
not update or reset configuration, extensions or packages persisted in volumes;
the host-side shared skills checkout is updated separately.

**With `--docker`, pi can control the host's Docker daemon**, including other
containers, volumes and host paths accessible to that daemon. Running as a
non-root user does not restrict those Docker API powers. Only enable this for
trusted projects and when you accept that level of access.

Without `--docker`, pi still has read/write access to the mounted project,
credentials and shared Maven cache, and the container can access the network.
This is a disposable development environment, **not a security sandbox for
untrusted code**. Do not share these volumes with untrusted projects.

## Why not Dev Containers?

A Bash launcher with `docker run --rm` directly matches the required lifecycle:
a fresh interactive container on every invocation, with shared named volumes.
Dev Containers is useful for IDE integration and project-specific environments,
but adds tooling and lifecycle management here without improving isolation.
It can be introduced later if IDE integration becomes a requirement.

References: [Docker security](https://docs.docker.com/engine/security/),
[Testcontainers inside Docker](https://java.testcontainers.org/supported_docker_environment/continuous_integration/dind_patterns/).

## Verify changes

The launcher only requires Bash and standard WSL utilities. Contract tests use
Node.js 22+ and its built-in test runner (no npm dependencies or real Docker
operations):

```bash
bash -n install.sh pi-sandbox
node --test tests/*.test.mjs
```

To verify the real image:

```bash
docker build -t pi-java-sandbox .
docker run --rm --entrypoint java pi-java-sandbox -version
docker run --rm pi-java-sandbox --version
```

Then run `pi-sandbox` in a WSL terminal to check the tab title, login persistence
and project access. Run `pi-sandbox --docker` in a Maven project to check its
actual Testcontainers tests.
