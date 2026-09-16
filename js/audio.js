/* Pipe Dream — tiny WebAudio synthesiser for the game's sound effects */
(function () {
  'use strict';

  const PD = window.PD;

  class Audio {
    constructor() {
      this.ctx = null;
      this.muted = localStorage.getItem('pd.muted') === '1';
    }

    // Browsers only allow audio after a user gesture, so create lazily.
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    setMuted(m) {
      this.muted = m;
      localStorage.setItem('pd.muted', m ? '1' : '0');
    }

    tone(freq, dur, type, vol, slideTo, delay) {
      const ctx = this.ensure();
      if (!ctx || this.muted) return;
      const t0 = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.5, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    noise(dur, vol, delay) {
      const ctx = this.ensure();
      if (!ctx || this.muted) return;
      const t0 = ctx.currentTime + (delay || 0);
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = vol || 0.3;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      src.connect(f).connect(g).connect(this.master);
      src.start(t0);
    }

    place() {
      this.tone(520, 0.06, 'square', 0.25, 380);
    }
    replace() {
      this.noise(0.14, 0.35);
      this.tone(160, 0.12, 'sawtooth', 0.2, 90);
    }
    deny() {
      this.tone(140, 0.12, 'square', 0.2);
    }
    flowStart() {
      this.tone(300, 0.25, 'triangle', 0.3, 700);
    }
    fast() {
      this.tone(600, 0.08, 'square', 0.2, 900);
    }
    fill() {
      this.tone(740, 0.045, 'sine', 0.22, 880);
    }
    bonus() {
      [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.3, null, i * 0.07));
    }
    spill() {
      this.tone(500, 0.5, 'sawtooth', 0.3, 80);
      this.noise(0.4, 0.4, 0.05);
    }
    endReached() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.3, null, i * 0.09));
    }
    cleanup() {
      this.tone(220, 0.05, 'square', 0.15, 120);
    }
    levelComplete() {
      [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.3, null, i * 0.11));
    }
    gameOver() {
      [330, 262, 220, 165].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.22, null, i * 0.2));
    }
    tick() {
      this.tone(1000, 0.03, 'sine', 0.15);
    }
  }

  PD.Audio = Audio;
})();
