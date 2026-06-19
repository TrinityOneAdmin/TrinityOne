#!/usr/bin/env python3
# TrinityOne static host -- threaded so a few phones can load at once.
import os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"TrinityOne web on http://0.0.0.0:{port}", flush=True)
ThreadingHTTPServer(('0.0.0.0', port), SimpleHTTPRequestHandler).serve_forever()
