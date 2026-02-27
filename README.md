# Greenit

Greenit is a lightweight Node.js app that runs a **host + player** trivia flow with live remote quiz categories and custom question editing.

## What's improved
- Players join with code + username, then pick a unique blook while waiting in lobby.
- Host dashboard includes **kick user** controls.
- Host can **end game for all players** instantly.
- Host dashboard shows a **QR code** and direct join link (`/?code=...`) for quick joining.
- Correct answers can trigger chest events (bonus, steal, swap).
- Correct answers now open a 3-chest selection phase with explicit result/next screens.
- Supports live category discovery from multiple quiz providers:
  - Open Trivia DB
  - The Trivia API
  - jService
  - REST Countries (flag/logo-style image quizzes)
- Supports custom questions with variable answer counts and optional per-question images.
- Supports AI quiz generation via Groq (host setup -> Generate Quiz).
- AI generation can optionally attach images (auto/logo/flag style) using Wikimedia lookups.
- Host can preview live-set questions before selecting a set.
- AI-generated sets are one-time: they cannot be saved to local storage and are cleared after lobby creation.

## Run
```bash
npm start
```
Open: http://localhost:3000

Optional env vars:
- `GROQ_API_KEY` (required for AI generation)
- `GROQ_MODEL` (optional, default: `llama-3.1-8b-instant`)
- `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX` (optional; if unset, server uses a no-key Google image scrape mode)

## API
- `GET /api/blooks`
- `GET /api/quiz/search?q=...`
- `GET /api/quiz/set?id=...`
- `POST /api/quiz/generate`
- `POST /api/host`
- `GET /api/games/:code/lobby`
- `POST /api/games/:code/join`
- `POST /api/games/:code/player/:playerId/blook`
- `POST /api/games/:code/start`
- `POST /api/games/:code/end`
- `POST /api/games/:code/kick`
- `GET /api/games/:code/player/:playerId`
- `POST /api/games/:code/player/:playerId/answer`
- `POST /api/games/:code/player/:playerId/chest`
- `DELETE /api/games/:code`
