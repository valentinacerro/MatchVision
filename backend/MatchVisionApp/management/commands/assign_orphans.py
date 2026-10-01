from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from MatchVisionApp.models import Match, Player, Team


class Command(BaseCommand):
    help = "Assegna a un account i giocatori, le squadre e le partite senza proprietario (dati creati prima del login)"

    def add_arguments(self, parser):
        parser.add_argument('email', help="Email dell'account che riceve i dati")

    def handle(self, *args, email, **options):
        user = get_user_model().objects.filter(username=email.strip().lower()).first()
        if user is None:
            raise CommandError(f"Nessun account con email {email}: registrati prima dall'app")
        with transaction.atomic():
            counts = {model._meta.verbose_name_plural: model.objects.filter(user=None).update(user=user)
                      for model in (Player, Team, Match)}
        summary = ', '.join(f"{n} {name.lower()}" for name, n in counts.items())
        self.stdout.write(self.style.SUCCESS(f"Assegnati a {user.username}: {summary}"))
