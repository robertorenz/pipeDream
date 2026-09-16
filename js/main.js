/* Pipe Dream — UI glue: input, HUD, modals, dispenser, main loop */
(function () {
  'use strict';

  const PD = window.PD;
  const $ = (sel) => document.querySelector(sel);

  const game = new PD.Game();
  const audio = new PD.Audio();
  const boardCanvas = $('#board');
  const dispCanvas = $('#dispenser');
  const dispCtx = dispCanvas.getContext('2d');

  const renderers = {
    flat: new PD.FlatRenderer(boardCanvas),
    depth: new PD.DepthRenderer(boardCanvas),
  };
  let renderer = renderers[localStorage.getItem('pd.view')] || renderers.flat;

  /* ---------- view mode ---------- */

  function setView(name) {
    renderer = renderers[name] || renderers.flat;
    localStorage.setItem('pd.view', renderer.name);
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === renderer.name));
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  setView(renderer.name);

  /* ---------- sound ---------- */

  const btnSound = $('#btn-sound');
  function syncSound() {
    btnSound.classList.toggle('muted', audio.muted);
  }
  btnSound.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    syncSound();
    if (!audio.muted) audio.place();
  });
  syncSound();

  /* ---------- modals ---------- */

  const backdrop = $('#modals');
  let openModal = null;

  function showModal(id) {
    document.querySelectorAll('.modal').forEach((m) => (m.hidden = true));
    const m = document.getElementById(id);
    m.hidden = false;
    backdrop.hidden = false;
    openModal = id;
    const focus = m.querySelector('input, .btn-primary, .btn');
    if (focus) setTimeout(() => focus.focus(), 30);
  }
  function hideModals() {
    backdrop.hidden = true;
    document.querySelectorAll('.modal').forEach((m) => (m.hidden = true));
    openModal = null;
  }

  function showTitle() {
    game.phase = 'title';
    $('#title-hiscore').textContent = game.hiscore.toLocaleString();
    showModal('modal-title');
  }

  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = b.dataset.close;
      if (target === 'title') return showTitle();
      // "auto": go back to whatever makes sense for the current phase
      if (game.phase === 'title') return showTitle();
      if (game.phase === 'paused') return showModal('modal-pause');
      hideModals();
    })
  );

  $('#btn-new').addEventListener('click', () => startGame(0));
  $('#btn-over-new').addEventListener('click', () => startGame(0));
  $('#btn-won-new').addEventListener('click', () => startGame(0));
  $('#btn-password').addEventListener('click', () => {
    $('#password-error').hidden = true;
    $('#input-password').value = '';
    showModal('modal-password');
  });
  $('#btn-howto').addEventListener('click', () => showModal('modal-help'));
  $('#btn-help').addEventListener('click', () => {
    if (game.phase === 'countdown' || game.phase === 'flowing') game.pause();
    showModal('modal-help');
  });
  $('#form-password').addEventListener('submit', (e) => {
    e.preventDefault();
    const lv = PD.findLevelByPassword($('#input-password').value);
    if (!lv) {
      $('#password-error').hidden = false;
      audio.deny();
      return;
    }
    startGame(lv.n - 1);
  });
  $('#btn-next').addEventListener('click', () => {
    hideModals();
    game.nextLevel();
  });
  $('#btn-retry').addEventListener('click', () => {
    hideModals();
    game.retryLevel();
  });
  $('#btn-bonus-start').addEventListener('click', resumeGame);
  $('#btn-bonus-continue').addEventListener('click', () => {
    hideModals();
    game.nextLevel();
  });
  $('#btn-resume').addEventListener('click', resumeGame);
  $('#btn-quit').addEventListener('click', () => showTitle());
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-flow').addEventListener('click', () => {
    audio.ensure();
    game.speedUp();
    boardCanvas.focus();
  });

  function startGame(levelIndex) {
    audio.ensure();
    hideModals();
    game.newGame(levelIndex);
  }

  function togglePause() {
    if (game.phase === 'paused') resumeGame();
    else if (game.phase === 'countdown' || game.phase === 'flowing') {
      game.pause();
      showModal('modal-pause');
    }
  }
  function resumeGame() {
    hideModals();
    game.resume();
  }

  // Pause when the tab loses focus so the flooz doesn't win while you're away.
  window.addEventListener('blur', () => {
    if (game.phase === 'countdown' || game.phase === 'flowing') {
      game.pause();
      showModal('modal-pause');
    }
  });

  /* ---------- game events ---------- */

  let dispAnim = 0; // 1 -> 0 while the queue slides down
  let lastTickSecond = -1;

  game
    .on('place', () => {
      audio.place();
      dispAnim = 1;
    })
    .on('replace', () => {
      audio.replace();
      dispAnim = 1;
    })
    .on('deny', () => audio.deny())
    .on('flowstart', () => audio.flowStart())
    .on('fast', () => audio.fast())
    .on('fill', () => audio.fill())
    .on('bonus', () => audio.bonus())
    .on('spill', () => audio.spill())
    .on('end', () => audio.endReached())
    .on('cleanup', () => audio.cleanup())
    .on('level', () => {
      lastTickSecond = -1;
      updateHud();
    })
    .on('score', updateHud)
    .on('levelcomplete', (d) => {
      audio.levelComplete();
      const next = PD.LEVELS[game.levelIndex + 1];
      $('#level-subtitle').textContent = `Level ${d.level.n} cleared with ${game.filled} sections filled.`;
      $('#lc-filled').textContent = `${game.filled} / ${game.distance}`;
      setStat('#lc-bonus', d.endBonus, true);
      setStat('#lc-penalty', d.penalty, true);
      $('#lc-score').textContent = d.score.toLocaleString();
      const pw = $('#lc-password');
      if (next && next.password) {
        pw.hidden = false;
        pw.innerHTML = `Password for level ${next.n}: <strong>${next.password}</strong>`;
      } else pw.hidden = true;
      $('#btn-next').textContent = next ? `Level ${next.n}` : 'Finish';
      showModal('modal-level');
    })
    .on('bonusstart', () => {
      game.pause();
      showModal('modal-bonus');
    })
    .on('bonusover', (d) => {
      audio.levelComplete();
      const next = PD.LEVELS[game.levelIndex + 1];
      $('#bonus-filled').textContent = d.filled;
      setStat('#bonus-points', d.points, true);
      $('#bonus-score').textContent = game.score.toLocaleString();
      $('#btn-bonus-continue').textContent = next ? `Level ${next.n}` : 'Finish';
      showModal('modal-bonus-over');
    })
    .on('gameover', (d) => {
      audio.gameOver();
      $('#over-subtitle').textContent = `The flooz got loose on level ${d.level.n}.`;
      $('#go-filled').textContent = d.filled;
      $('#go-needed').textContent = d.distance;
      $('#go-score').textContent = d.score.toLocaleString();
      $('#go-hiscore').textContent = game.hiscore.toLocaleString();
      showModal('modal-over');
    })
    .on('won', () => {
      $('#won-score').textContent = game.score.toLocaleString();
      $('#won-hiscore').textContent = game.hiscore.toLocaleString();
      game.phase = 'title';
      showModal('modal-won');
    });

  function setStat(sel, value, signed) {
    const el = $(sel);
    el.textContent = (signed && value > 0 ? '+' : '') + value.toLocaleString();
    el.classList.toggle('neg', value < 0);
    el.classList.toggle('pos', value > 0);
  }

  /* ---------- HUD ---------- */

  const hud = {
    level: $('#hud-level'),
    score: $('#hud-score'),
    distance: $('#hud-distance'),
    hiscore: $('#hud-hiscore'),
    timer: $('#timer-fill'),
    distanceBox: $('.stat-distance'),
    flowBtn: $('#btn-flow'),
  };

  function updateHud() {
    if (!game.level) return;
    hud.level.textContent = game.bonus ? 'Bonus' : game.level.n;
    hud.score.textContent = game.score.toLocaleString();
    hud.distance.textContent = game.bonus ? '\u2014' : game.remaining;
    hud.hiscore.textContent = game.hiscore.toLocaleString();
    hud.distanceBox.classList.toggle('done', !game.bonus && game.remaining === 0);
  }

  function updateTimer() {
    const t = hud.timer;
    if (game.phase === 'countdown' || (game.phase === 'paused' && game.resumePhase === 'countdown')) {
      const k = game.countdown / game.countdownTotal;
      t.style.width = `${Math.max(0, k * 100)}%`;
      t.classList.toggle('urgent', game.countdown < 6000);
      t.classList.remove('flowing');
      hud.flowBtn.disabled = false;
    } else if (game.phase === 'flowing' || (game.phase === 'paused' && game.resumePhase === 'flowing')) {
      t.style.width = '100%';
      t.classList.remove('urgent');
      t.classList.add('flowing');
      hud.flowBtn.disabled = game.fast;
    } else {
      t.style.width = '0%';
      hud.flowBtn.disabled = true;
    }
  }

  /* ---------- input ---------- */

  function canvasPoint(e) {
    const rect = boardCanvas.getBoundingClientRect();
    return [((e.clientX - rect.left) * boardCanvas.width) / rect.width, ((e.clientY - rect.top) * boardCanvas.height) / rect.height];
  }

  boardCanvas.addEventListener('mousemove', (e) => {
    const hit = renderer.hitTest(...canvasPoint(e));
    if (hit) game.setCursor(hit.c, hit.r);
  });
  boardCanvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    audio.ensure();
    const hit = renderer.hitTest(...canvasPoint(e));
    if (!hit) return;
    game.setCursor(hit.c, hit.r);
    game.place(hit.c, hit.r);
  });
  boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  boardCanvas.addEventListener(
    'touchstart',
    (e) => {
      const t = e.changedTouches[0];
      audio.ensure();
      const hit = renderer.hitTest(...canvasPoint(t));
      if (!hit) return;
      e.preventDefault();
      game.setCursor(hit.c, hit.r);
      game.place(hit.c, hit.r);
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const key = e.key;
    if (key === 'Escape' || key === 'p' || key === 'P') {
      if (openModal && openModal !== 'modal-pause') return; // let other modals be
      togglePause();
      e.preventDefault();
      return;
    }
    if (key === 'm' || key === 'M') {
      audio.setMuted(!audio.muted);
      syncSound();
      return;
    }
    if (key === 'v' || key === 'V') {
      setView(renderer.name === 'flat' ? 'depth' : 'flat');
      return;
    }
    if (key === 'h' || key === 'H') {
      $('#btn-help').click();
      return;
    }
    if (openModal) return;
    switch (key) {
      case 'ArrowLeft':
        game.moveCursor(-1, 0);
        break;
      case 'ArrowRight':
        game.moveCursor(1, 0);
        break;
      case 'ArrowUp':
        game.moveCursor(0, -1);
        break;
      case 'ArrowDown':
        if (game.bonus) {
          audio.ensure();
          game.place(game.cursor.c, 0);
        } else game.moveCursor(0, 1);
        break;
      case 'Enter':
      case 'z':
      case 'Z':
        audio.ensure();
        game.place(game.cursor.c, game.cursor.r);
        break;
      case ' ':
        audio.ensure();
        game.speedUp();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  /* ---------- dispenser ---------- */

  const narrow = window.matchMedia('(max-width: 720px)');

  function drawDispenser(dt) {
    const horizontal = narrow.matches;
    const wantW = horizontal ? 400 : 96;
    const wantH = horizontal ? 96 : 400;
    if (dispCanvas.width !== wantW || dispCanvas.height !== wantH) {
      dispCanvas.width = wantW;
      dispCanvas.height = wantH;
    }
    if (dispAnim > 0) dispAnim = Math.max(0, dispAnim - dt / 140);
    const ctx = dispCtx;
    ctx.fillStyle = PD.COLORS.bg;
    ctx.fillRect(0, 0, wantW, wantH);
    if (!game.queue.length) return;

    const slot = 78;
    const size = 60;
    const n = game.queue.length;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, wantW, wantH);
    ctx.clip();
    for (let i = n - 1; i >= 0; i--) {
      // index 0 (next) sits at the bottom / left; pieces slide toward it
      let cx;
      let cy;
      if (horizontal) {
        cx = 48 + i * slot + dispAnim * slot;
        cy = wantH / 2;
      } else {
        cx = wantW / 2;
        cy = wantH - 44 - i * slot - dispAnim * slot;
      }
      ctx.globalAlpha = i === n - 1 ? 1 - dispAnim : 1;
      renderer.drawPieceIcon(ctx, game.queue[i], cx, cy, size);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // frame around the next piece
    const active = game.phase === 'countdown' || game.phase === 'flowing';
    ctx.strokeStyle = active ? PD.COLORS.cursor : PD.COLORS.tileBorder;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = PD.COLORS.cursor;
    ctx.shadowBlur = active ? 10 : 0;
    if (horizontal) PD.roundRect(ctx, 48 - 36, wantH / 2 - 36, 72, 72, 8);
    else PD.roundRect(ctx, wantW / 2 - 36, wantH - 44 - 36, 72, 72, 8);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /* ---------- main loop ---------- */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;
    game.tick(dt);

    // countdown ticks in the last few seconds
    if (game.phase === 'countdown' && game.countdown < 5000) {
      const s = Math.ceil(game.countdown / 1000);
      if (s !== lastTickSecond) {
        lastTickSecond = s;
        audio.tick();
      }
    }

    renderer.draw(game);
    drawDispenser(dt);
    updateTimer();
    if (game.phase === 'flowing' || game.phase === 'ending') updateHud();
    requestAnimationFrame(frame);
  }

  // Expose for debugging / automated tests.
  PD.game = game;
  PD.getRenderer = () => renderer;

  // Draw an empty board behind the title screen.
  game.board = Array.from({ length: PD.ROWS }, () => Array.from({ length: PD.COLS }, () => ({ type: 'empty', fill: null })));
  updateHud();
  showTitle();
  requestAnimationFrame(frame);
})();
