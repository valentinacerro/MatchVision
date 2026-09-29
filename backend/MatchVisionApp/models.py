from django.utils import timezone
from django.db import models


# ROLE_CHOICES = [
#     ("SETTER", "Alzatore"),
#     ("OUTSIDE_HITTER", "Lato"),
#     ("MIDDLE_BLOCKER", "Centrale"),
#     ("OPPOSITE_HITTER", "Opposto"),
#     ("LIBERO", "Libero"),
# ]


class Player(models.Model):
    user = models.ForeignKey('User', on_delete=models.CASCADE, related_name='players', null=True, blank=True)
    name = models.CharField(max_length=100, null=True, blank=True, verbose_name="Nome")
    surname = models.CharField(max_length=100, null=True, blank=True, verbose_name="Cognome")
    number = models.PositiveIntegerField(null=True, blank=True, db_index=True, verbose_name="Numero")
    role = models.CharField(max_length=20, null=True, blank=True, verbose_name="Ruolo")

    class Meta:
        ordering = ["surname", "name"]
        verbose_name = "Giocatore"
        verbose_name_plural = "Giocatori"

    def __str__(self):
        full_name = f"{self.name or ''} {self.surname or ''}".strip()
        return f"{full_name})"


# EVENT_TYPE_CHOICES = [
#     ("TECHNICAL_TIMEOUT", "TimeOut tecnico"),
#     ("CHANGE", "Cambio"),
#     ("DOUBLE_CHANGE", "Doppio cambio"),
#     ("MEDICAL_CHANGE", "Cambio medico"),
#     ("YELLOW_CARD", "Cartellino giallo"),
#     ("RED_CARD", "Cartellino rosso"),
#     ("SCORED_POINT", "Punto generico eseguito"),
#     ("CONCEDED_POINT", "Punto generico subito"),
#     ("DOUBLE_FAULT", "Palla contesa")
# ]


class Event(models.Model):
    """Something that happened in a set besides touches: substitution, time-out, card..."""
    event_type = models.CharField(max_length=30, verbose_name="Tipo evento")
    set = models.ForeignKey('Set', on_delete=models.CASCADE, null=True, blank=True, related_name='events')
    team = models.CharField(max_length=6, default='home', verbose_name="Squadra")
    # e.g. {"out": [3], "in": [11]} for a substitution
    details = models.JSONField(default=dict, blank=True, verbose_name="Dettagli")
    home_score = models.PositiveIntegerField(null=True, blank=True, verbose_name="Punteggio casa")
    guest_score = models.PositiveIntegerField(null=True, blank=True, verbose_name="Punteggio ospiti")
    client_id = models.CharField(max_length=64, null=True, blank=True, unique=True, verbose_name="Id client")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "Evento"
        verbose_name_plural = "Eventi"

    def __str__(self):
        return f"Evento: {self.event_type}"


class Set(models.Model):
    match = models.ForeignKey('Match', related_name='sets', on_delete=models.CASCADE)
    number = models.PositiveIntegerField(verbose_name="Numero set")
    players = models.ManyToManyField(Player, related_name='sets', blank=True)
    home_score = models.PositiveIntegerField(default=0, verbose_name="Punteggio casa")
    guest_score = models.PositiveIntegerField(default=0, verbose_name="Punteggio ospite")

    class Meta:
        ordering = ["match", "number"]
        verbose_name = "Set"
        verbose_name_plural = "Set"

    def __str__(self):
        return f"Set {self.number} ({self.match.name})"


class Match(models.Model):
    user = models.ForeignKey('User', on_delete=models.CASCADE, related_name='matches', null=True, blank=True)
    name = models.CharField(max_length=100, verbose_name="Nome partita")
    timestamp = models.DateTimeField(default=timezone.now)
    team = models.ForeignKey('Team', on_delete=models.CASCADE, related_name='matches')
    results = models.JSONField(default=list, blank=True)
    # Match format: sets needed to win, points of a normal set and of the deciding set
    sets_to_win = models.PositiveSmallIntegerField(default=3, verbose_name="Set per vincere")
    set_points = models.PositiveSmallIntegerField(default=25, verbose_name="Punti per set")
    tiebreak_points = models.PositiveSmallIntegerField(default=15, verbose_name="Punti tie-break")
    # Live state of a match being scouted (lineup, score, serve, rotation...), so it can be resumed.
    # Null when the match has not started or is over.
    live_state = models.JSONField(null=True, blank=True, verbose_name="Stato live")

    class Meta:
        ordering = ["-timestamp"]
        verbose_name = "Partita"
        verbose_name_plural = "Partite"

    def __str__(self):
        return f"Match: {self.name}"


class Team(models.Model):
    user = models.ForeignKey('User', on_delete=models.CASCADE, related_name='teams', null=True, blank=True)
    name = models.CharField(max_length=100, verbose_name="Nome squadra")
    playersList = models.ManyToManyField(Player, related_name='teams', blank=True)

    class Meta:
        verbose_name = "Squadra"
        verbose_name_plural = "Squadre"

    def __str__(self):
        return f"Team: {self.name}"


# FUNDAMENTAL_TYPE_CHOICES = [
#    ( "SERVE", "Servizio"),
#     ("SERVE_RECEIVE", "Ricezione"),
#     ("SET", "Alzata"),
#     ("ATTACK", "Attacco"),
#     ("BLOCK", "Muro"),
#     ("DEFENSE", "Difesa")
# ]

# TOUCH_RESULT_CHOICES = [
#     ("POSITIVA", "++"),
#     ("BUONA", "+"),
#     ("NEUTRA", "/"),
#     ("NEGATIVA", "-"),
#     ("ERRORE", "--")
# ]


class Touch(models.Model):
    set = models.ForeignKey('Set', on_delete=models.CASCADE, related_name='touches')
    player = models.ForeignKey('Player', on_delete=models.CASCADE, null=True, blank=True, related_name='touches')
    fundamental = models.CharField(max_length=15, verbose_name="Fondamentale")
    outcome = models.CharField(max_length=8, verbose_name="Esito")
    # Generated by the client for each tap, so a retried request does not save the touch twice
    client_id = models.CharField(max_length=64, null=True, blank=True, unique=True, verbose_name="Id client")

    class Meta:
        verbose_name = "Tocco"
        verbose_name_plural = "Tocchi"

    def __str__(self):
        player_name = f"{self.player}" if self.player else "Sconosciuto"
        return f"{player_name} - {self.fundamental} ({self.outcome})"


TEAM_CHOICES = [("home", "Casa"), ("guests", "Ospiti")]


class Rally(models.Model):
    """One point of a set: who served, in which rotation, who won. Source of side-out and break-point stats."""
    set = models.ForeignKey('Set', on_delete=models.CASCADE, related_name='rallies')
    number = models.PositiveIntegerField(verbose_name="Numero")
    serving = models.CharField(max_length=6, choices=TEAM_CHOICES, verbose_name="Battuta")
    rotation = models.PositiveSmallIntegerField(verbose_name="Rotazione")  # 0..5, side-outs won since the start of the set
    p1_player = models.ForeignKey('Player', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
                                  verbose_name="Giocatore in posizione 1")
    winner = models.CharField(max_length=6, choices=TEAM_CHOICES, verbose_name="Vincitore")
    home_score = models.PositiveIntegerField(verbose_name="Punteggio casa dopo il punto")
    guest_score = models.PositiveIntegerField(verbose_name="Punteggio ospiti dopo il punto")
    cause = models.CharField(max_length=40, blank=True, default='', verbose_name="Causa")  # e.g. "Attacco ++"
    client_id = models.CharField(max_length=64, unique=True, verbose_name="Id client")

    class Meta:
        ordering = ["set", "number", "id"]
        verbose_name = "Rally"
        verbose_name_plural = "Rally"

    def __str__(self):
        return f"Rally {self.number} ({self.home_score}-{self.guest_score}, vince {self.winner})"


class User(models.Model):
    email = models.EmailField(max_length=100)
    password = models.CharField(max_length=100)
    name = models.CharField(max_length=100)    
    surname = models.CharField(max_length=100)
    # matches = models.ManyToManyField(Match, related_name='users')
    # players = models.ManyToManyField(Player, related_name='users')
    # teams = models.ManyToManyField(Team, related_name='users')