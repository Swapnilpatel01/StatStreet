"""Performance check: a first launch at real-league size (SCALE=1 mock: 30 teams, full rosters),
then the saved account is grown to a long-used one (420-point charts, full inbox, trades) and the
app is reopened under CPU throttling (default 4x, roughly a phone). Prints time to first screen,
time until the update finishes, long tasks, requests, and the functions that used the most time.
python3 test/perf_test.py [outdir] [root]   (THROTTLE=1 for no throttling)"""
import json, re, sys, os, time, threading, http.server, socketserver, functools, collections
os.environ['SCALE'] = '1'
SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SRC + '/test')
import mock_espn as mock
from playwright.sync_api import sync_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, 'test', 'shots', 'perf')
ROOT = sys.argv[2] if len(sys.argv) > 2 else SRC
THROTTLE = float(os.environ.get('THROTTLE', '4'))
os.makedirs(OUT, exist_ok=True)
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); h.log_message = lambda *a: None
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}'
reqs = collections.Counter()
INIT = """
window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
"""
def route(r):
    reqs[re.sub(r'\?.*', '', r.request.url).split('/sports/')[-1][:60]] += 1
    r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(mock.handle(r.request.url)))
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True, service_workers='block')
    ctx.add_init_script(INIT)
    ctx.route(re.compile(r'https://site(\.web)?\.api\.espn\.com/.*'), route)
    ctx.route(re.compile(r'https://(a\.espncdn\.com|.*wiki.*)/.*'), lambda r: r.fulfill(status=404, body=''))
    page = ctx.new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    t0 = time.time(); page.goto(base + '/index.html')
    page.wait_for_selector('#boot[hidden]', state='attached', timeout=300000)
    print(f'first launch sync: {time.time()-t0:.1f}s, requests {sum(reqs.values())}')
    page.wait_for_timeout(1500)
    page.goto(base + '/test/perf_blank.html'); page.wait_for_timeout(1500)
    # Inflate to a long-used account: 420-point price histories over 60 days, full inbox, trades, dividends.
    info = page.evaluate("""async () => {
      const S = await import('/js/store.js');
      const st = await S.loadState();
      const now = Date.now(); const ids = Object.keys(st.assets);
      for (const id of ids) { const a = st.assets[id]; const h = []; let p = a.price || 10;
        for (let i = 0; i < 420; i++) { h.push(now - (420 - i) * 60 * 60e3 / 7 * 3, Math.max(0.5, Math.round(p * 100) / 100)); p *= 1 + (Math.random() - 0.5) * 0.02; }
        a.hist = h; a.events = Array.from({ length: 25 }, (_, i) => ({ t: now - i * 3600e3, kind: 'game', text: 'x', pct: 0.01 })); }
      for (let i = 0; i < 150; i++) st.inbox.push({ t: now - i * 6e5, kind: 'div', text: 'paid you', id: null, seen: true });
      const pl = ids.filter((id) => id.includes(':p:'));
      for (let i = 0; i < 25; i++) st.holdings[pl[i * 7]] = { qty: 0.1, cost: 1, since: now - 9 * 864e5 };
      for (let i = 0; i < 300; i++) st.txns.push({ t: now - i * 36e5, id: pl[i % 50], ticker: 'X', name: 'X', side: 'buy', qty: 0.01, price: 1, total: 0.01, kind: 'stock' });
      for (let i = 0; i < 400; i++) st.divs.push({ t: now - i * 36e5, id: pl[i % 25], ticker: 'X', from: 'X', ps: 0.01, amt: 0.01, reason: 'r' });
      st.nw = []; for (let i = 0; i < 1500; i++) st.nw.push(now - (1500 - i) * 15 * 60e3, 120 + Math.sin(i / 50) * 5);
      await S.saveState(st);
      return { assets: ids.length, players: pl.length, json: JSON.stringify(st).length };
    }""")
    print('state:', info)
    reqs.clear()
    cdp = ctx.new_cdp_session(page)
    if THROTTLE > 1: cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    t0 = time.time(); page.goto(base + '/index.html')
    page.wait_for_selector('[data-nw]', timeout=120000); t_render = time.time() - t0
    # sync finished: badge leaves the "Updating" state
    page.wait_for_function("() => !document.querySelector('.sync')?.textContent.match(/Updating|Syncing|Loading/i)", timeout=300000, polling=100)
    t_sync = time.time() - t0
    page.wait_for_timeout(20000)  # 5 ticks of the tape
    prof = cdp.send('Profiler.stop')['profile']
    lt = page.evaluate('window.__lt')
    print(f'reopen (cpu x{THROTTLE}): first render {t_render:.2f}s, update done {t_sync:.2f}s, requests {sum(reqs.values())}')
    print('long tasks >50ms:', len(lt), 'total', sum(d for _, d in lt), 'ms; worst', sorted(lt, key=lambda x: -x[1])[:8])
    for k, v in reqs.most_common(8): print('  req', v, k)
    # self time per function
    nodes = {n['id']: n for n in prof['nodes']}
    dt = collections.Counter()
    for sid, d in zip(prof['samples'], prof['timeDeltas']): dt[sid] += d
    selft = collections.Counter(); total = collections.Counter()
    parent = {}
    for n in prof['nodes']:
        for c in n.get('children', []): parent[c] = n['id']
    for sid, d in dt.items():
        n = nodes[sid]; cf = n['callFrame']; key = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']+1}"
        selft[key] += d
        seen = set(); x = sid
        while x is not None:
            cf = nodes[x]['callFrame']; k = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']+1}"
            if k not in seen: total[k] += d; seen.add(k)
            x = parent.get(x)
    print('top self time (ms):'); [print(f'  {v/1000:8.0f}  {k}') for k, v in selft.most_common(18)]
    print('top total time (ms):'); [print(f'  {v/1000:8.0f}  {k}') for k, v in total.most_common(40) if 'js' in k or 'html' in k]
    print('errors:', errs[:3])
    json.dump(prof, open(OUT + '/reopen.cpuprofile', 'w'))
