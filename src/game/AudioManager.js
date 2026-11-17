import { AmbientMusic } from "./AmbientMusic.js";

const NOISE_SECONDS = 2;
const REVERB_SECONDS = 1.6;
const DRONE_RANGE = 180;
const HEARTBEAT_INTERVAL = 0.85;

export class AudioManager {
  constructor() {
    this.context = null;
    this.started = false;
    this.gunSide = 1;
    this.lastTrickCombo = 0;
    this.nextHeartbeat = 0;
    this.listenerPosition = { x: 0, y: 0, z: 0 };
  }

  async ensureStarted() {
    if (!this.context) {
      this.init(new window.AudioContext());
    }
    this.started = true;
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  init(context) {
    this.context = context;
    const c = context;

    this.noiseBuffer = c.createBuffer(1, c.sampleRate * NOISE_SECONDS, c.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i += 1) {
      noise[i] = Math.random() * 2 - 1;
    }

    const compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressor.connect(c.destination);

    this.masterGain = c.createGain();
    this.masterGain.gain.value = 0.55;
    this.masterGain.connect(compressor);

    this.musicGain = c.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.masterGain);
    this.music = new AmbientMusic(c, this.musicGain);

    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0.4;
    this.engineGain.connect(this.masterGain);

    this.effectsGain = c.createGain();
    this.effectsGain.gain.value = 0.5;
    this.effectsGain.connect(this.masterGain);

    const reverb = c.createConvolver();
    reverb.buffer = this.createImpulse();
    const reverbSend = c.createGain();
    reverbSend.gain.value = 0.22;
    this.effectsGain.connect(reverbSend);
    reverbSend.connect(reverb);
    reverb.connect(this.masterGain);

    this.buildEngine();
    this.buildEnemyDrone();
    this.rain = this.loopedNoise("highpass", 2600, 0.4, this.effectsGain);
  }

  updateRain(amount) {
    if (this.started) {
      this.rain.gain.gain.setTargetAtTime(amount * 0.16, this.context.currentTime, 0.5);
    }
  }

  // Sound lags the flash by its distance, and far strikes lose their crack and keep only the rumble.
  playThunder(distance) {
    if (!this.started) {
      return;
    }
    const when = this.context.currentTime + distance / 340;
    const near = 1 - Math.min(1, distance / 700);
    this.burst(this.effectsGain, when, { type: "highpass", frequency: 900, gain: 0.5 * near, duration: 0.25 });
    this.burst(this.effectsGain, when, { type: "lowpass", frequency: 420, frequencyEnd: 60, q: 0.6, gain: 0.5 + near * 0.6, duration: 1.7 });
    this.tone(this.effectsGain, when, { frequency: 62, frequencyEnd: 28, gain: 0.35 + near * 0.4, duration: 1.8 });
  }

  createImpulse() {
    const c = this.context;
    const length = Math.floor(c.sampleRate * REVERB_SECONDS);
    const impulse = c.createBuffer(2, length, c.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
    }
    return impulse;
  }

  loopedNoise(type, frequency, q, destination) {
    const c = this.context;
    const source = c.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start();
    return { filter, gain };
  }

  buildEngine() {
    const c = this.context;
    this.rumble = this.loopedNoise("lowpass", 180, 0.7, this.engineGain);
    this.wind = this.loopedNoise("bandpass", 900, 0.6, this.engineGain);
    this.groundRoll = this.loopedNoise("lowpass", 160, 1, this.engineGain);

    this.whineA = c.createOscillator();
    this.whineB = c.createOscillator();
    this.whineA.type = "sawtooth";
    this.whineB.type = "sawtooth";
    this.whineA.frequency.value = 90;
    this.whineB.frequency.value = 90;
    this.whineB.detune.value = 14;
    this.whineFilter = c.createBiquadFilter();
    this.whineFilter.type = "lowpass";
    this.whineFilter.frequency.value = 900;

    const propeller = c.createGain();
    propeller.gain.value = 0.7;
    this.propellerLfo = c.createOscillator();
    this.propellerLfo.frequency.value = 20;
    const propellerDepth = c.createGain();
    propellerDepth.gain.value = 0.3;
    this.propellerLfo.connect(propellerDepth);
    propellerDepth.connect(propeller.gain);

    this.whineGain = c.createGain();
    this.whineGain.gain.value = 0;
    this.whineA.connect(this.whineFilter);
    this.whineB.connect(this.whineFilter);
    this.whineFilter.connect(propeller);
    propeller.connect(this.whineGain);
    this.whineGain.connect(this.engineGain);
    this.whineA.start();
    this.whineB.start();
    this.propellerLfo.start();
  }

  buildEnemyDrone() {
    const c = this.context;
    this.dronePanner = this.createPanner();
    this.dronePanner.rolloffFactor = 0;
    this.dronePanner.connect(this.effectsGain);
    this.droneGain = c.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = c.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 600;
    for (const [frequency, detune] of [[96, 0], [96, 18]]) {
      const oscillator = c.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      oscillator.connect(this.droneFilter);
      oscillator.start();
    }
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.dronePanner);
  }

  createPanner() {
    const panner = this.context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 25;
    panner.maxDistance = 800;
    panner.rolloffFactor = 0.8;
    return panner;
  }

  setPannerPosition(panner, position) {
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
  }

  spatial(position) {
    const c = this.context;
    const panner = this.createPanner();
    this.setPannerPosition(panner, position);
    const distance = Math.hypot(
      position.x - this.listenerPosition.x,
      position.y - this.listenerPosition.y,
      position.z - this.listenerPosition.z
    );
    const muffle = c.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = Math.max(700, 18000 * Math.pow(40 / Math.max(40, distance), 1.1));
    muffle.connect(panner);
    panner.connect(this.effectsGain);
    return muffle;
  }

  updateListener(position, forward, up) {
    if (!this.started) {
      return;
    }
    const listener = this.context.listener;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
    this.listenerPosition = { x: position.x, y: position.y, z: position.z };
  }

  burst(destination, when, { type = "bandpass", frequency, frequencyEnd, q = 1, gain, attack = 0.002, duration, swell = false }) {
    const c = this.context;
    const source = c.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, when);
    if (frequencyEnd) {
      filter.frequency.exponentialRampToValueAtTime(frequencyEnd, when + duration);
    }
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    if (swell) {
      envelope.gain.linearRampToValueAtTime(gain, when + attack);
      envelope.gain.linearRampToValueAtTime(0.0001, when + duration);
    } else {
      envelope.gain.exponentialRampToValueAtTime(gain, when + attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    }
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(when, Math.random() * (NOISE_SECONDS - duration - 0.1), duration + 0.05);
  }

  tone(destination, when, { type = "sine", frequency, frequencyEnd, gain, attack = 0.002, duration }) {
    const c = this.context;
    const oscillator = c.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    if (frequencyEnd) {
      oscillator.frequency.exponentialRampToValueAtTime(frequencyEnd, when + duration);
    }
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(gain, when + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.05);
  }

  updateEngine({ speedRatio, throttle, onGround, climbRate, active }) {
    if (!this.started) {
      return;
    }

    const now = this.context.currentTime;
    const on = active ? 1 : 0;
    const rpm = 0.35 + speedRatio * 0.5 + throttle * 0.15;
    const dive = Math.max(0, -climbRate) / 20;
    const smooth = (param, value, time = 0.08) => param.setTargetAtTime(value, now, time);

    smooth(this.whineA.frequency, 70 + rpm * 150);
    smooth(this.whineB.frequency, 70 + rpm * 150);
    smooth(this.propellerLfo.frequency, 12 + rpm * 28);
    smooth(this.whineFilter.frequency, 500 + rpm * 2200);
    smooth(this.whineGain.gain, on * (0.05 + rpm * 0.07));
    smooth(this.rumble.filter.frequency, 120 + rpm * 300);
    smooth(this.rumble.gain.gain, on * (0.08 + rpm * 0.1));
    smooth(this.wind.filter.frequency, 600 + speedRatio * 1800 + dive * 600);
    smooth(this.wind.gain.gain, on * (speedRatio * speedRatio * 0.22 + dive * 0.12), 0.2);
    smooth(this.groundRoll.gain.gain, on && onGround ? speedRatio * 0.35 : 0);
  }

  updateEnemyDrone(position) {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    if (!position) {
      this.droneGain.gain.setTargetAtTime(0, now, 0.15);
      return;
    }
    this.setPannerPosition(this.dronePanner, position);
    const distance = Math.hypot(
      position.x - this.listenerPosition.x,
      position.y - this.listenerPosition.y,
      position.z - this.listenerPosition.z
    );
    const closeness = Math.max(0, 1 - distance / DRONE_RANGE);
    this.droneGain.gain.setTargetAtTime(closeness * closeness * 0.18, now, 0.1);
    this.droneFilter.frequency.setTargetAtTime(400 + closeness * 900, now, 0.1);
  }

  updateHeartbeat(active) {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    if (!active) {
      this.nextHeartbeat = 0;
      return;
    }
    if (now < this.nextHeartbeat) {
      return;
    }
    this.tone(this.effectsGain, now, { frequency: 62, frequencyEnd: 45, gain: 0.5, duration: 0.12 });
    this.tone(this.effectsGain, now + 0.18, { frequency: 58, frequencyEnd: 42, gain: 0.36, duration: 0.1 });
    this.nextHeartbeat = now + HEARTBEAT_INTERVAL;
  }

  tickMusic() {
    if (!this.started) {
      return;
    }
    this.music.tick();
  }

  playShoot() {
    if (!this.started) {
      return;
    }
    const c = this.context;
    const now = c.currentTime;
    const panner = c.createStereoPanner();
    this.gunSide *= -1;
    panner.pan.value = 0.22 * this.gunSide;
    panner.connect(this.effectsGain);
    const variation = 0.92 + Math.random() * 0.16;
    this.burst(panner, now, { type: "highpass", frequency: 2200 * variation, gain: 0.35, duration: 0.05 });
    this.burst(panner, now, { frequency: 900 * variation, q: 0.8, gain: 0.35, duration: 0.11 });
    this.tone(panner, now, { frequency: 160 * variation, frequencyEnd: 50, gain: 0.4, duration: 0.09 });
  }

  playExplosion(position, size = "small") {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    const scale = size === "large" ? 1.6 : 1;
    const out = position ? this.spatial(position) : this.effectsGain;
    this.burst(out, now, { type: "highpass", frequency: 1600, gain: 0.6 * scale, duration: 0.14 });
    this.burst(out, now, { type: "lowpass", frequency: 1200, frequencyEnd: 180, q: 0.7, gain: 0.9 * scale, duration: 0.9 * scale });
    this.tone(out, now, { frequency: 95, frequencyEnd: 32, gain: 0.8 * scale, duration: 0.7 * scale });
    for (let i = 0; i < Math.round(8 * scale); i += 1) {
      this.burst(out, now + 0.08 + Math.random() * 0.7 * scale, {
        frequency: 2500 + Math.random() * 2500,
        q: 4,
        gain: 0.25,
        duration: 0.02,
      });
    }
  }

  playKill(position) {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    this.playExplosion(position);
    this.tone(this.effectsGain, now, { type: "square", frequency: 1500, frequencyEnd: 1100, gain: 0.1, duration: 0.05 });
    this.tone(this.effectsGain, now + 0.03, { type: "triangle", frequency: 2200, gain: 0.12, duration: 0.09 });
  }

  playHurt() {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    this.burst(this.effectsGain, now, { type: "lowpass", frequency: 500, gain: 1.1, duration: 0.25 });
    this.tone(this.effectsGain, now, { type: "square", frequency: 230, frequencyEnd: 120, gain: 0.28, duration: 0.22 });
    this.burst(this.effectsGain, now + 0.01, { frequency: 2600, q: 6, gain: 0.5, duration: 0.18 });
  }

  playNearMiss(position) {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    const out = this.spatial(position);
    this.burst(out, now, { frequency: 350, frequencyEnd: 1600, q: 0.9, gain: 0.6, attack: 0.28, duration: 0.3, swell: true });
    this.burst(out, now + 0.25, { frequency: 1600, frequencyEnd: 400, q: 0.9, gain: 0.6, attack: 0.03, duration: 0.45, swell: true });
    this.tone(out, now, { type: "sawtooth", frequency: 340, frequencyEnd: 170, gain: 0.08, attack: 0.15, duration: 0.6 });
  }

  playStunt(type, direction) {
    if (!this.started) {
      return;
    }
    const c = this.context;
    const now = c.currentTime;
    if (type === "loop") {
      this.burst(this.effectsGain, now, { frequency: 400, frequencyEnd: 1100, q: 0.9, gain: 0.6, attack: 0.75, duration: 0.8, swell: true });
      this.burst(this.effectsGain, now + 0.75, { frequency: 1100, frequencyEnd: 350, q: 0.9, gain: 0.6, attack: 0.05, duration: 0.85, swell: true });
      return;
    }
    const panner = c.createStereoPanner();
    panner.pan.setValueAtTime(-0.6 * direction, now);
    panner.pan.linearRampToValueAtTime(0.6 * direction, now + 0.7);
    panner.connect(this.effectsGain);
    this.burst(panner, now, { frequency: 300, frequencyEnd: 1400, q: 0.9, gain: 0.8, attack: 0.3, duration: 0.7, swell: true });
  }

  playTrick(combo) {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    const frequency = 660 * Math.pow(2, ((combo - 1) * 2) / 12) * (0.97 + Math.random() * 0.06);
    this.tone(this.effectsGain, now, { frequency, gain: 0.3, duration: 0.22 });
    this.tone(this.effectsGain, now, { type: "triangle", frequency: frequency * 2, gain: 0.1, duration: 0.12 });
    if ((combo === 5 || combo === 8) && combo !== this.lastTrickCombo) {
      [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
        const when = now + 0.1 + index * 0.09;
        this.tone(this.effectsGain, when, { type: "triangle", frequency: note, gain: 0.2, duration: 0.5 });
        this.tone(this.effectsGain, when, { frequency: note * 2, gain: 0.06, duration: 0.35 });
      });
    }
    this.lastTrickCombo = combo;
  }

  playTakeoffReady() {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    this.tone(this.effectsGain, now, { frequency: 784, gain: 0.26, duration: 0.18 });
    this.tone(this.effectsGain, now + 0.08, { frequency: 1175, gain: 0.22, duration: 0.25 });
  }

  playLiftoff() {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    this.burst(this.effectsGain, now, { type: "lowpass", frequency: 200, frequencyEnd: 900, gain: 0.35, attack: 0.3, duration: 0.8, swell: true });
    this.tone(this.effectsGain, now, { frequency: 70, frequencyEnd: 45, gain: 0.4, duration: 0.15 });
    this.burst(this.effectsGain, now + 0.05, { frequency: 1800, q: 5, gain: 0.25, duration: 0.08 });
  }

  playTouchdown() {
    if (!this.started) {
      return;
    }
    const c = this.context;
    const now = c.currentTime;
    [-0.35, 0.35].forEach((pan, index) => {
      const panner = c.createStereoPanner();
      panner.pan.value = pan;
      panner.connect(this.effectsGain);
      this.burst(panner, now + index * 0.07, { frequency: 2000, q: 3, gain: 0.4, duration: 0.14 });
    });
    this.tone(this.effectsGain, now, { frequency: 80, frequencyEnd: 40, gain: 0.55, duration: 0.2 });
    this.burst(this.effectsGain, now, { type: "lowpass", frequency: 300, gain: 0.3, duration: 0.3 });
  }

  playGameOver() {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    [392, 311.13, 261.63, 196].forEach((note, index) => {
      this.tone(this.effectsGain, now + 0.35 + index * 0.22, { type: "triangle", frequency: note, gain: 0.3, duration: 0.5 });
    });
  }

  playClick() {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    this.tone(this.effectsGain, now, { type: "square", frequency: 1300, frequencyEnd: 700, gain: 0.18, duration: 0.035 });
    this.burst(this.effectsGain, now, { type: "highpass", frequency: 3000, gain: 0.18, duration: 0.02 });
  }

  chirp(notes, { type = "square", gain = 0.2, step = 0.08, duration = 0.12 } = {}) {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    notes.forEach((frequency, index) => {
      this.tone(this.effectsGain, now + index * step, { type, frequency, gain, duration });
    });
  }

  playLockTick() {
    this.chirp([1400], { gain: 0.1, duration: 0.04 });
  }

  playLocked() {
    this.chirp([1760, 1760], { gain: 0.16, step: 0.09, duration: 0.07 });
  }

  playDenied() {
    this.chirp([180], { gain: 0.2, duration: 0.12 });
  }

  playMissile() {
    if (!this.started) {
      return;
    }
    const now = this.context.currentTime;
    this.burst(this.effectsGain, now, { type: "bandpass", frequency: 500, frequencyEnd: 2400, q: 1.5, gain: 0.5, attack: 0.02, duration: 0.7 });
    this.tone(this.effectsGain, now, { frequency: 120, frequencyEnd: 50, gain: 0.4, duration: 0.25 });
  }

  playHitMarker() {
    this.chirp([2200], { type: "triangle", gain: 0.16, duration: 0.05 });
  }

  playWarning() {
    this.chirp([880, 660], { gain: 0.14, step: 0.12, duration: 0.1 });
  }

  playWaveStart() {
    this.chirp([392, 523.25, 659.25], { type: "triangle", gain: 0.24, step: 0.12, duration: 0.3 });
  }

  playWaveClear() {
    this.chirp([523.25, 659.25, 783.99, 1046.5], { type: "triangle", gain: 0.24, step: 0.1, duration: 0.35 });
  }

  playRing() {
    this.chirp([987.77, 1318.5], { type: "triangle", gain: 0.2, step: 0.07, duration: 0.2 });
  }

  playRepair() {
    this.chirp([659.25, 783.99, 987.77], { type: "sine", gain: 0.24, step: 0.09, duration: 0.3 });
  }

  playEnemyShot(position) {
    if (!this.started) {
      return;
    }
    this.burst(this.spatial(position), this.context.currentTime, { frequency: 900, frequencyEnd: 300, q: 2, gain: 0.5, duration: 0.12 });
  }
}
