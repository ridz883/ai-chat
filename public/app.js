pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- REGISTER PWA SERVICE WORKER ---
let deferredPrompt = null;
const installBtn = document.getElementById('install-btn');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.log('SW reg fail:', err));
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installBtn.classList.add('hidden');
    deferredPrompt = null;
  }
});

// --- MULTI-SESSION LOCAL STORAGE ---
const SESSIONS_KEY = 'rzchat_sessions';
const ACTIVE_SESSION_KEY = 'rzchat_active_id';

let sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
let currentSessionId = localStorage.getItem(ACTIVE_SESSION_KEY) || null;

if (!currentSessionId || !sessions.find(s => s.id === currentSessionId)) {
  initNewSession();
}

function initNewSession() {
  const newId = 'session_' + Date.now();
  const newSession = {
    id: newId,
    title: 'Obrolan Baru',
    messages: [],
    updatedAt: Date.now()
  };
  sessions.unshift(newSession);
  currentSessionId = newId;
  saveSessions();
}

function getCurrentSession() {
  return sessions.find(s => s.id === currentSessionId);
}

function saveSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  localStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
  renderSessionList();
}

// --- DOM ELEMENTS ---
const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const micBtn = document.getElementById('mic-btn');
const fileInput = document.getElementById('file-input');
const fileProcessingBar = document.getElementById('file-processing-bar');
const processingStatus = document.getElementById('processing-status');
const attachmentChip = document.getElementById('attachment-chip');
const attachmentName = document.getElementById('attachment-name');
const thumbPreview = document.getElementById('thumb-preview');
const removeAttachmentBtn = document.getElementById('remove-attachment-btn');
const emptyState = document.getElementById('empty-state');
const menuBtn = document.getElementById('menu-btn');
const sidebarDrawer = document.getElementById('sidebar-drawer');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const sessionList = document.getElementById('session-list');
const clearAllSessionsBtn = document.getElementById('clear-all-sessions-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');

let pendingAttachment = null; // { type: 'image'|'pdf'|'text', name, text, previewUrl }

marked.setOptions({ breaks: true, gfm: true });

// Input auto-resize & keyboard fix
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.body.style.height = `${window.visualViewport.height}px`;
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = `${Math.min(userInput.scrollHeight, 112)}px`;
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// --- RENDER DAFTAR RIWAYAT SESI ---
function renderSessionList() {
  sessionList.innerHTML = '';
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = `p-2 border border-black cursor-pointer flex justify-between items-center ${s.id === currentSessionId ? 'bg-black text-white' : 'hover:bg-neutral-100'}`;
    item.innerHTML = `
      <span class="truncate flex-1 font-mono">${escapeHtml(s.title)}</span>
      <button class="ml-2 font-bold px-1 hover:text-red-500 delete-session-btn" data-id="${s.id}">✕</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-session-btn')) return;
      currentSessionId = s.id;
      saveSessions();
      loadCurrentChat();
      sidebarDrawer.classList.add('hidden');
    });
    sessionList.appendChild(item);
  });

  document.querySelectorAll('.delete-session-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      sessions = sessions.filter(s => s.id !== id);
      if (sessions.length === 0) initNewSession();
      else if (currentSessionId === id) currentSessionId = sessions[0].id;
      saveSessions();
      loadCurrentChat();
    });
  });
}

function loadCurrentChat() {
  const session = getCurrentSession();
  chatBox.innerHTML = '';
  if (!session || session.messages.length === 0) {
    chatBox.innerHTML = `
      <div id="empty-state" class="text-center py-20">
        <p class="text-sm font-semibold uppercase tracking-wider text-neutral-400">RZchat Workspace</p>
        <p class="text-xs text-neutral-500 mt-1">Ketik pertanyaan, rekam VN, atau lampirkan foto/PDF.</p>
      </div>`;
    return;
  }

  session.messages.forEach(msg => {
    if (msg.role === 'user') {
      appendUserBubble(msg.displayHtml || escapeHtml(msg.content), false);
    } else {
      const bubble = appendAiBubble(false);
      bubble.innerHTML = marked.parse(msg.content);
      bubble.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
    }
  });
  chatBox.scrollTop = chatBox.scrollHeight;
}

// --- VOICE NOTES ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'id-ID';
  recognition.continuous = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add('recording-active');
  };
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    userInput.value = userInput.value ? `${userInput.value} ${text}` : text;
  };
  recognition.onerror = () => stopMic();
  recognition.onend = () => stopMic();

  micBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        if (navigator.mediaDevices) await navigator.mediaDevices.getUserMedia({ audio: true });
        recognition.start();
      } catch {
        alert('Izin mic ditolak!');
        stopMic();
      }
    } else {
      recognition.stop();
    }
  });
}

function stopMic() {
  isRecording = false;
  micBtn.classList.remove('recording-active');
}

// --- FILE / OCR PROCESSING DENGAN DISPLAY FOTO ASLI ---
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  fileProcessingBar.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    if (file.type.startsWith('image/')) {
      processingStatus.textContent = 'Membaca gambar via OCR...';
      const previewUrl = URL.createObjectURL(file);
      
      const ocr = await Tesseract.recognize(file, 'ind+eng');
      const text = ocr.data.text.trim();

      pendingAttachment = {
        type: 'image',
        name: file.name,
        previewUrl: previewUrl,
        extractedText: text || '[Gambar tidak memiliki teks jelas]'
      };

      thumbPreview.style.backgroundImage = `url(${previewUrl})`;
      thumbPreview.classList.remove('hidden');
      attachmentName.textContent = file.name;
      attachmentChip.classList.remove('hidden');

    } else if (file.type === 'application/pdf') {
      processingStatus.textContent = 'Mengekstrak PDF...';
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const c = await page.getTextContent();
        text += c.items.map(it => it.str).join(' ') + '\n';
      }
      pendingAttachment = { type: 'pdf', name: file.name, extractedText: text };
      thumbPreview.classList.add('hidden');
      attachmentName.textContent = file.name;
      attachmentChip.classList.remove('hidden');
    } else {
      const text = await file.text();
      pendingAttachment = { type: 'text', name: file.name, extractedText: text };
      thumbPreview.classList.add('hidden');
      attachmentName.textContent = file.name;
      attachmentChip.classList.remove('hidden');
    }
  } catch (err) {
    alert('Gagal memproses file: ' + err.message);
  } finally {
    fileProcessingBar.classList.add('hidden');
    fileInput.value = '';
    sendBtn.disabled = false;
  }
});

removeAttachmentBtn.addEventListener('click', () => {
  pendingAttachment = null;
  attachmentChip.classList.add('hidden');
  thumbPreview.classList.add('hidden');
});

// --- SUBMIT PESAN & STREAMING RESPON ---
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text && !pendingAttachment) return;

  const session = getCurrentSession();
  let promptForAI = text;
  let displayHtml = '';

  // PERBAIKAN: Jika ada foto, tampilkan preview foto di bubble pesan, JANGAN teks OCR kasarnya!
  if (pendingAttachment) {
    if (pendingAttachment.type === 'image') {
      displayHtml = `
        <div class="mb-2">
          <img src="${pendingAttachment.previewUrl}" class="max-h-60 rounded border border-white/20 object-contain">
        </div>
        <div>${escapeHtml(text)}</div>
      `;
      promptForAI = `${text}\n\n[Hasil Teks dari Foto ${pendingAttachment.name}]:\n${pendingAttachment.extractedText}`;
    } else {
      displayHtml = `
        <div class="text-xs font-mono bg-white/10 p-1 mb-1 border border-white/20">📄 ${escapeHtml(pendingAttachment.name)}</div>
        <div>${escapeHtml(text)}</div>
      `;
      promptForAI = `${text}\n\n[Isi Dokumen ${pendingAttachment.name}]:\n${pendingAttachment.extractedText}`;
    }
  } else {
    displayHtml = escapeHtml(text);
  }

  // Set judul sesi otomatis dari prompt awal
  if (session.messages.length === 0) {
    session.title = text ? text.substring(0, 24) : pendingAttachment.name;
  }

  userInput.value = '';
  userInput.style.height = 'auto';
  pendingAttachment = null;
  attachmentChip.classList.add('hidden');
  thumbPreview.classList.add('hidden');

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  appendUserBubble(displayHtml, true);
  session.messages.push({ role: 'user', content: promptForAI, displayHtml: displayHtml });
  saveSessions();

  const aiBubble = appendAiBubble(true);
  sendBtn.disabled = true;
  let fullRes = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: session.messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    if (!res.ok) throw new Error(await res.text());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const tr = line.trim();
        if (!tr.startsWith('data:')) continue;
        const data = tr.replace(/^data:\s*/, '');
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content || '';
          if (chunk) {
            fullRes += chunk;
            aiBubble.innerHTML = marked.parse(fullRes);
            aiBubble.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
            chatBox.scrollTop = chatBox.scrollHeight;
          }
        } catch (_) {}
      }
    }

    session.messages.push({ role: 'assistant', content: fullRes });
    saveSessions();
    addBubbleActionButtons(aiBubble, fullRes);

  } catch (err) {
    aiBubble.innerHTML = `<span class="text-red-600 font-mono">[Error: ${err.message}]</span>`;
  } finally {
    sendBtn.disabled = false;
  }
});

// Bubble UI User & AI
function appendUserBubble(htmlContent, autoScroll = true) {
  const el = document.createElement('div');
  el.className = 'flex justify-end';
  el.innerHTML = `<div class="max-w-[85%] bg-black text-white p-3 border border-black text-sm">${htmlContent}</div>`;
  chatBox.appendChild(el);
  if (autoScroll) chatBox.scrollTop = chatBox.scrollHeight;
}

function appendAiBubble(autoScroll = true) {
  const el = document.createElement('div');
  el.className = 'flex justify-start';
  el.innerHTML = `<div class="max-w-[90%] bg-white text-black p-3.5 border border-black text-sm prose shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"><span class="inline-block w-2 h-4 bg-black animate-pulse"></span></div>`;
  chatBox.appendChild(el);
  if (autoScroll) chatBox.scrollTop = chatBox.scrollHeight;
  return el.querySelector('.prose');
}

// Fitur Tambahan: Copy & Text to Speech (TTS)
function addBubbleActionButtons(bubbleEl, text) {
  const actions = document.createElement('div');
  actions.className = 'mt-3 pt-2 border-t border-black/20 flex gap-2 text-xs not-prose';
  actions.innerHTML = `
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] copy-btn">Salin</button>
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] speak-btn">Bicara 🔊</button>
  `;

  actions.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(text);
    alert('Teks berhasil disalin!');
  });

  actions.querySelector('.speak-btn').addEventListener('click', () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[#*`]/g, ''));
      u.lang = 'id-ID';
      window.speechSynthesis.speak(u);
    }
  });

  bubbleEl.appendChild(actions);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Modal & Drawer Navigasi
menuBtn.addEventListener('click', () => sidebarDrawer.classList.remove('hidden'));
closeDrawerBtn.addEventListener('click', () => sidebarDrawer.classList.add('hidden'));
sidebarDrawer.addEventListener('click', (e) => {
  if (e.target === sidebarDrawer) sidebarDrawer.classList.add('hidden');
});

newChatBtn.addEventListener('click', () => {
  initNewSession();
  loadCurrentChat();
  sidebarDrawer.classList.add('hidden');
});

clearAllSessionsBtn.addEventListener('click', () => {
  if (confirm('Kosongkan semua riwayat chat?')) {
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    sessions = [];
    initNewSession();
    loadCurrentChat();
    sidebarDrawer.classList.add('hidden');
  }
});

settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

// Mulai aplikasi
renderSessionList();
loadCurrentChat();
