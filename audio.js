/* Gesture-created Web Audio, no downloaded assets and no autoplay.
 * Effects use cached, smoothly enveloped PCM; every voice disconnects on end.
 */
(function (root) {
  'use strict';
  class Sound {
    constructor(enabled = false) {
      this.enabled = enabled; this.available = !!(root.AudioContext || root.webkitAudioContext);
      this.context = null; this.master = null; this.buffers = new Map(); this.voices = new Set();
      this.played = {}; this.error = null;
    }
    unlock() {
      if (!this.enabled || !this.available) return;
      try {
        if (!this.context) {
          this.context = new (root.AudioContext || root.webkitAudioContext)();
          this.master = this.context.createGain(); this.master.gain.value = .55; this.master.connect(this.context.destination);
        }
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      } catch (error) { this.available = false; this.error = String(error); }
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) this.stop();
      else this.unlock();
    }
    makeBuffer(kind) {
      if (this.buffers.has(kind)) return this.buffers.get(kind);
      const durations = { shot: .2, hit: .25, reload: .16, loaded: .22, empty: .09, start: .5, level: .45, over: 1.15, tick: .07 };
      const duration = durations[kind] || .12, rate = this.context.sampleRate;
      const buffer = this.context.createBuffer(1, Math.ceil(rate * duration), rate), data = buffer.getChannelData(0);
      const sequences = { start: [392, 523.25, 659.25, 783.99], level: [523.25, 659.25, 783.99], over: [783.99, 659.25, 523.25, 392, 523.25], hit: [880, 1174.66] };
      let seed = 1973, noise = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const random = seed / 4294967296 * 2 - 1;
        noise = noise * .3 + random * .7;
        const envelope = Math.min(1, t / .003) * Math.min(1, (duration - t) / .018);
        let value = 0;
        if (kind === 'shot') value = (noise * .72 + Math.sin(2 * Math.PI * (135 * t - 170 * t * t)) * .35) * Math.exp(-t * 29);
        else if (kind === 'reload' || kind === 'loaded' || kind === 'empty') {
          const second = kind === 'loaded' ? .09 : .065;
          const pulse = Math.exp(-t * 100) + (t > second ? .6 * Math.exp(-(t - second) * 100) : 0);
          value = (.32 * noise + .3 * Math.sin(2 * Math.PI * (kind === 'empty' ? 180 : 450) * t)) * pulse;
        } else if (kind === 'tick') value = Math.sin(2 * Math.PI * 1046.5 * t) * Math.exp(-t * 70) * .3;
        else {
          const notes = sequences[kind] || [440], part = duration / notes.length;
          const index = Math.min(notes.length - 1, Math.floor(t / part)), local = t - index * part;
          const attack = Math.min(1, local / .006), release = Math.min(1, (part - local) / .018);
          value = (Math.sin(2 * Math.PI * notes[index] * local) + .18 * Math.sin(2 * Math.PI * notes[index] * 2 * local)) * Math.exp(-local * 10) * attack * release * .32;
        }
        data[i] = value * envelope * .6;
      }
      this.buffers.set(kind, buffer); return buffer;
    }
    play(kind) {
      if (!this.enabled || !this.available || !this.context || this.context.state !== 'running') return false;
      try {
        const source = this.context.createBufferSource(); source.buffer = this.makeBuffer(kind);
        source.connect(this.master); this.voices.add(source);
        source.onended = () => { source.disconnect(); this.voices.delete(source); };
        source.start(); this.played[kind] = (this.played[kind] || 0) + 1; return true;
      } catch (error) { this.error = String(error); return false; }
    }
    stop() { for (const source of this.voices) { source.onended = null; try { source.stop(); } catch (_) { /* already ended */ } source.disconnect(); } this.voices.clear(); }
    dispose() { this.stop(); if (this.context) this.context.close().catch(() => {}); }
  }
  root.SkyshotSound = Sound;
})(window);
