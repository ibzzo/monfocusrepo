# Generated by Django 5.0.6 on 2024-07-08 13:50

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("monEspace", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="note",
            name="content",
            field=models.TextField(blank=True),
        ),
    ]