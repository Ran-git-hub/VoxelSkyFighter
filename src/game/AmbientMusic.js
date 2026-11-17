const LOOKAHEAD = 1.0;
const FIRST_PIECE_DELAY = 3;
const REVERB_SECONDS = 3.5;
const SEGMENT_BEATS = 8;

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};
const MODE_WEIGHTS = [
  ["ionian", 3],
  ["lydian", 3],
  ["mixolydian", 1],
  ["dorian", 1],
  ["aeolian", 2],
];
const PROGRESSIONS = [
  [0, 3, 5, 3],
  [0, 1, 0, 1],
  [5, 3, 0, 4],
  [0, 2, 3, 0],
  [3, 0, 4, 5],
  [0, 5, 1, 4],
];
const ROOTS = [48, 50, 52, 53, 55, 57];
const RHYTHMS = [0.5, 1, 1, 1.5, 2];
const STEPS = [-2, -1, -1, 0, 1, 1, 2, 3, -3];

const pick = (items) => items[Math.floor(Math.random() * items.length)];
const midiToFrequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function pickWeighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      return value;
    }
  }
  return entries[0][0];
}

export class AmbientMusic {
  constructor(context, destination) {
    this.context = context;
    this.piece = null;
    this.segmentIndex = 0;
    this.cursor = null;
    this.restUntil = null;

    this.bus = context.createGain();
    this.bus.connect(destination);
    const dry = context.createGain();
    dry.gain.value = 0.75;
    const wet = context.createGain();
    wet.gain.value = 0.55;
    const reverb = context.createConvolver();
    reverb.buffer = this.createImpulse();
    this.input = context.createGain();
    this.input.connect(dry);
    this.input.connect(reverb);
    reverb.connect(wet);
    dry.connect(this.bus);
    wet.connect(this.bus);
  }

  createImpulse() {
    const c = this.context;
    const length = Math.floor(c.sampleRate * REVERB_SECONDS);
    const impulse = c.createBuffer(2, length, c.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      let smoothed = 0;
      for (let i = 0; i < length; i += 1) {
        smoothed += ((Math.random() * 2 - 1) - smoothed) * 0.35;
        data[i] = smoothed * Math.pow(1 - i / length, 2.5);
      }
    }
    return impulse;
  }

  compose() {
    const scale = MODES[pickWeighted(MODE_WEIGHTS)];
    const progression = scale === MODES.lydian && Math.random() < 0.6 ? [0, 1, 0, 1] : pick(PROGRESSIONS);
    const repeats = 2 + Math.floor(Math.random() * 2);

    const motif = [];
    let degree = 0;
    let beats = 0;
    const length = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < length && beats < 7; i += 1) {
      degree = Math.max(-3, Math.min(6, degree + pick(STEPS)));
      const duration = pick(RHYTHMS);
      motif.push({ degree, beats: duration, velocity: 0.45 + Math.random() * 0.3 });
      beats += duration;
    }

    return {
      root: pick(ROOTS),
      scale,
      chords: Array.from({ length: repeats }, () => progression).flat(),
      motif,
      beat: 60 / (64 + Math.random() * 12),
      pad: Math.random() < 0.5,
    };
  }

  noteOf(piece, degree) {
    const octave = Math.floor(degree / 7);
    const step = ((degree % 7) + 7) % 7;
    return piece.root + piece.scale[step] + octave * 12;
  }

  tick() {
    const now = this.context.currentTime;
    if (this.cursor === null) {
      this.restUntil = now + FIRST_PIECE_DELAY;
      this.cursor = this.restUntil;
    }

    if (!this.piece) {
      if (now < this.restUntil - LOOKAHEAD) {
        return;
      }
      this.piece = this.compose();
      this.segmentIndex = 0;
      this.cursor = Math.max(this.restUntil, now + 0.1);
    }

    while (this.piece && this.cursor < now + LOOKAHEAD) {
      const last = this.segmentIndex === this.piece.chords.length - 1;
      this.scheduleSegment(this.piece, this.piece.chords[this.segmentIndex], this.cursor, last);
      this.cursor += SEGMENT_BEATS * this.piece.beat;
      this.segmentIndex += 1;
      if (this.segmentIndex >= this.piece.chords.length) {
        this.restUntil = this.cursor + 4 + 18 + Math.random() * 22;
        this.piece = null;
      }
    }
  }

  scheduleSegment(piece, chord, start, last) {
    const beat = piece.beat;
    const at = (beats) => start + beats * beat + (Math.random() - 0.5) * 0.024;
    const chordTones = [0, 2, 4, 6].map((offset) => chord + offset);

    this.piano(this.noteOf(piece, chord) - 12, at(0), 0.5, beat * 6);
    this.piano(this.noteOf(piece, chord + 4) - 12, at(1.5), 0.32, beat * 4);
    if (!last) {
      this.piano(this.noteOf(piece, chord) - 12, at(4), 0.36, beat * 4);
    }

    if (piece.pad) {
      for (const tone of chordTones) {
        this.pad(this.noteOf(piece, tone), start, beat * SEGMENT_BEATS);
      }
    }

    if (last) {
      this.piano(this.noteOf(piece, 7), at(1), 0.5, beat * 7);
      this.piano(this.noteOf(piece, 11), at(2), 0.35, beat * 6);
      return;
    }

    const roll = Math.random();
    if (roll < 0.55) {
      const anchor = 7 + pick(chordTones.slice(0, 3));
      const shift = anchor - piece.motif[0].degree;
      const variedIndex = Math.random() < 0.3 ? Math.floor(Math.random() * piece.motif.length) : -1;
      let offset = pick([0, 0.5, 1, 2]);
      piece.motif.forEach((note, index) => {
        const degree = note.degree + shift + (index === variedIndex ? pick([-1, 1]) : 0);
        this.piano(this.noteOf(piece, degree), at(offset), note.velocity, note.beats * beat * 1.6);
        offset += note.beats;
      });
    } else if (roll < 0.8) {
      const pattern = pick([[0, 1, 2, 3], [0, 1.5, 3, 5], [2, 3, 4, 6]]);
      pattern.forEach((beats, index) => {
        this.piano(this.noteOf(piece, chordTones[index] + 7), at(beats), 0.42 - index * 0.05, beat * 3);
      });
    }

    if (Math.random() < 0.15) {
      this.bell(this.noteOf(piece, chord + 14), at(6));
    }
  }

  piano(midi, when, velocity, duration) {
    const c = this.context;
    const frequency = midiToFrequency(midi);
    const height = Math.max(0, Math.min(1, (midi - 36) / 48));
    const decay = 1.8 + (1 - height) * 2.5;
    const end = when + Math.max(duration, 0.4) + decay;

    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800 + velocity * 2500, when);
    filter.frequency.exponentialRampToValueAtTime(700 + velocity * 600, when + decay);
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(velocity * 0.5, when + 0.008);
    envelope.gain.setTargetAtTime(0.0001, when + 0.008, decay / 4);
    envelope.gain.setTargetAtTime(0.0001, when + duration, 0.25);
    filter.connect(envelope);
    envelope.connect(this.input);

    for (const [multiple, level, type, detune] of [
      [1, 1, "sine", 0],
      [2, 0.35, "sine", 0],
      [3, 0.12, "sine", 0],
      [1, 0.3, "triangle", 3],
    ]) {
      const oscillator = c.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency * multiple;
      oscillator.detune.value = detune;
      const partial = c.createGain();
      partial.gain.value = level;
      oscillator.connect(partial);
      partial.connect(filter);
      oscillator.start(when);
      oscillator.stop(end);
    }
  }

  pad(midi, when, duration) {
    const c = this.context;
    const oscillator = c.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = midiToFrequency(midi);
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1100;
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.linearRampToValueAtTime(0.045, when + 1.5);
    envelope.gain.setValueAtTime(0.045, when + duration - 0.5);
    envelope.gain.linearRampToValueAtTime(0.0001, when + duration + 2);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.input);
    oscillator.start(when);
    oscillator.stop(when + duration + 2.1);
  }

  bell(midi, when) {
    const c = this.context;
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(0.12, when + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + 2.2);
    envelope.connect(this.input);
    for (const [multiple, level] of [[1, 1], [2.76, 0.3]]) {
      const oscillator = c.createOscillator();
      oscillator.frequency.value = midiToFrequency(midi) * multiple;
      const partial = c.createGain();
      partial.gain.value = level;
      oscillator.connect(partial);
      partial.connect(envelope);
      oscillator.start(when);
      oscillator.stop(when + 2.3);
    }
  }
}
