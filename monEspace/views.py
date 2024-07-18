from datetime import timezone
import json
import os
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import ChatMessage, ChatSession, Note, Attachment, TodoItem
from .serializers import NoteSerializer, AttachmentSerializer, TodoItemSerializer
from django.db.models import Q
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import ValidationError, PermissionDenied
from .services import update_note_embedding, semantic_search
import logging
from django.shortcuts import get_object_or_404, render
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_POST
from accounts.models import Visitor, Subject, Level, CoursType, VisitorSubjectCourse, Teacher
from django.http import JsonResponse
from transformers import pipeline

logger = logging.getLogger(__name__)

class TodoItemViewSet(viewsets.ModelViewSet):
    serializer_class = TodoItemSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        user = self.request.user
        queryset = TodoItem.objects.all()
        
        if hasattr(user, 'teacher'):
            queryset = queryset.filter(course__teacher=user.teacher)
        elif hasattr(user, 'visitor'):
            queryset = queryset.filter(course__visitor=user.visitor)
        else:
            return TodoItem.objects.none()
        
        return queryset

    def create(self, request, *args, **kwargs):
        course_id = request.data.get('course')
        if not course_id:
            raise ValidationError({"course": "Un cours doit être spécifié."})

        try:
            course = VisitorSubjectCourse.objects.get(id=course_id)
        except VisitorSubjectCourse.DoesNotExist:
            raise ValidationError({"course": "Le cours spécifié n'existe pas."})

        user = request.user
        if not hasattr(user, 'teacher'):
            raise PermissionDenied("Seuls les enseignants peuvent créer des tâches.")
        if course.teacher != user.teacher:
            raise PermissionDenied("Vous n'êtes pas autorisé à ajouter des tâches à ce cours.")

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer, course)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer, course):
        serializer.save(created_by=self.request.user, course=course)

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        user = request.user
        if hasattr(user, 'teacher'):
            if obj.course.teacher != user.teacher:
                raise PermissionDenied("Vous n'êtes pas autorisé à modifier cette tâche.")
        elif hasattr(user, 'visitor'):
            if obj.course.visitor != user.visitor:
                raise PermissionDenied("Vous n'êtes pas autorisé à accéder à cette tâche.")
        else:
            raise PermissionDenied("Utilisateur non autorisé.")
        
    def destroy(self, request, *args, **kwargs):
        try:
            instance = self.get_object()
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            print(f"Error deleting todo item: {str(e)}")
            return Response({"detail": str(e)}, status=status.HTTP_404_NOT_FOUND)

    def perform_destroy(self, instance):
        instance.delete()

    

@login_required
@require_POST
def add_course(request):
    try:
        visitor = request.user.visitor
        subject_id = request.POST.get('subject_id')
        course_types = request.POST.getlist('course_types')
        
        subject = get_object_or_404(Subject, id=subject_id)
        
        for course_type in course_types:
            course_type_obj = get_object_or_404(CoursType, name=course_type)
            VisitorSubjectCourse.objects.create(
                visitor=visitor,
                subject=subject,
                cours_type=course_type_obj
            )
        
        return JsonResponse({'success': True, 'message': 'Cours ajouté avec succès'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)

@login_required
def espacenote_view(request):
    user = request.user
    is_teacher = hasattr(user, 'teacher')
    
    if is_teacher:
        courses = VisitorSubjectCourse.objects.filter(teacher=user.teacher)
        template = 'monEspace/teacher_espacenote.html'
    else:
        try:
            visitor = user.visitor
            courses = VisitorSubjectCourse.objects.filter(visitor=visitor).select_related(
                'teacher__user', 'subject', 'cours_type'
            )
            template = 'monEspace/espacenote.html'
        except Visitor.DoesNotExist:
            return render(request, 'monEspace/error.html', {'message': 'Profil utilisateur non trouvé'})

    context = {
        'is_teacher': is_teacher,
        'courses': courses,
        'first_name': user.first_name
    }
    return render(request, template, context)

class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    queryset = Note.objects.none()

    def get_queryset(self):
        user = self.request.user
        if hasattr(user, 'teacher'):
            return Note.objects.filter(course__teacher=user.teacher)
        else:
            return Note.objects.filter(user=user)

    def perform_create(self, serializer):
        course_id = self.request.data.get('course')
        course = None
        if course_id:
            user = self.request.user
            if hasattr(user, 'teacher'):
                course = get_object_or_404(VisitorSubjectCourse, id=course_id, teacher=user.teacher)
            else:
                course = get_object_or_404(VisitorSubjectCourse, id=course_id, visitor__user=user)
        note = serializer.save(user=self.request.user, course=course)
        update_note_embedding(note)

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except ValidationError as e:
            logger.error(f"Validation error: {e.detail}")
            raise

    def perform_update(self, serializer):
        note = serializer.save()
        update_note_embedding(note)

    @action(detail=False, methods=['GET'])
    def search(self, request):
        query = request.query_params.get('q', '')
        if len(query) < 4:
            return Response([])
        results = semantic_search(query, request.user)
        serialized_results = []
        for result in results[:3]:
            note = Note.objects.get(id=result['id'])
            serializer = self.get_serializer(note)
            serialized_results.append({
                **result,
                'full_note': serializer.data
            })
        return Response(serialized_results)      

    @action(detail=True, methods=['GET'])
    def get_note(self, request, pk=None):
        try:
            user = request.user
            if hasattr(user, 'teacher'):
                note = Note.objects.get(pk=pk, course__teacher=user.teacher)
            else:
                note = Note.objects.get(pk=pk, user=user)
            serializer = self.get_serializer(note)
            return Response(serializer.data)
        except Note.DoesNotExist:
            return Response({'error': 'Note not found'}, status=404)

    @action(detail=False, methods=['GET'])
    def course_notes(self, request):
        course_id = request.query_params.get('course_id')
        if not course_id or course_id == 'null':
            return Response({'error': 'Valid course_id is required'}, status=400)
        
        try:
            course_id = int(course_id)
            user = request.user
            if hasattr(user, 'teacher'):
                course = get_object_or_404(VisitorSubjectCourse, id=course_id, teacher=user.teacher)
                notes = Note.objects.filter(course=course)
            else:
                course = get_object_or_404(VisitorSubjectCourse, id=course_id, visitor__user=user)
                notes = Note.objects.filter(user=user, course=course)
            serializer = self.get_serializer(notes, many=True)
            return Response(serializer.data)
        except ValueError:
            return Response({'error': 'Invalid course_id'}, status=400)   

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)     

class AttachmentViewSet(viewsets.ModelViewSet):
    serializer_class = AttachmentSerializer
    permission_classes = [IsAuthenticated]
    queryset = Attachment.objects.none()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context.update({"request": self.request})
        return context

    def get_queryset(self):
        user = self.request.user
        if hasattr(user, 'teacher'):
            return Attachment.objects.filter(note__course__teacher=user.teacher)
        else:
            return Attachment.objects.filter(note__user=user)

    def perform_create(self, serializer):
        try:
            note_id = self.request.data.get('note_id')
            file_type = self.request.data.get('type')
            
            if note_id:
                user = self.request.user
                if hasattr(user, 'teacher'):
                    note = Note.objects.get(id=note_id, course__teacher=user.teacher)
                else:
                    note = Note.objects.get(id=note_id, user=user)
                if note.user != self.request.user and not hasattr(user, 'teacher'):
                    raise ValidationError({"error": "Vous ne pouvez ajouter des attachements qu'à vos propres notes."})
            
            attachment = serializer.save(note_id=note_id, file_type=file_type)
            update_note_embedding(attachment.note)
            return attachment
        except Exception as e:
            raise ValidationError({"error": str(e)})
    
    def perform_update(self, serializer):
        attachment = serializer.save()
        update_note_embedding(attachment.note)

    def perform_destroy(self, instance):
        note = instance.note
        instance.delete()
        update_note_embedding(note)


from openai import OpenAI
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import StreamingHttpResponse
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from .models import ChatSession, ChatMessage, Note
from .services import semantic_search
from django.conf import settings
from huggingface_hub import InferenceClient

from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv('openai_API_KEY')
hf_token = os.getenv('HF_TOKEN')

# Initialiser le client OpenAI
#client = OpenAI(api_key="")


class ChatViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]
    
    @action(detail=False, methods=['POST'])
    def chat(self, request):
        """
        Gère les requêtes de chat et retourne une réponse en streaming.
        """
        query = request.data.get('message', '')
        session_id = request.data.get('session_id')
        user = request.user
        
        chat_session = self._get_or_create_session(session_id, user)
        self._save_user_message(chat_session, query)
        
        search_results = semantic_search(query, user)
        context, related_note = self._process_search_results(search_results)
        
        return StreamingHttpResponse(
            self._generate_ai_response_stream(chat_session, query, context, related_note),
            content_type='text/event-stream'
        )

    def _get_or_create_session(self, session_id, user):
        """
        Récupère une session existante ou en crée une nouvelle.
        """
        if session_id:
            return get_object_or_404(ChatSession, id=session_id, user=user)
        return ChatSession.objects.create(user=user)

    def _save_user_message(self, chat_session, content):
        """
        Enregistre le message de l'utilisateur dans la base de données.
        """
        ChatMessage.objects.create(
            session=chat_session,
            role='user',
            content=content
        )

    def _process_search_results(self, search_results):
        """
        Traite les résultats de la recherche sémantique.
        """
        if not search_results:
            return "", None
        
        context = " ".join([result['content_preview'] for result in search_results[:3]])
        related_note = Note.objects.get(id=search_results[0]['id'])
        return context, related_note
    
    def _generate_ai_response_stream(self, chat_session, query, context='', related_note=None):
        """
        Génère la réponse de l'IA en streaming en utilisant l'API Hugging Face.
        """
        messages = self._prepare_messages(chat_session, query, context)
        
        try:
            # Initialisez le client Hugging Face
            token = hf_token
            client = InferenceClient(model="mistralai/Mixtral-8x7B-Instruct-v0.1", token=token)
            
            # Préparez l'entrée pour le modèle
            input_text = self._format_input_for_mixtral(messages)
            
            # Générez la réponse en streaming
            full_response = ""
            for chunk in client.text_generation(input_text, max_new_tokens=300, temperature=0.7, stream=True):
                full_response += chunk
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            
            self._save_ai_message(chat_session, full_response, related_note)
            
            yield f"data: {json.dumps({'type': 'source', 'source': related_note.id if related_note else None})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"
        
        except Exception as e:
            print(f"Erreur lors de la génération de la réponse : {str(e)}")
            yield f"data: {json.dumps({'content': 'Désolé, je n\'ai pas pu générer une réponse appropriée. Pouvez-vous reformuler votre question ?'})}\n\n"
            yield f"data: {json.dumps({'type': 'end'})}\n\n"

    def _format_input_for_mixtral(self, messages):
        formatted_messages = []
        for msg in messages:
            if msg['role'] == 'system':
                formatted_messages.append(f"[INST] {msg['content']} [/INST]")
            elif msg['role'] == 'user':
                formatted_messages.append(f"[INST] {msg['content']} [/INST]")
            elif msg['role'] == 'assistant':
                formatted_messages.append(msg['content'])
        return "\n".join(formatted_messages)

    # def _generate_ai_response_stream(self, chat_session, query, context='', related_note=None):
    #     """
    #     Génère la réponse de l'IA en streaming.
    #     """
    #     messages = self._prepare_messages(chat_session, query, context)
        
    #     try:
    #         stream = client.chat.completions.create(
    #             model="gpt-3.5-turbo",
    #             messages=messages,
    #             max_tokens=150,
    #             n=1,
    #             stop=None,
    #             temperature=0.7,
    #             stream=True
    #         )
            
    #         collected_messages = []
    #         for chunk in stream:
    #             if chunk.choices[0].delta.content is not None:
    #                 content = chunk.choices[0].delta.content
    #                 collected_messages.append(content)
    #                 yield f"data: {json.dumps({'content': content})}\n\n"
            
    #         full_response = ''.join(collected_messages)
    #         self._save_ai_message(chat_session, full_response, related_note)
            
    #         yield f"data: {json.dumps({'type': 'source', 'source': related_note.id if related_note else None})}\n\n"
    #         yield f"data: {json.dumps({'type': 'end'})}\n\n"
        
    #     except Exception as e:
    #         print(f"Erreur lors de la génération de la réponse : {str(e)}")
    #         yield f"data: {json.dumps({'content': 'Désolé, je n\'ai pas pu générer une réponse appropriée. Pouvez-vous reformuler votre question ?'})}\n\n"
    #         yield f"data: {json.dumps({'type': 'end'})}\n\n"

    def _prepare_messages(self, chat_session, query, context):
        """
        Prépare les messages pour l'API OpenAI.
        """
        recent_messages = chat_session.messages.order_by('timestamp')[:5]
        
        messages = [
                    {"role": "system", "content": """
                        Tu es un tuteur en ligne. Ton rôle est d'aider les étudiants à apprendre en posant des questions et en les guidant, sans donner directement les réponses. Voici comment tu dois te comporter :

                        1. **Poser des questions** :
                        - Demande des questions pour faire réfléchir l'étudiant et l'aider à trouver les réponses par lui-même.
                        - Adapte tes questions en fonction du niveau de l'étudiant.

                        2. **Découper les problèmes** :
                        - Décompose les problèmes en petites étapes compréhensibles.
                        - Demande à l'étudiant de résoudre chaque étape une par une.

                        3. **Encourager les efforts** :
                        - Rappelle à l'étudiant que faire des erreurs est normal et fait partie de l'apprentissage.
                        - Encourage l'étudiant à persévérer et félicite ses efforts.

                        4. **Fournir des ressources** :
                        - Propose des vidéos, articles, ou autres ressources pour aider l'étudiant à comprendre les sujets.
                        - Utilise des sources fiables et éducatives.

                        5. **Vérifier les réponses** :
                        - Utilise des outils pour vérifier les calculs et t'assurer que tout est correct.
                        - Si une erreur est détectée, demande à l'étudiant de réévaluer son travail et guide-le pour trouver l'erreur.

                        6. **Ne jamais donner directement la réponse** :
                        - Aide l'étudiant à réfléchir et à arriver à la solution par lui-même.
                        - Si l'étudiant est bloqué, donne des indices ou pose des questions supplémentaires pour le débloquer.
                    """},
                    {"role": "system", "content": f"Contexte des notes pertinentes : {context}"}
                    ]
        
        for msg in recent_messages:
            messages.append({"role": msg.role, "content": msg.content})
        
        messages.append({"role": "user", "content": query})
        return messages

    def _save_ai_message(self, chat_session, content, related_note):
        """
        Enregistre la réponse de l'IA dans la base de données.
        """
        ChatMessage.objects.create(
            session=chat_session,
            role='assistant',
            content=content,
            related_note=related_note
        )

    @action(detail=False, methods=['POST'])
    def start_session(self, request):
        """
        Démarre une nouvelle session de chat.
        """
        course_id = request.data.get('course_id')
        user = request.user
        
        chat_session = ChatSession.objects.create(user=user, course_id=course_id)
        
        return Response({
            "session_id": chat_session.id,
            "message": "Session de chat démarrée avec succès"
        })

    @action(detail=False, methods=['POST'])
    def end_session(self, request):
        """
        Termine une session de chat existante.
        """
        session_id = request.data.get('session_id')
        
        try:
            chat_session = ChatSession.objects.get(id=session_id, user=request.user)
            chat_session.ended_at = timezone.now()
            chat_session.save()
            return Response({"message": "Session de chat terminée avec succès"})
        except ChatSession.DoesNotExist:
            return Response({"error": "Session de chat non trouvée"}, status=404)