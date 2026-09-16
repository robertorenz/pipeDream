/* Pipe Dream — 2.5D renderer
 *
 * Top-down view with the camera tilted slightly forward: the grid stays square
 * and readable, but everything has height. Walls and boxes show their front
 * faces, pipes are shaded cylinders with visible end caps and drop shadows.
 *
 * World space: x, y in pixels (cells are CW x CW), z = height in pixels.
 * Projection: sx = x, sy = y * KY - z * KZ.
 */
(function () {
  'use strict';

  const PD = window.PD;
  const C = PD.COLORS;
  const { COLS, ROWS } = PD;
  const W = PD.CANVAS_W;
  const H = PD.CANVAS_H;

  const CW = 68; // cell size (world px)
  const KY = 0.82; // depth foreshortening from the camera tilt
  const KZ = 0.56; // how much of an object's height is visible
  const CH = CW * KY; // on-screen cell height
  const OX = Math.round((W - COLS * CW) / 2);
  const OY = 36;
  const WALL_H = 30;
  const BOX_H = 24;
  const SLAB_H = 18;
  const R = 12; // tube radius (world px)
  const TUBE_W = R * 2;
  const FLOOZ_W = R * 1.1;

  class DepthRenderer {
    constructor(canvas) {
      this.name = 'depth';
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      canvas.width = W;
      canvas.height = H;
      this.ox = OX;
      this.oy = OY;
    }

    proj(x, y, z) {
      return [this.ox + x, this.oy + y * KY - (z || 0) * KZ];
    }

    hitTest(px, py) {
      const c = Math.floor((px - this.ox) / CW);
      const r = Math.floor((py - this.oy) / CH);
      return c >= 0 && r >= 0 && c < COLS && r < ROWS ? { c, r } : null;
    }

    centerW(c, r) {
      return [(c + 0.5) * CW, (r + 0.5) * CW];
    }
    edgeW(c, r, side) {
      const v = PD.SIDE_VEC[side];
      const [cx, cy] = this.centerW(c, r);
      return [cx + (v[0] * CW) / 2, cy + (v[1] * CW) / 2];
    }
    centerPt(c, r) {
      const [x, y] = this.centerW(c, r);
      return this.proj(x, y, R);
    }
    edgePt(c, r, side) {
      const [x, y] = this.edgeW(c, r, side);
      return this.proj(x, y, R);
    }

    /* ---------- frame ---------- */

    draw(game) {
      const ctx = this.ctx;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      this.drawSlab(ctx);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) this.drawFloor(ctx, c, r);

      const cur = PD.cursorTarget(game);
      if (cur) this.drawCursorTile(ctx, cur);

      ctx.save();
      ctx.beginPath();
      ctx.rect(this.ox - 8, this.oy - 8, COLS * CW + 16, ROWS * CH + 16 + SLAB_H);
      ctx.clip();
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const dy = PD.landingOffset(game, c, r, CH);
          if (dy) ctx.translate(0, dy);
          const [px, py] = this.centerPt(c, r);
          PD.drawAnimated(ctx, game.board[r][c], px, py, (cl) => this.drawCell(ctx, cl, c, r));
          if (dy) ctx.translate(0, -dy);
          if (cur && cur.ok && c === cur.c && r === cur.r && PD.ghostVisible(game, cur)) {
            ctx.save();
            ctx.globalAlpha = PD.ghostAlpha(cur);
            ctx.filter = PD.GHOST_FILTER;
            this.drawCell(ctx, { type: 'pipe', kind: game.queue[0], fill: null }, c, r);
            ctx.restore();
          }
        }
      ctx.restore();

      if (game.spill) {
        const [sx, sy] = this.edgePt(game.spill.c, game.spill.r, game.spill.dir);
        const v = PD.SIDE_VEC[game.spill.dir];
        PD.drawSpill(ctx, sx, sy, [v[0], v[1] * KY], game.spill.t);
      }
      for (const fx of game.effects) {
        const [x, y] = this.centerW(fx.c, fx.r);
        const [sx, sy] = this.proj(x, y, fx.kind === 'pop' ? 40 : R);
        PD.drawEffect(ctx, fx, sx, sy, 1);
      }
    }

    drawSlab(ctx) {
      const x0 = this.ox;
      const x1 = this.ox + COLS * CW;
      const y1 = this.oy + ROWS * CH;
      // front face of the board
      const g = ctx.createLinearGradient(0, y1, 0, y1 + SLAB_H);
      g.addColorStop(0, '#121c3a');
      g.addColorStop(1, '#080d1c');
      ctx.fillStyle = g;
      ctx.fillRect(x0 - 8, y1, x1 - x0 + 16, SLAB_H);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x0 - 8, y1 + SLAB_H, x1 - x0 + 16, 4);
      // frame around the playing surface
      PD.roundRect(ctx, x0 - 8, this.oy - 8, x1 - x0 + 16, ROWS * CH + 16, 10);
      ctx.fillStyle = '#101a34';
      ctx.fill();
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawFloor(ctx, c, r) {
      const x = this.ox + c * CW;
      const y = this.oy + r * CH;
      ctx.fillStyle = (c + r) % 2 ? C.tileAlt : C.tile;
      ctx.fillRect(x, y, CW, CH);
      ctx.strokeStyle = C.tileBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CW - 1, CH - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x + 1, y + 1, CW - 2, 2);
    }

    drawCursorTile(ctx, t) {
      const { c, r, ok } = t;
      const x = this.ox + c * CW;
      const y = this.oy + r * CH;
      const col = ok ? (t.empty ? C.cursor : C.cursorReplace) : C.cursorBad;
      ctx.save();
      if (t.column) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x + 2, this.oy + 2, CW - 4, ROWS * CH - 4);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + CW / 2 - 9, this.oy + 5);
        ctx.lineTo(x + CW / 2 + 9, this.oy + 5);
        ctx.lineTo(x + CW / 2, this.oy + 16);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x + 2, y + 2, CW - 4, CH - 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      PD.roundRect(ctx, x + 3, y + 3, CW - 6, CH - 6, 6);
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

    // A box standing on the floor: top face plus the visible front face.
    drawBlock(ctx, c, r, inset, h, top, front) {
      const x0 = this.ox + (c + inset) * CW;
      const x1 = this.ox + (c + 1 - inset) * CW;
      const yb0 = this.oy + (r + inset) * CH;
      const yb1 = this.oy + (r + 1 - inset) * CH;
      const dz = h * KZ;
      // shadow on the floor
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x0 + 4, yb0 + 4, x1 - x0, yb1 - yb0 + 2);
      // front face
      ctx.fillStyle = front;
      ctx.fillRect(x0, yb1 - dz, x1 - x0, dz);
      // top face
      ctx.fillStyle = top;
      ctx.fillRect(x0, yb0 - dz, x1 - x0, yb1 - yb0);
      // edges
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, yb1 - dz);
      ctx.lineTo(x0 + 1, yb0 - dz + 1);
      ctx.lineTo(x1 - 1, yb0 - dz + 1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.moveTo(x0, yb1 - dz + 0.5);
      ctx.lineTo(x1, yb1 - dz + 0.5);
      ctx.stroke();
      return { x0, x1, ty0: yb0 - dz, ty1: yb1 - dz, fy1: yb1 };
    }

    drawWall(ctx, c, r) {
      const f = this.drawBlock(ctx, c, r, 0.05, WALL_H, C.wall, '#0b2848');
      const w = f.x1 - f.x0;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // brick courses on the top face
      const th = f.ty1 - f.ty0;
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(f.x0, f.ty0 + (th / 3) * i);
        ctx.lineTo(f.x1, f.ty0 + (th / 3) * i);
      }
      for (let i = 0; i < 3; i++) {
        const off = i % 2 ? w / 2 : w / 4;
        ctx.moveTo(f.x0 + off, f.ty0 + (th / 3) * i);
        ctx.lineTo(f.x0 + off, f.ty0 + (th / 3) * (i + 1));
        if (i % 2 === 0) {
          ctx.moveTo(f.x0 + (w * 3) / 4, f.ty0 + (th / 3) * i);
          ctx.lineTo(f.x0 + (w * 3) / 4, f.ty0 + (th / 3) * (i + 1));
        }
      }
      // and on the front face
      const fh = f.fy1 - f.ty1;
      ctx.moveTo(f.x0, f.ty1 + fh / 2);
      ctx.lineTo(f.x1, f.ty1 + fh / 2);
      ctx.moveTo(f.x0 + w / 2, f.ty1);
      ctx.lineTo(f.x0 + w / 2, f.ty1 + fh / 2);
      ctx.moveTo(f.x0 + w / 4, f.ty1 + fh / 2);
      ctx.lineTo(f.x0 + w / 4, f.fy1);
      ctx.moveTo(f.x0 + (w * 3) / 4, f.ty1 + fh / 2);
      ctx.lineTo(f.x0 + (w * 3) / 4, f.fy1);
      ctx.stroke();
    }

    /* ---------- tubes ---------- */

    drawTube(ctx, pts) {
      const shadow = pts.map((p) => [p[0] + 3, p[1] + 7]);
      PD.strokePath(ctx, shadow, TUBE_W + 2, 'rgba(0,0,0,0.35)');
      PD.strokePath(ctx, pts, TUBE_W + 4, C.pipeDark);
      PD.strokeTube(ctx, pts, TUBE_W, C.pipeLight, C.pipe, C.pipeShadow);
    }

    // Sphere at a bend or a tank.
    drawSphere(ctx, sx, sy, radius) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(sx + 3, sy + 8, radius, radius * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = C.pipeDark;
      ctx.fill();
      const g = ctx.createRadialGradient(sx - radius * 0.35, sy - radius * 0.4, radius * 0.1, sx, sy, radius);
      g.addColorStop(0, C.pipeLight);
      g.addColorStop(0.55, C.pipe);
      g.addColorStop(1, C.pipeShadow);
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // End cap / coupling ring: the cylinder's cross-section seen from the camera.
    drawCap(ctx, c, r, side) {
      const [px, py] = this.edgePt(c, r, side);
      const vertical = side === 'N' || side === 'S';
      const rx = vertical ? R * 1.12 : 3.5;
      const ry = vertical ? R * 1.12 * KZ + 1 : R * 1.12;
      ctx.beginPath();
      ctx.ellipse(px, py, rx + 2, ry + 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = C.pipeDark;
      ctx.fill();
      const g = ctx.createLinearGradient(px - rx, py - ry, px + rx, py + ry);
      g.addColorStop(0, C.pipeLight);
      g.addColorStop(0.5, C.pipe);
      g.addColorStop(1, C.pipeShadow);
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
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
        this.drawTube(ctx, [this.edgePt(c, r, 'W'), this.edgePt(c, r, 'E')]);
        this.drawFlooz(ctx, cell, c, r, 'H');
        this.drawTube(ctx, [this.edgePt(c, r, 'N'), this.edgePt(c, r, 'S')]);
        this.drawFlooz(ctx, cell, c, r, 'V');
        for (const d of ['N', 'W', 'E', 'S']) this.drawCap(ctx, c, r, d);
        return;
      }
      const sides = PD.PIECES[cell.kind];
      const bent = sides[0] !== PD.OPP[sides[1]];
      if (bent) {
        for (const d of sides) this.drawTube(ctx, [this.centerPt(c, r), this.edgePt(c, r, d)]);
        const [sx, sy] = this.centerPt(c, r);
        this.drawSphere(ctx, sx, sy, R * 1.12);
      } else {
        this.drawTube(ctx, [this.edgePt(c, r, sides[0]), this.edgePt(c, r, sides[1])]);
      }
      this.drawFlooz(ctx, cell, c, r, null);
      for (const d of sides) this.drawCap(ctx, c, r, d);
      if (cell.oneway) this.drawOneWayArrows(ctx, cell, c, r);
    }

    drawReservoir(ctx, cell, c, r) {
      const sides = PD.PIECES[cell.kind];
      this.drawTube(ctx, [this.edgePt(c, r, sides[0]), this.edgePt(c, r, sides[1])]);
      const route = PD.floozRoute(cell, null);
      const tankR = R * 1.9;
      const [x, y] = this.centerW(c, r);
      const [px, py] = this.proj(x, y, tankR);
      if (route) this.drawFloozPath(ctx, [this.edgePt(c, r, route.from), this.centerPt(c, r)], Math.min(1, route.progress / 0.3));
      this.drawSphere(ctx, px, py, tankR);
      if (route && route.progress > 0.3) {
        const k = Math.min(1, (route.progress - 0.3) / 0.4);
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, tankR - 5, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = C.flooz;
        ctx.fillRect(px - tankR, py + tankR - k * 2 * tankR, 2 * tankR, k * 2 * tankR);
        ctx.fillStyle = C.floozLight;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px - tankR, py + tankR - k * 2 * tankR, 2 * tankR, 3);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(px, py, tankR - 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (route && route.progress > 0.7) this.drawFloozPath(ctx, [this.centerPt(c, r), this.edgePt(c, r, route.to)], (route.progress - 0.7) / 0.3);
      for (const d of sides) this.drawCap(ctx, c, r, d);
    }

    drawOneWayArrows(ctx, cell, c, r) {
      const v = PD.SIDE_VEC[cell.oneway];
      const p = [v[1], v[0]];
      const [cx, cy] = this.centerW(c, r);
      for (const k of [-0.22, 0.04]) {
        const bx = cx + v[0] * k * CW;
        const by = cy + v[1] * k * CW;
        const tip = this.proj(bx + v[0] * 0.18 * CW, by + v[1] * 0.18 * CW, 2 * R);
        const l = this.proj(bx - p[0] * 0.12 * CW, by - p[1] * 0.12 * CW, 2 * R);
        const rr = this.proj(bx + p[0] * 0.12 * CW, by + p[1] * 0.12 * CW, 2 * R);
        PD.polygon(ctx, [tip, l, rr]);
        ctx.fillStyle = C.arrow;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    drawStart(ctx, cell, c, r) {
      this.drawTube(ctx, [this.centerPt(c, r), this.edgePt(c, r, cell.dir)]);
      this.drawFlooz(ctx, cell, c, r, null);
      this.drawCap(ctx, c, r, cell.dir);
      const f = this.drawBlock(ctx, c, r, 0.17, BOX_H, C.start, C.startDark);
      // arrow on the top face
      const v = PD.SIDE_VEC[cell.dir];
      const mx = (f.x0 + f.x1) / 2;
      const my = (f.ty0 + f.ty1) / 2;
      const a = 12;
      ctx.fillStyle = '#fff7e6';
      ctx.beginPath();
      ctx.moveTo(mx + v[0] * a, my + v[1] * a * KY);
      ctx.lineTo(mx - v[0] * a * 0.5 - v[1] * a, my - v[1] * a * 0.5 * KY + v[0] * a * KY);
      ctx.lineTo(mx - v[0] * a * 0.5 + v[1] * a, my - v[1] * a * 0.5 * KY - v[0] * a * KY);
      ctx.closePath();
      ctx.fill();
    }

    drawEnd(ctx, cell, c, r) {
      this.drawTube(ctx, [this.centerPt(c, r), this.edgePt(c, r, cell.dir)]);
      this.drawFlooz(ctx, cell, c, r, null);
      this.drawCap(ctx, c, r, cell.dir);
      const f = this.drawBlock(ctx, c, r, 0.17, BOX_H, C.end, C.endDark);
      const done = cell.fill && cell.fill.done;
      const mx = (f.x0 + f.x1) / 2;
      const my = (f.ty0 + f.ty1) / 2;
      ctx.strokeStyle = done ? C.floozLight : '#e6fbff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(mx, my, 11, 11 * KY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = done ? C.flooz : '#e6fbff';
      ctx.beginPath();
      ctx.ellipse(mx, my, 4.5, 4.5 * KY, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---------- dispenser icon ---------- */

    drawPieceIcon(ctx, kind, cx, cy, s) {
      const k = s / CW;
      const ox = this.ox;
      const oy = this.oy;
      ctx.save();
      ctx.translate(cx - (k * CW) / 2, cy - (k * CH) / 2);
      ctx.scale(k, k);
      this.ox = 0;
      this.oy = 0;
      ctx.fillStyle = C.tile;
      PD.roundRect(ctx, 0, 0, CW, CH, 8);
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

  PD.DepthRenderer = DepthRenderer;
})();
