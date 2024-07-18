document.addEventListener('DOMContentLoaded', function() {
    let allNotes = [];
    let courseNotes = [];
    let recentNotes = [];
    let selectedNote = null;
    let currentCourseId = null;
    let chatHistory = [];
    let currentTodos = [];
    let currentSessionId = null;

    // Initialisation
    initTinyMCE();
    fetchAllNotes();
    setupEventListeners();
    checkPendingTodos();

    function initTinyMCE() {
        tinymce.init({
            selector: '#editor',
            height: 500,
            plugins: [
                'advlist autolink lists link image charmap print preview anchor',
                'searchreplace visualblocks code fullscreen',
                'insertdatetime media table paste code help wordcount',
                'mathjax'
            ],
            toolbar: `
                undo redo | formatselect | bold italic backcolor |
                alignleft aligncenter alignright alignjustify |
                bullist numlist outdent indent | removeformat | help |
                mathjax
            `,
            mathjax: {
                lib: 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.4/MathJax.js?config=TeX-AMS_HTML',
                symbols: {start: '\\(', end: '\\)'},
                className: 'math-tex'
            },
            setup: function(editor) {
                editor.on('change', function() {
                    if (selectedNote) {
                        selectedNote.content = editor.getContent();
                    }
                });
            },
            extended_valid_elements: 'span[*]',
        });
    }

    function setupEventListeners() {
        document.getElementById('courseViewBtn').addEventListener('click', showCourseView);
        document.getElementById('newNoteBtn').addEventListener('click', createNewNote);
        document.getElementById('searchBtn').addEventListener('click', toggleSearch);
        document.getElementById('chatBtn').addEventListener('click', toggleChat);
        document.getElementById('todoBtn').addEventListener('click', toggleTodo);
        document.getElementById('saveNoteBtn').addEventListener('click', saveNote);
        document.getElementById('addImageBtn').addEventListener('click', () => triggerFileInput('image'));
        document.getElementById('addVideoBtn').addEventListener('click', () => triggerFileInput('video'));
        document.getElementById('addAudioBtn').addEventListener('click', () => triggerFileInput('audio'));
        document.getElementById('closeChatBtn').addEventListener('click', toggleChat);
        document.getElementById('sendChatBtn').addEventListener('click', handleChatSubmit);
        document.getElementById('closeMediaBtn').addEventListener('click', closeMediaOverlay);
        document.getElementById('fileInput').addEventListener('change', handleFileUpload);
        document.getElementById('searchInput').addEventListener('input', debounce(handleSearch, 300));
        document.getElementById('chatInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleChatSubmit();
            }
        });

        document.querySelectorAll('.course-item').forEach(item => {
            item.addEventListener('click', () => {
                const courseId = item.getAttribute('data-course-id');
                if (courseId && courseId !== 'null') {
                    const courseName = item.querySelector('h3').textContent;
                    fetchCourseNotes(courseId, courseName);
                } else {
                    console.error('Invalid course ID');
                }
            });
        });
    }


    function showCourseView() {
        toggleView('courses');
        // Réinitialiser l'état si nécessaire
        recentNotes = [];
        selectedNote = null;
        currentCourseId = null;
        document.getElementById('currentCourseTitle').textContent = '';
        // Vous pouvez ajouter d'autres réinitialisations si nécessaire
    }
    async function fetchAllNotes() {
        try {
            const response = await fetch('/api/notes/');
            allNotes = await response.json();
        } catch (error) {
            console.error('Error fetching all notes:', error);
        }
    }

    async function fetchCourseNotes(courseId, courseName) {
        try {
            currentCourseId = courseId;
            const response = await fetch(`/api/notes/course_notes/?course_id=${courseId}`);
            courseNotes = await response.json();
            updateRecentNotes();
            renderNotes();
            updateCurrentCourseTitle(courseName);
            toggleView('notes');
            fetchTodos(courseId);
            checkPendingTodos(); // Ajoutez cette ligne
        } catch (error) {
            console.error('Error fetching course notes:', error);
        }
    }

    function updateRecentNotes() {
        recentNotes = courseNotes
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .slice(0, 5);
        renderRecentNotes();
    }

    function renderNotes() {
        const allNotesList = document.getElementById('allNotesList');
        allNotesList.innerHTML = '';
        courseNotes.forEach(note => {
            const noteElement = createNoteElement(note);
            allNotesList.appendChild(noteElement);
        });
    }

    function renderRecentNotes() {
        const recentNotesList = document.getElementById('recentNotesList');
        recentNotesList.innerHTML = '';
        recentNotes.forEach(note => {
            const noteElement = createNoteElement(note);
            recentNotesList.appendChild(noteElement);
        });
    }

    function createNoteElement(note) {
        const div = document.createElement('div');
        div.className = `note-item ${selectedNote && selectedNote.id === note.id ? 'selected' : ''}`;
        div.innerHTML = `<span class="icon">📄</span> ${note.title}`;
        div.addEventListener('click', () => selectNote(note));
        return div;
    }

    function selectNote(note) {
        selectedNote = note;
        document.getElementById('noteTitle').textContent = note.title;
        tinymce.get('editor').setContent(note.content || '');
        renderAttachments(note.attachments);
        updateRecentNotes();
        toggleView('editor');
    }

    function renderAttachments(attachments) {
        const attachmentsContainer = document.getElementById('attachments');
        attachmentsContainer.innerHTML = '';
        if (attachments && attachments.length > 0) {
            attachments.forEach(attachment => {
                const button = document.createElement('button');
                button.innerHTML = `
                    <span class="icon">
                        ${attachment.file_type === 'image' ? '🖼️' : 
                        attachment.file_type === 'video' ? '🎥' : 
                        attachment.file_type === 'audio' ? '🎵' : 
                        '📎'}
                    </span>
                    ${attachment.file.split('/').pop()}
                `;
                button.addEventListener('click', () => handleAttachmentClick(attachment));
                attachmentsContainer.appendChild(button);
            });
        }
    }

    function createNewNote() {
        if (!currentCourseId) {
            alert("Veuillez d'abord sélectionner un cours.");
            return;
        }
        const title = prompt("Entrez le titre de votre nouvelle note :");
        if (title) {
            const newNote = { title: title, content: '', attachments: [], course: currentCourseId };
            courseNotes.push(newNote);
            selectNote(newNote);
            updateRecentNotes();
            toggleView('editor');
        }
    }

    async function saveNote() {
        if (selectedNote) {
            try {
                const url = selectedNote.id ? `/api/notes/${selectedNote.id}/` : '/api/notes/';
                const method = selectedNote.id ? 'PUT' : 'POST';
                const response = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({
                        ...selectedNote,
                        course: currentCourseId
                    }),
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const savedNote = await response.json();
                if (selectedNote.id) {
                    courseNotes = courseNotes.map(n => n.id === savedNote.id ? savedNote : n);
                    allNotes = allNotes.map(n => n.id === savedNote.id ? savedNote : n);
                } else {
                    courseNotes.push(savedNote);
                    allNotes.push(savedNote);
                }
                selectedNote = savedNote;
                updateRecentNotes();
                renderNotes();
                alert('Note sauvegardée avec succès');
            } catch (error) {
                console.error('Error saving note:', error);
                alert('Erreur lors de la sauvegarde de la note');
            }
        }
    }

    function toggleView(view) {
        const courseGrid = document.getElementById('courseGrid');
        const noteContent = document.getElementById('noteContent');
        const allNotesList = document.getElementById('allNotesList');
        const todoSidebar = document.getElementById('todoSidebar');
        const notetitle = document.getElementById('noteTitle');
        const recentNotesList = document.getElementById('recentNotesList');
        
        switch(view) {
            case 'courses':
                courseGrid.style.display = 'grid';
                noteContent.style.display = 'none';
                allNotesList.style.display = 'none';
                todoSidebar.style.display = 'none';
                notetitle.style.display = 'none';
                recentNotesList.style.display = 'none';
                break;
            case 'notes':
                courseGrid.style.display = 'none';
                noteContent.style.display = 'none';
                allNotesList.style.display = 'block';
                todoSidebar.style.display = 'block';
                recentNotesList.style.display = 'block';
                break;
            case 'editor':
                courseGrid.style.display = 'none';
                noteContent.style.display = 'block';
                allNotesList.style.display = 'block';
                todoSidebar.style.display = 'none';
                recentNotesList.style.display = 'block';
                break;
        }
    }

    function toggleSearch() {
        const searchOverlay = document.getElementById('searchOverlay');
        searchOverlay.style.display = searchOverlay.style.display === 'none' ? 'flex' : 'none';
    }

    function toggleChat(initialMessage = null) {
        const chatOverlay = document.querySelector('.chat-overlay');
        if (chatOverlay.style.display === 'none') {
            chatOverlay.style.display = 'flex';
            if (!currentSessionId) {
                startNewChatSession(initialMessage);
            } else {
                renderChatHistory();
                if (initialMessage) {
                    handleChatSubmit(initialMessage);
                }
            }
        } else {
            chatOverlay.style.display = 'none';
        }
    }    

    function openChatWithTodos(todos) {
        const todoList = todos.map(todo => `- ${todo.content}`).join('\n');
        const initialMessage = `Faisons les tâches suivantes ensemble :\n${todoList}\nPar quelle tâche voulez-vous commencer ?`;
        toggleChat(initialMessage);
    }

    function toggleTodo() {
        const todoSidebar = document.getElementById('todoSidebar');
        if (todoSidebar.style.display === 'none') {
            todoSidebar.style.display = 'block';
            if (currentCourseId) {
                renderTodos();
            }
        } else {
            todoSidebar.style.display = 'none';
        }
    }

    async function startNewChatSession(initialMessage = null) {
        try {
            const response = await fetch('/api/chat/start_session/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ course_id: currentCourseId }),
            });
            const data = await response.json();
            currentSessionId = data.session_id;
            chatHistory = [];
            renderChatHistory();
            if (initialMessage) {
                handleChatSubmit(initialMessage);
            }
        } catch (error) {
            console.error('Error starting new chat session:', error);
        }
    }

    async function handleChatSubmit(message = null) {
        const chatInput = document.getElementById('chatInput');
        const messageContent = message || chatInput.value.trim();
        if (messageContent === '') return;
    
        addMessageToHistory('user', messageContent);
        renderUserMessage(messageContent);
        chatInput.value = '';
        
        try {
            const response = await fetch('/api/chat/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ 
                    message: messageContent,
                    session_id: currentSessionId
                }),
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiResponseContent = '';
            let source = null;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'end') {
                            break;
                        } else if (data.type === 'source') {
                            source = data.source;
                        } else if (data.content) {
                            aiResponseContent += data.content;
                            updateAIMessageInUI(aiResponseContent, source);
                        }
                    }
                }
            }

            addMessageToHistory('ai', aiResponseContent, source);
            finalizeAIMessageInUI(aiResponseContent, source);

        } catch (error) {
            console.error('Error submitting chat:', error);
        }
    }

    function addMessageToHistory(role, content, source = null) {
        chatHistory.push({ role, content, source });
    }

    function renderChatHistory() {
        const chatMessagesContainer = document.getElementById('chatMessages');
        chatMessagesContainer.innerHTML = '';
        chatHistory.forEach(message => {
            if (message.role === 'user') {
                renderUserMessage(message.content);
            } else {
                renderAIMessage(message.content, message.source);
            }
        });
    }

    function renderUserMessage(content) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message user';
        messageElement.innerHTML = `<div class="message-content"><p>${content}</p></div>`;
        document.getElementById('chatMessages').appendChild(messageElement);
        scrollChatToBottom();
    }

    function renderAIMessage(content, source) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message ai';
        messageElement.innerHTML = `
            <div class="message-content">
                <p>${content}</p>
                ${source ? `<p class="source"><a href="#" data-note-id="${source}">Source</a></p>` : ''}
            </div>
        `;
        
        if (source) {
            const sourceLink = messageElement.querySelector('a[data-note-id]');
            sourceLink.addEventListener('click', function(e) {
                e.preventDefault();
                selectNoteById(source);
            });
        }
        
        document.getElementById('chatMessages').appendChild(messageElement);
        scrollChatToBottom();
    }

    function updateAIMessageInUI(content, source) {
        let aiMessageElement = document.querySelector('.chat-message.ai:last-child');
        if (!aiMessageElement) {
            aiMessageElement = document.createElement('div');
            aiMessageElement.className = 'chat-message ai';
            document.getElementById('chatMessages').appendChild(aiMessageElement);
        }
        
        aiMessageElement.innerHTML = `
            <div class="message-content">
                <p>${content}</p>
                ${source ? `<p class="source"><a href="#" data-note-id="${source}">Source</a></p>` : ''}
            </div>
        `;
        
        if (source) {
            const sourceLink = aiMessageElement.querySelector('a[data-note-id]');
            sourceLink.addEventListener('click', function(e) {
                e.preventDefault();
                selectNoteById(source);
            });
        }

        scrollChatToBottom();
    }

    function finalizeAIMessageInUI(content, source) {
        updateAIMessageInUI(content, source);
        // Vous pouvez ajouter ici d'autres actions à effectuer une fois la réponse complète reçue
    }

    function scrollChatToBottom() {
        const chatMessagesContainer = document.getElementById('chatMessages');
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
    
    function selectNoteById(noteId) {
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            fetchCourseNotes(note.course, '');  // Fetch the course notes first
            selectNote(note);
        }
    }

    function triggerFileInput(type) {
        const fileInput = document.getElementById('fileInput');
        fileInput.setAttribute('accept', type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*');
        fileInput.click();
    }

    async function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', file.type.split('/')[0]);
        formData.append('note_id', selectedNote.id);

        try {
            const response = await fetch('/api/upload/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                },
                body: formData,
            });
            const data = await response.json();
            const newAttachment = { type: file.type.split('/')[0], url: data.url, name: file.name };
            selectedNote.attachments = [...(selectedNote.attachments || []), newAttachment];
            renderAttachments(selectedNote.attachments);
        } catch (error) {
            console.error('Error uploading file:', error);
        }
    }

    function handleAttachmentClick(attachment) {
        const mediaOverlay = document.getElementById('mediaOverlay');
        const mediaContent = document.getElementById('mediaContent');
        mediaContent.innerHTML = '';
    
        switch (attachment.file_type) {
            case 'image':
                mediaContent.innerHTML = `<img src="${attachment.file}" alt="Image">`;
                break;
            case 'video':
                mediaContent.innerHTML = `<video controls src="${attachment.file}"></video>`;
                break;
            case 'audio':
                mediaContent.innerHTML = `<audio controls src="${attachment.file}"></audio>`;
                break;
            default:
                mediaContent.innerHTML = `<p>Fichier non pris en charge : ${attachment.file}</p>`;
        }
    
        mediaOverlay.style.display = 'flex';
    }

    function closeMediaOverlay() {
        document.getElementById('mediaOverlay').style.display = 'none';
    }

    async function handleSearch() {
        console.log('Searching...');
        const query = document.getElementById('searchInput').value;
        if (query.length < 4) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }
        try {
            const response = await fetch(`/api/notes/search/?q=${encodeURIComponent(query)}`);
            const results = await response.json();
            console.log('Search results:', results);
            renderSearchResults(results);
        } catch (error) {
            console.error('Error searching:', error);
        }
    }

    function renderSearchResults(results) {
        const searchResultsContainer = document.getElementById('searchResults');
        searchResultsContainer.innerHTML = '';
        results.forEach(result => {
            const li = document.createElement('li');
            li.innerHTML = `
                <h4>${result.title}</h4>
                <p>${result.content_preview}</p>
            `;
            li.addEventListener('click', () => {
                selectNoteById(result.id);
                toggleSearch();
            });
            searchResultsContainer.appendChild(li);
        });
    }

    function updateCurrentCourseTitle(courseName) {
        document.getElementById('currentCourseTitle').textContent = courseName;
    }

    function getCsrfToken() {
        return document.cookie.split('; ')
            .find(row => row.startsWith('csrftoken='))
            .split('=')[1];
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async function fetchTodos(courseId) {
        try {
            const response = await fetch(`/api/todo-items/?course_id=${courseId}`);
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des todos');
            }
            currentTodos = await response.json();
            renderTodos();
            return currentTodos; // Retournez les todos pour pouvoir les utiliser ailleurs
        } catch (error) {
            console.error('Erreur lors de la récupération des todos:', error);
            return []; // Retournez un tableau vide en cas d'erreur
        }
    }

    

    function renderTodos() {
        const todoList = document.getElementById('todoList');
        todoList.innerHTML = '';
        currentTodos.forEach(todo => {
            const li = document.createElement('li');
            li.innerHTML = `
                <input type="checkbox" ${todo.completed ? 'checked' : ''} disabled>
                <span>${todo.content}</span>
            `;
            todoList.appendChild(li);
        });
    }

    async function endChatSession() {
        if (currentSessionId) {
            try {
                await fetch('/api/chat/end_session/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({ session_id: currentSessionId }),
                });
                currentSessionId = null;
                chatHistory = [];
                document.getElementById('chatMessages').innerHTML = '';
            } catch (error) {
                console.error('Error ending chat session:', error);
            }
        }
    }

    // Gestion des clics en dehors des overlays
    document.addEventListener('mousedown', function(event) {
        const searchOverlay = document.getElementById('searchOverlay');
        const chatOverlay = document.querySelector('.chat-overlay');
        const todoSidebar = document.getElementById('todoSidebar');

        if (!searchOverlay.contains(event.target) && event.target !== document.getElementById('searchBtn')) {
            searchOverlay.style.display = 'none';
        }
        if (!chatOverlay.contains(event.target) && event.target !== document.getElementById('chatBtn')) {
            chatOverlay.style.display = 'none';
        }
        if (!todoSidebar.contains(event.target) && event.target !== document.getElementById('todoBtn')) {
            todoSidebar.style.display = 'none';
        }
    });

    // Gestion de l'ajout de cours
    const addCourseBtn = document.getElementById('addCourseBtn');
    const addCourseOverlay = document.getElementById('addCourseOverlay');
    const closeOverlayBtn = document.getElementById('closeOverlayBtn');
    const addCourseForm = document.getElementById('addCourseForm');
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');

    // Liste complète des matières
    const toutesLesMatières = [
        {id: 1, name: 'Mathématiques'},
        {id: 2, name: 'Français'},
        {id: 3, name: 'Anglais'},
        {id: 4, name: 'Physique'},
        {id: 5, name: 'Chimie'},
        {id: 6, name: 'Aide aux devoirs'},
        {id: 7, name: 'Allemand'},
        {id: 8, name: 'Comptabilité'},
        {id: 9, name: 'Droit'},
        {id: 10, name: 'Économie'},
        {id: 11, name: 'Histoire'},
        {id: 12, name: 'Coaching'},
        {id: 13, name: 'Orientation'},
        {id: 14, name: 'Espagnol'},
        {id: 15, name: 'SVT/Biologie'},
        {id: 16, name: 'Cours de musique'}
    ];

    const typesCours = [
        {name: 'Cours à domicile'},
        {name: 'Cours hebdomadaire en centre (près de chez vous)'},
        {name: 'Stage de vacances'},
        {name: 'Cours en ligne (avec un prof en visio)'},
        {name: 'Je ne sais pas et souhaite être conseillé(e)'}
    ];

    function createOptions(container, options, type, isMatiere = false) {
        container.innerHTML = '';
        options.forEach(option => {
            const label = document.createElement('label');
            label.className = 'option-button';
            if (isMatiere) {
                label.innerHTML = `
                    <input type="radio" name="subject_id" value="${option.id}">
                    ${getSubjectIcon(option.name)}
                    <span>${option.name}</span>
                `;
            } else {
                label.innerHTML = `
                    <input type="checkbox" name="course_types" value="${option.name}"> 
                    <span>${option.name}</span>  
                `;
            }
            container.appendChild(label);
        });
    }
    
    function getSubjectIcon(subjectName) {
        const icons = {
            'Mathématiques': '🧮',
            'Français': '📚',
            'Anglais': '🇬🇧',
            'Physique': '⚛️',
            'Chimie': '🧪',
            'Aide aux devoirs': '📝',
            'Allemand': '🇩🇪',
            'Comptabilité': '💼',
            'Droit': '⚖️',
            'Économie': '📊',
            'Histoire': '🏛️',
            'Coaching': '🏆',
            'Orientation': '🧭',
            'Espagnol': '🇪🇸',
            'SVT/Biologie': '🧬',
            'Cours de musique': '🎵'
        };
        return `<div class="subject-icon">${icons[subjectName] || '📚'}</div>`;
    }

    function filtrerMatieres(coursInscrits) {
        return toutesLesMatières.filter(matiere => 
            !coursInscrits.some(cours => cours.subject.name === matiere.name)
        );
    }

    addCourseBtn.addEventListener('click', () => {
        const matieresDisponibles = filtrerMatieres(window.courses || []);
        createOptions(document.getElementById('matiereOptions'), matieresDisponibles, 'radio', true);
        createOptions(document.getElementById('typeCoursOptions'), typesCours, 'checkbox');
        addCourseOverlay.style.display = 'flex';
    });

    closeOverlayBtn.addEventListener('click', () => {
        addCourseOverlay.style.display = 'none';
        step1.style.display = 'block';
        step2.style.display = 'none';
    });

    step1.querySelector('.next-button').addEventListener('click', () => {
        step1.style.display = 'none';
        step2.style.display = 'block';
    });

    step2.querySelector('.prev-button').addEventListener('click', () => {
        step2.style.display = 'none';
        step1.style.display = 'block';
    });

    addCourseForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const formData = new FormData(this);
        
        fetch('add-course/', {
            method: 'POST',
            body: formData,
            headers: {
                'X-CSRFToken': getCsrfToken(),
            },
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('Cours ajouté avec succès');
                window.location.reload();
            } else {
                console.error('Erreur lors de l\'ajout du cours:', data.message);
                alert('Erreur lors de l\'ajout du cours: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Erreur lors de la requête:', error);
            alert('Une erreur est survenue lors de l\'ajout du cours');
        })
        .finally(() => {
            addCourseOverlay.style.display = 'none';
            this.reset();
            step1.style.display = 'block';
            step2.style.display = 'none';
        });
    });

    async function checkPendingTodos() {
    const allTodos = await fetchTodos(currentCourseId);
    const pendingTodos = allTodos.filter(todo => !todo.completed);
    if (pendingTodos.length > 0) {
        showTodoPrompt(pendingTodos);
    }
}

function showTodoPrompt(todos) {
    // Récupération du nom de l'utilisateur
    // const firstName = user.first_name || 'Étudiant';
    // const lastName = user.last_name || '';
    // const fullName = `${firstName} ${lastName}`.trim();

    const overlay = document.createElement('div');
    overlay.className = 'todo-prompt-overlay';
    overlay.innerHTML = `
        <div class="todo-prompt-content">
            <h2>Bonjour ${userFirstName} 👋</h2>
            <p>Vous avez ${todos.length} tâche${todos.length > 1 ? 's' : ''} en attente.</p>
            <p>Souhaitez-vous les faire maintenant avec l'aide de l'IA ?</p>
            <div class="todo-prompt-buttons">
                <button id="acceptTodoPrompt" class="todo-prompt-button accept">Oui, allons-y !</button>
                <button id="declineTodoPrompt" class="todo-prompt-button decline">Plus tard</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Ajout des styles (le reste du code CSS reste inchangé)
    const style = document.createElement('style');
    style.textContent = `
        .todo-prompt-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .todo-prompt-content {
            background-color: #ffffff;
            padding: 2rem;
            border-radius: 15px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        .todo-prompt-content h2 {
            color: #4a4a4a;
            margin-bottom: 1rem;
        }
        .todo-prompt-content p {
            color: #6a6a6a;
            margin-bottom: 1.5rem;
        }
        .todo-prompt-buttons {
            display: flex;
            justify-content: space-around;
        }
        .todo-prompt-button {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 5px;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .todo-prompt-button.accept {
            background-color: #4CAF50;
            color: white;
        }
        .todo-prompt-button.decline {
            background-color: #f44336;
            color: white;
        }
        .todo-prompt-button:hover {
            opacity: 0.9;
            transform: scale(1.05);
        }
    `;
    document.head.appendChild(style);

    document.getElementById('acceptTodoPrompt').addEventListener('click', () => {
        document.body.removeChild(overlay);
        document.head.removeChild(style);
        openChatWithTodos(todos);
    });

    document.getElementById('declineTodoPrompt').addEventListener('click', () => {
        document.body.removeChild(overlay);
        document.head.removeChild(style);
    });
}


    // Initialisation
    toggleView('courses');

    // Ajouter un gestionnaire d'événements pour la fermeture de la fenêtre
    window.addEventListener('beforeunload', endChatSession);
});