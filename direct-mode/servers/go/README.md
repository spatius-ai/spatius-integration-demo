# Direct Mode Token Server (Go)

## Run

```bash
cp .env.example .env
go run .
```

Default: `http://localhost:8090`

## API

- `GET /health`
- `POST /session-token`

## Validation Guardrails

`POST /session-token` returns `500` if:

- `.env` is missing
- `SPATIUS_API_KEY` or `SPATIUS_APP_ID` is missing
- either value still uses placeholder text

## References

- App ID / API Key: https://app.spatius.ai/apps
- Test avatars: https://app.spatius.ai/avatars/library
- Session token guide: https://docs.spatius.ai/api-reference/auth
