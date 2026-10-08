#!/usr/bin/env bash
set -euo pipefail

# The agent directory lives in a persistent volume, unlike the container.
agent_dir=${PI_CODING_AGENT_DIR:-${HOME:?HOME must be set}/.pi/agent}
installed_marker="$agent_dir/.pi-sandbox-packages-installed"
if [[ "${PI_SANDBOX_REBUILD:-false}" = true || ! -f "$installed_marker" ]]; then
  mkdir -p -- "$agent_dir"
  # A failed refresh must be retried on the next launch, too.
  rm -f -- "$installed_marker"
  if [[ ${PI_SANDBOX_PACKAGES+x} ]]; then
    exec 3<<< "$PI_SANDBOX_PACKAGES"
  else
    exec 3< /opt/pi-packages.txt
  fi
  while IFS= read -r source <&3 || [ -n "$source" ]; do
    [[ -z "$source" || "$source" = \#* ]] && continue
    pi install "$source"
  done
  exec 3<&-
  touch -- "$installed_marker"
fi
exec pi "$@"
