"""Browser test: scroll fix, stable order panel, slide-to-confirm, limit orders,
options, index funds, alerts. Runs against mocked ESPN data at iPhone size.
python3 test/browser_test.py [root]"""
import json, re, sys, os, threading, http.server, socketserver, functools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mock_espn as mock
from playwright.sync_api import sync_playwright

ROOT = sys.argv[1] if len(sys.argv) > 1 else mock.ROOT
OUT = os.environ.get('SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots'))
os.makedirs(OUT, exist_ok=True)

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); h.log_message = lambda *a: None
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(('127.0.0.1', 0), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

def slide(page):
    k = page.locator('#slider .knob').bounding_box(); s = page.locator('#slider').bounding_box()
    page.mouse.move(k['x'] + 20, k['y'] + 20); page.mouse.down()
    for i in range(1, 11): page.mouse.move(k['x'] + 20 + (s['width'] - 40) * i / 10, k['y'] + 20)
    page.mouse.up(); page.wait_for_timeout(400)

def toast(page): return page.evaluate("document.querySelector('#toast').textContent")

errors = []
srv = serve()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
    page.route(re.compile(r'https://site(\.web)?\.api\.espn\.com/.*'), lambda r: r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(mock.handle(r.request.url))))
    page.route(re.compile(r'https://a\.espncdn\.com/.*'), lambda r: r.fulfill(status=404, body=''))
    page.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html')
    page.wait_for_selector('#boot[hidden]', state='attached', timeout=60000); page.wait_for_timeout(600)

    # --- funds exist
    page.click('#tabbar [data-tab=market]'); page.click('[data-kind=fund]'); page.wait_for_timeout(200)
    nf = page.locator('#mlist .item').count(); print('funds listed:', nf); assert nf >= 3
    page.screenshot(path=f'{OUT}/1-funds.png')

    # --- player page: vertical swipe starting on the chart scrolls the sheet
    page.click('[data-kind=player]'); page.fill('#q', 'Luka'); page.wait_for_timeout(200)
    page.click('#mlist .item >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/2-detail.png')
    box = page.locator('#dchart svg').bounding_box()
    cdp = ctx.new_cdp_session(page)
    x, y = int(box['x'] + box['width'] / 2), int(box['y'] + box['height'] / 2)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 16):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y - i * 20}]}); page.wait_for_timeout(16)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(500)
    st = page.evaluate("document.querySelector('#sheet').scrollTop"); print('sheet scrollTop after swipe on chart:', st); assert st > 100
    body_locked = page.evaluate("document.body.classList.contains('locked')"); assert body_locked
    y0 = st; page.wait_for_timeout(4500)  # a price tick must not move the scroll position
    st2 = page.evaluate("document.querySelector('#sheet').scrollTop"); print('scrollTop after tick:', st2); assert abs(st2 - y0) < 2
    page.screenshot(path=f'{OUT}/3-detail-scrolled.png')

    # --- order panel: stable across taps and ticks (no rebuild / re-animation)
    page.click('#tradebar [data-act=buy]'); page.wait_for_selector('#trade:not([hidden])'); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('#osum').dataset.mark = 'x'")
    page.click('#panel [data-q="1"]'); page.click('#panel [data-q="1"]'); page.click('#panel [data-qset="50"]')
    page.wait_for_timeout(4500)
    assert page.evaluate("document.querySelector('#osum').dataset.mark") == 'x', 'panel was rebuilt'
    anim = page.evaluate("getComputedStyle(document.querySelector('#panel')).animationName"); print('panel animation after taps:', anim)
    page.screenshot(path=f'{OUT}/4-buy-dollars.png')
    slide(page); t = toast(page); print('toast:', t); assert t.startswith('Bought')
    confetti_ran = page.evaluate("document.querySelector('#confetti').width > 0"); print('confetti on first trade:', confetti_ran)

    # --- limit order
    page.click('#tradebar [data-act=buy]'); page.wait_for_timeout(200)
    page.click('[data-otype2=limit]'); page.wait_for_timeout(100)
    page.screenshot(path=f'{OUT}/5-limit.png')
    slide(page); t = toast(page); print('toast:', t); assert 'Limit order placed' in t
    assert page.locator('#sheet .orderrow, #sheet [data-cancelorder]').count() >= 1

    # --- sell some via shares
    page.click('#tradebar [data-act=sell]'); page.wait_for_timeout(200)
    page.click('[data-qset="0.5"]'); slide(page); t = toast(page); print('toast:', t); assert t.startswith('Sold')

    # --- price alert
    page.click('#sheet [data-act=alert]'); page.wait_for_timeout(200); page.click('[data-act=setalert]'); page.wait_for_timeout(200)
    print('toast:', toast(page)); assert 'Alert set' in toast(page)

    # --- options chain + buy a call
    page.click('#tradebar [data-act=chain]'); page.wait_for_selector('#chain:not([hidden])'); page.wait_for_timeout(300)
    rows = page.locator('#chain [data-strike]').count(); print('strikes:', rows); assert rows >= 9
    page.screenshot(path=f'{OUT}/6-chain.png')
    page.click('#chain [data-strike] >> nth=6'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/7-option-order.png')
    slide(page); t = toast(page); print('toast:', t); assert t.startswith('Bought 1')
    page.click('[data-act=chainback]'); page.wait_for_timeout(300)
    assert page.locator('#sheet [data-optpos]').count() == 1

    # --- index fund buy
    page.click('[data-act=back]'); page.wait_for_timeout(300)
    page.click('#tabbar [data-tab=market]'); page.fill('#q', 'SS500'); page.wait_for_timeout(200)
    page.click('#mlist .item >> nth=0'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/8-fund.png')
    page.click('#tradebar [data-act=buy]'); page.wait_for_timeout(200); slide(page); print('toast:', toast(page)); assert toast(page).startswith('Bought')
    page.click('[data-act=back]'); page.wait_for_timeout(300)

    # --- home & account
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/9-home.png', full_page=True)
    assert page.locator('text=Open orders').count() == 1 and page.locator('#view [data-optpos]').count() == 1
    page.click('#view [data-cancelorder]'); page.wait_for_timeout(200); assert 'canceled' in toast(page)
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(300)
    page.check('#drip', force=True) if False else page.click('label:has(#drip)')
    page.screenshot(path=f'{OUT}/10-account.png', full_page=True)

    # --- persistence
    page.wait_for_timeout(500); page.reload(); page.wait_for_timeout(1500)
    saved = page.evaluate("""(async () => { const db = await new Promise(r => { const q = indexedDB.open('statstreet', 1); q.onsuccess = () => r(q.result); });
        return await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => { const s = g.result; r({h: Object.keys(s.holdings).length, o: Object.keys(s.options).length, a: s.alerts.length, drip: s.settings.drip, funds: Object.keys(s.assets).filter(k => k.startsWith('fund:')).length}); }; }); })()""")
    print('saved after reload:', saved); assert saved['h'] == 2 and saved['o'] == 1 and saved['a'] == 1 and saved['drip'] and saved['funds'] >= 3
    b.close()
srv.shutdown()
if errors: print('JS ERRORS:\n' + '\n'.join(errors)); sys.exit(1)
print('browser test passed')
