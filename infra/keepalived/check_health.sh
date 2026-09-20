#!/bin/sh
# One bounded request. HTTP 200 means Router can reach an ONLINE writable primary.
# The total deadline is shorter than Keepalived's script timeout (3 seconds).
set -eu
exec curl --fail --silent --show-error --output /dev/null \
  --noproxy '*' --connect-timeout 1 --max-time 2 \
  http://127.0.0.1:3000/api/ready
