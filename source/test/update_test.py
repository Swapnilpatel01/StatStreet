"""Checks that a newer deployed build replaces the cached one on launch (flat build only).
python3 test/update_test.py iphone-upload"""
import json, re, sys, os, shutil, threading, http.server, socketserver, functools, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mock_espn as mock
from playwright.sync_api import sync_playwright

src = sys.argv[1]
root = tempfile.mkdtemp(); shutil.copytree(src, root, dirs_exist_ok=True)
def set_build(b):
    p = os.path.join(root, 'index.html'); s = open(p).read()
    s = re.sub(r'<meta name="build" content="[^"]+">', f'<meta name="build" content="{b}">', s, count=1); open(p, 'w').write(s)
set_build('A')
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root); h.log_message = lambda *a: None
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
build = lambda page: page.evaluate("document.querySelector('meta[name=build]').content")
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.route(re.compile(r'https://site(\.web)?\.api\.espn\.com/.*'), lambda r: r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(mock.handle(r.request.url))))
    page = ctx.new_page()
    page.goto(url); page.wait_for_function("navigator.serviceWorker.controller", timeout=30000)
    page.wait_for_selector('#boot[hidden]', state='attached', timeout=90000); page.wait_for_timeout(1000)
    print('first launch build:', build(page)); assert build(page) == 'A'
    set_build('B')
    page.reload(); page.wait_for_timeout(300)
    print('served from cache right away:', build(page))
    page.wait_for_function("document.querySelector('meta[name=build]').content === 'B'", timeout=15000)
    print('after background check:', build(page))
    # Resuming a suspended app (no reload) also picks up a new build once it's backgrounded.
    set_build('C'); page.wait_for_timeout(21000)  # check throttle
    page.evaluate("Object.defineProperty(document, 'hidden', {value: false, configurable: true}); document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(1500)
    shown = page.evaluate("!document.querySelector('#updbar').hidden") or build(page) == 'C'
    print('resume detects update (banner or reload):', shown); assert shown
    b.close()
srv.shutdown()
print('update test passed')
