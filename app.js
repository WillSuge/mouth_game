const STORAGE_KEY = "mouth-tracker";
const DEFAULT_ELO = 1000;
const CUP_LAYOUT = [1, 4, 3, 2, 1];
const SUPABASE_URL = "PASTE_SUPABASE_URL_HERE";
const SUPABASE_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";
const REMOTE_ENABLED =
  SUPABASE_URL !== "PASTE_SUPABASE_URL_HERE" &&
  SUPABASE_KEY !== "PASTE_SUPABASE_ANON_KEY_HERE";

const screens = Array.from(document.querySelectorAll(".screen"));
const navButtons = document.querySelectorAll(".nav-btn");
const homeStart = document.getElementById("home-start");
const homeStats = document.getElementById("home-stats");

const teamASelectLeft = document.getElementById("team-a-left");
const teamASelectRight = document.getElementById("team-a-right");
const teamBSelectLeft = document.getElementById("team-b-left");
const teamBSelectRight = document.getElementById("team-b-right");
const startGameButton = document.getElementById("start-game");
const cancelNewGameButton = document.getElementById("new-game-cancel");

const gameMeta = document.getElementById("game-meta");
const playerActions = document.getElementById("player-actions");
const gameStatus = document.getElementById("game-status");
const finishGameButton = document.getElementById("finish-game");
const undoButton = document.getElementById("undo-btn");
const redoButton = document.getElementById("redo-btn");
const swapAButton = document.getElementById("swap-a");
const swapBButton = document.getElementById("swap-b");

const teamACups = document.querySelector("#team-a-cups .cup-grid");
const teamBCups = document.querySelector("#team-b-cups .cup-grid");
const cupActions = document.getElementById("cup-actions");
const cupPlayerButtons = document.getElementById("cup-player-buttons");
const mentalSubaction = document.getElementById("mental-subaction");

const playerNameInput = document.getElementById("player-name");
const addPlayerButton = document.getElementById("add-player");
const resetStatsButton = document.getElementById("reset-stats");
const playerList = document.getElementById("player-list");
const gameHistory = document.getElementById("game-history");

let state = { players: [], games: [] };
let currentGame = null;
let historyStack = [];
let redoStack = [];
let cupActionTarget = null;
let cupActionPlayer = "";
let cupActionType = "";
let mentalResultType = "";
let supabaseClient = null;

function initSupabase() {
  if (!REMOTE_ENABLED || !window.supabase) return null;
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { players: [], games: [] };
  }
  try {
    const parsed = JSON.parse(saved);
    normalizeState(parsed);
    return parsed;
  } catch (error) {
    return { players: [], games: [] };
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadRemoteState() {
  if (!supabaseClient) return { players: [], games: [] };
  const { data: playersData, error: playersError } = await supabaseClient
    .from("players")
    .select("*")
    .order("name");
  if (playersError) {
    console.error(playersError);
  }
  const { data: gamesData, error: gamesError } = await supabaseClient
    .from("games")
    .select("*")
    .order("played_at", { ascending: false })
    .limit(50);
  if (gamesError) {
    console.error(gamesError);
  }
  const nextState = {
    players: (playersData || []).map(mapDbPlayer),
    games: (gamesData || []).map(mapDbGame),
  };
  normalizeState(nextState);
  return nextState;
}

async function saveRemotePlayers(players) {
  if (!supabaseClient) return;
  const updates = players.map((player) => mapPlayerToDb(player));
  const { error } = await supabaseClient.from("players").upsert(updates);
  if (error) {
    console.error(error);
  }
}

async function insertRemoteGame(game) {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("games").insert(mapGameToDb(game));
  if (error) {
    console.error(error);
  }
}

async function resetRemoteState() {
  if (!supabaseClient) return;
  await supabaseClient.from("games").delete().neq("id", "");
  await supabaseClient.from("players").delete().neq("id", "");
}

function normalizeState(nextState) {
  if (!nextState.players) nextState.players = [];
  if (!nextState.games) nextState.games = [];
  nextState.players.forEach((player) => {
    if (!player.stats) player.stats = {};
    const stats = player.stats;
    stats.games ||= 0;
    stats.wins ||= 0;
    stats.cups ||= 0;
    stats.saves ||= 0;
    stats.aces ||= 0;
    stats.mentalErrors ||= 0;
    stats.left ||= {};
    stats.right ||= {};
    ["left", "right"].forEach((side) => {
      stats[side].games ||= 0;
      stats[side].wins ||= 0;
      stats[side].cups ||= 0;
      stats[side].saves ||= 0;
      stats[side].aces ||= 0;
      stats[side].mentalErrors ||= 0;
    });
    if (typeof player.leftElo !== "number") player.leftElo = player.elo || DEFAULT_ELO;
    if (typeof player.rightElo !== "number") player.rightElo = player.elo || DEFAULT_ELO;
  });
}

function mapDbPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    elo: row.elo,
    leftElo: row.left_elo,
    rightElo: row.right_elo,
    stats: {
      games: row.games,
      wins: row.wins,
      cups: Number(row.cups),
      saves: row.saves,
      aces: row.aces,
      mentalErrors: row.mental_errors,
      left: row.left_stats || {
        games: 0,
        wins: 0,
        cups: 0,
        saves: 0,
        aces: 0,
        mentalErrors: 0,
      },
      right: row.right_stats || {
        games: 0,
        wins: 0,
        cups: 0,
        saves: 0,
        aces: 0,
        mentalErrors: 0,
      },
    },
  };
}

function mapPlayerToDb(player) {
  return {
    id: player.id,
    name: player.name,
    elo: player.elo,
    left_elo: player.leftElo,
    right_elo: player.rightElo,
    games: player.stats.games,
    wins: player.stats.wins,
    cups: player.stats.cups,
    saves: player.stats.saves,
    aces: player.stats.aces,
    mental_errors: player.stats.mentalErrors,
    left_stats: player.stats.left,
    right_stats: player.stats.right,
  };
}

function mapDbGame(row) {
  return {
    id: row.id,
    date: row.played_at,
    teams: {
      A: { leftId: row.team_a_left, rightId: row.team_a_right },
      B: { leftId: row.team_b_left, rightId: row.team_b_right },
    },
    winner: row.winner,
    cupsLeft: row.cups_left,
    playerStats: row.player_stats,
  };
}

function mapGameToDb(game) {
  return {
    id: game.id,
    played_at: game.date,
    winner: game.winner,
    cups_left: game.cupsLeft,
    team_a_left: game.teams.A.leftId,
    team_a_right: game.teams.A.rightId,
    team_b_left: game.teams.B.leftId,
    team_b_right: game.teams.B.rightId,
    player_stats: game.playerStats,
  };
}

function setScreen(screenId) {
  screens.forEach((screen) => {
    screen.classList.toggle("active", screen.id === screenId);
  });
}

function createPlayer(name) {
  const id = crypto.randomUUID();
  return {
    id,
    name: name.trim(),
    elo: DEFAULT_ELO,
    leftElo: DEFAULT_ELO,
    rightElo: DEFAULT_ELO,
    stats: {
      games: 0,
      wins: 0,
      cups: 0,
      saves: 0,
      aces: 0,
      mentalErrors: 0,
      left: { games: 0, wins: 0, cups: 0, saves: 0, aces: 0, mentalErrors: 0 },
      right: { games: 0, wins: 0, cups: 0, saves: 0, aces: 0, mentalErrors: 0 },
    },
  };
}

function getPlayerById(id) {
  return state.players.find((player) => player.id === id);
}

function renderPlayerOptions() {
  const options = state.players.map(
    (player) => `<option value="${player.id}">${player.name}</option>`
  );
  const placeholder = '<option value="">Select player</option>';
  [teamASelectLeft, teamASelectRight, teamBSelectLeft, teamBSelectRight].forEach(
    (select) => {
      select.innerHTML = placeholder + options.join("");
    }
  );
}

function initCupGrid(container, teamKey) {
  container.innerHTML = "";
  CUP_LAYOUT.forEach((rowCount, rowIndex) => {
    const row = document.createElement("div");
    row.className = "cup-row";
    row.style.gridTemplateColumns = `repeat(${rowCount}, 38px)`;
    for (let i = 0; i < rowCount; i += 1) {
      const cup = document.createElement("div");
      const cupIndex = CUP_LAYOUT.slice(0, rowIndex).reduce((a, b) => a + b, 0) + i;
      cup.className = "cup full";
      cup.dataset.team = teamKey;
      cup.dataset.index = cupIndex.toString();
      cup.addEventListener("click", () => handleCupClick(cup));
      row.appendChild(cup);
    }
    container.appendChild(row);
  });
}

function resetCups() {
  currentGame.cups = {
    A: Array(11).fill("full"),
    B: Array(11).fill("full"),
  };
  renderCups();
}

function renderCups() {
  [teamACups, teamBCups].forEach((grid) => {
    grid.querySelectorAll(".cup").forEach((cup) => {
      const teamKey = cup.dataset.team;
      const index = Number(cup.dataset.index);
      const status = currentGame.cups[teamKey][index];
      cup.classList.remove("half", "gone");
      if (status === "half") {
        cup.classList.add("half");
      }
      if (status === "gone") {
        cup.classList.add("gone");
      }
    });
  });
  updateGameStatus();
}

function handleCupClick(cup) {
  if (!currentGame || currentGame.status !== "in_progress") {
    return;
  }
  const teamKey = cup.dataset.team;
  const index = Number(cup.dataset.index);
  const status = currentGame.cups[teamKey][index];
  if (status === "gone") {
    return;
  }
  cupActionTarget = { teamKey, index };
  renderCupAttribution();
  cupActions.classList.remove("hidden");
}

function applyCupAction(action, playerId, overrideAction = "") {
  if (!cupActionTarget || !currentGame || !playerId) {
    return;
  }
  const actionToApply = overrideAction || action;
  recordHistory();
  const { teamKey, index } = cupActionTarget;
  const current = currentGame.cups[teamKey][index];
  if (actionToApply === "sink") {
    currentGame.cups[teamKey][index] = "gone";
  }
  if (actionToApply === "half") {
    if (current === "full") {
      currentGame.cups[teamKey][index] = "half";
      if (action !== "mental") {
        currentGame.playerStats[playerId].cups += 0.5;
      }
    } else {
      currentGame.cups[teamKey][index] = "gone";
      if (action !== "mental") {
        currentGame.playerStats[playerId].cups += 0.5;
      }
    }
  }
  if (actionToApply === "sink" && action !== "mental") {
    currentGame.playerStats[playerId].cups += current === "half" ? 0.5 : 1;
  }
  if (action === "mental") {
    currentGame.playerStats[playerId].mentalErrors += 1;
  }
  cupActionTarget = null;
  cupActionPlayer = "";
  cupActionType = "";
  mentalResultType = "";
  cupActions.classList.add("hidden");
  renderCups();
  renderPlayerActions();
}

function updateGameStatus() {
  if (!currentGame) {
    gameStatus.textContent = "No game loaded.";
    return;
  }
  const cupsA = currentGame.cups.A.filter((cup) => cup !== "gone").length;
  const cupsB = currentGame.cups.B.filter((cup) => cup !== "gone").length;
  const winner =
    cupsA === 0 ? "Team B" : cupsB === 0 ? "Team A" : null;
  const statusLines = [
    `Team A cups left: ${cupsA}`,
    `Team B cups left: ${cupsB}`,
  ];
  if (winner) {
    statusLines.push(`${winner} wins`);
    finishGameButton.disabled = false;
  } else {
    finishGameButton.disabled = true;
  }
  gameStatus.innerHTML = statusLines.map((line) => `<div>${line}</div>`).join("");
}

function renderGameMeta() {
  if (!currentGame) {
    gameMeta.textContent = "";
    return;
  }
  const teamA = currentGame.teams.A;
  const teamB = currentGame.teams.B;
  const aLeft = getPlayerById(teamA.leftId)?.name || "Unknown";
  const aRight = getPlayerById(teamA.rightId)?.name || "Unknown";
  const bLeft = getPlayerById(teamB.leftId)?.name || "Unknown";
  const bRight = getPlayerById(teamB.rightId)?.name || "Unknown";
  gameMeta.innerHTML = `
    <div>Team A: ${aLeft} (L) + ${aRight} (R)</div>
    <div>Team B: ${bLeft} (L) + ${bRight} (R)</div>
  `;
}

function initPlayerStats() {
  currentGame.playerStats = {};
  Object.values(currentGame.teams).forEach((team) => {
    [team.leftId, team.rightId].forEach((playerId) => {
      currentGame.playerStats[playerId] = {
        cups: 0,
        saves: 0,
        aces: 0,
        mentalErrors: 0,
      };
    });
  });
}

function renderPlayerActions() {
  if (!currentGame) {
    playerActions.textContent = "";
    return;
  }
  playerActions.innerHTML = "";
  const players = Object.values(currentGame.teams)
    .flatMap((team) => [team.leftId, team.rightId])
    .map((id) => getPlayerById(id))
    .filter(Boolean);

  players.forEach((player) => {
    const stats = currentGame.playerStats[player.id];
    const container = document.createElement("div");
    container.className = "player-card";
    container.innerHTML = `
      <h4>${player.name}</h4>
      <div class="stat-line">Cups: ${stats.cups.toFixed(1)}</div>
      <div class="stat-line">Saves: ${stats.saves}</div>
      <div class="stat-line">Aces: ${stats.aces}</div>
      <div class="stat-line">Mental Errors: ${stats.mentalErrors || 0}</div>
      <div class="actions player-actions">
        <div>
          <button data-action="save">+Save</button>
          <button data-action="save-undo">-Save</button>
          <button data-action="ace">+Ace</button>
          <button data-action="ace-undo">-Ace</button>
        </div>
      </div>
    `;
    container.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        applyPlayerAction(player.id, button.dataset.action);
      });
    });
    playerActions.appendChild(container);
  });
}

function renderCupAttribution() {
  if (!currentGame) {
    cupPlayerButtons.innerHTML = "";
    return;
  }
  cupPlayerButtons.innerHTML = "";
  cupActionPlayer = "";
  cupActionType = "";
  mentalResultType = "";
  mentalSubaction.classList.add("hidden");
}

function updateCupPlayerOptions(actionType) {
  if (!currentGame || !cupActionTarget) return;
  const targetTeam = cupActionTarget.teamKey;
  const eligibleTeam = actionType === "mental" ? targetTeam : targetTeam === "A" ? "B" : "A";
  const team = currentGame.teams[eligibleTeam];
  const players = [team.leftId, team.rightId]
    .map((id) => getPlayerById(id))
    .filter(Boolean);
  cupPlayerButtons.innerHTML = "";
  players.forEach((player) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = player.name;
    button.addEventListener("click", () => {
      cupActionPlayer = player.id;
      if (cupActionType === "mental") {
        if (!mentalResultType) return;
        applyCupAction("mental", cupActionPlayer, mentalResultType);
      } else {
        applyCupAction(cupActionType, cupActionPlayer);
      }
    });
    cupPlayerButtons.appendChild(button);
  });
  mentalSubaction.classList.toggle("hidden", actionType !== "mental");
}

function applyPlayerAction(playerId, action) {
  const stats = currentGame.playerStats[playerId];
  if (!stats) {
    return;
  }
  recordHistory();
  if (action === "save") stats.saves += 1;
  if (action === "save-undo") stats.saves = Math.max(0, stats.saves - 1);
  if (action === "ace") stats.aces += 1;
  if (action === "ace-undo") stats.aces = Math.max(0, stats.aces - 1);
  renderPlayerActions();
}

function recordHistory() {
  if (!currentGame) return;
  historyStack.push(JSON.stringify(currentGame));
  if (historyStack.length > 100) historyStack.shift();
  redoStack = [];
  undoButton.disabled = historyStack.length === 0;
  redoButton.disabled = true;
}

function undo() {
  if (historyStack.length === 0) return;
  redoStack.push(JSON.stringify(currentGame));
  const previous = historyStack.pop();
  currentGame = JSON.parse(previous);
  refreshGameUI();
}

function redo() {
  if (redoStack.length === 0) return;
  historyStack.push(JSON.stringify(currentGame));
  const next = redoStack.pop();
  currentGame = JSON.parse(next);
  refreshGameUI();
}

function refreshGameUI() {
  renderCups();
  renderGameMeta();
  renderPlayerActions();
  updateGameStatus();
  undoButton.disabled = historyStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function swapTeam(teamKey) {
  if (!currentGame) return;
  recordHistory();
  const team = currentGame.teams[teamKey];
  const oldLeft = team.leftId;
  team.leftId = team.rightId;
  team.rightId = oldLeft;
  currentGame.roles[team.leftId] = "left";
  currentGame.roles[team.rightId] = "right";
  renderGameMeta();
  renderPlayerActions();
}

function startNewGame() {
  const selections = [
    teamASelectLeft.value,
    teamASelectRight.value,
    teamBSelectLeft.value,
    teamBSelectRight.value,
  ];
  const unique = new Set(selections.filter(Boolean));
  if (unique.size !== 4) {
    alert("Select four different players for the game.");
    return;
  }
  currentGame = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    status: "in_progress",
    teams: {
      A: { leftId: teamASelectLeft.value, rightId: teamASelectRight.value },
      B: { leftId: teamBSelectLeft.value, rightId: teamBSelectRight.value },
    },
    roles: {},
    playerStats: {},
    cups: { A: [], B: [] },
  };
  currentGame.roles[currentGame.teams.A.leftId] = "left";
  currentGame.roles[currentGame.teams.A.rightId] = "right";
  currentGame.roles[currentGame.teams.B.leftId] = "left";
  currentGame.roles[currentGame.teams.B.rightId] = "right";
  initPlayerStats();
  resetCups();
  historyStack = [];
  redoStack = [];
  undoButton.disabled = true;
  redoButton.disabled = true;
  renderGameMeta();
  renderPlayerActions();
  renderCupAttribution();
  updateGameStatus();
  setScreen("game");
}

function computeTeamElo(teamKey) {
  const team = currentGame.teams[teamKey];
  const leftPlayer = getPlayerById(team.leftId);
  const rightPlayer = getPlayerById(team.rightId);
  const leftElo = currentGame.roles[team.leftId] === "left" ? leftPlayer.leftElo : leftPlayer.rightElo;
  const rightElo = currentGame.roles[team.rightId] === "right" ? rightPlayer.rightElo : rightPlayer.leftElo;
  return (leftElo + rightElo) / 2;
}

function applyGameResults() {
  const cupsLeftA = currentGame.cups.A.filter((cup) => cup !== "gone").length;
  const cupsLeftB = currentGame.cups.B.filter((cup) => cup !== "gone").length;
  const winnerKey = cupsLeftA === 0 ? "B" : "A";
  const winnerCups = winnerKey === "A" ? cupsLeftA : cupsLeftB;

  const teamAElo = computeTeamElo("A");
  const teamBElo = computeTeamElo("B");
  const expectedA = 1 / (1 + 10 ** ((teamBElo - teamAElo) / 400));
  const expectedB = 1 - expectedA;
  const resultA = winnerKey === "A" ? 1 : 0;
  const resultB = 1 - resultA;
  const baseK = 32;

  const teamAPlayers = [currentGame.teams.A.leftId, currentGame.teams.A.rightId];
  const teamBPlayers = [currentGame.teams.B.leftId, currentGame.teams.B.rightId];

  updateTeamPlayers(teamAPlayers, resultA, expectedA, baseK);
  updateTeamPlayers(teamBPlayers, resultB, expectedB, baseK);

  state.games.unshift({
    id: currentGame.id,
    date: new Date().toISOString(),
    teams: currentGame.teams,
    winner: winnerKey,
    cupsLeft: winnerCups,
    playerStats: currentGame.playerStats,
  });
  const finalize = async () => {
    if (supabaseClient) {
      await saveRemotePlayers(state.players);
      await insertRemoteGame(state.games[0]);
    } else {
      saveLocalState();
    }
    renderStats();
  };
  void finalize();
}

function updateTeamPlayers(playerIds, result, expected, baseK) {
  const performances = playerIds.map((id) => {
    const stats = currentGame.playerStats[id];
    return stats.cups + stats.saves * 0.5 + stats.aces * 0.25;
  });
  const weightTotal = performances.reduce((sum, value) => sum + value + 1, 0);

  playerIds.forEach((playerId, index) => {
    const player = getPlayerById(playerId);
    const role = currentGame.roles[playerId];
    const perfWeight = (performances[index] + 1) / weightTotal;
    const delta = baseK * (result - expected) * (0.8 + perfWeight);

    player.elo = Math.round(player.elo + delta);
    if (role === "left") {
      player.leftElo = Math.round(player.leftElo + delta);
    } else {
      player.rightElo = Math.round(player.rightElo + delta);
    }

    player.stats.games += 1;
    player.stats.cups += currentGame.playerStats[playerId].cups;
    player.stats.saves += currentGame.playerStats[playerId].saves;
    player.stats.aces += currentGame.playerStats[playerId].aces;
    player.stats.mentalErrors += currentGame.playerStats[playerId].mentalErrors;
    if (result === 1) {
      player.stats.wins += 1;
    }
    const sideStats = role === "left" ? player.stats.left : player.stats.right;
    sideStats.games += 1;
    sideStats.cups += currentGame.playerStats[playerId].cups;
    sideStats.saves += currentGame.playerStats[playerId].saves;
    sideStats.aces += currentGame.playerStats[playerId].aces;
    sideStats.mentalErrors += currentGame.playerStats[playerId].mentalErrors;
    if (result === 1) {
      sideStats.wins += 1;
    }
  });
}

function renderStats() {
  renderPlayerOptions();
  playerList.innerHTML = "";
  state.players.forEach((player) => {
    const leftGames = player.stats.left.games || 0;
    const rightGames = player.stats.right.games || 0;
    const leftWinRate = leftGames ? ((player.stats.left.wins / leftGames) * 100).toFixed(1) : "0.0";
    const rightWinRate = rightGames ? ((player.stats.right.wins / rightGames) * 100).toFixed(1) : "0.0";
    const cupsPerGame = player.stats.games
      ? (player.stats.cups / player.stats.games).toFixed(2)
      : "0.00";
    const savesPerGame = player.stats.games
      ? (player.stats.saves / player.stats.games).toFixed(2)
      : "0.00";
    const acesPerGame = player.stats.games
      ? (player.stats.aces / player.stats.games).toFixed(2)
      : "0.00";
    const errorsPerGame = player.stats.games
      ? ((player.stats.mentalErrors || 0) / player.stats.games).toFixed(2)
      : "0.00";
    const card = document.createElement("div");
    card.className = "player-card";
    card.innerHTML = `
      <h4>${player.name}</h4>
      <div class="stat-line">ELO: ${player.elo} (L ${player.leftElo} / R ${player.rightElo})</div>
      <div class="stat-line">Games: ${player.stats.games} · Wins: ${player.stats.wins}</div>
      <div class="stat-line">Cups/Game: ${cupsPerGame} · Saves/Game: ${savesPerGame} · Aces/Game: ${acesPerGame}</div>
      <div class="stat-line">Mental Errors/Game: ${errorsPerGame}</div>
      <div class="stat-line">Left Win%: ${leftWinRate} · Right Win%: ${rightWinRate}</div>
    `;
    playerList.appendChild(card);
  });

  gameHistory.innerHTML = state.games
    .slice(0, 20)
    .map((game) => {
      const teamALeft = getPlayerById(game.teams.A.leftId)?.name || "Unknown";
      const teamARight = getPlayerById(game.teams.A.rightId)?.name || "Unknown";
      const teamBLeft = getPlayerById(game.teams.B.leftId)?.name || "Unknown";
      const teamBRight = getPlayerById(game.teams.B.rightId)?.name || "Unknown";
      return `
        <div class="game-history-item">
          ${new Date(game.date).toLocaleString()} · Winner: Team ${game.winner} · Cups left: ${game.cupsLeft}
          <div>Team A: ${teamALeft} (L) + ${teamARight} (R)</div>
          <div>Team B: ${teamBLeft} (L) + ${teamBRight} (R)</div>
        </div>
      `;
    })
    .join("");
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setScreen(button.dataset.screen);
  });
});

homeStart.addEventListener("click", () => setScreen("new-game"));
homeStats.addEventListener("click", () => setScreen("stats"));

addPlayerButton.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  if (!name) return;
  const player = createPlayer(name);
  const finalize = async () => {
    state.players.push(player);
    if (supabaseClient) {
      await saveRemotePlayers([player]);
    } else {
      saveLocalState();
    }
    playerNameInput.value = "";
    renderStats();
  };
  void finalize();
});

resetStatsButton.addEventListener("click", () => {
  const confirmFirst = confirm(
    "This will delete all players, games, and stats. Continue?"
  );
  if (!confirmFirst) return;
  const confirmSecond = confirm("Are you absolutely sure? This cannot be undone.");
  if (!confirmSecond) return;
  const finalize = async () => {
    state = { players: [], games: [] };
    currentGame = null;
    if (supabaseClient) {
      await resetRemoteState();
    } else {
      saveLocalState();
    }
    renderStats();
    setScreen("home");
  };
  void finalize();
});

startGameButton.addEventListener("click", startNewGame);
cancelNewGameButton.addEventListener("click", () => setScreen("home"));

cupActions.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  if (action === "cancel") {
    cupActionTarget = null;
    cupActionPlayer = "";
    cupActionType = "";
    mentalResultType = "";
    cupActions.classList.add("hidden");
    return;
  }
  if (!cupActionTarget) return;
  cupActionType = action;
  cupActionPlayer = "";
  mentalResultType = "";
  updateCupPlayerOptions(action);
});

mentalSubaction.addEventListener("click", (event) => {
  const action = event.target.dataset.mental;
  if (!action) return;
  mentalResultType = action;
  if (cupActionPlayer) {
    applyCupAction("mental", cupActionPlayer, mentalResultType);
  }
});

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
swapAButton.addEventListener("click", () => swapTeam("A"));
swapBButton.addEventListener("click", () => swapTeam("B"));

finishGameButton.addEventListener("click", () => {
  if (!currentGame) return;
  currentGame.status = "finished";
  applyGameResults();
  currentGame = null;
  setScreen("stats");
});

teamACups.classList.add("rotate-left");
teamBCups.classList.add("rotate-right");
async function initApp() {
  supabaseClient = initSupabase();
  if (supabaseClient) {
    state = await loadRemoteState();
  } else {
    state = loadLocalState();
  }
  renderStats();
  setScreen("home");
}

initCupGrid(teamACups, "A");
initCupGrid(teamBCups, "B");
void initApp();

