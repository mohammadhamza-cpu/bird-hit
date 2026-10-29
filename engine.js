/* Skyshot simulation. No DOM, audio, timers, or rendering dependencies.
 * Hitscan resolves against the exact visible body/head/wing/tail/beak shapes.
 * Tracers are short-lived visual bullets, not slow projectiles with misleading aim.
 * All durations are seconds. advance() subdivides elapsed time at 120 Hz.
 */
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ duration: 90, magazine: 6, reloadTime: 1.35, shotInterval: .16, step: 1 / 120, maxBirds: 14 });
  const SPECIES = Object.freeze([
    { name: 'teal', points: 100, size: 1, speed: 1, body: '#27685e', wing: '#184c49', head: '#214b45', belly: '#efe5bd' },
    { name: 'coral', points: 150, size: .88, speed: 1.24, body: '#d48064', wing: '#a35343', head: '#733f3c', belly: '#fbe1b3' },
    { name: 'gold', points: 250, size: .72, speed: 1.52, body: '#e4ae44', wing: '#b57b29', head: '#725b35', belly: '#fff0b9' }
  ]);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function birdShapes(bird) {
    const flap = Math.sin(bird.phase) * 26;
    return {
      body: { x: 0, y: 0, rx: 24, ry: 13 },
      head: { x: 21, y: -10, rx: 10, ry: 10 },
      wing: [[-10, 1], [-25, -12 - flap], [-2, -19 - flap], [14, 2]],
      tail: [[-17, -4], [-38, -11], [-30, 6], [-17, 8]],
      beak: [[28, -13], [41, -8], [28, -5]]
    };
  }
  function inPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
      if (Math.abs(cross) < .00001 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) return true;
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function hitBird(bird, x, y) {
    if (bird.state !== 'flying') return false;
    const lx = (x - bird.x) * bird.direction / bird.size;
    const ly = (y - bird.y) / bird.size;
    const s = birdShapes(bird);
    const ellipse = e => ((lx - e.x) / e.rx) ** 2 + ((ly - e.y) / e.ry) ** 2 <= 1;
    return ellipse(s.body) || ellipse(s.head) || inPolygon(lx, ly, s.wing) || inPolygon(lx, ly, s.tail) || inPolygon(lx, ly, s.beak);
  }
  class Game {
    constructor({ width = 1100, height = 720, random = Math.random } = {}) {
      this.width = width; this.height = height; this.random = random;
      this.reset('ready');
    }
    reset(state = 'running') {
      this.state = state; this.elapsed = 0; this.remaining = CONFIG.duration;
      this.score = 0; this.ammo = CONFIG.magazine; this.reloading = false; this.reloadLeft = 0;
      this.cooldown = 0; this.recoil = 0; this.flash = 0; this.hitMarker = 0;
      this.hits = 0; this.shots = 0; this.escaped = 0; this.streak = 0; this.bestStreak = 0;
      this.level = 1; this.spawnClock = .25; this.nextId = 1; this.lastTick = 11;
      this.birds = []; this.bullets = []; this.particles = []; this.popups = []; this.events = [];
      this.aim = { x: this.width * .5, y: this.height * .4 };
      // A/D translates the rifle independently of the crosshair. Store a
      // fraction of screen width so resizing preserves its horizontal position.
      this.gunPosition = this.width < 650 ? .72 : .76;
    }
    start() { this.reset(); this.emit('start'); }
    emit(type, detail = {}) { this.events.push({ type, ...detail }); }
    drainEvents() { const events = this.events; this.events = []; return events; }
    get multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 3)); }
    get accuracy() { return this.shots ? Math.round(this.hits / this.shots * 100) : 0; }
    get spawnInterval() { return Math.max(.42, 1.3 - (this.level - 1) * .16); }
    setAim(x, y) {
      if (Number.isFinite(x) && Number.isFinite(y)) this.aim = { x: clamp(x, 0, this.width), y: clamp(y, 0, this.height) };
    }
    moveGun(direction, dt) {
      if (this.state !== 'running' || !Number.isFinite(direction) || !Number.isFinite(dt) || dt <= 0) return;
      // Cross 45% of the playfield per active second, independent of frame rate.
      // Inset the stock at both edges; aim and hit detection remain unchanged.
      this.gunPosition = clamp(this.gunPosition + clamp(direction, -1, 1) * .45 * dt, .1, .9);
    }
    resize(width, height) {
      const sx = width / this.width, sy = height / this.height;
      for (const b of this.birds) { b.x *= sx; b.baseY *= sy; b.y *= sy; b.vx *= sx; }
      for (const p of this.particles) { p.x *= sx; p.y *= sy; }
      for (const p of this.popups) { p.x *= sx; p.y *= sy; }
      for (const b of this.bullets) { b.x1 *= sx; b.x2 *= sx; b.y1 *= sy; b.y2 *= sy; }
      this.aim.x *= sx; this.aim.y *= sy; this.width = width; this.height = height;
      if (this.state === 'ready') this.gunPosition = width < 650 ? .72 : .76;
    }
    pause() { if (this.state !== 'running') return false; this.state = 'paused'; this.emit('pause'); return true; }
    resume() { if (this.state !== 'paused') return false; this.state = 'running'; this.emit('resume'); return true; }
    end() {
      if (this.state !== 'running') return;
      this.remaining = 0; this.state = 'over'; this.reloading = false; this.reloadLeft = 0;
      this.emit('over', { score: this.score, hits: this.hits, accuracy: this.accuracy });
    }
    reload() {
      if (this.state !== 'running' || this.reloading || this.ammo === CONFIG.magazine) return false;
      this.reloading = true; this.reloadLeft = CONFIG.reloadTime; this.emit('reload'); return true;
    }
    spawnBird() {
      const r = this.random();
      const species = SPECIES[r < .64 ? 0 : r < .9 ? 1 : 2];
      const direction = this.random() < .5 ? 1 : -1;
      const baseY = 158 + this.random() * (this.height * .65 - 158);
      const bird = {
        id: this.nextId++, state: 'flying', species, size: species.size, direction,
        x: direction === 1 ? -65 : this.width + 65, y: baseY, baseY,
        vx: direction * (112 + this.random() * 48) * species.speed * (1 + (this.level - 1) * .17) * clamp(this.width / 1100, .62, 1.35),
        age: 0, phase: this.random() * Math.PI * 2, wave: this.random() * Math.PI * 2,
        amplitude: 8 + this.random() * 15, fallTime: 0, vy: 0, rotation: 0
      };
      this.birds.push(bird); return bird;
    }
    gunPose() {
      // User-requested hand-free presentation: a slightly larger rifle enters
      // from the lower right initially; A/D moves the stock across the screen.
      // Share this pose with the renderer and tracers so aiming stays accurate.
      const scale = this.width < 650 ? .92 : 1.1;
      const x = this.width * this.gunPosition;
      const y = this.height + 6;
      // Keep the rifle above the ground even when pointing below its own stock.
      const angle = clamp(Math.atan2(this.aim.y - y, this.aim.x - x), -Math.PI + .17, -.17);
      const length = 258 * scale;
      return { x, y, angle, scale, muzzleX: x + Math.cos(angle) * length, muzzleY: y + Math.sin(angle) * length };
    }
    shoot(x = this.aim.x, y = this.aim.y) {
      if (this.state !== 'running' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      this.setAim(x, y);
      if (this.reloading || this.cooldown > .00001) return null;
      if (!this.ammo) { this.emit('empty'); this.reload(); return null; }
      this.ammo--; this.shots++; this.cooldown = CONFIG.shotInterval; this.recoil = 1; this.flash = .055;
      const pose = this.gunPose();
      const bullet = { x1: pose.muzzleX, y1: pose.muzzleY, x2: this.aim.x, y2: this.aim.y, life: .105, maxLife: .105 };
      this.bullets.push(bullet);
      this.emit('shot');
      // Last drawn bird is in front; a shot can score only once, even on overlaps.
      const bird = this.birds.slice().reverse().find(b => hitBird(b, this.aim.x, this.aim.y));
      if (bird) {
        this.hits++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
        const points = bird.species.points * this.multiplier;
        this.score += points; this.hitMarker = .24;
        bird.state = 'hit'; bird.vy = -80; bird.fallTime = 0;
        this.popups.push({ x: bird.x, y: bird.y - 22, text: '+' + points, life: .9, maxLife: .9, gold: this.multiplier > 1 });
        for (let i = 0; i < 12; i++) {
          const angle = this.random() * Math.PI * 2, speed = 45 + this.random() * 135;
          this.particles.push({ x: bird.x, y: bird.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 50,
            life: .5 + this.random() * .4, maxLife: .9, angle, color: i % 3 ? bird.species.belly : '#fffbed', size: 2 + this.random() * 4 });
        }
        this.emit('hit', { points, multiplier: this.multiplier, birdId: bird.id });
      } else { this.streak = 0; this.emit('miss'); }
      // Ejected brass is a bounded visual effect, not a second gameplay projectile.
      this.particles.push({ x: pose.x + Math.cos(pose.angle) * 116, y: pose.y + Math.sin(pose.angle) * 116,
        vx: 115, vy: -150, life: .65, maxLife: .65, angle: 0, color: '#efc364', size: 4 });
      if (!this.ammo) this.reload();
      return { hit: !!bird, birdId: bird ? bird.id : null, bullet };
    }
    advance(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || this.state !== 'running') return;
      let left = dt;
      while (left > 1e-9 && this.state === 'running') {
        const step = Math.min(CONFIG.step, left, this.remaining);
        if (step <= 1e-9) { this.end(); break; }
        this.step(step); left -= step;
      }
    }
    step(dt) {
      this.elapsed += dt; this.remaining = Math.max(0, CONFIG.duration - this.elapsed);
      const level = Math.min(6, 1 + Math.floor((this.elapsed + 1e-8) / 15));
      if (level !== this.level) { this.level = level; this.emit('level', { level }); }
      const tick = Math.ceil(this.remaining);
      if (tick <= 10 && tick > 0 && tick < this.lastTick) { this.lastTick = tick; this.emit('tick', { tick }); }
      this.cooldown = Math.max(0, this.cooldown - dt); this.flash = Math.max(0, this.flash - dt);
      this.recoil *= Math.exp(-14 * dt); this.hitMarker = Math.max(0, this.hitMarker - dt);
      if (this.reloading) {
        this.reloadLeft = Math.max(0, this.reloadLeft - dt);
        if (this.reloadLeft <= 1e-8) { this.ammo = CONFIG.magazine; this.reloading = false; this.reloadLeft = 0; this.emit('loaded'); }
      }
      this.spawnClock -= dt;
      if (this.spawnClock <= 0) {
        if (this.birds.filter(b => b.state === 'flying').length < CONFIG.maxBirds) this.spawnBird();
        this.spawnClock += this.spawnInterval * (.85 + this.random() * .3);
      }
      for (const b of this.birds) {
        b.age += dt; b.phase += dt * (10 + Math.abs(b.vx) / 70);
        if (b.state === 'flying') {
          b.x += b.vx * dt; b.y = b.baseY + Math.sin(b.age * 2.7 + b.wave) * b.amplitude;
          if ((b.direction > 0 && b.x > this.width + 85) || (b.direction < 0 && b.x < -85)) {
            b.state = 'gone'; this.escaped++; this.streak = 0; this.emit('escape');
          }
        } else if (b.state === 'hit') {
          b.fallTime += dt; b.vy += 720 * dt; b.x += b.vx * dt * .3; b.y += b.vy * dt; b.rotation += dt * b.direction * 4;
          if (b.fallTime > .7 || b.y > this.height + 80) b.state = 'gone';
        }
      }
      this.birds = this.birds.filter(b => b.state !== 'gone');
      for (const b of this.bullets) b.life -= dt;
      this.bullets = this.bullets.filter(b => b.life > 0);
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt; p.angle += dt * 5; }
      this.particles = this.particles.filter(p => p.life > 0);
      for (const p of this.popups) { p.life -= dt; p.y -= dt * 45; }
      this.popups = this.popups.filter(p => p.life > 0);
      if (this.remaining <= 1e-8) this.end();
    }
  }
  root.SkyshotEngine = { Game, CONFIG, SPECIES, birdShapes, hitBird, inPolygon, clamp };
})(typeof window !== 'undefined' ? window : globalThis);
