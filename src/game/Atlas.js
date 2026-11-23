const STORAGE_KEY = "vsf.atlas";

// Everything that can be discovered, landmarks first and then the terrain features.
export const DISCOVERY_KINDS = [
  { id: "village", name: "Village" },
  { id: "windmill", name: "Windmill" },
  { id: "windfarm", name: "Windmill Farm" },
  { id: "city", name: "City" },
  { id: "castle", name: "Castle" },
  { id: "lighthouse", name: "Lighthouse" },
  { id: "harbor", name: "Harbour" },
  { id: "pyramid", name: "Pyramid" },
  { id: "tower", name: "Tower" },
  { id: "arch", name: "Rock Arch" },
  { id: "islands", name: "Floating Islands" },
  { id: "bridge", name: "Sea Bridge" },
  { id: "volcano", name: "Volcano" },
  { id: "glacier", name: "Glacier" },
  { id: "canyon", name: "Red Canyon" },
  { id: "oasis", name: "Oasis" },
];

export const kindName = (id) => DISCOVERY_KINDS.find((kind) => kind.id === id)?.name ?? id;

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

// Discoveries are kept per world seed, so every world is a fresh map to explore.
export class Atlas {
  constructor(seed) {
    this.seed = String(seed);
    const saved = readAll()[this.seed];
    this.places = new Set(saved?.places ?? []);
    this.kinds = new Set(saved?.kinds ?? []);
  }

  save() {
    const all = readAll();
    all[this.seed] = { places: [...this.places], kinds: [...this.kinds] };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Without storage the discoveries simply last for this visit.
    }
  }

  has(key) {
    return this.places.has(key);
  }

  // Returns null if the place was already known, otherwise whether its kind is new too.
  discover(key, kind) {
    if (this.places.has(key)) {
      return null;
    }
    this.places.add(key);
    const newKind = !this.kinds.has(kind);
    this.kinds.add(kind);
    this.save();
    return { newKind };
  }

  summary() {
    return {
      places: this.places.size,
      kinds: DISCOVERY_KINDS.map((kind) => ({ ...kind, found: this.kinds.has(kind.id) })),
      found: this.kinds.size,
      total: DISCOVERY_KINDS.length,
    };
  }

  snapshot() {
    return { places: [...this.places], kinds: [...this.kinds] };
  }

  restore(snapshot) {
    this.places = new Set(snapshot.places);
    this.kinds = new Set(snapshot.kinds);
    this.save();
  }
}
