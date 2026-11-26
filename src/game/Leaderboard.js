const ENDPOINT = "/api/leaderboard";
const PILOT_KEY = "vsf.pilot";
const LOCAL_KEY = "vsf.localBoard";
const LOCAL_SIZE = 10;

const ADJECTIVES = [
  "IRON", "SILVER", "CRIMSON", "SWIFT", "THUNDER", "SHADOW", "BLAZING", "ARCTIC", "NEON", "COBALT",
  "GOLDEN", "ROGUE", "STORM", "LUCKY", "TURBO", "PIXEL", "SONIC", "SCARLET", "JADE", "ROCKET",
];
const NOUNS = [
  "FALCON", "HAWK", "EAGLE", "VIPER", "COMET", "RAVEN", "MAVERICK", "PHOENIX", "GHOST", "ACE",
  "BARON", "HORNET", "KESTREL", "COBRA", "SPARROW", "WOLF", "DRAGON", "OWL", "LANCER", "JET",
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function randomPilotName() {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the pilot simply gets a fresh identity next visit.
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function randomUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Every finished run is sent to the serverless endpoint, which keeps the ten best. When it is
// missing or unreachable the board falls back to this browser's own ten best runs.
export class Leaderboard {
  constructor() {
    this.pilot = readJson(PILOT_KEY, null);
    if (!this.pilot?.id || !this.pilot?.name) {
      this.pilot = { id: randomUuid(), name: randomPilotName() };
      writeJson(PILOT_KEY, this.pilot);
    }
    this.online = null;
    this.entries = [];
    this.lastRun = null;
    this.loading = false;
    this.onChange = null;
  }

  rename() {
    this.pilot.name = randomPilotName();
    writeJson(PILOT_KEY, this.pilot);
    this.changed();
  }

  changed() {
    this.onChange?.();
  }

  async refresh() {
    this.loading = true;
    this.changed();
    try {
      const query = new URLSearchParams({ id: this.pilot.id });
      if (this.lastRun) {
        query.set("run", this.lastRun);
      }
      const response = await fetch(`${ENDPOINT}?${query}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      this.entries = (await response.json()).entries;
      this.online = true;
    } catch {
      this.useLocal();
    }
    this.loading = false;
    this.changed();
  }

  useLocal() {
    this.online = false;
    this.entries = readJson(LOCAL_KEY, []).map((entry, index) => ({
      ...entry,
      rank: index + 1,
      mine: entry.pilot === this.pilot.id,
      current: entry.run === this.lastRun,
    }));
  }

  // Returns the rank this run earned on the local top ten, or null if it fell off.
  saveLocal({ run, score, wave, seed }) {
    const board = readJson(LOCAL_KEY, []);
    board.push({ run, pilot: this.pilot.id, name: this.pilot.name, score, wave, seed, date: today() });
    board.sort((a, b) => b.score - a.score);
    const kept = board.slice(0, LOCAL_SIZE);
    writeJson(LOCAL_KEY, kept);
    const index = kept.findIndex((entry) => entry.run === run);
    return index < 0 ? null : index + 1;
  }

  // Returns { rank } once the server (or the local fallback) has answered; rank is null
  // when the run did not make the top ten.
  async submit({ score, wave, seed }) {
    if (score <= 0) {
      return { rank: null };
    }
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: this.pilot.id, name: this.pilot.name, score, wave, seed }),
      });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      const result = await response.json();
      this.lastRun = result.run;
      await this.refresh();
      return { rank: result.rank };
    } catch {
      this.lastRun = randomUuid();
      const rank = this.saveLocal({ run: this.lastRun, score, wave, seed });
      this.useLocal();
      this.changed();
      return { rank };
    }
  }
}
