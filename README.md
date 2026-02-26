# Greenit (Blooket-style Gold Quest clone)

Greenit is a lightweight Node.js app that runs a **host + player** trivia flow inspired by Blooket.

## What's improved
- Host setup no longer requires picking a host character.
- Players pick characters and those characters now show in the host leaderboard.
- Host dashboard includes **kick user** controls.
- Host can **end game for all players** instantly.
- Host dashboard shows a **QR code** and direct join link (`/?code=...`) for quick joining.
- Correct answers can trigger chest events (bonus, steal, swap).
- Supports multiple remote quiz providers:
  - Open Trivia DB
  - The Trivia API
  - jService random clues

## Run
```bash
npm start
```
Open: http://localhost:3000

## API
- `GET /api/blooks`
- `GET /api/quiz/search?q=...`
- `POST /api/host`
- `GET /api/games/:code/lobby`
- `POST /api/games/:code/join`
- `POST /api/games/:code/start`
- `POST /api/games/:code/end`
- `POST /api/games/:code/kick`
- `GET /api/games/:code/player/:playerId`
- `POST /api/games/:code/player/:playerId/answer`
- `DELETE /api/games/:code`
