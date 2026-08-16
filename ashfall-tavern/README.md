# Ashfall Tavern

An AI-powered NPC dialogue engine, wrapped in a playable 2D demo that proves it
works. The game is the sales pitch; the engine is the product.

Google Apps Script + vanilla ES6 + HTML5 Canvas. No npm, no build step, no
imports, no frameworks, and **zero external image or audio assets** — every
character, every stick of furniture and every flame is drawn procedurally.

**→ [SETUP.md](SETUP.md) — deploy in ten minutes, architecture diagram, how to
add a fourth NPC, cost per 1000 lines, how to swap in pgvector.**

---

## What it does

Walk into a tavern. Three characters, each with a hand-authored persona, answer
in character from a shared, retrieved world corpus — and cannot say what they
must not say.

| System | File | What a studio buys |
| --- | --- | --- |
| Persona schema | `Persona.gs` | writers edit characters as JSON; a validator is the contract |
| Lore retrieval | `Lore.gs` | anti-hallucination — NPCs cannot invent lore or leak act three |
| Generation | `Dialogue.gs` | grounded prompt, strict-JSON contract, retry, per-NPC memory |
| Guardrails | `Guardrails.gs` | age rating, `neverSay`, lore-leak and fourth-wall enforcement |
| Determinism | `Determinism.gs` | same inputs → byte-identical line, so QA can reproduce a bug |
| Export | `Export.gs` | the branching graph, shipped as JSON / CSV / Yarn Spinner |

Press `` ~ `` in the demo to open the engine panel: the exact prompt sent, the
raw model JSON, which lore entries were retrieved and why, every guardrail that
fired, live world state, latency, tokens and projected cost.

## The three characters

- **Bram Holloway** — tavern keeper, gruff and terse. Knows every rumour in
  Ashfall, including the one he is paying to keep quiet. His `secret`-tier
  knowledge is readable *to him* and blocked from his mouth by `neverSay`.
- **Sister Veyla** — wandering cleric, archaic and rambling. Bram's debt is in
  her `doesNotKnow`, so retrieval never serves it and the leak check rejects
  the line even if the model paraphrases it. Fish for it and watch her deflect.
- **Pike** — fourteen, stable hand, `ratingSensitive: true`. Pinned to ESRB **E**
  no matter what the rating dial says. Set the game to **M**, provoke him, and
  the panel logs `rating.profanity — tier E (forced: ratingSensitive)` while the
  player sees a hand-written line. That is the age-rating story in one click.

## Guarantees

- **The player never sees an error.** Malformed JSON retries once, then the NPC
  speaks a hand-written `fallbackLines` entry. Transport failure, missing API
  key, blocked completion — all degrade in character.
- **Never a dead end.** Every turn offers 2–4 choices and always exactly one
  exit; the guardrail layer injects one if the model forgets.
- **The API key never reaches the browser.** `UrlFetchApp` server-side only.
- **No `localStorage` or `sessionStorage` anywhere** — in-memory state plus
  Sheets, as the platform requires.

## Verified

| | |
| --- | --- |
| Server logic | 78 checks — guardrail blocks, retry-then-fallback, determinism cache, export formats, chunked pre-bake |
| Browser end-to-end | 69 checks in headless Chromium against the real server code — movement, collision, depth sort, dialogue, exports, config |
| Frame cost | **0.40ms median / 0.60ms p95** with all three NPCs performing emotion clips — 27x headroom inside the 60fps budget |
| Allocation | **0 KB heap growth over 900 frames** — the render path allocates nothing |
| Prompt size | 5,808–5,937 chars (~1,468 input tokens) at the six-turn memory cap |
