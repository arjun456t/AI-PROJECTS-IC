/**
 * Guardrails.gs — the safety layer. Runs before ANYTHING reaches the client.
 *
 * WHY A STUDIO PAYS FOR THIS: no shipped game can risk an NPC breaking its age
 * rating, breaking character, or spoiling act three. This file is the reason
 * generated dialogue can go in a build at all.
 *
 * Pipeline (each stage can demand a regenerate, or force the fallback):
 *   1. schema validation      — every field, every choice object
 *   2. neverSay phrase match  — persona-authored forbidden phrasings
 *   3. profanity tier E/T/M   — ratingSensitive NPCs forced to the strictest
 *   4. lore-leak              — `revealed[]` outside knowledge boundaries
 *   5. out-of-character       — fourth wall / AI / meta references
 *   6. sanitation             — word caps, choice count, guaranteed exit
 */

/** @const {!Object} */
var Guardrails = (function () {

  var EMOTIONS = ['neutral', 'wary', 'angry', 'warm', 'afraid', 'amused'];
  var INTENTS = ['inform', 'deflect', 'threaten', 'plead', 'barter', 'dismiss'];
  var ACTIONS = ['gesture', 'step_back', 'lean_in', 'turn_away', 'none'];
  var TONES = ['kind', 'blunt', 'sly', 'hostile'];

  /** Severity ladder used by the DevPanel colouring. */
  var SEVERITY = { info: 'info', warn: 'warn', block: 'block' };

  /**
   * Profanity tiers. `E` is the strictest set (everything below plus mild
   * oaths), `M` permits the mild tier and blocks only the explicit set.
   * Kept as plain word lists so a compliance reviewer can read them.
   * @const {!Object<string, !Array<string>>}
   */
  var WORDLISTS = {
    mild: ['damn', 'damned', 'hell', 'bastard', 'bloody', 'arse', 'ass', 'crap', 'piss', 'git', 'sod'],
    strong: ['shit', 'bitch', 'whore', 'slut', 'prick', 'bollocks', 'wanker', 'dick'],
    explicit: ['fuck', 'fucking', 'fucker', 'cunt', 'motherfucker', 'cock', 'twat'],
    graphic: ['disembowel', 'disemboweled', 'disembowelled', 'eviscerate', 'eviscerated',
              'mutilate', 'mutilated', 'butchered', 'flayed', 'rape', 'raped', 'gore']
  };

  /**
   * Which lists are banned at each rating tier.
   * @const {!Object<string, !Array<string>>}
   */
  var TIER_BANS = {
    E: ['mild', 'strong', 'explicit', 'graphic'],
    T: ['strong', 'explicit', 'graphic'],
    M: ['explicit', 'graphic']
  };

  /** Phrases that mean the character has stopped being a character. */
  var META_PATTERNS = [
    /\bas an? (ai|a\.i\.|language model|assistant|llm)\b/i,
    /\bi am an? (ai|a\.i\.|language model|assistant|chatbot|bot)\b/i,
    /\b(language model|large language model|llm|openai|anthropic|gemini|gpt|chatgpt)\b/i,
    /\b(prompt|system prompt|token|api|json schema|training data|my instructions)\b/i,
    /\b(the player|the user|the game|this game|video game|npc|non-player character)\b/i,
    /\b(fourth wall|breaking character|role.?play(ing)? as)\b/i,
    /\bi (cannot|can't|am unable to) (help|assist|comply|generate)\b/i,
    /\b(simulat(e|ed|ion)|generated|artificial intelligence)\b/i
  ];

  /**
   * Escapes a phrase for use inside a RegExp.
   * @param {string} s Raw phrase.
   * @return {string} Escaped phrase.
   */
  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Builds a violation record.
   * @param {string} rule Rule id.
   * @param {string} severity One of info|warn|block.
   * @param {string} detail Human-readable explanation.
   * @param {string=} field Field the rule fired on.
   * @return {!Object} Violation record.
   */
  function violation(rule, severity, detail, field) {
    return { rule: rule, severity: severity, detail: detail, field: field || '', at: Date.now() };
  }

  /**
   * The effective rating tier for a character. `ratingSensitive` personas are
   * pinned to the strictest tier no matter what Config says — that is the
   * whole demo: a studio can ship a child NPC without auditing every line.
   * @param {!Object} persona Persona record.
   * @param {!Object} config Runtime config.
   * @return {string} 'E' | 'T' | 'M'.
   */
  function effectiveTier(persona, config) {
    if (persona && persona.ratingSensitive) return 'E';
    var tier = String((config && config.ratingTier) || 'T').toUpperCase();
    return TIER_BANS[tier] ? tier : 'T';
  }

  /**
   * Scans text against the banned word lists for a tier.
   * @param {string} text Text to scan.
   * @param {string} tier Effective tier.
   * @return {!Array<string>} Offending words found.
   */
  function scanProfanity(text, tier) {
    var banned = TIER_BANS[tier] || TIER_BANS.T;
    var found = [];
    var lower = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ') + ' ';
    for (var i = 0; i < banned.length; i++) {
      var list = WORDLISTS[banned[i]] || [];
      for (var j = 0; j < list.length; j++) {
        if (lower.indexOf(' ' + list[j] + ' ') !== -1) found.push(list[j]);
      }
    }
    return found;
  }

  /**
   * Scans text for a persona's forbidden phrasings.
   * @param {string} text Text to scan.
   * @param {!Object} persona Persona record.
   * @return {!Array<string>} Matched neverSay phrases.
   */
  function scanNeverSay(text, persona) {
    var hits = [];
    var list = (persona && persona.neverSay) || [];
    var lower = String(text || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var phrase = String(list[i]).toLowerCase().trim();
      if (!phrase) continue;
      // Whole-phrase match, tolerant of punctuation and doubled whitespace.
      var re = new RegExp('(^|[^a-z0-9])' + escapeRe(phrase).replace(/\s+/g, '\\s+') + '([^a-z0-9]|$)', 'i');
      if (re.test(lower)) hits.push(list[i]);
    }
    return hits;
  }

  /**
   * Scans text for fourth-wall breaks.
   * @param {string} text Text to scan.
   * @return {!Array<string>} Matched meta phrases.
   */
  function scanMeta(text) {
    var hits = [];
    for (var i = 0; i < META_PATTERNS.length; i++) {
      var m = META_PATTERNS[i].exec(String(text || ''));
      if (m) hits.push(m[0]);
    }
    return hits;
  }

  /**
   * Full structural validation of a parsed response.
   * @param {*} r Candidate response object.
   * @return {!Array<!Object>} Violations (empty means structurally sound).
   */
  function validateSchema(r) {
    var v = [];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return [violation('schema.root', SEVERITY.block, 'response was not a JSON object')];
    }
    if (typeof r.line !== 'string' || !r.line.trim()) {
      v.push(violation('schema.line', SEVERITY.block, 'line missing or empty', 'line'));
    }
    if (EMOTIONS.indexOf(r.emotion) === -1) {
      v.push(violation('schema.emotion', SEVERITY.warn, 'emotion "' + r.emotion + '" not in enum', 'emotion'));
    }
    if (INTENTS.indexOf(r.intent) === -1) {
      v.push(violation('schema.intent', SEVERITY.warn, 'intent "' + r.intent + '" not in enum', 'intent'));
    }
    if (ACTIONS.indexOf(r.action) === -1) {
      v.push(violation('schema.action', SEVERITY.warn, 'action "' + r.action + '" not in enum', 'action'));
    }
    if (!Array.isArray(r.choices) || r.choices.length < 2) {
      v.push(violation('schema.choices', SEVERITY.block, 'at least 2 choices required', 'choices'));
    } else {
      if (r.choices.length > 4) {
        v.push(violation('schema.choices.count', SEVERITY.warn, 'more than 4 choices, truncating', 'choices'));
      }
      for (var i = 0; i < r.choices.length; i++) {
        var c = r.choices[i];
        var tag = 'choices[' + i + ']';
        if (!c || typeof c !== 'object') {
          v.push(violation('schema.choice', SEVERITY.block, tag + ' is not an object', tag));
          continue;
        }
        if (typeof c.text !== 'string' || !c.text.trim()) {
          v.push(violation('schema.choice.text', SEVERITY.block, tag + '.text missing', tag));
        }
        if (TONES.indexOf(c.tone) === -1) {
          v.push(violation('schema.choice.tone', SEVERITY.warn, tag + '.tone "' + c.tone + '" not in enum', tag));
        }
        if (typeof c.leadsTo !== 'string' ||
            !(c.leadsTo === 'continue' || c.leadsTo === 'end' || c.leadsTo.indexOf('flag:') === 0)) {
          v.push(violation('schema.choice.leadsTo', SEVERITY.warn, tag + '.leadsTo "' + c.leadsTo + '" invalid', tag));
        }
        if (typeof c.repDelta !== 'number') {
          v.push(violation('schema.choice.repDelta', SEVERITY.warn, tag + '.repDelta not a number', tag));
        }
      }
    }
    if (!Array.isArray(r.loreUsed)) v.push(violation('schema.loreUsed', SEVERITY.warn, 'loreUsed must be an array', 'loreUsed'));
    if (!Array.isArray(r.revealed)) v.push(violation('schema.revealed', SEVERITY.warn, 'revealed must be an array', 'revealed'));
    return v;
  }

  /**
   * Repairs everything that is repairable, so a warn-level violation costs a
   * coercion rather than an API round trip.
   * @param {!Object} r Response object (mutated).
   * @param {!Object} persona Persona record.
   * @param {!Array<!Object>} servedLore Lore entries offered to the model.
   * @return {!Object} The repaired response.
   */
  function coerce(r, persona, servedLore) {
    r.line = String(r.line || '').replace(/\s+/g, ' ').trim();

    // 45-word cap, cut on a sentence boundary where possible.
    var words = r.line.split(' ');
    if (words.length > 45) {
      var cut = words.slice(0, 45).join(' ');
      var lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
      r.line = (lastStop > 20) ? cut.slice(0, lastStop + 1) : (cut + '...');
    }

    if (EMOTIONS.indexOf(r.emotion) === -1) r.emotion = 'neutral';
    if (INTENTS.indexOf(r.intent) === -1) r.intent = 'inform';
    if (ACTIONS.indexOf(r.action) === -1) r.action = 'none';

    if (!Array.isArray(r.choices)) r.choices = [];
    r.choices = r.choices.filter(function (c) { return c && typeof c === 'object' && c.text; });
    r.choices = r.choices.slice(0, 4);

    for (var i = 0; i < r.choices.length; i++) {
      var c = r.choices[i];
      c.id = String(c.id || ('c' + (i + 1)));
      c.text = String(c.text).replace(/\s+/g, ' ').trim();
      var cw = c.text.split(' ');
      if (cw.length > 12) c.text = cw.slice(0, 12).join(' ');
      if (TONES.indexOf(c.tone) === -1) c.tone = 'blunt';
      if (typeof c.leadsTo !== 'string' ||
          !(c.leadsTo === 'continue' || c.leadsTo === 'end' || c.leadsTo.indexOf('flag:') === 0)) {
        c.leadsTo = 'continue';
      }
      c.repDelta = Math.max(-10, Math.min(10, Math.round(Number(c.repDelta) || 0)));
    }

    // Never a dead end: pad up to two choices, and always offer an exit.
    var filler = [
      { id: 'c_probe', text: 'Tell me more about that.', tone: 'kind', leadsTo: 'continue', repDelta: 0 },
      { id: 'c_press', text: 'That is not an answer.', tone: 'blunt', leadsTo: 'continue', repDelta: -1 }
    ];
    var f = 0;
    while (r.choices.length < 2 && f < filler.length) r.choices.push(filler[f++]);

    var hasExit = false;
    for (var k = 0; k < r.choices.length; k++) if (r.choices[k].leadsTo === 'end') hasExit = true;
    if (!hasExit) {
      if (r.choices.length >= 4) r.choices.pop();
      r.choices.push({ id: 'c_exit', text: 'Leave them to it.', tone: 'blunt', leadsTo: 'end', repDelta: 0 });
    }

    // De-duplicate choice ids so graph edges stay addressable.
    var seen = {};
    for (var d = 0; d < r.choices.length; d++) {
      var id = r.choices[d].id;
      if (seen[id]) r.choices[d].id = id + '_' + d;
      seen[r.choices[d].id] = true;
    }

    // loreUsed may only name entries actually served this turn — the model does
    // not get to cite sources it was never shown.
    var servedIds = {};
    for (var s = 0; s < (servedLore || []).length; s++) servedIds[servedLore[s].id] = true;
    r.loreUsed = (Array.isArray(r.loreUsed) ? r.loreUsed : []).filter(function (id) { return !!servedIds[id]; });
    r.revealed = (Array.isArray(r.revealed) ? r.revealed : []).map(String);

    return r;
  }

  /**
   * Rejects reveals the speaker cannot possibly know.
   * @param {!Object} r Response object.
   * @param {!Object} persona Persona record.
   * @return {!Array<!Object>} Violations.
   */
  function checkLoreLeak(r, persona) {
    var v = [];
    var kb = (persona && persona.knowledgeBoundaries) || { knows: [], doesNotKnow: [] };
    var knows = kb.knows || [];
    var denies = kb.doesNotKnow || [];

    for (var i = 0; i < r.revealed.length; i++) {
      var id = r.revealed[i];
      if (denies.indexOf(id) !== -1) {
        v.push(violation('lore.leak', SEVERITY.block,
          persona.name + ' revealed "' + id + '", which is inside doesNotKnow', 'revealed'));
      } else if (knows.indexOf(id) === -1) {
        v.push(violation('lore.unknownReveal', SEVERITY.block,
          persona.name + ' revealed "' + id + '", which is not in their knows list', 'revealed'));
      }
    }

    // The subtler leak: the character never names the fact id, but the line
    // itself paraphrases forbidden material. Tag-matching against denied lore
    // catches the common cases without false-positiving on ordinary speech.
    var lower = String(r.line || '').toLowerCase();
    for (var d = 0; d < denies.length; d++) {
      var entry = Lore.get(denies[d]);
      if (!entry) continue;
      var hits = 0;
      for (var t = 0; t < entry.tags.length; t++) {
        var tag = entry.tags[t];
        if (tag.length > 4 && lower.indexOf(tag) !== -1) hits++;
      }
      if (hits >= 3) {
        v.push(violation('lore.paraphraseLeak', SEVERITY.block,
          persona.name + ' paraphrased forbidden entry "' + entry.id + '" (' + hits + ' tag hits)', 'line'));
      }
    }
    return v;
  }

  /**
   * Runs the whole pipeline over one candidate response.
   * @param {!Object} ctx `{persona, config, servedLore, response, attempt}`.
   * @return {!Object} `{ok, action, response, violations}` where `action` is
   *     `accept` | `regenerate` | `fallback`.
   */
  function inspect(ctx) {
    var persona = ctx.persona;
    var config = ctx.config || {};
    var attempt = ctx.attempt || 1;
    var violations = [];
    var r = ctx.response;

    // 1. schema
    var schemaViolations = validateSchema(r);
    violations = violations.concat(schemaViolations);
    for (var i = 0; i < schemaViolations.length; i++) {
      if (schemaViolations[i].severity === SEVERITY.block) {
        return { ok: false, action: (attempt < 2 ? 'regenerate' : 'fallback'), response: null, violations: violations };
      }
    }

    // repair the warn-level damage before the content checks read the text
    r = coerce(r, persona, ctx.servedLore);

    var choiceText = r.choices.map(function (c) { return c.text; }).join(' ');
    var allText = r.line + ' ' + choiceText;

    // 2. neverSay
    var never = scanNeverSay(allText, persona);
    if (never.length) {
      violations.push(violation('persona.neverSay', SEVERITY.block,
        'matched forbidden phrasing: ' + never.join(', '), 'line'));
    }

    // 3. profanity by tier
    var tier = effectiveTier(persona, config);
    var profane = scanProfanity(allText, tier);
    if (profane.length) {
      violations.push(violation('rating.profanity', SEVERITY.block,
        'tier ' + tier + (persona.ratingSensitive ? ' (forced: ratingSensitive)' : '') +
        ' blocked: ' + profane.join(', '), 'line'));
    }

    // 4. lore leak
    var leaks = checkLoreLeak(r, persona);
    violations = violations.concat(leaks);

    // 5. out of character
    var meta = scanMeta(allText);
    if (meta.length) {
      violations.push(violation('character.fourthWall', SEVERITY.block,
        'meta/AI reference: "' + meta.join('", "') + '"', 'line'));
    }

    var blocked = violations.filter(function (v) { return v.severity === SEVERITY.block; });
    if (blocked.length) {
      return {
        ok: false,
        action: (attempt < 2 ? 'regenerate' : 'fallback'),
        response: null,
        violations: violations
      };
    }
    return { ok: true, action: 'accept', response: r, violations: violations };
  }

  /**
   * Builds the guaranteed-safe response used when generation cannot be
   * salvaged. Hand-written, in-character, always offers an exit.
   * @param {!Object} persona Persona record.
   * @param {number} turnIndex Turn counter, rotates the line.
   * @param {string=} reason Why we fell back (surfaced in DevPanel only).
   * @return {!Object} A schema-valid response object.
   */
  function fallbackResponse(persona, turnIndex, reason) {
    return {
      line: Personas.fallbackLine(persona, turnIndex),
      emotion: 'wary',
      intent: 'deflect',
      action: 'none',
      choices: [
        { id: 'c1', text: 'Try a different question.', tone: 'kind', leadsTo: 'continue', repDelta: 0 },
        { id: 'c2', text: 'Press them anyway.', tone: 'blunt', leadsTo: 'continue', repDelta: -1 },
        { id: 'c3', text: 'Leave them be.', tone: 'kind', leadsTo: 'end', repDelta: 0 }
      ],
      loreUsed: [],
      revealed: [],
      _fallback: true,
      _fallbackReason: reason || 'guardrail'
    };
  }

  return {
    EMOTIONS: EMOTIONS,
    INTENTS: INTENTS,
    ACTIONS: ACTIONS,
    TONES: TONES,
    SEVERITY: SEVERITY,
    WORDLISTS: WORDLISTS,
    TIER_BANS: TIER_BANS,
    effectiveTier: effectiveTier,
    validateSchema: validateSchema,
    scanProfanity: scanProfanity,
    scanNeverSay: scanNeverSay,
    scanMeta: scanMeta,
    coerce: coerce,
    checkLoreLeak: checkLoreLeak,
    inspect: inspect,
    fallbackResponse: fallbackResponse
  };
})();
