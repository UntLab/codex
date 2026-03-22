# Карта проектов и репозиториев

## Главная схема

- `codex` — центральный workspace, knowledge base и backup hub.
- Отдельные продуктовые репозитории остаются основным source of truth.
- Папки в `backups/projects/` используются как резервные копии и быстрый локальный контекст, но не как основное место разработки, если пользователь явно не попросил иное.

## Репозитории GitHub

| Репозиторий | Роль | Source of truth | Backup или локальный след в `codex` | Короткая заметка |
| --- | --- | --- | --- | --- |
| `UntLab/codex` | Центральный workspace и backup hub | Да | Текущий репозиторий | Хранит `config`, `docs`, `scripts`, `automations`, `workspace` и backup-копии проектов |
| `UntLab/cardsaas` | Отдельный продуктовый репозиторий | Да | `backups/projects/cardsaas/` | SaaS цифровых визиток на Next.js 16 + Prisma + Supabase + Stripe |
| `UntLab/bitvantage-yard-console` | Отдельный продуктовый репозиторий | Да | `backups/projects/bitvantage-yard-console/` | Yard/terminal console: FastAPI backend, static frontend, n8n/Telegram integration |
| `UntLab/cursor` | Отдельный исторический workspace-репозиторий | Да | Нет прямой копии в `codex` | Хранит старую структуру `projects/`, `shared/`, `backups/` |
| `UntLab/cursor-backups` | Отдельный backup/settings репозиторий | Да | Частично отражён в `config/` и `automations/` по содержанию | Содержит `configs`, `cursor-setup`, `n8n-workflows` |
| `UntLab/UntLab` | Публичный профиль/лаборатория | Да | Нет | Краткая публичная витрина стека и направлений работы |
| `UntLab/documentation` | Отдельный публичный форк документации | Да | Нет | Документация HACS на Docusaurus |

## Backup-проекты внутри `codex`

### `cardsaas`
- Статус: отдельный GitHub-репозиторий + backup в `codex`.
- Назначение: SaaS для цифровых визиток с темами, лидогенерацией, командной работой и биллингом.
- Стек: Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Prisma 7, PostgreSQL/Supabase, NextAuth v5, Stripe, Cloudinary, Resend.
- Ключевые пути: `backups/projects/cardsaas/src/app/`, `backups/projects/cardsaas/src/components/`, `backups/projects/cardsaas/src/lib/`, `backups/projects/cardsaas/prisma/`.
- Важные контуры: карточки, лиды/CRM, шаблоны, команды, Stripe webhooks, OG images, upload API.

### `bitvantage-yard-console`
- Статус: отдельный GitHub-репозиторий + backup в `codex`.
- Назначение: консоль складского/портового двора для операций с контейнерами и уведомлений.
- Стек: FastAPI, Pydantic, requests, psycopg, собственный Supabase client, статический frontend, n8n webhook integration.
- Ключевые пути: `backups/projects/bitvantage-yard-console/backend/`, `backups/projects/bitvantage-yard-console/frontend/`, `backups/projects/bitvantage-yard-console/n8n/`.
- Важные контуры: auth/login, yard snapshot, stack in / restow / stack out, notification preview/logs, Telegram workflow.

### `pharmatech`
- Статус: backup-проект в `codex`, отдельный GitHub-репозиторий пока не подтверждён текущим списком.
- Назначение: веб-приложение аптеки с каталогом, корзиной, AI-чатом и анализом рецептов.
- Стек: Next.js 16, React 19, TypeScript, Tailwind 4, Supabase SSR, Zustand.
- Ключевые пути: `backups/projects/pharmatech/src/app/`, `backups/projects/pharmatech/src/components/home/`, `backups/projects/pharmatech/src/components/chat/`, `backups/projects/pharmatech/src/stores/`.
- Важные контуры: каталог, checkout, account area, `/api/chat`, `/api/products`, `/api/prescriptions`, security sanitization, cart/chat stores.

### `pharmatech-mobile`
- Статус: backup-проект в `codex`, отдельный GitHub-репозиторий пока не подтверждён текущим списком.
- Назначение: Expo/React Native shell над PharmaTech web-приложением.
- Стек: Expo 55, React Native 0.83, WebView, Share API, deep-link utilities.
- Ключевые пути: `backups/projects/pharmatech-mobile/App.js`, `backups/projects/pharmatech-mobile/assets/`, `backups/projects/pharmatech-mobile/eas.json`.
- Важные контуры: WebView на `SITE_URL`, FAB-меню, WhatsApp contact flow, app sharing, Android build via EAS.

### `n8n-prompt-manager`
- Статус: backup-утилита в `codex`.
- Назначение: CLI для чтения и обновления prompt-полей AI-узлов в n8n workflow через API.
- Стек: Python 3 standard library, `urllib`, локальные `.txt/.rtf` prompt-файлы.
- Ключевые пути: `backups/projects/n8n-prompt-manager/n8n_prompts.py`, `backups/projects/n8n-prompt-manager/config.json`, `backups/projects/n8n-prompt-manager/prompts/`.
- Важные контуры: list/show/update/pull/push workflows, поиск AI node types, рекурсивный поиск prompt fields.
- Осторожность: `config.json` завязан на конкретный n8n instance и workflow id.

### `home-assistant-dashboard`
- Статус: backup-проект в `codex`.
- Назначение: YAML и Python-скрипты для панели температур в Home Assistant Lovelace.
- Стек: YAML, Python 3, Home Assistant WebSocket API, `websockets`.
- Ключевые пути: `backups/projects/home-assistant-dashboard/temperature-sensors-panel.yaml`, `backups/projects/home-assistant-dashboard/add_temperature_panel.py`, `backups/projects/home-assistant-dashboard/fix_temperature_panel.py`.
- Важные контуры: авто-добавление temperature view, ручная Lovelace-конфигурация, замена `auto-entities` на стандартную карточечную сетку.
- Осторожность: Python-скрипты завязаны на конкретный Home Assistant URI и локальные креды, запускать только после явной проверки окружения.

## Контекст и настройки внутри `codex`

### `config/`
- `config/codex-skills/` — локальная база skills и системных skill-пакетов.
- `config/cursor-skills/` — набор старых Cursor skills.
- `config/cursor-rules/` — старые Cursor rules и project-context правила.

### `automations/`
- `automations/n8n/` — место для workflow exports, snippets, templates и docs по автоматизациям.

### `workspace/`
- `workspace/inbox/` — быстрые наброски и временные входящие материалы.
- `workspace/drafts/` — черновики.
- `workspace/experiments/` — пробные реализации.
- `workspace/internal-tools/` — внутренние утилиты, которые живут прямо в `codex`.

## Что помнить в первую очередь

- Если пользователь говорит "работаем с `cardsaas`" или "работаем с `bitvantage-yard-console`", по умолчанию лучше идти в их отдельные репозитории.
- Если пользователь просит посмотреть backup, историю, старую версию или быстро свериться с кодом, можно использовать копии в `backups/projects/`.
- Если проекта ещё нет как отдельного репозитория, сначала допустима работа в `workspace/`, затем выделение в отдельный repo.
