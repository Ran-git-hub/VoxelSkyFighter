// Global leaderboard on Upstash Redis (REST): every finished run is an entry, and only the
// ten highest survive. Needs KV_REST_API_URL / KV_REST_API_TOKEN from the Upstash integration.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const BOARD = "vsf:board";
const runKey = (id) => `vsf:run:${id}`;
// Before runs had their own entries the board held one best score per pilot, keyed by pilot id.
const legacyKey = (id) => `vsf:pilot:${id}`;
const TOP = 10;
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
  const params = new URL(request.url).searchParams;
  const pilot = params.get("id");
  const run = params.get("run");
  const [top] = await redis([["ZRANGE", BOARD, 0, TOP - 1, "REV", "WITHSCORES"]]);
  const ids = [];
  for (let i = 0; i < top.length; i += 2) {
    ids.push(top[i]);
  }
  const fields = ["name", "wave", "seed", "date", "pilot"];
  const details = ids.length
    ? await redis(ids.flatMap((id) => [["HMGET", runKey(id), ...fields], ["HMGET", legacyKey(id), ...fields]]))
    : [];
  const entries = ids.map((id, index) => {
    const current = details[index * 2];
    const [name, wave, seed, date, owner] = current[0] !== null ? current : details[index * 2 + 1];
    return {
      rank: index + 1,
      name: name ?? "UNKNOWN PILOT",
      score: Number(top[index * 2 + 1]),
      wave: Number(wave ?? 0),
      seed: Number(seed ?? 0),
      date: date ?? "",
      mine: Boolean(pilot) && (owner ?? id) === pilot,
      current: Boolean(run) && id === run,
    };
  });
  return json({ entries });
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

  const [allowed] = await redis([["SET", `vsf:rate:${id}`, "1", "NX", "EX", "3"]]);
  if (allowed === null) {
    return json({ error: "too many submissions" }, 429);
  }
  const run = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  const [, , rank, dropped] = await redis([
    ["ZADD", BOARD, score, run],
    ["HSET", runKey(run), "name", name, "wave", wave, "seed", seed, "date", date, "pilot", id],
    ["ZREVRANK", BOARD, run],
    ["ZRANGE", BOARD, TOP, -1, "REV"],
  ]);
  if (dropped.length) {
    await redis([["ZREM", BOARD, ...dropped], ["DEL", ...dropped.flatMap((gone) => [runKey(gone), legacyKey(gone)])]]);
  }
  return json({ run, rank: rank !== null && rank < TOP ? rank + 1 : null });
}
