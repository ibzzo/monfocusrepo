from django.http import HttpResponse, JsonResponse
from django.shortcuts import render, redirect
from django.contrib.auth import login
from django.urls import reverse
from django.views.decorators.csrf import csrf_protect
from .forms import CustomAuthenticationForm, Step1Form, Step2Form, Step3Form, Step4Form, Step5Form
from .forms import NiveauScolaireForm, MatieresForm, AccompagnementForm, CoordonneeForm
from django.contrib.auth.models import User
from .models import Subject, Teacher, TeacherSubject, Visitor, Level, CoursType, VisitorSubjectCourse
from django.core.mail import send_mail
from django.conf import settings
from django.db import transaction
from django.contrib import messages
import string
from monEspace.models import Note

def generate_password(length=10):
    characters = string.ascii_letters + string.digits + string.punctuation
    return 'Baba0453534#'

@csrf_protect
def login_view(request):
    if request.method == 'POST':
        form = CustomAuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            if 'remember_me' in form.cleaned_data and form.cleaned_data['remember_me']:
                request.session.set_expiry(1209600)  # 2 weeks
            else:
                request.session.set_expiry(0)  # Browser close
            return redirect(reverse('monEspace:espacenote'))  # Redirect to the espacenote view
        else:
            messages.error(request, "Veuillez vérifier vos identifiants et réessayer.")
    else:
        form = CustomAuthenticationForm()
    
    return render(request, 'accounts/login_view.html', {'form': form})

def postuler(request, step=1):
    step = int(step)
    if request.method == 'POST':
        if step == 1:
            form = Step1Form(request.POST)
            if form.is_valid():
                request.session['profile_type'] = form.cleaned_data['profile_type']
                return redirect('postuler_with_step', step=2)

        elif step == 2:
            form = Step2Form(request.POST)
            if form.is_valid():
                subjects = [int(subject_id) for subject_id in form.cleaned_data['subjects']]
                request.session['subjects'] = subjects
                return redirect('postuler_with_step', step=3)

        elif step == 3:
            form = Step3Form(request.POST)
            if form.is_valid():
                request.session['niveaux'] = form.cleaned_data['niveaux']
                return redirect('postuler_with_step', step=4)

        elif step == 4:
            form = Step4Form(request.POST, request.FILES)
            if form.is_valid():
                request.session.update({
                    'bac3': True if form.cleaned_data['bac3'] == 'oui' else False,
                    'cv': form.cleaned_data['cv'].name if form.cleaned_data['cv'] else None,
                    'dernier_diplome': form.cleaned_data['dernier_diplome']
                })
                return redirect('postuler_with_step', step=5)

        elif step == 5:
            form = Step5Form(request.POST)
            if form.is_valid():
                with transaction.atomic():
                    # Create teacher profile
                    teacher = Teacher(
                        civilite=form.cleaned_data['civilite'],
                        first_name=form.cleaned_data['prenom'],
                        last_name=form.cleaned_data['nom'],
                        birth_date=form.cleaned_data['date_naissance'],
                        email=form.cleaned_data['email'],
                        phone_number=form.cleaned_data['telephone'],
                        city=form.cleaned_data['ville'],
                        status=request.session['profile_type'],
                        has_bac_plus_trois=request.session.get('bac3', False),
                        highest_degree_earned=request.session.get('dernier_diplome', ''),
                        cv=request.session.get('cv')
                    )
                    
                    # Create user and link to teacher
                    username = f"{form.cleaned_data['prenom']}.{form.cleaned_data['nom']}".lower()
                    user = User.objects.create_user(
                        username=username,
                        email=form.cleaned_data['email'],
                        password=generate_password(),
                        first_name=form.cleaned_data['prenom'],
                        last_name=form.cleaned_data['nom']
                    )
                    teacher.user = user
                    teacher.save()
                    
                    # Link subjects and levels
                    subject_ids = request.session.get('subjects', [])
                    levels = ', '.join(request.session.get('niveaux', []))

                    # Récupérer tous les sujets en une seule requête
                    subjects = Subject.objects.filter(id__in=subject_ids)

                    # Créer les objets TeacherSubject en masse
                    teacher_subjects = []
                    for subject in subjects:
                        teacher_subjects.append(
                            TeacherSubject(
                                teacher=teacher,
                                subject=subject,
                                levels=levels
                            )
                        )

                    # Utiliser bulk_create pour insérer tous les objets en une seule requête
                    with transaction.atomic():
                        TeacherSubject.objects.bulk_create(teacher_subjects)

                    # Vérifier s'il y a des IDs manquants
                    missing_ids = set(subject_ids) - set(subjects.values_list('id', flat=True))
                    if missing_ids:
                        print(f"Attention : Les sujets avec les IDs {missing_ids} n'existent pas.")

                    #send email
                    send_welcome_email(user, user.password)    
                # Clear session data
                for key in ['profile_type', 'subjects', 'niveaux', 'bac3', 'cv', 'dernier_diplome']:
                    request.session.pop(key, None)

                return JsonResponse({'success': True})

    else:
        # Initialize or fetch the form based on step
        forms = [Step1Form, Step2Form, Step3Form, Step4Form, Step5Form]
        form = forms[step-1]()

    return render(request, 'accounts/postuler.html', {'form': form, 'step': step})

def handle_form_step(request, step, form_type):
    session_key = f'{form_type}_form_step'
    template_name = f'accounts/{form_type}_form.html'

    if request.method == 'POST':
        if step == 1:
            form = NiveauScolaireForm(request.POST)
            if form.is_valid():
                request.session['niveau'] = form.cleaned_data['niveau']
                request.session[session_key] = 2
                return redirect(reverse(f'{form_type}_form_step', kwargs={'step': 2}))
        elif step == 2:
            form = MatieresForm(request.POST)
            if form.is_valid():
                request.session['matieres'] = form.cleaned_data['matieres']
                request.session[session_key] = 3
                return redirect(reverse(f'{form_type}_form_step', kwargs={'step': 3}))
        elif step == 3:
            form = AccompagnementForm(request.POST)
            if form.is_valid():
                request.session['types_cours'] = form.cleaned_data['types_cours']
                request.session[session_key] = 4
                return redirect(reverse(f'{form_type}_form_step', kwargs={'step': 4}))
        elif step == 4:
            form = CoordonneeForm(request.POST)
            if form.is_valid():
                with transaction.atomic():
                    email = form.cleaned_data['email']
                    
                    # Créer un visiteur (cela créera aussi un utilisateur grâce à la méthode save personnalisée)
                    visitor = Visitor(
                        email=email,
                        profile_type='parent' if form_type == 'parent' else 'student',
                        first_name=form.cleaned_data['prenom'],
                        last_name=form.cleaned_data['nom'],
                        phone_number=form.cleaned_data.get('telephone', ''),
                        city_or_postal_code=form.cleaned_data['ville_ou_code_postal']
                    )
                    user = User.objects.create_user(
                        username=email,
                        email=email,
                        password=generate_password(),
                        first_name=visitor.first_name,
                        last_name=visitor.last_name
                    )
                    visitor.user = user
                    visitor.save()

                    # Ajouter le niveau
                    niveau = Level.objects.get_or_create(name=request.session.get('niveau', ''))[0]
                    visitor.level = niveau
                    visitor.save()

                    # Ajouter les matières et types de cours
                    for matiere in request.session.get('matieres', []):
                        subject = Subject.objects.get_or_create(name=matiere)[0]
                        for type_cours in request.session.get('types_cours', []):
                            cours_type = CoursType.objects.get_or_create(name=type_cours)[0]
                            VisitorSubjectCourse.objects.create(
                                visitor=visitor,
                                subject=subject,
                                cours_type=cours_type
                            )

                # Envoyer un email avec les informations de connexion
                password = visitor.user.password  # Le mot de passe généré automatiquement
                send_welcome_email(visitor.user, password)
                
                # Réinitialiser la session
                request.session[session_key] = 1

                return JsonResponse({'success': True})

            else:
                # Afficher les erreurs
                return render(request, template_name, {'form': form, 'step': step})
    else:
        if step == 1:
            form = NiveauScolaireForm()
        elif step == 2:
            form = MatieresForm()
        elif step == 3:
            form = AccompagnementForm()
        elif step == 4:
            form = CoordonneeForm()
    
    return render(request, template_name, {'form': form, 'step': step})

def parent_form_view(request, step=1):
    return handle_form_step(request, step, 'parent')

def eleve_etudiant_form_view(request, step=1):
    return handle_form_step(request, step, 'eleve_etudiant')

def send_welcome_email(user, password):
    subject = 'Bienvenue sur monFocusprof'
    message = f"""
    Bonjour {user.first_name},

    Votre compte a été créé sur monFocusprof.

    Nom d'utilisateur : {user.username}
    Mot de passe temporaire : {password}

    Veuillez vous connecter et changer votre mot de passe dès que possible.

    Cordialement,
    L'équipe monFocusprof
    """
    from_email = settings.DEFAULT_FROM_EMAIL
    recipient_list = [user.email]
    
    send_mail(subject, message, from_email, recipient_list)