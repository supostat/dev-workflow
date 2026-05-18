#!/usr/bin/env bash
# Build the dashboard workspace and embed its static export into the core
# package under dist/dashboard/. Invoked by the root `build` script after tsc.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}/dashboard"

pnpm build

rm -rf "${repo_root}/dist/dashboard"
mkdir -p "${repo_root}/dist"
cp -r out "${repo_root}/dist/dashboard"
