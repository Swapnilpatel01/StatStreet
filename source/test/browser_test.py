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

def toast(page):
    t = page.evaluate("document.querySelector('#toast').textContent")
    # a filled market order shows a confirmation screen; check it, then dismiss it
    if page.locator('#confirm:not([hidden])').count():
        txt = page.text_content('#confirm'); assert 'Order filled' in txt and 'Cash left' in txt, txt
        page.screenshot(path=f'{OUT}/50-confirm.png')
        page.click('#confirm [data-act=confirmdone]'); page.wait_for_timeout(150)
    return t

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
    assert page.locator('.gtabs .chip.on[data-gtab=pickem]').count() == 1
    page.click('[data-gtab=season]'); page.wait_for_timeout(200)
    page.click('[data-act=claim]'); page.wait_for_timeout(200); print('daily:', toast(page)); assert 'daily reward' in toast(page)
    assert page.locator('[data-act=claim]').count() == 0
    assert page.locator('.career .lvl').count() == 1 and page.locator('.goal').count() == 3, 'career header + 3 weekly goals'
    page.screenshot(path=f'{OUT}/0a2-season.png', full_page=True)
    page.click('[data-gtab=pickem]'); page.wait_for_timeout(900)
    assert page.locator('.daystrip .dayb').count() == 12 and page.locator('.dayb.on.today').count() == 1
    for L in ['nfl', 'mlb', 'nba']:
        page.click(f'[data-sleague={L}]'); page.wait_for_timeout(900)
        print('scores', L, page.locator('.sgames > *').count(), 'cards', page.locator('.pick-btn').count(), 'pick buttons')
        page.screenshot(path=f'{OUT}/70-scores-{L}.png')
        if page.locator('.pick-btn').count() >= 2: break
    sg = page.locator('.sgame').first
    if sg.count():
        sg.click(); page.wait_for_selector('#game:not([hidden])'); page.wait_for_timeout(1500)
        for k in ['props', 'away', 'home']:
            page.click(f'#game [data-gview={k}]'); page.wait_for_timeout(250)
            assert page.locator(f'#game .gsec[data-gsec={k}]').is_visible()
            page.screenshot(path=f'{OUT}/71-game-{k}.png')
        print('team tab rows:', page.locator('#game .gsec[data-gsec=home] .item').count())
        print('box rows:', page.locator('#game .gsec[data-gsec=home] .box tr[data-open]').count()); assert page.locator('#game .gsec[data-gsec=home] .box tr[data-open]').count() >= 1
        page.screenshot(path=f'{OUT}/79-box.png')
        page.click('#game [data-gview=summary]'); page.wait_for_timeout(200); assert page.locator('#game .tops .top').count() >= 1; page.screenshot(path=f'{OUT}/80-top.png')
        m_ = __import__('re').search(r'.{40}\d\.\d{4,}.{10}', page.inner_text('#game')); assert not m_, m_.group(0)
        page.click('#game [data-act=gameback]'); page.wait_for_timeout(400)
    page.click('.daystrip .dayb >> nth=2'); page.wait_for_timeout(900); page.screenshot(path=f'{OUT}/72-scores-yday.png')
    sw = """(dx) => { const el = document.querySelector('#view .pkline'); const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(200)], changedTouches: [mk(200)] }));
        el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [mk(200 + dx)], changedTouches: [mk(200 + dx)] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(200 + dx)] })); }"""
    idx = lambda: page.evaluate("[...document.querySelectorAll('.dayb')].findIndex(x => x.classList.contains('on'))")
    assert idx() == 2; page.evaluate(sw, -120); page.wait_for_timeout(700); assert idx() == 3, 'swipe left: next day'
    page.evaluate(sw, 120); page.wait_for_timeout(700); page.evaluate(sw, 120); page.wait_for_timeout(700); assert idx() == 1, 'swipe right: previous day'
    print('day swipe ok')
    page.click('.dayb.today'); page.wait_for_timeout(600)
    if page.locator('.pkline [data-sday]').count(): page.click('.pkline [data-sday]'); page.wait_for_timeout(900); page.screenshot(path=f'{OUT}/75-scores-pick.png')
    npk = page.locator('.pick-btn').count(); print('pick buttons:', npk); assert npk >= 2
    page.click('.pick-btn >> nth=0'); page.wait_for_timeout(200); print('pick:', toast(page)); assert toast(page).startswith('Picked')
    assert page.locator('.pick-btn.on').count() == 1
    page.click('.pg-head [data-game] >> nth=0'); page.wait_for_selector('#game:not([hidden])'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/0b-gamecenter.png')
    assert page.locator('#game .pick-btn.on').count() == 1
    page.click('#game [data-gview=props]'); page.wait_for_timeout(300); page.screenshot(path=f'{OUT}/73-game-props-pre.png')
    np_ = page.locator('#game [data-prop]').count(); print('game props:', np_)
    if np_:
        page.click('#game [data-prop] >> nth=0'); page.wait_for_timeout(300); assert page.locator('#game .ou.on').count() == 1
        assert page.locator('#game .sliptab').count() == 1 and page.locator('#game .slip.dock').count() == 0
        page.click('#game [data-prop] >> nth=2'); page.wait_for_timeout(300); assert page.locator('#game .ou.on').count() == 2, 'two picks in one bet'
        page.screenshot(path=f'{OUT}/78-sliptab.png')
        gap = page.evaluate("(() => { const g = document.querySelector('#game'); g.scrollTop = 0; const r = document.querySelector('#game .sliptab').getBoundingClientRect(); return [innerHeight - r.bottom, g.scrollHeight - g.clientHeight]; })()")
        print('slip tab gap from bottom, scrollable:', gap); assert gap[0] <= 16
        page.click('#game .sliptab'); page.wait_for_timeout(300); assert page.locator('#game .slip.dock .slip-leg').count() == 2
        page.click('#game [data-act=slipclose]'); page.wait_for_timeout(200); assert page.locator('#game .sliptab').count() == 1
        page.click('#game .sliptab'); page.wait_for_timeout(300)
        page.fill('#game #stake', '5'); page.wait_for_timeout(150); assert '18.05' in page.text_content('#game #slippay')
        page.screenshot(path=f'{OUT}/77-game-slip.png')
        page.click('#game [data-act=placebet]'); page.wait_for_timeout(300); print('in-game bet:', toast(page)); assert toast(page).startswith('Bet placed')
        assert not page.evaluate("document.querySelector('#game').hidden") and 'Your bets on this game' in page.text_content('#game')
    page.click('#game [data-gview=away]'); page.wait_for_timeout(200); page.screenshot(path=f'{OUT}/74-game-team-pre.png')
    assert page.locator('#game .gsec[data-gsec=away] .formdot').count() >= 1
    page.click('#game [data-gview=summary]'); page.wait_for_timeout(200)
    page.click('#game .gsec[data-gsec=summary] .item[data-open] >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(400)
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
    page.click('#tabbar [data-tab=games]'); page.wait_for_timeout(500); page.click('[data-gtab=contests]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/0e-contests.png', full_page=True)
    print('gtab now:', page.evaluate("document.querySelector('.gtabs .chip.on')?.dataset.gtab"))
    if page.locator('[data-draft]').count():
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
    else: print('contests closed at this time of week: draft test skipped')
    page.click('[data-gtab=props]'); page.wait_for_timeout(200)
    nprops = page.locator('.ou').count(); print('prop buttons:', nprops)
    if nprops:
        page.click('.ou >> nth=0'); page.wait_for_timeout(150)
        assert page.locator('#view .sliptab').count() == 1; page.click('#view .sliptab'); page.wait_for_timeout(200)
        page.click('[data-stake="1"]'); page.click('[data-act=placebet]'); page.wait_for_timeout(200)
        print('prop:', toast(page)); assert toast(page).startswith('Bet placed')
        page.screenshot(path=f'{OUT}/0h-props.png', full_page=True)
        if page.locator('[data-page=bets]').count():
            page.click('[data-page=bets]'); page.wait_for_selector('#page:not([hidden])'); page.wait_for_timeout(300)
            assert 'Bet history' in page.text_content('#page'); page.screenshot(path=f'{OUT}/81-bets.png'); page.click('#page [data-act=pageback]'); page.wait_for_timeout(400)
    page.click('[data-gtab=locker]'); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/0i-locker.png', full_page=True)
    assert page.locator('.pack').count() == 4 and page.locator('.theme').count() == 5

    # chips keep their sideways scroll when one is tapped; the top strip scrolls to the top
    page.click('#tabbar [data-tab=market]'); page.wait_for_timeout(300)
    row = page.evaluate("(() => { const el = [...document.querySelectorAll('#view .chips')].find(e => e.scrollWidth > e.clientWidth + 40); if (!el) return null; el.scrollLeft = 120; const b = [...el.querySelectorAll('button')].pop(); b.click(); return [...document.querySelectorAll('#view .chips')].map(e => e.scrollLeft); })()")
    print('chip rows after tap:', row); assert row is None or max(row) >= 100
    page.evaluate("(() => { document.documentElement.style.setProperty('--safe-t', '44px'); document.querySelector('#view').scrollTop = 600; })()"); page.wait_for_timeout(100)
    page.mouse.click(200, 10); page.wait_for_timeout(900)
    yt = page.evaluate("document.querySelector('#view').scrollTop"); print('after top tap:', yt); assert yt < 20
    page.evaluate("document.documentElement.style.removeProperty('--safe-t')")
    page.evaluate("(() => { const b = document.querySelector('#view .chips [data-sort]'); b && b.click(); })()"); page.wait_for_timeout(200)
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
    page.click('[data-kind=player]'); page.wait_for_timeout(200)
    nt = page.locator('.trend').count(); print('trending cards:', nt); assert nt >= 3
    page.screenshot(path=f'{OUT}/1b-stocks-trending.png')
    page.click('[data-price="25-100"]'); page.wait_for_timeout(200)
    prices = page.evaluate("[...document.querySelectorAll('#mlist .item .price')].map(e => parseFloat(e.textContent.replace(/[^0-9.]/g, '')))")
    print('prices in $25-100 band:', prices); assert prices and all(25 <= p < 100 for p in prices)
    page.click('[data-price="any"]'); page.wait_for_timeout(100)
    page.fill('#q', 'Luka'); page.wait_for_timeout(200)
    page.click('#mlist .item >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/2-detail.png')
    print('game dots on 1D:', page.locator('#dchart .gdot').count())
    page.click('#sheet .ranges [data-range="1W"]'); page.wait_for_timeout(500); nd = page.locator('#dchart .gdot').count(); print('game dots on 1W:', nd); assert nd >= 1
    page.screenshot(path=f'{OUT}/83-chart-dots.png'); page.click('#sheet .ranges [data-range="1D"]'); page.wait_for_timeout(400)
    assert page.locator('#sheet .research').count() == 1 and page.locator('#sheet .rs-tiles > div').count() == 3
    page.evaluate("document.querySelector('#sheet').scrollTop = document.querySelector('.research').offsetTop - 120"); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/2b-research.png'); page.evaluate("document.querySelector('#sheet').scrollTop = 0"); page.wait_for_timeout(200)
    box = None
    for _ in range(8):
        box = page.locator('#dchart svg').bounding_box()
        if box: break
        page.wait_for_timeout(120)
    if not box: print('dchart html:', page.evaluate("[document.querySelector('#dchart')?.innerHTML.slice(0,200), document.querySelector('#dchart')?.getBoundingClientRect().height]"))
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
    page.click('#tradebar [data-act=buy]'); page.wait_for_timeout(200); slide(page); t = toast(page); print('toast:', t); assert t.startswith('Bought')
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
    if coins >= 20000:
        page.click('.pack.mstarter'); page.wait_for_selector('#packview:not([hidden])'); page.wait_for_timeout(300)
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

    # --- booster cards: open a pack, boost a stock, buy from the market, auction one
    page.evaluate("""(async () => { const db = await new Promise(r => { const q = indexedDB.open('statstreet', 1); q.onsuccess = () => r(q.result); });
        const s = await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => r(g.result); });
        s.cash = 500000;
        await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(s, 'state'); t.oncomplete = r; }); })()""")
    page.reload(); page.wait_for_timeout(2500)
    page.click('#tabbar [data-tab=games]'); page.click('[data-gtab=locker]'); page.wait_for_timeout(200)
    page.click('[data-bpack=mstarter]'); page.wait_for_selector('#packview:not([hidden])'); page.wait_for_timeout(200)
    page.click('[data-act=packdone]'); page.wait_for_timeout(700)
    page.screenshot(path=f'{OUT}/13-moment-pack.png')
    page.click('[data-act=packdone]'); page.wait_for_timeout(200)
    nb = page.locator('.mc-cell[data-booster]').count(); print('moment cards in locker:', nb); assert nb in (3, 6)
    page.screenshot(path=f'{OUT}/13b-locker-cards.png', full_page=True)
    page.click('.mc-cell[data-booster] >> nth=0'); page.wait_for_selector('#trade:not([hidden])'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/14-card-sheet.png')
    page.click('[data-blen="1h"]'); page.fill('#bstart', '1'); page.click('[data-act=blist]'); page.wait_for_timeout(200)
    print('auction:', toast(page)); assert toast(page).startswith('Listed')
    # Marketplace tab
    page.click('#tabbar [data-tab=marketplace]'); page.wait_for_timeout(300)
    lots = page.locator('.mp-item').count(); print('marketplace lots:', lots); assert lots >= 2
    page.screenshot(path=f'{OUT}/15-marketplace.png')
    page.screenshot(path=f'{OUT}/15b-marketplace-full.png', full_page=True)
    page.click('[data-bidbtn] >> nth=0'); page.wait_for_selector('#trade:not([hidden])'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/15c-bid.png')
    page.fill('#bidamt', '90000'); page.click('[data-act=placebid]'); page.wait_for_timeout(300)
    print('bid:', toast(page), page.text_content('#terr') if page.locator('#terr').count() else '')
    if not page.evaluate("document.querySelector('#trade').hidden"): page.click('[data-act=tcancel]'); page.wait_for_timeout(300)
    page.click('[data-act=mymarket]'); page.wait_for_timeout(200)
    assert page.locator('text=Your listings').count() == 1
    page.screenshot(path=f'{OUT}/15d-my-market.png', full_page=True)
    page.click('[data-act=mymarket]'); page.wait_for_timeout(200)
    page.click('.mp-cardbtn >> nth=1'); page.wait_for_selector('#trade:not([hidden])'); page.click('[data-act=buynow]'); page.click('[data-act=buynow]'); page.wait_for_timeout(300)
    print('buy now:', toast(page)); assert toast(page).startswith('Bought for')
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(200)
    page.click('#view [data-open^="nba:p"] >> nth=0'); page.wait_for_selector('#sheet:not([hidden])'); page.wait_for_timeout(300)
    print('player page card slot:', page.locator('#sheet .bslot').count()); assert page.locator('#sheet .bslot').count() == 1
    page.evaluate("document.querySelector('#sheet').scrollTop = document.querySelector('.bslot').offsetTop - 300"); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/16-player-boost.png')
    page.click('[data-act=back]'); page.wait_for_timeout(400)

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
    # --- v34 features
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(400)
    assert page.locator('.tools [data-page]').count() == 12
    page.screenshot(path=f'{OUT}/20-home.png', full_page=False)
    page.evaluate("document.querySelector('.tools').scrollIntoView()"); page.wait_for_timeout(200)
    page.screenshot(path=f'{OUT}/20b-home-tools.png')
    page.click('.topbar [data-page=search]'); page.wait_for_timeout(500)
    page.fill('#pageq', 'do'); page.wait_for_timeout(200)
    assert page.locator('#pageres .item').count() >= 1, 'search finds something'
    assert page.evaluate("document.activeElement.id") == 'pageq', 'typing keeps focus'
    page.screenshot(path=f'{OUT}/21-search.png')
    page.click('#page [data-act=pageback]'); page.wait_for_timeout(150); assert not page.locator('#page').is_visible()
    for k in ['calendar', 'journal', 'achievements']:
        page.evaluate(f"document.querySelector('.tools [data-page={k}]').click()"); page.wait_for_timeout(450)
        assert page.locator('#page').is_visible(), k
        page.screenshot(path=f'{OUT}/22-{k}.png')
        page.click('#page [data-act=pageback]'); page.wait_for_timeout(150)
    # player page: tabs, compare
    page.click('#tabbar [data-tab=market]'); page.wait_for_timeout(300)
    page.locator('#view .item[data-open^="nba:p:"]').first.click(); page.wait_for_timeout(600)
    assert page.locator('.dtabs button').count() == 4
    assert page.locator('#dinner .research, #dinner .rs-tiles').first.is_hidden() if page.locator('#dinner .rs-tiles').count() else True
    page.click('.dtabs [data-dtab=research]'); page.wait_for_timeout(150)
    page.screenshot(path=f'{OUT}/23-tab-research.png')
    assert page.locator('#dinner .dsec[data-sec=overview]').first.is_hidden() and page.locator('#dinner .dsec[data-sec=research]').first.is_visible()
    page.click('.dtabs [data-dtab=overview]'); page.wait_for_timeout(100)
    page.click('#sheet [data-act=watch]'); page.wait_for_timeout(300)
    if page.locator('#wnote').count() == 0: page.click('#sheet [data-act=watch]'); page.wait_for_timeout(300)
    page.fill('#wfnew', 'Rookies'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    page.fill('#wnote', 'Buy under $20'); page.locator('#wnote').blur(); page.wait_for_timeout(200)
    page.click('#sheet [data-act=compare]'); page.wait_for_timeout(500)
    page.locator('#page [data-cmp]').first.click(); page.wait_for_timeout(500)
    assert page.locator('.cmp-row').count() >= 5
    page.screenshot(path=f'{OUT}/24-compare.png')
    page.click('#page [data-act=pageback]'); page.wait_for_timeout(150)
    page.click('#sheet [data-act=back]'); page.wait_for_timeout(400)
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    wl = page.text_content('#view'); assert 'Rookies' in wl and 'Buy under $20' in wl, 'folder and note on the watchlist'
    # light theme and larger text
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('#setlight').click()"); page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.dataset.mode") == 'light'
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/25-light-home.png')
    page.click('#tabbar [data-tab=marketplace]'); page.wait_for_timeout(300); page.screenshot(path=f'{OUT}/25b-light-market.png')
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('#setlight').click()"); page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.dataset.mode") is None
    print('v34 features ok')
    # --- v35 features
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    for k in ['glance', 'risk', 'breakouts', 'futures', 'recap', 'rival', 'layout']:
        page.evaluate(f"document.querySelector('.tools [data-page={k}]').click()"); page.wait_for_timeout(450)
        assert page.locator('#page').is_visible(), k
        page.screenshot(path=f'{OUT}/30-{k}.png')
        if k == 'rival':
            page.locator('#page [data-rival]').first.click(); page.wait_for_timeout(300)
            assert page.locator('#page .rivalc').count() == 1
        if k == 'futures':
            page.locator('#page [data-fut]').first.click(); page.wait_for_timeout(200)
            page.fill('#futstake', '0.25'); page.click('#page [data-act=betfut]'); page.wait_for_timeout(300)
            assert 'Your bets' in page.text_content('#page'), page.text_content('#perr') if page.locator('#perr').count() else ''
        if k == 'layout':
            page.evaluate("document.querySelector('[data-layhide=discover]').click()"); page.wait_for_timeout(200)
            page.locator('[data-laymove="movers|-1"]').click(); page.wait_for_timeout(200)
        page.click('#page [data-act=pageback]'); page.wait_for_timeout(150)
    home = page.text_content('#view')
    assert 'Discover' not in home and 'RIVAL THIS WEEK' in home.upper(), 'layout and rival show on the Portfolio page'
    assert home.index('Top movers') < home.index('Calendar'), 'movers moved above the shortcuts'
    page.screenshot(path=f'{OUT}/31-home-custom.png')
    # short a player
    page.click('#tabbar [data-tab=market]'); page.wait_for_timeout(300)
    page.locator('#view .item[data-open^="nba:p:"]').nth(2).click(); page.wait_for_timeout(600)
    page.click('.dtabs [data-dtab=research]'); page.wait_for_timeout(150)
    assert 'What if' not in page.text_content('#dinner') and 'model value' not in page.text_content('#dinner')
    page.click('.dtabs [data-dtab=overview]'); page.wait_for_timeout(150)
    page.click('#sheet .shortc'); page.wait_for_timeout(500)
    page.fill('#shortamt', '1'); page.screenshot(path=f'{OUT}/33-short.png'); page.click('#page [data-act=doshort]'); page.wait_for_timeout(500)
    assert 'Your short' in page.text_content('#dinner'), page.text_content('#perr') if page.locator('#perr').count() else 'no short'
    page.screenshot(path=f'{OUT}/34-short-open.png')
    page.click('#sheet [data-act=cover]'); page.wait_for_timeout(200); page.click('#sheet [data-act=cover]'); page.wait_for_timeout(400)
    assert 'Your short' not in page.text_content('#dinner')
    page.click('#sheet [data-act=back]'); page.wait_for_timeout(400)
    # colour-blind colours
    page.click('#tabbar [data-tab=account]'); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('#setcb').click()"); page.wait_for_timeout(150)
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--up').trim()") == '#3b9dff'
    page.evaluate("document.querySelector('#setcb').click()"); page.wait_for_timeout(150)
    print('v35 features ok')
    # --- v37: long press, pinned bar, hall of fame, friend code
    page.click('#tabbar [data-tab=market]'); page.wait_for_timeout(400)
    page.evaluate('''() => { const el = document.querySelector('#view .item[data-open^="nba:p:"]'); const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: 5, target: el, clientX: r.left + 60, clientY: r.top + 20 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true })); window.__lp = el; window.__lt = t; }''')
    page.wait_for_timeout(650)
    assert page.locator('#qa .qa-panel').is_visible(), 'long press opens quick actions'
    page.screenshot(path=f'{OUT}/40-quick.png')
    page.evaluate("window.__lp.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [window.__lt], bubbles: true })); window.__lp.click()")
    page.wait_for_timeout(150)
    assert page.locator('#sheet').is_hidden(), 'the long press itself does not open the page'
    page.click('#qa [data-qa=compare]'); page.wait_for_timeout(600)
    assert page.locator('#page').is_visible() and 'Pick who to compare' in page.text_content('#page')
    page.click('#page [data-act=pageback]'); page.wait_for_timeout(200)
    assert page.locator('#dpin').count() == 0
    assert page.evaluate("getComputedStyle(document.querySelector('.dtabs')).position") != 'sticky', 'nothing pins while scrolling a player page'
    page.click('#sheet [data-act=back]'); page.wait_for_timeout(400)
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    page.evaluate("document.querySelector('.tools [data-page=hof]').click()"); page.wait_for_timeout(450)
    assert 'Highest net worth' in page.text_content('#page'); page.screenshot(path=f'{OUT}/42-hof.png')
    page.click('#page [data-act=pageback]'); page.wait_for_timeout(150)
    page.evaluate("document.querySelector('.tools [data-page=rival]').click()"); page.wait_for_timeout(450)
    code = 'eyJ2IjoxLCJuIjoiU2FtIiwiciI6MC4wNDIsInciOiIyMDI2LTEwLTA1IiwidCI6MH0'
    page.fill('#duelin', 'https://x.test/StatStreet/#c=' + code); page.wait_for_timeout(300)
    txt = page.text_content('#page'); assert 'Sam' in txt and '+4.2%' in txt, txt[-300:]
    page.screenshot(path=f'{OUT}/43-duel.png')
    page.click('#page [data-act=pageback]'); page.wait_for_timeout(150)
    # --- v43: market indicator, feed, dividend calendar, about
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    assert page.locator('#view .mkt').count() == 1 and 'live' in page.locator('#view .mkt').get_attribute('class')
    assert page.locator('#view .feed').count() == 0
    page.evaluate("document.querySelector('.tools [data-page=divcal]').click()"); page.wait_for_timeout(450)
    assert 'Likely this week' in page.text_content('#page'); page.screenshot(path=f'{OUT}/52-divcal.png')
    page.click('#page [data-act=pageback]'); page.wait_for_timeout(150)
    page.click('#tabbar [data-tab=market]'); page.wait_for_timeout(300)
    assert page.locator('#view .mkt').count() == 1
    page.locator('#view .item[data-open^="nba:p:"]').first.click(); page.wait_for_timeout(700)
    page.click('.dtabs [data-dtab=research]'); page.wait_for_timeout(200)
    ab = page.text_content('#dinner'); assert 'About' in ab and 'Duke' in ab and '6 seasons' in ab, ab[-600:]
    page.evaluate("document.querySelector('#sheet').scrollTop = 99999"); page.wait_for_timeout(200); page.screenshot(path=f'{OUT}/53-about.png')
    print('form5 on page:', page.locator('#sheet .form5').count())
    for tabk in page.evaluate("[...document.querySelectorAll('#sheet .dtabs [data-dtab]')].map(b => b.dataset.dtab)"):
        page.click(f'#sheet .dtabs [data-dtab={tabk}]'); page.wait_for_timeout(150)
        if page.locator('#sheet .form5').count() and page.locator('#sheet .form5').is_visible():
            page.evaluate("document.querySelector('#sheet .form5').scrollIntoView({block:'center'})"); page.wait_for_timeout(200); page.screenshot(path=f'{OUT}/82-form5.png'); break
    page.click('.dtabs [data-dtab=overview]'); page.click('#sheet [data-act=back]'); page.wait_for_timeout(400)
    # --- v53: play-by-play on a live game
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    lg = page.locator('#view .live-strip [data-game]').first
    if lg.count():
        lg.click(); page.wait_for_timeout(1200)
        assert page.locator('#game .gtabs button').count() == 5 and page.locator('#game .gsec[data-gsec=plays]').is_hidden()
        page.click('#game [data-gview=plays]'); page.wait_for_timeout(1200)
        assert page.locator('#game .gsec[data-gsec=summary]').is_hidden()
        gt = page.text_content('#game'); assert 'Play by play' in gt, gt[:200]
        assert page.locator('#game .linescore td').count() >= 8, 'line score'
        page.evaluate("(() => { const g = document.querySelector('#game'); g.scrollTop = 40; g.dispatchEvent(new Event('scroll')); })()"); page.wait_for_timeout(150)
        st = page.evaluate("(() => { const g = document.querySelector('#game'); return [g.classList.contains('pinned'), getComputedStyle(g.querySelector('.gpin-score')).opacity, g.scrollHeight - g.clientHeight]; })()")
        print('pinned after a small scroll:', st); assert not st[0] or st[2] < 60, 'score bar must not pin over the win chart'
        page.evaluate("(() => { const g = document.querySelector('#game'); g.scrollTop = 99999; g.dispatchEvent(new Event('scroll')); })()"); page.wait_for_timeout(150)
        print('pinned at the bottom:', page.evaluate("[document.querySelector('#game').classList.contains('pinned'), document.querySelector('#game').scrollTop]"))
        page.evaluate("(() => { const g = document.querySelector('#game'); g.scrollTop = 0; g.dispatchEvent(new Event('scroll')); })()"); page.wait_for_timeout(100)
        assert page.locator('#game .pbp .pb [data-c]').count() == 0, 'no price change on plays'
        print('plays shown:', page.locator('#game .pbp .pb').count())
        assert page.locator('#game .pbp .pb').count() >= 1
        assert int(page.evaluate("getComputedStyle(document.querySelector('.gc-score')).fontWeight")) >= 900
        page.screenshot(path=f'{OUT}/60-game-pbp.png'); page.evaluate("document.querySelector('#game .pbp').scrollIntoView()"); page.wait_for_timeout(150); page.screenshot(path=f'{OUT}/61-pbp.png')
        page.click('#game [data-act=gameback]'); page.wait_for_timeout(400)
    nf = page.locator('#view .live-strip [data-game^="nfl|"]').first
    if nf.count():
        nf.click(); page.wait_for_timeout(1500)
        ft = page.inner_text('#game .field'); print('field:', ft.replace(chr(10), ' | ')[:120]); assert '3rd & 7' in ft and ' 18' in ft
        assert page.locator('#game .fd-line').count() == 1
        page.screenshot(path=f'{OUT}/84-field.png'); page.click('#game [data-act=gameback]'); page.wait_for_timeout(400)
    # the MLB at-bat view
    ml = page.locator('#view .live-strip [data-game^="mlb|"]').first
    if ml.count():
        ml.click(); page.wait_for_timeout(600); page.click('#game [data-gview=plays]'); page.wait_for_timeout(1500)
        t = page.text_content('#game .atbat'); assert 'Changeup' in t and '84.3 mph' in t and 'Strike Swinging' in t, t
        assert page.locator('#game .zone circle').count() == 4
        page.screenshot(path=f'{OUT}/62-atbat.png')
        page.click('#game [data-act=gameback]'); page.wait_for_timeout(400)
    page.click('#tabbar [data-tab=games]'); page.wait_for_timeout(300); page.click('[data-gtab=props]'); page.wait_for_timeout(400)
    pt = page.text_content('#view'); assert 'Popular props' in pt
    assert page.locator('#view .prop-row').count() <= 18
    page.click('#view .props-game .more >> nth=0'); page.wait_for_selector('#game:not([hidden])'); page.wait_for_timeout(500)
    assert page.locator('#game .gsec[data-gsec=props]').is_visible()
    page.click('#game [data-act=gameback]'); page.wait_for_timeout(400)
    print('props rows:', page.locator('#view .prop-row').count(), 'live section:', 'live props' in pt)
    page.screenshot(path=f'{OUT}/76-props.png', full_page=True)
    print('v43 features ok')
    print('v37 features ok')
    # Portfolio chart: holding on the graph shows the balance at that point
    page.click('#tabbar [data-tab=home]'); page.wait_for_timeout(300)
    if page.locator('#nwchart svg').count():
        page.evaluate('''() => { const s = [...document.querySelectorAll('#nwchart svg')].pop(); const r = s.getBoundingClientRect(); s.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + 50, bubbles: true })); }''')
        lab = page.text_content('[data-nwc]'); assert re.search(r'\d:\d\d', lab), lab
        page.evaluate('''() => [...document.querySelectorAll('#nwchart svg')].pop().dispatchEvent(new MouseEvent('mouseleave'))''')
        assert not re.search(r'\d:\d\d', page.text_content('[data-nwc]'))
        print('portfolio scrub ok')
    # In-app article reader: headline opens the story inside the app
    page.click('#tabbar [data-tab=news]'); page.wait_for_timeout(300)
    page.locator('#view a[data-article]').first.click(); page.wait_for_timeout(900)
    art = page.locator('#article')
    assert art.is_visible() and len(ctx.pages) == 1, 'article opens in the app'
    txt = art.text_content()
    assert 'First paragraph of the story.' in txt and 'What it means' in txt and 'Point one' in txt, txt[:300]
    assert page.evaluate('window.HACKED') is None
    assert art.locator('.art-foot a').get_attribute('href').startswith('https://www.espn.com/')
    page.click('#article [data-act=artback]'); page.wait_for_timeout(200)
    assert not art.is_visible()
    # prefetched: reopening shows text at once; swipe right anywhere closes it
    page.wait_for_timeout(1500)
    page.locator('#view a[data-article]').nth(1).click(); page.wait_for_timeout(60)
    assert 'First paragraph of the story.' in art.text_content(), 'prefetched story shows immediately'
    page.evaluate('''() => { const el = document.querySelector('#article');
      const mk = (type, x) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
        el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); };
      mk('touchstart', 150); mk('touchmove', 180); mk('touchmove', 260); mk('touchmove', 340); mk('touchend', 340); }''')
    page.wait_for_timeout(400)
    assert not art.is_visible(), 'swipe right closes the article'
    print('article reader ok')
    b.close()
srv.shutdown()
if errors: print('JS ERRORS:\n' + '\n'.join(errors)); sys.exit(1)
print('browser test passed')
