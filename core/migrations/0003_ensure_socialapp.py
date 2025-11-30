from django.conf import settings
from django.db import migrations
import os


def ensure_socialapp(apps, schema_editor):
    Site = apps.get_model("sites", "Site")
    SocialApp = apps.get_model("socialaccount", "SocialApp")

    hosts = getattr(settings, "ALLOWED_HOSTS", []) or []
    domain = (hosts[0] if hosts else None) or os.environ.get("RENDER_EXTERNAL_HOSTNAME") or "localhost"
    site_id = getattr(settings, "SITE_ID", 1)

    site, _ = Site.objects.update_or_create(
        id=site_id,
        defaults={"domain": domain, "name": domain},
    )

    client_id = os.environ.get("GOOGLE_CLIENT_ID") or getattr(settings, "GOOGLE_CLIENT_ID", "")
    secret = os.environ.get("GOOGLE_CLIENT_SECRET") or getattr(settings, "GOOGLE_CLIENT_SECRET", "")
    if not client_id or not secret:
        # Without credentials we cannot create the SocialApp; skip silently.
        return

    app, _ = SocialApp.objects.update_or_create(
        provider="google",
        defaults={
            "name": "Google OAuth",
            "client_id": client_id,
            "secret": secret,
        },
    )
    app.sites.set([site])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_create_superuser"),
        ("sites", "0002_alter_domain_unique"),
        ("socialaccount", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(ensure_socialapp, migrations.RunPython.noop),
    ]
