/* Original vector artwork, rendered locally. Static scenery is cached at device
 * resolution; only clouds, targets, effects, reticle, and the rifle redraw.
 * The visible target silhouette and engine collision use the same geometry.
 */
(function (root) {
  'use strict';
  const { birdShapes, SPECIES, clamp, CONFIG } = root.SkyshotEngine;
  function ellipse(c, x, y, rx, ry, color) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill(); }
  function polygon(c, points, color) { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = color; c.fill(); }
  function rect(c, x, y, w, h, r, color) { c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = color; c.fill(); }
  function curve(c, points, color) {
    c.beginPath(); c.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) points[i].length === 6 ? c.bezierCurveTo(...points[i]) : c.lineTo(...points[i]);
    c.closePath(); c.fillStyle = color; c.fill();
  }
  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas; this.context = canvas.getContext('2d', { alpha: false }); this.game = game;
      this.terrain = document.createElement('canvas'); this.sky = document.createElement('canvas');
      this.width = 0; this.height = 720; this.dpr = 1; this.time = 0;
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
    }
    resize() {
      const box = this.canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.width = box.width / box.height * 720; this.height = 720; this.dpr = dpr;
      this.canvas.width = Math.round(box.width * dpr); this.canvas.height = Math.round(box.height * dpr);
      this.scale = this.canvas.width / this.width;
      this.game.resize(this.width, this.height);
      for (const layer of [this.sky, this.terrain]) { layer.width = this.canvas.width; layer.height = this.canvas.height; }
      this.buildScenery();
    }
    buildScenery() {
      const w = this.width, h = this.height, sky = this.sky.getContext('2d'), c = this.terrain.getContext('2d');
      sky.setTransform(this.scale, 0, 0, this.scale, 0, 0); c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      const blue = sky.createLinearGradient(0, 0, 0, h * .85);
      blue.addColorStop(0, '#92d1e4'); blue.addColorStop(.55, '#c3e6e6'); blue.addColorStop(1, '#f1efc8');
      sky.fillStyle = blue; sky.fillRect(0, 0, w, h);
      const sunX = w * .79, sunY = 170;
      const glow = sky.createRadialGradient(sunX, sunY, 5, sunX, sunY, 150);
      glow.addColorStop(0, '#fff8ce80'); glow.addColorStop(1, '#fff8ce00');
      sky.fillStyle = glow; sky.fillRect(sunX - 150, sunY - 150, 300, 300);
      ellipse(sky, sunX, sunY, 35, 35, '#fff7cb'); ellipse(sky, sunX, sunY, 48, 48, '#fffbe822');
      // Broad, layered hills keep the target silhouettes readable.
      curve(c, [[0, h * .56], [w * .17, h * .39, w * .26, h * .56, w * .41, h * .52], [w * .61, h * .4, w * .76, h * .44, w, h * .56], [w, h], [0, h]], '#90bbb0');
      curve(c, [[0, h * .65], [w * .17, h * .5, w * .34, h * .5, w * .55, h * .64], [w * .7, h * .71, w * .78, h * .52, w, h * .56], [w, h], [0, h]], '#6f9f8c');
      curve(c, [[0, h * .66], [w * .24, h * .78, w * .34, h * .59, w * .6, h * .67], [w * .76, h * .71, w * .9, h * .68, w, h * .73], [w, h], [0, h]], '#91b37b');
      // A small farmhouse anchors the scene; it is scenery, never a target.
      const fx = w * .81, fy = h * .64;
      rect(c, fx - 19, fy - 19, 38, 26, 1, '#eee4bd');
      polygon(c, [[fx - 24, fy - 18], [fx, fy - 37], [fx + 24, fy - 18]], '#7c7760');
      rect(c, fx - 4, fy - 7, 8, 14, 1, '#748773'); rect(c, fx + 8, fy - 11, 6, 6, 1, '#a0b6a0');
      c.fillStyle = '#6a8871'; c.fillRect(fx + 13, fy - 32, 4, 12);
      // Distant poplars.
      for (let i = 0; i < 12; i++) {
        const x = w * .035 + i * w * .088, y = h * (.647 + Math.sin(i * 2.4) * .027);
        c.fillStyle = '#6e9073'; c.fillRect(x - 1, y - 12, 2, 24);
        ellipse(c, x, y - 15, 6 + i % 3, 16 + i % 4, i % 2 ? '#739580' : '#7a9c79');
      }
      curve(c, [[0, h * .8], [w * .28, h * .67, w * .49, h * .8, w * .67, h * .8], [w * .81, h * .85, w * .9, h * .8, w, h * .77], [w, h], [0, h]], '#abc077');
      curve(c, [[w * .56, h * .74], [w * .39, h * .8, w * .72, h * .82, w * .76, h], [w * .61, h], [w * .57, h * .85, w * .35, h * .81, w * .56, h * .74]], '#cfcb8b');
      // Contour strokes across the meadow.
      c.strokeStyle = '#6e9a6b44'; c.lineWidth = 1.4;
      for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(w * .04, h * .79 + i * 9); c.bezierCurveTo(w * .19, h * .73 + i * 10, w * .24, h * .79 + i * 8, w * .33, h * .81 + i * 5); c.stroke(); }
      curve(c, [[0, h * .9], [w * .26, h * .83, w * .43, h * .96, w * .65, h * .89], [w * .83, h * .86, w * .96, h * .89, w, h * .86], [w, h], [0, h]], '#789953');
      const ground = c.createLinearGradient(0, h * .88, 0, h); ground.addColorStop(0, '#47785100'); ground.addColorStop(1, '#224e3f');
      c.fillStyle = ground; c.fillRect(0, h * .86, w, h * .14);
      // Reproducible grasses and little cream/gold meadow flowers.
      for (let i = 0; i < 105; i++) {
        const x = ((i * 137.51) % 1000) / 1000 * w, y = h * (.866 + ((i * 47) % 100) / 100 * .12);
        const length = 7 + (i % 8) * 3;
        c.strokeStyle = i % 2 ? '#426b43' : '#63894b'; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 3, y - length * .7, x - 7, y - length); c.moveTo(x, y); c.quadraticCurveTo(x + 1, y - length, x + 5, y - length * 1.25); c.stroke();
        if (i % 9 === 0) ellipse(c, x + 5, y - length * 1.25, 2.6, 2.2, i % 3 ? '#f1d875' : '#fff2cc');
      }
      // Foreground edge plants frame rather than obscure the firing field.
      for (const side of [-1, 1]) {
        c.save(); c.translate(side === -1 ? 0 : w, h); c.scale(side === -1 ? 1 : -1, 1);
        for (let i = 0; i < 9; i++) {
          const x = i * 11 - 17, y = -45 - (i % 4) * 20;
          c.strokeStyle = '#285a43'; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 12, 0); c.quadraticCurveTo(x + 3, y * .6, x, y); c.stroke();
          ellipse(c, x, y, 4, 11, '#496a40');
          polygon(c, [[x + 8, y * .3], [x + 23, y * .67], [x + 13, y * .33]], '#285a43');
        }
        c.restore();
      }
    }
    drawCloud(x, y, size, opacity) {
      const c = this.context; c.save(); c.translate(x, y); c.scale(size, size); c.globalAlpha = opacity;
      ellipse(c, 0, 10, 69, 16, '#fffef0'); ellipse(c, -25, 0, 31, 23, '#fffef0'); ellipse(c, 12, -9, 36, 32, '#fffef0'); ellipse(c, 43, 3, 30, 22, '#fffef0');
      ellipse(c, 8, 20, 54, 4, '#eaf1de'); c.restore();
    }
    drawBird(b) {
      const c = this.context, s = birdShapes(b), colors = b.species;
      c.save(); c.translate(b.x, b.y);
      if (b.state === 'hit') { c.rotate(b.rotation); c.globalAlpha = clamp(1 - b.fallTime / .7, 0, 1); }
      c.scale(b.direction * b.size, b.size);
      polygon(c, s.tail, colors.wing);
      ellipse(c, 0, 0, 24, 13, colors.body); ellipse(c, 2, 5, 18, 7, colors.belly);
      ellipse(c, 17, -4, 10, 11, colors.body); ellipse(c, 21, -10, 10, 10, colors.head);
      polygon(c, s.beak, '#e8b550');
      c.save(); c.beginPath(); c.ellipse(21, -10, 10, 10, 0, 0, Math.PI * 2); c.clip(); c.fillStyle = '#f6e9be'; c.fillRect(11, -3, 19, 4); c.restore();
      polygon(c, s.wing, colors.wing);
      c.strokeStyle = colors.body; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-8, -4); c.lineTo(s.wing[1][0] + 9, s.wing[1][1] + 10); c.stroke();
      if (b.state === 'hit') {
        c.strokeStyle = '#fff4d0'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(23, -15); c.lineTo(27, -11); c.moveTo(23, -11); c.lineTo(27, -15); c.stroke();
      } else { ellipse(c, 25, -13, 2.4, 2.4, '#fff6da'); ellipse(c, 25.7, -13, 1.3, 1.6, '#182f30'); }
      c.restore();
    }
    drawGun() {
      const c = this.context, g = this.game, pose = g.gunPose();
      const reloadProgress = g.reloading ? 1 - g.reloadLeft / CONFIG.reloadTime : 0;
      const dip = Math.sin(reloadProgress * Math.PI);
      // Recoil slides straight back along the barrel instead of twisting the
      // rifle sideways; the new diagonal stance stays composed while firing.
      const kick = this.reducedMotion ? 0 : 14 * g.recoil;
      c.save(); c.translate(pose.x - Math.cos(pose.angle) * kick, pose.y - Math.sin(pose.angle) * kick + 94 * dip);
      c.rotate(pose.angle + Math.PI / 2 + .12 * dip); c.scale(pose.scale, pose.scale);
      // The full rifle, not a cursor substitute: steel barrel, sight, receiver,
      // walnut fore-end/stock, brass bolt, and trigger guard. The user requested
      // a clean hand-free arcade view: no hand or sleeve covers the rifle.
      c.shadowColor = '#16382d50'; c.shadowBlur = 9; c.shadowOffsetX = 4;
      rect(c, -10, -259, 20, 158, 4, '#203c3c'); c.shadowBlur = 0; c.shadowOffsetX = 0;
      rect(c, -6, -254, 5, 114, 2, '#91a7a0'); rect(c, 2, -254, 4, 114, 1, '#456465');
      rect(c, -12, -258, 24, 11, 3, '#172f31'); rect(c, -3, -267, 6, 14, 2, '#183637'); rect(c, -1.5, -266, 3, 4, 1, '#f4d26d');
      rect(c, -15, -207, 30, 87, 7, '#624336'); rect(c, -11, -204, 21, 77, 5, '#ae7650');
      c.strokeStyle = '#d69d68'; c.lineWidth = 2;
      for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-8, -189 + i * 9); c.lineTo(8, -189 + i * 9); c.stroke(); }
      rect(c, -18, -138, 36, 67, 5, '#254344'); rect(c, -12, -136, 12, 62, 2, '#607b74'); rect(c, -6, -136, 6, 33, 2, '#9aae9f');
      rect(c, 14, -115, 17, 6, 3, '#172f30'); ellipse(c, 32, -112, 6, 6, '#b69b65');
      rect(c, -11, -151, 22, 9, 2, '#193335'); rect(c, -3, -151, 6, 6, 1, '#d4c090');
      c.strokeStyle = '#172f31'; c.lineWidth = 5; c.beginPath(); c.ellipse(17, -64, 16, 22, -.25, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#b3a378'; c.lineWidth = 3; c.beginPath(); c.moveTo(11, -81); c.quadraticCurveTo(25, -70, 14, -63); c.stroke();
      curve(c, [[-17, -79], [-6, -88, 10, -88, 16, -78], [12, -58, 9, -41, 21, -22], [33, -4, 37, 20, 34, 42], [-34, 42], [-35, 9, -33, -15, -22, -40], [-20, -50, -19, -65, -17, -79]], '#503c32');
      curve(c, [[-12, -78], [-1, -82, 8, -83, 10, -76], [8, -54, 4, -32, 18, -16], [27, 0, 28, 22, 27, 37], [-27, 37], [-26, 8, -28, -9, -17, -40], [-15, -56, -14, -69, -12, -78]], '#aa734b');
      c.strokeStyle = '#d6a06a'; c.lineWidth = 2; c.beginPath(); c.moveTo(-7, -65); c.bezierCurveTo(-9, -24, -17, -13, -14, 32); c.moveTo(-1, -33); c.bezierCurveTo(2, -6, 16, 10, 16, 29); c.stroke();
      rect(c, -37, 29, 74, 18, 4, '#283e36');
      c.fillStyle = '#adc0ac'; c.font = '6px monospace'; c.fillText('SS / 06', -10, -88);
      if (g.flash > 0) {
        c.globalAlpha = g.flash / .055;
        polygon(c, [[0, -263], [-10, -276], [-5, -283], [-13, -306], [0, -293], [8, -318], [10, -282], [19, -289], [9, -267]], '#ffd475');
        polygon(c, [[-4, -263], [-5, -282], [2, -301], [6, -278], [4, -263]], '#fffce2');
      }
      c.restore();
    }
    drawReticle() {
      const c = this.context, g = this.game, { x, y } = g.aim;
      const spread = (this.reducedMotion ? 0 : g.recoil * 7), r = 13 + spread;
      // Black aim marks stay clear against sky/clouds; a subtle pale halo
      // keeps the same reticle readable over dark birds and foreground grass.
      c.save(); c.translate(x, y); c.lineWidth = 2;
      c.strokeStyle = '#000000'; c.shadowColor = '#fffdf5'; c.shadowBlur = 2;
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
      c.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; c.moveTo(Math.cos(a) * (r + 4), Math.sin(a) * (r + 4)); c.lineTo(Math.cos(a) * (r + 10), Math.sin(a) * (r + 10)); } c.stroke();
      ellipse(c, 0, 0, 2, 2, '#000000');
      if (g.reloading) { c.strokeStyle = '#edb54f'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, r + 1, -Math.PI / 2, -Math.PI / 2 + (1 - g.reloadLeft / CONFIG.reloadTime) * Math.PI * 2); c.stroke(); }
      if (g.hitMarker > 0) {
        c.strokeStyle = '#ffeaa1'; c.lineWidth = 3; c.beginPath();
        for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; c.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); c.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); } c.stroke();
      }
      c.restore();
    }
    draw(dt = 0) {
      const c = this.context, g = this.game, w = this.width, h = this.height;
      if (g.state === 'running' || g.state === 'ready') this.time += dt;
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.drawImage(this.sky, 0, 0);
      c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      for (let i = 0; i < 6; i++) {
        const phase = this.reducedMotion ? 0 : this.time * (3 + i * .3);
        const x = ((i * w / 4.4 + phase + 130) % (w + 280)) - 140;
        this.drawCloud(x, 100 + (i % 3) * 73, .48 + (i % 3) * .2, .55 + (i % 2) * .18);
      }
      // Tiny distant flock is background detail, visually distinct from targets.
      c.strokeStyle = '#54878265'; c.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) { const x = w * .15 + i * 18, y = h * .42 - Math.sin(i) * 16; c.beginPath(); c.moveTo(x - 5, y - 2); c.quadraticCurveTo(x - 2, y - 5, x, y); c.quadraticCurveTo(x + 3, y - 5, x + 6, y - 2); c.stroke(); }
      c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.terrain, 0, 0); c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      if (g.state === 'ready') {
        for (let i = 0; i < 4; i++) this.drawBird({ x: ((w * .14 + i * w * .31 + this.time * (19 + i * 4)) % (w + 160)) - 55, y: 201 + i % 3 * 58, phase: this.time * 9 + i, size: .84, state: 'flying', direction: i % 2 ? -1 : 1, species: SPECIES[i % 3] });
      }
      for (const bird of g.birds) this.drawBird(bird);
      for (const b of g.bullets) {
        c.save(); c.globalAlpha = clamp(b.life / b.maxLife, 0, 1) * .8;
        const gradient = c.createLinearGradient(b.x1, b.y1, b.x2, b.y2); gradient.addColorStop(0, '#fff1b000'); gradient.addColorStop(.35, '#fff2afaa'); gradient.addColorStop(1, '#fffdea');
        c.strokeStyle = gradient; c.lineWidth = 2; c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke();
        ellipse(c, b.x2, b.y2, 4 * b.life / b.maxLife, 4 * b.life / b.maxLife, '#fffadd'); c.restore();
      }
      this.drawGun();
      for (const p of g.particles) { c.save(); c.globalAlpha = clamp(p.life / .3, 0, 1); c.translate(p.x, p.y); c.rotate(p.angle); ellipse(c, 0, 0, p.size, p.size * .38, p.color); c.restore(); }
      for (const p of g.popups) {
        c.save(); c.globalAlpha = clamp(p.life / .2, 0, 1); c.font = 'bold 24px Arial'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#275548'; c.strokeText(p.text, p.x, p.y); c.fillStyle = p.gold ? '#ffe18a' : '#fffbe7'; c.fillText(p.text, p.x, p.y); c.restore();
      }
      if (g.state === 'running') this.drawReticle();
    }
  }
  root.SkyshotRenderer = Renderer;
})(window);
