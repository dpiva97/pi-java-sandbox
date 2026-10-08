# Pi for Spring Boot and Testcontainers

Run [Pi](https://pi.dev/) with **JDK 25** from any project directory in **WSL**.
Each invocation creates a new container and removes it on exit. Pi's config,
login, sessions and Maven cache are shared across runs through named volumes.
Docker access for Testcontainers is **opt-in** with `--docker`.

## Requirements

- WSL with Docker Desktop running Linux containers and WSL integration enabled.
- The `docker` command must work in your WSL shell.
- Git on the WSL host and access to the private GitLab repository, with host Git authentication configured (see below).
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
pi-sandbox --shell            # open Bash instead of pi
pi-sandbox --docker --rebuild  # both options
pi-sandbox --help
```

The first run builds `pi-java-sandbox` automatically if the image is missing.
Subsequent runs reuse it. `--rebuild` uses `docker build --pull --no-cache` to
refresh the base images and pi installation, including after Dockerfile changes.
It does not delete the persistent volumes. It also updates host Git package checkouts with `git pull --ff-only` (or fetches pinned refs). Package installation runs at Pi startup, not during the image build.
Rebuilding and package installation require network access.

Use `--shell` to open an interactive Bash shell in a new container, rather than
starting pi. It uses the same project directory, user and persistent
volumes, so pi configuration changes made there are retained across runs. Run
`pi` or other commands from the shell, then `exit` to remove the container.
The option can be combined with `--docker` and `--rebuild`:

```bash
pi-sandbox --shell --docker
```

Mount additional directories with `--add-dir DIR`, repeating it as needed:

```bash
pi-sandbox --add-dir ../shared-lib --add-dir "$HOME/projects/other app"
pi-sandbox --shell --docker --add-dir ../shared-lib
```

Each directory is mounted **read/write at the same absolute path** in the
container, in addition to the current project. Relative paths are resolved from
the current directory; symlinks are resolved to their real paths. Directories
must already exist and paths must not contain commas. Duplicate directories
(including the current project) are mounted only once. `--add-dir=DIR` is also
supported. Only add directories whose contents you trust Pi to access and modify.

Pass pi arguments after `--` (or Bash arguments when using `--shell`):

```bash
pi-sandbox --docker -- --continue
pi-sandbox --shell -- -c 'java -version'
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

## Packages and skills

Edit **`pi-packages.txt`**: each non-empty line is a package source; lines starting
with `#` are comments. Use npm sources (optionally pinned with `@version`) or Git
URLs (`https://`, `ssh://`, `git://`, `git@...`, or Pi’s `git:host/path` syntax).
Git sources can end in `@tag` or `@commit`.
The list includes the seven currently configured extension packages and the
private repository `https://gitlab.intesys.it/intesys/backend/artificial-intelligence/skills`.
The launcher clones Git sources on the host using its Git credential helper or
SSH configuration. Checkouts are cached under `~/.local/share/pi-sandbox/packages`
and mounted read-only at stable paths inside the container. Set
`PI_SANDBOX_PACKAGES_DIR` to an absolute path without commas to change the cache
location. Files must be readable by the container’s UID 1000. Subsequent launches
reuse checkouts; `--rebuild` updates them without resetting local changes.

The short `pi-entrypoint.sh` installs npm sources and registers mounted Git
checkouts as local Pi packages before starting Pi. Settings and npm packages use
the persistent `pi-agent-home` volume, including existing volumes. The launcher
reads the list on each run, so changes to the list do not require rebuilding.
After this entrypoint/Dockerfile change, run `pi-sandbox --rebuild` once.
Installation is attempted on every Pi launch; packages removed from the list
are not automatically removed from Pi settings. To remove a package, delete its line and run
`pi remove <source>` from `pi-sandbox --shell`; for a mounted Git package,
use its local path shown by `pi list`. If the same repository was previously
installed by URL inside the container, remove that old URL entry once to avoid
loading both versions.

`--shell` bypasses the entrypoint and opens Bash without installing packages.
Private repositories use Git authentication **on the host**. Configure your
credential helper or use an SSH URL; Git may prompt on the host on first clone.
Credentials are not copied into the container. Do not put tokens in the list or
Dockerfile. A Git repository must expose Pi resources through its `package.json`
manifest or conventional `skills/`,
`extensions/`, `prompts/` or `themes/` directories; arbitrary directories at
the repository root are not automatically treated as skills. Pi does not install
dependencies for local packages: repositories containing extensions with runtime
dependencies need those dependencies prepared separately. The mounted checkout
is intended for skills and other resources that do not need that step.

Existing package filters in Pi settings are retained by `pi install`.
With a fresh volume, all default package resources are enabled; use `pi config`
to adjust them. Review packages before installing: extensions execute code with
Pi's permissions. Avoid concurrent launches while packages are being installed.
The old host checkout is left untouched but is no longer used.

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
concurrent edits to the same project or shared configuration. `--rebuild` does not reset persisted configuration or credentials.
Packages listed in `pi-packages.txt` are installed at each Pi startup.

**With `--docker`, pi can control the host's Docker daemon**, including other
containers, volumes and host paths accessible to that daemon. Running as a
non-root user does not restrict those Docker API powers. Only enable this for
trusted projects and when you accept that level of access.

Without `--docker`, pi still has read/write access to the mounted project,
any `--add-dir` directories, credentials and shared Maven cache, and the container
can access the network.
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
bash -n install.sh pi-sandbox pi-entrypoint.sh
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
