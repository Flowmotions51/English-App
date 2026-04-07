#!/usr/bin/env python3
"""
Serve this directory over HTTP. Use the same as `python3 -m http.server`, but
`GET /js/api-env.js` is generated from the environment variable:

  ENGLISH_APP_API_BASE  e.g. http://127.0.0.1:8080/api

If unset, api-env.js is a no-op and frontend/js/api.js keeps its default (same host, port 8080).

Examples:
  ENGLISH_APP_API_BASE=http://localhost:8080/api python3 serve.py 5173
  python3 serve.py 5173
"""

from __future__ import annotations

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        path_only = self.path.split("?", 1)[0]
        if path_only == "/js/api-env.js":
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(self._api_env_body())
            return
        super().do_GET()

    @staticmethod
    def _api_env_body() -> bytes:
        base = os.environ.get("ENGLISH_APP_API_BASE", "").strip()
        if base:
            return f"window.__ENGLISH_APP_API_BASE__ = {json.dumps(base)};\n".encode("utf-8")
        return b"/* ENGLISH_APP_API_BASE unset; api.js uses default */\n"


def main() -> None:
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    with HTTPServer(("", port), Handler) as httpd:
        env = os.environ.get("ENGLISH_APP_API_BASE", "")
        print(f"Serving http://0.0.0.0:{port}/  ENGLISH_APP_API_BASE={env!r}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
