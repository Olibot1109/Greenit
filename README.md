# Greenit (Gold Quest style quiz game)

Greenit is a lightweight Node.js host/join trivia app with Blooket-style blooks and a live gold race.

## What changed
- Players join and wait for host start.
- Host start unlocks questions for players.
- Correct answers award random gold and host sees live gold totals.
- Quiz source now uses **Open Trivia DB + fallback local packs** (not Blooket quiz sets).
- Hosts can create custom quizzes in the UI and save/load them from browser `localStorage`.

## Run
```bash
npm start
```
Open http://localhost:3000

## API
- `GET /api/blooks`
- `GET /api/quizzes/search?q=...`
- `POST /api/host` (supports `quizId` or `customQuiz`)
- `GET /api/games/:code/lobby`
- `POST /api/games/:code/join`
- `POST /api/games/:code/start`
- `GET /api/games/:code/player/:playerId`
- `POST /api/games/:code/player/:playerId/answer`
- `DELETE /api/games/:code`

## Notes
Game state is in RAM only. Custom quizzes are remembered in browser localStorage on the host device.
