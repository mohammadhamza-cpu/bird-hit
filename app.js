/* Input/lifecycle controller. A single RAF chain is installed at boot, never by
 * Start/Resume/Restart. Hidden tabs and >2s stalls pause instead of fast-forwarding.
 */
(function () {
  'use strict';
  const { Game, CONFIG, clamp } = window.SkyshotEngine;
  const $ = id => document.getElementById(id);
  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (_) { /* session-only fallback */ } };
  const storedBest = Number(read('skyshot.best.v1', '0'));
  let best = Number.isSafeInteger(storedBest) && storedBest >= 0 ? storedBest : 0;
  const game = new Game(), sound = new window.SkyshotSound(read('skyshot.sound.v1', 'off') === 'on');
  const renderer = new window.SkyshotRenderer($('game'), game);
  const controller = new AbortController(), signal = controller.signal, held = new Set();
  let rafId = 0, lastTime = null, frameCount = 0, disposed = false, lastState = '', toastTime = 0, bestAtStart = best;
  let lastPointer = null;
  const levelNames = ['EASY BREEZE', 'PICKING UP', 'WINGS OF SPEED', 'HIGH FLYERS', 'WILD SKIES', 'FINAL FLURRY'];
  const pips = Array.from({ length: CONFIG.magazine }, () => { const pip = document.createElement('i'); pip.className = 'ammo-pip'; $('ammo-pips').appendChild(pip); return pip; });
  function on(target, type, handler, options = {}) { target.addEventListener(type, handler, { ...options, signal }); }
  function text(id, value) { const el = $(id); if (el.textContent !== String(value)) el.textContent = value; }
  function announce(message, seconds = 1.6) { text('toast', message); toastTime = seconds; $('toast').classList.add('visible'); }
  function updateSoundUI() {
    $('sound-button').setAttribute('aria-pressed', String(sound.enabled));
    $('sound-button').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Unmute sound');
    text('sound-label', sound.available ? (sound.enabled ? 'SOUND ON' : 'SOUND OFF') : 'NO AUDIO');
  }
  function toggleSound() { sound.setEnabled(!sound.enabled); write('skyshot.sound.v1', sound.enabled ? 'on' : 'off'); updateSoundUI(); if (sound.enabled) sound.play('loaded'); }
  function processEvents() {
    for (const event of game.drainEvents()) {
      if (['shot', 'hit', 'reload', 'loaded', 'empty', 'tick', 'start'].includes(event.type)) sound.play(event.type);
      if (event.type === 'hit') {
        if (game.score > best) { best = game.score; write('skyshot.best.v1', best); }
        if (game.streak % 3 === 0) announce(event.multiplier + '× STREAK · KEEP IT FLYING');
      }
      if (event.type === 'level') { announce('ROUND ' + String(event.level).padStart(2, '0') + ' · ' + levelNames[event.level - 1], 2); sound.play('level'); }
      if (event.type === 'loaded') announce('LOCKED & LOADED', .7);
      if (event.type === 'over') { sound.stop(); sound.play('over'); held.clear(); text('final-score', game.score.toLocaleString()); text('final-hits', game.hits); text('final-accuracy', game.accuracy + '%'); text('final-combo', game.bestStreak + ''); text('end-eyebrow', game.score > bestAtStart ? 'A NEW PERSONAL BEST' : "THAT'S A WRAP"); text('end-message', game.score ? 'A good day under open skies.' : 'Find your rhythm. There is always another round.'); }
    }
  }
  function syncUI() {
    text('score', String(game.score).padStart(4, '0')); text('best', String(best).padStart(4, '0'));
    const seconds = Math.ceil(Math.max(0, game.remaining));
    text('timer', Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
    $('timer-fill').style.transform = 'scaleX(' + game.remaining / CONFIG.duration + ')';
    $('timer').parentElement.classList.toggle('urgent', seconds <= 10);
    text('combo', game.streak ? game.multiplier + '× POINTS · ' + game.streak + ' HIT STREAK' : "LET'S FLY");
    $('combo').classList.toggle('hot', game.multiplier > 1);
    text('level-label', 'ROUND ' + String(game.level).padStart(2, '0') + ' · ' + levelNames[game.level - 1]);
    text('ammo-number', game.ammo + ' / ' + CONFIG.magazine);
    pips.forEach((pip, i) => pip.classList.toggle('empty', i >= game.ammo));
    text('reload-label', game.reloading ? 'RELOADING' : 'RELOAD');
    text('ammo-hint', game.reloading ? 'Fresh magazine on the way…' : 'Six in the chamber. Sky\'s the limit.');
    $('reload-fill').style.transform = 'scaleX(' + (game.reloading ? 1 - game.reloadLeft / CONFIG.reloadTime : 0) + ')';
    $('reload-button').disabled = game.state !== 'running' || game.reloading || game.ammo === CONFIG.magazine;
    $('pause-button').disabled = game.state === 'ready' || game.state === 'over';
    $('pause-button').setAttribute('aria-label', game.state === 'paused' ? 'Resume game' : 'Pause game');
    text('pause-button', game.state === 'paused' ? '▶' : 'Ⅱ');
    $('game').classList.toggle('is-playing', game.state === 'running');
    if (lastState !== game.state) {
      $('overlay').hidden = game.state === 'running';
      $('start-screen').hidden = game.state !== 'ready'; $('pause-screen').hidden = game.state !== 'paused'; $('end-screen').hidden = game.state !== 'over';
      $('arena').dataset.state = game.state;
      if (game.state === 'over') $('restart-button').focus({ preventScroll: true });
      lastState = game.state;
    }
  }
  function focusCanvas() { $('game').focus({ preventScroll: true }); }
  function start() {
    sound.stop(); sound.unlock(); bestAtStart = best; game.start(); held.clear(); lastTime = null; toastTime = 0;
    $('toast').classList.remove('visible'); processEvents(); syncUI(); focusCanvas();
  }
  function pause() {
    if (game.pause()) { held.clear(); sound.stop(); lastTime = null; processEvents(); syncUI(); }
  }
  function resume() {
    sound.unlock();
    if (game.resume()) { held.clear(); lastTime = null; processEvents(); syncUI(); focusCanvas(); }
  }
  function togglePause() { game.state === 'paused' ? resume() : pause(); }
  function fire() { sound.unlock(); const result = game.shoot(); processEvents(); syncUI(); return result; }
  function reload() { sound.unlock(); game.reload(); processEvents(); syncUI(); focusCanvas(); }
  function pointerAim(event) {
    const box = $('game').getBoundingClientRect();
    game.setAim((event.clientX - box.left) / box.width * game.width, (event.clientY - box.top) / box.height * game.height);
    lastPointer = { x: event.clientX, y: event.clientY };
  }
  on($('game'), 'pointermove', event => { if (game.state === 'running' && event.isPrimary) pointerAim(event); });
  on($('game'), 'pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || game.state !== 'running') return;
    event.preventDefault(); focusCanvas(); pointerAim(event); fire();
  });
  on($('game'), 'contextmenu', event => event.preventDefault());
  on($('start-button'), 'click', start); on($('restart-button'), 'click', start); on($('pause-restart-button'), 'click', start);
  on($('resume-button'), 'click', resume); on($('pause-button'), 'click', togglePause); on($('reload-button'), 'click', reload); on($('sound-button'), 'click', toggleSound);
  on(window, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    const native = event.target.closest && event.target.closest('button,a,input,textarea,select,summary');
    if (native && ['Space', 'Enter'].includes(event.code)) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'Space', 'KeyR', 'KeyP', 'Escape', 'KeyM', 'Enter'].includes(event.code)) return;
    // Global pause/mute shortcuts remain available; aiming requires the playfield.
    if (event.code.startsWith('Arrow') && document.activeElement !== $('game')) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'KeyM') { toggleSound(); return; }
    if (event.code === 'KeyP' || event.code === 'Escape') { togglePause(); return; }
    if (event.code === 'Enter' && game.state !== 'running') { game.state === 'paused' ? resume() : start(); return; }
    if (game.state !== 'running') return;
    if (event.code.startsWith('Arrow') || event.code === 'KeyA' || event.code === 'KeyD') { held.add(event.code); return; }
    if (event.code === 'Space') fire();
    if (event.code === 'KeyR') reload();
  });
  on(window, 'keyup', event => held.delete(event.code));
  on(window, 'blur', () => { pause(); sound.stop(); held.clear(); });
  on(document, 'visibilitychange', () => { if (document.hidden) { pause(); sound.stop(); } });
  const observer = new ResizeObserver(() => { renderer.resize(); if (lastPointer && game.state === 'running' && !held.size) pointerAim({ clientX: lastPointer.x, clientY: lastPointer.y }); renderer.draw(); });
  observer.observe($('arena'));
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  on(motionQuery, 'change', event => { renderer.reducedMotion = event.matches; });
  function frame(now) {
    if (disposed) return;
    frameCount++;
    const dt = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000); lastTime = now;
    if (dt > 2 && game.state === 'running') { pause(); announce('PAUSED · READY WHEN YOU ARE', 2); }
    if (game.state === 'running') {
      const dx = Number(held.has('ArrowRight')) - Number(held.has('ArrowLeft'));
      const dy = Number(held.has('ArrowDown')) - Number(held.has('ArrowUp'));
      const speed = 460 / (dx && dy ? Math.SQRT2 : 1);
      if (dx || dy) { game.setAim(game.aim.x + dx * speed * dt, game.aim.y + dy * speed * dt); lastPointer = null; }
      // Held A/D translates the rifle, not the crosshair. Opposite keys cancel;
      // key release, pause, focus loss, and restart already clear held input.
      game.moveGun(Number(held.has('KeyD')) - Number(held.has('KeyA')), Math.min(dt, game.remaining));
      game.advance(dt); processEvents();
    }
    if (toastTime > 0 && game.state !== 'paused') { toastTime -= Math.min(dt, .1); if (toastTime <= 0) $('toast').classList.remove('visible'); }
    renderer.draw(Math.min(dt, .1)); syncUI(); rafId = requestAnimationFrame(frame);
  }
  function dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(rafId); observer.disconnect(); controller.abort(); sound.dispose(); held.clear(); }
  on(window, 'pagehide', () => { pause(); sound.stop(); });
  updateSoundUI(); syncUI(); renderer.draw(); rafId = requestAnimationFrame(frame);
  // Introspection for repeatable browser tests, no external service or network.
  window.SkyshotApp = { game, sound, renderer, start, pause, resume, syncUI, processEvents, dispose,
    get debug() { return { frameCount, rafId, disposed, heldKeys: held.size }; } };
})();
