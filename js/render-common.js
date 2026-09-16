/* Pipe Dream — helpers shared by the flat and 2.5D renderers */
(function () {
  'use strict';

  const PD = window.PD;

  PD.CANVAS_W = 760;
  PD.CANVAS_H = 480;

  PD.COLORS = {
    bg: '#0d0d1a',
    tile: '#16213e',
    tileAlt: '#182645',
    tileBorder: '#2a2a4a',
    tileSide: '#0f172e',
    wall: '#0f3460',
    wallLight: '#1d5aa0',
    wallDark: '#0a2245',
    pipeDark: '#2b3445',
    pipeShadow: '#4a5563',
    pipe: '#8b95a7',
    pipeLight: '#e2e8f0',
    flooz: '#22c55e',
    floozLight: '#a7f3c1',
    floozDark: '#15803d',
    start: '#D97706',
    startLight: '#fbbf24',
    startDark: '#92400e',
    end: '#0891B2',
    endLight: '#67e8f9',
    endDark: '#155e75',
    arrow: '#e94560',
    cursor: '#06B6D4',
    cursorBad: '#DC2626',
    text: '#e0e0e0',
    popNeg: '#f87171',
    popBig: '#fbbf24',
  };

  // Unit vector for each side, in cell space (x right, y down).
  PD.SIDE_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

  /** Points along a polyline up to `progress` (0..1) of its total length. */
  PD.partialPolyline = function (pts, progress) {
    if (progress <= 0) return [pts[0]];
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      const len = Math.hypot(dx, dy);
      segs.push(len);
      total += len;
    }
    let target = Math.min(1, progress) * total;
    const out = [pts[0]];
    for (let i = 0; i < segs.length; i++) {
      if (target >= segs[i]) {
        out.push(pts[i + 1]);
        target -= segs[i];
      } else {
        const f = segs[i] === 0 ? 0 : target / segs[i];
        out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
        break;
      }
    }
    return out;
  };

  /** Stroke a polyline with a cylinder-like gradient across its width. */
  PD.strokeTube = function (ctx, pts, width, light, mid, dark, cap) {
    if (pts.length < 2) return;
    // Use the first segment's direction to orient the gradient; segments in a
    // cell are short enough that this reads correctly.
    const a = pts[0];
    const b = pts[pts.length - 1];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const n = Math.hypot(nx, ny) || 1;
    nx /= n;
    ny /= n;
    // Point the normal up (or left for verticals) so the highlight sits top-left.
    if (ny > 0 || (ny === 0 && nx > 0)) {
      nx = -nx;
      ny = -ny;
    }
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const g = ctx.createLinearGradient(mx + nx * width * 0.5, my + ny * width * 0.5, mx - nx * width * 0.5, my - ny * width * 0.5);
    g.addColorStop(0, mid);
    g.addColorStop(0.25, light);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, dark);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.lineCap = cap || 'butt';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };

  PD.strokePath = function (ctx, pts, width, color, cap) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = cap || 'butt';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };

  PD.roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  PD.polygon = function (ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  /**
   * Where the cursor would put the next piece: the hovered cell normally, or
   * the landing cell of the hovered column during a bonus round.
   */
  PD.cursorTarget = function (game) {
    if (game.phase !== 'countdown' && game.phase !== 'flowing') return null;
    const { c, r } = game.cursor;
    if (game.bonus) {
      const lr = game.landingRow(c);
      return { c, r: lr < 0 ? 0 : lr, ok: lr >= 0, column: true };
    }
    return { c, r, ok: game.canPlaceAt(c, r), column: false };
  };

  /** Vertical offset (px) for a piece still dropping into place in a bonus round. */
  PD.landingOffset = function (game, c, r, cellH) {
    const l = game.landingAt ? game.landingAt(c, r) : null;
    if (!l) return 0;
    const k = l.t / l.life;
    return -(1 - k * k) * l.rows * cellH;
  };

  /** The flooz path through a non-cross pipe, as a list of "from"/"center"/"to" sides. */
  PD.floozRoute = function (cell, chan) {
    if (!cell.fill) return null;
    const fill = chan ? cell.fill[chan] : cell.fill;
    if (!fill) return null;
    if (cell.type === 'start') return { from: null, to: cell.dir, progress: fill.progress };
    if (cell.type === 'end') return { from: fill.from, to: null, progress: fill.progress };
    const opens = PD.PIECES[cell.kind];
    const to = opens.find((d) => d !== fill.from && PD.chanFor(cell.kind, d) === (chan || null));
    return { from: fill.from, to, progress: fill.progress };
  };

  /** Score popups and bursts, drawn identically by both renderers given a screen anchor. */
  PD.drawEffect = function (ctx, fx, sx, sy, scale) {
    const k = fx.t / fx.life;
    if (fx.kind === 'pop') {
      ctx.save();
      ctx.globalAlpha = 1 - Math.pow(k, 2);
      ctx.font = `${fx.big ? 'bold 20px' : 'bold 15px'} "Segoe UI", Tahoma, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = fx.neg ? PD.COLORS.popNeg : fx.big ? PD.COLORS.popBig : PD.COLORS.floozLight;
      const y = sy - k * 34 * scale;
      ctx.strokeText(fx.text, sx, y);
      ctx.fillText(fx.text, sx, y);
      ctx.restore();
    } else if (fx.kind === 'burst') {
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = PD.COLORS.arrow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 6 + k * 26 * scale, (6 + k * 26 * scale) * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = PD.COLORS.pipeLight;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.4;
        const d = 4 + k * 30 * scale;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(ang) * d, sy + Math.sin(ang) * d * 0.7, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  /** Green splash where the flooz spilled. */
  PD.drawSpill = function (ctx, sx, sy, dirVec, t) {
    const k = Math.min(1, t / 900);
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const spread = (i - 3) * 0.35;
      const ang = Math.atan2(dirVec[1], dirVec[0]) + spread;
      const d = 6 + k * (18 + (i % 3) * 10);
      const r = 5 - k * 2 + (i % 2);
      ctx.globalAlpha = 0.95 - k * 0.5;
      ctx.fillStyle = i % 2 ? PD.COLORS.flooz : PD.COLORS.floozLight;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(ang) * d, sy + Math.sin(ang) * d * 0.8 + k * 6, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = PD.COLORS.flooz;
    ctx.beginPath();
    ctx.ellipse(sx + dirVec[0] * 8, sy + dirVec[1] * 8 + 4, 10 + k * 10, 5 + k * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
})();
