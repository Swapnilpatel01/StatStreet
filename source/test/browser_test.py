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

def drag(cdp, page, x, y, dx, dy, steps=12):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'radiusX': 1, 'radiusY': 1}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / steps, 'y': y + dy * i / steps, 'radiusX': 1, 'radiusY': 1}]}); page.wait_for_timeout(16)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); page.wait_for_timeout(450)

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
    cdp = ctx.new_cdp_session(page)

    # --- new installs start with $100; switch to $10,000 via Account for the bigger trades below
    assert '$5.00' in page.text_content('[data-nw]'), page.text_content('[data-nw]')
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(200)
    page.click('[data-startcash="10000"]'); page.click('[data-act=resetpf]'); page.click('[data-act=resetpf]'); page.wait_for_timeout(300)
    print('reset:', toast(page)); assert '10,000' in toast(page)

    # --- Games tab: daily reward, Pick'em, Game Center
    page.click('#tabbar [data-tab=games]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/0a-games.png', full_page=True)
    page.click('[data-act=claim]'); page.wait_for_timeout(200); print('daily:', toast(page)); assert 'daily reward' in toast(page)
    assert page.locator('[data-act=claim]').count() == 0
    assert page.locator('.career .lvl').count() == 1 and page.locator('.goal').count() == 3, 'career header + 3 weekly goals'
    page.screenshot(path=f'{OUT}/0a2-season.png', full_page=True)
    page.click('[data-gtab=pickem]'); page.wait_for_timeout(200)
    npk = page.locator('.pick-btn').count(); print('pick buttons:', npk); assert npk >= 2
    page.click('.pick-btn >> nth=0'); page.wait_for_timeout(200); print('pick:', toast(page)); assert toast(page).startswith('Picked')
    assert page.locator('.pick-btn.on').count() == 1
    page.click('.pg-head [data-game] >> nth=0'); page.wait_for_selector('#game:not([hidden])'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/0b-gamecenter.png')
    assert page.locator('#game .pick-btn.on').count() == 1
    page.click('#game .item[data-open] >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(400)
    assert page.locator('#sheet .rar').count() == 1 and page.locator('#sheet .cardsec').count() == 1
    page.go_back(); page.wait_for_function("document.querySelector('#sheet').hidden"); page.wait_for_timeout(300)
    assert not page.evaluate("document.querySelector('#game').hidden"), 'back from player returns to the game'
    page.click('[data-act=gameback]'); page.wait_for_function("document.querySelector('#game').hidden"); page.wait_for_timeout(300)
    # live game opens the game center too
    if page.locator('#view .game[data-game]').count():
        page.click('#view .game[data-game] >> nth=0'); page.wait_for_selector('#game:not([hidden])'); page.wait_for_timeout(300)
        print('live movers:', page.locator('#game .item[data-open]').count())
        page.screenshot(path=f'{OUT}/0c-live.png')
        print('edge strip:', page.evaluate("[document.querySelector('#edge').hidden, document.elementFromPoint(8, 400)?.id]"))
        page.evaluate("window._ev=[]; for (const t of ['touchstart','touchmove','touchend','pointerdown']) window.addEventListener(t, e => _ev.push(t + ':' + (e.target.id || e.target.className)), true)")
        drag(cdp, page, 8, 400, 330, 0)
        print('events', page.evaluate("[_ev.slice(0,4), _ev.length, document.querySelector('#game').style.transform, history.state]"))
        assert page.evaluate("document.querySelector('#game').hidden"), 'edge swipe closes game center'
    # contests: draft five players and enter
    page.click('#tabbar [data-tab=games]'); page.click('[data-gtab=contests]'); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/0e-contests.png', full_page=True)
    page.click('[data-draft] >> nth=0'); page.wait_for_selector('#draft:not([hidden])'); page.wait_for_timeout(400)
    print('draft rows:', page.evaluate("[...document.querySelectorAll('#dlist .draft-row')].map(x => x.className + ' ' + x.querySelector('.sal').textContent).join(' | ')"), page.text_content('#dhead'))
    for i in range(5):
        page.click('#dlist .draft-row:not(.nofit):not(.on) >> nth=-1'); page.wait_for_timeout(60)
    page.screenshot(path=f'{OUT}/0f-draft.png')
    assert page.locator('#dlist .draft-row.on').count() == 5
    page.click('[data-act=enterdraft]'); page.wait_for_function("document.querySelector('#draft').hidden"); page.wait_for_timeout(300)
    print('contest:', toast(page)); assert "You're in" in toast(page)
    assert page.locator('.contest .stand').count() == 1
    page.screenshot(path=f'{OUT}/0g-contest-live.png', full_page=True)
    page.click('[data-gtab=props]'); page.wait_for_timeout(200)
    nprops = page.locator('.ou').count(); print('prop buttons:', nprops)
    if nprops:
        page.click('.ou >> nth=0'); page.wait_for_timeout(150)
        page.click('[data-stake="1"]'); page.click('[data-act=placebet]'); page.wait_for_timeout(200)
        print('prop:', toast(page)); assert toast(page).startswith('Bet placed')
        page.screenshot(path=f'{OUT}/0h-props.png', full_page=True)
    page.click('[data-gtab=locker]'); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/0i-locker.png', full_page=True)
    assert page.locator('.pack').count() == 4 and page.locator('.theme').count() == 5

    # heatmap
    page.click('#tabbar [data-tab=market]'); page.click('[data-mview=heat]'); page.wait_for_timeout(200)
    nt = page.locator('.heat .tile').count(); print('heat tiles:', nt); assert nt >= 5
    page.screenshot(path=f'{OUT}/0d-heatmap.png')
    page.click('[data-mview=list]'); page.wait_for_timeout(100)

    # --- funds exist
    page.click('#tabbar [data-tab=market]'); page.click('[data-kind=fund]'); page.wait_for_timeout(200)
    nf = page.locator('#mlist .item').count(); print('funds listed:', nf); assert nf >= 3
    page.screenshot(path=f'{OUT}/1-funds.png')

    # --- player page: vertical swipe starting on the chart scrolls the sheet
    page.click('[data-kind=player]'); page.fill('#q', 'Luka'); page.wait_for_timeout(200)
    page.click('#mlist .item >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/2-detail.png')
    box = page.locator('#dchart svg').bounding_box()
    x, y = int(box['x'] + box['width'] / 2), int(box['y'] + box['height'] / 2)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'radiusX': 1, 'radiusY': 1}]})
    for i in range(1, 16):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y - i * 20}]}); page.wait_for_timeout(16)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(500)
    st = page.evaluate("document.querySelector('#sheet').scrollTop"); print('sheet scrollTop after swipe on chart:', st); assert st > 100
    y0 = st; page.wait_for_timeout(4500)  # a price tick must not move the scroll position
    st2 = page.evaluate("document.querySelector('#sheet').scrollTop"); print('scrollTop after tick:', st2); assert abs(st2 - y0) < 2
    page.screenshot(path=f'{OUT}/3-detail-scrolled.png')

    # --- compact bottom bar, page itself never scrolls
    bar_h = page.locator('#tradebar').bounding_box()['height']; print('trade bar height:', bar_h); assert bar_h <= 60
    assert page.evaluate("document.scrollingElement.scrollHeight <= innerHeight + 1")

    # --- swipe down closes the buy sheet
    page.click('#tradebar [data-act=buy]'); page.wait_for_selector('#trade:not([hidden])'); page.wait_for_timeout(400)
    pb = page.locator('#panel .grabber').bounding_box()
    drag(cdp, page, int(pb['x'] + pb['width'] / 2), int(pb['y'] + 5), 0, 420)
    closed = page.evaluate("document.querySelector('#trade').hidden"); print('buy sheet closed by swipe down:', closed); assert closed
    # a small drag snaps back instead
    page.click('#tradebar [data-act=buy]'); page.wait_for_timeout(400)
    pb = page.locator('#panel .grabber').bounding_box()
    drag(cdp, page, int(pb['x'] + pb['width'] / 2), int(pb['y'] + 5), 0, 40)
    assert not page.evaluate("document.querySelector('#trade').hidden"), 'small drag should not close'
    page.click('[data-act=tcancel]'); page.wait_for_timeout(400)

    # --- order panel: stable across taps and ticks (no rebuild / re-animation)
    page.click('#tradebar [data-act=buy]'); page.wait_for_selector('#trade:not([hidden])'); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('#osum').dataset.mark = 'x'")
    page.click('#panel [data-q="1"]'); page.click('#panel [data-q="1"]'); page.click('#panel [data-qset] >> nth=0')
    page.wait_for_timeout(4500)
    assert page.evaluate("document.querySelector('#osum').dataset.mark") == 'x', 'panel was rebuilt'
    anim = page.evaluate("getComputedStyle(document.querySelector('#panel')).animationName"); print('panel animation after taps:', anim)
    page.screenshot(path=f'{OUT}/4-buy-dollars.png')
    slide(page); t = toast(page); print('toast:', t); assert t.startswith('Bought') and 'New card' in t
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
    page.click('[data-act=chainback]'); page.wait_for_function("document.querySelector('#chain').hidden"); page.wait_for_timeout(200)
    assert page.locator('#sheet [data-optpos]').count() == 1

    # --- edge swipe back closes the player page
    drag(cdp, page, 8, 400, 330, 0)
    print('detail closed by edge swipe:', page.evaluate("document.querySelector('#sheet').hidden")); assert page.evaluate("document.querySelector('#sheet').hidden")

    # --- index fund buy
    page.click('#tabbar [data-tab=market]'); page.fill('#q', 'SS500'); page.wait_for_timeout(200)
    page.click('#mlist .item >> nth=0'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/8-fund.png')
    page.click('#tradebar [data-act=buy]'); page.wait_for_timeout(200); slide(page); print('toast:', toast(page)); assert toast(page).startswith('Bought')
    page.click('[data-act=back]'); page.wait_for_timeout(300)

    # --- home & account
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(400)
    drag(cdp, page, 200, 150, 0, 260); page.wait_for_timeout(1500)
    print('pull to refresh:', toast(page)); assert 'up to date' in toast(page) or 'priced in' in toast(page)
    page.screenshot(path=f'{OUT}/9-home.png')
    assert page.locator('text=Open orders').count() == 1 and page.locator('#view [data-optpos]').count() == 1
    page.click('#view [data-cancelorder]'); page.wait_for_timeout(200); assert 'canceled' in toast(page)
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(300)
    page.check('#drip', force=True) if False else page.click('label:has(#drip)')
    page.screenshot(path=f'{OUT}/10-account.png', full_page=True)
    page.click('#tabbar [data-tab=games]'); page.click('[data-gtab=season]'); page.wait_for_timeout(300)
    nt = page.locator('.trophy.got').count()
    page.click('[data-gtab=locker]'); page.wait_for_timeout(200)
    nc = page.locator('.card-grid .pcard').count(); print('cards:', nc, 'trophies:', nt); assert nc >= 1 and nt >= 3
    coins = int(re.sub(r'[^0-9]', '', page.text_content('.coins.big')))
    print('coins earned so far:', coins)
    if coins >= 100:
        page.click('.pack.starter'); page.wait_for_selector('#packview:not([hidden])'); page.wait_for_timeout(300)
        page.click('.pv-card >> nth=0'); page.wait_for_timeout(700)
        page.screenshot(path=f'{OUT}/11-pack.png')
        page.click('[data-act=packdone]'); page.click('[data-act=packdone]'); page.wait_for_timeout(200)
        assert page.evaluate("document.querySelector('#packview').hidden")
    page.click('[data-gtab=season]'); page.wait_for_timeout(200)
    for i, head in enumerate(['Weekly goals', 'Leaderboard']):
        page.evaluate("h => { const el = [...document.querySelectorAll('#view h2')].find(x => x.textContent.startsWith(h)); document.querySelector('#view').scrollTop = el.offsetTop - 60; }", head)
        page.wait_for_timeout(200); page.screenshot(path=f'{OUT}/11-games-{i}.png')
    page.click('[data-gtab=locker]'); page.wait_for_timeout(200)
    page.click('.card-grid .pcard >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(400)
    page.evaluate("document.querySelector('#sheet').scrollTop = document.querySelector('.cardsec').offsetTop - 300"); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/11-card-detail.png')
    page.click('[data-act=back]'); page.wait_for_timeout(400)
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    with page.expect_download() as dl: page.click('[data-act=sharepf]')
    dl.value.save_as(f'{OUT}/12-share.png'); print('share image saved')

    # --- persistence
    page.wait_for_timeout(500); page.reload(); page.wait_for_timeout(1500)
    saved = page.evaluate("""(async () => { const db = await new Promise(r => { const q = indexedDB.open('statstreet', 1); q.onsuccess = () => r(q.result); });
        return await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => { const s = g.result; r({h: Object.keys(s.holdings).length, o: Object.keys(s.options).length, a: s.alerts.length, drip: s.settings.drip, funds: Object.keys(s.assets).filter(k => k.startsWith('fund:')).length}); }; }); })()""")
    print('saved after reload:', saved); assert saved['h'] == 2 and saved['o'] == 1 and saved['a'] == 1 and saved['drip'] and saved['funds'] >= 3

    # --- an older save (old pricing model) upgrades at equal value
    page.wait_for_timeout(3000)
    nw_before = page.evaluate("""(async () => {
        const db = await new Promise(r => { const q = indexedDB.open('statstreet', 1); q.onsuccess = () => r(q.result); });
        const s = await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => r(g.result); });
        s.modelV = 1; s.histV = 1; for (const lg of Object.keys(s.sync)) { delete s.sync[lg].priorV; }
        let nw = s.cash;
        for (const a of Object.values(s.assets)) { if (a.kind === 'fund') continue; a.price = Math.round(a.price * 0.4 * 100) / 100; }
        s._hist.px = s._hist.px.map(x => x * 0.4);
        for (const [id, h] of Object.entries(s.holdings)) nw += (s.assets[id].kind === 'fund' ? s.assets[id].price : s.assets[id].price) * h.qty;
        await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(s, 'state'); t.oncomplete = r; });
        return nw; })()""")
    page.reload(); page.wait_for_timeout(6000)
    nw_after = float(re.sub(r'[^0-9.]', '', page.text_content('[data-nw]')))
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(300)
    note = page.locator('text=New pricing').count()
    print('upgrade: options value dropped from estimate; net worth', round(nw_before, 2), '->', nw_after, 'notice:', note)
    assert note >= 1
    flat = page.evaluate("""(async () => { const db = await new Promise(r => { const q = indexedDB.open('statstreet', 1); q.onsuccess = () => r(q.result); });
        const s = await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => r(g.result); });
        return [s.histV, Math.max(...s._hist.lens.filter((_, i) => !s._hist.ids[i].startsWith('fund:')))]; })()""")
    print('charts restarted (histV, longest player history):', flat); assert flat[0] == 2 and flat[1] < 40

    # --- the one-time $5 fresh start for older saves; cards go when shares are sold
    page.evaluate("""(async () => { const db = await new Promise(r => { const q = indexedDB.open('statstreet', 1); q.onsuccess = () => r(q.result); });
        const s = await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => r(g.result); });
        s.settings.startCashV = 1; s.collection['nba:t:2'] = { first: 1, peak: 50 };
        await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(s, 'state'); t.oncomplete = r; }); })()""")
    page.reload(); page.wait_for_timeout(3000)
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    nw = page.text_content('[data-nw]'); print('after fresh start:', nw); assert nw.strip() == '$5.00'
    page.click('#tabbar [data-tab=games]'); page.click('[data-gtab=locker]'); page.wait_for_timeout(200)
    held_cards = page.locator('.card-grid .pcard').count(); print('cards after reset (pack pulls only):', held_cards)
    assert abs(nw_after - nw_before) / nw_before < 0.05, (nw_before, nw_after)
    b.close()
srv.shutdown()
if errors: print('JS ERRORS:\n' + '\n'.join(errors)); sys.exit(1)
print('browser test passed')
