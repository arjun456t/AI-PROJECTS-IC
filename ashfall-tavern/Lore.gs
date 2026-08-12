/**
 * Lore.gs — world corpus + retrieval.
 *
 * WHY A STUDIO PAYS FOR THIS: anti-hallucination. An NPC can only speak from
 * facts that were retrieved for it, and retrieval is hard-filtered by that
 * character's knowledge boundaries and by secrecy tier. NPCs cannot invent
 * lore, and they cannot leak act-three plot twists in act one.
 *
 * The retriever is deliberately hidden behind an interface-shaped object
 * (`Lore.retriever`). Swapping keyword scoring for pgvector / Qdrant means
 * implementing `retrieve(query, npcId, opts)` and assigning it here — the
 * prompt builder in Dialogue.gs never changes.
 */

/** @const {!Object} */
var Lore = (function () {

  /** @const {!Array<string>} Secrecy ladder, least to most restricted. */
  var SECRECY = ['public', 'rumour', 'secret'];

  /* ──────────────────────────────────────────────────────────────────────
   * CORPUS — 20 entries
   * ────────────────────────────────────────────────────────────────────── */

  /** @const {!Array<!Object>} */
  var CORPUS = [
    {
      id: 'lore-ashfall',
      title: 'The village of Ashfall',
      body: 'Ashfall is a mining village of some four hundred souls, wedged in a ' +
            'valley beneath the Deepvein spur. Grey volcanic ash drifts down from ' +
            'the ridge two seasons a year, giving the village its name and its ' +
            'permanently pale rooftops. Since the collapse the population has ' +
            'thinned; every third house on the east row stands empty.',
      tags: ['ashfall', 'village', 'valley', 'home', 'town', 'people'],
      secrecy: 'public'
    },
    {
      id: 'lore-hollow-ash',
      title: 'The Hollow Ash tavern',
      body: 'The Hollow Ash is the only public house left in Ashfall, a low ' +
            'timber hall with a stone hearth at the back wall and a bar of ' +
            'blackened oak. It has stood ninety years and has never once closed ' +
            'for a full day, not for fever nor famine nor the collapse.',
      tags: ['tavern', 'inn', 'hollow ash', 'bar', 'drink', 'ale', 'hearth', 'lodging'],
      secrecy: 'public'
    },
    {
      id: 'lore-bram',
      title: 'Bram Holloway, keeper',
      body: 'Bram Holloway has kept the Hollow Ash for thirty-one years. He is ' +
            'known for short answers, a long memory and a ledger nobody else is ' +
            'permitted to read. Every rumour in Ashfall passes over his bar ' +
            'eventually, and he is thought to have kept most of them.',
      tags: ['bram', 'keeper', 'tavern', 'rumour', 'ledger', 'holloway'],
      secrecy: 'public'
    },
    {
      id: 'lore-veyla',
      title: 'Sister Veyla, wandering cleric',
      body: 'Sister Veyla arrived three days after the collapse and never left. ' +
            'She keeps a bench by the hearth, swings a brass censer of ember-oil ' +
            'and preaches the Ember Rite to a village that mostly stopped ' +
            'listening. She has buried nine of Ashfall\'s dead herself.',
      tags: ['veyla', 'cleric', 'sister', 'priest', 'faith', 'rite', 'censer'],
      secrecy: 'public'
    },
    {
      id: 'lore-pike',
      title: 'Pike, the stable hand',
      body: 'Pike is fourteen, works the Hollow Ash stables for a copper a week ' +
            'and sleeps in the straw loft above them. His father Cal was one of ' +
            'the eleven lost in the Deepvein. Since the collapse the boy will not ' +
            'walk the mine road, not even in daylight, and will not say why.',
      tags: ['pike', 'boy', 'stable', 'child', 'orphan', 'cal', 'father'],
      secrecy: 'public'
    },
    {
      id: 'lore-stables',
      title: 'The Hollow Ash stables',
      body: 'Six stalls behind the tavern, four of them empty since the mine ' +
            'closed and the ore carts stopped running. The grey mare belongs to ' +
            'the Ashguard and is stabled free of charge, an arrangement nobody in ' +
            'the village remembers agreeing to.',
      tags: ['stable', 'horse', 'mare', 'stalls', 'carts', 'pike'],
      secrecy: 'public'
    },
    {
      id: 'lore-deepvein',
      title: 'The Deepvein Mine',
      body: 'The Deepvein was a silver-and-tin working driven three hundred feet ' +
            'into the spur above Ashfall. It fed the village for four generations. ' +
            'The upper galleries ran out eight years ago and the company pushed ' +
            'the lower cut deeper than any survey had cleared.',
      tags: ['deepvein', 'mine', 'silver', 'tin', 'gallery', 'shaft', 'dig', 'ore'],
      secrecy: 'public'
    },
    {
      id: 'lore-collapse-night',
      title: 'The night of the collapse',
      body: 'On the fourteenth night of the ash season the Deepvein came down. ' +
            'The sound was heard in the village as a single long note, like a ' +
            'struck bell, followed by silence. Dust reached the tavern door within ' +
            'two minutes. The shaft mouth was buried by dawn and has not been ' +
            'reopened.',
      tags: ['collapse', 'cave-in', 'disaster', 'night', 'dust', 'bell', 'deepvein'],
      secrecy: 'public'
    },
    {
      id: 'lore-eleven-missing',
      title: 'The eleven missing miners',
      body: 'Eleven men went down the Deepvein on the night of the collapse and ' +
            'none came up. No bodies were recovered because no dig was permitted. ' +
            'Their names are cut into the tally stone by the well: Cal, Harrow, ' +
            'Osric, Ned Marren, Dob, Lask, two brothers called Vane, Fenn, Tulley ' +
            'and a boy of sixteen named Reed.',
      tags: ['eleven', 'missing', 'miners', 'dead', 'lost', 'names', 'bodies', 'cal', 'reed'],
      secrecy: 'public'
    },
    {
      id: 'lore-mine-road',
      title: 'The mine road',
      body: 'A switchback track of packed ash climbing from the village\'s north ' +
            'gate to the Deepvein shaft mouth, a walk of some forty minutes. It ' +
            'is barred at the second bend by an Ashguard post. Nobody has ' +
            'business up there now, and the militia asks what yours is.',
      tags: ['road', 'track', 'path', 'north', 'gate', 'shaft', 'climb', 'barred'],
      secrecy: 'public'
    },
    {
      id: 'lore-ashguard',
      title: 'The Ashguard militia',
      body: 'The Ashguard were a volunteer watch of a dozen men before the ' +
            'collapse. Afterwards they took the keys to the north gate, the ' +
            'grain store and the mine road, and nobody has taken them back. They ' +
            'wear grey sashes and answer to Captain Orin.',
      tags: ['ashguard', 'militia', 'watch', 'guard', 'soldiers', 'orin', 'grey sash', 'law'],
      secrecy: 'public'
    },
    {
      id: 'lore-curfew',
      title: 'The dusk curfew',
      body: 'Since the collapse the Ashguard has enforced a curfew from dusk to ' +
            'first light. The stated reason is falling ash and unstable ground. ' +
            'Being found on the mine road after dark costs a week\'s wage on a ' +
            'first offence, and nobody speaks about the second.',
      tags: ['curfew', 'dusk', 'night', 'patrol', 'fine', 'punishment', 'ashguard'],
      secrecy: 'public'
    },
    {
      id: 'lore-tally-stone',
      title: 'The tally stone',
      body: 'A waist-high block of black basalt beside the village well, carved ' +
            'with the names of every Ashfall soul lost to the mine across four ' +
            'generations. The eleven were added in a rougher hand than the rest — ' +
            'cut at night, by someone who did not ask permission.',
      tags: ['tally', 'stone', 'memorial', 'names', 'well', 'carved', 'dead'],
      secrecy: 'public'
    },
    {
      id: 'lore-ember-rite',
      title: 'The Ember Rite',
      body: 'A midwinter festival in which every hearth in the village is ' +
            'extinguished at dusk and relit before dawn from a single ember ' +
            'carried house to house. It marks the mountain\'s permission for ' +
            'another year of digging. This year the rite falls in nine days and ' +
            'no one has agreed who will carry the ember.',
      tags: ['ember', 'rite', 'festival', 'midwinter', 'hearth', 'ceremony', 'tradition'],
      secrecy: 'public'
    },
    {
      id: 'lore-ash-fall-season',
      title: 'The ash season',
      body: 'Twice a year the ridge vents and grey ash falls over the valley for ' +
            'a fortnight. Villagers wear cloth over their mouths and sweep their ' +
            'roofs nightly to stop them buckling. The collapse happened in the ' +
            'middle of an ash season, which is why the sky was already dark.',
      tags: ['ash', 'season', 'weather', 'ridge', 'vent', 'grey', 'sky', 'sweep'],
      secrecy: 'public'
    },
    {
      id: 'lore-widow-marren',
      title: 'Widow Marren',
      body: 'Ned Marren was the fourth name on the tally stone. His widow has ' +
            'stood at the north gate every dawn since the collapse asking to be ' +
            'let up the road, and every dawn the Ashguard turns her back. Some in ' +
            'the village say she has begun paying the militia for the privilege ' +
            'of being refused politely.',
      tags: ['marren', 'widow', 'ned', 'gate', 'grief', 'refused', 'payment'],
      secrecy: 'rumour'
    },
    {
      id: 'lore-warden-seal',
      title: 'The warden seals',
      body: 'Old workings in the spur were closed with iron-bound doors marked ' +
            'with a warden seal — a survey mark from the first company, meaning ' +
            'ground that must never be cut again. The lower Deepvein cut ran past ' +
            'two of them. The clerics hold that the seals were never a survey ' +
            'mark at all.',
      tags: ['warden', 'seal', 'iron', 'door', 'survey', 'forbidden', 'old workings', 'judgement'],
      secrecy: 'rumour'
    },
    {
      id: 'lore-captain-orin',
      title: 'Captain Orin of the Ashguard',
      body: 'Orin took command of the Ashguard eleven days before the collapse, ' +
            'having arrived in Ashfall the season prior with a company letter and ' +
            'no history anyone could name. He is unfailingly courteous, keeps ' +
            'immaculate records, and has refused three separate petitions to dig ' +
            'for the eleven.',
      tags: ['orin', 'captain', 'ashguard', 'command', 'records', 'refused', 'dig', 'petition'],
      secrecy: 'rumour'
    },
    {
      id: 'lore-captain-orin-private',
      title: 'What Orin collects',
      body: 'Orin keeps a private ledger of every Ashfall business and what each ' +
            'pays weekly for the militia\'s goodwill. The tavern, the smith and ' +
            'the grain factor are all in it. He calls the arrangement a levy for ' +
            'the watch, and he has never once put it in writing where a magistrate ' +
            'could read it.',
      tags: ['orin', 'ledger', 'levy', 'payment', 'extortion', 'protection', 'weekly', 'businesses'],
      secrecy: 'secret'
    },
    {
      id: 'lore-protection-purse',
      title: 'The purse under the bar',
      body: 'The Hollow Ash pays the Ashguard eleven coppers a week, left in a ' +
            'grey purse under the third floorboard behind the bar and collected ' +
            'every seventh night. It is the reason the tavern\'s doors are still ' +
            'unbarred and its name is absent from Orin\'s public list of ' +
            'delinquent houses.',
      tags: ['purse', 'protection', 'payment', 'bar', 'floorboard', 'coppers', 'ashguard', 'debt', 'bram'],
      secrecy: 'secret'
    }
  ];

  /* ──────────────────────────────────────────────────────────────────────
   * REVEALABLE PLOT FACTS
   * These are the act-three twists. They are NOT lore entries — they are the
   * things an NPC can choose to admit. The guardrail layer rejects any
   * response whose `revealed[]` names a fact the speaker cannot know.
   * ────────────────────────────────────────────────────────────────────── */

  /** @const {!Array<!Object>} */
  var FACTS = [
    {
      id: 'fact-bram-debt',
      summary: 'Bram pays the Ashguard weekly for protection.',
      owner: 'bram',
      requires: ['lore-protection-purse']
    },
    {
      id: 'fact-veyla-vision',
      summary: 'Veyla saw the ridge light from within on the night of the collapse and reads it as judgement.',
      owner: 'veyla',
      requires: ['lore-warden-seal', 'lore-collapse-night']
    },
    {
      id: 'fact-pike-saw-lantern',
      summary: 'Pike was on the mine road after curfew and saw lantern light moving at the shaft mouth AFTER the collapse.',
      owner: 'pike',
      requires: ['lore-mine-road', 'lore-collapse-night']
    },
    {
      id: 'fact-deepvein-lower-gallery',
      summary: 'The lower cut breached a sealed working; the company knew before it sent the eleven down.',
      owner: null,
      requires: ['lore-warden-seal', 'lore-deepvein']
    },
    {
      id: 'fact-orin-ledger-burned',
      summary: 'Orin burned the shift roster for the night of the collapse.',
      owner: null,
      requires: ['lore-captain-orin-private']
    }
  ];

  /** @const {!Array<string>} Words too common to carry retrieval signal. */
  var STOPWORDS = ('a an the and or but if of to in on at for with from by is are was were ' +
    'be been being it its this that these those i you he she they we me him her them my your ' +
    'do does did what who whom whose when where why how not no yes so as than then there here ' +
    'about into over under can could would should will shall may might must have has had').split(' ');

  var STOP = {};
  for (var s = 0; s < STOPWORDS.length; s++) STOP[STOPWORDS[s]] = true;

  /**
   * Splits text into scoreable lowercase terms.
   * @param {string} text Raw text.
   * @return {!Array<string>} Terms, stopwords and 2-char noise removed.
   */
  function tokenize(text) {
    var raw = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (t.length > 2 && !STOP[t]) out.push(t);
    }
    return out;
  }

  /**
   * Total entry count.
   * @return {number} Number of lore entries in the corpus.
   */
  function count() {
    return CORPUS.length;
  }

  /**
   * The whole corpus, cloned.
   * @return {!Array<!Object>} Lore entries.
   */
  function all() {
    return JSON.parse(JSON.stringify(CORPUS));
  }

  /**
   * One entry by id.
   * @param {string} id Lore id.
   * @return {?Object} Entry, or null.
   */
  function get(id) {
    for (var i = 0; i < CORPUS.length; i++) if (CORPUS[i].id === id) return CORPUS[i];
    return null;
  }

  /**
   * All revealable plot facts.
   * @return {!Array<!Object>} Fact records.
   */
  function facts() {
    return JSON.parse(JSON.stringify(FACTS));
  }

  /**
   * One plot fact by id.
   * @param {string} id Fact id.
   * @return {?Object} Fact, or null.
   */
  function getFact(id) {
    for (var i = 0; i < FACTS.length; i++) if (FACTS[i].id === id) return FACTS[i];
    return null;
  }

  /**
   * The highest secrecy tier an NPC is permitted to read.
   * A character may read `secret` only when its `knows` list names a secret
   * entry explicitly — permission is granted per entry, never per tier.
   * @param {!Object} persona Persona record.
   * @param {!Object} entry Lore entry.
   * @return {boolean} True when this NPC may see this entry.
   */
  function permits(persona, entry) {
    var kb = (persona && persona.knowledgeBoundaries) || { knows: [], doesNotKnow: [] };
    var knows = kb.knows || [];
    var denies = kb.doesNotKnow || [];

    if (denies.indexOf(entry.id) !== -1) return false;              // explicit deny wins
    if (entry.secrecy === 'public') return true;                    // everyone may read public
    return knows.indexOf(entry.id) !== -1;                          // rumour/secret need a grant
  }

  /**
   * Scores one entry against the query terms.
   * Tag overlap is weighted heavily (tags are the writer's retrieval handles);
   * body/title term frequency is the softer signal.
   * @param {!Object} entry Lore entry.
   * @param {!Array<string>} terms Query terms.
   * @param {!Array<string>} memoryTerms Terms from recent conversation.
   * @return {number} Relevance score.
   */
  function score(entry, terms, memoryTerms) {
    var sc = 0;
    var tags = entry.tags || [];
    var haystack = (entry.title + ' ' + entry.body).toLowerCase();
    var i, j, t;

    for (i = 0; i < terms.length; i++) {
      t = terms[i];
      for (j = 0; j < tags.length; j++) {
        if (tags[j] === t) { sc += 6; break; }
        if (tags[j].indexOf(t) !== -1 || t.indexOf(tags[j]) !== -1) { sc += 3; break; }
      }
      var idx = haystack.indexOf(t);
      var hits = 0;
      while (idx !== -1 && hits < 4) { hits++; idx = haystack.indexOf(t, idx + t.length); }
      sc += hits * 1.2;
    }

    // Recent conversation contributes at a third weight so the retriever has
    // continuity without letting the topic drift lock in forever.
    for (i = 0; i < memoryTerms.length; i++) {
      t = memoryTerms[i];
      for (j = 0; j < tags.length; j++) {
        if (tags[j] === t) { sc += 2; break; }
      }
    }

    // Gentle bias toward public grounding so a secret never crowds out the
    // basic facts a scene needs.
    if (entry.secrecy === 'public') sc += 0.5;
    if (entry.secrecy === 'secret') sc -= 1.0;

    return sc;
  }

  /**
   * Retrieves the top lore entries an NPC is allowed to speak from.
   * @param {string} query Player utterance / topic.
   * @param {string} npcId Speaking character's id.
   * @param {!Object=} opts `{limit, memory:Array<string>, minScore}`.
   * @return {!Array<!Object>} Up to `limit` entries, best first.
   */
  function retrieve(query, npcId, opts) {
    opts = opts || {};
    var limit = opts.limit || 4;
    var persona = Personas.get(npcId);
    if (!persona) return [];

    var terms = tokenize(query);
    var memoryTerms = tokenize((opts.memory || []).join(' '));

    var scored = [];
    for (var i = 0; i < CORPUS.length; i++) {
      var entry = CORPUS[i];
      if (!permits(persona, entry)) continue;                       // HARD boundary filter
      var sc = score(entry, terms, memoryTerms);
      scored.push({ entry: entry, score: sc });
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.id < b.entry.id ? -1 : 1;                      // stable → deterministic
    });

    var out = [];
    for (var k = 0; k < scored.length && out.length < limit; k++) {
      out.push({
        id: scored[k].entry.id,
        title: scored[k].entry.title,
        body: scored[k].entry.body,
        tags: scored[k].entry.tags.slice(0),
        secrecy: scored[k].entry.secrecy,
        score: Math.round(scored[k].score * 100) / 100
      });
    }
    return out;
  }

  /**
   * Facts this NPC is permitted to reveal at all.
   * @param {string} npcId Persona id.
   * @return {!Array<!Object>} Allowed fact records.
   */
  function allowedFacts(npcId) {
    var persona = Personas.get(npcId);
    if (!persona) return [];
    var kb = persona.knowledgeBoundaries || { knows: [], doesNotKnow: [] };
    var out = [];
    for (var i = 0; i < FACTS.length; i++) {
      var f = FACTS[i];
      if ((kb.doesNotKnow || []).indexOf(f.id) !== -1) continue;
      if ((kb.knows || []).indexOf(f.id) !== -1) out.push(f);
    }
    return out;
  }

  /**
   * Rows for the Lore tab of the spreadsheet.
   * @return {!Array<!Array<string>>} `[id, title, body, tags, secrecy]` rows.
   */
  function toSheetRows() {
    return CORPUS.map(function (e) {
      return [e.id, e.title, e.body, e.tags.join(', '), e.secrecy];
    });
  }

  /**
   * Corpus integrity check.
   * @return {!Array<string>} Problems; empty means valid.
   */
  function validateAll() {
    var errs = [];
    var seen = {};
    CORPUS.forEach(function (e) {
      if (!e.id || seen[e.id]) errs.push('lore id missing or duplicated: ' + e.id);
      seen[e.id] = true;
      if (!e.title) errs.push(e.id + ': title required');
      if (!e.body || e.body.length < 40) errs.push(e.id + ': body too thin to ground a line');
      if (!Array.isArray(e.tags) || !e.tags.length) errs.push(e.id + ': tags required');
      if (SECRECY.indexOf(e.secrecy) === -1) errs.push(e.id + ': secrecy must be public|rumour|secret');
    });
    if (CORPUS.length < 18) errs.push('corpus is under the 18-entry minimum');

    FACTS.forEach(function (f) {
      if (!f.id) errs.push('fact missing id');
      (f.requires || []).forEach(function (r) {
        if (!get(r)) errs.push(f.id + ': requires unknown lore entry ' + r);
      });
    });

    // Every id named by a persona boundary must resolve to something real,
    // otherwise a writer's typo silently disables a guardrail.
    Personas.list().forEach(function (p) {
      var kb = p.knowledgeBoundaries || {};
      (kb.knows || []).concat(kb.doesNotKnow || []).forEach(function (id) {
        if (!get(id) && !getFact(id)) {
          errs.push(p.id + ': knowledge boundary names unknown id ' + id);
        }
      });
    });

    return errs;
  }

  /**
   * The swappable retrieval backend. Replace `impl` with a pgvector/Qdrant
   * client that honours the same signature and nothing upstream changes.
   * @const {!Object}
   */
  var retriever = {
    name: 'keyword-bm25-lite',
    retrieve: retrieve
  };

  return {
    SECRECY: SECRECY,
    all: all,
    get: get,
    count: count,
    facts: facts,
    getFact: getFact,
    allowedFacts: allowedFacts,
    permits: permits,
    retrieve: function (q, npcId, opts) { return retriever.retrieve(q, npcId, opts); },
    retriever: retriever,
    tokenize: tokenize,
    toSheetRows: toSheetRows,
    validateAll: validateAll
  };
})();
