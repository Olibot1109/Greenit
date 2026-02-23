# Greenit (Node.js RAM-only game creator)

Greenit is a lightweight Blook-style game creation clone.

## What it does
- Lets you choose a preset blook or manually input any blook name/image URL.
- Creates hostable game entries with game code + host pin.
- Stores all game data **in RAM only** (nothing written to disk).
- Exposes a small JSON API for blooks and games.

## Run
```bash
node server.js
```
Open http://localhost:3000

## API
- `GET /api/blooks` list available starter blooks.
- `GET /api/games` list all live games in memory.
- `GET /api/games/:code` get one game.
- `POST /api/games` create a game.
- `DELETE /api/games/:code` delete a game.

### Create game payload
```json
{
  "title": "Friday Review",
  "mode": "Gold Quest",
  "blook": {
    "name": "Unicorn",
    "imageUrl": "https://ac.blooket.com/dashboard/blooks/unicorn.svg"
  }
}
```
