# Grid Clash: Multiplayer Tic-Tac-Toe with Nakama

Grid Clash is a multiplayer Tic-Tac-Toe game built with a React frontend and a Nakama server-authoritative backend. The server owns the game state, validates every move, broadcasts trusted updates in real time, and persists player performance across matches.

## Assignment coverage

### Frontend

- Responsive React + TypeScript UI optimized for desktop and mobile browsers
- Real-time game state updates over Nakama sockets
- Player identity, room status, room code, and match state displayed live
- Login/register flow with email authentication
- Lobby, room discovery, join-by-code, auto-match, active game, rematch, and leaderboard views

### Backend (Nakama)

- Server-authoritative Tic-Tac-Toe match handler
- Server-side validation for every move
- Anti-cheat protection by rejecting invalid or out-of-turn moves
- Real-time authoritative state broadcast after validated actions
- Room creation, room discovery, room code join, and automatic matchmaking
- Graceful disconnect handling and server-side match resolution
- Concurrent isolated authoritative matches for multiple simultaneous sessions
- Persistent global stats: wins, losses, draws, current streak, best streak, games played
- Persistent head-to-head rivalry stats between two players
- Global rankings RPC for top-player display

## Features

- React + TypeScript frontend with responsive UI
- Nakama authoritative match runtime in Lua
- Email-based login and registration through Nakama
- Room creation, room discovery, join by room code, and auto-match
- Timed mode with server-side turn timeout
- Rematch request / accept / reject flow
- Concurrent room isolation through per-match authoritative state
- Global leaderboard with persistent player performance data
- Head-to-head stats after repeated games between the same players
- Docker Compose local stack for Nakama + PostgreSQL

## Project structure

```text
.
|-- docker-compose.yml
|-- docker-compose.prod.yml
|-- DEPLOYMENT.md
|-- SUBMISSION_CHECKLIST.md
|-- README.md
|-- frontend/
|   |-- .env.example
|   |-- .env.production.example
|   |-- src/
|   |   |-- App.tsx
|   |   |-- env.ts
|   |   |-- nakama.ts
|   |   |-- styles.css
|   |   `-- types.ts
|   `-- package.json
`-- nakama/
    `-- modules/
        |-- init.lua
        `-- tictactoe.lua
```

## Architecture

### Frontend

- React renders the auth page, lobby, room, and active match views.
- The client authenticates with Nakama using email + password.
- The lobby consumes RPCs for waiting-room discovery and global rankings.
- Matchmaking uses Nakama's matchmaker and joins the matched target automatically.
- Gameplay uses realtime socket messages only after joining a match.
- The client never decides game outcomes locally; it only sends intent.

### Backend

- `nakama/modules/tictactoe.lua` contains the authoritative match handler.
- `nakama/modules/init.lua` exposes RPCs for lobby discovery, match creation, room-code resolution, delete-lobby, and global leaderboard retrieval.
- Every room is a separate authoritative Nakama match instance, which gives proper isolation for concurrent sessions.
- The server tracks board state, player assignments, turn ownership, timer deadlines, rematch requests, winner state, and leaderboard stats.
- Completed games write persistent stats into Nakama storage objects.

## Core Nakama contract

Realtime op codes:

- `1`: authoritative game state broadcast
- `2`: client move request
- `3`: rematch action request
- `99`: validation or gameplay error

RPCs:

- `list_matches`
- `create_match`
- `resolve_match_code`
- `delete_match`
- `list_global_leaderboard`

## Local setup

### 1. Start Nakama and PostgreSQL

Requirements:

- Docker Desktop
- Node.js 18+
- npm 9+

Run:

```bash
docker compose up
```

This starts:

- Nakama HTTP API at `http://127.0.0.1:7350`
- Nakama console at `http://127.0.0.1:7351`
- Nakama gRPC at `127.0.0.1:7349`

### 2. Start the React frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend defaults:

- Vite dev server: `http://127.0.0.1:5173`
- Nakama host: `127.0.0.1`
- Nakama port: `7350`
- Server key: `defaultkey`

## How to test multiplayer

1. Register two different players.
2. Open the app in two browser windows or devices.
3. In one window, create a room and copy the room code.
4. In the other window, join by room code or use auto-match from both clients.
5. Play turns and verify the board updates in real time on both screens.
6. Try clicking an occupied tile or moving out of turn to verify server validation.
7. Use timed mode and confirm timeout resolution is server-enforced.
8. Disconnect one player during a live game and confirm graceful match resolution.
9. Finish multiple games and confirm global rankings update.
10. Play five games between the same two players and verify head-to-head stats appear.

## Deployment

Deployment instructions are in [DEPLOYMENT.md](/D:/LILA%20assignment/DEPLOYMENT.md).

Submission readiness checklist is in [SUBMISSION_CHECKLIST.md](/D:/LILA%20assignment/SUBMISSION_CHECKLIST.md).

## Important note

This repository now contains the application code, production-oriented Docker template, environment examples, and deployment documentation. A real public cloud deployment still has to be executed from your own cloud account, because that cannot be completed from this sandboxed environment.
