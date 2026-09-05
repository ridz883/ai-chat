pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- PWA SERVICE WORKER ---
let deferredPrompt = null;
const installBtn = document.getElementById('install-btn');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.log('SW fail:', err));
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

// --- SESSION STORAGE MANAGEMENT ---
const SESSIONS_KEY = 'rzchat_sessions';
const ACTIVE_SESSION_KEY = 'rzchat_active_id';
const MODEL_KEY = 'rzchat_selected_model';

let sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
let currentSessionId = localStorage.getItem(ACTIVE_SESSION_KEY) || null;

const modelSelect = document.getElementById('model-select');
modelSelect.value = localStorage.getItem(MODEL_KEY) || 'qwen/qwen3.8-max:free';

modelSelect.addEventListener('change', () => {
  localStorage.setItem(MODEL_KEY, modelSelect.value);
});

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

let pendingAttachment = null; 

marked.setOptions({ breaks: true, gfm: true });

// Input resize & visual keyboard viewport fix
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

// Render drawer sessions
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
        <p class="text-xs text-neutral-500 mt-1">Mendukung Multimodal Vision (Foto/Objek), PDF, & VN.</p>
      </div>`;
    return;
  }

  session.messages.forEach(msg => {
    if (msg.role === 'user') {
      appendUserBubble(msg.displayHtml || escapeHtml(typeof msg.content === 'string' ? msg.content : 'Lampiran'), false);
    } else {
      const bubble = appendAiBubble(false);
      bubble.innerHTML = marked.parse(msg.content);
      bubble.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
      addBubbleActionButtons(bubble, msg.content);
    }
  });
  chatBox.scrollTop = chatBox.scrollHeight;
}

// --- VOICE NOTES / SPEECH RECOGNITION (FIXED UNTUK ANDROID) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'id-ID';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add('recording-active');
  };

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    userInput.value = userInput.value ? `${userInput.value} ${text}` : text;
    userInput.dispatchEvent(new Event('input'));
  };

  recognition.onerror = (event) => {
    console.warn('Speech Rec Error:', event.error);
    stopMic();
    if (event.error === 'not-allowed') {
      alert('Izin mikrofon terblokir! Klik ikon gembok / setelan situs di samping alamat browser untuk mengizinkan akses mikrofon.');
    }
  };

  recognition.onend = () => stopMic();

  micBtn.addEventListener('click', () => {
    if (!isRecording) {
      try {
        recognition.start();
      } catch (err) {
        stopMic();
      }
    } else {
      recognition.stop();
    }
  });
} else {
  micBtn.classList.add('opacity-40');
  micBtn.title = 'Browser belum mendukung Speech Recognition';
}

function stopMic() {
  isRecording = false;
  micBtn.classList.remove('recording-active');
}

// --- MULTIMODAL VISION: PROSES FOTO SEBAGAI BASE64 LANGSUNG ---
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  fileProcessingBar.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    if (file.type.startsWith('image/')) {
      processingStatus.textContent = 'Menyiapkan gambar untuk AI Vision...';
      const base64Data = await fileToBase64(file);

      pendingAttachment = {
        type: 'image',
        name: file.name,
        base64Url: base64Data
      };

      thumbPreview.style.backgroundImage = `url(${base64Data})`;
      thumbPreview.classList.remove('hidden');
      attachmentName.textContent = file.name;
      attachmentChip.classList.remove('hidden');

    } else if (file.type === 'application/pdf') {
      processingStatus.textContent = 'Mengekstrak teks dokumen PDF...';
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

removeAttachmentBtn.addEventListener('click', () => {
  pendingAttachment = null;
  attachmentChip.classList.add('hidden');
  thumbPreview.classList.add('hidden');
});

// --- SUBMIT PESAN & STREAMING CHAT KE MODEL TERPILIH ---
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text && !pendingAttachment) return;

  const session = getCurrentSession();
  let aiContentPayload;
  let displayHtml = '';

  if (pendingAttachment) {
    if (pendingAttachment.type === 'image') {
      displayHtml = `
        <div class="mb-2">
          <img src="${pendingAttachment.base64Url}" class="max-h-60 rounded border border-white/20 object-contain">
        </div>
        <div>${escapeHtml(text || 'Analisis gambar ini')}</div>
      `;
      // Payload format Multimodal OpenAI Standard (Vision)
      aiContentPayload = [
        { type: "text", text: text || "Jelaskan dan analisis isi dari gambar ini secara detail." },
        { type: "image_url", image_url: { url: pendingAttachment.base64Url } }
      ];
    } else {
      displayHtml = `
        <div class="text-xs font-mono bg-white/10 p-1 mb-1 border border-white/20">📄 ${escapeHtml(pendingAttachment.name)}</div>
        <div>${escapeHtml(text)}</div>
      `;
      aiContentPayload = `${text}\n\n[Isi Dokumen ${pendingAttachment.name}]:\n${pendingAttachment.extractedText}`;
    }
  } else {
    displayHtml = escapeHtml(text);
    aiContentPayload = text;
  }

  if (session.messages.length === 0) {
    session.title = text ? text.substring(0, 24) : (pendingAttachment ? pendingAttachment.name : 'Obrolan');
  }

  userInput.value = '';
  userInput.style.height = 'auto';
  pendingAttachment = null;
  attachmentChip.classList.add('hidden');
  thumbPreview.classList.add('hidden');

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  appendUserBubble(displayHtml, true);
  session.messages.push({ role: 'user', content: aiContentPayload, displayHtml: displayHtml });
  saveSessions();

  const aiBubble = appendAiBubble(true);
  sendBtn.disabled = true;
  let fullRes = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
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

function addBubbleActionButtons(bubbleEl, text) {
  const actions = document.createElement('div');
  actions.className = 'mt-3 pt-2 border-t border-black/20 flex gap-2 text-xs not-prose';
  actions.innerHTML = `
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] copy-btn">Salin</button>
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] speak-btn">Bicara 🔊</button>
  `;

  actions.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(text);
    alert('Teks disalin!');
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
  if (confirm('Kosongkan seluruh riwayat chat?')) {
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

renderSessionList();
loadCurrentChat();
