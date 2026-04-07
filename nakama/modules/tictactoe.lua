local nk = require("nakama")

local module = {}

local SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"
local STATS_COLLECTION = "matchup_stats"
local PLAYER_STATS_COLLECTION = "player_stats"
local GLOBAL_LEADERBOARD_COLLECTION = "global_leaderboard"
local GLOBAL_LEADERBOARD_KEY = "rankings"

local OPCODE_STATE = 1
local OPCODE_MOVE = 2
local OPCODE_REMATCH = 3
local OPCODE_ERROR = 99

local TICK_RATE = 1
local TURN_SECONDS = 30
local MATCH_CLOSE_SECONDS = 12
local WIN_LINES = {
  { 1, 2, 3 },
  { 4, 5, 6 },
  { 7, 8, 9 },
  { 1, 4, 7 },
  { 2, 5, 8 },
  { 3, 6, 9 },
  { 1, 5, 9 },
  { 3, 5, 7 },
}

local function now()
  return os.time(os.date("!*t"))
end

local function connected_count(state)
  local count = 0
  for _, presence in pairs(state.presences) do
    if presence then
      count = count + 1
    end
  end
  return count
end

local function compact_waiting_players(state)
  if state.status ~= "waiting" then
    return
  end

  local next_order = {}
  local next_marks = {}
  for _, player in ipairs(state.player_order) do
    if state.presences[player.user_id] then
      table.insert(next_order, {
        user_id = player.user_id,
        username = player.username,
      })
    end
  end

  for index, player in ipairs(next_order) do
    next_marks[player.user_id] = index == 1 and "X" or "O"
  end

  state.player_order = next_order
  state.marks = next_marks
  if #state.player_order == 0 then
    state.current_turn = "X"
  else
    state.current_turn = state.marks[state.player_order[1].user_id] or "X"
  end
end

local function state_username(state, user_id)
  for _, player in ipairs(state.player_order) do
    if player.user_id == user_id then
      return player.username
    end
  end
  return "Player"
end

local function matchup_key(state)
  if #state.player_order < 2 then
    return nil
  end

  local ids = {
    state.player_order[1].user_id,
    state.player_order[2].user_id,
  }
  table.sort(ids)
  return ids[1] .. ":" .. ids[2]
end

local function read_storage_object(collection, key, user_id, fallback)
  local objects = nk.storage_read({
    {
      collection = collection,
      key = key,
      user_id = user_id,
    }
  })

  local object = objects[1]
  if object and object.value then
    return object.value
  end

  return fallback
end

local function read_matchup_stats(state)
  local key = matchup_key(state)
  if not key then
    return nil
  end

  return read_storage_object(STATS_COLLECTION, key, SYSTEM_USER_ID, {
    total_games = 0,
    draws = 0,
    players = {},
  })
end

local function write_matchup_stats(key, stats)
  nk.storage_write({
    {
      collection = STATS_COLLECTION,
      key = key,
      user_id = SYSTEM_USER_ID,
      value = stats,
      permission_read = 0,
      permission_write = 0,
    }
  })
end

local function read_player_stats(user_id)
  return read_storage_object(PLAYER_STATS_COLLECTION, "global", user_id, {
    wins = 0,
    losses = 0,
    draws = 0,
    games_played = 0,
    current_streak = 0,
    best_streak = 0,
    username = "",
  })
end

local function write_player_stats(user_id, stats)
  nk.storage_write({
    {
      collection = PLAYER_STATS_COLLECTION,
      key = "global",
      user_id = user_id,
      value = stats,
      permission_read = 2,
      permission_write = 0,
    }
  })
end

local function read_global_rankings()
  return read_storage_object(GLOBAL_LEADERBOARD_COLLECTION, GLOBAL_LEADERBOARD_KEY, SYSTEM_USER_ID, {
    players = {},
  })
end

local function write_global_rankings(rankings)
  nk.storage_write({
    {
      collection = GLOBAL_LEADERBOARD_COLLECTION,
      key = GLOBAL_LEADERBOARD_KEY,
      user_id = SYSTEM_USER_ID,
      value = rankings,
      permission_read = 2,
      permission_write = 0,
    }
  })
end

local function sync_global_entry(user_id, username, stats)
  local rankings = read_global_rankings()
  rankings.players = rankings.players or {}
  rankings.players[user_id] = {
    username = username,
    wins = stats.wins or 0,
    losses = stats.losses or 0,
    draws = stats.draws or 0,
    games_played = stats.games_played or 0,
    current_streak = stats.current_streak or 0,
    best_streak = stats.best_streak or 0,
  }
  write_global_rankings(rankings)
end

local function leaderboard_from_stats(state, stats)
  if not stats or #state.player_order < 2 then
    return nil
  end

  local players = {}
  for _, player in ipairs(state.player_order) do
    local entry = stats.players[player.user_id] or { wins = 0, losses = 0 }
    table.insert(players, {
      userId = player.user_id,
      username = player.username,
      wins = entry.wins or 0,
      losses = entry.losses or 0,
    })
  end

  table.sort(players, function(a, b)
    if a.wins == b.wins then
      return a.username < b.username
    end
    return a.wins > b.wins
  end)

  return {
    totalGames = stats.total_games or 0,
    draws = stats.draws or 0,
    players = players,
  }
end

local function refresh_leaderboard(state)
  local stats = read_matchup_stats(state)
  state.leaderboard = leaderboard_from_stats(state, stats)
end

local function update_global_player_result(user_id, username, result)
  local stats = read_player_stats(user_id)
  stats.username = username or stats.username or "Player"
  stats.games_played = (stats.games_played or 0) + 1

  if result == "win" then
    stats.wins = (stats.wins or 0) + 1
    stats.current_streak = (stats.current_streak or 0) + 1
    stats.best_streak = math.max(stats.best_streak or 0, stats.current_streak)
  elseif result == "loss" then
    stats.losses = (stats.losses or 0) + 1
    stats.current_streak = 0
    stats.best_streak = stats.best_streak or 0
  else
    stats.draws = (stats.draws or 0) + 1
    stats.current_streak = 0
    stats.best_streak = stats.best_streak or 0
  end

  write_player_stats(user_id, stats)
  sync_global_entry(user_id, stats.username, stats)
end

local function record_result(state, winner_mark)
  if state.result_recorded or #state.player_order < 2 then
    return
  end

  local key = matchup_key(state)
  if not key then
    return
  end

  local stats = read_matchup_stats(state) or { total_games = 0, draws = 0, players = {} }
  stats.players = stats.players or {}
  stats.total_games = (stats.total_games or 0) + 1

  for _, player in ipairs(state.player_order) do
    if not stats.players[player.user_id] then
      stats.players[player.user_id] = { wins = 0, losses = 0 }
    end
  end

  if winner_mark then
    local winner_id = nil
    local loser_id = nil
    local winner_name = nil
    local loser_name = nil

    for _, player in ipairs(state.player_order) do
      local mark = state.marks[player.user_id]
      if mark == winner_mark then
        winner_id = player.user_id
        winner_name = player.username
      else
        loser_id = player.user_id
        loser_name = player.username
      end
    end

    if winner_id and stats.players[winner_id] then
      stats.players[winner_id].wins = (stats.players[winner_id].wins or 0) + 1
    end

    if loser_id and stats.players[loser_id] then
      stats.players[loser_id].losses = (stats.players[loser_id].losses or 0) + 1
    end

    if winner_id then
      update_global_player_result(winner_id, winner_name, "win")
    end
    if loser_id then
      update_global_player_result(loser_id, loser_name, "loss")
    end
  else
    stats.draws = (stats.draws or 0) + 1
    for _, player in ipairs(state.player_order) do
      update_global_player_result(player.user_id, player.username, "draw")
    end
  end

  write_matchup_stats(key, stats)
  state.leaderboard = leaderboard_from_stats(state, stats)
  state.result_recorded = true
end

local function build_state_payload(state)
  local players = {}
  for _, player in ipairs(state.player_order) do
    local presence = state.presences[player.user_id]
    table.insert(players, {
      userId = player.user_id,
      username = player.username,
      mark = state.marks[player.user_id],
      connected = presence ~= nil,
    })
  end

  return nk.json_encode({
    board = state.board,
    players = players,
    currentTurn = state.current_turn,
    status = state.status,
    winner = state.winner,
    winningLine = state.winning_line,
    roomName = state.room_name,
    mode = state.mode,
    moveCount = state.move_count,
    turnDeadline = state.turn_deadline,
    lastError = state.last_error,
    ownerId = state.owner_id,
    ownerName = state.owner_name,
    roomCode = state.room_code,
    rematchRequest = state.rematch_request,
    rematchMessage = state.rematch_message,
    leaderboard = state.leaderboard,
  })
end

local function broadcast_state(dispatcher, state)
  dispatcher.broadcast_message(OPCODE_STATE, build_state_payload(state))
end

local function update_label(state)
  return nk.json_encode({
    room_name = state.room_name,
    status = state.status,
    mode = state.mode,
    move_count = state.move_count,
    owner_id = state.owner_id,
    owner_name = state.owner_name,
    connected_count = connected_count(state),
    room_code = state.room_code,
  })
end

local function next_turn(current)
  if current == "X" then
    return "O"
  end
  return "X"
end

local function board_full(board)
  for i = 1, 9 do
    if board[i] == "" then
      return false
    end
  end
  return true
end

local function check_winner(board)
  for _, line in ipairs(WIN_LINES) do
    local a = board[line[1]]
    local b = board[line[2]]
    local c = board[line[3]]
    if a ~= "" and a == b and b == c then
      return a, line
    end
  end
  return nil, nil
end

local function mark_for_presence(state, presence)
  return state.marks[presence.user_id]
end

local function finish_match(state, winner_mark, winning_line)
  state.status = winner_mark and "finished" or "draw"
  state.winner = winner_mark
  state.winning_line = winning_line or {}
  state.turn_deadline = nil
  state.close_at = now() + MATCH_CLOSE_SECONDS
  record_result(state, winner_mark)
end

local function restart_game(state)
  state.board = { "", "", "", "", "", "", "", "", "" }
  state.current_turn = "X"
  state.status = connected_count(state) == 2 and "playing" or "waiting"
  state.winner = nil
  state.winning_line = {}
  state.move_count = 0
  state.last_error = nil
  state.rematch_request = nil
  state.rematch_message = nil
  state.close_at = nil
  state.result_recorded = false
  if state.mode == "timed" and state.status == "playing" then
    state.turn_deadline = now() + TURN_SECONDS
  else
    state.turn_deadline = nil
  end
end

function module.match_init(context, params)
  local mode = params.mode or "classic"
  local room_name = params.room_name or "Grid Clash Arena"

  local state = {
    board = { "", "", "", "", "", "", "", "", "" },
    presences = {},
    player_order = {},
    marks = {},
    current_turn = "X",
    status = "waiting",
    winner = nil,
    winning_line = {},
    mode = mode,
    room_name = room_name,
    room_code = params.room_code,
    move_count = 0,
    turn_deadline = nil,
    last_error = nil,
    close_at = nil,
    owner_id = params.owner_id,
    owner_name = params.owner_name or "Host",
    delete_requested = false,
    rematch_request = nil,
    rematch_message = nil,
    leaderboard = nil,
    result_recorded = false,
  }

  return state, TICK_RATE, update_label(state)
end

function module.match_join_attempt(context, dispatcher, tick, state, presence, metadata)
  compact_waiting_players(state)

  if state.presences[presence.user_id] then
    return state, true
  end

  if #state.player_order >= 2 then
    return state, false, "Match is full."
  end

  return state, true
end

function module.match_join(context, dispatcher, tick, state, presences)
  for _, presence in ipairs(presences) do
    state.presences[presence.user_id] = presence

    local already_known = false
    for _, player in ipairs(state.player_order) do
      if player.user_id == presence.user_id then
        already_known = true
        break
      end
    end

    if not already_known then
      local assigned_mark = (#state.player_order == 0) and "X" or "O"
      state.marks[presence.user_id] = assigned_mark
      table.insert(state.player_order, {
        user_id = presence.user_id,
        username = presence.username,
      })
    end
  end

  if #state.player_order == 2 then
    refresh_leaderboard(state)
  end

  if #state.player_order == 2 and state.status == "waiting" then
    state.status = "playing"
    state.close_at = nil
    if state.mode == "timed" then
      state.turn_deadline = now() + TURN_SECONDS
    end
  end

  state.last_error = nil
  broadcast_state(dispatcher, state)
  return state
end

function module.match_leave(context, dispatcher, tick, state, presences)
  for _, presence in ipairs(presences) do
    state.presences[presence.user_id] = nil
  end

  if state.rematch_request then
    local requester_present = state.presences[state.rematch_request.requesterId] ~= nil
    local target_present = state.presences[state.rematch_request.targetId] ~= nil
    if not requester_present or not target_present then
      state.rematch_request = nil
      state.rematch_message = nil
    end
  end

  if state.status == "waiting" then
    compact_waiting_players(state)
    if #state.player_order == 0 then
      return nil
    end
  elseif state.status == "playing" then
    local live_count = connected_count(state)
    if live_count == 1 then
      local remaining_mark = nil
      for user_id, presence in pairs(state.presences) do
        if presence then
          remaining_mark = state.marks[user_id]
        end
      end
      finish_match(state, remaining_mark, {})
    elseif live_count == 0 then
      state.status = "abandoned"
      state.turn_deadline = nil
      state.close_at = now() + 2
    end
  end

  state.last_error = nil
  broadcast_state(dispatcher, state)
  return state
end

function module.match_signal(context, dispatcher, tick, state, data)
  return ""
end

function module.match_loop(context, dispatcher, tick, state, messages)
  local changed = false

  for _, message in ipairs(messages) do
    if message.op_code == OPCODE_MOVE then
      local ok, body = pcall(nk.json_decode, message.data)
      if not ok or not body then
        state.last_error = "Invalid move payload."
        dispatcher.broadcast_message(OPCODE_ERROR, nk.json_encode({ message = state.last_error }), { message.sender })
      else
        local index = tonumber(body.index)
        local player_mark = mark_for_presence(state, message.sender)

        if state.status ~= "playing" then
          state.last_error = "Match is not accepting moves."
        elseif not player_mark then
          state.last_error = "Player is not registered in this match."
        elseif player_mark ~= state.current_turn then
          state.last_error = "It is not your turn."
        elseif index == nil or index < 0 or index > 8 then
          state.last_error = "Cell index is out of range."
        elseif state.board[index + 1] ~= "" then
          state.last_error = "Cell is already occupied."
        else
          state.last_error = nil
          state.board[index + 1] = player_mark
          state.move_count = state.move_count + 1
          changed = true

          local winner, winning_line = check_winner(state.board)
          if winner then
            finish_match(state, winner, winning_line)
          elseif board_full(state.board) then
            finish_match(state, nil, {})
          else
            state.current_turn = next_turn(state.current_turn)
            if state.mode == "timed" then
              state.turn_deadline = now() + TURN_SECONDS
            end
          end
        end

        if state.last_error then
          dispatcher.broadcast_message(OPCODE_ERROR, nk.json_encode({ message = state.last_error }), { message.sender })
        end
      end
    elseif message.op_code == OPCODE_REMATCH then
      local ok, body = pcall(nk.json_decode, message.data)
      local action = (ok and body and body.action) or "request"
      local sender_id = message.sender.user_id

      if state.status == "finished" or state.status == "draw" then
        if action == "request" then
          local requester_name = state_username(state, sender_id)
          local target_id = nil
          for _, player in ipairs(state.player_order) do
            if player.user_id ~= sender_id then
              target_id = player.user_id
            end
          end
          if target_id then
            state.rematch_request = {
              requesterId = sender_id,
              requesterName = requester_name,
              targetId = target_id,
              status = "pending",
            }
            state.rematch_message = requester_name .. " wants a rematch."
            state.close_at = nil
            changed = true
          end
        elseif action == "accept" and state.rematch_request and state.rematch_request.targetId == sender_id then
          restart_game(state)
          changed = true
        elseif action == "reject" and state.rematch_request and state.rematch_request.targetId == sender_id then
          local rejector_name = state_username(state, sender_id)
          state.rematch_message = rejector_name .. " declined the rematch."
          state.rematch_request = nil
          state.close_at = now() + MATCH_CLOSE_SECONDS
          changed = true
        end
      end
    end
  end

  if state.mode == "timed" and state.status == "playing" and state.turn_deadline and now() >= state.turn_deadline then
    local winner_mark = next_turn(state.current_turn)
    finish_match(state, winner_mark, {})
    changed = true
  end

  if state.delete_requested then
    return nil
  end

  if state.close_at and now() >= state.close_at then
    return nil
  end

  if changed then
    broadcast_state(dispatcher, state)
  end

  return state
end

function module.match_terminate(context, dispatcher, tick, state, grace_seconds)
  state.status = "terminated"
  state.last_error = nil
  broadcast_state(dispatcher, state)
  return state
end

return module
