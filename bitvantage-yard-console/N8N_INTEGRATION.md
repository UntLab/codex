# BitVantage n8n Integration

## Production site

- `https://bitvantage.online`

The frontend expects the API on the same origin under `/api`.

## Webhook

The backend sends one unified movement event to n8n:

- Base URL: `N8N_WEBHOOK_URL_BASE`
- Endpoint: `N8N_MOVEMENT_ENDPOINT`
- Secret header: `X-BitVantage-Secret`
- Default full URL: `http://localhost:5678/webhook/bitvantage-telegram-group`

```bash
export N8N_WEBHOOK_URL_BASE="https://your-n8n-host/webhook"
export N8N_MOVEMENT_ENDPOINT="bitvantage-telegram-group"
export N8N_WEBHOOK_SECRET="replace-with-long-random-secret"
```

## Event model

- `event_type = "terminal.container.moved"`
- `operation_type = STACK_IN | RESTOW | STACK_OUT`

## Useful API endpoints

- `POST /api/notifications/preview`
- `GET /api/notifications/logs`
- `GET /api/containers/logs`
- `GET /api/yard/snapshot`

## Telegram group workflow

Workflow file:

- [n8n/bitvantage-telegram-group-workflow.json](/Users/ais/GPT/progects/BitVantage%20terminal/n8n/bitvantage-telegram-group-workflow.json)

Setup in n8n:

1. Import the workflow JSON.
2. Create a `Header Auth` credential:
   - Header name: `X-BitVantage-Secret`
   - Header value: the same value as `N8N_WEBHOOK_SECRET` in backend `.env`
3. Create a `Telegram` credential using your existing bot token.
4. In the `Send Telegram Message` node set:
   - `chatId` = your Telegram group chat ID
5. Activate the workflow.

Backend `.env` example:

```bash
N8N_WEBHOOK_URL_BASE="https://your-n8n-host/webhook"
N8N_MOVEMENT_ENDPOINT="bitvantage-telegram-group"
N8N_WEBHOOK_SECRET="replace-with-long-random-secret"
```

The workflow sends one Telegram message per:

- `STACK_IN`
- `RESTOW`
- `STACK_OUT`

Message fields:

- operation type
- container id
- container type
- old position
- new position
- operator
- performed time
