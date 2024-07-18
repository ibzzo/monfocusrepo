# Generated by Django 5.0.6 on 2024-07-12 12:58

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="subject",
            name="id",
            field=models.IntegerField(
                choices=[
                    (1, "Mathématiques"),
                    (2, "Français"),
                    (3, "Anglais"),
                    (4, "Physique"),
                    (5, "Chimie"),
                    (6, "Aide aux devoirs"),
                    (7, "Allemand"),
                    (8, "Comptabilité"),
                    (9, "Droit"),
                    (10, "Économie"),
                    (11, "Histoire"),
                    (12, "Coaching"),
                    (13, "Orientation"),
                    (14, "Espagnol"),
                    (15, "SVT/Biologie"),
                    (16, "Cours de musique"),
                ],
                primary_key=True,
                serialize=False,
            ),
        ),
    ]