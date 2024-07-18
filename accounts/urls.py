from django.urls import path, include

from . import views

urlpatterns = [
    path("login_view/", views.login_view, name="login_view"),
    path('postuler/<int:step>/', views.postuler, name='postuler_with_step'),
    path('parent-form/<int:step>/', views.parent_form_view, name='parent_form_step'),
    path('eleve-etudiant-form/<int:step>/', views.eleve_etudiant_form_view, name='eleve_etudiant_form_step'),
]