"""Dev server for the game: `python3 serve.py`, then open http://localhost:8765/.

Also answers /api/leaderboard with an in-memory stand-in for the Vercel function in
api/leaderboard.js (every run is an entry, top ten kept). Scores vanish on restart.
"""
import datetime
import json
import re
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ID_PATTERN = re.compile(r"^[0-9a-f-]{36}$")
NAME_PATTERN = re.compile(r"^[A-Z]+ [A-Z]+ \d{2}$")
board = []


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

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/api/leaderboard":
            return super().do_GET()
        query = parse_qs(url.query)
        pilot = query.get("id", [None])[0]
        run = query.get("run", [None])[0]
        entries = [
            {**{k: v for k, v in entry.items() if k not in ("run", "pilot")}, "rank": index + 1,
             "mine": entry["pilot"] == pilot, "current": entry["run"] == run}
            for index, entry in enumerate(board)
        ]
        self.send_json({"entries": entries})

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
        run = str(uuid.uuid4())
        board.append({"run": run, "pilot": pilot, "name": name, "score": score, "wave": wave, "seed": seed,
                      "date": datetime.date.today().isoformat()})
        board.sort(key=lambda entry: -entry["score"])
        del board[10:]
        rank = next((index + 1 for index, entry in enumerate(board) if entry["run"] == run), None)
        self.send_json({"run": run, "rank": rank})


class Server(ThreadingHTTPServer):
    # The page pulls ~30 modules at once; the default backlog of 5 resets some of those connections.
    request_queue_size = 128


if __name__ == "__main__":
    Server(("127.0.0.1", 8765), Handler).serve_forever()
