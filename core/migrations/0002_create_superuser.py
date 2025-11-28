# core/migrations/0002_create_superuser.py
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import migrations
import os

def create_superuser(apps, schema_editor):
    User = get_user_model()
    username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
    password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")
    email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")
    if username and password and not User.objects.filter(username=username).exists():
        User.objects.create_superuser(username=username, email=email, password=password)

class Migration(migrations.Migration):
    dependencies = [("core", "0001_bootstrap_socialapp")]
    operations = [migrations.RunPython(create_superuser, migrations.RunPython.noop)]
