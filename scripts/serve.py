# local dev server that tells browsers to always recheck files, so phones and
# the like pick up edits on reload instead of using a cached copy
#
#   python3 scripts/serve.py [port]

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class Server(ThreadingHTTPServer):
    # the page asks for all its modules at once, more than the default queue
    # of 5 waiting connections, and any beyond that get reset
    request_queue_size = 128
    daemon_threads = True


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = Path(__file__).resolve().parent.parent
handler = partial(NoCacheHandler, directory=str(root))
print(f"serving {root} on http://0.0.0.0:{port}")
Server(("", port), handler).serve_forever()
