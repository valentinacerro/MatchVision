from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from .models import Player, Team, Match, Set, Touch, Event, Rally


class OwnedField(serializers.PrimaryKeyRelatedField):
    """A reference (by id) that accepts only objects of the logged-in user.
    owner: lookup from the object to its user, e.g. 'match__user' for a set."""

    def __init__(self, owner='user', **kwargs):
        self.owner = owner
        super().__init__(**kwargs)

    def get_queryset(self):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return super().get_queryset().none()
        return super().get_queryset().filter(**{self.owner: request.user})


# --- PLAYER ---
class PlayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Player
        exclude = ['user']


# --- TEAM ---
class TeamSerializer(serializers.ModelSerializer):
    playersList = OwnedField(
        queryset=Player.objects.all(), many=True, write_only=True
    )
    
    players = PlayerSerializer(many=True, read_only=True, source='playersList')

    class Meta:
        model = Team
        fields = ['id', 'name', 'playersList', 'players']


# --- MATCH ---
class MatchSerializer(serializers.ModelSerializer):
    team = TeamSerializer(read_only=True)
    team_id = OwnedField(
        queryset=Team.objects.all(),
        source='team'
    )

    class Meta:
        model = Match
        fields = ['id', 'name', 'timestamp', 'team', 'team_id', 'results', 'sets_to_win', 'set_points', 'tiebreak_points', 'live_state', 'client_id']
        # Duplicates are handled in the view, which returns the match already saved
        extra_kwargs = {'client_id': {'validators': []}}


class MatchUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Match
        fields = ['results', 'live_state']


# --- SET ---
class SetSerializer(serializers.ModelSerializer):
    match = OwnedField(queryset=Match.objects.all())
    players = PlayerSerializer(many=True, read_only=True)
    player_ids = OwnedField(
        many=True,
        queryset=Player.objects.all(),
        source='players',
        write_only=True,
        required=False
    )

    class Meta:
        model = Set
        fields = ['id', 'match', 'number', 'players', 'player_ids', 'home_score', 'guest_score', 'client_id']
        # Duplicates are handled in the view, which returns the set already saved
        extra_kwargs = {'client_id': {'validators': []}}


class SetUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Set
        fields = ['home_score', 'guest_score']


# --- TOUCH ---
class TouchSerializer(serializers.ModelSerializer):
    set = OwnedField(owner='match__user', queryset=Set.objects.all())
    player = OwnedField(queryset=Player.objects.all())


    class Meta:
        model = Touch
        fields = ['id', 'set', 'player', 'fundamental', 'outcome', 'client_id']
        # Duplicates are handled in the view, which returns the touch already saved
        extra_kwargs = {'client_id': {'validators': [], 'allow_blank': False}}


# --- EVENT ---
class EventSerializer(serializers.ModelSerializer):
    set = OwnedField(owner='match__user', queryset=Set.objects.all(), allow_null=True, required=False)

    class Meta:
        model = Event
        fields = ['id', 'event_type', 'set', 'team', 'details', 'home_score', 'guest_score', 'client_id', 'created_at']
        # Duplicates are handled in the view, which returns the event already saved
        extra_kwargs = {'client_id': {'validators': []}}


# --- USER ---
class AccountSerializer(serializers.ModelSerializer):
    """The logged-in user. The email is also the username."""
    name = serializers.CharField(source='first_name', required=False, allow_blank=True, max_length=150)
    surname = serializers.CharField(source='last_name', required=False, allow_blank=True, max_length=150)

    class Meta:
        model = get_user_model()
        fields = ['id', 'email', 'name', 'surname']


class RegisterSerializer(AccountSerializer):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)

    class Meta(AccountSerializer.Meta):
        fields = AccountSerializer.Meta.fields + ['password']

    def validate_email(self, value):
        email = value.strip().lower()
        if get_user_model().objects.filter(username=email).exists():
            raise serializers.ValidationError("Esiste già un account con questa email")
        return email

    def validate(self, attrs):
        user = get_user_model()(username=attrs['email'], email=attrs['email'],
                                first_name=attrs.get('first_name', ''), last_name=attrs.get('last_name', ''))
        validate_password(attrs['password'], user)
        return attrs

    def create(self, validated_data):
        return get_user_model().objects.create_user(
            username=validated_data['email'], email=validated_data['email'], password=validated_data['password'],
            first_name=validated_data.get('first_name', ''), last_name=validated_data.get('last_name', ''))


# --- RALLY ---
class RallyReasonSerializer(serializers.ModelSerializer):
    # Chosen by the scout after the point (why the opponent won it, or which error of theirs gave it to us)
    class Meta:
        model = Rally
        fields = ['reason', 'cause']


class RallySerializer(serializers.ModelSerializer):
    set = OwnedField(owner='match__user', queryset=Set.objects.all())
    p1_player = OwnedField(queryset=Player.objects.all(), allow_null=True, required=False)

    class Meta:
        model = Rally
        fields = ['id', 'set', 'number', 'serving', 'rotation', 'p1_player', 'winner', 'home_score', 'guest_score', 'cause', 'reason', 'client_id']
        # Duplicates are handled in the view, which returns the rally already saved
        extra_kwargs = {'client_id': {'validators': []}}
