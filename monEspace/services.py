import numpy as np
from sentence_transformers import SentenceTransformer
import faiss
from .models import Note
import re
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
import nltk
from bs4 import BeautifulSoup

# nltk.download('punkt')
# nltk.download('stopwords')

model = SentenceTransformer('all-mpnet-base-v2')

def clean_html(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    return soup.get_text()

def preprocess_text(text):
    # Nettoyer le HTML
    text = clean_html(text)
    
    # Convertir en minuscules et supprimer les caractères spéciaux
    text = re.sub(r'[^\w\s]', '', text.lower())
    
    # Tokenization et suppression des stop words
    stop_words = set(stopwords.words('french'))
    word_tokens = word_tokenize(text)
    filtered_text = [w for w in word_tokens if not w in stop_words]
    
    return ' '.join(filtered_text)

def generate_embedding(text):
    preprocessed_text = preprocess_text(text)
    return model.encode(preprocessed_text)

def update_note_embedding(note):
    content = f"{note.title} {clean_html(note.content)}"
    for attachment in note.attachments.all():
        content += f" {attachment.file_type} {attachment.file.name}"
    
    embedding = generate_embedding(content)
    note.set_embedding(embedding)
    note.save()

def semantic_search(query, user):
    query_embedding = generate_embedding(query)
    notes = list(Note.objects.filter(user=user))
    embeddings = [note.get_embedding() for note in notes if note.get_embedding() is not None]
    
    if not embeddings:
        return []

    embeddings_array = np.array(embeddings)
    
    faiss.normalize_L2(embeddings_array)
    index = faiss.IndexFlatIP(embeddings_array.shape[1])
    index.add(embeddings_array)
    
    k = min(3, len(embeddings))
    scores, indices = index.search(np.array([query_embedding]), k)
    
    results = []
    for i, idx in enumerate(indices[0]):
        note = notes[int(idx)]
        score = float(scores[0][i])
        clean_content = clean_html(note.content)
        results.append({
            'id': note.id,
            'title': note.title,
            'content_preview': clean_content[:100] + '...',
            'score': score
        })
    
    return sorted(results, key=lambda x: x['score'], reverse=True)