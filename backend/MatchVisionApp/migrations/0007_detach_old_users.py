from django.db import migrations


def detach_old_users(apps, schema_editor):
    # The old users table (plain-text passwords) goes away: its ids mean nothing in Django's users.
    # Data without an owner is assigned to an account with: manage.py assign_orphans <email>
    for name in ['Player', 'Team', 'Match']:
        apps.get_model('MatchVisionApp', name).objects.exclude(user=None).update(user=None)


class Migration(migrations.Migration):
    # On its own: Postgres refuses to change a foreign key in the same transaction that updated its rows

    dependencies = [
        ('MatchVisionApp', '0006_event_details'),
    ]

    operations = [
        migrations.RunPython(detach_old_users, migrations.RunPython.noop),
    ]
