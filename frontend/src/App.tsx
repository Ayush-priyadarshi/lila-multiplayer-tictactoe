import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Client, Session, Socket } from "@heroiclabs/nakama-js";
import {
  cancelAutoMatch,
  clearStoredIdentity,
  connectSocket,
  createAuthoritativeMatch,
  createClient,
  createSocket,
  deleteLobby,
  fetchGlobalLeaderboard,
  fetchAccountUsername,
  joinExistingMatch,
  listOpenMatches,
  loginWithEmail,
  normalizeGameState,
  OPCODES,
  parseRealtimePayload,
  registerWithEmail,
  resolveMatchCode,
  sendMove,
  sendRematch,
  setStoredName,
  startAutoMatch
} from "./nakama";
import type { GameState, GlobalLeaderboardEntry, MatchSummary, Mode, PlayerState } from "./types";

type Screen = "login" | "lobby" | "searching" | "room" | "game";
type AuthView = "login" | "register";
type ChatPhrase = "GG" | "Wow!" | "Nice Move";

const defaultGameState: GameState = {
  board: ["", "", "", "", "", "", "", "", ""],
  players: [],
  currentTurn: "X",
  status: "waiting",
  winner: null,
  winningLine: [],
  roomName: "Grid Clash Arena",
  mode: "classic",
  moveCount: 0,
  turnDeadline: null,
  ownerId: undefined,
  ownerName: undefined,
  roomCode: undefined,
  lastError: null,
  rematchRequest: null,
  rematchMessage: null,
  leaderboard: null
};

const WIN_LINE_STYLES: Record<string, CSSProperties> = {
  "1-2-3": { width: "86%", height: 8, top: "16.66%", left: "7%", transform: "translateY(-50%)" },
  "4-5-6": { width: "86%", height: 8, top: "50%", left: "7%", transform: "translateY(-50%)" },
  "7-8-9": { width: "86%", height: 8, top: "83.33%", left: "7%", transform: "translateY(-50%)" },
  "1-4-7": { width: 8, height: "86%", top: "7%", left: "16.66%", transform: "translateX(-50%)" },
  "2-5-8": { width: 8, height: "86%", top: "7%", left: "50%", transform: "translateX(-50%)" },
  "3-6-9": { width: 8, height: "86%", top: "7%", left: "83.33%", transform: "translateX(-50%)" },
  "1-5-9": { width: "122%", height: 8, top: "50%", left: "-11%", transform: "rotate(45deg)" },
  "3-5-7": { width: "122%", height: 8, top: "50%", left: "-11%", transform: "rotate(-45deg)" }
};

function playerForMark(players: PlayerState[], mark: "X" | "O") {
  return players.find((player) => player.mark === mark) ?? null;
}

function statusLabel(game: GameState) {
  if (game.status === "waiting") return "Waiting for another player";
  if (game.status === "playing") return `${game.currentTurn} to move`;
  if (game.status === "draw") return "Draw game";
  if (game.status === "finished" && game.winner) return `${game.winner} wins`;
  if (game.status === "abandoned") return "Match abandoned";
  return "Match ended";
}

function helperCopy(game: GameState, me: PlayerState | null) {
  if (game.status === "waiting") return "Room is live. Share the room code or open another window to join instantly.";
  if (game.status === "playing" && me?.mark === game.currentTurn) return "Your turn. Tap any open cell.";
  if (game.status === "playing") return "Opponent is thinking.";
  if (game.status === "finished" && me?.mark === game.winner) return "You won this round.";
  if (game.status === "finished") return "Round over. Tap play again for another battle.";
  if (game.status === "draw") return "Nobody won. Tap play again and settle it.";
  return "Create or join a room to start playing.";
}

function normalizeAuthErrorMessage(message: string, authIntent: AuthView) {
  const lower = message.toLowerCase();
  if (authIntent === "login") {
    if (lower.includes("not found") || lower.includes("404") || lower.includes("does not exist") || lower.includes("no account")) {
      return "Email does not exist.";
    }
    if (lower.includes("invalid credentials") || lower.includes("unauthorized") || lower.includes("401") || lower.includes("password")) {
      return "Incorrect password.";
    }
  }
  return message;
}

function formatErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const maybeError = error as { message?: string; statusText?: string; status?: number; error?: string };
    if (maybeError.message) return maybeError.message;
    if (maybeError.error) return maybeError.error;
    if (maybeError.status && maybeError.statusText) return `${maybeError.status} ${maybeError.statusText}`;
    if (maybeError.status) return `Request failed with status ${maybeError.status}`;
  }
  return error instanceof Error ? error.message : "Unexpected error while connecting to Nakama.";
}

function avatarLetter(name?: string) {
  return (name?.trim().charAt(0) || "?").toUpperCase();
}

async function copyText(value: string) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeMatchCode(value: string) {
  return value.trim().replace(/^[\s'"`]+|[\s'"`]+$/g, "");
}

export default function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [screen, setScreen] = useState<Screen>("login");
  const [authView, setAuthView] = useState<AuthView>("login");
  const [authIntent, setAuthIntent] = useState<AuthView>("login");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [activeUsername, setActiveUsername] = useState("");
  const [activeEmail, setActiveEmail] = useState("");
  const [activePassword, setActivePassword] = useState("");
  const [mode, setMode] = useState<Mode>("classic");
  const [roomName, setRoomName] = useState("Sunburst Arena");
  const [joinMode, setJoinMode] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<MatchSummary[]>([]);
  const [topPlayers, setTopPlayers] = useState<GlobalLeaderboardEntry[]>([]);
  const [dismissedLobbyIds, setDismissedLobbyIds] = useState<string[]>([]);
  const [matchId, setMatchId] = useState("");
  const [game, setGame] = useState<GameState>(defaultGameState);
  const [winnerPopup, setWinnerPopup] = useState("");
  const [chatBubble, setChatBubble] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [matchmaking, setMatchmaking] = useState(false);
  const [searchTicket, setSearchTicket] = useState("");
  const [searchDeadlineMs, setSearchDeadlineMs] = useState<number | null>(null);
  const [connectNonce, setConnectNonce] = useState(0);

  const me = useMemo(() => {
    if (!session) return null;
    return game.players.find((player) => player.userId === session.user_id) ?? null;
  }, [game.players, session]);

  const xPlayer = playerForMark(game.players, "X");
  const oPlayer = playerForMark(game.players, "O");
  const isMyTurn = Boolean(me && game.status === "playing" && me.mark === game.currentTurn);
  const countdown = game.turnDeadline ? Math.max(game.turnDeadline - Math.floor(nowMs / 1000), 0) : null;
  const searchCountdown = searchDeadlineMs ? Math.max(Math.ceil((searchDeadlineMs - nowMs) / 1000), 0) : 0;
  const winningCells = Array.isArray(game.winningLine) ? game.winningLine : [];
  const winningStyle = WIN_LINE_STYLES[winningCells.join("-")];
  const isOwner = Boolean(session?.user_id && game.ownerId && session.user_id === game.ownerId);
  const rematchRequest = game.rematchRequest;
  const incomingRematch = Boolean(rematchRequest && session?.user_id === rematchRequest.targetId);
  const waitingForRematchReply = Boolean(rematchRequest && session?.user_id === rematchRequest.requesterId);
  const rivalryReady = Boolean(game.leaderboard && game.leaderboard.totalGames >= 5);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!chatBubble) return;
    const timeoutId = window.setTimeout(() => setChatBubble(""), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [chatBubble]);

  useEffect(() => {
    if (game.status === "finished" && game.winner) {
      const winnerPlayer = game.winner === "X" ? xPlayer : oPlayer;
      setWinnerPopup(`Victory - ${winnerPlayer?.username ?? `Player ${game.winner}`} wins!`);
      return;
    }
    if (game.status === "draw") {
      setWinnerPopup("It's a draw!");
      return;
    }
    setWinnerPopup("");
  }, [game.status, game.winner, xPlayer, oPlayer]);
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      if (!activeEmail || !activePassword) return;

      try {
        setLoading(true);
        setError("");
        const nextClient = createClient();
        const requestedName = activeUsername.trim() || username.trim() || "Player";
        const nextSession = authIntent === "register"
          ? await registerWithEmail(nextClient, activeEmail, activePassword, requestedName)
          : await loginWithEmail(nextClient, activeEmail, activePassword);
        const resolvedUsername = authIntent === "register"
          ? requestedName
          : await fetchAccountUsername(nextClient, nextSession).catch(() => requestedName || activeEmail.split("@")[0] || "Player");

        const nextSocket = createSocket(nextClient);
        nextSocket.onmatchdata = (data) => {
          if (data.op_code === OPCODES.state) {
            const payload = normalizeGameState(data.data);
            setGame(payload);
            setError("");
            setScreen(payload.status === "waiting" ? "room" : "game");
          }
          if (data.op_code === OPCODES.error) {
            const payload = parseRealtimePayload(data.data) as { message?: string };
            setError(payload.message || "Match error received.");
          }
        };

        nextSocket.onmatchmakermatched = async (matched) => {
          try {
            const joinTarget =
              (matched as { token?: string; match_id?: string; matchId?: string }).token ||
              (matched as { token?: string; match_id?: string; matchId?: string }).match_id ||
              (matched as { token?: string; match_id?: string; matchId?: string }).matchId;

            if (!joinTarget) {
              throw new Error("No match ID or token found.");
            }

            const joined = await nextSocket.joinMatch(joinTarget);
            if (cancelled) return;
            setMatchId(joined.match_id);
            setMatchmaking(false);
            setSearchTicket("");
            setSearchDeadlineMs(null);
            setBusyAction("");
            setError("");
            setGame((current) => ({
              ...current,
              roomName: current.roomName || roomName.trim() || "Auto Match",
              mode,
              status: "waiting"
            }));
            setScreen("room");
          } catch (joinError) {
            if (cancelled) return;
            setMatchmaking(false);
            setSearchTicket("");
            setSearchDeadlineMs(null);
            setBusyAction("");
            setError(formatErrorMessage(joinError));
            setScreen("lobby");
          }
        };

        nextSocket.ondisconnect = () => {
          if (cancelled) return;
          setConnected(false);
          setMatchmaking(false);
          setSearchTicket("");
          setSearchDeadlineMs(null);
          setBusyAction("");
          setError("Disconnected from Nakama. Click Retry Connection.");
        };

        await connectSocket(nextSocket, nextSession);
        if (cancelled) return;

        setStoredName(resolvedUsername);
        setClient(nextClient);
        setSession(nextSession);
        setSocket(nextSocket);
        setUsername(resolvedUsername);
        setActiveUsername(resolvedUsername);
        setConnected(true);
        setScreen("lobby");
      } catch (bootError) {
        if (cancelled) return;
        setClient(null);
        setSession(null);
        setSocket(null);
        setConnected(false);
        setError(normalizeAuthErrorMessage(formatErrorMessage(bootError), authIntent));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [activeEmail, activePassword, activeUsername, authIntent, connectNonce, mode, roomName, username]);

  useEffect(() => {
    if (!client || !session || screen !== "lobby") return;
    const loadRooms = async () => {
      try {
        const nextRooms = await listOpenMatches(client, session);
        const safeRooms = Array.isArray(nextRooms) ? nextRooms : [];
        setRooms(safeRooms.filter((room) => room.size < 2 && !dismissedLobbyIds.includes(room.matchId)));
      } catch (listError) {
        setError(formatErrorMessage(listError));
      }
    };

    void loadRooms();
    const intervalId = window.setInterval(() => { void loadRooms(); }, 3000);
    return () => window.clearInterval(intervalId);
  }, [client, session, screen, dismissedLobbyIds]);

  useEffect(() => {
    if (!client || !session || screen !== "lobby") return;
    const loadLeaderboard = async () => {
      try {
        const nextTopPlayers = await fetchGlobalLeaderboard(client, session);
        const safeTopPlayers = Array.isArray(nextTopPlayers) ? nextTopPlayers : [];
        setTopPlayers(safeTopPlayers);
      } catch (leaderboardError) {
        setError(formatErrorMessage(leaderboardError));
      }
    };

    void loadLeaderboard();
    const intervalId = window.setInterval(() => { void loadLeaderboard(); }, 5000);
    return () => window.clearInterval(intervalId);
  }, [client, session, screen]);

  useEffect(() => {
    if (screen !== "searching" || !matchmaking || !socket || !searchTicket || !searchDeadlineMs) return;
    if (searchCountdown > 0) return;

    let cancelled = false;
    const timeoutSearch = async () => {
      try {
        await cancelAutoMatch(socket, searchTicket);
      } catch {
      } finally {
        if (cancelled) return;
        setMatchmaking(false);
        setSearchTicket("");
        setSearchDeadlineMs(null);
        setBusyAction("");
        setScreen("lobby");
        setError("No random player found in 30 seconds. Back in the lobby now.");
      }
    };

    void timeoutSearch();
    return () => {
      cancelled = true;
    };
  }, [screen, matchmaking, socket, searchTicket, searchDeadlineMs, searchCountdown]);

  function retryConnection() {
    if (!activeEmail || !activePassword) return;
    setConnectNonce((value) => value + 1);
  }

  async function refreshRooms() {
    if (!client || !session) return;
    const [nextRooms, nextTopPlayers] = await Promise.all([
      listOpenMatches(client, session),
      fetchGlobalLeaderboard(client, session)
    ]);
    const safeRooms = Array.isArray(nextRooms) ? nextRooms : [];
    const safeTopPlayers = Array.isArray(nextTopPlayers) ? nextTopPlayers : [];
    setRooms(safeRooms.filter((room) => room.size < 2 && !dismissedLobbyIds.includes(room.matchId)));
    setTopPlayers(safeTopPlayers);
  }
  function ensureReadyIdentity() {
    const safeName = username.trim() || activeUsername.trim() || "Player";
    if (!connected || !socket || !client || !session) {
      setError("Disconnected from Nakama. Click Retry Connection.");
      return null;
    }
    setStoredName(safeName);
    setUsername(safeName);
    setActiveUsername(safeName);
    return safeName;
  }

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Enter your email and password.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address, like player1@example.com.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setError("");
    clearStoredIdentity();
    setAuthIntent("login");
    setActiveUsername("");
    setActiveEmail(email.trim());
    setActivePassword(password);
    setConnectNonce((value) => value + 1);
  }

  async function handleRegister() {
    const safeName = username.trim();
    if (!safeName || !email.trim() || !password.trim()) {
      setError("Enter username, email, and password to register.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address, like player1@example.com.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    clearStoredIdentity();
    setAuthIntent("register");
    setActiveUsername(safeName);
    setActiveEmail(email.trim());
    setActivePassword(password);
    setConnectNonce((value) => value + 1);
  }

  function handleLogout() {
    clearStoredIdentity();
    setClient(null);
    setSession(null);
    setSocket(null);
    setConnected(false);
    setLoading(false);
    setUsername("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setActiveUsername("");
    setActiveEmail("");
    setActivePassword("");
    setMatchmaking(false);
    setSearchTicket("");
    setSearchDeadlineMs(null);
    setJoinMode(false);
    setRoomCode("");
    setMatchId("");
    setRooms([]);
    setTopPlayers([]);
    setDismissedLobbyIds([]);
    setGame(defaultGameState);
    setWinnerPopup("");
    setChatBubble("");
    setError("");
    setBusyAction("");
    setAuthView("login");
    setAuthIntent("login");
    setScreen("login");
  }

  async function handleCreateRoom() {
    const safeName = ensureReadyIdentity();
    if (!safeName || !client || !session || !socket) return;

    try {
      setBusyAction("Creating room...");
      setError("");
      const createdMatch = await createAuthoritativeMatch(client, session, mode, roomName);
      const joined = await joinExistingMatch(socket, createdMatch.matchId);
      setMatchId(joined.match_id);
      setRoomCode(createdMatch.roomCode || "");
      setGame({
        ...defaultGameState,
        roomName: roomName.trim() || "Grid Clash Arena",
        mode,
        status: "waiting",
        ownerId: session.user_id,
        ownerName: safeName,
        roomCode: createdMatch.roomCode,
        players: [{ userId: session.user_id || "local-player", username: safeName, mark: "X", connected: true }]
      });
      setScreen("room");
    } catch (createError) {
      setError(formatErrorMessage(createError));
    } finally {
      setBusyAction("");
    }
  }
  async function handleJoinRoom(targetMatchId: string) {
    const safeName = ensureReadyIdentity();
    if (!safeName || !socket) return;

    try {
      setBusyAction("Joining room...");
      setError("");
      const joined = await joinExistingMatch(socket, targetMatchId);
      setMatchId(joined.match_id);
      setScreen("room");
    } catch (joinError) {
      setError(formatErrorMessage(joinError));
    } finally {
      setBusyAction("");
    }
  }

  async function handleJoinByCode() {
    const normalizedCode = normalizeMatchCode(roomCode);
    if (!normalizedCode) {
      setError("Enter a room code or match id.");
      return;
    }
    if (!client || !session) {
      setError("Disconnected from Nakama. Click Retry Connection.");
      return;
    }

    try {
      setBusyAction("Finding room...");
      setError("");

      const nextRooms = await listOpenMatches(client, session);
      const safeRooms = Array.isArray(nextRooms) ? nextRooms : [];
      setRooms(safeRooms.filter((room) => room.size < 2 && !dismissedLobbyIds.includes(room.matchId)));

      const matchedRoom = safeRooms.find((room) => {
        const code = room.roomCode || "";
        return code === normalizedCode || room.matchId === normalizedCode || room.matchId.startsWith(normalizedCode);
      });

      if (matchedRoom) {
        await handleJoinRoom(matchedRoom.matchId);
        return;
      }

      const resolved = await resolveMatchCode(client, session, normalizedCode);
      setRoomCode(resolved.roomCode || normalizedCode);
      await handleJoinRoom(resolved.matchId);
    } catch (joinCodeError) {
      setError(formatErrorMessage(joinCodeError));
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteLobby(targetMatchId: string) {
    if (!client || !session) return;

    try {
      setBusyAction("Deleting lobby...");
      setError("");
      setDismissedLobbyIds((current) => current.includes(targetMatchId) ? current : [...current, targetMatchId]);
      await deleteLobby(client, session, targetMatchId);
    } catch (deleteError) {
      const message = formatErrorMessage(deleteError);
      const alreadyGone = message.includes("404") || message.toLowerCase().includes("not found");
      if (!alreadyGone) {
        setError(message);
        return;
      }
    } finally {
      setRooms((current) => current.filter((room) => room.matchId !== targetMatchId));
      if (matchId === targetMatchId) {
        setMatchId("");
        setGame(defaultGameState);
        setScreen("lobby");
      }
      setBusyAction("");
    }
  }

  async function handleAutoMatch() {
    const safeName = ensureReadyIdentity();
    if (!safeName || !socket) return;

    try {
      setBusyAction("Finding opponent...");
      setError("");
      setMatchmaking(true);
      setMatchId("");
      setRoomCode("");
      setGame({
        ...defaultGameState,
        roomName: roomName.trim() || "Auto Match",
        mode,
        status: "waiting",
        ownerName: safeName,
        players: session ? [{ userId: session.user_id || "local-player", username: safeName, mark: "X", connected: true }] : []
      });
      const ticket = await startAutoMatch(socket, mode, roomName);
      setSearchTicket(ticket.ticket);
      setSearchDeadlineMs(Date.now() + 30000);
      setScreen("searching");
    } catch (matchmakerError) {
      setMatchmaking(false);
      setSearchTicket("");
      setSearchDeadlineMs(null);
      setBusyAction("");
      setError(formatErrorMessage(matchmakerError));
    }
  }

  async function stopSearchAndReturn() {
    if (socket && searchTicket) {
      try {
        await cancelAutoMatch(socket, searchTicket);
      } catch {
      }
    }

    setMatchmaking(false);
    setSearchTicket("");
    setSearchDeadlineMs(null);
    setBusyAction("");
    setScreen("lobby");
  }

  async function handleCopyMatchCode() {
    const codeToCopy = game.roomCode || roomCode || matchId;
    if (!codeToCopy) return;
    const copied = await copyText(codeToCopy);
    if (copied) {
      setBusyAction("Match code copied.");
      window.setTimeout(() => {
        setBusyAction((current) => current === "Match code copied." ? "" : current);
      }, 1600);
      return;
    }
    setError("Could not copy match code. Please copy it manually.");
  }

  async function handleMove(index: number) {
    if (!socket || !matchId || !isMyTurn) return;
    try {
      await sendMove(socket, matchId, index);
    } catch (moveError) {
      setError(formatErrorMessage(moveError));
    }
  }

  async function handleRematch(action: "request" | "accept" | "reject" = "request") {
    if (!socket || !matchId) return;
    try {
      if (action === "request") setWinnerPopup("");
      await sendRematch(socket, matchId, action);
    } catch (rematchError) {
      setError(formatErrorMessage(rematchError));
    }
  }

  function sendQuickChat(phrase: ChatPhrase) {
    setChatBubble(phrase);
  }

  async function leaveToLobby() {
    if (matchmaking && searchTicket) {
      await stopSearchAndReturn();
    } else {
      setScreen("lobby");
      setMatchmaking(false);
      setSearchTicket("");
      setSearchDeadlineMs(null);
      setBusyAction("");
    }

    setMatchId("");
    setRoomCode("");
    setGame(defaultGameState);
    setWinnerPopup("");
    setError("");
  }

  return (
    <div className="app-shell board-bg-shell">
      <div className="bg-board bg-board-left" />
      <div className="bg-board bg-board-right" />
      <div className="glow glow-orange" />
      <div className="glow glow-cyan" />

      <main className="page-shell">
        <header className="page-head game-head">
          <div>
            <h1>Grid Clash Arena</h1>
          </div>
          <div className={`connection-pill ${connected ? "online" : "offline"}`}>
            {connected ? "Server online" : loading ? "Connecting..." : "Offline"}
          </div>
        </header>
        {screen === "login" && (
          <section className="page-card login-page auth-page-card">
            <div className="eyebrow">{authView === "login" ? "Login" : "Register"}</div>
            <h2>{authView === "login" ? "Enter the arena" : "Create your player account"}</h2>
            <p className="hero-copy">
              {authView === "login"
                ? "Login with your email and password, then head into the main lobby."
                : "Register a new user with username, email, and password."}
            </p>

            {authView === "register" && (
              <label className="field hero-input">
                <span>Player name</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter Username..." />
              </label>
            )}

            <p className="auth-helper">
              Use a real email like <strong>player1@example.com</strong> and a password with at least <strong>8 characters</strong>.
            </p>

            <label className="field hero-input">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter Email..." type="email" />
            </label>

            <label className="field hero-input">
              <span>Password</span>
              <div className="password-field">
                <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter Password..." type={showPassword ? "text" : "password"} />
                <button className="password-toggle" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? "Hide" : "Show"}</button>
              </div>
            </label>

            {authView === "register" && (
              <label className="field hero-input">
                <span>Confirm password</span>
                <div className="password-field">
                  <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm Password..." type={showConfirmPassword ? "text" : "password"} />
                  <button className="password-toggle" onClick={() => setShowConfirmPassword((value) => !value)} type="button">{showConfirmPassword ? "Hide" : "Show"}</button>
                </div>
              </label>
            )}

            <button className="btn btn-primary pulse-btn" onClick={() => void (authView === "login" ? handleLogin() : handleRegister())} type="button">
              {authView === "login" ? "Login" : "Register"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setAuthView(authView === "login" ? "register" : "login"); setError(""); }} type="button">
              {authView === "login" ? "Register new user" : "Back to login"}
            </button>
            {error ? <div className="alert wide">{error}</div> : null}
          </section>
        )}

        {screen === "lobby" && (
          <section className="page-card lobby-page cinematic-lobby">
            <div className="lobby-hero-card">
              <div className="eyebrow">Lobby</div>
              <h2>Create a room or jump into one</h2>
              <p>Signed in as <strong>{activeUsername || username || "Player"}</strong>. Create a match, auto-match, or join an existing arena.</p>

              <label className="field hero-input">
                <span>Lobby name</span>
                <input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Sunburst Arena" />
              </label>

              <div className="mode-switch">
                <button className={mode === "classic" ? "active" : ""} onClick={() => setMode("classic")} type="button">Classic</button>
                <button className={mode === "timed" ? "active" : ""} onClick={() => setMode("timed")} type="button">Timed 30s</button>
              </div>

              <div className="hero-actions two-up">
                <button className="btn btn-primary pulse-btn" onClick={() => void handleCreateRoom()} disabled={!connected || Boolean(busyAction)} type="button">
                  {busyAction === "Creating room..." ? "Creating..." : "Create Match"}
                </button>
                {!joinMode ? (
                  <button className="btn btn-outline" onClick={() => setJoinMode(true)} type="button">Join Match</button>
                ) : (
                  <div className="join-inline-card">
                    <input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="Room Code / Match Id" />
                    <button className="btn btn-outline" onClick={() => void handleJoinByCode()} type="button">Join</button>
                  </div>
                )}
              </div>

              <div className="secondary-row">
                <button className="btn btn-secondary" onClick={() => void handleAutoMatch()} disabled={!connected || matchmaking} type="button">
                  {matchmaking ? "Matching..." : "Auto Match"}
                </button>
                <button className="btn btn-ghost" onClick={() => void refreshRooms()} disabled={!connected || Boolean(busyAction)} type="button">Refresh Lobbies</button>
                <button className="btn btn-ghost" onClick={handleLogout} type="button">Logout</button>
                {!connected ? <button className="btn btn-ghost" onClick={retryConnection} type="button">Retry Connection</button> : null}
              </div>
            </div>

            <div className="active-lobbies-panel">
              <div className="panel-topline">
                <h3>Active Lobbies</h3>
                <span>{rooms.length} live</span>
              </div>
              <div className="room-list">
                {rooms.length === 0 ? (
                  <div className="empty-card">No open lobbies right now. Create one and start the next duel.</div>
                ) : (
                  rooms.map((room) => (
                    <div className="room-card room-card-rich arena-lobby-card" key={room.matchId}>
                      <button className="lobby-close" onClick={(event) => { event.stopPropagation(); void handleDeleteLobby(room.matchId); }} type="button" aria-label="Remove lobby">×</button>
                      <div className="room-card-main" onClick={() => void handleJoinRoom(room.matchId)}>
                        <div>
                          <strong>{room.roomName}</strong>
                          <span>{room.mode === "timed" ? "Timed mode" : "Classic mode"} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ Host: {room.ownerName ?? "Unknown"}</span>
                          {room.roomCode ? <small>Code: {room.roomCode}</small> : null}
                        </div>
                        <div className="lobby-pill">{room.size}/2</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>


            <div className="global-leaderboard-panel leaderboard-card">
              <div className="panel-topline">
                <h3>Global Rankings</h3>
                <span>{topPlayers.length} tracked</span>
              </div>
              <p className="leaderboard-copy">Wins, losses, and streaks persist across isolated rooms, so simultaneous matches can run without mixing game state while rankings stay global.</p>
              <div className="leaderboard-list">
                {topPlayers.length === 0 ? (
                  <div className="empty-card">Play a few rounds to populate the global rankings.</div>
                ) : (
                  topPlayers.map((player) => (
                    <div className="leaderboard-row leaderboard-row-extended" key={player.userId}>
                      <div>
                        <strong>#{player.rank} {player.username}</strong>
                        <span>{player.gamesPlayed} games | {player.draws} draws</span>
                      </div>
                      <div className="leaderboard-stats">
                        <span>{player.wins}W / {player.losses}L</span>
                        <span>Streak {player.currentStreak} | Best {player.bestStreak}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {error ? <div className="alert wide">{error}</div> : null}
          </section>
        )}

        {screen === "searching" && (
          <section className="page-card searching-page match-search-page">
            <div className="searching-orb" />
            <span className="eyebrow">Random Matchmaking</span>
            <h2>Finding a random player</h2>
            <p>Stay on this screen while we search. If no opponent is found in 30 seconds, we will bring you back to the lobby.</p>
            <div className="search-timer-ring">
              <strong>{searchCountdown}s</strong>
              <span>search time left</span>
            </div>
            <div className="search-meta-row">
              <span className="meta-chip">Mode: {mode === "timed" ? "Timed 30s" : "Classic"}</span>
              <span className="meta-chip">Player: {activeUsername || username || "Player"}</span>
            </div>
            <div className="searching-dots" aria-hidden="true"><span /><span /><span /></div>
            <button className="btn btn-ghost" onClick={() => void stopSearchAndReturn()} type="button">Cancel Search</button>
            {error ? <div className="alert wide">{error}</div> : null}
          </section>
        )}
        {screen === "room" && (
          <section className="page-card room-page waiting-room-card">
            <div className="room-topline">
              <span className="eyebrow">Active Lobby</span>
              <h2>{game.roomName || roomName}</h2>
              <p>{busyAction || helperCopy(game, me)}</p>
              <div className="room-meta">
                <span className="meta-chip">{game.mode === "timed" ? "Timed mode" : "Classic mode"}</span>
                <span className="meta-chip">Host: {game.ownerName ?? activeUsername ?? "Host"}</span>
                <span className="meta-chip">Match: {matchId ? `${matchId.slice(0, 8)}...` : "pending"}</span>
              </div>
              <div className="match-code-card">
                <span className="match-code-label">Room code</span>
                <code className="match-code-value">{game.roomCode || roomCode || matchId || "pending"}</code>
                <button className="btn btn-outline match-code-btn" onClick={() => void handleCopyMatchCode()} disabled={!game.roomCode && !roomCode && !matchId} type="button">Copy code</button>
              </div>
            </div>

            <div className="room-players">
              <div className="seat-card hero-seat">
                <span className="seat-mark x">X</span>
                <strong>{xPlayer?.username ?? "Waiting for player"}</strong>
                <span>{xPlayer?.connected ? "Connected" : "Open slot"}</span>
              </div>
              <div className="seat-card hero-seat">
                <span className="seat-mark o">O</span>
                <strong>{oPlayer?.username ?? "Waiting for player"}</strong>
                <span>{oPlayer?.connected ? "Connected" : "Open slot"}</span>
              </div>
            </div>

            <div className="room-actions room-actions-row">
              {isOwner && game.status === "waiting" && matchId ? <button className="btn btn-danger" onClick={() => void handleDeleteLobby(matchId)} type="button">Remove Lobby</button> : null}
              <button className="btn btn-ghost" onClick={() => void leaveToLobby()} type="button">Back to Lobby</button>
            </div>

            {error ? <div className="alert wide">{error}</div> : null}
          </section>
        )}

        {screen === "game" && (
          <section className="page-card game-page battle-page">
            <div className="scoreboard">
              <div className={`avatar-card ${game.currentTurn === "X" && game.status === "playing" ? "thinking x-active" : ""}`}>
                <div className="avatar-ring x-ring"><span>{avatarLetter(xPlayer?.username)}</span></div>
                <div>
                  <strong>{xPlayer?.username ?? "Player X"}</strong>
                  <span>{game.currentTurn === "X" && game.status === "playing" ? "Thinking..." : xPlayer?.connected ? "Ready" : "Waiting"}</span>
                </div>
              </div>

              <div className="vs-center-panel">
                <div className="vs-icon">VS</div>
                <div className="timer-core">{game.mode === "timed" ? `${countdown ?? 0}s` : "15s"}</div>
              </div>

              <div className={`avatar-card ${game.currentTurn === "O" && game.status === "playing" ? "thinking o-active" : ""}`}>
                <div className="avatar-ring o-ring"><span>{avatarLetter(oPlayer?.username)}</span></div>
                <div>
                  <strong>{oPlayer?.username ?? "Player O"}</strong>
                  <span>{game.currentTurn === "O" && game.status === "playing" ? "Thinking..." : oPlayer?.connected ? "Ready" : "Waiting"}</span>
                </div>
              </div>
            </div>

            <div className="status-banner battle-status">
              <strong>{statusLabel(game)}</strong>
              <span>{me ? `You are ${me.mark}` : "Watching"}</span>
            </div>

            <div className="board-stage">
              {chatBubble ? <div className="quick-chat-bubble">{chatBubble}</div> : null}
              <div className="board-grid battle-grid">
                {game.board.map((value, index) => (
                  <button
                    key={index}
                    className={`cell battle-cell ${winningCells.includes(index + 1) ? "winning" : ""} ${isMyTurn ? `turn-${me?.mark?.toLowerCase()}` : ""}`}
                    onClick={() => void handleMove(index)}
                    disabled={Boolean(value) || !isMyTurn}
                    type="button"
                  >
                    <span className={`piece ${value === "X" ? "cell-x" : "cell-o"} ${value ? "piece-pop" : ""}`}>{value}</span>
                  </button>
                ))}
                {winningStyle ? <div className="victory-line" style={winningStyle} /> : null}
              </div>
            </div>

            <div className="quick-chat-row">
              <button className="chat-chip" onClick={() => sendQuickChat("GG")} type="button">GG</button>
              <button className="chat-chip" onClick={() => sendQuickChat("Wow!")} type="button">Wow!</button>
              <button className="chat-chip" onClick={() => sendQuickChat("Nice Move")} type="button">Nice Move</button>
            </div>

            <div className="footer-status"><span>Playing on Nakama Server:</span><span className="server-dot" /><strong>Connected</strong></div>
            {(game.status === "finished" || game.status === "draw") ? (
              <div className="result-actions-inline">
                {!rematchRequest ? <button className="btn btn-secondary rematch-btn-inline" onClick={() => void handleRematch("request")} type="button">Play Again</button> : null}
                {incomingRematch ? <button className="btn btn-primary rematch-btn-inline" onClick={() => void handleRematch("accept")} type="button">Accept Rematch</button> : null}
                {incomingRematch ? <button className="btn btn-danger" onClick={() => void handleRematch("reject")} type="button">Reject</button> : null}
                <button className="btn btn-ghost" onClick={() => void leaveToLobby()} type="button">Back to Lobby</button>
              </div>
            ) : null}

            {rematchRequest ? <div className="rematch-banner">{incomingRematch ? `${rematchRequest.requesterName} wants a rematch.` : waitingForRematchReply ? "Waiting for your opponent to respond..." : game.rematchMessage || "Rematch pending."}</div> : null}
            {!rematchRequest && game.rematchMessage ? <div className="rematch-banner subdued">{game.rematchMessage}</div> : null}

            {rivalryReady && game.leaderboard ? (
              <div className="leaderboard-card">
                <h3>Head-to-Head Leaderboard</h3>
                <p>{game.leaderboard.totalGames} games together ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ {game.leaderboard.draws} draws</p>
                <div className="leaderboard-list">
                  {game.leaderboard.players.map((player) => (
                    <div className="leaderboard-row" key={player.userId}>
                      <strong>{player.username}</strong>
                      <span>{player.wins}W / {player.losses}L</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? <div className="alert wide">{error}</div> : null}
          </section>
        )}
      </main>

      {winnerPopup ? (
        <div className="winner-overlay" onClick={() => setWinnerPopup("")}>
          <div className="winner-modal" onClick={(event) => event.stopPropagation()}>
            <div className="winner-badge">{game.status === "draw" ? "DRAW" : "VICTORY"}</div>
            <h2 className={game.status === "draw" ? "draw-title" : game.winner === "X" ? "x-title" : "o-title"}>{winnerPopup}</h2>
            <p>{incomingRematch ? `${rematchRequest?.requesterName} wants a rematch.` : waitingForRematchReply ? "Waiting for the other player to respond to your rematch request." : game.rematchMessage || (game.status === "draw" ? "Both players held the line. Start another round." : "That round is over. Hit play again and keep the rivalry going.")}</p>
            <div className="overlay-actions">
              {!rematchRequest ? <button className="btn btn-primary" onClick={() => void handleRematch("request")} type="button">Play Again</button> : null}
              {incomingRematch ? <button className="btn btn-primary" onClick={() => void handleRematch("accept")} type="button">Accept</button> : null}
              {incomingRematch ? <button className="btn btn-danger" onClick={() => void handleRematch("reject")} type="button">Reject</button> : null}
              <button className="btn btn-ghost" onClick={() => void leaveToLobby()} type="button">Back to Lobby</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
