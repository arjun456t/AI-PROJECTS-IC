# Ashfall Tavern — Setup & Integration Guide

An AI-powered NPC dialogue engine, wrapped in a playable 2D demo that proves it
works. The game is the sales pitch; the engine is the product.

Runs entirely on Google Apps Script — no npm, no build step, no bundler, no
external assets. Every pixel is drawn procedurally on canvas.

---

## 1. Deploy in ten minutes

### 1.1 Create the project

1. Go to <https://script.google.com> → **New project**.
2. Rename it `Ashfall Tavern`.

### 1.2 Paste the files

Create each file in the editor and paste the matching contents. **Names must
match exactly** — `include()` and `createTemplateFromFile()` resolve by name.

| Editor: file to add                     | Paste from        |
| --------------------------------------- | ----------------- |
| `Code.gs` *(already exists — replace)*   | `Code.gs`         |
| **+ → Script** → `Persona`               | `Persona.gs`      |
| **+ → Script** → `Lore`                  | `Lore.gs`         |
| **+ → Script** → `Dialogue`              | `Dialogue.gs`     |
| **+ → Script** → `Guardrails`            | `Guardrails.gs`   |
| **+ → Script** → `Determinism`           | `Determinism.gs`  |
| **+ → Script** → `Export`                | `Export.gs`       |
| **+ → Script** → `Sheets`                | `Sheets.gs`       |
| **+ → HTML** → `Index`                   | `Index.html`      |
| **+ → HTML** → `Styles`                  | `Styles.html`     |
| **+ → HTML** → `Sprites`                 | `Sprites.html`    |
| **+ → HTML** → `GameEngine`              | `GameEngine.html` |
| **+ → HTML** → `DialogueUI`              | `DialogueUI.html` |
| **+ → HTML** → `DevPanel`                | `DevPanel.html`   |

Apps Script appends the extension itself — type `Persona`, not `Persona.gs`.

### 1.2b Or skip the pasting: push with `clasp`

The folder ships an `appsscript.json` manifest and a `.claspignore`, so the
whole project uploads in one command.

The manifest sets the V8 runtime and the web-app access mode, and deliberately
does **not** pin `oauthScopes`: Apps Script derives scopes from the code it
actually runs, and a hand-written list missing one fails at authorisation time
with a confusing permissions error instead of at review time. Let it infer.

```bash
# one-time: turn on the Apps Script API for your account
open https://script.google.com/home/usersettings     # set "Google Apps Script API" to ON

npx @google/clasp@3 login
cd ashfall-tavern
npx @google/clasp@3 create-script --title "Ashfall Tavern" --type webapp --rootDir .
npx @google/clasp@3 push
npx @google/clasp@3 open-script
```

`create-script` writes a `.clasp.json` holding your script id — it is personal
to your project, so keep it out of version control. After the first push,
`npx @google/clasp@3 push` alone syncs any later edit.

Then carry on from §1.3 (API key) — `clasp` uploads code, not Script
Properties, and it cannot press **Run** on `initializeSpreadsheet` for you.

### 1.3 Set the API key

Get a Gemini key from <https://aistudio.google.com/apikey>, then:

**⚙ Project Settings → Script Properties → Add script property**

| Property         | Value             |
| ---------------- | ----------------- |
| `GEMINI_API_KEY` | *your key*        |

The key is read server-side by `UrlFetchApp` only. It is never sent to the
browser, never appears in page source, and never crosses `google.script.run`.

> Without a key the demo still runs — every NPC falls back to its hand-written
> `fallbackLines`, and the boot screen says so. Nothing crashes.

### 1.4 Bootstrap the spreadsheet

In the editor, select `initializeSpreadsheet` from the function dropdown and
press **Run**. Authorise when prompted (Sheets + external requests).

This creates *Ashfall Tavern — Dialogue Engine DB* in your Drive with seven
tabs, seeds `NPCs`, `Lore` and `Config`, and stores the spreadsheet id in
Script Properties. It is safe to re-run — it repairs missing tabs and re-seeds
personas and lore without clobbering tuned config values.

Run `showSpreadsheetUrl` to print the link, or `selfTest` to validate the whole
stack (personas, lore, secrecy boundaries, spreadsheet, one live generation).

### 1.5 Deploy

**Deploy → New deployment → Web app**

| Setting        | Value                  |
| -------------- | ---------------------- |
| Execute as     | **Me**                 |
| Who has access | **Anyone with the link** |

Open the deployment URL. `WASD` to move, `E` to talk, `Esc` to leave,
`` ~ `` for the engine panel.

---

## 2. Architecture

```
                            BROWSER (sandboxed iframe)
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Index.html — App orchestrator (owns state + every server call)      │
 │      │                                                               │
 │      ├── Sprites.html ─── pose model · clips · procedural rendering  │
 │      │        ▲                                                      │
 │      ├── GameEngine.html ─ loop · world · collision · camera · FX     │
 │      │        │  Game.hooks.onRequestLine ──┐                        │
 │      ├── DialogueUI.html ─ typewriter · choices · relationship HUD    │
 │      └── DevPanel.html ─── prompt · retrieval · guardrails · export   │
 └───────────────────────────────────┬──────────────────────────────────┘
                                     │ google.script.run
                                     │ (the ONLY client→server channel)
 ┌───────────────────────────────────▼──────────────────────────────────┐
 │  Code.gs — doGet · include · endpoints (never throws to the client)  │
 │                                                                      │
 │   generateLine(npcId, choiceText, stateJson)                         │
 │        │                                                             │
 │        ├─▶ Persona.gs      who is speaking, and what they refuse to say
 │        ├─▶ Lore.gs         retrieve(query, npcId) → top 4, hard-filtered
 │        │                     by knowledgeBoundaries + secrecy tier    │
 │        ├─▶ Determinism.gs  cache hit? → byte-identical replay, 0ms    │
 │        ├─▶ Dialogue.gs     build prompt → UrlFetchApp → parse JSON    │
 │        │        │                              │                     │
 │        │        │            retry once on malformed JSON ◀──┘       │
 │        ├─▶ Guardrails.gs   schema · neverSay · rating tier ·          │
 │        │                     lore-leak · fourth-wall                  │
 │        │        │                                                     │
 │        │        ├── accept ──▶ apply repDelta · flags · mood · memory │
 │        │        └── reject ──▶ regenerate once ──▶ fallbackLines      │
 │        ├─▶ Export.gs       record node + edges into the graph          │
 │        └─▶ Sheets.gs       save state · log telemetry                 │
 └───────────────────────────────────┬──────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼──────────────────────────────────┐
 │  Google Sheets                     │  Gemini (gemini-2.0-flash)       │
 │  NPCs · Lore · GameState ·         │  server-side UrlFetchApp only    │
 │  DialogueLog · ExportedTree ·      │  key stays in Script Properties  │
 │  Config · DetCache                 │                                  │
 └──────────────────────────────────────────────────────────────────────┘
```

### Spreadsheet schema

| Tab            | Columns |
| -------------- | ------- |
| `NPCs`         | id, personaJson |
| `Lore`         | id, title, body, tags, secrecy |
| `GameState`    | playerId, questFlags, reputation, npcRelationships, npcMemory |
| `DialogueLog`  | timestamp, npcId, prompt, rawResponse, latencyMs, tokensEst, violations |
| `ExportedTree` | nodeId, npcId, parentNode, line, emotion, intent, choiceText, tone, nextNode, repDelta |
| `Config`       | key, value |
| `DetCache`     | key, payload, storedAt |

`ExportedTree` carries one extra column beyond the nine in the original spec:
`repDelta`. Graph edges are specified to carry a relationship delta and there
is nowhere else to put it without lossy packing. `DetCache` is the durable tier
behind `CacheService`, whose entries expire after six hours — QA replay needs to
outlive that.

The `reputation` column holds a small JSON object (`global`, `timeOfDay`,
`turnCount`, `revealed`) rather than a bare number, so the scalar world fields
ride along without widening the tab.

---

## 3. Adding a fourth NPC

**You only edit `Persona.gs`.** No engine code changes, no prompt changes, no UI
changes. Append one object to the `DEFS` array:

```js
{
  id: 'orin',
  name: 'Captain Orin',
  role: 'Commander of the Ashguard militia',
  backstory: 'Three or four sentences. This is the character\'s spine — write it ' +
             'like a casting brief, not a wiki entry.',
  traits: ['courteous', 'calculating', 'unmovable'],
  speechStyle: {
    register: 'formal',              // formal | crude | archaic | terse
    verbosity: 'normal',             // clipped | normal | rambling
    quirks: ['never raises his voice', 'answers with regulations']
  },
  knowledgeBoundaries: {
    knows: ['lore-ashguard', 'lore-captain-orin', 'lore-captain-orin-private',
            'lore-curfew', 'lore-mine-road', 'fact-orin-ledger-burned'],
    doesNotKnow: ['fact-pike-saw-lantern', 'fact-veyla-vision']
  },
  relationships: { bram: 'A reliable contributor to the watch fund.' },
  neverSay: ['I burned the roster', 'the levy is extortion'],
  moodState: { current: 'courteous', triggers: { ledger: 'wary', threat: 'angry' } },
  fallbackLines: [ /* four hand-written safe lines — required */ ],
  sprite: {
    palette: { skin: '#c9926a', cloth: '#3d4048', accent: '#6c7079',
               hair: '#2a2622', trim: '#9aa2ad' },
    height: 1.04,
    build: 'tall',                   // stocky | slight | tall
    prop: 'none'                     // mug | censer | broom | none
  },
  idleAction: 'idle',                // polishing_mug | praying | sweeping | idle
  ratingSensitive: false
}
```

Then:

1. Run `initializeSpreadsheet()` to re-seed the `NPCs` tab.
2. Add a spawn anchor in `GameEngine.html` → `init()` → `anchors`:
   `orin: { x: 700, y: 470, facing: -1 }`
   *(omit this and the engine places them on a default row — the anchor is
   staging, not wiring)*.
3. Reload. The HUD grows a fourth portrait, the pre-bake picker grows a fourth
   entry, retrieval starts honouring the new boundaries, and the guardrails
   enforce the new `neverSay` list. Nothing else to touch.

`Personas.validateAll()` (called by `selfTest`) will name any field you got
wrong before it reaches a player.

**Writing an NPC that needs a new idle animation** is the one case that touches
a second file: add a clip to `Sprites.CLIPS` in `Sprites.html` and name it in
`idleAction`. The four shipped actions cover `idle`, `polishing_mug`, `praying`
and `sweeping`.

---

## 4. Cost per 1000 lines

Measured, not estimated. Prompts were captured from all three characters after
five turns each, so memory sits at its six-turn cap — the realistic steady
state, not a cold first line:

| Character | Prompt | Input tokens |
| --- | --- | --- |
| Bram | 5,808 chars | ~1,452 |
| Veyla | 5,861 chars | ~1,466 |
| Pike | 5,937 chars | ~1,485 |

That is **~1,468 input** (persona + 4 retrieved lore entries + world state +
6 turns of memory + the output schema) and **~139 output** tokens per line.

At `gemini-2.0-flash` pricing ($0.10 / 1M input, $0.40 / 1M output):

| | per line | **per 1,000 lines** |
| --- | --- | --- |
| input (~1,468 tok) | $0.000147 | $0.147 |
| output (~139 tok) | $0.000056 | $0.056 |
| **total** | **$0.000202** | **≈ $0.20** |

| Model | per 1,000 lines |
| --- | --- |
| `gemini-2.0-flash-lite` | ≈ $0.15 |
| `gemini-2.0-flash` | ≈ $0.20 |
| `gemini-2.5-flash` | ≈ $0.79 |

The DevPanel recomputes this live from the actual `usageMetadata` of the last
call, so the number tracks your prompt rather than this table.

**Two levers cut it to zero:**

- **Deterministic mode** (`Config.deterministicMode`) caches every response
  against `hash(npc + worldState + choicePath)`. A repeated path costs nothing
  and returns byte-identical text.
- **Pre-bake** walks the tree breadth-first and writes it to `ExportedTree`.
  A shipped build that plays from an exported tree makes **zero** API calls at
  runtime. Depth 3 for one NPC with ~2 continuing choices per turn is 15 nodes
  (1 + 2 + 4 + 8) — about **$0.003** to bake, then free forever.

Pre-bake is chunked: `prebakeTree` works for up to 4 minutes, returns a cursor,
and the client calls it again. It cannot hit the 6-minute execution ceiling.

---

## 5. Swapping `Lore.gs` for pgvector / Qdrant

Retrieval sits behind a one-method interface. The prompt builder in
`Dialogue.gs` calls `Lore.retrieve(query, npcId, opts)` and knows nothing else
about it.

**Step 1 — implement the same signature.** It must return an array of
`{ id, title, body, tags, secrecy, score }`, best first:

```js
var VectorRetriever = {
  name: 'qdrant-ashfall-v1',

  /**
   * @param {string} query      the player's utterance
   * @param {string} npcId      who is about to speak
   * @param {!Object=} opts     {limit, memory: Array<string>}
   * @return {!Array<!Object>}  up to opts.limit entries
   */
  retrieve: function (query, npcId, opts) {
    opts = opts || {};
    var persona = Personas.get(npcId);
    var kb = persona.knowledgeBoundaries;

    var res = UrlFetchApp.fetch(ENDPOINT + '/collections/ashfall/points/search', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'api-key': PropertiesService.getScriptProperties().getProperty('QDRANT_KEY') },
      payload: JSON.stringify({
        vector: embed(query + ' ' + (opts.memory || []).join(' ')),
        limit: (opts.limit || 4) * 3,          // over-fetch; the filter culls
        with_payload: true,
        // Push the boundary into the engine so it never ships secrets over the wire
        filter: { must_not: [{ key: 'id', match: { any: kb.doesNotKnow } }] }
      })
    });

    return JSON.parse(res.getContentText()).result
      .map(function (hit) {
        return {
          id: hit.payload.id, title: hit.payload.title, body: hit.payload.body,
          tags: hit.payload.tags, secrecy: hit.payload.secrecy, score: hit.score
        };
      })
      // Belt and braces: re-apply the boundary locally. Never trust the index
      // to be the only thing standing between a player and act three.
      .filter(function (e) { return Lore.permits(persona, e); })
      .slice(0, opts.limit || 4);
  }
};
```

**Step 2 — assign it.** One line at the bottom of `Lore.gs`:

```js
Lore.retriever = VectorRetriever;
```

Nothing upstream changes. `Dialogue.gs`, `Guardrails.gs` and the DevPanel keep
working — the panel will simply start showing `qdrant-ashfall-v1` as the
retriever name and cosine scores instead of keyword scores.

**Step 3 — seed the index.** `Lore.all()` returns the corpus in the exact shape
you need to embed and upsert. Keep `secrecy` and `id` in the payload; the local
`Lore.permits()` re-check depends on them.

**Keep the local filter.** The two-layer defence is the point: even a
misconfigured index cannot leak a `secret`-tier entry to Sister Veyla, because
`permits()` runs again on this side of the wire, and `Guardrails.checkLoreLeak`
runs a third time on the generated line.

---

## 6. What each guardrail is for

| Rule | Catches | Response |
| --- | --- | --- |
| `schema.*` | malformed or incomplete JSON | coerce what is repairable, regenerate what is not |
| `persona.neverSay` | the exact phrasings a character must never utter | regenerate once, then fallback |
| `rating.profanity` | language outside the E/T/M tier | regenerate once, then fallback |
| `lore.leak` | a `revealed` fact inside `doesNotKnow` | reject outright |
| `lore.unknownReveal` | a fact the speaker was never given | reject outright |
| `lore.paraphraseLeak` | the fact restated without naming its id | reject outright |
| `character.fourthWall` | "as an AI", "the player", "this game" | reject outright |

`ratingSensitive: true` pins a character to tier **E** regardless of what
`Config.ratingTier` says. Pike is that character: set the game to **M**, ask him
something that would earn an adult NPC a swear word, and watch the DevPanel log
`rating.profanity — tier E (forced: ratingSensitive)` while the player sees a
hand-written line instead. That is the age-rating story in one interaction.

Every rejection lands in `violations[]`, is surfaced in the DevPanel's
**Guardrails** tab, and is written to the `DialogueLog` tab for audit.

---

## 7. Exports

| Button | Produces | For |
| --- | --- | --- |
| **Export JSON** | `{nodes[], edges[]}` with parent links and `repDelta` | your own tooling |
| **Export CSV** | one row per edge | Unity / spreadsheet import |
| **Export Yarn** | `.yarn` nodes with `<<jump>>`, `<<set $rep_npc>>`, `<<stop>>` | Yarn Spinner |

Node ids are `hash(choicePath)`, so replaying a conversation refines the
existing node instead of forking a parallel one, and edges resolve to real node
ids before their children exist. An edge pointing at an unbaked branch is
flagged `unbaked` rather than silently broken.

Downloads use `Blob` + a programmatic anchor click, which works inside the
Apps Script sandboxed iframe. No `localStorage`, no `sessionStorage` — state
lives in memory and in Sheets, as the platform requires.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every NPC speaks a fallback line | no API key | set `GEMINI_API_KEY` in Script Properties |
| Boot warns "save slot unavailable" | spreadsheet not created | run `initializeSpreadsheet()` |
| `Export` says "nothing to export" | no turns recorded yet | talk to someone, or run a pre-bake |
| Blank page | a file name is misspelled | names must be exactly `Index`, `Styles`, `Sprites`, `GameEngine`, `DialogueUI`, `DevPanel` |
| Latency over 2s | cold Apps Script container | second call warms up; deterministic mode makes repeats free |
| Pre-bake stalls | `UrlFetchApp` daily quota | quota resets daily; bake one NPC at a time |

`selfTest()` in the editor checks all of the above in one run and logs a report.
