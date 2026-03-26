# WhatsApp Bug Triage Bot

A silent WhatsApp group monitoring bot that triages bug reports using AI and stores structured issues in Supabase.

## Disclaimer

This project is an independent open-source tool and is **not affiliated with,
endorsed by, authorized by, or connected to WhatsApp LLC or Meta Platforms, Inc.**
in any way. WhatsApp and Meta are trademarks of their respective owners.

This software uses an unofficial WhatsApp protocol implementation. Use of this
tool may violate [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service).

**By using this software, you accept full responsibility for:**
- Compliance with WhatsApp's Terms of Service in your jurisdiction
- Any consequences including but not limited to account suspension or termination
- Compliance with applicable privacy laws (GDPR, CCPA, etc.) when collecting
  and storing messages from group members

**This tool is intended for:**
- Private, internal use with groups where all members are aware of and consent
  to the bot's presence
- Development and testing workflows with your own testers
- Self-hosted deployments only — not as a hosted service for third parties

The authors and contributors of this project accept no liability for misuse,
account bans, data breaches, or any other consequences arising from use of
this software. Use at your own risk.

---

## How It Works

1. Listens to messages (text + images) in a specified WhatsApp group via [Evolution API](https://github.com/EvolutionAPI/evolution-api)
2. Runs an AI triage pipeline (Hebrew + English) using Claude and Google Cloud Vision OCR
3. Stores structured issues in Supabase (PostgreSQL)
4. Reacts with a single 🤖 emoji to every successfully captured message — no other output

The bot is **passive by design**. It never sends text messages, never replies in threads, and never acknowledges errors in the group.

## Tech Stack

- **WhatsApp**: Evolution API v2 (self-hosted via Docker)
- **Bot Server**: Node.js 20 + Express (TypeScript)
- **AI Triage**: Anthropic Claude (claude-haiku-4-5) with structured output via tool_use
- **OCR**: Google Cloud Vision API (Hebrew text extraction)
- **Database**: Supabase (PostgreSQL) with Realtime
- **Storage**: Supabase Storage (screenshots)
- **Deployment**: Railway

## Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for local development)
- Supabase project
- Anthropic API key
- Google Cloud Vision service account

### 1. Clone and Install

```bash
git clone <repo-url>
cd whatsapp-bug-triage-bot
pnpm install
```

### 2. Environment Variables

```bash
cp apps/bot-server/.env.example apps/bot-server/.env
```

Fill in all values in `.env`. See `.env.example` for documentation.

### 3. Database Setup

Run the migration in your Supabase project:

```bash
# Via Supabase CLI or paste into the SQL Editor
cat supabase/migrations/001_initial_schema.sql
```

Create a storage bucket named `screenshots` in the Supabase dashboard.

### 4. Local Development

Start Evolution API and dependencies:

```bash
docker compose up -d
```

Start the bot server:

```bash
cd apps/bot-server
pnpm dev
```

### 5. Connect WhatsApp

Create an Evolution API instance and scan the QR code (one-time step):

```bash
# Create instance
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "triage-bot",
    "webhook": {
      "url": "http://YOUR_BOT_SERVER:3000/webhook",
      "byEvents": true,
      "events": ["MESSAGES_UPSERT"]
    },
    "webhookByEvents": true
  }'

# Get QR code
curl http://localhost:8080/instance/connect/triage-bot \
  -H "apikey: YOUR_API_KEY"
```

The session persists in PostgreSQL and survives restarts — QR scanning is a one-time step.

## Railway Deployment

The project deploys as two Railway services:

1. **evolution-api** — Docker image `atendai/evolution-api:v2-latest` with PostgreSQL and Redis plugins
2. **bot-server** — This repo, set all `.env` vars in the Railway dashboard

The bot server exposes a `GET /health` endpoint for Railway health checks.

## Jira Integration (Optional)

The bot can automatically create Jira Cloud issues for every triaged message. To enable, set these environment variables:

| Variable | Description |
|---|---|
| `JIRA_HOST` | Your Jira Cloud domain (e.g. `yourteam.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email for API authentication |
| `JIRA_API_TOKEN` | [Jira API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | Project key where issues are created (e.g. `BUG`) |

If any of these are missing, the bot works normally without Jira — no errors.

When enabled, after each triage the bot:
1. Creates a Jira issue with mapped fields (severity → priority, category → label, description in ADF format)
2. Attaches the screenshot (if present) to the Jira issue
3. Stores the Jira issue key (e.g. `BUG-42`) in the `jira_issue_key` column of the `issues` table

**Database migration**: Run `supabase/migrations/002_add_jira_issue_key.sql` to add the `jira_issue_key` column.

## Privacy

All messages processed by the bot are stored in **your own Supabase instance**. No data passes through any third-party service except:

- **Anthropic** — message text is sent to Claude for triage classification
- **Google Cloud Vision** — screenshot images are sent for OCR text extraction

No data is stored by these providers beyond their standard API processing terms.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

Issues and PRs are welcome, but the maintainer makes no guarantees of response time.

## License

MIT License — see [LICENSE](LICENSE) for details.
