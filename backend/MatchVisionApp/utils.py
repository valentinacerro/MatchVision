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
    df['player'] = (df['player__name'].fillna('') + ' ' + df['player__surname'].fillna('')).str.strip()

    # 2. Count touches per (player, fundamental) and grade: crosstab = groupby + count + pivot
    counts = pd.crosstab(
        index=[df['player_id'], df['player__number'], df['player'], df['fundamental']],
        columns=df['outcome'],
    )
    # Every grade becomes a column, even if nobody got it (0 instead of missing)
    counts = counts.reindex(columns=GRADES, fill_value=0).reset_index()
    counts = counts.rename(columns={'player__number': 'number'})
    counts['team'] = False

    # 3. Team rows: the same counts summed over all players
    team = counts.groupby('fundamental', as_index=False)[GRADES].sum()
    team['player_id'] = None
    team['number'] = None
    team['player'] = 'Squadra'
    team['team'] = True

    table = pd.concat([counts, team], ignore_index=True)

    # 4. KPIs, computed on whole columns at once (vectorised)
    table['tot'] = table[GRADES].sum(axis=1)
    table['positivita'] = ((table['++'] + table['+']) / table['tot'] * 100).round(1)
    table['efficienza'] = ((table['++'] - table['— —']) / table['tot'] * 100).round(1)
    table['errori'] = (table['— —'] / table['tot'] * 100).round(1)

    # 5. Order: fundamental in order of play, team row last, players by shirt number
    table['order'] = table['fundamental'].map({f: i for i, f in enumerate(FUNDAMENTALS)}).fillna(len(FUNDAMENTALS))
    table = table.sort_values(['order', 'team', 'number'], na_position='last').drop(columns='order')

    # NaN is not valid JSON: turn missing values into None
    table = table.astype(object).where(pd.notna(table), None)
    return table.to_dict(orient='records')
