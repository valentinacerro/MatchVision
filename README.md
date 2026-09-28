# MatchVision
MatchVision è una Web App sviluppata per supportare il lavoro dello staff tecnico (allenatori e scout) durante partite di volley, permettendo il tracciamento dei parziali dei match e il monitoraggio delle statistiche delle performance per ogni singolo giocatore.

## Avvio in locale

Servono PostgreSQL, Python 3.12 e Node 20.19+.

**Backend** (Django, porta 8001):

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8001
```

La configurazione si legge da variabili d'ambiente; senza variabili valgono i default di sviluppo:
`DJANGO_SECRET_KEY`, `DJANGO_DEBUG` (`1`/`0`), `DJANGO_ALLOWED_HOSTS` (lista separata da virgole),
`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`.

**Frontend** (Angular, porta 4200):

```bash
cd MatchVision
npm ci
npx ng serve
```

L'app chiama l'API sulla porta 8001 dello stesso host da cui è aperta.

## Uso da tablet sulla stessa rete

Con l'IP del computer (es. `192.168.1.20`):

```bash
# backend
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.20 python manage.py runserver 0.0.0.0:8001
# frontend
npx ng serve --host 0.0.0.0
```

Poi sul tablet apri `http://192.168.1.20:4200`.
