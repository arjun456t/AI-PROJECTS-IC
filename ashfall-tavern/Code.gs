/**
 * Ashfall Tavern — AI-powered NPC dialogue engine.
 * Code.gs — web app entry point, template include helper, and every server
 * endpoint reachable from the client via google.script.run.
 *
 * Design rule: NOTHING in this file may throw to the client. Every endpoint
 * returns a plain, JSON-serialisable envelope of the shape
 * `{ ok: boolean, ... }` so the browser can always degrade gracefully.
 */

/** Global app constants. @const {!Object} */
var ASHFALL = {
  APP_TITLE: 'Ashfall Tavern',
  VERSION: '1.0.0',
  PROP_SPREADSHEET_ID: 'ASHFALL_SPREADSHEET_ID',
  PROP_API_KEY: 'GEMINI_API_KEY',
  DEFAULT_PLAYER: 'player-1',
  /** Wall-clock budget for a single chunked prebake pass (Apps Script cap is 6min). */
  PREBAKE_BUDGET_MS: 240000
};

/* ────────────────────────────────────────────────────────────────────────────
 * WEB APP ENTRY
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Serves the single-page web app.
 * @param {!Object} e Apps Script doGet event object.
 * @return {!HtmlOutput} The rendered page, iframe-embeddable.
 */
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.appTitle = ASHFALL.APP_TITLE;
  t.appVersion = ASHFALL.VERSION;
  t.playerId = (e && e.parameter && e.parameter.player) || ASHFALL.DEFAULT_PLAYER;
  return t.evaluate()
      .setTitle(ASHFALL.APP_TITLE)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Inlines another HTML file into a template (`<?!= include('Styles') ?>`).
 * @param {string} filename Project file name, without the .html extension.
 * @return {string} Raw file content.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ────────────────────────────────────────────────────────────────────────────
 * BOOTSTRAP
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Creates (or repairs) the backing spreadsheet and seeds every tab.
 * Run this ONCE from the Apps Script editor to authorise scopes.
 * @return {!Object} `{ok, spreadsheetId, url, created, sheets}`.
 */
function initializeSpreadsheet() {
  try {
    return SheetsDb.initialize();
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * Convenience wrapper for the editor: prints the spreadsheet URL to the log.
 * @return {string} The spreadsheet URL, or an error string.
 */
function showSpreadsheetUrl() {
  var res = initializeSpreadsheet();
  var url = res.ok ? res.url : ('ERROR: ' + res.error);
  Logger.log(url);
  return url;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ENDPOINTS
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything the client needs to boot the game in one round trip.
 * Falls back to in-code personas/lore if the spreadsheet is missing, so the
 * demo always runs.
 * @param {string=} playerId Save slot id.
 * @return {!Object} `{ok, playerId, personas, config, state, loreCount, hasApiKey, warnings}`.
 */
function getGameData(playerId) {
  var pid = playerId || ASHFALL.DEFAULT_PLAYER;
  var out = {
    ok: true,
    version: ASHFALL.VERSION,
    playerId: pid,
    personas: [],
    config: null,
    state: null,
    loreCount: 0,
    hasApiKey: false,
    spreadsheetUrl: '',
    warnings: []
  };

  try {
    out.personas = Personas.listForClient();
    out.loreCount = Lore.count();
  } catch (err) {
    out.ok = false;
    out.warnings.push('Persona/lore load failed: ' + String(err && err.message || err));
  }

  try {
    out.config = SheetsDb.readConfig();
  } catch (err) {
    out.config = SheetsDb.defaultConfig();
    out.warnings.push('Config unavailable, using defaults: ' + String(err && err.message || err));
  }

  try {
    out.state = SheetsDb.loadState(pid);
  } catch (err) {
    out.state = SheetsDb.newState(pid);
    out.warnings.push('Save slot unavailable, starting fresh: ' + String(err && err.message || err));
  }

  try {
    out.hasApiKey = !!PropertiesService.getScriptProperties()
        .getProperty(ASHFALL.PROP_API_KEY);
    var id = PropertiesService.getScriptProperties()
        .getProperty(ASHFALL.PROP_SPREADSHEET_ID);
    if (id) out.spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
  } catch (err) {
    out.warnings.push('Script properties unreadable: ' + String(err && err.message || err));
  }

  if (!out.hasApiKey) {
    out.warnings.push('GEMINI_API_KEY is not set — NPCs will speak their hand-written fallback lines.');
  }
  return out;
}

/**
 * Generates one in-character NPC turn. This is the product.
 * Guaranteed never to throw: on any failure the NPC speaks a fallback line.
 * @param {string} npcId Persona id.
 * @param {?string} playerChoiceText What the player just said (null = approach).
 * @param {?string} stateJson Serialised world state from the client.
 * @return {!Object} `{ok, npcId, response, state, debug}`.
 */
function generateLine(npcId, playerChoiceText, stateJson) {
  try {
    return Dialogue.generateLine(npcId, playerChoiceText, stateJson);
  } catch (err) {
    return Dialogue.emergencyEnvelope(npcId, stateJson, String(err && err.message || err));
  }
}

/**
 * Persists the world state for a save slot.
 * @param {string} playerId Save slot id.
 * @param {string} stateJson Serialised state.
 * @return {!Object} `{ok, savedAt}`.
 */
function saveGameState(playerId, stateJson) {
  try {
    var state = SheetsDb.parseJson(stateJson, null);
    if (!state) throw new Error('State payload was not valid JSON.');
    SheetsDb.saveState(playerId || ASHFALL.DEFAULT_PLAYER, state);
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * Loads the world state for a save slot, or a fresh state if none exists.
 * @param {string} playerId Save slot id.
 * @return {!Object} `{ok, state}`.
 */
function loadGameState(playerId) {
  var pid = playerId || ASHFALL.DEFAULT_PLAYER;
  try {
    return { ok: true, state: SheetsDb.loadState(pid) };
  } catch (err) {
    return { ok: true, state: SheetsDb.newState(pid), warning: String(err && err.message || err) };
  }
}

/**
 * Exports the recorded dialogue graph.
 * @param {string} format One of `json` | `csv` | `yarn`.
 * @param {string=} npcId Optional filter to a single NPC.
 * @return {!Object} `{ok, format, filename, mime, content, nodeCount, edgeCount}`.
 */
function exportDialogueTree(format, npcId) {
  try {
    return Exporter.exportTree(format, npcId);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * Breadth-first pre-bake of the dialogue tree, chunked to survive the 6-minute
 * execution limit. Call repeatedly, feeding the returned cursor back in, until
 * `done` is true.
 * @param {string} npcId Persona id to walk.
 * @param {number} depth Target depth (1-4).
 * @param {?string} cursorJson Cursor returned by the previous call, or null.
 * @return {!Object} `{ok, done, cursor, generated, total, elapsedMs, message}`.
 */
function prebakeTree(npcId, depth, cursorJson) {
  try {
    return Exporter.prebake(npcId, depth, cursorJson);
  } catch (err) {
    return { ok: false, done: true, error: String(err && err.message || err) };
  }
}

/**
 * Recent rows from the DialogueLog tab, newest first — powers the DevPanel
 * history view and the cost estimator.
 * @param {number=} limit Max rows (default 25).
 * @return {!Object} `{ok, rows, totals}`.
 */
function getDevLog(limit) {
  try {
    return SheetsDb.readDialogueLog(limit || 25);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), rows: [], totals: null };
  }
}

/**
 * Patches the Config tab (rating tier, temperature, determinism, model).
 * @param {!Object|string} patch Partial config object or its JSON string.
 * @return {!Object} `{ok, config}`.
 */
function setConfig(patch) {
  try {
    var obj = (typeof patch === 'string') ? SheetsDb.parseJson(patch, {}) : (patch || {});
    return { ok: true, config: SheetsDb.writeConfig(obj) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * Clears the recorded dialogue graph so a demo can start from a clean tree.
 * @return {!Object} `{ok, cleared}`.
 */
function clearExportedTree() {
  try {
    return { ok: true, cleared: SheetsDb.clearExportedTree() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * Smoke test for the editor: validates all personas, the lore corpus and the
 * spreadsheet, then attempts one live generation.
 * @return {!Object} Diagnostic report.
 */
function selfTest() {
  var report = { ok: true, checks: [] };

  function check(name, fn) {
    try {
      var detail = fn();
      report.checks.push({ name: name, ok: true, detail: detail });
    } catch (err) {
      report.ok = false;
      report.checks.push({ name: name, ok: false, detail: String(err && err.message || err) });
    }
  }

  check('personas', function () {
    var errs = Personas.validateAll();
    if (errs.length) throw new Error(errs.join('; '));
    return Personas.list().length + ' personas valid';
  });
  check('lore', function () {
    var errs = Lore.validateAll();
    if (errs.length) throw new Error(errs.join('; '));
    return Lore.count() + ' lore entries valid';
  });
  check('lore boundaries', function () {
    var veyla = Lore.retrieve('bram debt protection ashguard', 'veyla');
    for (var i = 0; i < veyla.length; i++) {
      if (veyla[i].secrecy === 'secret') throw new Error('Veyla was served a secret entry: ' + veyla[i].id);
    }
    return 'secrecy filter holds for Veyla';
  });
  check('spreadsheet', function () {
    var res = SheetsDb.initialize();
    if (!res.ok) throw new Error(res.error);
    return res.url;
  });
  check('generation', function () {
    var res = generateLine('bram', null, null);
    if (!res.ok) throw new Error(res.debug && res.debug.error || 'generation failed');
    return res.response.line;
  });

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
