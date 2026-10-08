#!/usr/bin/env bash
set -euo pipefail
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
exec pi "$@"
