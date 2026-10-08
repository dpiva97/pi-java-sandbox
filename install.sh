#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  --help|-h)
    printf '%s\n' 'Usage: ./install.sh' 'Install pi-sandbox in ~/.local/bin without changing shell configuration.'
    exit 0
    ;;
  '') ;;
  *) printf 'Unknown option: %s. Use --help.\n' "$1" >&2; exit 1 ;;
esac
(($# == 0)) || { printf '%s\n' 'Usage: ./install.sh' >&2; exit 1; }

script_path=$(readlink -f -- "${BASH_SOURCE[0]}")
launcher="$(dirname -- "$script_path")/pi-sandbox"
bin_dir="${HOME:?HOME must be set}/.local/bin"
target="$bin_dir/pi-sandbox"

[[ -f "$launcher" ]] || { printf 'Launcher not found: %s\n' "$launcher" >&2; exit 1; }

if [[ -e "$target" || -L "$target" ]]; then
  if [[ ! -L "$target" ]] || [[ "$(readlink -f -- "$target")" != "$launcher" ]]; then
    printf '%s already exists and is not this launcher; refusing to overwrite it.\n' "$target" >&2
    exit 1
  fi
else
  mkdir -p -- "$bin_dir"
  ln -s -- "$launcher" "$target"
fi
chmod +x -- "$launcher"
printf 'Installed: %s -> %s\n' "$target" "$launcher"
printf '%s\n' 'Keep this repository in place: the launcher uses its Dockerfile.'

case ":${PATH:-}:" in
  *":$bin_dir:"*) ;;
  *)
    printf '\nAdd this line to ~/.bashrc and run source ~/.bashrc:\n'
    printf 'export PATH=%q:"$PATH"\n' "$bin_dir"
    ;;
esac
printf '\nFrom your project directory, run: pi-sandbox [--docker] [--rebuild]\n'
