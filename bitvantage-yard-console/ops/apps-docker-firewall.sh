#!/usr/bin/env bash
set -euo pipefail

IPT=/usr/sbin/iptables
COMMENT="apps-01-docker-firewall"

"$IPT" -N DOCKER-USER 2>/dev/null || true

while true; do
  line="$("$IPT" -L DOCKER-USER --line-numbers -n | awk -v comment="$COMMENT" 'index($0, comment) { print $1; exit }')"
  if [[ -z "$line" ]]; then
    break
  fi
  "$IPT" -D DOCKER-USER "$line"
done

"$IPT" -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment "$COMMENT established" -j RETURN

"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 18080 -s 192.168.40.194/32 -m comment --comment "$COMMENT bitvantage-from-proxy" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 18080 -m comment --comment "$COMMENT block-bitvantage-direct" -j DROP

"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 11000 -s 192.168.40.194/32 -m comment --comment "$COMMENT nextcloud-from-proxy" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 11000 -m comment --comment "$COMMENT block-nextcloud-backend" -j DROP

"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 5678 -s 192.168.40.194/32 -m comment --comment "$COMMENT n8n-from-proxy" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 5678 -m comment --comment "$COMMENT block-n8n-direct" -j DROP

"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 3001 -s 192.168.40.194/32 -m comment --comment "$COMMENT uptime-kuma-from-proxy" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 3001 -m comment --comment "$COMMENT block-uptime-kuma-direct" -j DROP

"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 8080 -s 192.168.40.141/32 -m comment --comment "$COMMENT aio-admin-from-mac" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 8080 -s 192.168.40.194/32 -m comment --comment "$COMMENT aio-admin-from-tailscale-router" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 8080 -m comment --comment "$COMMENT block-aio-admin" -j DROP

"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 3478 -s 192.168.40.0/24 -m comment --comment "$COMMENT talk-tcp-lan" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p udp --dport 3478 -s 192.168.40.0/24 -m comment --comment "$COMMENT talk-udp-lan" -j RETURN
"$IPT" -A DOCKER-USER -i eth0 -p tcp --dport 3478 -m comment --comment "$COMMENT block-talk-tcp-nonlan" -j DROP
"$IPT" -A DOCKER-USER -i eth0 -p udp --dport 3478 -m comment --comment "$COMMENT block-talk-udp-nonlan" -j DROP
