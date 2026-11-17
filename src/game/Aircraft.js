// Flight numbers per plane. Standard keeps the original handling and the others sit around it:
// speed and turn scale the base flight model, armor is hearts, missiles is the rack size.
// unlock is the career score (all mission scores added up) that opens the plane.
export const AIRCRAFT = [
  { id: "standard", name: "Standard", speed: 1, turn: 1, armor: 5, missiles: 4, unlock: 0 },
  { id: "brickbiplane", name: "Brick Biplane", speed: 0.78, turn: 1.4, armor: 4, missiles: 2, unlock: 0 },
  { id: "mario", name: "Super Mario", speed: 0.88, turn: 1.25, armor: 5, missiles: 3, unlock: 0 },
  { id: "airshow", name: "Air Show", speed: 1.05, turn: 1.32, armor: 3, missiles: 2, unlock: 5000 },
  { id: "brickseaplane", name: "Brick Seaplane", speed: 0.86, turn: 1, armor: 6, missiles: 3, unlock: 10000 },
  { id: "f16", name: "F-16 Style", speed: 1.2, turn: 0.92, armor: 4, missiles: 6, unlock: 20000 },
  { id: "brickjet", name: "Brick Jet", speed: 1.26, turn: 0.96, armor: 4, missiles: 5, unlock: 35000 },
  { id: "brickairliner", name: "Brick Airliner", speed: 0.96, turn: 0.66, armor: 8, missiles: 3, unlock: 50000 },
  { id: "brickstorm", name: "Brick Storm", speed: 0.92, turn: 0.78, armor: 7, missiles: 6, unlock: 75000 },
];

export const aircraftById = (id) => AIRCRAFT.find((plane) => plane.id === id) ?? AIRCRAFT[0];

// Ranges for the hangar comparison bars.
export const STAT_RANGES = {
  speed: [0.7, 1.3],
  turn: [0.6, 1.45],
  armor: [2, 8],
  missiles: [1, 6],
};

export const DIFFICULTY = {
  easy: { label: "Easy", enemies: 0.7, fire: 1.35, spread: 0.07, armor: 2, score: 0.8 },
  normal: { label: "Normal", enemies: 1, fire: 1, spread: 0.02, armor: 0, score: 1 },
  hard: { label: "Hard", enemies: 1.35, fire: 0.8, spread: 0.012, armor: -1, score: 1.3 },
};
