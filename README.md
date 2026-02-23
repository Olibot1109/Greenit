# Greenit (Node.js RAM-only host/join Gold Quest clone)

Greenit is a lightweight Blook-style hosting clone focused on a **Gold Quest** flow.

## What it does
- Host chooses **Host** and pastes a Blooket game URL.
- Host chooses a blook (preset or manual blook name/image URL).
- Greenit creates a lobby with a join code and host PIN.
- Players can join with code + name + blook.
- Host sees players joining live in the lobby view and can press **Start**.
- Data is stored **in RAM only** (nothing written to files).

## Run
```bash
node server.js
```
Open http://localhost:3000

## API
- `GET /api/blooks` list available starter blooks.
- `GET /api/games` list all in-memory games.
- `POST /api/host` create a host lobby (mode is always Gold Quest).
- `GET /api/games/:code/lobby` fetch lobby state.
- `POST /api/games/:code/join` join as a player.
- `POST /api/games/:code/start` start Gold Quest.
- `DELETE /api/games/:code` close/delete lobby.

### Host payload
```json
{
  "blooketUrl": "https://play.blooket.com/play?id=abc123",
  "hostBlook": {
    "name": "Unicorn",
    "imageUrl": "https://ac.blooket.com/dashboard/blooks/unicorn.svg"
  }
}
```

### Join payload
```json
{
  "playerName": "Alex",
  "blook": {
    "name": "Fox",
    "imageUrl": "https://ac.blooket.com/dashboard/blooks/fox.svg"
  }
}
```
