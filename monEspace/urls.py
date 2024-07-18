# monEspace/urls.py
from django.urls import path
from . import views

app_name = 'monEspace'  # Ceci définit un namespace pour l'application

urlpatterns = [
    path('espacenote/', views.espacenote_view, name='espacenote'),
    path('espacenote/add-course/', views.add_course, name='add_course'),
    # ... autres urls ...
]