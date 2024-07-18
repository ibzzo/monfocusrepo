from django.shortcuts import render, redirect
from django.core.mail import send_mail
from django.contrib import messages
from .forms import InstitutionContactForm

# Create your views here.

def product_view(request):
    return render(request, 'monFocusprof/product.html')

def index(request):
    return render(request, "monFocusprof/index.html")


def institution_contact_view(request):
    if request.method == 'POST':
        form = InstitutionContactForm(request.POST)
        if form.is_valid():
            # Récupérer les données du formulaire
            institution_name = form.cleaned_data['institution_name']
            contact_name = form.cleaned_data['contact_name']
            email = form.cleaned_data['email']
            phone = form.cleaned_data['phone']
            message = form.cleaned_data['message']

            # Simuler l'envoi d'un email (sera affiché dans la console)
            send_mail(
                subject=f'Nouvelle demande de collaboration de {institution_name}',
                message=f"""
                Nom de l'institution : {institution_name}
                Nom du contact : {contact_name}
                Email : {email}
                Téléphone : {phone}
                Message : {message}
                """,
                from_email='noreply@example.com',
                recipient_list=['admin@example.com'],
                fail_silently=False,
            )

            # Ajouter un message de succès
            messages.success(request, "Votre message a été envoyé avec succès. Nous vous contacterons bientôt.")
            
            # Rediriger vers une page de confirmation ou la même page
            return redirect('institution_contact')

    else:
        form = InstitutionContactForm()

    context = {
        'form': form,
    }
    return render(request, 'monFocusprof/about.html', context)