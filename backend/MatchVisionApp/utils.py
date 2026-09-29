import numpy as np
import pandas as pd
from django.conf import settings
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

# Same database as Django (settings.DATABASES), so there is one place to configure it
db = settings.DATABASES['default']
conn = create_engine(URL.create(
    'postgresql',
    username=db['USER'],
    password=db['PASSWORD'],
    host=db['HOST'],
    port=int(db['PORT']) if db['PORT'] else None,
    database=db['NAME'],
))

def create_table_match_stats(match_id):

    query = """SELECT p.id, p.name || ' ' || p.surname AS player, t.fundamental, t.outcome, COUNT(*) AS num_touches, (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY p.id, t.fundamental)) AS perc 
                FROM "MatchVisionApp_touch" t
                JOIN "MatchVisionApp_set" s ON s.id = t.set_id
                JOIN "MatchVisionApp_player" p ON p.id = t.player_id
                WHERE s.match_id = %s
                GROUP BY p.id, player, t.fundamental, t.outcome
                ORDER BY p.id, player, t.fundamental, t.outcome
            """
    
    df = pd.read_sql_query(query, conn, params=(match_id,))
    df['perc'] = pd.to_numeric(df['perc'], errors='coerce')

    # cell creation
    df['dato'] = df['num_touches'].astype(int).astype(str) + " (" + df['perc'].round(1).astype(str) + "%)"

    df_pivot = pd.pivot_table(df, 
                            index=['fundamental', 'outcome'], 
                            columns=['id', 'player'], 
                            values='dato', 
                            aggfunc='first', 
                            fill_value='-'
                        )

    df_tot = df.groupby(['fundamental', 'id', 'player'])['num_touches'].sum().unstack(['id','player'])
    df_tot['outcome'] = 'tot'
    df_tot = df_tot.set_index('outcome', append=True)

    df_tot = df_tot.astype(str)

    df_final = pd.concat([df_pivot, df_tot])

    df_final = df_final.sort_index(level=[0,1], key=lambda x: x.map(lambda y: (y=='tot', y)))

    df_final = df_final.fillna('-')

    if isinstance(df_final.columns, pd.MultiIndex):
        df_final.columns = ['_'.join([str(c) for c in col if c]) for col in df_final.columns]

    # to rename columns
    df_final = df_final.rename(columns=lambda x: x.split("_", 1)[1] if "_" in x else x)

    return df_final



def create_table_set_stats(set_id):

    query = """SELECT p.id, p.name || ' ' || p.surname AS player, t.fundamental, t.outcome, COUNT(*) AS num_touches, (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY p.id, t.fundamental)) AS perc 
                FROM "MatchVisionApp_touch" t
                JOIN "MatchVisionApp_set" s ON s.id = t.set_id
                JOIN "MatchVisionApp_player" p ON p.id = t.player_id
                WHERE s.id = %s
                GROUP BY p.id, player, t.fundamental, t.outcome
                ORDER BY p.id, player, t.fundamental, t.outcome
            """
    
    df = pd.read_sql_query(query, conn, params=(set_id,))
    df['perc'] = pd.to_numeric(df['perc'], errors='coerce')

    # cell creation
    df['dato'] = df['num_touches'].astype(int).astype(str) + " (" + df['perc'].round(1).astype(str) + "%)"

    df_pivot = pd.pivot_table(df, 
                            index=['fundamental', 'outcome'], 
                            columns=['id', 'player'], 
                            values='dato', 
                            aggfunc='first', 
                            fill_value='-'
                        )

    df_tot = df.groupby(['fundamental', 'id', 'player'])['num_touches'].sum().unstack(['id','player'])
    df_tot['outcome'] = 'tot'
    df_tot = df_tot.set_index('outcome', append=True).astype(str)

    df_final = pd.concat([df_pivot, df_tot])
    df_final = df_final.sort_index(level=[0,1], key=lambda x: x.map(lambda y: (y=='tot', y)))
    df_final = df_final.fillna('-')

    if isinstance(df_final.columns, pd.MultiIndex):
        df_final.columns = ['_'.join([str(c) for c in col if c]) for col in df_final.columns]

    # to rename columns
    df_final = df_final.rename(columns=lambda x: x.split("_", 1)[1] if "_" in x else x)

    return df_final


def create_table_set_player(set_id, player_id):
    query = """
        SELECT t.fundamental, t.outcome, COUNT(*) AS num_touches
        FROM "MatchVisionApp_touch" t
        JOIN "MatchVisionApp_set" s ON s.id = t.set_id
        JOIN "MatchVisionApp_player" p ON p.id = t.player_id
        WHERE s.id = %s AND p.id = %s
        GROUP BY t.fundamental, t.outcome
        ORDER BY t.fundamental, t.outcome
    """
    
    df = pd.read_sql_query(query, conn, params=(set_id, player_id,))
    
    if df.empty:
        return pd.DataFrame()
    
    df_pivot = pd.pivot_table(
        df,
        index="outcome",
        columns="fundamental",
        values="num_touches",
        aggfunc="sum",
        fill_value=0
    )
    
    totals = df_pivot.sum(axis=0).to_frame().T
    totals.index = ["tot"]
    
    df_final = pd.concat([df_pivot, totals])
    
    df_final = df_final.reset_index().rename(columns={"index": "Esito"})
    
    return df_final


# ---------------------------------------------------------------------------
# KPI tables: numbers instead of pre-formatted strings, so the frontend can
# order, colour and format them. Built with the Django ORM + pandas, no raw SQL.
# ---------------------------------------------------------------------------

# Order used everywhere: fundamentals in order of play, grades from best to worst
FUNDAMENTALS = ['Battuta', 'Ricezione', 'Alzata', 'Attacco', 'Muro', 'Difesa']
GRADES = ['++', '+', '!', '—', '— —']


def percent(part, total):
    # Percent with one decimal, halves rounded away from zero (6.25 -> 6.3) as done by hand;
    # pandas' round() would give 6.2 (round half to even)
    # Scale before dividing, so an exact half (23/80 = 28.75) stays exact in floating point
    return (np.sign(part) * np.floor(part.abs() * 1000 / total + 0.5) / 10).astype(float)


def create_kpi_table(touches):
    """
    One row per player and fundamental, plus a 'Squadra' row per fundamental.

    touches: a Touch queryset (e.g. all touches of a match or of a set).
    Each row has the count of every grade and these KPIs, in percent:
        positivita = (++ + +) / tot
        efficienza = (++ - — —) / tot
        errori     = — — / tot
    """
    # 1. Queryset -> DataFrame: one row per touch
    df = pd.DataFrame(list(touches.values(
        'player_id', 'player__number', 'player__name', 'player__surname', 'fundamental', 'outcome')))
    if df.empty:
        return []
    # Nullable integers: a missing number stays missing instead of turning the column into floats
    df['player_id'] = df['player_id'].astype('Int64')
    df['player__number'] = df['player__number'].astype('Int64')
    df['player'] = (df['player__name'].fillna('') + ' ' + df['player__surname'].fillna('')).str.strip()
    df.loc[df['player_id'].isna(), 'player'] = 'Senza giocatore'

    # 2. Count touches per (player, fundamental) and grade: crosstab = groupby + count + pivot.
    # Group on the id only (a missing id becomes -1): pandas drops groups with a missing key,
    # so grouping on the number or the name would silently lose touches.
    df['key'] = df['player_id'].fillna(-1)
    counts = pd.crosstab(index=[df['key'], df['fundamental']], columns=df['outcome'])
    # Every grade becomes a column, even if nobody got it (0 instead of missing)
    counts = counts.reindex(columns=GRADES, fill_value=0).reset_index()
    # Put number and name back, one row per player
    players = df.drop_duplicates('key')[['key', 'player_id', 'player__number', 'player']]
    counts = counts.merge(players, on='key').drop(columns='key').rename(columns={'player__number': 'number'})
    counts['team'] = False

    # 3. Team rows, counted on every touch (also those without a player)
    team = pd.crosstab(df['fundamental'], df['outcome']).reindex(columns=GRADES, fill_value=0).reset_index()
    team['player_id'] = pd.array([pd.NA] * len(team), dtype='Int64')
    team['number'] = pd.array([pd.NA] * len(team), dtype='Int64')
    team['player'] = 'Squadra'
    team['team'] = True

    table = pd.concat([counts, team], ignore_index=True)

    # 4. KPIs, computed on whole columns at once (vectorised)
    table['tot'] = table[GRADES].sum(axis=1)
    table['positivita'] = percent(table['++'] + table['+'], table['tot'])
    table['efficienza'] = percent(table['++'] - table['— —'], table['tot'])
    table['errori'] = percent(table['— —'], table['tot'])

    # 5. Order: fundamental in order of play, team row last, players by shirt number
    table['order'] = table['fundamental'].map({f: i for i, f in enumerate(FUNDAMENTALS)}).fillna(len(FUNDAMENTALS))
    table['no_player'] = table['player_id'].isna() & ~table['team'].astype(bool)
    table = table.sort_values(['order', 'team', 'no_player', 'number'], na_position='last').drop(columns=['order', 'no_player'])

    # NaN is not valid JSON: turn missing values into None
    table = table.astype(object).where(pd.notna(table), None)
    return table.to_dict(orient='records')


# ---------------------------------------------------------------------------
# Rally statistics: how often the team wins the point
#   side-out    = points won when the opponent serves (winning back the serve)
#   break-point = points won on its own serve
# overall and per rotation (rotation 1 = starting lineup, +1 at every side-out won)
# ---------------------------------------------------------------------------

def _share(won, total):
    # {won, total, pct}: pct with one decimal, halves away from zero, None without rallies
    won, total = int(won), int(total)
    pct = float(np.floor(won * 1000 / total + 0.5) / 10) if total else None
    return {'won': won, 'total': total, 'pct': pct}


def create_rally_table(rallies, by='rotation'):
    """
    rallies: a Rally queryset (a set or a whole match).
    by: 'rotation' (rotation index within a set) or 'p1' (player in position 1, comparable across sets
        whose lineups started in different rotations).
    Returns {'total', 'sideout', 'breakpoint', 'rotations': [{rotation, p1, sideout, breakpoint}]}.
    """
    df = pd.DataFrame(list(rallies.values('serving', 'rotation', 'winner', 'p1_player__number')))
    empty = {'total': 0, 'sideout': _share(0, 0), 'breakpoint': _share(0, 0), 'rotations': []}
    if df.empty:
        return empty

    df['won'] = df['winner'] == 'home'
    # The phase depends on who served: the opponent -> side-out, us -> break-point
    df['phase'] = df['serving'].map({'guests': 'sideout', 'home': 'breakpoint'})

    # Overall: won and total rallies per phase
    overall = df.groupby('phase')['won'].agg(['sum', 'count'])

    def phase_share(table, phase):
        if phase not in table.index:
            return _share(0, 0)
        return _share(table.loc[phase, 'sum'], table.loc[phase, 'count'])

    rotations = []
    if by == 'p1' and df['p1_player__number'].notna().all():
        # One row per player in P1 (rotation label not meaningful across sets)
        for p1, group in df.groupby('p1_player__number'):
            by_phase = group.groupby('phase')['won'].agg(['sum', 'count'])
            rotations.append({
                'rotation': None,
                'p1': int(p1),
                'sideout': phase_share(by_phase, 'sideout'),
                'breakpoint': phase_share(by_phase, 'breakpoint'),
            })
    else:
        for rotation, group in df.groupby('rotation'):
            by_phase = group.groupby('phase')['won'].agg(['sum', 'count'])
            # Player in position 1 in this rotation, if it is always the same one (e.g. within a set)
            p1 = group['p1_player__number'].dropna().unique()
            rotations.append({
                'rotation': int(rotation) + 1,
                'p1': int(p1[0]) if len(p1) == 1 else None,
                'sideout': phase_share(by_phase, 'sideout'),
                'breakpoint': phase_share(by_phase, 'breakpoint'),
            })

    return {
        'total': int(len(df)),
        'sideout': phase_share(overall, 'sideout'),
        'breakpoint': phase_share(overall, 'breakpoint'),
        'rotations': rotations,
    }
