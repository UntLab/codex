## Supabase Deploy

1. Create a Supabase project.
2. Run [setup_supabase.sql](/Users/ais/GPT/progects/BitVantage%20terminal/setup_supabase.sql) in the Supabase SQL editor.
3. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `BITVANTAGE_DEMO_MODE=false`
   - `N8N_WEBHOOK_URL_BASE`
   - `N8N_MOVEMENT_ENDPOINT`
   - `N8N_WEBHOOK_SECRET`
4. Install dependencies:
   `python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt`
5. Create the first admin:
   `python backend/scripts/create_admin.py --username admin --password 'CHANGE_ME' --full-name 'BitVantage Admin'`
6. Start the application:
   `source .venv/bin/activate && python backend/main.py`

## Production behavior

- Backend serves API under `/api`
- Backend also serves the frontend static app from the same origin
- Default bind: `0.0.0.0:8000`

This means that on hosting you only need one web process.

## Docker option

Build and run:

```bash
docker build -t bitvantage-yard-console .
docker run --env-file .env -p 8000:8000 bitvantage-yard-console
```

## Smoke check after deploy

1. Open `/healthz`
2. Open the site root `/`
3. Log in as admin
4. Check:
   - `Stack In`
   - `Restow`
   - `Stack Out`
   - Telegram notification
   - `GET /api/containers/logs`

Notes:
- `BITVANTAGE_DEMO_MODE=false` disables demo seeding.
- The backend uses `DATABASE_URL` when it is set.
