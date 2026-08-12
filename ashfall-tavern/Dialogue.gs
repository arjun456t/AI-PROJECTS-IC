/**
 * Dialogue.gs — the generation engine.
 *
 * Assembles a grounded system prompt (persona + retrieved lore + world state +
 * per-NPC memory + explicit prohibitions), calls Gemini server-side, parses
 * strict JSON with one retry, runs the guardrail pipeline, mutates world state,
 * records the graph node and logs telemetry.
 *
 * The API key is read from Script Properties and never leaves the server.
 */

/** @const {!Object} */
var Dialogue = (function () {

  /** @const {string} */
  var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

  /** @const {number} Hard cap from the spec — keeps lines short and cheap. */
  var MAX_OUTPUT_TOKENS = 400;

  /** @const {number} How many turns of memory the prompt carries. */
  var MEMORY_IN_PROMPT = 6;

  /** @const {number} How many turns of memory we retain in state. */
  var MEMORY_RETAINED = 10;

  /**
   * USD per 1M tokens, used by the DevPanel cost estimator.
   * @const {!Object<string, !Object>}
   */
  var PRICING = {
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash': { input: 0.30, output: 2.50 }
  };

  /** @const {!Array<!Object>} Model-side safety; our own guardrails are the authority. */
  var SAFETY = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
  ];

  /**
   * The exact output contract handed to the model.
   * @const {string}
   */
  var SCHEMA_BLOCK = [
    '{',
    '  "line": "string, in character, MAX 45 words",',
    '  "emotion": "neutral|wary|angry|warm|afraid|amused",',
    '  "intent": "inform|deflect|threaten|plead|barter|dismiss",',
    '  "action": "gesture|step_back|lean_in|turn_away|none",',
    '  "choices": [',
    '    {"id":"c1","text":"what the PLAYER says next, MAX 12 words",',
    '     "tone":"kind|blunt|sly|hostile","leadsTo":"continue|end|flag:<name>","repDelta":0}',
    '  ],',
    '  "loreUsed": ["lore-id", "..."],',
    '  "revealed": ["fact-id", "..."]',
    '}'
  ].join('\n');

  /* ──────────────────────────────────────────────────────────────────────
   * PROMPT ASSEMBLY
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * Builds the system prompt for one turn.
   * @param {!Object} ctx `{persona, lore, state, memory, config, mood, facts, seed}`.
   * @return {string} The system prompt.
   */
  function buildSystemPrompt(ctx) {
    var p = ctx.persona;
    var lines = [];

    lines.push('You are the dialogue engine for a grim low-fantasy village game called Ashfall.');
    lines.push('You portray EXACTLY ONE character and never narrate for anyone else.');
    lines.push('');

    lines.push('## CHARACTER');
    lines.push('Name: ' + p.name);
    lines.push('Role: ' + p.role);
    lines.push('Backstory: ' + p.backstory);
    lines.push('Traits: ' + p.traits.join(', '));
    lines.push('Register: ' + p.speechStyle.register + '. Verbosity: ' + p.speechStyle.verbosity + '.');
    if (p.speechStyle.quirks.length) {
      lines.push('Verbal habits:');
      p.speechStyle.quirks.forEach(function (q) { lines.push('  - ' + q); });
    }
    lines.push('Current mood: ' + (ctx.mood || p.moodState.current) +
               ' — let it colour word choice and length, do not announce it.');
    lines.push('');

    lines.push('## RELATIONSHIPS');
    var relCount = 0;
    for (var other in p.relationships) {
      if (!Object.prototype.hasOwnProperty.call(p.relationships, other)) continue;
      var op = Personas.get(other);
      lines.push('- ' + ((op && op.name) || other) + ': ' + p.relationships[other]);
      relCount++;
    }
    if (!relCount) lines.push('- (none recorded)');
    lines.push('');

    lines.push('## FACTS YOU MAY USE THIS TURN');
    lines.push('These are the ONLY world facts that exist. Do not invent names, places,');
    lines.push('dates, numbers or events that are not written here.');
    if (ctx.lore.length) {
      ctx.lore.forEach(function (e) {
        lines.push('[' + e.id + '] (' + e.secrecy + ') ' + e.title + ' — ' + e.body);
      });
    } else {
      lines.push('(nothing retrieved — deflect rather than invent)');
    }
    lines.push('');

    lines.push('## WHAT YOU DO NOT KNOW');
    if (p.knowledgeBoundaries.doesNotKnow.length) {
      lines.push('You have never learned the following. If the player fishes for them,');
      lines.push('deflect honestly in character. Never hint, never half-confirm:');
      p.knowledgeBoundaries.doesNotKnow.forEach(function (id) {
        var f = Lore.getFact(id);
        var e = Lore.get(id);
        lines.push('  - ' + id + (f ? (' — ' + f.summary) : (e ? (' — ' + e.title) : '')));
      });
    } else {
      lines.push('(no restrictions recorded)');
    }
    lines.push('');

    var revealable = Lore.allowedFacts(p.id);
    if (revealable.length) {
      lines.push('## WHAT YOU COULD ADMIT (only if the scene truly earns it)');
      revealable.forEach(function (f) { lines.push('  - ' + f.id + ' — ' + f.summary); });
      lines.push('List any you actually admit in "revealed". Admitting nothing is the');
      lines.push('normal case; a guarded character does not confess on the first ask.');
      lines.push('');
    }

    lines.push('## WORLD STATE');
    lines.push('Time of day: ' + (ctx.state.timeOfDay || 'dusk'));
    lines.push('This character\'s regard for the player: ' +
               (ctx.state.npcRelationships[p.id] || 0) + ' (-10 hostile .. +10 trusted)');
    lines.push('Player standing in the village: ' + (ctx.state.reputation || 0));
    var flagKeys = Object.keys(ctx.state.questFlags || {});
    lines.push('Quest flags: ' + (flagKeys.length ? flagKeys.join(', ') : 'none set'));
    var already = (ctx.state.revealed || []);
    lines.push('Already revealed to the player: ' + (already.length ? already.join(', ') : 'nothing'));
    lines.push('');

    lines.push('## RECENT CONVERSATION WITH THIS PLAYER');
    if (ctx.memory.length) {
      ctx.memory.forEach(function (t) {
        lines.push((t.role === 'player' ? 'PLAYER: ' : (p.name.toUpperCase() + ': ')) + t.text);
      });
    } else {
      lines.push('(none — this is your first exchange)');
    }
    lines.push('');

    lines.push('## ABSOLUTE PROHIBITIONS');
    lines.push('Never say or imply any of these, in any wording:');
    p.neverSay.forEach(function (s) { lines.push('  - "' + s + '"'); });
    lines.push('  - anything about being an AI, a model, a prompt, a game or a player');
    lines.push('  - any modern idiom; this is a pre-industrial mining village');
    if (p.ratingSensitive) {
      lines.push('  - RATING LOCK: this character is a minor. No profanity, no sexual content,');
      lines.push('    no graphic violence, no substance use. ESRB E / PEGI 3 language only.');
    }
    lines.push('');

    lines.push('## CHOICES YOU WRITE FOR THE PLAYER');
    lines.push('Give 2-4 choices. Exactly one must be an exit with "leadsTo":"end".');
    lines.push('Choices are the PLAYER\'s words, not yours. Vary the tones.');
    lines.push('Use "leadsTo":"flag:<name>" when a choice should set a quest flag.');
    lines.push('repDelta is how much this character\'s regard shifts, -10..+10, usually -2..+2.');
    lines.push('Never write a choice that leaves the conversation with nowhere to go.');
    lines.push('');

    lines.push('## OUTPUT');
    lines.push('Return ONE JSON object and nothing else. No prose, no markdown, no code fences.');
    lines.push(SCHEMA_BLOCK);
    if (ctx.seed) {
      lines.push('');
      lines.push('Deterministic replay seed: ' + ctx.seed + ' (QA mode — be consistent).');
    }

    return lines.join('\n');
  }

  /**
   * Builds the user turn.
   * @param {!Object} persona Persona record.
   * @param {?string} playerChoiceText What the player said, or null on approach.
   * @return {string} The user message.
   */
  function buildUserTurn(persona, playerChoiceText) {
    if (playerChoiceText && String(playerChoiceText).trim()) {
      return 'PLAYER SAYS: "' + String(playerChoiceText).trim() + '"\n\n' +
             'Respond as ' + persona.name + '. JSON only.';
    }
    return 'The player has just walked up to ' + persona.name + ' and is waiting to be ' +
           'acknowledged. Open the conversation in character. JSON only.';
  }

  /* ──────────────────────────────────────────────────────────────────────
   * MODEL CALL
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * Calls Gemini. Never throws — failures come back as `{ok:false, error}`.
   * @param {string} systemPrompt System instruction.
   * @param {string} userTurn User message.
   * @param {!Object} config Runtime config.
   * @param {number} temperature Effective temperature.
   * @return {!Object} `{ok, text, latencyMs, usage, httpCode, error}`.
   */
  function callGemini(systemPrompt, userTurn, config, temperature) {
    var key = PropertiesService.getScriptProperties().getProperty(ASHFALL.PROP_API_KEY);
    if (!key) {
      return { ok: false, error: 'GEMINI_API_KEY is not set in Script Properties.', latencyMs: 0, httpCode: 0 };
    }

    var model = (config && config.model) || 'gemini-2.0-flash';
    var url = API_BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);

    var payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userTurn }] }],
      generationConfig: {
        temperature: temperature,
        topP: (temperature === 0) ? 1 : 0.95,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json'
      },
      safetySettings: SAFETY
    };

    var t0 = Date.now();
    var res;
    try {
      res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (err) {
      return { ok: false, error: 'network: ' + String(err && err.message || err), latencyMs: Date.now() - t0, httpCode: 0 };
    }

    var latency = Date.now() - t0;
    var code = res.getResponseCode();
    var body = res.getContentText();

    if (code !== 200) {
      var msg = 'HTTP ' + code;
      var errObj = SheetsDb.parseJson(body, null);
      if (errObj && errObj.error && errObj.error.message) msg += ': ' + errObj.error.message;
      return { ok: false, error: msg, latencyMs: latency, httpCode: code, raw: body };
    }

    var data = SheetsDb.parseJson(body, null);
    if (!data) return { ok: false, error: 'response body was not JSON', latencyMs: latency, httpCode: code, raw: body };

    if (data.promptFeedback && data.promptFeedback.blockReason) {
      return { ok: false, error: 'blocked by model safety: ' + data.promptFeedback.blockReason,
               latencyMs: latency, httpCode: code, raw: body };
    }

    var cand = data.candidates && data.candidates[0];
    if (!cand || !cand.content || !cand.content.parts || !cand.content.parts.length) {
      var reason = (cand && cand.finishReason) || 'no candidate returned';
      return { ok: false, error: 'empty completion (' + reason + ')', latencyMs: latency, httpCode: code, raw: body };
    }

    var text = '';
    for (var i = 0; i < cand.content.parts.length; i++) {
      if (cand.content.parts[i].text) text += cand.content.parts[i].text;
    }

    return {
      ok: true,
      text: text,
      latencyMs: latency,
      httpCode: code,
      usage: data.usageMetadata || null,
      finishReason: cand.finishReason || 'STOP'
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
   * PARSING
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * Strips markdown fences and any prose wrapped around the JSON body, then
   * parses. Models are told not to fence; models fence anyway.
   * @param {string} text Raw completion text.
   * @return {?Object} Parsed object, or null.
   */
  function parseModelJson(text) {
    if (!text) return null;
    var s = String(text).trim();

    // ```json ... ``` or ``` ... ```
    s = s.replace(/^\s*```(?:json|JSON)?\s*/, '').replace(/\s*```\s*$/, '');

    var direct = SheetsDb.parseJson(s, null);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;

    // Fall back to the outermost balanced brace span, ignoring braces in strings.
    var start = s.indexOf('{');
    if (start === -1) return null;
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < s.length; i++) {
      var ch = s.charAt(i);
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          var span = s.slice(start, i + 1);
          var parsed = SheetsDb.parseJson(span, null);
          if (parsed) return parsed;
          // One repair pass: trailing commas are the usual culprit.
          return SheetsDb.parseJson(span.replace(/,\s*([}\]])/g, '$1'), null);
        }
      }
    }
    return null;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * STATE EFFECTS
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * Normalises the transient conversation cursor the client carries.
   * @param {*} raw Candidate cursor.
   * @param {string} npcId Current speaker.
   * @return {!Object} `{npcId, path, parentNode, pendingChoice}`.
   */
  function normalizeConversation(raw, npcId) {
    var c = (raw && typeof raw === 'object') ? raw : {};
    var sameNpc = (c.npcId === npcId);
    return {
      npcId: npcId,
      path: (sameNpc && Array.isArray(c.path)) ? c.path.slice(-12).map(String) : [],
      parentNode: (sameNpc && c.parentNode) ? String(c.parentNode) : '',
      pendingChoice: (c.pendingChoice && typeof c.pendingChoice === 'object') ? c.pendingChoice : null
    };
  }

  /**
   * Applies the consequences of the choice the player just clicked.
   * @param {!Object} state World state (mutated).
   * @param {string} npcId Speaking character.
   * @param {?Object} choice The chosen choice object, or null.
   * @return {!Array<string>} Human-readable effects, for the DevPanel.
   */
  function applyChoiceEffects(state, npcId, choice) {
    var effects = [];
    if (!choice) return effects;

    var delta = Math.max(-10, Math.min(10, Math.round(Number(choice.repDelta) || 0)));
    if (delta) {
      var before = state.npcRelationships[npcId] || 0;
      state.npcRelationships[npcId] = Math.max(-10, Math.min(10, before + delta));
      state.reputation = Math.max(-30, Math.min(30, (state.reputation || 0) + Math.round(delta / 2)));
      effects.push('rep ' + npcId + ': ' + before + ' → ' + state.npcRelationships[npcId]);
    }

    var leadsTo = String(choice.leadsTo || '');
    if (leadsTo.indexOf('flag:') === 0) {
      var flag = leadsTo.slice(5).trim();
      if (flag) {
        state.questFlags[flag] = true;
        effects.push('flag set: ' + flag);
      }
    }
    return effects;
  }

  /**
   * Records the exchange in the NPC's memory and advances its mood.
   * @param {!Object} state World state (mutated).
   * @param {!Object} persona Persona record.
   * @param {?string} playerText What the player said.
   * @param {!Object} response The accepted response.
   * @return {string} The NPC's new mood.
   */
  function updateMemory(state, persona, playerText, response) {
    var mem = state.npcMemory[persona.id] || { mood: persona.moodState.current, turns: [] };
    if (playerText && String(playerText).trim()) {
      mem.turns.push({ role: 'player', text: String(playerText).trim() });
    } else if (!mem.turns.length) {
      mem.turns.push({ role: 'player', text: '(approaches without speaking)' });
    }
    mem.turns.push({
      role: 'npc',
      text: response.line,
      emotion: response.emotion,
      intent: response.intent
    });
    if (mem.turns.length > MEMORY_RETAINED) mem.turns = mem.turns.slice(-MEMORY_RETAINED);

    mem.mood = Personas.advanceMood(persona, mem.mood, playerText, response);
    state.npcMemory[persona.id] = mem;

    for (var i = 0; i < (response.revealed || []).length; i++) {
      var id = response.revealed[i];
      if (state.revealed.indexOf(id) === -1) state.revealed.push(id);
    }
    state.turnCount = (state.turnCount || 0) + 1;
    return mem.mood;
  }

  /**
   * Rough token estimate when the API does not report usage.
   * @param {string} text Text to measure.
   * @return {number} Estimated tokens.
   */
  function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
  }

  /**
   * Projected USD cost of 1000 generated lines at the observed token mix.
   * @param {string} model Model id.
   * @param {number} inTokens Prompt tokens for one line.
   * @param {number} outTokens Completion tokens for one line.
   * @return {number} USD per 1000 lines, rounded to 4 decimals.
   */
  function costPer1000(model, inTokens, outTokens) {
    var price = PRICING[model] || PRICING['gemini-2.0-flash'];
    var usd = (inTokens / 1e6) * price.input * 1000 + (outTokens / 1e6) * price.output * 1000;
    return Math.round(usd * 10000) / 10000;
  }

  /* ──────────────────────────────────────────────────────────────────────
   * MAIN ENTRY
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * Generates one NPC turn end to end.
   * @param {string} npcId Persona id.
   * @param {?string} playerChoiceText What the player said (null = approach).
   * @param {?string} stateJson Serialised world state.
   * @return {!Object} `{ok, npcId, response, state, debug}`.
   */
  function generateLine(npcId, playerChoiceText, stateJson) {
    var persona = Personas.get(npcId);
    if (!persona) {
      return {
        ok: false,
        npcId: npcId,
        response: Guardrails.fallbackResponse(
          { name: 'Stranger', fallbackLines: ['...'], moodState: { current: 'neutral' } }, 0, 'unknown npc'),
        state: SheetsDb.parseJson(stateJson, null) || SheetsDb.newState(ASHFALL.DEFAULT_PLAYER),
        debug: { error: 'Unknown npcId: ' + npcId, violations: [] }
      };
    }

    var config = SheetsDb.readConfig();
    var rawState = SheetsDb.parseJson(stateJson, null);
    var playerId = (rawState && rawState.playerId) || ASHFALL.DEFAULT_PLAYER;
    var state = SheetsDb.normalizeState(rawState, playerId);
    var convo = normalizeConversation(rawState && rawState.conversation, npcId);

    // The player's click is resolved BEFORE the NPC answers it.
    var effects = applyChoiceEffects(state, npcId, convo.pendingChoice);

    var memory = (state.npcMemory[npcId] && state.npcMemory[npcId].turns) || [];
    var promptMemory = memory.slice(-MEMORY_IN_PROMPT);
    var mood = (state.npcMemory[npcId] && state.npcMemory[npcId].mood) || persona.moodState.current;

    var query = String(playerChoiceText || (persona.role + ' ' + persona.traits.join(' ')));
    var memoryText = promptMemory.map(function (t) { return t.text; });
    var servedLore = Lore.retrieve(query, npcId, { limit: 4, memory: memoryText });

    var path = convo.path.concat([playerChoiceText || '(approach)']);
    var detKey = Determinism.keyFor(npcId, state, path, config);
    var temperature = Determinism.effectiveTemperature(config);

    var debug = {
      npcId: npcId,
      model: config.model,
      temperature: temperature,
      deterministicMode: !!config.deterministicMode,
      ratingTier: Guardrails.effectiveTier(persona, config),
      loreIds: servedLore.map(function (e) { return e.id; }),
      loreDetail: servedLore.map(function (e) {
        return { id: e.id, title: e.title, secrecy: e.secrecy, score: e.score };
      }),
      retriever: Lore.retriever.name,
      prompt: '',
      userTurn: '',
      raw: '',
      latencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensEst: 0,
      costPer1000Lines: 0,
      attempts: 0,
      cached: false,
      cacheKey: detKey,
      worldStateHash: Determinism.worldStateHash(state, npcId),
      violations: [],
      effects: effects,
      fallbackUsed: false,
      error: ''
    };

    // ── determinism cache ────────────────────────────────────────────────
    if (config.deterministicMode) {
      var hit = Determinism.get(detKey);
      if (hit && hit.response) {
        var cachedResponse = hit.response;
        var cachedMood = updateMemory(state, persona, playerChoiceText, cachedResponse);
        debug.cached = true;
        debug.cacheTier = hit.cacheTier || 'memory';
        debug.prompt = (hit.debug && hit.debug.prompt) || '(served from deterministic cache)';
        debug.raw = (hit.debug && hit.debug.raw) || JSON.stringify(cachedResponse);
        debug.latencyMs = 0;
        debug.tokensIn = (hit.debug && hit.debug.tokensIn) || 0;
        debug.tokensOut = (hit.debug && hit.debug.tokensOut) || 0;
        debug.tokensEst = debug.tokensIn + debug.tokensOut;
        debug.costPer1000Lines = 0;
        debug.mood = cachedMood;
        debug.nodeId = Exporter.nodeIdFor(npcId, path);
        Exporter.recordTurn(npcId, convo.parentNode, path, cachedResponse);
        SheetsDb.logDialogue({
          npcId: npcId, prompt: '(cache hit) ' + detKey, rawResponse: JSON.stringify(cachedResponse),
          latencyMs: 0, tokensEst: 0, violations: []
        });
        return envelope(true, npcId, cachedResponse, state, convo, path, debug);
      }
    }

    // ── generate, with one retry ─────────────────────────────────────────
    var systemPrompt = buildSystemPrompt({
      persona: persona, lore: servedLore, state: state, memory: promptMemory,
      config: config, mood: mood,
      seed: config.deterministicMode ? Determinism.seedFromKey(detKey) : 0
    });
    var userTurn = buildUserTurn(persona, playerChoiceText);
    debug.prompt = systemPrompt;
    debug.userTurn = userTurn;

    var accepted = null;
    var lastError = '';
    var allViolations = [];

    for (var attempt = 1; attempt <= 2 && !accepted; attempt++) {
      debug.attempts = attempt;

      var sys = systemPrompt;
      if (attempt === 2) {
        sys += '\n\n## RETRY NOTICE\nThe previous attempt was rejected: ' + lastError +
               '\nReturn ONE valid JSON object matching the schema exactly. ' +
               'No fences, no commentary, and obey every prohibition above.';
      }

      var call = callGemini(sys, userTurn, config, temperature);
      debug.latencyMs += call.latencyMs || 0;

      if (!call.ok) {
        lastError = call.error;
        debug.error = call.error;
        allViolations.push({
          rule: 'api.call', severity: 'block',
          detail: call.error, field: '', at: Date.now()
        });
        continue;
      }

      debug.raw = call.text;
      if (call.usage) {
        debug.tokensIn = call.usage.promptTokenCount || 0;
        debug.tokensOut = call.usage.candidatesTokenCount || 0;
      } else {
        debug.tokensIn = estimateTokens(sys + userTurn);
        debug.tokensOut = estimateTokens(call.text);
      }

      var parsed = parseModelJson(call.text);
      if (!parsed) {
        lastError = 'response was not parseable JSON';
        allViolations.push({
          rule: 'parse.json', severity: 'block',
          detail: lastError + ' (attempt ' + attempt + ')', field: '', at: Date.now()
        });
        continue;
      }

      var verdict = Guardrails.inspect({
        persona: persona, config: config, servedLore: servedLore,
        response: parsed, attempt: attempt
      });
      allViolations = allViolations.concat(verdict.violations);

      if (verdict.ok) {
        accepted = verdict.response;
      } else {
        lastError = verdict.violations
          .filter(function (v) { return v.severity === 'block'; })
          .map(function (v) { return v.rule + ' (' + v.detail + ')'; })
          .join('; ') || 'guardrail rejection';
        if (verdict.action === 'fallback') break;
      }
    }

    // ── fallback ─────────────────────────────────────────────────────────
    if (!accepted) {
      accepted = Guardrails.fallbackResponse(persona, state.turnCount || 0, lastError);
      debug.fallbackUsed = true;
      debug.error = debug.error || lastError;
    }

    debug.violations = allViolations;
    debug.tokensEst = debug.tokensIn + debug.tokensOut;
    debug.costPer1000Lines = costPer1000(config.model, debug.tokensIn, debug.tokensOut);
    debug.mood = updateMemory(state, persona, playerChoiceText, accepted);
    debug.nodeId = Exporter.nodeIdFor(npcId, path);

    Exporter.recordTurn(npcId, convo.parentNode, path, accepted);

    SheetsDb.logDialogue({
      npcId: npcId,
      prompt: systemPrompt + '\n\n---USER---\n' + userTurn,
      rawResponse: debug.raw || JSON.stringify(accepted),
      latencyMs: debug.latencyMs,
      tokensEst: debug.tokensEst,
      violations: allViolations
    });

    if (config.deterministicMode && !debug.fallbackUsed) {
      Determinism.put(detKey, {
        response: accepted,
        debug: { prompt: systemPrompt, raw: debug.raw, tokensIn: debug.tokensIn, tokensOut: debug.tokensOut }
      });
    }

    return envelope(!debug.fallbackUsed, npcId, accepted, state, convo, path, debug);
  }

  /**
   * Packs the client response, including the advanced conversation cursor.
   * @param {boolean} ok Whether generation succeeded (false = fallback served).
   * @param {string} npcId Speaker.
   * @param {!Object} response Accepted response.
   * @param {!Object} state Mutated world state.
   * @param {!Object} convo Incoming conversation cursor.
   * @param {!Array<string>} path Choice path including this turn.
   * @param {!Object} debug Debug payload.
   * @return {!Object} Client envelope.
   */
  function envelope(ok, npcId, response, state, convo, path, debug) {
    state.conversation = {
      npcId: npcId,
      path: path,
      parentNode: debug.nodeId || '',
      pendingChoice: null
    };
    return { ok: ok, npcId: npcId, response: response, state: state, debug: debug };
  }

  /**
   * Last-resort envelope for a failure the engine could not classify.
   * @param {string} npcId Speaker.
   * @param {?string} stateJson Incoming state.
   * @param {string} message Error text.
   * @return {!Object} Client envelope carrying a fallback line.
   */
  function emergencyEnvelope(npcId, stateJson, message) {
    var persona = Personas.get(npcId) ||
        { id: npcId, name: 'Stranger', fallbackLines: ['...'], moodState: { current: 'neutral' } };
    var state = SheetsDb.normalizeState(SheetsDb.parseJson(stateJson, null), ASHFALL.DEFAULT_PLAYER);
    return {
      ok: false,
      npcId: npcId,
      response: Guardrails.fallbackResponse(persona, state.turnCount || 0, message),
      state: state,
      debug: {
        npcId: npcId, error: message, fallbackUsed: true, violations: [
          { rule: 'engine.exception', severity: 'block', detail: message, field: '', at: Date.now() }
        ], loreIds: [], prompt: '', raw: '', latencyMs: 0, tokensEst: 0, costPer1000Lines: 0
      }
    };
  }

  return {
    PRICING: PRICING,
    MEMORY_IN_PROMPT: MEMORY_IN_PROMPT,
    buildSystemPrompt: buildSystemPrompt,
    buildUserTurn: buildUserTurn,
    callGemini: callGemini,
    parseModelJson: parseModelJson,
    normalizeConversation: normalizeConversation,
    applyChoiceEffects: applyChoiceEffects,
    updateMemory: updateMemory,
    estimateTokens: estimateTokens,
    costPer1000: costPer1000,
    generateLine: generateLine,
    emergencyEnvelope: emergencyEnvelope
  };
})();
