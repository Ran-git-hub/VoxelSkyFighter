"""Dev server for the game: `python3 serve.py`, then open http://localhost:8765/.

Also answers /api/leaderboard with an in-memory stand-in for the Vercel function in
api/leaderboard.js, so the leaderboard can be tried locally. Scores vanish on restart.
"""
import datetime
import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ID_PATTERN = re.compile(r"^[0-9a-f-]{36}$")
NAME_PATTERN = re.compile(r"^[A-Z]+ [A-Z]+ \d{2}$")
board = {}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # ES modules are cached aggressively; without this an edited file keeps serving its old copy.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass

    def send_json(self, body, status=200):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def ranked(self):
        return sorted(board.items(), key=lambda item: -item[1]["score"])

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/api/leaderboard":
            return super().do_GET()
        pilot = parse_qs(url.query).get("id", [None])[0]
        ranked = self.ranked()
        entries = [
            {"rank": index + 1, **{k: v for k, v in entry.items()}, "mine": key == pilot}
            for index, (key, entry) in enumerate(ranked[:10])
        ]
        you = next(({"rank": index + 1, "score": entry["score"]} for index, (key, entry) in enumerate(ranked) if key == pilot), None)
        self.send_json({"entries": entries, "you": you})

    def do_POST(self):
        if urlparse(self.path).path != "/api/leaderboard":
            return self.send_json({"error": "not found"}, 404)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            pilot, name = body["id"], body["name"]
            score, wave, seed = int(body["score"]), int(body["wave"]), int(body["seed"])
        except (ValueError, KeyError, TypeError):
            return self.send_json({"error": "invalid score"}, 400)
        if not ID_PATTERN.match(pilot) or not NAME_PATTERN.match(name) or not 0 < score <= 5000000:
            return self.send_json({"error": "invalid score"}, 400)
        previous = board.get(pilot)
        improved = previous is None or score > previous["score"]
        if improved:
            board[pilot] = {"name": name, "score": score, "wave": wave, "seed": seed, "date": datetime.date.today().isoformat()}
        else:
            previous["name"] = name
        rank = next(index + 1 for index, (key, _) in enumerate(self.ranked()) if key == pilot)
        self.send_json({"improved": improved, "rank": rank})


class Server(ThreadingHTTPServer):
    # The page pulls ~30 modules at once; the default backlog of 5 resets some of those connections.
    request_queue_size = 128


if __name__ == "__main__":
    Server(("127.0.0.1", 8765), Handler).serve_forever()
