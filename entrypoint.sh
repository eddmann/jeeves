#!/bin/sh
set -e

# Start Tailscale if TS_AUTHKEY is set
if [ -n "$TS_AUTHKEY" ]; then
  tailscaled --state=/var/lib/tailscale/tailscaled.state --tun=userspace-networking &
  # Wait for tailscaled to be ready
  for i in $(seq 1 30); do
    if tailscale status >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  tailscale up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-jeeves}" --ssh --reset
fi

exec "$@"
