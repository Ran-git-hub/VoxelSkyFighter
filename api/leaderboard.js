// Global leaderboard on Upstash Redis (REST), one best score per pilot.
// Needs KV_REST_API_URL / KV_REST_API_TOKEN, which the Upstash integration on Vercel provides.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const BOARD = "vsf:board";
const pilotKey = (id) => `vsf:pilot:${id}`;
const TOP = 10;
const KEEP = 1000;
const ID_PATTERN = /^[0-9a-f-]{36}$/;
const NAME_PATTERN = /^[A-Z]+ [A-Z]+ \d{2}$/;
// Scores are reported by the browser, so these only stop absurd values, not a determined cheat.
const MAX_SCORE = 5000000;
const MAX_WAVE = 999;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function redis(commands) {
  const response = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) {
    throw new Error(`redis ${response.status}`);
  }
  return (await response.json()).map((entry) => {
    if (entry.error) {
      throw new Error(entry.error);
    }
    return entry.result;
  });
}

const configured = () => Boolean(REDIS_URL && REDIS_TOKEN);

export async function GET(request) {
  if (!configured()) {
    return json({ error: "leaderboard storage is not configured" }, 503);
  }
  const id = new URL(request.url).searchParams.get("id");
  const [top] = await redis([["ZRANGE", BOARD, 0, TOP - 1, "REV", "WITHSCORES"]]);
  const ids = [];
  for (let i = 0; i < top.length; i += 2) {
    ids.push(top[i]);
  }
  const lookups = ids.map((pilot) => ["HMGET", pilotKey(pilot), "name", "wave", "seed", "date"]);
  const mine = id && ID_PATTERN.test(id);
  if (mine) {
    lookups.push(["ZREVRANK", BOARD, id], ["ZSCORE", BOARD, id]);
  }
  const results = lookups.length ? await redis(lookups) : [];
  const entries = ids.map((pilot, index) => {
    const [name, wave, seed, date] = results[index];
    return {
      rank: index + 1,
      name: name ?? "UNKNOWN PILOT",
      score: Number(top[index * 2 + 1]),
      wave: Number(wave ?? 0),
      seed: Number(seed ?? 0),
      date: date ?? "",
      mine: pilot === id,
    };
  });
  let you = null;
  if (mine && results[ids.length] !== null) {
    you = { rank: results[ids.length] + 1, score: Number(results[ids.length + 1]) };
  }
  return json({ entries, you });
}

export async function POST(request) {
  if (!configured()) {
    return json({ error: "leaderboard storage is not configured" }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const { id, name } = body;
  const score = Math.floor(Number(body.score));
  const wave = Math.floor(Number(body.wave));
  const seed = Math.floor(Number(body.seed));
  if (
    !ID_PATTERN.test(id ?? "") ||
    !NAME_PATTERN.test(name ?? "") ||
    !(score > 0 && score <= MAX_SCORE) ||
    !(wave >= 0 && wave <= MAX_WAVE) ||
    !(seed >= 0 && seed < 1e9)
  ) {
    return json({ error: "invalid score" }, 400);
  }

  const [allowed, previous] = await redis([
    ["SET", `vsf:rate:${id}`, "1", "NX", "EX", "5"],
    ["ZSCORE", BOARD, id],
  ]);
  if (allowed === null) {
    return json({ error: "too many submissions" }, 429);
  }
  const improved = previous === null || score > Number(previous);
  const commands = [];
  if (improved) {
    const date = new Date().toISOString().slice(0, 10);
    commands.push(
      ["ZADD", BOARD, score, id],
      ["HSET", pilotKey(id), "name", name, "wave", wave, "seed", seed, "date", date],
      ["ZREMRANGEBYRANK", BOARD, 0, -(KEEP + 1)]
    );
  } else {
    commands.push(["HSET", pilotKey(id), "name", name]);
  }
  commands.push(["ZREVRANK", BOARD, id]);
  const results = await redis(commands);
  const rank = results[results.length - 1];
  return json({ improved, rank: rank === null ? null : rank + 1 });
}
