/**
 * Export.gs — the branching graph and the artefact a studio actually ships.
 *
 * Every generated turn becomes a node `{id, npcId, parent, line, emotion,
 * intent, edges[]}` where each edge carries `{choiceText, tone, repDelta,
 * leadsTo, nextNode}`. Node ids are a hash of the choice PATH, so the same
 * path always produces the same id — replaying a conversation refines the
 * existing tree instead of forking a parallel one.
 *
 * WHY A STUDIO PAYS FOR THIS: pre-baked trees mean zero runtime latency, zero
 * runtime API spend and a deterministic shipped build. Live generation is the
 * upsell, not the dependency.
 */

/** @const {!Object} */
var Exporter = (function () {

  /** @const {string} Terminal sentinel used by exit edges. */
  var END = 'END';

  /**
   * Stable node id for a choice path.
   * @param {string} npcId Speaking character.
   * @param {!Array<string>} path Ordered player choices, root first.
   * @return {string} Node id.
   */
  function nodeIdFor(npcId, path) {
    return 'n_' + npcId + '_' + Determinism.hash((path || []).join(' > '));
  }

  /**
   * Writes one generated turn into the ExportedTree tab as edge rows.
   * Never throws — a logging failure must not cost the player their line.
   * @param {string} npcId Speaking character.
   * @param {string} parentNode Parent node id ('' at the root).
   * @param {!Array<string>} path Choice path including this turn.
   * @param {!Object} response Accepted response object.
   * @return {string} The node id that was recorded.
   */
  function recordTurn(npcId, parentNode, path, response) {
    var nodeId = nodeIdFor(npcId, path);
    try {
      var rows = [];
      var choices = response.choices || [];
      if (!choices.length) {
        rows.push([nodeId, npcId, parentNode || '', response.line, response.emotion,
                   response.intent, '', '', END, 0]);
      }
      for (var i = 0; i < choices.length; i++) {
        var c = choices[i];
        var next = (c.leadsTo === 'end') ? END : nodeIdFor(npcId, path.concat([c.text]));
        rows.push([
          nodeId, npcId, parentNode || '', response.line, response.emotion, response.intent,
          c.text, c.tone, next, c.repDelta || 0
        ]);
      }
      SheetsDb.appendTreeRows(rows);
    } catch (err) {
      // swallow — the tree is a by-product, not the product
    }
    return nodeId;
  }

  /**
   * Folds the flat edge rows into a node graph, de-duplicating repeat visits.
   * @param {string=} npcId Optional filter.
   * @return {!Object} `{nodes, edges, npcIds}`.
   */
  function buildGraph(npcId) {
    var rows = SheetsDb.readTreeRows(npcId);
    var byId = {};
    var order = [];
    var edges = [];
    var npcIds = {};

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      npcIds[r.npcId] = true;

      var node = byId[r.nodeId];
      if (!node) {
        node = {
          id: r.nodeId,
          npcId: r.npcId,
          parent: r.parentNode || null,
          line: r.line,
          emotion: r.emotion,
          intent: r.intent,
          edges: []
        };
        byId[r.nodeId] = node;
        order.push(r.nodeId);
      } else {
        // A later pass regenerated this node — keep the newest wording.
        node.line = r.line || node.line;
        node.emotion = r.emotion || node.emotion;
        node.intent = r.intent || node.intent;
        if (!node.parent && r.parentNode) node.parent = r.parentNode;
      }

      if (!r.choiceText) continue;
      var dup = false;
      for (var e = 0; e < node.edges.length; e++) {
        if (node.edges[e].choiceText === r.choiceText) { dup = true; break; }
      }
      if (dup) continue;

      var edge = {
        from: r.nodeId,
        choiceText: r.choiceText,
        tone: r.tone,
        repDelta: r.repDelta || 0,
        leadsTo: (r.nextNode === END) ? 'end' : 'continue',
        nextNode: r.nextNode
      };
      node.edges.push(edge);
      edges.push(edge);
    }

    var nodes = order.map(function (id) { return byId[id]; });

    // Mark dangling edges so an importer knows the branch is unbaked rather
    // than broken.
    for (var k = 0; k < edges.length; k++) {
      if (edges[k].nextNode !== END && !byId[edges[k].nextNode]) edges[k].unbaked = true;
    }

    return { nodes: nodes, edges: edges, npcIds: Object.keys(npcIds) };
  }

  /**
   * Escapes one CSV field.
   * @param {*} v Value.
   * @return {string} Quoted field.
   */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  }

  /**
   * Yarn Spinner node titles must be bare identifiers.
   * @param {string} id Node id.
   * @return {string} Sanitised identifier.
   */
  function yarnTitle(id) {
    return String(id).replace(/[^A-Za-z0-9_]/g, '_');
  }

  /**
   * `{nodes, edges}` as pretty JSON.
   * @param {!Object} graph Graph from buildGraph.
   * @return {string} JSON document.
   */
  function toJson(graph) {
    return JSON.stringify({
      format: 'ashfall-dialogue-graph',
      version: 1,
      generatedAt: new Date().toISOString(),
      npcIds: graph.npcIds,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges
    }, null, 2);
  }

  /**
   * Flat CSV, one row per edge — the shape a Unity importer wants.
   * @param {!Object} graph Graph from buildGraph.
   * @return {string} CSV document.
   */
  function toCsv(graph) {
    var out = ['npcId,nodeId,parentNode,line,emotion,intent,choiceText,tone,repDelta,nextNode'];
    for (var i = 0; i < graph.nodes.length; i++) {
      var n = graph.nodes[i];
      if (!n.edges.length) {
        out.push([n.npcId, n.id, n.parent || '', n.line, n.emotion, n.intent, '', '', 0, END]
            .map(csvCell).join(','));
        continue;
      }
      for (var e = 0; e < n.edges.length; e++) {
        var ed = n.edges[e];
        out.push([n.npcId, n.id, n.parent || '', n.line, n.emotion, n.intent,
                  ed.choiceText, ed.tone, ed.repDelta, ed.nextNode].map(csvCell).join(','));
      }
    }
    return out.join('\n');
  }

  /**
   * Yarn Spinner `.yarn` document. Relationship deltas become `<<set>>`
   * commands so the tree keeps its state machine after export.
   * @param {!Object} graph Graph from buildGraph.
   * @return {string} Yarn document.
   */
  function toYarn(graph) {
    var out = [];
    var names = {};
    Personas.list().forEach(function (p) { names[p.id] = p.name; });

    for (var i = 0; i < graph.nodes.length; i++) {
      var n = graph.nodes[i];
      var speaker = names[n.npcId] || n.npcId;
      out.push('title: ' + yarnTitle(n.id));
      out.push('tags: npc_' + n.npcId + ' emotion_' + (n.emotion || 'neutral') +
               ' intent_' + (n.intent || 'inform'));
      out.push('---');
      out.push(speaker + ': ' + String(n.line).replace(/\r?\n/g, ' '));

      for (var e = 0; e < n.edges.length; e++) {
        var ed = n.edges[e];
        out.push('-> ' + ed.choiceText + ' #tone_' + (ed.tone || 'blunt'));
        if (ed.repDelta) {
          var op = ed.repDelta > 0 ? ' + ' : ' - ';
          out.push('    <<set $rep_' + n.npcId + ' to $rep_' + n.npcId + op + Math.abs(ed.repDelta) + '>>');
        }
        if (ed.nextNode === END || ed.leadsTo === 'end') {
          out.push('    <<stop>>');
        } else if (ed.unbaked) {
          out.push('    // branch not baked — regenerate at depth+1');
          out.push('    <<stop>>');
        } else {
          out.push('    <<jump ' + yarnTitle(ed.nextNode) + '>>');
        }
      }
      out.push('===');
      out.push('');
    }
    return out.join('\n');
  }

  /**
   * Exports the recorded graph in one of three formats.
   * @param {string} format `json` | `csv` | `yarn`.
   * @param {string=} npcId Optional filter.
   * @return {!Object} `{ok, format, filename, mime, content, nodeCount, edgeCount}`.
   */
  function exportTree(format, npcId) {
    var fmt = String(format || 'json').toLowerCase();
    var graph = buildGraph(npcId || '');
    var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
    var slug = 'ashfall-' + (npcId ? (npcId + '-') : '') + stamp;

    if (fmt === 'csv') {
      return { ok: true, format: 'csv', filename: slug + '.csv', mime: 'text/csv',
               content: toCsv(graph), nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
    }
    if (fmt === 'yarn') {
      return { ok: true, format: 'yarn', filename: slug + '.yarn', mime: 'text/plain',
               content: toYarn(graph), nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
    }
    return { ok: true, format: 'json', filename: slug + '.json', mime: 'application/json',
             content: toJson(graph), nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
  }

  /**
   * Shrinks a state snapshot before it rides in a prebake cursor — the cursor
   * makes a client round trip on every chunk.
   * @param {!Object} state Full state.
   * @return {!Object} Trimmed copy.
   */
  function trimState(state) {
    var copy = JSON.parse(JSON.stringify(state));
    for (var id in copy.npcMemory) {
      if (!Object.prototype.hasOwnProperty.call(copy.npcMemory, id)) continue;
      var turns = copy.npcMemory[id].turns || [];
      copy.npcMemory[id].turns = turns.slice(-Dialogue.MEMORY_IN_PROMPT);
    }
    return copy;
  }

  /**
   * Breadth-first pre-bake, chunked to survive the 6-minute execution ceiling.
   * Call repeatedly with the returned cursor until `done` is true.
   *
   * @param {string} npcId Persona to walk.
   * @param {number} depth Target depth (1-4); depth 3 is the demo default.
   * @param {?string} cursorJson Cursor from the previous chunk, or null to start.
   * @return {!Object} `{ok, done, cursor, generated, queued, elapsedMs, message, warnings}`.
   */
  function prebake(npcId, depth, cursorJson) {
    var persona = Personas.get(npcId);
    if (!persona) return { ok: false, done: true, error: 'Unknown npcId: ' + npcId };

    var maxDepth = Math.max(1, Math.min(4, Math.round(Number(depth) || 3)));
    var cursor = SheetsDb.parseJson(cursorJson, null);

    if (!cursor || cursor.npcId !== npcId) {
      var seed = SheetsDb.newState('prebake-' + npcId);
      seed.conversation = { npcId: npcId, path: [], parentNode: '', pendingChoice: null };
      cursor = {
        npcId: npcId,
        maxDepth: maxDepth,
        generated: 0,
        chunks: 0,
        warnings: [],
        queue: [{ depth: 0, choiceText: null, stateJson: JSON.stringify(seed) }]
      };
    }
    cursor.chunks++;

    var start = Date.now();
    var producedThisChunk = 0;

    // Always generate at least one node per chunk. A chunk that returns
    // `done:false` having produced nothing would leave the caller looping
    // forever on an unchanged cursor, so forward progress is unconditional
    // and the budget is only allowed to stop the SECOND node onward.
    while (cursor.queue.length &&
           (producedThisChunk === 0 || (Date.now() - start) < ASHFALL.PREBAKE_BUDGET_MS)) {
      var item = cursor.queue.shift();
      var res = Dialogue.generateLine(npcId, item.choiceText, item.stateJson);
      cursor.generated++;
      producedThisChunk++;

      if (!res.ok && res.debug && res.debug.error && cursor.warnings.length < 5) {
        cursor.warnings.push('depth ' + item.depth + ': ' + res.debug.error);
      }

      if (item.depth >= cursor.maxDepth) continue;

      var childState = trimState(res.state);
      var choices = (res.response && res.response.choices) || [];
      for (var i = 0; i < choices.length; i++) {
        var c = choices[i];
        if (c.leadsTo === 'end') continue;                       // exits are leaves
        var forked = JSON.parse(JSON.stringify(childState));
        forked.conversation = {
          npcId: npcId,
          path: (res.state.conversation && res.state.conversation.path) || [],
          parentNode: (res.state.conversation && res.state.conversation.parentNode) || '',
          pendingChoice: c
        };
        cursor.queue.push({
          depth: item.depth + 1,
          choiceText: c.text,
          stateJson: JSON.stringify(forked)
        });
      }
    }

    var done = cursor.queue.length === 0;
    return {
      ok: true,
      done: done,
      cursor: done ? null : JSON.stringify(cursor),
      generated: cursor.generated,
      producedThisChunk: producedThisChunk,
      queued: cursor.queue.length,
      chunks: cursor.chunks,
      elapsedMs: Date.now() - start,
      warnings: cursor.warnings,
      message: done
        ? ('Baked ' + cursor.generated + ' nodes for ' + persona.name + ' to depth ' + cursor.maxDepth + '.')
        : ('Chunk ' + cursor.chunks + ': ' + cursor.generated + ' nodes baked, ' +
           cursor.queue.length + ' still queued — call again with the cursor.')
    };
  }

  return {
    END: END,
    nodeIdFor: nodeIdFor,
    recordTurn: recordTurn,
    buildGraph: buildGraph,
    toJson: toJson,
    toCsv: toCsv,
    toYarn: toYarn,
    exportTree: exportTree,
    prebake: prebake
  };
})();
