#!/bin/sh
# Run once per backend host after creating/adopting InnoDB Cluster.
# mysqlrouter prompts for credentials; credentials are not stored in this script.
set -eu
: "${CLUSTER_ADMIN_URI:?Set CLUSTER_ADMIN_URI, e.g. icadmin@192.168.1.101:3306 (no password)}"
case "$CLUSTER_ADMIN_URI" in
  *://*|*:*@*) echo 'Use user@host:port without a password.' >&2; exit 1 ;;
esac
exec mysqlrouter --bootstrap "$CLUSTER_ADMIN_URI" --user mysqlrouter \
  --conf-bind-address 127.0.0.1 --conf-base-port 6446
