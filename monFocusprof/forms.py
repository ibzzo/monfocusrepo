from django import forms

class InstitutionContactForm(forms.Form):
    institution_name = forms.CharField(max_length=100, label="Nom de l'institution")
    contact_name = forms.CharField(max_length=100, label="Nom du contact")
    email = forms.EmailField(label="Email")
    phone = forms.CharField(max_length=20, label="Téléphone", required=False)
    message = forms.CharField(widget=forms.Textarea, label="Message")