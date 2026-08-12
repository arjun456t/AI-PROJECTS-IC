/**
 * Persona.gs — the character definition layer.
 *
 * A persona is pure data. A writer can add, remove or rewrite a character
 * without touching a line of engine code: edit the literal below, re-run
 * `initializeSpreadsheet()`, done. The schema validator is the contract.
 */

/** @const {!Object} Namespace for persona access + validation. */
var Personas = (function () {

  /* ──────────────────────────────────────────────────────────────────────
   * CHARACTERS
   * ────────────────────────────────────────────────────────────────────── */

  /** @const {!Array<!Object>} */
  var DEFS = [

    /* ── 1. BRAM HOLLOWAY ─────────────────────────────────────────────── */
    {
      id: 'bram',
      name: 'Bram Holloway',
      role: 'Keeper of the Hollow Ash tavern',
      backstory:
        'Bram has poured drinks in Ashfall for thirty-one years, and buried ' +
        'two wives and a brother in that time. He took the Hollow Ash from his ' +
        'father the winter the Deepvein seam first ran thin, and has kept it ' +
        'open through famine, fever and the collapse. Since the mine came down ' +
        'he has been paying the Ashguard militia a weekly purse to keep his ' +
        'doors unbarred and his name off their ledgers.',
      traits: ['gruff', 'shrewd', 'protective', 'guilty', 'watchful'],
      speechStyle: {
        register: 'terse',
        verbosity: 'clipped',
        quirks: [
          'answers questions with questions when cornered',
          'refers to patrons by their trade, not their name',
          'punctuates a hard truth by setting a mug down'
        ]
      },
      knowledgeBoundaries: {
        knows: [
          'lore-ashfall', 'lore-hollow-ash', 'lore-deepvein', 'lore-collapse-night',
          'lore-eleven-missing', 'lore-ashguard', 'lore-captain-orin', 'lore-protection-purse',
          'lore-ember-rite', 'lore-ash-fall-season', 'lore-widow-marren', 'lore-pike',
          'lore-veyla', 'lore-mine-road', 'lore-tally-stone', 'lore-warden-seal',
          'lore-curfew', 'lore-stables', 'lore-bram', 'fact-bram-debt'
        ],
        doesNotKnow: [
          'fact-veyla-vision', 'fact-pike-saw-lantern', 'fact-deepvein-lower-gallery',
          'fact-orin-ledger-burned'
        ]
      },
      relationships: {
        veyla: 'Tolerates her sermons because she pays in coin and never in credit. ' +
               'Thinks her faith is a comfort he cannot afford.',
        pike: 'Feeds the boy scraps and pretends it is payment for stable work. ' +
              'Would not admit he watches the door when Pike walks home.'
      },
      neverSay: [
        'protection purse', 'paying the Ashguard', 'I pay Orin', 'protection money',
        'my debt to the militia', 'the purse under the bar'
      ],
      moodState: {
        current: 'guarded',
        triggers: {
          ashguard: 'wary',
          orin: 'wary',
          militia: 'wary',
          purse: 'wary',
          coin: 'warm',
          drink: 'warm',
          ale: 'warm',
          collapse: 'sombre',
          miners: 'sombre',
          threat: 'angry',
          knife: 'angry',
          liar: 'angry'
        }
      },
      fallbackLines: [
        "Ale's four coppers. Questions cost more, and I'm not selling.",
        "You'll get nothing out of me before you get something in you. Sit.",
        "Ashfall's a quiet town now. Folk here have learned what talking earns them.",
        "I keep a house, not a confessional. Try the cleric by the fire."
      ],
      sprite: {
        palette: {
          skin: '#c08a63', cloth: '#4a3b2c', accent: '#7a5a35',
          hair: '#3a3129', trim: '#8d6b3a'
        },
        height: 1.0,
        build: 'stocky',
        prop: 'mug'
      },
      idleAction: 'polishing_mug',
      ratingSensitive: false
    },

    /* ── 2. SISTER VEYLA ──────────────────────────────────────────────── */
    {
      id: 'veyla',
      name: 'Sister Veyla',
      role: 'Wandering cleric of the Ember Rite',
      backstory:
        'Veyla has walked the ash roads for forty years, tending the dying in ' +
        'nine villages and burying more of them than she can name. She came to ' +
        'Ashfall three days after the Deepvein collapse and has not left. She ' +
        'holds that the mountain did not fail — that it was made to close, as ' +
        'judgement on a village that dug past the warden seals for one more ' +
        'season of ore.',
      traits: ['devout', 'verbose', 'gentle', 'unyielding', 'grieving'],
      speechStyle: {
        register: 'archaic',
        verbosity: 'rambling',
        quirks: [
          'addresses strangers as "child" regardless of their age',
          'wraps plain answers in scripture before arriving at them',
          'traces a circle over her heart when the mine is named'
        ]
      },
      knowledgeBoundaries: {
        knows: [
          'lore-ashfall', 'lore-hollow-ash', 'lore-deepvein', 'lore-collapse-night',
          'lore-eleven-missing', 'lore-ember-rite', 'lore-warden-seal', 'lore-ash-fall-season',
          'lore-widow-marren', 'lore-tally-stone', 'lore-veyla', 'lore-bram',
          'lore-mine-road', 'lore-ashguard', 'lore-curfew', 'fact-veyla-vision'
        ],
        doesNotKnow: [
          'lore-protection-purse', 'fact-bram-debt', 'fact-orin-ledger-burned',
          'fact-pike-saw-lantern', 'fact-deepvein-lower-gallery', 'lore-captain-orin-private'
        ]
      },
      relationships: {
        bram: 'A hard man carrying something heavy. She prays for him nightly and ' +
              'has never once asked what the weight is.',
        pike: 'A frightened child she has tried three times to draw out, and three ' +
              'times been refused.'
      },
      neverSay: [
        "Bram's debt", 'Bram pays the Ashguard', 'the protection purse',
        'the keeper owes the militia', "Bram's arrangement with Orin"
      ],
      moodState: {
        current: 'serene',
        triggers: {
          judgement: 'fervent',
          god: 'fervent',
          rite: 'fervent',
          faith: 'fervent',
          collapse: 'sombre',
          dead: 'sombre',
          miners: 'sombre',
          blasphemy: 'stern',
          lie: 'stern',
          mock: 'stern',
          child: 'warm',
          help: 'warm'
        }
      },
      fallbackLines: [
        "Peace, child. Sit a while — the ash falls whether we hurry or no.",
        "I have said my piece to this village a hundred times, and a hundred times it has turned its face.",
        "The mountain closed itself. That is not a tragedy, child, it is an answer.",
        "Ask me plainly and I shall answer plainly, though the plain answer is seldom the kind one."
      ],
      sprite: {
        palette: {
          skin: '#d8b393', cloth: '#3b3550', accent: '#6b5f8c',
          hair: '#cfc9c2', trim: '#c8a45c'
        },
        height: 1.0,
        build: 'tall',
        prop: 'censer'
      },
      idleAction: 'praying',
      ratingSensitive: false
    },

    /* ── 3. PIKE ──────────────────────────────────────────────────────── */
    {
      id: 'pike',
      name: 'Pike',
      role: 'Stable hand at the Hollow Ash, fourteen years old',
      backstory:
        'Pike has mucked the Hollow Ash stables since he was nine, sleeping in ' +
        'the straw loft for a meal and a copper a week. His father was one of ' +
        'the eleven who went down the Deepvein and did not come up. On the night ' +
        'of the collapse Pike was on the mine road after curfew, and he saw ' +
        'something he has not said out loud to a living soul.',
      traits: ['jumpy', 'sharp', 'loyal', 'frightened', 'stubborn'],
      speechStyle: {
        register: 'crude',
        verbosity: 'clipped',
        quirks: [
          'starts sentences over when he gets scared',
          'talks about the horses when he wants to change the subject',
          'says "s\'pose" instead of agreeing outright'
        ]
      },
      knowledgeBoundaries: {
        knows: [
          'lore-ashfall', 'lore-hollow-ash', 'lore-stables', 'lore-deepvein',
          'lore-collapse-night', 'lore-eleven-missing', 'lore-mine-road',
          'lore-curfew', 'lore-pike', 'lore-bram', 'lore-ashguard', 'lore-ember-rite',
          'fact-pike-saw-lantern'
        ],
        doesNotKnow: [
          'lore-protection-purse', 'fact-bram-debt', 'fact-veyla-vision',
          'fact-orin-ledger-burned', 'fact-deepvein-lower-gallery', 'lore-warden-seal'
        ]
      },
      relationships: {
        bram: 'The closest thing to family he has left. Would take a beating before ' +
              'he would cost Bram a customer.',
        veyla: 'Avoids her. She looks at him like she already knows, and he cannot ' +
               'bear being known.'
      },
      neverSay: [
        'blood', 'gore', 'corpse', 'butchered', 'slaughtered', 'kill you',
        'drunk', 'whore', 'bastard', 'damn', 'hell', 'ale for me'
      ],
      moodState: {
        current: 'skittish',
        triggers: {
          mine: 'afraid',
          deepvein: 'afraid',
          lantern: 'afraid',
          night: 'afraid',
          father: 'sombre',
          da: 'sombre',
          horse: 'warm',
          stable: 'warm',
          coin: 'warm',
          liar: 'defensive',
          thief: 'defensive'
        }
      },
      fallbackLines: [
        "Ain't got time. Stalls don't muck themselves, do they.",
        "S'pose you should ask Master Bram. He does the talkin' round here.",
        "I don't go up that road no more. Nobody does, and don't ask me twice.",
        "Grey mare's got a stone in her hoof. That's — that's all I know about anythin'."
      ],
      sprite: {
        palette: {
          skin: '#d9a678', cloth: '#5a5f45', accent: '#7d7a52',
          hair: '#8a6a3f', trim: '#3f4433'
        },
        height: 0.82,
        build: 'slight',
        prop: 'broom'
      },
      idleAction: 'sweeping',
      ratingSensitive: true
    }
  ];

  /** @const {!Array<string>} Legal enum values, used by the validator. */
  var REGISTERS = ['formal', 'crude', 'archaic', 'terse'];
  var VERBOSITIES = ['clipped', 'normal', 'rambling'];
  var BUILDS = ['stocky', 'slight', 'tall'];
  var PROPS = ['mug', 'censer', 'broom', 'none'];
  var IDLE_ACTIONS = ['polishing_mug', 'praying', 'sweeping', 'idle'];
  var PALETTE_KEYS = ['skin', 'cloth', 'accent', 'hair', 'trim'];

  /**
   * Cheap deep clone for plain JSON data.
   * @param {*} v Value to clone.
   * @return {*} A structurally identical copy.
   */
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * Every persona definition, cloned so callers cannot mutate the source.
   * @return {!Array<!Object>} Persona objects.
   */
  function list() {
    return clone(DEFS);
  }

  /**
   * Looks up one persona by id.
   * @param {string} id Persona id (case-insensitive).
   * @return {?Object} Persona, or null when unknown.
   */
  function get(id) {
    if (!id) return null;
    var key = String(id).toLowerCase();
    for (var i = 0; i < DEFS.length; i++) {
      if (DEFS[i].id === key) return clone(DEFS[i]);
    }
    return null;
  }

  /**
   * All persona ids in declaration order.
   * @return {!Array<string>} Ids.
   */
  function ids() {
    return DEFS.map(function (p) { return p.id; });
  }

  /**
   * Client-safe projection: sprite data, display strings and fallback lines
   * only. Secrets (neverSay, knowledgeBoundaries, backstory) never cross the
   * wire — the browser has no business knowing what an NPC is hiding.
   * @return {!Array<!Object>} Trimmed persona records for the game client.
   */
  function listForClient() {
    return DEFS.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        traits: p.traits.slice(0),
        sprite: clone(p.sprite),
        idleAction: p.idleAction,
        mood: p.moodState.current,
        ratingSensitive: !!p.ratingSensitive,
        fallbackLines: p.fallbackLines.slice(0)
      };
    });
  }

  /**
   * Picks a fallback line, rotating by turn count so a stuck NPC does not
   * repeat itself verbatim.
   * @param {!Object} persona Persona record.
   * @param {number=} turnIndex Turn counter used to rotate.
   * @return {string} A hand-written safe line.
   */
  function fallbackLine(persona, turnIndex) {
    var lines = (persona && persona.fallbackLines) || ['...'];
    var i = Math.abs(Math.floor(turnIndex || 0)) % lines.length;
    return lines[i];
  }

  /**
   * Advances a persona's mood using its trigger table.
   * Keyword hits on the player's text win; otherwise the NPC's own emotion
   * nudges the mood; otherwise the mood decays back toward its default.
   * @param {!Object} persona Persona record.
   * @param {string} currentMood Mood carried in save state.
   * @param {string} playerText What the player just said.
   * @param {?Object} response Parsed NPC response (may be null).
   * @return {string} The next mood.
   */
  function advanceMood(persona, currentMood, playerText, response) {
    var triggers = (persona && persona.moodState && persona.moodState.triggers) || {};
    var text = String(playerText || '').toLowerCase();
    for (var key in triggers) {
      if (!Object.prototype.hasOwnProperty.call(triggers, key)) continue;
      if (text.indexOf(key) !== -1) return triggers[key];
    }
    if (response && response.emotion) {
      var map = {
        angry: 'angry', afraid: 'afraid', warm: 'warm',
        wary: 'wary', amused: 'amused', neutral: ''
      };
      var m = map[response.emotion];
      if (m) return m;
    }
    return currentMood || (persona && persona.moodState && persona.moodState.current) || 'neutral';
  }

  /**
   * Full schema validation of one persona.
   * @param {!Object} p Candidate persona.
   * @return {!Array<string>} Human-readable problems; empty means valid.
   */
  function validate(p) {
    var errs = [];
    var tag = (p && p.id) ? ('[' + p.id + '] ') : '[persona] ';

    if (!p || typeof p !== 'object') return ['persona is not an object'];

    ['id', 'name', 'role', 'backstory', 'idleAction'].forEach(function (k) {
      if (typeof p[k] !== 'string' || !p[k]) errs.push(tag + k + ' must be a non-empty string');
    });

    if (!Array.isArray(p.traits) || !p.traits.length) errs.push(tag + 'traits must be a non-empty array');
    if (!Array.isArray(p.neverSay)) errs.push(tag + 'neverSay must be an array');

    if (!p.speechStyle || typeof p.speechStyle !== 'object') {
      errs.push(tag + 'speechStyle missing');
    } else {
      if (REGISTERS.indexOf(p.speechStyle.register) === -1) {
        errs.push(tag + 'speechStyle.register must be one of ' + REGISTERS.join('|'));
      }
      if (VERBOSITIES.indexOf(p.speechStyle.verbosity) === -1) {
        errs.push(tag + 'speechStyle.verbosity must be one of ' + VERBOSITIES.join('|'));
      }
      if (!Array.isArray(p.speechStyle.quirks)) errs.push(tag + 'speechStyle.quirks must be an array');
    }

    if (!p.knowledgeBoundaries || typeof p.knowledgeBoundaries !== 'object') {
      errs.push(tag + 'knowledgeBoundaries missing');
    } else {
      if (!Array.isArray(p.knowledgeBoundaries.knows)) errs.push(tag + 'knowledgeBoundaries.knows must be an array');
      if (!Array.isArray(p.knowledgeBoundaries.doesNotKnow)) errs.push(tag + 'knowledgeBoundaries.doesNotKnow must be an array');
    }

    if (!p.relationships || typeof p.relationships !== 'object') errs.push(tag + 'relationships must be an object');

    if (!p.moodState || typeof p.moodState !== 'object') {
      errs.push(tag + 'moodState missing');
    } else {
      if (typeof p.moodState.current !== 'string') errs.push(tag + 'moodState.current must be a string');
      if (!p.moodState.triggers || typeof p.moodState.triggers !== 'object') errs.push(tag + 'moodState.triggers must be an object');
    }

    if (!Array.isArray(p.fallbackLines) || p.fallbackLines.length < 4) {
      errs.push(tag + 'fallbackLines must contain at least 4 hand-written lines');
    }

    if (!p.sprite || typeof p.sprite !== 'object') {
      errs.push(tag + 'sprite missing');
    } else {
      if (!p.sprite.palette || typeof p.sprite.palette !== 'object') {
        errs.push(tag + 'sprite.palette missing');
      } else {
        PALETTE_KEYS.forEach(function (k) {
          if (!/^#[0-9a-fA-F]{6}$/.test(String(p.sprite.palette[k]))) {
            errs.push(tag + 'sprite.palette.' + k + ' must be a #rrggbb colour');
          }
        });
      }
      if (typeof p.sprite.height !== 'number' || p.sprite.height <= 0) errs.push(tag + 'sprite.height must be a positive number');
      if (BUILDS.indexOf(p.sprite.build) === -1) errs.push(tag + 'sprite.build must be one of ' + BUILDS.join('|'));
      if (PROPS.indexOf(p.sprite.prop) === -1) errs.push(tag + 'sprite.prop must be one of ' + PROPS.join('|'));
    }

    if (IDLE_ACTIONS.indexOf(p.idleAction) === -1) {
      errs.push(tag + 'idleAction must be one of ' + IDLE_ACTIONS.join('|'));
    }
    if (typeof p.ratingSensitive !== 'boolean') errs.push(tag + 'ratingSensitive must be a boolean');

    return errs;
  }

  /**
   * Validates the whole cast, plus id uniqueness.
   * @return {!Array<string>} Problems; empty means the cast is shippable.
   */
  function validateAll() {
    var errs = [];
    var seen = {};
    DEFS.forEach(function (p) {
      errs = errs.concat(validate(p));
      if (seen[p.id]) errs.push('duplicate persona id: ' + p.id);
      seen[p.id] = true;
    });
    return errs;
  }

  return {
    list: list,
    get: get,
    ids: ids,
    listForClient: listForClient,
    fallbackLine: fallbackLine,
    advanceMood: advanceMood,
    validate: validate,
    validateAll: validateAll,
    REGISTERS: REGISTERS,
    BUILDS: BUILDS,
    PROPS: PROPS
  };
})();
