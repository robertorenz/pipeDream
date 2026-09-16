/* Pipe Dream — game engine (rules, flow simulation, scoring)
 *
 * Renderer-agnostic. The UI layer drives it with tick(dt) and listens to
 * events ('place', 'replace', 'deny', 'flowstart', 'fill', 'spill', 'end',
 * 'cleanup', 'levelcomplete', 'gameover', 'score').
 */
(function () {
  'use strict';

  const PD = window.PD;
  const { COLS, ROWS, LEVELS } = PD;

  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }; // [dc, dr]

  // Which sides each piece kind opens on.
  const PIECES = {
    H: ['W', 'E'],
    V: ['N', 'S'],
    NE: ['N', 'E'],
    NW: ['N', 'W'],
    SE: ['S', 'E'],
    SW: ['S', 'W'],
    X: ['N', 'E', 'S', 'W'],
  };
  const PLAYER_PIECES = ['H', 'V', 'NE', 'NW', 'SE', 'SW', 'X'];

  const SCORE = {
    PIECE: 50,        // each piece (or cross channel) the flooz fills
    CROSS_BONUS: 500, // both channels of a cross filled
    REPLACE: -50,     // replacing a piece already on the board
    UNUSED: -100,     // each unfilled piece removed at the end of a level
    END_BONUS: 1000,  // flooz reaches the end piece
    BONUS_PIECE: 100, // each piece filled during a bonus round
  };

  const BONUS_EVERY = 4;         // a falling-piece bonus round follows every 4th level
  const BONUS_COUNTDOWN = 15;    // seconds before the flooz starts in a bonus round
  const BONUS_FLOW_FACTOR = 1.25;
  const LAND_MS = 160;           // how long a dropped piece takes to fall into place

  const FAST_MS = 170;         // flow time per piece once the player speeds up
  const RESERVOIR_FACTOR = 3;  // reservoirs take this many times longer to fill
  const REPLACE_LOCK_MS = 450; // the old piece breaks up for this long before the new one lands
  const PLACE_POP_MS = 150;    // a newly laid piece pops into place over this long
  const SPILL_PAUSE_MS = 900;  // pause after the spill before the cleanup starts
  const CLEANUP_STEP_MS = 90;  // interval between unused pieces being removed

  function makeCell(type, extra) {
    return Object.assign(
      { type, kind: null, dir: null, fixed: false, reservoir: false, oneway: null, preplaced: false, fill: null },
      extra || {}
    );
  }

  const MAP_CHARS = {
    '.': () => makeCell('empty'),
    '#': () => makeCell('wall'),
    '^': () => makeCell('start', { dir: 'N' }),
    '>': () => makeCell('start', { dir: 'E' }),
    'v': () => makeCell('start', { dir: 'S' }),
    '<': () => makeCell('start', { dir: 'W' }),
    'n': () => makeCell('end', { dir: 'N' }),
    'e': () => makeCell('end', { dir: 'E' }),
    's': () => makeCell('end', { dir: 'S' }),
    'w': () => makeCell('end', { dir: 'W' }),
    '=': () => makeCell('pipe', { kind: 'H', fixed: true, reservoir: true }),
    '|': () => makeCell('pipe', { kind: 'V', fixed: true, reservoir: true }),
    'R': () => makeCell('pipe', { kind: 'H', fixed: true, oneway: 'E' }),
    'L': () => makeCell('pipe', { kind: 'H', fixed: true, oneway: 'W' }),
    'U': () => makeCell('pipe', { kind: 'V', fixed: true, oneway: 'N' }),
    'D': () => makeCell('pipe', { kind: 'V', fixed: true, oneway: 'S' }),
    '-': () => makeCell('pipe', { kind: 'H', preplaced: true }),
    'I': () => makeCell('pipe', { kind: 'V', preplaced: true }),
    '+': () => makeCell('pipe', { kind: 'X', preplaced: true }),
    '1': () => makeCell('pipe', { kind: 'NE', preplaced: true }),
    '2': () => makeCell('pipe', { kind: 'NW', preplaced: true }),
    '3': () => makeCell('pipe', { kind: 'SE', preplaced: true }),
    '4': () => makeCell('pipe', { kind: 'SW', preplaced: true }),
  };

  const inBounds = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const chanFor = (kind, side) => (kind === 'X' ? (side === 'W' || side === 'E' ? 'H' : 'V') : null);

  function randomPiece() {
    return PLAYER_PIECES[Math.floor(Math.random() * PLAYER_PIECES.length)];
  }

  // Has any flooz entered this cell yet?
  function fillStarted(cell) {
    if (!cell.fill) return false;
    if (cell.kind === 'X') return !!(cell.fill.H || cell.fill.V);
    return true;
  }
  function fillDone(cell) {
    if (!cell.fill) return false;
    if (cell.kind === 'X') return !!((cell.fill.H && cell.fill.H.done) || (cell.fill.V && cell.fill.V.done));
    return !!cell.fill.done;
  }

  class Game {
    constructor() {
      this.listeners = {};
      this.hiscore = Number(localStorage.getItem('pd.hiscore') || 0);
      this.phase = 'title';
      this.board = [];
      this.queue = [];
      this.effects = [];
      this.score = 0;
      this.levelIndex = 0;
      this.level = null;
      this.cursor = { c: 4, r: 3 };
      this.head = null;
      this.spill = null;
      this.now = 0;
      this.bonus = false;
      this.landings = [];
    }

    on(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
      return this;
    }
    emit(type, data) {
      (this.listeners[type] || []).forEach((fn) => fn(data, this));
    }

    /* ---------- level setup ---------- */

    newGame(levelIndex) {
      this.score = 0;
      this.loadLevel(levelIndex || 0);
    }

    loadLevel(index) {
      const lv = LEVELS[index];
      this.levelIndex = index;
      this.level = lv;
      this.bonus = false;
      this.board = lv.map.map((row) => row.split('').map((ch) => (MAP_CHARS[ch] || MAP_CHARS['.'])()));
      this.start = this.findStart() || this.placeRandomStart();
      this.end = this.findEnd();
      this.resetRound(lv.distance, lv.countdown * 1000, lv.flow * 1000);
      this.emit('level', lv);
    }

    // The original's bonus round: an empty board, the start at the bottom
    // pointing up, and pieces that drop into a column and stack like Tetris.
    // No distance to reach - every filled section is worth double.
    loadBonus() {
      const lv = this.level;
      this.bonus = true;
      this.board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => makeCell('empty')));
      const c = 1 + Math.floor(Math.random() * (COLS - 2));
      this.board[ROWS - 1][c] = makeCell('start', { dir: 'N' });
      this.start = { c, r: ROWS - 1 };
      this.end = null;
      this.resetRound(0, BONUS_COUNTDOWN * 1000, lv.flow * 1000 * BONUS_FLOW_FACTOR);
      this.emit('level', lv);
      this.emit('bonusstart');
    }

    resetRound(distance, countdownMs, flowMs) {
      this.levelStartScore = this.score;
      this.queue = Array.from({ length: 5 }, randomPiece);
      this.distance = distance;
      this.filled = 0;
      this.countdown = countdownMs;
      this.countdownTotal = countdownMs;
      this.flowTime = flowMs;
      this.fast = false;
      this.head = null;
      this.spill = null;
      this.effects = [];
      this.landings = [];
      this.lockUntil = 0;
      this.cleanup = null;
      this.endReason = null;
      this.endBonus = 0;
      this.unusedPenalty = 0;
      this.cursor = { c: Math.min(this.cursor.c, COLS - 1), r: Math.min(this.cursor.r, ROWS - 1) };
      this.phase = 'countdown';
    }

    findStart() {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (this.board[r][c].type === 'start') return { c, r };
      return null;
    }
    findEnd() {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (this.board[r][c].type === 'end') return { c, r };
      return null;
    }

    // The original drops the start piece somewhere random, pointing somewhere
    // useful. Keep it off the edges and make sure the first cell it points at
    // can actually take a pipe.
    placeRandomStart() {
      const candidates = [];
      for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
          if (this.board[r][c].type !== 'empty') continue;
          for (const dir of ['N', 'E', 'S', 'W']) {
            const [dc, dr] = DELTA[dir];
            const n = this.board[r + dr][c + dc];
            if (n.type === 'empty') candidates.push({ c, r, dir });
          }
        }
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      this.board[pick.r][pick.c] = makeCell('start', { dir: pick.dir });
      return { c: pick.c, r: pick.r };
    }

    /* ---------- player actions ---------- */

    // Bonus rounds: the row a piece dropped into column c would land in (-1 if full).
    landingRow(c) {
      for (let r = ROWS - 1; r >= 0; r--) if (this.board[r][c].type === 'empty') return r;
      return -1;
    }
    landingAt(c, r) {
      return this.landings.find((l) => l.c === c && l.r === r) || null;
    }

    canPlaceAt(c, r) {
      if (!inBounds(c, r)) return false;
      if (this.phase !== 'countdown' && this.phase !== 'flowing') return false;
      if (this.bonus) return this.landingRow(c) >= 0;
      const cell = this.board[r][c];
      if (cell.type === 'empty') return true;
      if (cell.type !== 'pipe' || cell.fixed) return false;
      if (fillStarted(cell)) return false;
      if (this.head && this.head.c === c && this.head.r === r) return false;
      return true;
    }

    place(c, r) {
      if (!this.canPlaceAt(c, r)) {
        this.emit('deny', { c, r });
        return false;
      }
      if (this.now < this.lockUntil) return false;
      if (this.bonus) r = this.landingRow(c);
      const cell = this.board[r][c];
      const kind = this.queue.shift();
      this.queue.push(randomPiece());
      const replacing = cell.type === 'pipe';
      const fresh = makeCell('pipe', { kind });
      this.board[r][c] = fresh;
      if (this.bonus) this.landings.push({ c, r, t: 0, life: LAND_MS, rows: r + 1 });
      else if (replacing) fresh.anim = { kind: 'replace', old: cell, t: 0, breakMs: REPLACE_LOCK_MS, popMs: PLACE_POP_MS };
      else fresh.anim = { kind: 'place', t: 0, breakMs: 0, popMs: PLACE_POP_MS };
      if (replacing) {
        this.addScore(SCORE.REPLACE, c, r);
        this.lockUntil = this.now + REPLACE_LOCK_MS;
        this.effects.push({ kind: 'burst', c, r, t: 0, life: REPLACE_LOCK_MS });
        this.emit('replace', { c, r, kind });
      } else {
        this.emit('place', { c, r, kind });
      }
      return true;
    }

    // Space / "flow" button: skip the countdown and run the flooz fast.
    speedUp() {
      if (this.phase === 'countdown') {
        this.fast = true;
        this.countdown = 0;
        this.startFlow();
      } else if (this.phase === 'flowing' && !this.fast) {
        this.fast = true;
        this.emit('fast');
      }
    }

    moveCursor(dc, dr) {
      this.cursor.c = (this.cursor.c + dc + COLS) % COLS;
      if (!this.bonus) this.cursor.r = (this.cursor.r + dr + ROWS) % ROWS;
    }
    setCursor(c, r) {
      if (inBounds(c, r)) this.cursor = { c, r };
    }

    pause() {
      if (this.phase === 'countdown' || this.phase === 'flowing') {
        this.resumePhase = this.phase;
        this.phase = 'paused';
      }
    }
    resume() {
      if (this.phase === 'paused') this.phase = this.resumePhase;
    }

    nextLevel() {
      const more = this.levelIndex + 1 < LEVELS.length;
      if (!this.bonus && more && this.level.n % BONUS_EVERY === 0) return this.loadBonus();
      if (more) this.loadLevel(this.levelIndex + 1);
      else this.emit('won');
    }
    retryLevel() {
      this.score = this.levelStartScore;
      this.loadLevel(this.levelIndex);
    }

    /* ---------- simulation ---------- */

    tick(dt) {
      this.now += dt;
      for (const fx of this.effects) fx.t += dt;
      this.effects = this.effects.filter((fx) => fx.t < fx.life);
      for (const l of this.landings) l.t += dt;
      this.landings = this.landings.filter((l) => l.t < l.life);
      this.tickPlaceAnims(dt);
      if (this.spill) this.spill.t += dt;

      switch (this.phase) {
        case 'countdown':
          this.countdown -= dt;
          if (this.countdown <= 0) {
            this.countdown = 0;
            this.startFlow();
          }
          break;
        case 'flowing':
          this.advance(dt);
          break;
        case 'ending':
          this.runCleanup(dt);
          break;
        default:
          break;
      }
    }

    // Advance the break/pop animations on freshly laid pieces.
    tickPlaceAnims(dt) {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const a = this.board[r][c].anim;
          if (!a) continue;
          const before = a.t;
          a.t += dt;
          if (a.kind === 'replace' && before < a.breakMs && a.t >= a.breakMs) this.emit('settle', { c, r });
          if (a.t >= a.breakMs + a.popMs) delete this.board[r][c].anim;
        }
    }

    startFlow() {
      const s = this.board[this.start.r][this.start.c];
      s.fill = { from: null, progress: 0, done: false };
      this.head = { c: this.start.c, r: this.start.r, chan: null };
      this.phase = 'flowing';
      this.emit('flowstart');
    }

    currentFill(cell, chan) {
      return chan ? cell.fill[chan] : cell.fill;
    }

    advance(dt) {
      let budget = dt;
      // Loop so a very fast flow can cross more than one piece per frame.
      while (budget > 0 && this.phase === 'flowing') {
        const h = this.head;
        const cell = this.board[h.r][h.c];
        const fill = this.currentFill(cell, h.chan);
        let duration = this.fast ? FAST_MS : this.flowTime;
        if (cell.reservoir) duration *= RESERVOIR_FACTOR;
        const remaining = (1 - fill.progress) * duration;
        if (budget < remaining) {
          fill.progress += budget / duration;
          budget = 0;
          break;
        }
        budget -= remaining;
        fill.progress = 1;
        fill.done = true;
        this.onPieceFilled(cell, h);
        if (this.phase !== 'flowing') break;
        this.moveHead(cell, fill);
      }
    }

    onPieceFilled(cell, h) {
      if (cell.type === 'pipe') {
        this.filled++;
        this.addScore(this.bonus ? SCORE.BONUS_PIECE : SCORE.PIECE, h.c, h.r);
        if (cell.kind === 'X' && cell.fill.H && cell.fill.H.done && cell.fill.V && cell.fill.V.done) {
          this.addScore(SCORE.CROSS_BONUS, h.c, h.r, true);
          this.emit('bonus', { c: h.c, r: h.r, points: SCORE.CROSS_BONUS });
        }
        this.emit('fill', { c: h.c, r: h.r, cell });
      } else if (cell.type === 'end') {
        this.filled++;
        this.addScore(SCORE.PIECE, h.c, h.r);
        this.endBonus = SCORE.END_BONUS;
        this.addScore(SCORE.END_BONUS, h.c, h.r, true);
        this.finishFlow('end', h.c, h.r, null);
      }
    }

    moveHead(cell, fill) {
      const h = this.head;
      let exitDir;
      if (cell.type === 'start') exitDir = cell.dir;
      else exitDir = PIECES[cell.kind].find((d) => d !== fill.from && chanFor(cell.kind, d) === h.chan);

      const [dc, dr] = DELTA[exitDir];
      const nc = h.c + dc;
      const nr = h.r + dr;
      const entry = OPP[exitDir];
      if (!inBounds(nc, nr)) return this.finishFlow('spill', h.c, h.r, exitDir);

      const next = this.board[nr][nc];
      if (next.type === 'pipe') {
        if (!PIECES[next.kind].includes(entry)) return this.finishFlow('spill', h.c, h.r, exitDir);
        if (next.oneway && next.oneway !== exitDir) return this.finishFlow('spill', h.c, h.r, exitDir);
        const chan = chanFor(next.kind, entry);
        if (chan) {
          next.fill = next.fill || { H: null, V: null };
          if (next.fill[chan] && next.fill[chan].done) return this.finishFlow('spill', h.c, h.r, exitDir);
          next.fill[chan] = { from: entry, progress: 0, done: false };
        } else {
          if (next.fill && next.fill.done) return this.finishFlow('spill', h.c, h.r, exitDir);
          next.fill = { from: entry, progress: 0, done: false };
        }
        this.head = { c: nc, r: nr, chan };
      } else if (next.type === 'end') {
        if (next.dir !== entry) return this.finishFlow('spill', h.c, h.r, exitDir);
        next.fill = { from: entry, progress: 0, done: false };
        this.head = { c: nc, r: nr, chan: null };
      } else {
        return this.finishFlow('spill', h.c, h.r, exitDir);
      }
    }

    finishFlow(reason, c, r, dir) {
      this.endReason = reason;
      this.phase = 'ending';
      if (reason === 'spill') this.spill = { c, r, dir, t: 0 };
      // Unused, non-fixed pipes get removed one by one with a penalty.
      const list = [];
      if (!this.bonus)
        for (let rr = 0; rr < ROWS; rr++)
          for (let cc = 0; cc < COLS; cc++) {
            const cell = this.board[rr][cc];
            if (cell.type === 'pipe' && !cell.fixed && !fillDone(cell)) list.push({ c: cc, r: rr, penalty: !cell.preplaced });
          }
      this.cleanup = { list, wait: SPILL_PAUSE_MS, timer: 0 };
      this.emit(reason === 'spill' ? 'spill' : 'end', { c, r, dir });
    }

    runCleanup(dt) {
      const cu = this.cleanup;
      if (cu.wait > 0) {
        cu.wait -= dt;
        return;
      }
      cu.timer -= dt;
      while (cu.timer <= 0 && cu.list.length) {
        const { c, r, penalty } = cu.list.shift();
        this.board[r][c] = makeCell('empty');
        if (penalty) {
          this.unusedPenalty += SCORE.UNUSED;
          this.addScore(SCORE.UNUSED, c, r);
        }
        this.effects.push({ kind: 'burst', c, r, t: 0, life: 300 });
        this.emit('cleanup', { c, r });
        cu.timer += CLEANUP_STEP_MS;
      }
      if (!cu.list.length && cu.timer <= 0) {
        this.cleanup = null;
        if (this.bonus) {
          this.phase = 'bonusover';
          this.emit('bonusover', { level: this.level, filled: this.filled, points: this.score - this.levelStartScore });
        } else if (this.filled >= this.distance) {
          this.phase = 'levelcomplete';
          this.emit('levelcomplete', { level: this.level, score: this.score, endBonus: this.endBonus, penalty: this.unusedPenalty });
        } else {
          this.phase = 'gameover';
          this.emit('gameover', { level: this.level, score: this.score, filled: this.filled, distance: this.distance });
        }
      }
    }

    addScore(points, c, r, big) {
      this.score = Math.max(0, this.score + points);
      if (this.score > this.hiscore) {
        this.hiscore = this.score;
        localStorage.setItem('pd.hiscore', String(this.hiscore));
      }
      if (c !== undefined) this.effects.push({ kind: 'pop', c, r, t: 0, life: big ? 1400 : 800, text: (points > 0 ? '+' : '') + points, big: !!big, neg: points < 0 });
      this.emit('score', { points, score: this.score });
    }

    get remaining() {
      return Math.max(0, this.distance - this.filled);
    }
  }

  PD.Game = Game;
  PD.PIECES = PIECES;
  PD.PLAYER_PIECES = PLAYER_PIECES;
  PD.OPP = OPP;
  PD.DELTA = DELTA;
  PD.SCORE = SCORE;
  PD.chanFor = chanFor;
  PD.fillStarted = fillStarted;
  PD.fillDone = fillDone;
})();
