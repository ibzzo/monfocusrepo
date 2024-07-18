document.addEventListener('DOMContentLoaded', function() {
    let allNotes = [];
    let courseNotes = [];
    let recentNotes = [];
    let selectedNote = null;
    let currentCourseId = null;
    let chatMessages = [];
    let currentTodos = [];

    // Initialisation
    initTinyMCE();
    fetchAllNotes();
    setupEventListeners();

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

        const addTodoBtn = document.getElementById('addTodoBtn');
    const newTodoInput = document.getElementById('newTodoInput');

    if (addTodoBtn && newTodoInput) {
        addTodoBtn.addEventListener('click', function() {
            const content = newTodoInput.value.trim();
            if (content) {
                addTodo(content);
                newTodoInput.value = '';
            }
        });

        // Ajout de la gestion de la touche Entrée
        newTodoInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTodoBtn.click();
            }
        });
    } else {
        console.error("Le bouton d'ajout de todo ou l'input n'ont pas été trouvés");
    }

        document.querySelectorAll('.course-item').forEach(item => {
            item.addEventListener('click', () => {
                const courseId = item.dataset.courseId;
                if (courseId && courseId !== 'null') {
                    const courseName = item.querySelector('h3').textContent;
                    fetchCourseNotes(courseId, courseName);
                } else {
                    console.error('Invalid course ID');
                }
            });
        });
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
        
        switch(view) {
            case 'courses':
                courseGrid.style.display = 'grid';
                noteContent.style.display = 'none';
                allNotesList.style.display = 'none';
                break;
            case 'notes':
                courseGrid.style.display = 'none';
                noteContent.style.display = 'none';
                allNotesList.style.display = 'block';
                break;
            case 'editor':
                courseGrid.style.display = 'none';
                noteContent.style.display = 'block';
                allNotesList.style.display = 'none';
                break;
        }
    }

    function toggleSearch() {
        const searchOverlay = document.getElementById('searchOverlay');
        searchOverlay.style.display = searchOverlay.style.display === 'none' ? 'flex' : 'none';
    }

    function toggleChat() {
        const chatOverlay = document.querySelector('.chat-overlay');
        chatOverlay.style.display = chatOverlay.style.display === 'none' ? 'flex' : 'none';
        if (chatOverlay.style.display === 'flex') {
            renderChatMessages();
        }
    }    

    function toggleTodo() {
        const todoSidebar = document.getElementById('todoSidebar');
        if (todoSidebar.style.display === 'none') {
            todoSidebar.style.display = 'block';
            if (currentCourseId) {
                fetchTodos(currentCourseId);
            }
        } else {
            todoSidebar.style.display = 'none';
        }
    }

    async function handleChatSubmit() {
        const chatInput = document.getElementById('chatInput');
        const messageContent = chatInput.value.trim();
        if (messageContent === '') return;
    
        const userMessage = { role: 'user', content: messageContent };
        chatMessages.push(userMessage);
        renderChatMessages();
        
        chatInput.value = '';
        
        try {
            const response = await fetch('/api/chat/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ message: messageContent }),
            });
            const data = await response.json();
            const aiMessage = { role: 'ai', content: data.message, source: data.source };
            chatMessages.push(aiMessage);
            renderChatMessages();
        } catch (error) {
            console.error('Error submitting chat:', error);
        }
    }

    function renderChatMessages() {
        const chatMessagesContainer = document.getElementById('chatMessages');
        chatMessagesContainer.innerHTML = '';
        chatMessages.forEach((message) => {
            const messageElement = document.createElement('div');
            messageElement.className = `chat-message ${message.role}`;
            messageElement.innerHTML = `
                <div class="message-content">
                    <p>${message.content}</p>
                    ${message.source ? `<p class="source"><a href="#" onclick="selectNoteById(${message.source})">Source</a></p>` : ''}
                </div>
            `;
            chatMessagesContainer.appendChild(messageElement);
        });
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
        const query = document.getElementById('searchInput').value;
        if (query.length < 4) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }
        try {
            const response = await fetch(`/api/notes/search/?q=${encodeURIComponent(query)}`);
            const results = await response.json();
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

    // Todo management functions
    async function fetchTodos(courseId) {
        try {
            const response = await fetch(`/api/todo-items/?course_id=${courseId}`);
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des todos');
            }
            currentTodos = await response.json();
            renderTodos();
        } catch (error) {
            console.error('Erreur lors de la récupération des todos:', error);
        }
    }

    function renderTodos() {
        const todoList = document.getElementById('todoList');
        todoList.innerHTML = '';
        currentTodos.forEach(todo => {
            const li = document.createElement('li');
            li.innerHTML = `
                <input type="checkbox" ${todo.completed ? 'checked' : ''}>
                <span>${todo.content}</span>
            `;
            li.querySelector('input').addEventListener('change', () => toggleTodoCompletion(todo.id));
            todoList.appendChild(li);
        });
    }



    async function toggleTodoCompletion(todoId) {
        const todo = currentTodos.find(t => t.id === todoId);
        if (!todo) return;

        try {
            const response = await fetch(`/api/todo-items/${todoId}/`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    completed: !todo.completed
                }),
            });
            if (!response.ok) {
                throw new Error('Erreur lors de la mise à jour du todo');
            }
            todo.completed = !todo.completed;
            renderTodos();
        } catch (error) {
            console.error('Erreur lors de la mise à jour du todo:', error);
        }
    }

    async function checkPendingTodos() {
        try {
            const response = await fetch('/api/todo-items/pending/');
            const pendingTodos = await response.json();
            if (pendingTodos.length > 0) {
                showTodoPrompt(pendingTodos);
            }
        } catch (error) {
            console.error('Error checking pending todos:', error);
        }
    }

    function showTodoPrompt(todos) {
        const overlay = document.createElement('div');
        overlay.className = 'todo-prompt-overlay';
        overlay.innerHTML = `
            <div class="todo-prompt-content">
                <h2>Vous avez des tâches en attente</h2>
                <p>Souhaitez-vous les faire maintenant avec l'aide de l'IA ?</p>
                <button id="acceptTodoPrompt">Oui</button>
                <button id="declineTodoPrompt">Non</button>
            </div>
        `;
        document.body.appendChild(overlay);
    
        document.getElementById('acceptTodoPrompt').addEventListener('click', () => {
            document.body.removeChild(overlay);
            openChatWithTodos(todos);
        });
    
        document.getElementById('declineTodoPrompt').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
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


    // Initialisation
    toggleView('courses');
});