/* Pipe Dream — flat (classic top-down) renderer */
(function () {
  'use strict';

  const PD = window.PD;
  const C = PD.COLORS;
  const { COLS, ROWS } = PD;
  const W = PD.CANVAS_W;
  const H = PD.CANVAS_H;

  const CELL = 64;
  const BOARD_W = COLS * CELL;
  const BOARD_H = ROWS * CELL;
  const OX = Math.round((W - BOARD_W) / 2);
  const OY = Math.round((H - BOARD_H) / 2);

  const edge = (cx, cy, side, s) => {
    const v = PD.SIDE_VEC[side];
    return [cx + (v[0] * s) / 2, cy + (v[1] * s) / 2];
  };

  class FlatRenderer {
    constructor(canvas) {
      this.name = 'flat';
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      canvas.width = W;
      canvas.height = H;
    }

    hitTest(px, py) {
      const c = Math.floor((px - OX) / CELL);
      const r = Math.floor((py - OY) / CELL);
      return c >= 0 && r >= 0 && c < COLS && r < ROWS ? { c, r } : null;
    }

    center(c, r) {
      return [OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2];
    }

    /* ---------- frame ---------- */

    draw(game) {
      const ctx = this.ctx;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      // board frame
      PD.roundRect(ctx, OX - 10, OY - 10, BOARD_W + 20, BOARD_H + 20, 12);
      ctx.fillStyle = '#101a34';
      ctx.fill();
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 2;
      ctx.stroke();

      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) this.drawTile(ctx, c, r);

      ctx.save();
      ctx.beginPath();
      ctx.rect(OX, OY, BOARD_W, BOARD_H);
      ctx.clip();
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const cell = game.board[r][c];
          const [cx, cy0] = this.center(c, r);
          const cy = cy0 + PD.landingOffset(game, c, r, CELL);
          PD.drawAnimated(ctx, cell, cx, cy, (cl) => this.drawCell(ctx, cl, cx, cy, CELL));
        }
      ctx.restore();

      this.drawCursor(ctx, game);

      if (game.spill) {
        const [cx, cy] = this.center(game.spill.c, game.spill.r);
        const [ex, ey] = edge(cx, cy, game.spill.dir, CELL);
        PD.drawSpill(ctx, ex, ey, PD.SIDE_VEC[game.spill.dir], game.spill.t);
      }
      for (const fx of game.effects) {
        const [cx, cy] = this.center(fx.c, fx.r);
        PD.drawEffect(ctx, fx, cx, cy, 1);
      }
    }

    drawTile(ctx, c, r) {
      const x = OX + c * CELL;
      const y = OY + r * CELL;
      ctx.fillStyle = (c + r) % 2 ? C.tileAlt : C.tile;
      ctx.fillRect(x, y, CELL, CELL);
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(x + 1, y + 1, CELL - 2, 2);
      ctx.fillRect(x + 1, y + 1, 2, CELL - 2);
    }

    drawCursor(ctx, game) {
      const t = PD.cursorTarget(game);
      if (!t) return;
      const { c, r, ok } = t;
      const x = OX + c * CELL;
      const y = OY + r * CELL;
      const col = ok ? (t.empty ? C.cursor : C.cursorReplace) : C.cursorBad;
      if (t.column) {
        // bonus round: light up the whole column the piece will drop into
        ctx.save();
        ctx.fillStyle = ok ? C.cursor : C.cursorBad;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x + 2, OY + 2, CELL - 4, BOARD_H - 4);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + CELL / 2 - 9, OY + 6);
        ctx.lineTo(x + CELL / 2 + 9, OY + 6);
        ctx.lineTo(x + CELL / 2, OY + 18);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (ok && t.empty) {
        // ghost of the next piece, only where nothing is in the way
        ctx.save();
        ctx.globalAlpha = 0.35;
        const [cx, cy] = this.center(c, r);
        this.drawCell(ctx, { type: 'pipe', kind: game.queue[0], fill: null }, cx, cy, CELL);
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      PD.roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 6);
      ctx.stroke();
      ctx.restore();
    }

    /* ---------- cells ---------- */

    drawCell(ctx, cell, cx, cy, s) {
      switch (cell.type) {
        case 'wall':
          return this.drawWall(ctx, cx, cy, s);
        case 'start':
          return this.drawStart(ctx, cell, cx, cy, s);
        case 'end':
          return this.drawEnd(ctx, cell, cx, cy, s);
        case 'pipe':
          return this.drawPipe(ctx, cell, cx, cy, s);
        default:
          return undefined;
      }
    }

    drawWall(ctx, cx, cy, s) {
      const x = cx - s / 2 + 3;
      const y = cy - s / 2 + 3;
      const w = s - 6;
      ctx.fillStyle = C.wallDark;
      ctx.fillRect(x, y, w, w);
      ctx.fillStyle = C.wall;
      ctx.fillRect(x + 2, y + 2, w - 4, w - 4);
      // brick joints
      ctx.strokeStyle = C.wallDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        ctx.moveTo(x, y + (w / 4) * i);
        ctx.lineTo(x + w, y + (w / 4) * i);
      }
      for (let i = 0; i < 4; i++) {
        const off = i % 2 ? w / 2 : w / 4;
        ctx.moveTo(x + off, y + (w / 4) * i);
        ctx.lineTo(x + off, y + (w / 4) * (i + 1));
        if (i % 2 === 0) {
          ctx.moveTo(x + (w * 3) / 4, y + (w / 4) * i);
          ctx.lineTo(x + (w * 3) / 4, y + (w / 4) * (i + 1));
        }
      }
      ctx.stroke();
      // bevel
      ctx.strokeStyle = C.wallLight;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 1, y + w - 1);
      ctx.lineTo(x + 1, y + 1);
      ctx.lineTo(x + w - 1, y + 1);
      ctx.stroke();
    }

    // Body of a straight or bent tube through the given sides. Bent pieces are
    // two shaded arms with a matching disc at the bend, so the highlight runs
    // along each arm the way it does on straights.
    drawSegments(ctx, cx, cy, s, sides) {
      const pipeW = s * 0.375;
      const outW = s * 0.47;
      const bent = sides.length === 2 && sides[0] !== PD.OPP[sides[1]];
      const paths = bent || sides.length === 1 ? sides.map((d) => [[cx, cy], edge(cx, cy, d, s)]) : [[edge(cx, cy, sides[0], s), edge(cx, cy, sides[1], s)]];
      for (const p of paths) PD.strokePath(ctx, p, outW, C.pipeDark);
      if (bent) {
        ctx.beginPath();
        ctx.arc(cx, cy, outW / 2, 0, Math.PI * 2);
        ctx.fillStyle = C.pipeDark;
        ctx.fill();
      }
      for (const p of paths) PD.strokeTube(ctx, p, pipeW, C.pipeLight, C.pipe, C.pipeShadow);
      if (bent) {
        const g = ctx.createLinearGradient(cx - pipeW / 2, cy - pipeW / 2, cx + pipeW / 2, cy + pipeW / 2);
        g.addColorStop(0, C.pipe);
        g.addColorStop(0.25, C.pipeLight);
        g.addColorStop(0.55, C.pipe);
        g.addColorStop(1, C.pipeShadow);
        ctx.beginPath();
        ctx.arc(cx, cy, pipeW / 2, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
      for (const d of sides) this.drawFlange(ctx, cx, cy, d, s);
    }

    drawFlange(ctx, cx, cy, side, s) {
      const [ex, ey] = edge(cx, cy, side, s);
      const v = PD.SIDE_VEC[side];
      const t = s * 0.09;
      const w = s * 0.47;
      const bx = ex - v[0] * t;
      const by = ey - v[1] * t;
      ctx.fillStyle = C.pipeDark;
      ctx.beginPath();
      if (v[0] !== 0) ctx.rect(Math.min(bx, ex), ey - w / 2, t, w);
      else ctx.rect(ex - w / 2, Math.min(by, ey), w, t);
      ctx.fill();
      ctx.fillStyle = C.pipeShadow;
      ctx.beginPath();
      if (v[0] !== 0) ctx.rect(Math.min(bx, ex) + 2, ey - w / 2 + 2, t - 4, w - 4);
      else ctx.rect(ex - w / 2 + 2, Math.min(by, ey) + 2, w - 4, t - 4);
      ctx.fill();
    }

    drawFloozPath(ctx, pts, progress, s) {
      const fw = s * 0.2;
      const part = PD.partialPolyline(pts, progress);
      if (part.length < 2) return;
      PD.strokeTube(ctx, part, fw, C.floozLight, C.flooz, C.floozDark, 'butt');
      const head = part[part.length - 1];
      if (progress < 1) {
        ctx.fillStyle = C.floozLight;
        ctx.beginPath();
        ctx.arc(head[0], head[1], fw * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawFlooz(ctx, cell, cx, cy, s, chan) {
      const route = PD.floozRoute(cell, chan);
      if (!route) return;
      const pts = [];
      if (route.from) pts.push(edge(cx, cy, route.from, s));
      pts.push([cx, cy]);
      if (route.to) pts.push(edge(cx, cy, route.to, s));
      this.drawFloozPath(ctx, pts, route.progress, s);
    }

    drawReservoir(ctx, cell, cx, cy, s) {
      const sides = PD.PIECES[cell.kind];
      this.drawSegments(ctx, cx, cy, s, sides);
      const R = s * 0.3;
      // tank
      ctx.beginPath();
      ctx.arc(cx, cy, R + 3, 0, Math.PI * 2);
      ctx.fillStyle = C.pipeDark;
      ctx.fill();
      const g = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, C.pipeLight);
      g.addColorStop(0.55, C.pipe);
      g.addColorStop(1, C.pipeShadow);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      // window in the tank showing the flooz level
      const route = PD.floozRoute(cell, null);
      if (route) {
        const p = route.progress;
        const inP = Math.min(1, p / 0.3);
        this.drawFloozPath(ctx, [edge(cx, cy, route.from, s), [cx, cy]], inP, s);
        if (p > 0.3) {
          const k = Math.min(1, (p - 0.3) / 0.4);
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = C.flooz;
          ctx.fillRect(cx - R, cy + R - k * 2 * R, 2 * R, k * 2 * R);
          ctx.fillStyle = C.floozLight;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(cx - R, cy + R - k * 2 * R, 2 * R, 3);
          ctx.restore();
        }
        if (p > 0.7) this.drawFloozPath(ctx, [[cx, cy], edge(cx, cy, route.to, s)], (p - 0.7) / 0.3, s);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawOneWayArrows(ctx, cell, cx, cy, s) {
      const v = PD.SIDE_VEC[cell.oneway];
      ctx.fillStyle = C.arrow;
      for (const k of [-1, 0.2]) {
        const px = cx + v[0] * s * 0.14 * k * 1.6;
        const py = cy + v[1] * s * 0.14 * k * 1.6;
        const a = s * 0.11;
        ctx.beginPath();
        ctx.moveTo(px + v[0] * a, py + v[1] * a);
        ctx.lineTo(px - v[1] * a * 0.9, py + v[0] * a * 0.9);
        ctx.lineTo(px + v[1] * a * 0.9, py - v[0] * a * 0.9);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawPipe(ctx, cell, cx, cy, s) {
      if (cell.reservoir) return this.drawReservoir(ctx, cell, cx, cy, s);
      if (cell.kind === 'X') {
        this.drawSegments(ctx, cx, cy, s, ['W', 'E']);
        this.drawFlooz(ctx, cell, cx, cy, s, 'H');
        this.drawSegments(ctx, cx, cy, s, ['N', 'S']);
        this.drawFlooz(ctx, cell, cx, cy, s, 'V');
        return;
      }
      const sides = PD.PIECES[cell.kind];
      this.drawSegments(ctx, cx, cy, s, sides);
      this.drawFlooz(ctx, cell, cx, cy, s, null);
      if (cell.oneway) this.drawOneWayArrows(ctx, cell, cx, cy, s);
    }

    drawBox(ctx, cx, cy, s, light, mid, dark) {
      const b = s * 0.66;
      const g = ctx.createLinearGradient(cx - b / 2, cy - b / 2, cx + b / 2, cy + b / 2);
      g.addColorStop(0, light);
      g.addColorStop(0.5, mid);
      g.addColorStop(1, dark);
      PD.roundRect(ctx, cx - b / 2 - 2, cy - b / 2 - 2, b + 4, b + 4, 8);
      ctx.fillStyle = C.pipeDark;
      ctx.fill();
      PD.roundRect(ctx, cx - b / 2, cy - b / 2, b, b, 7);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    drawStart(ctx, cell, cx, cy, s) {
      this.drawSegments(ctx, cx, cy, s, [cell.dir]);
      this.drawFlooz(ctx, cell, cx, cy, s, null);
      this.drawBox(ctx, cx, cy, s, C.startLight, C.start, C.startDark);
      // arrow
      const v = PD.SIDE_VEC[cell.dir];
      const a = s * 0.17;
      ctx.fillStyle = '#fff7e6';
      ctx.beginPath();
      ctx.moveTo(cx + v[0] * a, cy + v[1] * a);
      ctx.lineTo(cx - v[0] * a * 0.4 - v[1] * a, cy - v[1] * a * 0.4 + v[0] * a);
      ctx.lineTo(cx - v[0] * a * 0.4 + v[1] * a, cy - v[1] * a * 0.4 - v[0] * a);
      ctx.closePath();
      ctx.fill();
    }

    drawEnd(ctx, cell, cx, cy, s) {
      this.drawSegments(ctx, cx, cy, s, [cell.dir]);
      this.drawFlooz(ctx, cell, cx, cy, s, null);
      this.drawBox(ctx, cx, cy, s, C.endLight, C.end, C.endDark);
      const done = cell.fill && cell.fill.done;
      ctx.strokeStyle = done ? C.floozLight : '#e6fbff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = done ? C.flooz : '#e6fbff';
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---------- dispenser icon ---------- */

    drawPieceIcon(ctx, kind, cx, cy, s) {
      ctx.fillStyle = C.tile;
      PD.roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 6);
      ctx.fill();
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      this.drawPipe(ctx, { type: 'pipe', kind, fill: null }, cx, cy, s);
    }
  }

  PD.FlatRenderer = FlatRenderer;
})();
