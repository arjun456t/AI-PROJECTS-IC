/**
 * Determinism.gs — reproducible generation for QA.
 *
 * WHY A STUDIO PAYS FOR THIS: a bug report that says "the innkeeper leaked the
 * act-three twist" is worthless if the tester cannot reproduce it. With
 * `deterministicMode` on, temperature drops to 0 and every response is cached
 * against a hash of (npc + world state + choice path). The same inputs return
 * the byte-identical line, forever, on any machine.
 *
 * Two-tier cache: CacheService (fast, 6h TTL) in front of a Sheet tab
 * (permanent, survives redeploys).
 */

/** @const {!Object} */
var Determinism = (function () {

  /** @const {number} CacheService TTL in seconds (max allowed is 21600). */
  var CACHE_TTL_SECONDS = 21600;

  /** @const {number} CacheService rejects values over 100KB. */
  var CACHE_MAX_BYTES = 96000;

  /**
   * FNV-1a 32-bit hash, rendered as 8 hex chars. Stable across runtimes, which
   * matters because a QA seed has to mean the same thing on every machine.
   * @param {string} str Input.
   * @return {string} 8-character lowercase hex digest.
   */
  function hash(str) {
    var h = 0x811c9dc5;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      // h *= 16777619, done with shifts to stay inside 32-bit int math.
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      h = h >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  /**
   * Canonical JSON: object keys sorted recursively so that two structurally
   * identical states hash identically regardless of key insertion order.
   * @param {*} value Any JSON-safe value.
   * @return {string} Canonical serialisation.
   */
  function canonical(value) {
    if (value === null || value === undefined) return 'null';
    var t = typeof value;
    if (t === 'number') return isFinite(value) ? String(value) : 'null';
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i++) parts.push(canonical(value[i]));
      return '[' + parts.join(',') + ']';
    }
    var keys = Object.keys(value).sort();
    var out = [];
    for (var k = 0; k < keys.length; k++) {
      out.push(JSON.stringify(keys[k]) + ':' + canonical(value[keys[k]]));
    }
    return '{' + out.join(',') + '}';
  }

  /**
   * Hashes only the parts of world state that can legitimately change what an
   * NPC says. Cosmetic fields (player position, camera) are excluded so the
   * cache is not defeated by irrelevant churn.
   * @param {!Object} state Full world state.
   * @param {string} npcId Speaking character.
   * @return {string} World state digest.
   */
  function worldStateHash(state, npcId) {
    var s = state || {};
    var mem = (s.npcMemory && s.npcMemory[npcId]) || {};
    var slice = {
      flags: s.questFlags || {},
      rep: (s.npcRelationships && s.npcRelationships[npcId]) || 0,
      globalRep: s.reputation || 0,
      time: s.timeOfDay || 'dusk',
      mood: mem.mood || '',
      revealed: (s.revealed || []).slice(0).sort()
    };
    return hash(canonical(slice));
  }

  /**
   * The QA-reproducible cache key.
   * @param {string} npcId Speaking character.
   * @param {!Object} state World state.
   * @param {!Array<string>} choicePath Ordered player choices this conversation.
   * @param {!Object} config Runtime config (model + tier change output).
   * @return {string} Cache key.
   */
  function keyFor(npcId, state, choicePath, config) {
    var parts = [
      'v1', npcId,
      worldStateHash(state, npcId),
      hash(canonical(choicePath || [])),
      (config && config.model) || '',
      (config && config.ratingTier) || ''
    ];
    return 'ashfall:' + hash(parts.join('|')) + ':' + npcId;
  }

  /**
   * A stable integer seed derived from the same inputs — handed to the model in
   * the prompt so its own sampling has a fixed anchor too.
   * @param {string} key Cache key.
   * @return {number} 31-bit positive integer.
   */
  function seedFromKey(key) {
    return parseInt(hash(key), 16) % 2147483647;
  }

  /**
   * Cache read: memory tier first, then the durable Sheet tier.
   * @param {string} key Cache key.
   * @return {?Object} `{response, debug}` payload, or null on a miss.
   */
  function get(key) {
    try {
      var cached = CacheService.getScriptCache().get(key);
      if (cached) {
        var hit = SheetsDb.parseJson(cached, null);
        if (hit) { hit.cacheTier = 'memory'; return hit; }
      }
    } catch (err) {
      // fall through to the durable tier
    }
    var durable = SheetsDb.detCacheGet(key);
    if (durable) {
      var row = SheetsDb.parseJson(durable, null);
      if (row) {
        row.cacheTier = 'sheet';
        try { CacheService.getScriptCache().put(key, durable, CACHE_TTL_SECONDS); } catch (e) { /* best effort */ }
        return row;
      }
    }
    return null;
  }

  /**
   * Cache write to both tiers.
   * @param {string} key Cache key.
   * @param {!Object} payload `{response, debug}` to store.
   * @return {boolean} True when at least one tier accepted it.
   */
  function put(key, payload) {
    var text = JSON.stringify(payload);
    var okAny = false;
    if (text.length < CACHE_MAX_BYTES) {
      try {
        CacheService.getScriptCache().put(key, text, CACHE_TTL_SECONDS);
        okAny = true;
      } catch (err) { /* best effort */ }
    }
    if (SheetsDb.detCachePut(key, text)) okAny = true;
    return okAny;
  }

  /**
   * Drops one key from both tiers (used when a guardrail rejects a cached line
   * after a config tier change).
   * @param {string} key Cache key.
   * @return {boolean} Always true.
   */
  function invalidate(key) {
    try { CacheService.getScriptCache().remove(key); } catch (err) { /* ignore */ }
    SheetsDb.detCachePut(key, '');
    return true;
  }

  /**
   * The temperature to actually send, given config.
   * @param {!Object} config Runtime config.
   * @return {number} 0 in deterministic mode, else the configured value.
   */
  function effectiveTemperature(config) {
    if (config && config.deterministicMode) return 0;
    var t = (config && typeof config.temperature === 'number') ? config.temperature : 0.85;
    return Math.max(0, Math.min(2, t));
  }

  return {
    hash: hash,
    canonical: canonical,
    worldStateHash: worldStateHash,
    keyFor: keyFor,
    seedFromKey: seedFromKey,
    get: get,
    put: put,
    invalidate: invalidate,
    effectiveTemperature: effectiveTemperature
  };
})();
