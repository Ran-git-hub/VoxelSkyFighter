"""Dev server for the game: `python3 serve.py`, then open http://localhost:8765/."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # ES modules are cached aggressively; without this an edited file keeps serving its old copy.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    # The page pulls ~30 modules at once; the default backlog of 5 resets some of those connections.
    request_queue_size = 128


if __name__ == "__main__":
    Server(("127.0.0.1", 8765), Handler).serve_forever()
