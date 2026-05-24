#!/usr/bin/env python3
"""
Example HTTP bridge: Bloomberg Terminal (blpapi) -> JSON for Antigravity Next.js.

Prerequisites (Bloomberg customers only):
  - Active Bloomberg Terminal or approved API access
  - Bloomberg's Python blpapi package (from Bloomberg SDK / WAPI<GO> instructions)
  - pip install flask (or use uv)

Run:
  export BRIDGE_SECRET=your-shared-secret   # optional; must match BLOOMBERG_BRIDGE_SECRET
  python scripts/bloomberg-bridge-example.py

Antigravity .env.local:
  BLOOMBERG_BRIDGE_URL=http://127.0.0.1:8099
  BLOOMBERG_BRIDGE_SECRET=your-shared-secret

Legal: You must comply with the Bloomberg Terminal Agreement and any Data License.
      Do not expose this service to the public internet without Bloomberg approval.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# Uncomment when blpapi is installed from Bloomberg:
# import blpapi

PORT = int(os.environ.get("BLOOMBERG_BRIDGE_PORT", "8099"))
SECRET = os.environ.get("BRIDGE_SECRET", "").strip()


def sec_for_ticker(t: str) -> str:
    u = t.strip().upper()
    if u == "^VIX" or u == "VIX":
        return "VIX Index"
    if u.startswith("^"):
        return f"{u[1:]} Index"
    return u.replace(".", "/") + " US Equity"


def fetch_bloomberg_fields(securities: list[str]) -> list[dict]:
    """
    Replace this stub with real blpapi RefDataRequest.
    Pseudocode:

      session = blpapi.Session()
      session.start()
      refDataService = session.getService("//blp/refdata")
      request = refDataService.createRequest("ReferenceDataRequest")
      for s in securities:
          request.append("securities", s)
      for f in ["PX_LAST", "PX_BID", "PX_ASK", "VOLUME", "TURNOVER",
                "HIGH_52WEEK", "LOW_52WEEK", "PE_RATIO", "CUR_MKT_CAP"]:
          request.append("fields", f)
      session.sendRequest(request)
      # ... loop events, parse response into rows ...
    """
    print("[bridge] STUB: install blpapi and implement fetch_bloomberg_fields()", file=sys.stderr)
    return []


class Handler(BaseHTTPRequestHandler):
    def _auth_ok(self) -> bool:
        if not SECRET:
            return True
        provided = self.headers.get("X-Bridge-Secret") or ""
        return hmac.compare_digest(provided.encode("utf-8"), SECRET.encode("utf-8"))

    def do_GET(self):
        p = urlparse(self.path)
        if p.path != "/health":
            self.send_error(404)
            return
        if not self._auth_ok():
            self.send_error(401)
            return
        body = json.dumps({"ok": True, "service": "bloomberg-bridge-stub"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        p = urlparse(self.path)
        if p.path != "/quotes":
            self.send_error(404)
            return
        if not self._auth_ok():
            self.send_error(401)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            self.send_error(400)
            return
        tickers = payload.get("tickers") or []
        if not isinstance(tickers, list):
            self.send_error(400)
            return
        securities = [sec_for_ticker(str(t)) for t in tickers]
        rows = fetch_bloomberg_fields(securities)
        # When wired to blpapi, map each security to { symbol, last, ... }
        out = {"quotes": rows, "note": "stub — implement blpapi in fetch_bloomberg_fields"}
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("[bridge]", format % args)


def main():
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Bloomberg bridge stub on http://127.0.0.1:{PORT} (POST /quotes, GET /health)")
    server.serve_forever()


if __name__ == "__main__":
    main()
