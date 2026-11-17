import { Game } from "./game/Game.js";

const canvas = document.querySelector("#game-canvas");
const hudRoot = document.querySelector("#hud-root");

const game = new Game({ canvas, hudRoot });
game.start();
