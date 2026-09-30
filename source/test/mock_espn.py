"""Mock ESPN API responses used by the browser test."""
import json, random, re, threading, http.server, socketserver, functools, os, sys, datetime
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('SHOTS', os.path.join(ROOT, 'test', 'shots'))
os.makedirs(OUT, exist_ok=True)

TEAMS = {
    'nba': [('13', 'LAL', 'Los Angeles Lakers'), ('25', 'OKC', 'Oklahoma City Thunder'), ('2', 'BOS', 'Boston Celtics'), ('7', 'DEN', 'Denver Nuggets')],
    'nfl': [('12', 'KC', 'Kansas City Chiefs'), ('21', 'PHI', 'Philadelphia Eagles'), ('2', 'BUF', 'Buffalo Bills'), ('8', 'DET', 'Detroit Lions')],
    'mlb': [('10', 'NYY', 'New York Yankees'), ('19', 'LAD', 'Los Angeles Dodgers'), ('30', 'TB', 'Tampa Bay Rays'), ('2', 'BOS', 'Boston Red Sox')],
}
PLAYERS = {
    'nba': [('3945274', 'Luka Doncic', 'G', '13', 33), ('1966', 'LeBron James', 'F', '13', 24), ('4278073', 'Shai Gilgeous-Alexander', 'G', '25', 31),
            ('3112335', 'Nikola Jokic', 'C', '7', 32), ('4065648', 'Jayson Tatum', 'F', '2', 25), ('4066261', 'Jaylen Brown', 'G', '2', 21),
            ('4432577', 'Chet Holmgren', 'C', '25', 17), ('3936299', 'Jamal Murray', 'G', '7', 19)],
    'nfl': [('3139477', 'Patrick Mahomes', 'QB', '12', None), ('4040715', 'Jalen Hurts', 'QB', '21', None), ('3918298', 'Josh Allen', 'QB', '2', None),
            ('3929630', 'Saquon Barkley', 'RB', '21', None), ('4429795', 'Jahmyr Gibbs', 'RB', '8', None), ('4241478', 'DeVonta Smith', 'WR', '21', None),
            ('3116365', 'Travis Kelce', 'TE', '12', None), ('3054211', 'Chris Jones', 'DT', '12', None)],
    'mlb': [('33192', 'Aaron Judge', 'RF', '10', None), ('39832', 'Shohei Ohtani', 'DH', '19', None), ('32081', 'Gerrit Cole', 'SP', '10', None),
            ('33039', 'Mookie Betts', 'SS', '19', None), ('41292', 'Yandy Diaz', '1B', '30', None), ('42140', 'Rafael Devers', '3B', '2', None)],
}
PATH = {'basketball/nba': 'nba', 'football/nfl': 'nfl', 'baseball/mlb': 'mlb'}
TODAY_ET = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime('%Y%m%d')


def standings(lg):
    rnd = random.Random(lg)
    entries = []
    for i, (tid, ab, name) in enumerate(TEAMS[lg]):
        gp = {'nba': 0, 'nfl': 3, 'mlb': 150}[lg]
        w = rnd.randint(0, gp) if gp else 0
        entries.append({'team': {'id': tid, 'abbreviation': ab, 'displayName': name, 'logos': [{'href': f'https://a.espncdn.com/i/teamlogos/{lg}/500/{ab.lower()}.png', 'rel': ['full', 'default']}]},
                        'stats': [{'name': 'wins', 'value': w}, {'name': 'losses', 'value': gp - w}, {'name': 'gamesPlayed', 'value': gp},
                                  {'name': 'pointDifferential', 'value': (w - (gp - w)) * 3}, {'name': 'streak', 'value': 1}]})
    return {'children': [{'standings': {'season': 2027 if lg == 'nba' else 2026, 'entries': entries}}]}


def prior_standings(lg):
    s = standings(lg)
    for e, (tid, ab, name) in zip(s['children'][0]['standings']['entries'], TEAMS[lg]):
        w = random.Random(tid).randint(20, 62)
        e['team'] = {'id': tid, 'abbreviation': ab, 'displayName': name, 'logos': []}
        e['stats'] = [{'name': 'wins', 'value': w}, {'name': 'losses', 'value': 82 - w}, {'name': 'gamesPlayed', 'value': 82}, {'name': 'pointDifferential', 'value': (w - 41) * 20}]
    return s


def season_stats(lg, qs):
    cats = {
        'nba': [('general', ['gamesPlayed', 'minutes', 'rebounds', 'fouls']), ('offensive', ['points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'assists', 'turnovers']), ('defensive', ['steals', 'blocks'])],
        'nfl': [('general', ['gamesPlayed']), ('passing', ['passingYards', 'passingTouchdowns', 'interceptions', 'passingAttempts', 'completions']), ('rushing', ['rushingYards', 'rushingTouchdowns', 'rushingAttempts']),
                ('receiving', ['receptions', 'receivingYards', 'receivingTouchdowns']), ('defensive', ['totalTackles', 'sacks', 'passesDefended'])],
        'mlb': [('batting', ['gamesPlayed', 'atBats', 'hits', 'runs', 'RBIs', 'homeRuns', 'walks', 'strikeouts']), ('pitching', ['gamesPlayed', 'innings', 'hits', 'earnedRuns', 'walks', 'strikeouts'])],
    }[lg]
    if lg == 'nba' and qs.get('season', [''])[0] != '2026':
        return {'pagination': {'count': 0, 'pages': 1}, 'requestedSeason': {'year': 2027}, 'categories': [{'name': c, 'names': n} for c, n in cats], 'athletes': []}
    rows = []
    for pid, name, pos, team, ppg in PLAYERS[lg]:
        r = random.Random(pid)
        if lg == 'nba':
            gp = 70; vals = {'general': [gp, gp * 34, gp * r.uniform(4, 11), gp * 2.2], 'offensive': [gp * ppg, gp * ppg * .37, gp * ppg * .76, gp * 5, gp * 6, gp * r.uniform(3, 9), gp * 2.8], 'defensive': [gp * 1.1, gp * .7]}
        elif lg == 'nfl':
            gp = 3
            if pos == 'QB': vals = {'general': [gp], 'passing': [gp * r.randint(220, 300), gp * 2, gp * .6, gp * 34, gp * 23], 'rushing': [gp * 20, 1, gp * 4], 'receiving': [0, 0, 0], 'defensive': [0, 0, 0]}
            elif pos == 'RB': vals = {'general': [gp], 'passing': [0] * 5, 'rushing': [gp * r.randint(60, 110), 2, gp * 18], 'receiving': [gp * 3, gp * 22, 0], 'defensive': [0, 0, 0]}
            elif pos in ('WR', 'TE'): vals = {'general': [gp], 'passing': [0] * 5, 'rushing': [0, 0, 0], 'receiving': [gp * 6, gp * r.randint(55, 95), 1], 'defensive': [0, 0, 0]}
            else: vals = {'general': [gp], 'passing': [0] * 5, 'rushing': [0, 0, 0], 'receiving': [0, 0, 0], 'defensive': [gp * 4, 2.5, 1]}
        else:
            gp = 150
            if pos == 'SP': vals = {'batting': [gp, 0, 0, 0, 0, 0, 0, 0], 'pitching': [30, 185.1, 150, 60, 45, 210]}
            else: vals = {'batting': [gp, 560, 160 + r.randint(0, 30), 90, 95, r.randint(25, 50), 80, 150], 'pitching': [0, 0, 0, 0, 0, 0]}
        rows.append({'athlete': {'id': pid, 'displayName': name, 'firstName': name.split()[0], 'lastName': name.split()[-1], 'position': {'abbreviation': pos},
                                 'teamId': team, 'teamShortName': [t[1] for t in TEAMS[lg] if t[0] == team][0], 'headshot': {'href': f'https://a.espncdn.com/i/headshots/{lg}/players/full/{pid}.png'}},
                     'categories': [{'name': c, 'values': vals[c]} for c, _ in cats]})
    return {'pagination': {'count': len(rows), 'pages': 1}, 'requestedSeason': {'year': 2026}, 'categories': [{'name': c, 'names': n} for c, n in cats], 'athletes': rows}


def event_for(lg, date, idx, state):
    t = TEAMS[lg]
    a, b = t[idx % 4], t[(idx + 1) % 4]
    eid = f'{lg}{date}{idx}'
    r = random.Random(eid)
    sa, sb = r.randint(80, 130) if lg == 'nba' else r.randint(3, 35) if lg == 'nfl' else r.randint(0, 9), 0
    sb = r.randint(80, 130) if lg == 'nba' else r.randint(3, 35) if lg == 'nfl' else r.randint(0, 9)
    if sa == sb: sa += 1
    dt = datetime.datetime.strptime(date, '%Y%m%d').replace(hour=23, tzinfo=datetime.timezone.utc)
    st = {'post': {'state': 'post', 'completed': True, 'shortDetail': 'Final'}, 'in': {'state': 'in', 'completed': False, 'shortDetail': '3rd Qtr 4:12'}}[state]
    return {'id': eid, 'date': dt.strftime('%Y-%m-%dT%H:%MZ'), 'shortName': f'{b[1]} @ {a[1]}', 'season': {'type': 1 if lg == 'nba' else 2},
            'status': {'period': 3 if state == 'in' else 4, 'type': st},
            'competitions': [{'format': {'regulation': {'periods': 9 if lg == 'mlb' else 4}}, 'competitors': [
                {'homeAway': 'home', 'winner': state == 'post' and sa > sb, 'score': str(sa), 'team': {'id': a[0], 'abbreviation': a[1]}},
                {'homeAway': 'away', 'winner': state == 'post' and sb > sa, 'score': str(sb), 'team': {'id': b[0], 'abbreviation': b[1]}}]}]}


def scoreboard(lg, qs):
    date = qs.get('dates', [TODAY_ET])[0]
    evs = [event_for(lg, date, 0, 'post')]
    if date == TODAY_ET: evs.append(event_for(lg, date, 2, 'in'))
    return {'events': evs}


def summary(lg, eid):
    r = random.Random(eid)
    sides = {}
    for pid, name, pos, team, ppg in PLAYERS[lg]:
        sides.setdefault(team, []).append((pid, name, pos))
    players = []
    for team, plist in sides.items():
        stats = []
        if lg == 'nba':
            rows = []
            for pid, name, pos in plist:
                pts = r.randint(8, 46); fga = int(pts * .8)
                rows.append({'athlete': {'id': pid, 'displayName': name, 'position': {'abbreviation': pos}}, 'stats': [str(r.randint(24, 40)), str(pts), f'{int(fga*.48)}-{fga}', '2-6', '4-5', str(r.randint(2, 14)), str(r.randint(1, 12)), '2', '1', '1', '1', '5', '2', '+4']})
            stats.append({'labels': ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'], 'athletes': rows})
        elif lg == 'nfl':
            qbs = [p for p in plist if p[2] == 'QB']; rbs = [p for p in plist if p[2] == 'RB']; wrs = [p for p in plist if p[2] in ('WR', 'TE')]; ds = [p for p in plist if p[2] == 'DT']
            stats.append({'name': 'passing', 'labels': ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], 'athletes': [{'athlete': {'id': p[0], 'displayName': p[1], 'position': {'abbreviation': 'QB'}}, 'stats': ['22/33', str(r.randint(150, 420)), '7', str(r.randint(0, 5)), str(r.randint(0, 2)), '1-6', '60', '100']} for p in qbs]})
            stats.append({'name': 'rushing', 'labels': ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], 'athletes': [{'athlete': {'id': p[0], 'displayName': p[1], 'position': {'abbreviation': 'RB'}}, 'stats': ['18', str(r.randint(30, 190)), '4', str(r.randint(0, 3)), '22']} for p in rbs]})
            stats.append({'name': 'receiving', 'labels': ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], 'athletes': [{'athlete': {'id': p[0], 'displayName': p[1], 'position': {'abbreviation': p[2]}}, 'stats': [str(r.randint(2, 11)), str(r.randint(20, 180)), '12', str(r.randint(0, 2)), '30', '9']} for p in wrs]})
            stats.append({'name': 'defensive', 'labels': ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HTS', 'TD'], 'athletes': [{'athlete': {'id': p[0], 'displayName': p[1], 'position': {'abbreviation': 'DT'}}, 'stats': [str(r.randint(1, 7)), '2', str(r.randint(0, 3)), '1', '0', '2', '0']} for p in ds]})
        else:
            hit = [p for p in plist if p[2] != 'SP']; pit = [p for p in plist if p[2] == 'SP']
            stats.append({'labels': ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG', 'OBP', 'SLG'], 'athletes': [{'athlete': {'id': p[0], 'displayName': p[1], 'position': {'abbreviation': p[2]}}, 'stats': ['2-4', '4', str(r.randint(0, 2)), str(r.randint(0, 4)), str(r.randint(0, 4)), str(r.randint(0, 3)), '1', '1', '18', '.300', '.400', '.500']} for p in hit]})
            stats.append({'labels': ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'], 'athletes': [{'athlete': {'id': p[0], 'displayName': p[1], 'position': {'abbreviation': 'SP'}}, 'stats': ['6.2', '4', '2', str(r.randint(0, 5)), '2', str(r.randint(3, 13)), '1', '95-60', '3.10', '95']} for p in pit]})
        players.append({'team': {'id': team, 'abbreviation': [t[1] for t in TEAMS[lg] if t[0] == team][0]}, 'statistics': stats})
    return {'boxscore': {'players': players}}


def news(lg):
    p = PLAYERS[lg]
    now = datetime.datetime.now(datetime.timezone.utc)
    heads = [
        (f'{p[0][1]} sets franchise record in dominant win', 'Career-high night lifts his team.', p[0], 1),
        (f'{p[1][1]} ruled out with ankle injury, to miss two weeks', 'Team says he will be re-evaluated.', p[1], 3),
        (f'{TEAMS[lg][1][2]} extend winning streak to five', 'Comeback victory on the road.', None, 6),
        (f'{p[2][1]} signs contract extension', 'Multi-year deal.', p[2], 20),
    ]
    arts = []
    for i, (h, d, pl, hrs) in enumerate(heads):
        cats = [{'type': 'athlete', 'athleteId': int(pl[0])}] if pl else [{'type': 'team', 'teamId': int(TEAMS[lg][1][0])}]
        arts.append({'dataSourceIdentifier': f'{lg}-n{i}', 'headline': h, 'description': d, 'published': (now - datetime.timedelta(hours=hrs)).isoformat(),
                     'links': {'web': {'href': 'https://www.espn.com/'}}, 'categories': cats})
    return {'articles': arts}


def injuries(lg):
    p = PLAYERS[lg][1]
    return {'injuries': [{'injuries': [{'status': 'Out', 'shortComment': 'Ankle sprain', 'athlete': {'id': p[0], 'displayName': p[1]}}]}]}


def handle(url):
    u = urlparse(url); qs = parse_qs(u.query)
    m = re.search(r'/sports/(\w+/\w+)/', u.path + '/')
    lg = PATH[m.group(1)]
    if u.path.endswith('/standings'):
        return prior_standings(lg) if (lg == 'nba' and qs.get('season')) else standings(lg)
    if 'byathlete' in u.path: return season_stats(lg, qs)
    if u.path.endswith('/scoreboard'): return scoreboard(lg, qs)
    if u.path.endswith('/summary'): return summary(lg, qs['event'][0])
    if u.path.endswith('/news'): return news(lg)
    if u.path.endswith('/injuries'): return injuries(lg)
    raise ValueError(url)


