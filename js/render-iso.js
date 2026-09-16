/* Pipe Dream — 2.5D (isometric) renderer
 *
 * World space: x = column, y = row, z = height in pixels.
 * A 2:1 dimetric projection: tiles are 80x40 diamonds, pipes are shaded
 * cylinders lying on the floor, walls are extruded blocks.
 */
(function () {
  'use strict';

  const PD = window.PD;
  const C = PD.COLORS;
  const { COLS, ROWS } = PD;
  const W = PD.CANVAS_W;
  const H = PD.CANVAS_H;

  const TW = 80;
  const TH = 40;
  const HX = TW / 2;
  const HY = TH / 2;
  const ZS = 40; // px per world unit of height, used to size tube cross-sections
  const WALL_H = 26;
  const SLAB_H = 14;
  const R = 8; // tube radius (px)
  const TUBE_W = R * 2.5; // projected silhouette width of the tube
  const FLOOZ_W = TUBE_W * 0.5;

  // Screen-space direction of one world unit along each side.
  const DIR_SCR = { E: [HX, HY], S: [-HX, HY], N: [HX, -HY], W: [-HX, -HY] };
  const PERP_OF = { E: 'S', W: 'S', N: 'E', S: 'E' }; // horizontal direction perpendicular to the axis

  class IsoRenderer {
    constructor(canvas) {
      this.name = 'iso';
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      canvas.width = W;
      canvas.height = H;
      this.ox = Math.round((W - (COLS + ROWS) * HX) / 2 + ROWS * HX);
      this.oy = 66;
    }

    iso(x, y, z) {
      return [this.ox + (x - y) * HX, this.oy + (x + y) * HY - (z || 0)];
    }

    hitTest(px, py) {
      const u = (px - this.ox) / HX;
      const v = (py - this.oy) / HY;
      const x = (u + v) / 2;
      const y = (v - u) / 2;
      const c = Math.floor(x);
      const r = Math.floor(y);
      return c >= 0 && r >= 0 && c < COLS && r < ROWS ? { c, r } : null;
    }

    /* ---------- frame ---------- */

    draw(game) {
      const ctx = this.ctx;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      this.drawSlab(ctx);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) this.drawFloor(ctx, c, r);

      const active = game.phase === 'countdown' || game.phase === 'flowing';
      const cur = game.cursor;
      const ok = active && game.canPlaceAt(cur.c, cur.r);
      if (active) this.drawCursorTile(ctx, cur.c, cur.r, ok);

      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const cell = game.board[r][c];
          this.drawCell(ctx, cell, c, r);
          if (ok && c === cur.c && r === cur.r) {
            ctx.save();
            ctx.globalAlpha = 0.4;
            this.drawCell(ctx, { type: 'pipe', kind: game.queue[0], fill: null }, c, r);
            ctx.restore();
          }
        }

      if (game.spill) {
        const v = PD.SIDE_VEC[game.spill.dir];
        const [sx, sy] = this.iso(game.spill.c + 0.5 + v[0] * 0.5, game.spill.r + 0.5 + v[1] * 0.5, R);
        const d = DIR_SCR[game.spill.dir];
        const n = Math.hypot(d[0], d[1]);
        PD.drawSpill(ctx, sx, sy, [d[0] / n, d[1] / n], game.spill.t);
      }
      for (const fx of game.effects) {
        const [sx, sy] = this.iso(fx.c + 0.5, fx.r + 0.5, fx.kind === 'pop' ? 34 : R);
        PD.drawEffect(ctx, fx, sx, sy, 0.8);
      }
    }

    drawSlab(ctx) {
      const a = this.iso(0, ROWS);
      const b = this.iso(COLS, ROWS);
      const c = this.iso(COLS, 0);
      ctx.fillStyle = C.tileSide;
      PD.polygon(ctx, [a, b, [b[0], b[1] + SLAB_H], [a[0], a[1] + SLAB_H]]);
      ctx.fill();
      ctx.fillStyle = '#0b1226';
      PD.polygon(ctx, [b, c, [c[0], c[1] + SLAB_H], [b[0], b[1] + SLAB_H]]);
      ctx.fill();
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1] + SLAB_H);
      ctx.lineTo(b[0], b[1] + SLAB_H);
      ctx.lineTo(c[0], c[1] + SLAB_H);
      ctx.stroke();
    }

    tilePoly(c, r, z) {
      return [this.iso(c, r, z), this.iso(c + 1, r, z), this.iso(c + 1, r + 1, z), this.iso(c, r + 1, z)];
    }

    drawFloor(ctx, c, r) {
      PD.polygon(ctx, this.tilePoly(c, r, 0));
      ctx.fillStyle = (c + r) % 2 ? C.tileAlt : C.tile;
      ctx.fill();
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    drawCursorTile(ctx, c, r, ok) {
      ctx.save();
      const col = ok ? C.cursor : C.cursorBad;
      PD.polygon(ctx, this.tilePoly(c, r, 0));
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    }

    /* ---------- cells ---------- */

    drawCell(ctx, cell, c, r) {
      switch (cell.type) {
        case 'wall':
          return this.drawWall(ctx, c, r);
        case 'start':
          return this.drawStart(ctx, cell, c, r);
        case 'end':
          return this.drawEnd(ctx, cell, c, r);
        case 'pipe':
          return this.drawPipe(ctx, cell, c, r);
        default:
          return undefined;
      }
    }

    drawBlock(ctx, c, r, inset, h, top, side1, side2) {
      const x0 = c + inset;
      const y0 = r + inset;
      const x1 = c + 1 - inset;
      const y1 = r + 1 - inset;
      const B = this.iso(x1, y0, 0);
      const Cc = this.iso(x1, y1, 0);
      const D = this.iso(x0, y1, 0);
      const Bz = this.iso(x1, y0, h);
      const Cz = this.iso(x1, y1, h);
      const Dz = this.iso(x0, y1, h);
      const Az = this.iso(x0, y0, h);
      ctx.fillStyle = side1;
      PD.polygon(ctx, [D, Cc, Cz, Dz]);
      ctx.fill();
      ctx.fillStyle = side2;
      PD.polygon(ctx, [Cc, B, Bz, Cz]);
      ctx.fill();
      ctx.fillStyle = top;
      PD.polygon(ctx, [Az, Bz, Cz, Dz]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(Dz[0], Dz[1]);
      ctx.lineTo(Cz[0], Cz[1]);
      ctx.lineTo(Bz[0], Bz[1]);
      ctx.moveTo(Cz[0], Cz[1]);
      ctx.lineTo(Cc[0], Cc[1]);
      ctx.stroke();
      return { Az, Bz, Cz, Dz };
    }

    drawWall(ctx, c, r) {
      const f = this.drawBlock(ctx, c, r, 0.06, WALL_H, C.wall, '#0c2a50', C.wallDark);
      // brick courses on the two visible faces
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        const z = (WALL_H / 3) * i;
        const d = this.iso(c + 0.06, r + 0.94, z);
        const cc = this.iso(c + 0.94, r + 0.94, z);
        const b = this.iso(c + 0.94, r + 0.06, z);
        ctx.moveTo(d[0], d[1]);
        ctx.lineTo(cc[0], cc[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(f.Az[0], f.Az[1]);
      ctx.lineTo(f.Bz[0], f.Bz[1]);
      ctx.moveTo(f.Az[0], f.Az[1]);
      ctx.lineTo(f.Dz[0], f.Dz[1]);
      ctx.stroke();
    }

    edgePt(c, r, side) {
      const v = PD.SIDE_VEC[side];
      return this.iso(c + 0.5 + v[0] * 0.5, r + 0.5 + v[1] * 0.5, R);
    }
    centerPt(c, r) {
      return this.iso(c + 0.5, r + 0.5, R);
    }

    // Screen polyline for a tube through the given sides (one side = a stub from the centre).
    tubePts(c, r, sides) {
      if (sides.length === 1) return [this.centerPt(c, r), this.edgePt(c, r, sides[0])];
      return [this.edgePt(c, r, sides[0]), this.centerPt(c, r), this.edgePt(c, r, sides[1])];
    }

    drawTube(ctx, pts) {
      const shadow = pts.map((p) => [p[0] + 2, p[1] + 5]);
      PD.strokePath(ctx, shadow, TUBE_W + 2, 'rgba(0,0,0,0.35)');
      PD.strokePath(ctx, pts, TUBE_W + 4, C.pipeDark);
      PD.strokeTube(ctx, pts, TUBE_W, C.pipeLight, C.pipe, C.pipeShadow);
    }

    // Thin coupling ring at an open end, drawn as the projected mouth ellipse.
    drawCollar(ctx, c, r, side) {
      const [px, py] = this.edgePt(c, r, side);
      const perp = DIR_SCR[PERP_OF[side]];
      const k = (R * 1.15) / ZS;
      ctx.save();
      ctx.translate(px, py);
      ctx.transform(perp[0] * k, perp[1] * k, 0, -R * 1.15, 0, 0);
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.restore();
      ctx.strokeStyle = C.pipeDark;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = C.pipeLight;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    drawFloozPath(ctx, pts, progress) {
      const part = PD.partialPolyline(pts, progress);
      if (part.length < 2) return;
      PD.strokeTube(ctx, part, FLOOZ_W, C.floozLight, C.flooz, C.floozDark);
      if (progress < 1) {
        const head = part[part.length - 1];
        ctx.fillStyle = C.floozLight;
        ctx.beginPath();
        ctx.arc(head[0], head[1], FLOOZ_W * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    routePts(c, r, route) {
      const pts = [];
      if (route.from) pts.push(this.edgePt(c, r, route.from));
      pts.push(this.centerPt(c, r));
      if (route.to) pts.push(this.edgePt(c, r, route.to));
      return pts;
    }

    drawFlooz(ctx, cell, c, r, chan) {
      const route = PD.floozRoute(cell, chan);
      if (!route) return;
      this.drawFloozPath(ctx, this.routePts(c, r, route), route.progress);
    }

    drawPipe(ctx, cell, c, r) {
      if (cell.reservoir) return this.drawReservoir(ctx, cell, c, r);
      if (cell.kind === 'X') {
        this.drawTube(ctx, this.tubePts(c, r, ['W', 'E']));
        this.drawFlooz(ctx, cell, c, r, 'H');
        this.drawTube(ctx, this.tubePts(c, r, ['N', 'S']));
        this.drawFlooz(ctx, cell, c, r, 'V');
        for (const d of ['N', 'W', 'S', 'E']) this.drawCollar(ctx, c, r, d);
        return;
      }
      const sides = PD.PIECES[cell.kind];
      this.drawTube(ctx, this.tubePts(c, r, sides));
      this.drawFlooz(ctx, cell, c, r, null);
      for (const d of sides) this.drawCollar(ctx, c, r, d);
      if (cell.oneway) this.drawOneWayArrows(ctx, cell, c, r);
    }

    drawReservoir(ctx, cell, c, r) {
      const sides = PD.PIECES[cell.kind];
      this.drawTube(ctx, this.tubePts(c, r, sides));
      const route = PD.floozRoute(cell, null);
      const tankR = R * 2.2;
      const [px, py] = this.iso(c + 0.5, r + 0.5, R + 4);
      if (route) this.drawFloozPath(ctx, [this.edgePt(c, r, route.from), this.centerPt(c, r)], Math.min(1, route.progress / 0.3));
      // tank
      ctx.beginPath();
      ctx.arc(px, py, tankR + 2, 0, Math.PI * 2);
      ctx.fillStyle = C.pipeDark;
      ctx.fill();
      const g = ctx.createRadialGradient(px - tankR * 0.4, py - tankR * 0.45, tankR * 0.1, px, py, tankR);
      g.addColorStop(0, C.pipeLight);
      g.addColorStop(0.55, C.pipe);
      g.addColorStop(1, C.pipeShadow);
      ctx.beginPath();
      ctx.arc(px, py, tankR, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      if (route && route.progress > 0.3) {
        const k = Math.min(1, (route.progress - 0.3) / 0.4);
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, tankR - 4, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = C.flooz;
        ctx.fillRect(px - tankR, py + tankR - k * 2 * tankR, 2 * tankR, k * 2 * tankR);
        ctx.fillStyle = C.floozLight;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px - tankR, py + tankR - k * 2 * tankR, 2 * tankR, 3);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(px, py, tankR - 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (route && route.progress > 0.7) this.drawFloozPath(ctx, [this.centerPt(c, r), this.edgePt(c, r, route.to)], (route.progress - 0.7) / 0.3);
      for (const d of sides) this.drawCollar(ctx, c, r, d);
    }

    drawOneWayArrows(ctx, cell, c, r) {
      const v = PD.SIDE_VEC[cell.oneway];
      const p = PD.SIDE_VEC[PERP_OF[cell.oneway]];
      for (const k of [-0.24, 0.02]) {
        const bx = c + 0.5 + v[0] * k;
        const by = r + 0.5 + v[1] * k;
        const z = 2 * R + 1;
        const tip = this.iso(bx + v[0] * 0.2, by + v[1] * 0.2, z);
        const l = this.iso(bx - p[0] * 0.14, by - p[1] * 0.14, z);
        const rr = this.iso(bx + p[0] * 0.14, by + p[1] * 0.14, z);
        PD.polygon(ctx, [tip, l, rr]);
        ctx.fillStyle = C.arrow;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    drawStart(ctx, cell, c, r) {
      this.drawTube(ctx, this.tubePts(c, r, [cell.dir]));
      this.drawFlooz(ctx, cell, c, r, null);
      this.drawCollar(ctx, c, r, cell.dir);
      const f = this.drawBlock(ctx, c, r, 0.2, 20, C.start, C.startDark, '#7c3a0a');
      // arrow on the top face
      const v = PD.SIDE_VEC[cell.dir];
      const p = PD.SIDE_VEC[PERP_OF[cell.dir]];
      const cx = c + 0.5;
      const cy = r + 0.5;
      const tip = this.iso(cx + v[0] * 0.2, cy + v[1] * 0.2, 21);
      const l = this.iso(cx - v[0] * 0.1 - p[0] * 0.16, cy - v[1] * 0.1 - p[1] * 0.16, 21);
      const rr = this.iso(cx - v[0] * 0.1 + p[0] * 0.16, cy - v[1] * 0.1 + p[1] * 0.16, 21);
      ctx.fillStyle = '#fff7e6';
      PD.polygon(ctx, [tip, l, rr]);
      ctx.fill();
      ctx.strokeStyle = C.startLight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.Az[0], f.Az[1]);
      ctx.lineTo(f.Bz[0], f.Bz[1]);
      ctx.moveTo(f.Az[0], f.Az[1]);
      ctx.lineTo(f.Dz[0], f.Dz[1]);
      ctx.stroke();
    }

    drawEnd(ctx, cell, c, r) {
      this.drawTube(ctx, this.tubePts(c, r, [cell.dir]));
      this.drawFlooz(ctx, cell, c, r, null);
      this.drawCollar(ctx, c, r, cell.dir);
      this.drawBlock(ctx, c, r, 0.2, 20, C.end, C.endDark, '#0e3f4f');
      const done = cell.fill && cell.fill.done;
      const [px, py] = this.iso(c + 0.5, r + 0.5, 21);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 0.5);
      ctx.strokeStyle = done ? C.floozLight : '#e6fbff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = done ? C.flooz : '#e6fbff';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ---------- dispenser icon ---------- */

    drawPieceIcon(ctx, kind, cx, cy, s) {
      const k = s / TW;
      const ox = this.ox;
      const oy = this.oy;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      this.ox = 0;
      this.oy = -HY;
      PD.polygon(ctx, this.tilePoly(0, 0, 0));
      ctx.fillStyle = C.tile;
      ctx.fill();
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      this.drawPipe(ctx, { type: 'pipe', kind, fill: null }, 0, 0);
      this.ox = ox;
      this.oy = oy;
      ctx.restore();
    }
  }

  PD.IsoRenderer = IsoRenderer;
})();
