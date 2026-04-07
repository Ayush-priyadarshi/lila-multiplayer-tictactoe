export type Mode = "classic" | "timed";

export interface PlayerState {
  userId: string;
  username: string;
  mark: "X" | "O";
  connected: boolean;
}

export interface MatchSummary {
  matchId: string;
  roomName: string;
  mode: Mode;
  size: number;
  status: string;
  ownerId?: string;
  ownerName?: string;
  roomCode?: string;
}

export interface RematchRequest {
  requesterId: string;
  requesterName: string;
  targetId: string;
  status: "pending";
}

export interface LeaderboardPlayer {
  userId: string;
  username: string;
  wins: number;
  losses: number;
}

export interface LeaderboardStats {
  totalGames: number;
  draws: number;
  players: LeaderboardPlayer[];
}

export interface GlobalLeaderboardEntry {
  userId: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  currentStreak: number;
  bestStreak: number;
  rank: number;
}

export interface GameState {
  board: string[];
  players: PlayerState[];
  currentTurn: "X" | "O";
  status: "waiting" | "playing" | "finished" | "draw" | "abandoned" | "terminated";
  winner: "X" | "O" | null;
  winningLine: number[];
  roomName: string;
  mode: Mode;
  moveCount: number;
  turnDeadline: number | null;
  ownerId?: string;
  ownerName?: string;
  roomCode?: string;
  lastError?: string | null;
  rematchRequest?: RematchRequest | null;
  rematchMessage?: string | null;
  leaderboard?: LeaderboardStats | null;
}
