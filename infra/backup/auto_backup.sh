#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$PROJECT_DIR/server/scripts/backup.js" backup
