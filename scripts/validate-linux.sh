#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
results_root="$project_dir/artifacts/linux-validation"
mkdir -p "$results_root"
results_dir="$(mktemp -d "$results_root/run.XXXXXX")"
printf 'Writing Linux validation evidence to: %s\n' "$results_dir"

docker build --tag akb-linux-validation:node24 \
  --file "$project_dir/validation/linux.Dockerfile" "$project_dir" \
  2>&1 | tee "$results_dir/build.log"
docker image inspect akb-linux-validation:node24 > "$results_dir/image.json"
docker run --rm \
  --mount "type=bind,source=$results_dir,target=/results" \
  akb-linux-validation:node24 \
  2>&1 | tee "$results_dir/run.log"
printf 'Linux validation results: %s\n' "$results_dir"
