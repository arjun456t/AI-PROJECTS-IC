/**
 * Sheets.gs — the database layer.
 *
 * Google Sheets is the persistence tier: NPC definitions, lore corpus, save
 * slots, the dialogue telemetry log, the exported branching tree and runtime
 * config. Every read is defensive — if the spreadsheet is missing or a tab has
 * been renamed by a curious writer, the caller gets a sane default instead of
 * an exception, and the game keeps running.
 */

/** @const {!Object} */
var SheetsDb = (function () {

  /** @const {!Object<string, !Array<string>>} Tab name → header row. */
  var SCHEMA = {
    NPCs: ['id', 'personaJson'],
    Lore: ['id', 'title', 'body', 'tags', 'secrecy'],
    GameState: ['playerId', 'questFlags', 'reputation', 'npcRelationships', 'npcMemory'],
    DialogueLog: ['timestamp', 'npcId', 'prompt', 'rawResponse', 'latencyMs', 'tokensEst', 'violations'],
    // The nine spec columns, plus repDelta — §4 requires edges to carry it and
    // there is nowhere else to put it without lossy packing.
    ExportedTree: ['nodeId', 'npcId', 'parentNode', 'line', 'emotion', 'intent', 'choiceText', 'tone', 'nextNode', 'repDelta'],
    Config: ['key', 'value'],
    DetCache: ['key', 'payload', 'storedAt']
  };

  /** @const {!Object} Config defaults, used until the sheet says otherwise. */
  var CONFIG_DEFAULTS = {
    ratingTier: 'T',
    temperature: 0.85,
    deterministicMode: false,
    model: 'gemini-2.0-flash'
  };

  /** Cached handle for the life of one execution. @type {?Spreadsheet} */
  var ssCache = null;

  /**
   * JSON.parse that never throws.
   * @param {*} text Candidate JSON string.
   * @param {*} fallback Value returned on failure.
   * @return {*} Parsed value or `fallback`.
   */
  function parseJson(text, fallback) {
    if (text === null || text === undefined || text === '') return fallback;
    if (typeof text === 'object') return text;
    try {
      return JSON.parse(String(text));
    } catch (err) {
      return fallback;
    }
  }

  /**
   * Opens (creating on first run) the backing spreadsheet.
   * @return {!Spreadsheet} The spreadsheet handle.
   */
  function spreadsheet() {
    if (ssCache) return ssCache;
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty(ASHFALL.PROP_SPREADSHEET_ID);
    if (id) {
      try {
        ssCache = SpreadsheetApp.openById(id);
        return ssCache;
      } catch (err) {
        // Deleted or access revoked — fall through and mint a new one.
        props.deleteProperty(ASHFALL.PROP_SPREADSHEET_ID);
      }
    }
    ssCache = SpreadsheetApp.create('Ashfall Tavern — Dialogue Engine DB');
    props.setProperty(ASHFALL.PROP_SPREADSHEET_ID, ssCache.getId());
    return ssCache;
  }

  /**
   * Returns a tab, creating it with its header row when absent.
   * @param {string} name Tab name from SCHEMA.
   * @return {!Sheet} The sheet.
   */
  function sheet(name) {
    var ss = spreadsheet();
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      var headers = SCHEMA[name] || [];
      if (headers.length) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers])
          .setFontWeight('bold').setBackground('#2b2320').setFontColor('#e8dcc4');
        sh.setFrozenRows(1);
      }
    }
    return sh;
  }

  /**
   * Creates every tab, seeds NPCs / Lore / Config, and removes the default
   * "Sheet1". Safe to run repeatedly.
   * @return {!Object} `{ok, spreadsheetId, url, created, sheets}`.
   */
  function initialize() {
    var ss = spreadsheet();
    var made = [];
    for (var name in SCHEMA) {
      if (!Object.prototype.hasOwnProperty.call(SCHEMA, name)) continue;
      var existed = !!ss.getSheetByName(name);
      sheet(name);
      if (!existed) made.push(name);
    }

    seedNpcs();
    seedLore();
    seedConfig();

    var def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

    return {
      ok: true,
      spreadsheetId: ss.getId(),
      url: ss.getUrl(),
      created: made,
      sheets: Object.keys(SCHEMA)
    };
  }

  /**
   * Writes the in-code personas into the NPCs tab (full replace).
   * @return {number} Rows written.
   */
  function seedNpcs() {
    var sh = sheet('NPCs');
    var rows = Personas.list().map(function (p) { return [p.id, JSON.stringify(p)]; });
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SCHEMA.NPCs.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, SCHEMA.NPCs.length).setValues(rows);
    return rows.length;
  }

  /**
   * Writes the in-code lore corpus into the Lore tab (full replace).
   * @return {number} Rows written.
   */
  function seedLore() {
    var sh = sheet('Lore');
    var rows = Lore.toSheetRows();
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SCHEMA.Lore.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, SCHEMA.Lore.length).setValues(rows);
    return rows.length;
  }

  /**
   * Ensures every config key exists, without clobbering tuned values.
   * @return {!Object} The effective config.
   */
  function seedConfig() {
    var sh = sheet('Config');
    var existing = {};
    if (sh.getLastRow() > 1) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (vals[i][0]) existing[String(vals[i][0])] = true;
      }
    }
    var missing = [];
    for (var k in CONFIG_DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, k)) continue;
      if (!existing[k]) missing.push([k, String(CONFIG_DEFAULTS[k])]);
    }
    if (missing.length) {
      sh.getRange(sh.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
    }
    return readConfig();
  }

  /**
   * The default runtime config.
   * @return {!Object} `{ratingTier, temperature, deterministicMode, model}`.
   */
  function defaultConfig() {
    return {
      ratingTier: CONFIG_DEFAULTS.ratingTier,
      temperature: CONFIG_DEFAULTS.temperature,
      deterministicMode: CONFIG_DEFAULTS.deterministicMode,
      model: CONFIG_DEFAULTS.model
    };
  }

  /**
   * Reads and coerces the Config tab.
   * @return {!Object} Effective config, defaults filled in.
   */
  function readConfig() {
    var cfg = defaultConfig();
    try {
      var sh = sheet('Config');
      if (sh.getLastRow() < 2) return cfg;
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < vals.length; i++) {
        var key = String(vals[i][0] || '').trim();
        var raw = vals[i][1];
        if (!key) continue;
        if (key === 'temperature') {
          var t = parseFloat(raw);
          if (!isNaN(t)) cfg.temperature = Math.max(0, Math.min(2, t));
        } else if (key === 'deterministicMode') {
          cfg.deterministicMode = (String(raw).toLowerCase() === 'true' || raw === true);
        } else if (key === 'ratingTier') {
          var tier = String(raw || 'T').toUpperCase();
          cfg.ratingTier = (['E', 'T', 'M'].indexOf(tier) === -1) ? 'T' : tier;
        } else if (key === 'model') {
          cfg.model = String(raw || CONFIG_DEFAULTS.model);
        }
      }
    } catch (err) {
      // Sheet unavailable — defaults are a perfectly good answer.
    }
    return cfg;
  }

  /**
   * Patches config keys and returns the merged result.
   * @param {!Object} patch Partial config.
   * @return {!Object} The effective config after the write.
   */
  function writeConfig(patch) {
    var sh = sheet('Config');
    var rows = (sh.getLastRow() > 1) ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
    var index = {};
    for (var i = 0; i < rows.length; i++) index[String(rows[i][0])] = i + 2;

    for (var key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      if (!Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, key)) continue;
      var value = String(patch[key]);
      if (index[key]) {
        sh.getRange(index[key], 2).setValue(value);
      } else {
        var r = sh.getLastRow() + 1;
        sh.getRange(r, 1, 1, 2).setValues([[key, value]]);
        index[key] = r;
      }
    }
    return readConfig();
  }

  /**
   * A brand new save state.
   * @param {string} playerId Save slot id.
   * @return {!Object} Fresh state object.
   */
  function newState(playerId) {
    var state = {
      playerId: playerId || ASHFALL.DEFAULT_PLAYER,
      questFlags: {},
      reputation: 0,
      npcRelationships: {},
      npcMemory: {},
      timeOfDay: 'dusk',
      revealed: [],
      turnCount: 0
    };
    Personas.list().forEach(function (p) {
      state.npcRelationships[p.id] = 0;
      state.npcMemory[p.id] = { mood: p.moodState.current, turns: [] };
    });
    return state;
  }

  /**
   * Normalises a possibly-partial state blob into the full shape.
   * @param {?Object} raw Candidate state.
   * @param {string} playerId Save slot id.
   * @return {!Object} Complete state.
   */
  function normalizeState(raw, playerId) {
    var base = newState(playerId);
    if (!raw || typeof raw !== 'object') return base;

    base.questFlags = (raw.questFlags && typeof raw.questFlags === 'object') ? raw.questFlags : {};
    base.reputation = (typeof raw.reputation === 'number') ? raw.reputation : 0;
    base.timeOfDay = raw.timeOfDay || 'dusk';
    base.revealed = Array.isArray(raw.revealed) ? raw.revealed.slice(0) : [];
    base.turnCount = (typeof raw.turnCount === 'number') ? raw.turnCount : 0;

    Personas.ids().forEach(function (id) {
      var rel = raw.npcRelationships && raw.npcRelationships[id];
      base.npcRelationships[id] = (typeof rel === 'number') ? Math.max(-10, Math.min(10, rel)) : 0;

      var mem = raw.npcMemory && raw.npcMemory[id];
      if (mem && typeof mem === 'object') {
        base.npcMemory[id] = {
          mood: mem.mood || base.npcMemory[id].mood,
          turns: Array.isArray(mem.turns) ? mem.turns.slice(-10) : []
        };
      }
    });
    return base;
  }

  /**
   * Loads a save slot.
   * @param {string} playerId Save slot id.
   * @return {!Object} State (fresh when the slot is empty).
   */
  function loadState(playerId) {
    var pid = playerId || ASHFALL.DEFAULT_PLAYER;
    try {
      var sh = sheet('GameState');
      if (sh.getLastRow() < 2) return newState(pid);
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, SCHEMA.GameState.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]) !== pid) continue;
        // The reputation column carries the scalar plus the small scalars that
        // ride along with it, so the tab keeps the schema the spec calls for.
        var rep = parseJson(vals[i][2], {});
        if (typeof rep === 'number') rep = { global: rep };
        return normalizeState({
          playerId: pid,
          questFlags: parseJson(vals[i][1], {}),
          reputation: (typeof rep.global === 'number') ? rep.global : 0,
          timeOfDay: rep.timeOfDay,
          turnCount: rep.turnCount,
          revealed: rep.revealed,
          npcRelationships: parseJson(vals[i][3], {}),
          npcMemory: parseJson(vals[i][4], {})
        }, pid);
      }
    } catch (err) {
      // fall through
    }
    return newState(pid);
  }

  /**
   * Upserts a save slot.
   * @param {string} playerId Save slot id.
   * @param {!Object} state State to persist.
   * @return {boolean} True on success.
   */
  function saveState(playerId, state) {
    var pid = playerId || ASHFALL.DEFAULT_PLAYER;
    var norm = normalizeState(state, pid);
    var sh = sheet('GameState');
    var row = [
      pid,
      JSON.stringify(norm.questFlags),
      JSON.stringify({ global: norm.reputation, timeOfDay: norm.timeOfDay, turnCount: norm.turnCount, revealed: norm.revealed }),
      JSON.stringify(norm.npcRelationships),
      JSON.stringify(norm.npcMemory)
    ];

    var target = 0;
    if (sh.getLastRow() > 1) {
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === pid) { target = i + 2; break; }
      }
    }
    if (!target) target = sh.getLastRow() + 1;
    sh.getRange(target, 1, 1, SCHEMA.GameState.length).setValues([row]);
    return true;
  }

  /**
   * Appends one telemetry row. Never throws — logging must not break play.
   * @param {!Object} rec `{npcId, prompt, rawResponse, latencyMs, tokensEst, violations}`.
   * @return {boolean} True when the row landed.
   */
  function logDialogue(rec) {
    try {
      var sh = sheet('DialogueLog');
      sh.appendRow([
        new Date(),
        rec.npcId || '',
        String(rec.prompt || '').slice(0, 45000),
        String(rec.rawResponse || '').slice(0, 45000),
        rec.latencyMs || 0,
        rec.tokensEst || 0,
        (rec.violations && rec.violations.length) ? JSON.stringify(rec.violations) : ''
      ]);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Reads recent telemetry, newest first, with rolled-up totals.
   * @param {number} limit Max rows.
   * @return {!Object} `{ok, rows, totals}`.
   */
  function readDialogueLog(limit) {
    var sh = sheet('DialogueLog');
    var out = { ok: true, rows: [], totals: { calls: 0, avgLatencyMs: 0, tokensEst: 0, violations: 0 } };
    var last = sh.getLastRow();
    if (last < 2) return out;

    var n = Math.min(limit || 25, last - 1);
    var vals = sh.getRange(last - n + 1, 1, n, SCHEMA.DialogueLog.length).getValues();
    var latencySum = 0;

    for (var i = vals.length - 1; i >= 0; i--) {
      var v = vals[i];
      var violations = parseJson(v[6], []);
      out.rows.push({
        timestamp: (v[0] instanceof Date) ? v[0].toISOString() : String(v[0]),
        npcId: String(v[1]),
        prompt: String(v[2]),
        rawResponse: String(v[3]),
        latencyMs: Number(v[4]) || 0,
        tokensEst: Number(v[5]) || 0,
        violations: Array.isArray(violations) ? violations : []
      });
      latencySum += Number(v[4]) || 0;
      out.totals.tokensEst += Number(v[5]) || 0;
      out.totals.violations += (Array.isArray(violations) ? violations.length : 0);
    }
    out.totals.calls = vals.length;
    out.totals.avgLatencyMs = vals.length ? Math.round(latencySum / vals.length) : 0;
    return out;
  }

  /**
   * Appends rows to the ExportedTree tab.
   * @param {!Array<!Array<*>>} rows Rows matching the ExportedTree schema.
   * @return {number} Rows written.
   */
  function appendTreeRows(rows) {
    if (!rows || !rows.length) return 0;
    var sh = sheet('ExportedTree');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCHEMA.ExportedTree.length).setValues(rows);
    return rows.length;
  }

  /**
   * Reads the whole recorded dialogue graph.
   * @param {string=} npcId Optional filter.
   * @return {!Array<!Object>} Edge-level records.
   */
  function readTreeRows(npcId) {
    var sh = sheet('ExportedTree');
    if (sh.getLastRow() < 2) return [];
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, SCHEMA.ExportedTree.length).getValues();
    var out = [];
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (!v[0]) continue;
      if (npcId && String(v[1]) !== npcId) continue;
      out.push({
        nodeId: String(v[0]), npcId: String(v[1]), parentNode: String(v[2] || ''),
        line: String(v[3] || ''), emotion: String(v[4] || ''), intent: String(v[5] || ''),
        choiceText: String(v[6] || ''), tone: String(v[7] || ''), nextNode: String(v[8] || ''),
        repDelta: Number(v[9]) || 0
      });
    }
    return out;
  }

  /**
   * Empties the ExportedTree tab.
   * @return {number} Rows removed.
   */
  function clearExportedTree() {
    var sh = sheet('ExportedTree');
    var n = Math.max(0, sh.getLastRow() - 1);
    if (n) sh.getRange(2, 1, n, SCHEMA.ExportedTree.length).clearContent();
    return n;
  }

  /**
   * Sheet-backed fallback for the determinism cache (CacheService entries
   * expire after 6h; QA replay needs to survive longer than that).
   * @param {string} key Cache key.
   * @return {?string} Stored payload, or null.
   */
  function detCacheGet(key) {
    try {
      var sh = sheet('DetCache');
      if (sh.getLastRow() < 2) return null;
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][0]) === key) return String(vals[i][1]);
      }
    } catch (err) {
      // treat as a miss
    }
    return null;
  }

  /**
   * Writes a determinism cache entry (upsert).
   * @param {string} key Cache key.
   * @param {string} payload Serialised response.
   * @return {boolean} True on success.
   */
  function detCachePut(key, payload) {
    try {
      var sh = sheet('DetCache');
      var target = 0;
      if (sh.getLastRow() > 1) {
        var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < keys.length; i++) {
          if (String(keys[i][0]) === key) { target = i + 2; break; }
        }
      }
      if (!target) target = sh.getLastRow() + 1;
      sh.getRange(target, 1, 1, 3).setValues([[key, payload, new Date()]]);
      return true;
    } catch (err) {
      return false;
    }
  }

  return {
    SCHEMA: SCHEMA,
    parseJson: parseJson,
    initialize: initialize,
    sheet: sheet,
    spreadsheet: spreadsheet,
    seedNpcs: seedNpcs,
    seedLore: seedLore,
    defaultConfig: defaultConfig,
    readConfig: readConfig,
    writeConfig: writeConfig,
    newState: newState,
    normalizeState: normalizeState,
    loadState: loadState,
    saveState: saveState,
    logDialogue: logDialogue,
    readDialogueLog: readDialogueLog,
    appendTreeRows: appendTreeRows,
    readTreeRows: readTreeRows,
    clearExportedTree: clearExportedTree,
    detCacheGet: detCacheGet,
    detCachePut: detCachePut
  };
})();
