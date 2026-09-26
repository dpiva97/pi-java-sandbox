# Pi for Spring Boot and Testcontainers

This image runs [Pi](https://pi.dev/) with JDK 25. It is mainly for working on
Spring Boot projects that use the Maven Wrapper and running their Testcontainers
tests. Maven and the Docker CLI do not need to be installed in the image.

You need Docker Desktop running Linux containers, with WSL integration enabled
if you use WSL. Your project needs a working `mvnw` script.

## Build the image

From this repository:

```bash
docker build -t pi-java-sandbox .
```

## Run Pi from WSL

Open a WSL shell in your project directory:

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -v pi-agent-home:/home/node/.pi/agent \
  -v pi-maven-cache:/home/node/.m2 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  pi-java-sandbox
```

For faster Docker bind mounts, keep the project in WSL (for example,
`~/projects/my-app`) instead of under `/mnt/c`.
In IntelliJ IDEA on Windows, choose **File > Open** and enter
`\\wsl.localhost\Ubuntu\home\<user>\projects\my-app` (adjust the distribution and user).

## Run Pi from PowerShell

Open PowerShell in your project directory. This command uses WSL to read the
Docker socket's group ID:

```powershell
$socketGid = (wsl stat -c %g /var/run/docker.sock).Trim()
docker run --rm -it `
  -v "${PWD}:/workspace" `
  -v pi-agent-home:/home/node/.pi/agent `
  -v pi-maven-cache:/home/node/.m2 `
  -v /var/run/docker.sock:/var/run/docker.sock `
  --group-add $socketGid `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  pi-java-sandbox
```

Inside Pi, sign in with `/login openai-codex` or `/login opencode`, then run
your project's tests:

```text
!./mvnw test
!./mvnw verify
```

The named volumes keep Pi's login and the Maven cache between runs. The Docker
socket lets Testcontainers start sibling containers. Pi runs as the non-root
`node` user, so `--group-add` gives it access to the socket's group. Socket
access also gives Pi control over the host's Docker daemon; use this setup with
projects you trust.

If a test bind-mounts project files into a Testcontainers container, the path
must match on both sides of the Docker socket. From WSL, replace
`-v "$PWD:/workspace"` with `-v "$PWD:$PWD"` and add `-w "$PWD"` to `docker run`.
