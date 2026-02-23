# Greenit (Node.js RAM-only Gold Quest clone)

Greenit now supports a full flow:
- Players join and **wait for host to start**.
- When host starts, players see live questions.
- If player gets question correct, they earn gold.
- Host screen shows each player's gold going up.

## Run
```bash
node server.js
```
Open http://localhost:3000

## Main API
- `POST /api/host` create lobby
- `POST /api/games/:code/join` join player
- `POST /api/games/:code/start` host starts game
- `POST /api/games/:code/next` host moves to next question
- `GET /api/games/:code/lobby` host lobby state + player gold
- `GET /api/games/:code/player/:playerId/state` player waiting/live state + question
- `POST /api/games/:code/player/:playerId/answer` submit answer and earn gold if correct

All data stays in RAM only.
