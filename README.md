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

## App installabile (PWA)

MatchVision si installa sul tablet o sul PC come un'app e si apre anche senza connessione.
Il service worker c'è solo nella build di produzione; per provarla in locale:

```bash
cd MatchVision
npm run preview        # build + http://localhost:4300
```

- **Chrome, Edge, Android:** pulsante **Installa** in alto.
- **iPad, iPhone:** in Safari, **Condividi → Aggiungi alla schermata Home**.
- **Senza rete** l'app si apre e mostra **Offline** (vedi sotto).
- **Nuova versione:** compare l'avviso **Aggiorna**. Non si ricarica mai da sola, così non interrompe uno scout.

Da un tablet sulla rete locale (`http://192.168…`) l'app funziona, ma i browser permettono installazione
e avvio offline solo in HTTPS (o su `localhost`): servirà la versione online.

## Senza connessione

Una partita si può fare tutta senza rete: tocchi, punti, annulla, cambi, time-out, fine set, nuovo set, fine partita.
Ogni modifica è salvata subito sul dispositivo e parte da sola, in ordine, quando il server è di nuovo raggiungibile
(anche a pagina chiusa, finché l'app è aperta). In alto compare **N modifiche da inviare** finché c'è qualcosa in attesa.

- Ricaricando la pagina senza rete la partita si riapre dai dati del dispositivo; le liste mostrano l'ultima versione scaricata.
- Anche una partita nuova si crea senza rete: resta sul dispositivo (in **Partite** con l'etichetta **Non ancora sul server**)
  e arriva al server con il resto. Servono solo le squadre già scaricate, cioè aver aperto l'app online almeno una volta.
- Una partita creata altrove, per riaprirla offline, va aperta almeno una volta con la rete su questo dispositivo.
- Se intanto la stessa partita è stata aperta su un altro dispositivo, le modifiche di questo non vengono inviate:
  compare **⚠ Sincronizzazione** e si possono scartare (resta la versione dell'altro dispositivo).
- Il logout con modifiche in attesa chiede conferma: restano sul dispositivo e partono al prossimo accesso.
- Le statistiche durante la partita sono quelle del server: senza rete mancano le ultime modifiche (lo dice il pannello).

## Account

Ogni utente si registra dall'app (email e password) e vede solo i propri giocatori, squadre e partite.
L'accesso vale per dispositivo: uscire dal telefono non chiude la sessione sul tablet che sta facendo lo scout.
Una sessione non usata per 60 giorni scade.

I dati creati prima del login non hanno un proprietario. Per assegnarli al tuo account (dopo esserti registrato):

```bash
cd backend
python manage.py assign_orphans tua@email.it
```

## Test

```bash
cd backend && python manage.py test
cd MatchVision && npx ng test --watch=false
```

## Uso da tablet sulla stessa rete

Con l'IP del computer (es. `192.168.1.20`):

```bash
# backend
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.20 python manage.py runserver 0.0.0.0:8001
# frontend
npx ng serve --host 0.0.0.0
```

Poi sul tablet apri `http://192.168.1.20:4200`.
