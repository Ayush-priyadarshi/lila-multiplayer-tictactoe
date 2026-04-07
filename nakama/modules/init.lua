local nk = require("nakama")

local SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"
local DELETED_LOBBY_COLLECTION = "deleted_lobbies"
local ROOM_CODE_COLLECTION = "room_codes"
local GLOBAL_LEADERBOARD_COLLECTION = "global_leaderboard"
local GLOBAL_LEADERBOARD_KEY = "rankings"

local function safe_decode(payload)
  if not payload or payload == "" then
    return {}
  end

  if type(payload) == "table" then
    return payload
  end

  local ok, decoded = pcall(nk.json_decode, payload)
  if not ok or decoded == nil then
    return {}
  end

  if type(decoded) == "table" then
    return decoded
  end

  if type(decoded) == "string" then
    local ok_again, decoded_again = pcall(nk.json_decode, decoded)
    if ok_again and type(decoded_again) == "table" then
      return decoded_again
    end
  end

  return {}
end

local function normalize_room_code(value)
  if not value then
    return ""
  end

  return string.upper((string.gsub(tostring(value), "[^%w]", "")))
end

local function generate_room_code(match_id)
  local base = normalize_room_code(match_id)
  if #base >= 8 then
    return string.sub(base, 1, 8)
  end
  return base
end

local function read_deleted_lobby_map(match_ids)
  if #match_ids == 0 then
    return {}
  end

  local read_batch = {}
  for _, match_id in ipairs(match_ids) do
    table.insert(read_batch, {
      collection = DELETED_LOBBY_COLLECTION,
      key = match_id,
      user_id = SYSTEM_USER_ID,
    })
  end

  local objects = nk.storage_read(read_batch)
  local deleted = {}
  for _, object in ipairs(objects) do
    if object and object.key and object.value and object.value.deleted then
      deleted[object.key] = true
    end
  end

  return deleted
end

local function write_room_code(room_code, match_id)
  nk.storage_write({
    {
      collection = ROOM_CODE_COLLECTION,
      key = room_code,
      user_id = SYSTEM_USER_ID,
      value = {
        match_id = match_id,
        room_code = room_code,
        updated_at = os.time(),
      },
      permission_read = 0,
      permission_write = 0,
    }
  })
end

local function read_room_code(room_code)
  local objects = nk.storage_read({
    {
      collection = ROOM_CODE_COLLECTION,
      key = room_code,
      user_id = SYSTEM_USER_ID,
    }
  })

  local object = objects[1]
  if object and object.value and object.value.match_id then
    return object.value.match_id
  end

  return nil
end

local function mark_lobby_deleted(match_id, deleted_by)
  nk.storage_write({
    {
      collection = DELETED_LOBBY_COLLECTION,
      key = match_id,
      user_id = SYSTEM_USER_ID,
      value = {
        deleted = true,
        deleted_by = deleted_by,
        deleted_at = os.time(),
      },
      permission_read = 0,
      permission_write = 0,
    }
  })
end

local function read_global_rankings()
  local objects = nk.storage_read({
    {
      collection = GLOBAL_LEADERBOARD_COLLECTION,
      key = GLOBAL_LEADERBOARD_KEY,
      user_id = SYSTEM_USER_ID,
    }
  })

  local object = objects[1]
  if object and object.value and type(object.value.players) == "table" then
    return object.value.players
  end

  return {}
end

local function rpc_list_global_leaderboard(context, payload)
  local body = safe_decode(payload)
  local limit = tonumber(body.limit or 10) or 10
  local rankings = read_global_rankings()
  local players = {}

  for user_id, stats in pairs(rankings) do
    table.insert(players, {
      userId = user_id,
      username = stats.username or "Player",
      wins = tonumber(stats.wins or 0),
      losses = tonumber(stats.losses or 0),
      draws = tonumber(stats.draws or 0),
      gamesPlayed = tonumber(stats.games_played or 0),
      currentStreak = tonumber(stats.current_streak or 0),
      bestStreak = tonumber(stats.best_streak or 0),
    })
  end

  table.sort(players, function(a, b)
    if a.wins ~= b.wins then
      return a.wins > b.wins
    end
    if a.bestStreak ~= b.bestStreak then
      return a.bestStreak > b.bestStreak
    end
    if a.currentStreak ~= b.currentStreak then
      return a.currentStreak > b.currentStreak
    end
    if a.losses ~= b.losses then
      return a.losses < b.losses
    end
    return a.username < b.username
  end)

  local top_players = {}
  for index = 1, math.min(limit, #players) do
    local player = players[index]
    player.rank = index
    table.insert(top_players, player)
  end

  return nk.json_encode({ players = top_players })
end

local function rpc_list_matches(context, payload)
  local body = safe_decode(payload)
  local limit = tonumber(body.limit or 20)
  local matches = nk.match_list(limit, true, "", 0, 2, "")
  local rooms = {}
  local match_ids = {}

  for _, match in ipairs(matches) do
    table.insert(match_ids, match.match_id)
  end

  local deleted_lobbies = read_deleted_lobby_map(match_ids)

  for _, match in ipairs(matches) do
    if not deleted_lobbies[match.match_id] then
      local label = {}
      if match.label and match.label ~= "" then
        local ok, decoded = pcall(nk.json_decode, match.label)
        if ok and decoded then
          label = decoded
        end
      end

      if label.status == "waiting" then
        table.insert(rooms, {
          matchId = match.match_id,
          size = tonumber(label.connected_count or match.size or 0),
          roomName = label.room_name or "Open Match",
          mode = label.mode or "classic",
          status = label.status,
          ownerId = label.owner_id,
          ownerName = label.owner_name,
          roomCode = label.room_code,
        })
      end
    end
  end

  return nk.json_encode({ matches = rooms })
end

local function rpc_create_match(context, payload)
  local body = safe_decode(payload)
  local mode = body.mode or "classic"
  local room_name = body.room_name or "Grid Clash Arena"
  local owner_name = body.owner_name or context.username or "Host"
  local room_code = generate_room_code(tostring(os.time()) .. room_name .. context.user_id)
  local match_id = nk.match_create("tictactoe", {
    mode = mode,
    room_name = room_name,
    source = "manual",
    owner_id = context.user_id,
    owner_name = owner_name,
    room_code = room_code,
  })

  pcall(function()
    write_room_code(room_code, match_id)
  end)

  return nk.json_encode({ matchId = match_id, roomCode = room_code })
end

local function rpc_resolve_match_code(context, payload)
  local body = safe_decode(payload)
  local code = normalize_room_code(body.code)
  if code == "" then
    error("Room code is required")
  end

  local match_id = read_room_code(code)
  if not match_id then
    error("Match not found")
  end

  return nk.json_encode({ matchId = match_id, roomCode = code })
end

local function rpc_delete_match(context, payload)
  local body = safe_decode(payload)
  local match_id = body.matchId
  if not match_id or match_id == "" then
    error("matchId is required")
  end

  mark_lobby_deleted(match_id, context.user_id)
  return nk.json_encode({ ok = true })
end

local function matchmaker_matched(context, entries)
  local mode = "classic"
  local room_name = "Auto Match"

  for _, entry in ipairs(entries) do
    if entry.properties then
      if entry.properties.mode then
        mode = entry.properties.mode
      end
      if entry.properties.room_name then
        room_name = entry.properties.room_name
      end
    end
  end

  local room_code = generate_room_code(room_name .. tostring(os.time()))
  local match_id = nk.match_create("tictactoe", {
    mode = mode,
    room_name = room_name,
    source = "matchmaker",
    owner_id = "matchmaker",
    owner_name = "Auto Match",
    room_code = room_code,
  })

  pcall(function()
    write_room_code(room_code, match_id)
  end)

  return match_id
end

nk.register_rpc(rpc_list_matches, "list_matches")
nk.register_rpc(rpc_list_global_leaderboard, "list_global_leaderboard")
nk.register_rpc(rpc_create_match, "create_match")
nk.register_rpc(rpc_resolve_match_code, "resolve_match_code")
nk.register_rpc(rpc_delete_match, "delete_match")
nk.register_matchmaker_matched(matchmaker_matched)
