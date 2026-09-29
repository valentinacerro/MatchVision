from django.contrib import admin
from .models import Player, Team, Match, Set, Touch, Rally

admin.site.register(Player)
admin.site.register(Team)
admin.site.register(Match)
admin.site.register(Set)
admin.site.register(Touch)
admin.site.register(Rally)
