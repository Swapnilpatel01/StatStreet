# StatStreet

A stock market for NBA, NFL and MLB players and teams. Prices move with real box scores, standings, injuries and news. Play money only, runs entirely in your browser.

**Live app:** https://swapnilpatel01.github.io/StatStreet/ — open in Safari and tap Share → Add to Home Screen.

## Features

- **Players and teams as stocks**, priced from real box scores, standings, injuries and ESPN headlines, with live-game moves.
- **Dividends**: teams pay after wins; players pay after above-average games, plus a special dividend for milestone games. You must own shares before tip-off. Optional automatic reinvestment.
- **Index funds**: StatStreet 500, MVP 10, NBA/NFL/MLB Stars, Quarterback Index, All Teams and Hot Hand Momentum. They rebalance weekly and pass through dividends.
- **Options**: calls and puts with weekly Friday expiries, priced for game risk (each game before expiry adds a jump sized from the asset's own recent games, so premiums rise into game day and drop after), breakeven, chance of profit, Greeks, a payoff chart and automatic cash settlement.
- **Orders**: market orders in dollars (fractional shares) or shares, limit, stop-loss and recurring buys, with slide-to-confirm.
- **Native feel**: swipe down to close sheets, swipe from the left edge to go back, pull to refresh, haptics, launch screens and no scroll bars.
- **Robinhood-style extras**: price alerts, notifications, watchlist, portfolio allocation, performance vs the StatStreet 500, key stats, scout ratings, upcoming games and Discover collections.

## What's in this repo

- Root (`index.html`, `sw.js`, `manifest.webmanifest`, icons): the ready-to-serve app that GitHub Pages hosts. `index.html` is a single bundled file built from `source/`.
- `proxy-worker.js`: optional Cloudflare Worker to use if Safari blocks ESPN's data feeds (see below).
- `source/`: the original modular code, tests, and the same worker (`source/worker/proxy.js`).

## Turn on GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)` → Save. The site appears at the link above within a couple of minutes.

## If the data won't load

The app reads ESPN's public JSON feeds straight from your phone. If Safari
blocks them (the first-launch screen will say so, and Account → *Test connection*
shows ✗), deploy the tiny proxy in `proxy-worker.js`:

1. https://dash.cloudflare.com → sign up free → Workers & Pages → Create → Hello World worker → Deploy.
2. Edit code → replace everything with `proxy-worker.js` → Deploy.
3. Copy the `https://….workers.dev` URL into StatStreet → Account → Data connection → Save → Test connection.

The free Cloudflare tier (100k requests/day) is far more than one person uses.
The proxy only forwards to ESPN's API hosts, so it can't be abused as an open proxy.

## How prices are set

| Driver | What it does |
|---|---|
| **Performance** | Each player has a rolling "form score" — NBA Game Score, fantasy-style points for NFL, batting/pitching lines for MLB. Season averages set the opening price; every box score updates it. Players are compared with their own position group (QBs vs QBs, pitchers vs pitchers), and positions carry different "market caps" (a QB is worth more than a kicker). |
| **Team results** | Win % (pulled toward .500 early in a season), point/run differential, streak, last-10 form, playoff odds. In the off-season last year's record is carried forward at 25% weight. |
| **Injuries** | Day-to-day −4%, Questionable −5%, Doubtful −12%, Out/IL −20%, IR −28%. Injured stars also drag their team down. Returning from injury restores the price. |
| **News** | Headlines are scored for sentiment (torn ACL, suspension, arrested… vs. record, career-high, MVP, extension…). The hit fades with a 3-day half-life. |
| **Milestones** | 40-point games, triple-doubles, 400-yard passing, 3-HR games, no-hitters etc. get an extra bump. |
| **Live games** | While a game is on, players move with their pace and teams with the score; refreshes every minute while the app is open. |
| **Market mood** | Each league has a mood from its news tone and overall price moves, which lifts or weighs on everything in that league a little. |
| **Your trades** | Buying pushes the price up, selling pushes it down (the effect fades over hours), and there's a 0.35% spread — so pump-and-dump and churning lose money. |

Between updates, prices wiggle around their fair value like a real ticker.
Every asset page has a **"Why it's moving"** log and a **price breakdown** so you can see exactly what's driving it.

## Notes & limits

- iOS doesn't let web apps refresh in the background; prices catch up (and replay the games you missed) when you open the app.
- Data lives on the phone (IndexedDB). Use Account → **Export** now and then as a backup; **Import** restores it.
- ESPN's feeds are unofficial and could change. Parsing is in `js/scoring.js` if anything needs adjusting.
- Play money only; not affiliated with ESPN or any league.

## Development

```
cd source
node test/engine.test.mjs        # pricing engine unit tests
node test/features.test.mjs      # dividends, funds, options, orders
node test/options.test.mjs       # game-risk option pricing
python3 test/browser_test.py     # headless browser test with mocked ESPN data (needs Playwright)
```

Serve `source/` with any static server to run the modular version. The root `index.html` is a bundle of `source/js/app.js` plus `styles.css` (built with esbuild).
