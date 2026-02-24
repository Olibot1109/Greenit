# Greenit (Blooket-style Gold Quest clone)

Greenit is a lightweight Node.js app that runs a **host + player** trivia flow inspired by Blooket.

## What's improved
- Players can join a lobby and **wait for the host to start**.
- Once host starts, players immediately see question cards.
- Correct answers grant random gold; host lobby shows each player's **gold climbing live**.
- Better game-like UI styling for host/player views.
- Added **set search** endpoint/UI (`/api/blooket/search`) with remote Blooket-compatible lookup + local fallback sets.

## Run
```bash
npm start
```
Open: http://localhost:3000

## API
- `GET /api/blooks`
- `GET /api/blooket/search?q=...`
- `POST /api/host`
- `GET /api/games/:code/lobby`
- `POST /api/games/:code/join`
- `POST /api/games/:code/start`
- `GET /api/games/:code/player/:playerId`
- `POST /api/games/:code/player/:playerId/answer`
- `DELETE /api/games/:code`

## Notes
This project is still RAM-only (no persistence). If remote set search is unavailable, Greenit automatically uses bundled fallback sets.
