# Submission Checklist

Use this checklist before sending the assignment.

## Code requirements

- [x] Server-authoritative game logic is implemented in Nakama.
- [x] All moves are validated server-side.
- [x] Invalid or out-of-turn moves are rejected.
- [x] Valid game state is broadcast to both clients in real time.
- [x] Players can create rooms.
- [x] Players can discover and join rooms.
- [x] Automatic matchmaking is available.
- [x] Player disconnects are handled gracefully.
- [x] Multiple rooms can run concurrently with isolated match state.
- [x] Global player stats persist across matches.
- [x] Wins, losses, and win streaks are tracked.
- [x] Global leaderboard is displayed.

## Frontend requirements

- [x] Responsive UI is implemented.
- [x] Real-time board updates are visible.
- [x] Player and room information is shown.
- [x] Mobile-friendly controls are present.

## Deployment deliverables

- [ ] Nakama deployed to a public cloud environment.
- [ ] Frontend deployed publicly.
- [x] Deployment documentation written.
- [ ] Public URLs added to the final submission.

## Manual test pass

- [ ] Register two accounts.
- [ ] Login from two separate browser sessions.
- [ ] Create a room and join by code.
- [ ] Use auto-match successfully.
- [ ] Finish a game and verify leaderboard update.
- [ ] Play repeated games and verify streak updates.
- [ ] Verify rematch request / accept / reject.
- [ ] Verify concurrent isolated rooms.

## Final submission package

Include:

- source code repository or zip
- public frontend URL
- backend URL / IP
- deployment notes
- short demo or screenshots if your evaluator expects them
