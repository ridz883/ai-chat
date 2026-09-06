pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- HAPTIC FEEDBACK (GETAR HALUS HP ANDROID) ---
function triggerHaptic(duration = 15) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(duration); } catch (_) {}
  }
}

// --- PWA SERVICE WORKER REGISTRATION ---
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
  triggerHaptic(20);
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installBtn.classList.add('hidden');
    deferredPrompt = null;
  }
});

// --- SESSION STORAGE CONFIGURATION ---
const SESSIONS_KEY = 'rzchat_sessions';
const ACTIVE_SESSION_KEY = 'rzchat_active_id';
const MODEL_KEY = 'rzchat_selected_model';
const SYSTEM_PROMPT_KEY = 'rzchat_system_prompt';
const SPEECH_RATE_KEY = 'rzchat_speech_rate';
const TEMPERATURE_KEY = 'rzchat_temperature';

let sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
let currentSessionId = localStorage.getItem(ACTIVE_SESSION_KEY) || null;

const modelSelect = document.getElementById('model-select');
modelSelect.value = localStorage.getItem(MODEL_KEY) || 'qwen/qwen3.8-max:free';
modelSelect.addEventListener('change', () => localStorage.setItem(MODEL_KEY, modelSelect.value));

const systemPromptInput = document.getElementById('system-prompt-input');
systemPromptInput.value = localStorage.getItem(SYSTEM_PROMPT_KEY) || '';
systemPromptInput.addEventListener('change', () => localStorage.setItem(SYSTEM_PROMPT_KEY, systemPromptInput.value));

const speechRateRange = document.getElementById('speech-rate-range');
speechRateRange.value = localStorage.getItem(SPEECH_RATE_KEY) || '1.0';
speechRateRange.addEventListener('change', () => localStorage.setItem(SPEECH_RATE_KEY, speechRateRange.value));

const tempRange = document.getElementById('temp-range');
const tempValDisplay = document.getElementById('temp-val-display');
tempRange.value = localStorage.getItem(TEMPERATURE_KEY) || '0.7';
tempValDisplay.textContent = tempRange.value;
tempRange.addEventListener('input', () => {
  tempValDisplay.textContent = tempRange.value;
  localStorage.setItem(TEMPERATURE_KEY, tempRange.value);
});

if (!currentSessionId || !sessions.find(s => s.id === currentSessionId)) {
  initNewSession();
}

function initNewSession() {
  const newId = 'session_' + Date.now();
  const newSession = {
    id: newId,
    title: 'Obrolan Baru',
    pinned: false,
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
const fileProcessingBar = document.getElementById('file-processing-bar');
const processingStatus = document.getElementById('processing-status');
const attachmentChip = document.getElementById('attachment-chip');
const attachmentName = document.getElementById('attachment-name');
const thumbPreview = document.getElementById('thumb-preview');
const removeAttachmentBtn = document.getElementById('remove-attachment-btn');
const menuBtn = document.getElementById('menu-btn');
const sidebarDrawer = document.getElementById('sidebar-drawer');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const sessionList = document.getElementById('session-list');
const clearAllSessionsBtn = document.getElementById('clear-all-sessions-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const stopContainer = document.getElementById('stop-container');
const stopBtn = document.getElementById('stop-btn');
const exportTxtBtn = document.getElementById('export-txt-btn');
const exportJsonBtn = document.getElementById('export-json-btn');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
const scrollDot = document.getElementById('scroll-dot');
const retryBar = document.getElementById('retry-bar');
const retryBtn = document.getElementById('retry-btn');
const undoToast = document.getElementById('undo-toast');
const undoToastText = document.getElementById('undo-toast-text');
const undoBtn = document.getElementById('undo-btn');

let pendingAttachment = null;
let currentAbortController = null;
let deletedSessionBackup = null;
let undoTimeout = null;

marked.setOptions({ breaks: true, gfm: true });

// Mobile Viewport Keyboard Fix
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.body.style.height = `${window.visualViewport.height}px`;
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

// --- SMART AUTO-SCROLL & FLOATING DOWN BUTTON ---
let userHasScrolledUp = false;

chatBox.addEventListener('scroll', () => {
  const threshold = 100;
  const isNearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight <= threshold;
  
  if (!isNearBottom) {
    userHasScrolledUp = true;
    scrollBottomBtn.classList.remove('hidden');
  } else {
    userHasScrolledUp = false;
    scrollBottomBtn.classList.add('hidden');
    scrollDot.classList.add('hidden');
  }
});

scrollBottomBtn.addEventListener('click', () => {
  triggerHaptic(15);
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
  userHasScrolledUp = false;
  scrollBottomBtn.classList.add('hidden');
  scrollDot.classList.add('hidden');
});

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

// --- RENDER DRAWER SESSIONS (DENGAN PIN / SEMATKAN & UNDO DELETE) ---
function renderSessionList() {
  sessionList.innerHTML = '';
  // Urutkan: Pinned di paling atas, lalu sesuai tanggal update
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  sortedSessions.forEach(s => {
    const item = document.createElement('div');
    item.className = `p-2 border border-black cursor-pointer flex justify-between items-center transition relative ${s.id === currentSessionId ? 'bg-black text-white' : 'hover:bg-neutral-100'}`;
    item.innerHTML = `
      <div class="flex items-center gap-1.5 truncate flex-1">
        ${s.pinned ? '<span class="text-xs">📌</span>' : ''}
        <span class="truncate font-mono">${escapeHtml(s.title)}</span>
      </div>
      <div class="flex items-center gap-1">
        <button class="px-1 text-[11px] hover:text-amber-500 pin-session-btn" data-id="${s.id}" title="${s.pinned ? 'Lepas Pin' : 'Sematkan'}">${s.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="font-bold px-1 hover:text-red-500 delete-session-btn" data-id="${s.id}">✕</button>
      </div>
    `;

    // Long press / click-hold untuk Pin di Mobile
    let pressTimer;
    item.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        triggerHaptic(30);
        togglePinSession(s.id);
      }, 600);
    });
    item.addEventListener('touchend', () => clearTimeout(pressTimer));

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-session-btn') || e.target.classList.contains('pin-session-btn')) return;
      triggerHaptic(10);
      currentSessionId = s.id;
      saveSessions();
      loadCurrentChat();
      sidebarDrawer.classList.add('hidden');
    });

    sessionList.appendChild(item);
  });

  // Listener Pin
  document.querySelectorAll('.pin-session-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerHaptic(15);
      togglePinSession(btn.getAttribute('data-id'));
    });
  });

  // Listener Delete dengan Batas Balik / Undo 5 Detik
  document.querySelectorAll('.delete-session-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerHaptic(20);
      const id = btn.getAttribute('data-id');
      const targetIndex = sessions.findIndex(s => s.id === id);
      if (targetIndex === -1) return;

      deletedSessionBackup = { session: sessions[targetIndex], index: targetIndex };
      sessions.splice(targetIndex, 1);

      if (sessions.length === 0) initNewSession();
      else if (currentSessionId === id) currentSessionId = sessions[0].id;

      saveSessions();
      loadCurrentChat();

      // Tampilkan toast undo
      clearTimeout(undoTimeout);
      undoToast.classList.remove('hidden');
      undoTimeout = setTimeout(() => {
        undoToast.classList.add('hidden');
        deletedSessionBackup = null;
      }, 5000);
    });
  });
}

function togglePinSession(id) {
  const sess = sessions.find(s => s.id === id);
  if (sess) {
    sess.pinned = !sess.pinned;
    saveSessions();
  }
}

undoBtn.addEventListener('click', () => {
  if (deletedSessionBackup) {
    triggerHaptic(20);
    sessions.splice(deletedSessionBackup.index, 0, deletedSessionBackup.session);
    currentSessionId = deletedSessionBackup.session.id;
    deletedSessionBackup = null;
    clearTimeout(undoTimeout);
    undoToast.classList.add('hidden');
    saveSessions();
    loadCurrentChat();
  }
});

// --- KALKULATOR TOKEN & DURASI BACA ---
function calculateReadingStats(text) {
  const clean = text.replace(/[*#`_\[\]()]/g, '').trim();
  const words = clean.length > 0 ? clean.split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${words} kata · ~${minutes} menit baca`;
}

function loadCurrentChat() {
  const session = getCurrentSession();
  chatBox.innerHTML = '';
  retryBar.classList.add('hidden');

  if (!session || session.messages.length === 0) {
    chatBox.innerHTML = `
      <div id="empty-state" class="text-center py-20 select-none">
        <p class="text-sm font-semibold uppercase tracking-wider text-neutral-400">RZchat Workspace</p>
        <p class="text-xs text-neutral-500 mt-1">Mendukung Canvas Live Preview, Voice Call Waveform, Vision & Dokumen.</p>
      </div>`;
    return;
  }

  session.messages.forEach((msg, index) => {
    if (msg.role === 'user') {
      appendUserBubble(msg.displayHtml || escapeHtml(typeof msg.content === 'string' ? msg.content : 'Lampiran'), false, index);
    } else {
      const bubble = appendAiBubble(false);
      bubble.innerHTML = marked.parse(msg.content);
      bubble.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
      addBubbleActionButtons(bubble, msg.content, index);
    }
  });
  chatBox.scrollTop = chatBox.scrollHeight;
}

// --- VOICE NOTES / STT (REGULER CHAT) ---
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
    triggerHaptic(20);
  };
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    userInput.value = userInput.value ? `${userInput.value} ${text}` : text;
  };
  recognition.onerror = () => stopMic();
  recognition.onend = () => stopMic();

  micBtn.addEventListener('click', () => {
    triggerHaptic(15);
    if (!isRecording) {
      try { recognition.start(); } catch { stopMic(); }
    } else {
      recognition.stop();
    }
  });
}

function stopMic() {
  isRecording = false;
  micBtn.classList.remove('recording-active');
}

// --- BOTTOM SHEET ATTACHMENT MENU ---
const attachmentMenuBtn = document.getElementById('attachment-menu-btn');
const bottomSheetOverlay = document.getElementById('bottom-sheet-overlay');
const closeBottomSheet = document.getElementById('close-bottom-sheet');
const fileInputGallery = document.getElementById('file-input-gallery');
const fileInputCamera = document.getElementById('file-input-camera');
const fileInputDocs = document.getElementById('file-input-docs');

attachmentMenuBtn.addEventListener('click', () => {
  triggerHaptic(15);
  bottomSheetOverlay.classList.remove('hidden');
});

closeBottomSheet.addEventListener('click', () => bottomSheetOverlay.classList.add('hidden'));
bottomSheetOverlay.addEventListener('click', (e) => {
  if (e.target === bottomSheetOverlay) bottomSheetOverlay.classList.add('hidden');
});

document.getElementById('btn-opt-camera').addEventListener('click', () => {
  bottomSheetOverlay.classList.add('hidden');
  fileInputCamera.click();
});

document.getElementById('btn-opt-gallery').addEventListener('click', () => {
  bottomSheetOverlay.classList.add('hidden');
  fileInputGallery.click();
});

document.getElementById('btn-opt-doc').addEventListener('click', () => {
  bottomSheetOverlay.classList.add('hidden');
  fileInputDocs.click();
});

document.getElementById('btn-opt-genimg').addEventListener('click', () => {
  bottomSheetOverlay.classList.add('hidden');
  userInput.value = 'Buat gambar ilustrasi tentang: ';
  userInput.focus();
  triggerHaptic(15);
});

[fileInputGallery, fileInputCamera].forEach(inp => {
  inp.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    processAttachmentFile(file, 'image');
  });
});

fileInputDocs.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  processAttachmentFile(file, file.type === 'application/pdf' ? 'pdf' : 'text');
});

async function processAttachmentFile(file, type) {
  fileProcessingBar.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    if (type === 'image') {
      processingStatus.textContent = 'Memproses visual gambar...';
      const base64Data = await fileToBase64(file);
      pendingAttachment = { type: 'image', name: file.name, base64Url: base64Data };
      thumbPreview.style.backgroundImage = `url(${base64Data})`;
      thumbPreview.classList.remove('hidden');
    } else if (type === 'pdf') {
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
    } else {
      const text = await file.text();
      pendingAttachment = { type: 'text', name: file.name, extractedText: text };
      thumbPreview.classList.add('hidden');
    }
    attachmentName.textContent = file.name;
    attachmentChip.classList.remove('hidden');
    triggerHaptic(20);
  } catch (err) {
    alert('Gagal memproses file: ' + err.message);
  } finally {
    fileProcessingBar.classList.add('hidden');
    fileInputGallery.value = '';
    fileInputCamera.value = '';
    fileInputDocs.value = '';
    sendBtn.disabled = false;
  }
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload = () => res(r.result);
    r.onerror = rej;
  });
}

removeAttachmentBtn.addEventListener('click', () => {
  pendingAttachment = null;
  attachmentChip.classList.add('hidden');
  thumbPreview.classList.add('hidden');
});

// --- SUBMIT PESAN CHAT & DYNAMIC TITLE GENERATION ---
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text && !pendingAttachment) return;

  triggerHaptic(15);
  retryBar.classList.add('hidden');

  const session = getCurrentSession();
  let aiContentPayload;
  let displayHtml = '';

  if (pendingAttachment) {
    if (pendingAttachment.type === 'image') {
      displayHtml = `
        <div class="mb-2"><img src="${pendingAttachment.base64Url}" class="max-h-60 rounded border border-white/20 object-contain"></div>
        <div>${escapeHtml(text || 'Analisis gambar ini')}</div>
      `;
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

  userInput.value = '';
  userInput.style.height = 'auto';
  pendingAttachment = null;
  attachmentChip.classList.add('hidden');
  thumbPreview.classList.add('hidden');

  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const userMsgIndex = session.messages.length;
  appendUserBubble(displayHtml, true, userMsgIndex);
  session.messages.push({ role: 'user', content: aiContentPayload, displayHtml: displayHtml });
  session.updatedAt = Date.now();
  saveSessions();

  await requestAIResponse();
});

// Eksekusi Streaming Respon dengan Retry & Realtime Typing
async function requestAIResponse(isRegenerate = false) {
  const session = getCurrentSession();
  const aiBubble = appendAiBubble(true, true);
  sendBtn.disabled = true;
  stopContainer.classList.remove('hidden');

  currentAbortController = new AbortController();
  let fullRes = '';

  let payloadMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
  const customSystemPrompt = systemPromptInput.value.trim();
  if (customSystemPrompt) {
    payloadMessages.unshift({ role: 'system', content: customSystemPrompt });
  }

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      signal: currentAbortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        temperature: parseFloat(tempRange.value) || 0.7,
        messages: payloadMessages
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

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
            updateAiTypingContent(aiBubble, fullRes);
            
            // Cek status scrolling: jika user scroll ke atas, jangan paksa scroll
            if (!userHasScrolledUp) {
              chatBox.scrollTop = chatBox.scrollHeight;
            } else {
              scrollDot.classList.remove('hidden');
            }
          }
        } catch (_) {}
      }
    }

    finalizeAiBubble(aiBubble, fullRes);

    if (isRegenerate) {
      session.messages[session.messages.length - 1] = { role: 'assistant', content: fullRes };
    } else {
      session.messages.push({ role: 'assistant', content: fullRes });
    }
    session.updatedAt = Date.now();
    saveSessions();

    const aiMsgIndex = session.messages.length - 1;
    addBubbleActionButtons(aiBubble, fullRes, aiMsgIndex);

    // Dynamic Title Generation Otomatis jika obrolan masih baru
    if (session.messages.length === 2 && session.title === 'Obrolan Baru') {
      generateDynamicTitle(session);
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      finalizeAiBubble(aiBubble, fullRes + '\n\n*(Dihentikan oleh pengguna)*');
      session.messages.push({ role: 'assistant', content: fullRes });
      saveSessions();
    } else {
      aiBubble.innerHTML = `<span class="text-red-600 font-mono">[Error: ${err.message}]</span>`;
      // Tampilkan Auto-Retry bar
      retryBar.classList.remove('hidden');
    }
  } finally {
    sendBtn.disabled = false;
    stopContainer.classList.add('hidden');
    currentAbortController = null;
  }
}

// Auto-Retry Handler
retryBtn.addEventListener('click', async () => {
  triggerHaptic(15);
  retryBar.classList.add('hidden');
  const session = getCurrentSession();
  if (session && session.messages.length > 0) {
    await requestAIResponse(false);
  }
});

stopBtn.addEventListener('click', () => {
  triggerHaptic(15);
  if (currentAbortController) {
    currentAbortController.abort();
  }
});

// Fitur Dynamic Title Otomatis (3-4 Kata)
async function generateDynamicTitle(session) {
  try {
    const prompt = "Buatkan judul sangat singkat 3 sampai 4 kata saja (tanpa tanda kutip atau titik) yang merangkum topik pertanyaan ini: " + session.messages[0].content;
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const text = await res.text();
    const lines = text.split('\n');
    let titleResult = '';
    for (const l of lines) {
      if (l.startsWith('data:') && !l.includes('[DONE]')) {
        try {
          const p = JSON.parse(l.replace('data:', '').trim());
          titleResult += p.choices?.[0]?.delta?.content || '';
        } catch (_) {}
      }
    }
    if (titleResult.trim()) {
      session.title = titleResult.replace(/["\n.]/g, '').trim().substring(0, 26);
      saveSessions();
    }
  } catch (_) {}
}

// Render Bubble Chat
function appendUserBubble(htmlContent, autoScroll = true, index = null) {
  const el = document.createElement('div');
  el.className = 'flex flex-col items-end gap-1';
  el.innerHTML = `
    <div class="max-w-[85%] bg-black text-white p-3 border border-black text-sm">${htmlContent}</div>
    ${index !== null ? `<button class="text-[10px] uppercase font-bold text-neutral-500 hover:text-black edit-msg-btn" data-index="${index}">Edit ✎</button>` : ''}
  `;

  if (index !== null) {
    el.querySelector('.edit-msg-btn').addEventListener('click', () => handleEditMessage(index));
  }

  chatBox.appendChild(el);
  if (autoScroll) chatBox.scrollTop = chatBox.scrollHeight;
}

function appendAiBubble(autoScroll = true, showLoader = false) {
  const el = document.createElement('div');
  el.className = 'flex justify-start';
  el.innerHTML = `
    <div class="max-w-[90%] bg-white text-black p-3.5 border border-black text-sm prose shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
      ${showLoader ? `
        <div class="flex items-center gap-2 mb-2 loader-wrapper">
          <video src="https://videotourl.com/videos/1788627788425-bbdd651d-20d3-4a0a-bd63-a27d0ca809cb.mp4" autoplay loop muted playsinline class="loader-video"></video>
          <span class="text-xs font-mono text-neutral-500 animate-pulse">RZchat sedang mengetik...</span>
        </div>
      ` : ''}
      <div class="ai-content-body"><span class="inline-block w-2 h-4 bg-black animate-pulse"></span></div>
    </div>
  `;
  chatBox.appendChild(el);
  if (autoScroll) chatBox.scrollTop = chatBox.scrollHeight;
  return el.querySelector('.prose');
}

function updateAiTypingContent(bubbleEl, text) {
  const body = bubbleEl.querySelector('.ai-content-body');
  if (body) {
    body.innerHTML = marked.parse(text);
    body.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
    injectCanvasActionButtons(body);
  }
}

function finalizeAiBubble(bubbleEl, text) {
  const loader = bubbleEl.querySelector('.loader-wrapper');
  if (loader) loader.remove();
  const body = bubbleEl.querySelector('.ai-content-body');
  if (body) {
    body.innerHTML = marked.parse(text);
    body.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
    injectCanvasActionButtons(body);
  }
}

// --- FITUR CANVAS (LIVE CODE PLAYGROUND) ---
const canvasModal = document.getElementById('canvas-modal');
const closeCanvasBtn = document.getElementById('close-canvas-btn');
const canvasCodeInput = document.getElementById('canvas-code-input');
const canvasIframe = document.getElementById('canvas-iframe');
const refreshCanvasBtn = document.getElementById('refresh-canvas-btn');

function injectCanvasActionButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.canvas-run-btn')) return;

    const codeEl = pre.querySelector('code');
    const codeText = codeEl ? codeEl.innerText : pre.innerText;

    // Jika kode mengandung sintaks HTML / JS, berikan tombol Live Canvas
    const isHtmlOrJs = codeText.includes('<html') || codeText.includes('<!DOCTYPE') || codeText.includes('<div') || codeText.includes('<button') || codeText.includes('<script');

    const toolbar = document.createElement('div');
    toolbar.className = 'absolute top-2 right-2 flex gap-1 z-10 not-prose';
    toolbar.innerHTML = `
      ${isHtmlOrJs ? '<button class="px-2 py-0.5 bg-white text-black text-[10px] uppercase font-bold border border-black hover:bg-black hover:text-white canvas-run-btn">Buka Canvas 🌐</button>' : ''}
      <button class="px-2 py-0.5 bg-neutral-800 text-white text-[10px] uppercase font-bold hover:bg-neutral-700 copy-code-btn">Salin</button>
    `;

    toolbar.querySelector('.copy-code-btn').addEventListener('click', () => {
      triggerHaptic(15);
      navigator.clipboard.writeText(codeText);
      alert('Kode disalin!');
    });

    if (isHtmlOrJs) {
      toolbar.querySelector('.canvas-run-btn').addEventListener('click', () => {
        triggerHaptic(20);
        openCanvasWithCode(codeText);
      });
    }

    pre.appendChild(toolbar);
  });
}

function openCanvasWithCode(code) {
  canvasCodeInput.value = code;
  renderCanvasIframe(code);
  canvasModal.classList.remove('hidden');
}

function renderCanvasIframe(code) {
  canvasIframe.srcdoc = code;
}

refreshCanvasBtn.addEventListener('click', () => {
  triggerHaptic(15);
  renderCanvasIframe(canvasCodeInput.value);
});

closeCanvasBtn.addEventListener('click', () => {
  canvasModal.classList.add('hidden');
});

// Edit & Action Buttons Bubble
function handleEditMessage(index) {
  triggerHaptic(15);
  const session = getCurrentSession();
  const targetMsg = session.messages[index];
  if (!targetMsg) return;

  const rawText = typeof targetMsg.content === 'string' ? targetMsg.content : (targetMsg.content[0]?.text || '');
  userInput.value = rawText;
  userInput.focus();

  session.messages = session.messages.slice(0, index);
  saveSessions();
  loadCurrentChat();
}

function addBubbleActionButtons(bubbleEl, text, index) {
  const stats = calculateReadingStats(text);
  const actions = document.createElement('div');
  actions.className = 'mt-3 pt-2 border-t border-black/20 flex flex-wrap items-center justify-between gap-2 text-xs not-prose';
  actions.innerHTML = `
    <span class="text-[10px] font-mono text-neutral-500">${stats}</span>
    <div class="flex gap-1.5">
      <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] copy-btn">Salin</button>
      <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] regen-btn">Regenerate 🔁</button>
      <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] speak-btn">Bicara 🔊</button>
    </div>
  `;

  actions.querySelector('.copy-btn').addEventListener('click', () => {
    triggerHaptic(15);
    navigator.clipboard.writeText(text);
    alert('Teks disalin!');
  });

  actions.querySelector('.regen-btn').addEventListener('click', async () => {
    triggerHaptic(15);
    const session = getCurrentSession();
    session.messages.pop();
    saveSessions();
    loadCurrentChat();
    await requestAIResponse(true);
  });

  actions.querySelector('.speak-btn').addEventListener('click', () => {
    triggerHaptic(15);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[#*`]/g, ''));
      u.lang = 'id-ID';
      u.rate = parseFloat(speechRateRange.value) || 1.0;
      window.speechSynthesis.speak(u);
    }
  });

  bubbleEl.appendChild(actions);
}

// --- VOICE CALL DENGAN VISUALIZER WAVEFORM REALTIME & AUDIO INTERRUPT ---
const callBtn = document.getElementById('call-btn');
const callOverlay = document.getElementById('call-overlay');
const hangupBtn = document.getElementById('hangup-btn');
const callStatus = document.getElementById('call-status');
const callTimer = document.getElementById('call-timer');
const callLiveText = document.getElementById('call-live-text');
const waveformCanvas = document.getElementById('waveform-canvas');
const canvasCtx = waveformCanvas.getContext('2d');

let isCalling = false;
let callInterval = null;
let callSeconds = 0;
let callRecognition = null;
let isAiSpeaking = false;
let silenceTimer = null;
let accumulatedUserSpeech = '';

// Web Audio API State
let audioContext = null;
let analyser = null;
let micSourceNode = null;
let micStream = null;
let animFrameId = null;

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SR) {
  callRecognition = new SR();
  callRecognition.lang = 'id-ID';
  callRecognition.continuous = true;
  callRecognition.interimResults = true;

  callRecognition.onstart = () => {
    if (isCalling && !isAiSpeaking) {
      callStatus.textContent = 'Mendengarkan Anda...';
    }
  };

  callRecognition.onresult = (e) => {
    if (!isCalling) return;

    let interim = '';
    let final = '';

    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }

    const currentSpoken = (final || interim).trim();

    // FITUR 4: AUDIO INTERRUPT (Jika AI sedang bicara dan Anda menyela bicara)
    if (isAiSpeaking && currentSpoken.length > 2) {
      window.speechSynthesis.cancel();
      isAiSpeaking = false;
      callStatus.textContent = 'Mendengarkan Anda...';
    }

    if (currentSpoken.length > 1 && !isAiSpeaking) {
      callLiveText.textContent = `Anda: "${currentSpoken}"`;
      accumulatedUserSpeech = currentSpoken;

      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (accumulatedUserSpeech.trim().length > 1 && !isAiSpeaking) {
          const textToSend = accumulatedUserSpeech.trim();
          accumulatedUserSpeech = '';

          try { callRecognition.stop(); } catch (_) {}
          callStatus.textContent = 'AI sedang berpikir...';
          sendVoiceToAI(textToSend);
        }
      }, 1200);
    }
  };

  callRecognition.onerror = (e) => {
    if (isCalling && !isAiSpeaking && e.error !== 'not-allowed') {
      setTimeout(() => {
        try { callRecognition.start(); } catch (_) {}
      }, 400);
    }
  };

  callRecognition.onend = () => {
    if (isCalling && !isAiSpeaking) {
      setTimeout(() => {
        try { callRecognition.start(); } catch (_) {}
      }, 400);
    }
  };
}

callBtn.addEventListener('click', async () => {
  triggerHaptic(20);
  if (!callRecognition) {
    alert('Browser tidak mendukung Speech Recognition untuk mode telepon.');
    return;
  }
  startCall();
});

async function startCall() {
  isCalling = true;
  isAiSpeaking = false;
  accumulatedUserSpeech = '';
  callSeconds = 0;
  callTimer.textContent = '00:00';
  callOverlay.classList.remove('hidden');

  // Inisialisasi Web Audio Analyser untuk Live Waveform
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    micSourceNode = audioContext.createMediaStreamSource(micStream);
    micSourceNode.connect(analyser);
    drawLiveWaveform();
  } catch (err) {
    console.warn('Web Audio init gagal:', err);
  }

  callInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    callTimer.textContent = `${m}:${s}`;
  }, 1000);

  speakCallResponse("Halo! Saya RZchat. Ada yang bisa saya bantu?");
}

// Gambar Gelombang Suara (Waveform) Realtime
function drawLiveWaveform() {
  if (!isCalling) return;

  animFrameId = requestAnimationFrame(drawLiveWaveform);
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  const barWidth = (waveformCanvas.width / bufferLength) * 1.5;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * waveformCanvas.height;
    canvasCtx.fillStyle = '#000000';
    canvasCtx.fillRect(x, waveformCanvas.height - barHeight, barWidth - 2, barHeight);
    x += barWidth;
  }
}

hangupBtn.addEventListener('click', endCall);

function endCall() {
  triggerHaptic(20);
  isCalling = false;
  isAiSpeaking = false;
  clearTimeout(silenceTimer);
  clearInterval(callInterval);
  cancelAnimationFrame(animFrameId);

  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (callRecognition) {
    try { callRecognition.stop(); } catch (_) {}
  }
  callOverlay.classList.add('hidden');
}

async function sendVoiceToAI(text) {
  const session = getCurrentSession();
  const callPrompt = `[MODE TELEPON: Jawab sangat singkat, padat, dan santai maksimal 2 kalimat tanpa markdown, tanpa bullet points, dan tanpa emoji]: ${text}`;
  
  session.messages.push({ role: 'user', content: callPrompt, displayHtml: escapeHtml(text) });
  saveSessions();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        temperature: 0.5,
        messages: session.messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullRes = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        const tr = line.trim();
        if (tr.startsWith('data:') && !tr.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(tr.replace('data:', '').trim());
            fullRes += parsed.choices?.[0]?.delta?.content || '';
          } catch (_) {}
        }
      }
    }

    session.messages.push({ role: 'assistant', content: fullRes });
    saveSessions();
    speakCallResponse(fullRes);

  } catch (err) {
    callLiveText.textContent = 'Koneksi terputus.';
    speakCallResponse("Maaf, suara terputus. Bisa tolong ulangi?");
  }
}

function speakCallResponse(text) {
  if (!('speechSynthesis' in window) || !isCalling) return;

  window.speechSynthesis.cancel();
  isAiSpeaking = true;
  callStatus.textContent = 'AI sedang berbicara... (Sela untuk interupsi)';

  const clean = text.replace(/[*#_`>\[\]]/g, '').trim();
  callLiveText.textContent = `AI: "${clean}"`;

  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'id-ID';
  utter.rate = parseFloat(speechRateRange?.value) || 1.05;

  const resumeListening = () => {
    if (!isCalling) return;
    setTimeout(() => {
      isAiSpeaking = false;
      accumulatedUserSpeech = '';
      callStatus.textContent = 'Mendengarkan Anda...';
      try { callRecognition.start(); } catch (_) {}
    }, 600);
  };

  utter.onend = resumeListening;
  utter.onerror = resumeListening;

  window.speechSynthesis.speak(utter);
}

// Ekspor Obrolan Sesi
exportTxtBtn.addEventListener('click', () => {
  triggerHaptic(15);
  const session = getCurrentSession();
  let content = `=== RIWAYAT OBROLAN RZCHAT ===\nJudul: ${session.title}\n\n`;
  session.messages.forEach(m => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    content += `[${m.role.toUpperCase()}]:\n${text}\n\n`;
  });
  downloadFile(content, `${session.title}.txt`, 'text/plain');
});

exportJsonBtn.addEventListener('click', () => {
  triggerHaptic(15);
  const session = getCurrentSession();
  downloadFile(JSON.stringify(session, null, 2), `${session.title}.json`, 'application/json');
});

function downloadFile(content, fileName, mime) {
  const b = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = fileName;
  a.click();
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Navigasi Drawer & Modal
menuBtn.addEventListener('click', () => {
  triggerHaptic(15);
  sidebarDrawer.classList.remove('hidden');
});
closeDrawerBtn.addEventListener('click', () => sidebarDrawer.classList.add('hidden'));
sidebarDrawer.addEventListener('click', (e) => {
  if (e.target === sidebarDrawer) sidebarDrawer.classList.add('hidden');
});

newChatBtn.addEventListener('click', () => {
  triggerHaptic(15);
  initNewSession();
  loadCurrentChat();
  sidebarDrawer.classList.add('hidden');
});

clearAllSessionsBtn.addEventListener('click', () => {
  triggerHaptic(25);
  if (confirm('Kosongkan seluruh riwayat chat?')) {
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    sessions = [];
    initNewSession();
    loadCurrentChat();
    sidebarDrawer.classList.add('hidden');
  }
});

settingsBtn.addEventListener('click', () => {
  triggerHaptic(15);
  settingsModal.classList.remove('hidden');
});
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

// Mulai aplikasi
renderSessionList();
loadCurrentChat();
