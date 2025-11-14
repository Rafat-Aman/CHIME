from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("drive_integration", "0002_drivemanifest_delete_drivefilemanifest"),
    ]

    operations = [
        migrations.AddField(
            model_name="drivemanifest",
            name="file_checksum",
            field=models.CharField(
                blank=True,
                default="",
                help_text="SHA-256 hash of the full file",
                max_length=128,
            ),
        ),
    ]
