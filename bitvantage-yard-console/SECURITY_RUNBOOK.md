# BitVantage Security Runbook

## Network Boundary

Production traffic enters through `proxy-01-cloud` and is forwarded to the app server:

- Public domain: `https://bitvantage.online`
- Reverse proxy: `proxy-01-cloud`
- App server: `apps-01-cloud`
- App upstream: `192.168.40.195:18080`

The app server uses the existing `apps-docker-firewall.service` to protect Docker-published ports through the `DOCKER-USER` chain.

BitVantage direct backend access is restricted:

- Allow `192.168.40.194` to `tcp/18080`.
- Drop other direct LAN traffic to `tcp/18080`.
- Public access remains through Nginx on `proxy-01-cloud`.

Check current rules:

```bash
ssh apps-01-cloud 'sudo iptables -S DOCKER-USER | sed -n "1,80p"'
```

Reapply rules:

```bash
ssh apps-01-cloud 'sudo systemctl restart apps-docker-firewall.service'
```

Validate from the reverse proxy:

```bash
ssh proxy-01-cloud 'curl -i --max-time 8 http://192.168.40.195:18080/healthz'
```

Validate public production:

```bash
curl -i https://bitvantage.online/healthz
```

## Nginx Web Surface

The production Nginx config applies:

- Basic security headers.
- Public FastAPI documentation blocking for `/docs`, `/redoc`, and `/openapi.json`.
- Login rate limiting on `/api/auth/login`.
- Canonical redirect from `www.bitvantage.online` and HTTP to `https://bitvantage.online`.

Managed source copies:

- `ops/nginx/bitvantage.online.conf`
- `ops/nginx/bitvantage-proxy.conf`
- `ops/nginx/bitvantage-rate-limit.conf`

Validate:

```bash
curl -I https://bitvantage.online/
curl -I https://bitvantage.online/docs
curl -I https://bitvantage.online/openapi.json
```

## Rollback

Before changing firewall rules, save:

```bash
ssh apps-01-cloud 'sudo iptables-save > /root/bitvantage-config-backups/iptables-before-change.rules'
```

To restore a saved rule snapshot:

```bash
ssh apps-01-cloud 'sudo iptables-restore < /root/bitvantage-config-backups/iptables-before-change.rules'
```
