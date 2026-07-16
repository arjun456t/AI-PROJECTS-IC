// ═══════════════════════════════════════════════════════════════════════════
// SOLO LEVELING SYSTEM — Personal Life Monitoring App
// Google Apps Script backend — Code.gs
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = 'SoloLevelingDB';
const PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
const PROP_GEMINI_KEY = 'GEMINI_API_KEY';
const GEMINI_MODEL = 'gemini-2.5-flash';

const PLAYER_HEADERS = ['Name','Level','XP','XPToNext','HP','MaxHP','MP','MaxMP','Strength','Intelligence','Agility','Vitality','Sense','Title','TotalQuestsCompleted','StreakCount','DungeonClears','PerfectDays','LastActiveDate','LastBriefingDate'];
const QUESTS_HEADERS = ['ID','Title','Description','Rank','XPReward','StatType','StatAmount','Status','CreatedDate','CompletedDate'];
const DAILYQUESTS_HEADERS = ['ID','Title','StatType','StatAmount','XPReward','Status','Streak','LastCompletedDate'];
const PEOPLE_HEADERS = ['ID','Name','Relation','HowWeMet','PersonalityNotes','Birthday','BehaviorAdvice','CreatedDate'];
const CHATHISTORY_HEADERS = ['ID','Timestamp','Role','Message'];
const ACHIEVEMENTS_HEADERS = ['ID','Name','Description','Icon','Unlocked','UnlockedDate'];

const STAT_KEYS = ['Strength','Intelligence','Agility','Vitality','Sense'];
const RANK_XP = { E: 10, D: 25, C: 50, B: 100, A: 250, S: 500 };
const RANK_STAT = { E: 1, D: 2, C: 3, B: 4, A: 5, S: 7 };

// ── WEB APP ENTRY POINT ──────────────────────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Solo Leveling System')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

// ── ONE-TIME SETUP ────────────────────────────────────────────────────────────
// Do NOT hardcode a real API key here — this file is committed to a public
// GitHub repo, and Google's automated leak scanners will find and revoke any
// key pasted into source. Instead, set the key directly via the Apps Script
// UI: Project Settings (gear icon) > Script Properties > Add script property
// > Property = GEMINI_API_KEY, Value = your key > Save. That value never
// touches git. This function is kept only as a fallback for local use — if
// you use it, paste your key into the RUN dialog / temporarily here on your
// own machine, run it once, then make sure the real key is never committed.
function setupApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_KEY);
  if (key) {
    Logger.log('Gemini API key is already set in Script Properties. Nothing to do.');
    return;
  }
  throw new Error('No GEMINI_API_KEY found. Set it via Project Settings > Script Properties in the Apps Script editor — do not hardcode it in this file.');
}

function initialize() {
  const ss = getOrCreateSpreadsheet();
  setupSheet(ss, 'Player', PLAYER_HEADERS);
  setupSheet(ss, 'Quests', QUESTS_HEADERS);
  setupSheet(ss, 'DailyQuests', DAILYQUESTS_HEADERS);
  setupSheet(ss, 'People', PEOPLE_HEADERS);
  setupSheet(ss, 'ChatHistory', CHATHISTORY_HEADERS);
  setupSheet(ss, 'Achievements', ACHIEVEMENTS_HEADERS);

  seedPlayer(ss);
  seedDailyQuests(ss);
  seedAchievements(ss);

  const def = ss.getSheetByName('Sheet1');
  if (def) ss.deleteSheet(def);

  Logger.log('Database initialized: ' + ss.getUrl());
}

function createTrigger() {
  deleteTriggersFor('resetDailyQuests');
  ScriptApp.newTrigger('resetDailyQuests').timeBased().atHour(0).nearMinute(0).everyDays(1).create();
  Logger.log('Midnight reset trigger created.');
}

function deleteTriggersFor(fnName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

// ── SPREADSHEET HELPERS ───────────────────────────────────────────────────────
function getOrCreateSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PROP_SPREADSHEET_ID);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* fall through */ }
  }
  const files = DriveApp.getFilesByName(DB_NAME);
  if (files.hasNext()) {
    const f = files.next();
    props.setProperty(PROP_SPREADSHEET_ID, f.getId());
    return SpreadsheetApp.openById(f.getId());
  }
  const ss = SpreadsheetApp.create(DB_NAME);
  props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  return ss;
}

function setupSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSheetInfo(name) {
  const ss = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  return { ss: ss, sheet: sheet, headers: headers, idx: idx, rows: values.slice(1) };
}

function formatDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}

// ── SEEDING ────────────────────────────────────────────────────────────────────
function seedPlayer(ss) {
  const sheet = ss.getSheetByName('Player');
  if (sheet.getLastRow() < 2) {
    const today = formatDate(new Date());
    sheet.appendRow(['Player', 1, 0, xpForLevel(1), 100, 100, 50, 50, 1, 1, 1, 1, 1, titleForLevel(1), 0, 0, 0, 0, today, '']);
  }
}

function seedDailyQuests(ss) {
  const sheet = ss.getSheetByName('DailyQuests');
  if (sheet.getLastRow() < 2) {
    const defaults = [
      ['DQ1', 'Study 2 Hours', 'Intelligence', 2, 30, 'Pending', 0, ''],
      ['DQ2', '30 Pushups', 'Strength', 2, 20, 'Pending', 0, ''],
      ['DQ3', 'Aptitude Practice 30 min', 'Intelligence', 1, 20, 'Pending', 0, ''],
      ['DQ4', 'Drink 3L Water', 'Vitality', 1, 15, 'Pending', 0, '']
    ];
    defaults.forEach(function (r) { sheet.appendRow(r); });
  }
}

function seedAchievements(ss) {
  const sheet = ss.getSheetByName('Achievements');
  if (sheet.getLastRow() < 2) {
    const list = [
      ['A1', 'First Quest', 'Complete your first quest', '🗡️', 'FALSE', ''],
      ['A2', '7-Day Streak', 'Maintain a 7 day daily quest streak', '🔥', 'FALSE', ''],
      ['A3', 'Level 10', 'Reach Level 10', '⭐', 'FALSE', ''],
      ['A4', 'Level 25', 'Reach Level 25', '🌟', 'FALSE', ''],
      ['A5', 'Level 50', 'Reach Level 50', '💫', 'FALSE', ''],
      ['A6', '100 Quests', 'Complete 100 quests total', '💯', 'FALSE', ''],
      ['A7', 'Dungeon Clear', 'Successfully clear your first dungeon raid', '🏰', 'FALSE', ''],
      ['A8', 'Perfect Day', 'Complete all daily quests in one day', '✅', 'FALSE', ''],
      ['A9', 'Shadow Monarch', 'Reach Level 100', '👑', 'FALSE', ''],
      ['A10', 'Socialite', 'Add 10 people to the database', '🤝', 'FALSE', '']
    ];
    list.forEach(function (r) { sheet.appendRow(r); });
  }
}

// ── LEVEL / TITLE MATH ─────────────────────────────────────────────────────────
function xpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function titleForLevel(level) {
  if (level >= 100) return 'Shadow Monarch';
  if (level >= 70) return 'National Level Hunter';
  if (level >= 50) return 'S-Rank Hunter';
  if (level >= 40) return 'A-Rank Hunter';
  if (level >= 30) return 'B-Rank Hunter';
  if (level >= 20) return 'C-Rank Hunter';
  if (level >= 10) return 'D-Rank Hunter';
  return 'E-Rank Hunter';
}

// ── PLAYER ─────────────────────────────────────────────────────────────────────
function getPlayerRaw() {
  const info = getSheetInfo('Player');
  const row = info.rows[0];
  const obj = {};
  info.headers.forEach(function (h, i) { obj[h] = row[i]; });
  return { info: info, obj: obj };
}

function savePlayer(obj, info) {
  const row = info.headers.map(function (h) { return obj[h]; });
  info.sheet.getRange(2, 1, 1, row.length).setValues([row]);
}

function formatPlayer(obj) {
  return {
    name: obj.Name,
    level: obj.Level,
    xp: obj.XP,
    xpToNext: obj.XPToNext,
    xpPercent: Math.max(0, Math.min(100, Math.round((obj.XP / obj.XPToNext) * 100))),
    hp: obj.HP, maxHp: obj.MaxHP,
    mp: obj.MP, maxMp: obj.MaxMP,
    stats: {
      strength: obj.Strength, intelligence: obj.Intelligence,
      agility: obj.Agility, vitality: obj.Vitality, sense: obj.Sense
    },
    title: obj.Title,
    totalQuests: obj.TotalQuestsCompleted,
    streak: obj.StreakCount,
    dungeonClears: obj.DungeonClears,
    perfectDays: obj.PerfectDays
  };
}

function getPlayerStatus() {
  const raw = getPlayerRaw();
  return formatPlayer(raw.obj);
}

function getDashboardData() {
  return {
    player: getPlayerStatus(),
    dailyQuests: getDailyQuests(),
    briefing: getDailyBriefing()
  };
}

function applyRewards(xpGain, statType, statAmount) {
  const raw = getPlayerRaw();
  const obj = raw.obj;
  obj.XP = Number(obj.XP) + Number(xpGain);
  if (statType && STAT_KEYS.indexOf(statType) !== -1) {
    obj[statType] = Number(obj[statType]) + Number(statAmount || 1);
  }
  let leveledUp = false;
  let newLevel = Number(obj.Level);
  while (obj.XP >= obj.XPToNext) {
    obj.XP -= obj.XPToNext;
    obj.Level = Number(obj.Level) + 1;
    obj.XPToNext = xpForLevel(obj.Level);
    obj.MaxHP = Number(obj.MaxHP) + 10;
    obj.HP = obj.MaxHP;
    obj.MaxMP = Number(obj.MaxMP) + 5;
    obj.MP = obj.MaxMP;
    obj.Title = titleForLevel(obj.Level);
    leveledUp = true;
    newLevel = obj.Level;
  }
  if (obj.XP < 0) obj.XP = 0;
  obj.LastActiveDate = formatDate(new Date());
  savePlayer(obj, raw.info);
  const unlocked = checkAchievements(obj);
  return { player: formatPlayer(obj), leveledUp: leveledUp, newLevel: newLevel, unlockedAchievements: unlocked };
}

function applyXPChange(delta) {
  return applyRewards(delta, null, 0);
}

// ── ACHIEVEMENTS ────────────────────────────────────────────────────────────────
function checkAchievements(obj) {
  const info = getSheetInfo('Achievements');
  const peopleCount = getSheetInfo('People').rows.length;
  const conditions = {
    'First Quest': Number(obj.TotalQuestsCompleted) >= 1,
    '7-Day Streak': Number(obj.StreakCount) >= 7,
    'Level 10': Number(obj.Level) >= 10,
    'Level 25': Number(obj.Level) >= 25,
    'Level 50': Number(obj.Level) >= 50,
    '100 Quests': Number(obj.TotalQuestsCompleted) >= 100,
    'Dungeon Clear': Number(obj.DungeonClears) >= 1,
    'Perfect Day': Number(obj.PerfectDays) >= 1,
    'Shadow Monarch': Number(obj.Level) >= 100,
    'Socialite': peopleCount >= 10
  };
  const unlocked = [];
  info.rows.forEach(function (row, i) {
    const name = row[info.idx.Name];
    const isUnlocked = row[info.idx.Unlocked] === true || row[info.idx.Unlocked] === 'TRUE';
    if (!isUnlocked && conditions[name]) {
      info.sheet.getRange(i + 2, info.idx.Unlocked + 1).setValue(true);
      info.sheet.getRange(i + 2, info.idx.UnlockedDate + 1).setValue(formatDate(new Date()));
      unlocked.push({ name: name, description: row[info.idx.Description], icon: row[info.idx.Icon] });
    }
  });
  return unlocked;
}

function getAchievements() {
  const info = getSheetInfo('Achievements');
  return info.rows.map(function (row) {
    return {
      id: row[info.idx.ID], name: row[info.idx.Name], description: row[info.idx.Description],
      icon: row[info.idx.Icon],
      unlocked: row[info.idx.Unlocked] === true || row[info.idx.Unlocked] === 'TRUE',
      unlockedDate: row[info.idx.UnlockedDate]
    };
  });
}

// ── DAILY QUESTS ─────────────────────────────────────────────────────────────────
function getDailyQuests() {
  const info = getSheetInfo('DailyQuests');
  return info.rows.map(function (row) {
    return {
      id: row[info.idx.ID], title: row[info.idx.Title], statType: row[info.idx.StatType],
      statAmount: row[info.idx.StatAmount], xpReward: row[info.idx.XPReward],
      status: row[info.idx.Status], streak: row[info.idx.Streak]
    };
  });
}

function completeDailyQuest(id) {
  const info = getSheetInfo('DailyQuests');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === id) {
      if (info.rows[i][info.idx.Status] === 'Completed') return { alreadyDone: true };
      const r = i + 2;
      info.sheet.getRange(r, info.idx.Status + 1).setValue('Completed');
      info.sheet.getRange(r, info.idx.LastCompletedDate + 1).setValue(formatDate(new Date()));
      const title = info.rows[i][info.idx.Title];
      const xp = info.rows[i][info.idx.XPReward];
      const statType = info.rows[i][info.idx.StatType];
      const statAmount = info.rows[i][info.idx.StatAmount];
      const result = applyRewards(xp, statType, statAmount);
      incrementTotalQuests();
      const refreshed = getDailyQuests();
      const perfect = refreshed.length > 0 && refreshed.every(function (q) { return q.status === 'Completed'; });
      if (perfect) markPerfectDay();
      return Object.assign({ alreadyDone: false, questTitle: title, xpGained: xp }, result);
    }
  }
  throw new Error('Quest not found');
}

function addDailyQuest(title, statType, statAmount, xpReward) {
  const info = getSheetInfo('DailyQuests');
  const id = 'DQ' + Date.now();
  info.sheet.appendRow([id, title, statType, statAmount, xpReward, 'Pending', 0, '']);
  return getDailyQuests();
}

function updateDailyQuest(id, title, statType, statAmount, xpReward) {
  const info = getSheetInfo('DailyQuests');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === id) {
      const r = i + 2;
      info.sheet.getRange(r, info.idx.Title + 1).setValue(title);
      info.sheet.getRange(r, info.idx.StatType + 1).setValue(statType);
      info.sheet.getRange(r, info.idx.StatAmount + 1).setValue(statAmount);
      info.sheet.getRange(r, info.idx.XPReward + 1).setValue(xpReward);
      break;
    }
  }
  return getDailyQuests();
}

function deleteDailyQuest(id) {
  const info = getSheetInfo('DailyQuests');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === id) { info.sheet.deleteRow(i + 2); break; }
  }
  return getDailyQuests();
}

function incrementTotalQuests() {
  const raw = getPlayerRaw();
  raw.obj.TotalQuestsCompleted = Number(raw.obj.TotalQuestsCompleted) + 1;
  savePlayer(raw.obj, raw.info);
}

function markPerfectDay() {
  const raw = getPlayerRaw();
  raw.obj.PerfectDays = Number(raw.obj.PerfectDays) + 1;
  savePlayer(raw.obj, raw.info);
  checkAchievements(raw.obj);
}

// ── MIDNIGHT RESET (installable trigger) ──────────────────────────────────────────
function resetDailyQuests() {
  const info = getSheetInfo('DailyQuests');
  let totalPenalty = 0;
  let allCompleted = info.rows.length > 0;
  info.rows.forEach(function (row, i) {
    const r = i + 2;
    const completed = row[info.idx.Status] === 'Completed';
    if (completed) {
      const newStreak = Number(row[info.idx.Streak] || 0) + 1;
      info.sheet.getRange(r, info.idx.Streak + 1).setValue(newStreak);
    } else {
      allCompleted = false;
      info.sheet.getRange(r, info.idx.Streak + 1).setValue(0);
      totalPenalty += 15;
    }
    info.sheet.getRange(r, info.idx.Status + 1).setValue('Pending');
  });

  const raw = getPlayerRaw();
  raw.obj.StreakCount = allCompleted ? Number(raw.obj.StreakCount) + 1 : 0;
  savePlayer(raw.obj, raw.info);

  if (totalPenalty > 0) {
    applyXPChange(-totalPenalty);
  } else {
    checkAchievements(raw.obj);
  }
}

// ── QUEST LOG (custom one-time quests) ─────────────────────────────────────────────
function getQuestLog() {
  const info = getSheetInfo('Quests');
  return info.rows.map(function (row) {
    return {
      id: row[info.idx.ID], title: row[info.idx.Title], description: row[info.idx.Description],
      rank: row[info.idx.Rank], xpReward: row[info.idx.XPReward], statType: row[info.idx.StatType],
      statAmount: row[info.idx.StatAmount], status: row[info.idx.Status], createdDate: row[info.idx.CreatedDate]
    };
  }).reverse();
}

function addQuest(title, description, rank, statType) {
  const info = getSheetInfo('Quests');
  const id = 'Q' + Date.now();
  const xp = RANK_XP[rank] || 10;
  const statAmount = RANK_STAT[rank] || 1;
  info.sheet.appendRow([id, title, description, rank, xp, statType, statAmount, 'Pending', formatDate(new Date()), '']);
  return getQuestLog();
}

function completeQuest(id) {
  const info = getSheetInfo('Quests');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === id) {
      if (info.rows[i][info.idx.Status] === 'Completed') return { alreadyDone: true };
      const r = i + 2;
      info.sheet.getRange(r, info.idx.Status + 1).setValue('Completed');
      info.sheet.getRange(r, info.idx.CompletedDate + 1).setValue(formatDate(new Date()));
      const title = info.rows[i][info.idx.Title];
      const xp = info.rows[i][info.idx.XPReward];
      const statType = info.rows[i][info.idx.StatType];
      const statAmount = info.rows[i][info.idx.StatAmount];
      const result = applyRewards(xp, statType, statAmount);
      incrementTotalQuests();
      return Object.assign({ alreadyDone: false, questTitle: title, xpGained: xp }, result);
    }
  }
  throw new Error('Quest not found');
}

function deleteQuest(id) {
  const info = getSheetInfo('Quests');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === id) { info.sheet.deleteRow(i + 2); break; }
  }
  return getQuestLog();
}

// ── DUNGEON MODE (Pomodoro) ─────────────────────────────────────────────────────────
function recordDungeonResult(durationMinutes, success) {
  if (success) {
    const raw = getPlayerRaw();
    raw.obj.DungeonClears = Number(raw.obj.DungeonClears) + 1;
    savePlayer(raw.obj, raw.info);
    const xp = durationMinutes >= 50 ? 80 : 40;
    const statAmount = durationMinutes >= 50 ? 3 : 2;
    const result = applyRewards(xp, 'Agility', statAmount);
    return Object.assign({ success: true, xpGained: xp }, result);
  } else {
    const penalty = durationMinutes >= 50 ? 30 : 15;
    const result = applyXPChange(-penalty);
    return Object.assign({ success: false, xpLost: penalty }, result);
  }
}

// ── DAILY BRIEFING ────────────────────────────────────────────────────────────────
function getDailyBriefing() {
  const raw = getPlayerRaw();
  const today = formatDate(new Date());
  const alreadyShown = raw.obj.LastBriefingDate === today;
  const dailyQuests = getDailyQuests();
  const pending = dailyQuests.filter(function (q) { return q.status !== 'Completed'; }).length;
  const messages = [
    'Rise, Hunter. Today is another step toward the Shadow Monarch throne.',
    'The System has evaluated your progress. Continue to grow stronger.',
    'A new day, a new dungeon. Complete your quests, Hunter.',
    'Your potential remains untapped. Today is the day to unlock more of it.',
    'The weak wait for tomorrow. The strong seize today.'
  ];
  const motivational = messages[Math.floor(Math.random() * messages.length)];
  return {
    alreadyShown: alreadyShown, pending: pending, total: dailyQuests.length,
    streak: raw.obj.StreakCount, motivational: motivational,
    level: raw.obj.Level, title: raw.obj.Title
  };
}

function markBriefingShown() {
  const raw = getPlayerRaw();
  raw.obj.LastBriefingDate = formatDate(new Date());
  savePlayer(raw.obj, raw.info);
}

// ── PEOPLE SCANNER ──────────────────────────────────────────────────────────────────
function rowToPerson(idx, row) {
  return {
    id: row[idx.ID], name: row[idx.Name], relation: row[idx.Relation], howWeMet: row[idx.HowWeMet],
    personalityNotes: row[idx.PersonalityNotes], birthday: row[idx.Birthday],
    behaviorAdvice: row[idx.BehaviorAdvice], createdDate: row[idx.CreatedDate]
  };
}

function getPeople() {
  const info = getSheetInfo('People');
  return info.rows.map(function (row) { return rowToPerson(info.idx, row); }).reverse();
}

function searchPeople(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return getPeople();
  return getPeople().filter(function (p) { return (p.name || '').toLowerCase().indexOf(q) !== -1; });
}

function addPerson(data) {
  const info = getSheetInfo('People');
  const id = 'P' + Date.now();
  info.sheet.appendRow([id, data.name, data.relation, data.howWeMet, data.personalityNotes, data.birthday, data.behaviorAdvice, formatDate(new Date())]);
  const raw = getPlayerRaw();
  checkAchievements(raw.obj);
  return getPeople();
}

function updatePerson(data) {
  const info = getSheetInfo('People');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === data.id) {
      const r = i + 2;
      info.sheet.getRange(r, info.idx.Name + 1).setValue(data.name);
      info.sheet.getRange(r, info.idx.Relation + 1).setValue(data.relation);
      info.sheet.getRange(r, info.idx.HowWeMet + 1).setValue(data.howWeMet);
      info.sheet.getRange(r, info.idx.PersonalityNotes + 1).setValue(data.personalityNotes);
      info.sheet.getRange(r, info.idx.Birthday + 1).setValue(data.birthday);
      info.sheet.getRange(r, info.idx.BehaviorAdvice + 1).setValue(data.behaviorAdvice);
      break;
    }
  }
  return getPeople();
}

function deletePerson(id) {
  const info = getSheetInfo('People');
  for (let i = 0; i < info.rows.length; i++) {
    if (info.rows[i][info.idx.ID] === id) { info.sheet.deleteRow(i + 2); break; }
  }
  return getPeople();
}

// ── SYSTEM AI ASSISTANT (Gemini) ────────────────────────────────────────────────────
function getChatHistory() {
  const info = getSheetInfo('ChatHistory');
  return info.rows.map(function (row) {
    return { id: row[info.idx.ID], timestamp: row[info.idx.Timestamp], role: row[info.idx.Role], message: row[info.idx.Message] };
  });
}

function saveChatMessage(role, message) {
  const info = getSheetInfo('ChatHistory');
  const id = 'C' + Date.now() + Math.floor(Math.random() * 1000);
  info.sheet.appendRow([id, new Date().toISOString(), role, message]);
}

function clearChatHistory() {
  const info = getSheetInfo('ChatHistory');
  if (info.rows.length > 0) info.sheet.deleteRows(2, info.rows.length);
  return [];
}

function askSystemAI(message) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_KEY);
  if (!apiKey) {
    return { reply: '[SYSTEM]: API key not configured. Run setupApiKey() in the script editor, then try again.' };
  }
  saveChatMessage('user', message);

  const raw = getPlayerRaw();
  const people = getPeople();
  const peopleContext = people.map(function (p) {
    return '- ' + p.name + ' (' + p.relation + '): met via ' + p.howWeMet + '. Personality: ' + p.personalityNotes + '. Birthday: ' + p.birthday + '. Advice: ' + p.behaviorAdvice;
  }).join('\n') || 'No people recorded yet.';

  const history = getChatHistory().slice(-10).map(function (h) {
    return (h.role === 'user' ? 'Hunter' : 'System') + ': ' + h.message;
  }).join('\n');

  const prompt = 'You are "The System" from Solo Leveling, an AI assistant serving Hunter ' + raw.obj.Name +
    ' (Level ' + raw.obj.Level + ', ' + raw.obj.Title + ').\n' +
    'Speak in a cold, precise, slightly dramatic System tone, always prefixing replies with "[SYSTEM]:". ' +
    'Keep replies helpful and concise (max ~150 words unless detail is requested). ' +
    'You help with studies, aptitude, productivity, life advice, and relationships.\n\n' +
    'Known people in the Hunter\'s life:\n' + peopleContext + '\n\n' +
    'If asked "who is X" or for advice on interacting with someone, use the data above. ' +
    'If the person is not known, say the System has no record of them.\n\n' +
    'Recent conversation:\n' + history + '\n\n' +
    'Hunter\'s new message: ' + message + '\n\n' +
    'Respond as The System.';

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const json = JSON.parse(response.getContentText());
    if (code !== 200) {
      const errMsg = (json.error && json.error.message) || 'Unknown error';
      const reply = '[SYSTEM]: Connection to the higher plane failed (' + code + '): ' + errMsg;
      saveChatMessage('system', reply);
      return { reply: reply };
    }
    let reply = '[SYSTEM]: ...';
    if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
      reply = json.candidates[0].content.parts.map(function (p) { return p.text; }).join('');
      if (reply.indexOf('[SYSTEM]') !== 0) reply = '[SYSTEM]: ' + reply;
    }
    saveChatMessage('system', reply);
    return { reply: reply };
  } catch (e) {
    const reply = '[SYSTEM]: A rift disrupted the connection. ' + e.message;
    saveChatMessage('system', reply);
    return { reply: reply };
  }
}
