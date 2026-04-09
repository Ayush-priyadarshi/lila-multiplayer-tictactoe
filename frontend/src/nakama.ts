import { Client, Session, Socket } from "@heroiclabs/nakama-js";
import { env } from "./env";
import type { GameState, GlobalLeaderboardEntry, LeaderboardStats, MatchSummary, Mode, RematchRequest } from "./types";

const DEVICE_KEY = "grid-clash-device-id";
const NAME_KEY = "grid-clash-player-name";
const decoder = new TextDecoder();

export const OPCODES = {
  state: 1,
  move: 2,
  rematch: 3,
  error: 99
} as const;

export function getStoredName() {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function setStoredName(value: string) {
  localStorage.setItem(NAME_KEY, value);
}

export function clearStoredIdentity() {
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(DEVICE_KEY);
}

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID().replace(/-/g, "");
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

function parseJsonLike<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  if (value instanceof Uint8Array) return JSON.parse(decoder.decode(value)) as T;
  if (value && typeof value === "object") return value as T;
  throw new Error("Unsupported JSON payload format.");
}

export function normalizeGameState(input: unknown): GameState {
  const parsed = parseJsonLike<Record<string, unknown>>(input);
  return {
    board: Array.isArray(parsed.board) ? parsed.board.map((cell) => String(cell ?? "")) : ["", "", "", "", "", "", "", "", ""],
    players: Array.isArray(parsed.players) ? (parsed.players as GameState["players"]) : [],
    currentTurn: parsed.currentTurn === "O" ? "O" : "X",
    status: typeof parsed.status === "string" ? (parsed.status as GameState["status"]) : "waiting",
    winner: parsed.winner === "X" || parsed.winner === "O" ? parsed.winner : null,
    winningLine: Array.isArray(parsed.winningLine) ? parsed.winningLine.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [],
    roomName: typeof parsed.roomName === "string" ? parsed.roomName : "Grid Clash Arena",
    mode: parsed.mode === "timed" ? "timed" : "classic",
    moveCount: typeof parsed.moveCount === "number" ? parsed.moveCount : 0,
    turnDeadline: typeof parsed.turnDeadline === "number" ? parsed.turnDeadline : null,
    ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : undefined,
    ownerName: typeof parsed.ownerName === "string" ? parsed.ownerName : undefined,
    roomCode: typeof parsed.roomCode === "string" ? parsed.roomCode : undefined,
    lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    rematchRequest: parsed.rematchRequest && typeof parsed.rematchRequest === "object" ? (parsed.rematchRequest as RematchRequest) : null,
    rematchMessage: typeof parsed.rematchMessage === "string" ? parsed.rematchMessage : null,
    leaderboard: parsed.leaderboard && typeof parsed.leaderboard === "object" ? (parsed.leaderboard as LeaderboardStats) : null
  };
}

export function createClient() {
  return new Client(env.nakamaServerKey, env.nakamaHost, env.nakamaPort, env.nakamaScheme === "https");
}

function sanitizeUsername(username: string) {
  return username.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32) || "Player";
}

export async function authenticate(client: Client, username: string) {
  return client.authenticateDevice(getDeviceId(), true, sanitizeUsername(username));
}

export async function loginWithEmail(client: Client, email: string, password: string) {
  return client.authenticateEmail(email.trim(), password, false);
}

export async function registerWithEmail(client: Client, email: string, password: string, username: string) {
  return client.authenticateEmail(email.trim(), password, true, sanitizeUsername(username));
}

export async function fetchAccountUsername(client: Client, session: Session) {
  const account = await client.getAccount(session);
  return account.user?.username || getStoredName() || "Player";
}

export function createSocket(client: Client) {
  return client.createSocket(env.nakamaScheme === "https", false);
}

export async function connectSocket(socket: Socket, session: Session) {
  await socket.connect(session, true);
}

export function parseRealtimePayload(data: unknown) {
  return parseJsonLike(data);
}

export async function listOpenMatches(client: Client, session: Session) {
  const result = await client.rpc(session, "list_matches", { limit: 20 } as unknown as object);
  const payload = parseJsonLike<unknown>(result.payload);

  if (Array.isArray(payload)) return payload as MatchSummary[];
  if (payload && typeof payload === "object") {
    const maybePayload = payload as { matches?: unknown };
    if (Array.isArray(maybePayload.matches)) {
      return maybePayload.matches as MatchSummary[];
    }
  }

  return [];
}

export async function fetchGlobalLeaderboard(client: Client, session: Session) {
  const result = await client.rpc(session, "list_global_leaderboard", { limit: 10 } as unknown as object);
  const payload = parseJsonLike<unknown>(result.payload);

  if (Array.isArray(payload)) return payload as GlobalLeaderboardEntry[];
  if (payload && typeof payload === "object") {
    const maybePayload = payload as { players?: unknown };
    if (Array.isArray(maybePayload.players)) {
      return maybePayload.players as GlobalLeaderboardEntry[];
    }
  }

  return [];
}

export async function createAuthoritativeMatch(client: Client, session: Session, mode: Mode, roomName: string) {
  const result = await client.rpc(session, "create_match", {
    mode,
    room_name: roomName.trim() || "Grid Clash Arena",
    owner_name: getStoredName().trim() || "Host"
  } as unknown as object);

  return parseJsonLike<{ matchId: string; roomCode?: string }>(result.payload);
}

export async function resolveMatchCode(client: Client, session: Session, code: string) {
  const result = await client.rpc(session, "resolve_match_code", { code } as unknown as object);
  return parseJsonLike<{ matchId: string; roomCode?: string }>(result.payload);
}

export async function deleteLobby(client: Client, session: Session, matchId: string) {
  await client.rpc(session, "delete_match", { matchId } as unknown as object);
}

export async function joinExistingMatch(socket: Socket, matchId: string) {
  return socket.joinMatch(matchId);
}

export async function startAutoMatch(socket: Socket, mode: Mode, roomName: string) {
  return socket.addMatchmaker("*", 2, 2, {
    mode,
    room_name: roomName.trim() || "Auto Match"
  }) as Promise<{ ticket: string }>;
}

export async function sendMove(socket: Socket, matchId: string, index: number) {
  await socket.sendMatchState(matchId, OPCODES.move, JSON.stringify({ index }));
}

export async function sendRematch(socket: Socket, matchId: string, action: "request" | "accept" | "reject" = "request") {
  await socket.sendMatchState(matchId, OPCODES.rematch, JSON.stringify({ action }));
}

export async function cancelAutoMatch(socket: Socket, ticket: string) {
  await (socket as Socket & { removeMatchmaker: (value: string) => Promise<void> }).removeMatchmaker(ticket);
}
