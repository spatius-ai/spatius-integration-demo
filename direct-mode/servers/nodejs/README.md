# Direct Mode Token Server (Node.js)

## Run

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Production:

```bash
pnpm build
pnpm start
```

Default: `http://localhost:8090`

## API

- `GET /health`
- `POST /session-token`
  - body: `{ "appId": "..." }` (optional)

## Validation Guardrails

`POST /session-token` returns `500` if:

- `.env` is missing
- `SPATIUS_API_KEY` or `SPATIUS_APP_ID` is missing
- either value is still placeholder text

## References

- App ID / API Key: https://app.spatius.ai/apps
- Test avatars: https://app.spatius.ai/avatars/library
- Session token guide: https://docs.spatius.ai/api-reference/auth
