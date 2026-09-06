pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- HAPTIC FEEDBACK ---
function triggerHaptic(duration = 15) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(duration); } catch (_) {}
  }
}

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

// Input File Dokumen & Galeri Universal
const btnGallery = document.getElementById('btn-gallery');
const btnCamera = document.getElementById('btn-camera');
const inputUniversal = document.getElementById('input-universal');
const inputCamera = document.getElementById('input-camera');

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
  const threshold = 80;
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

// --- RENDER DRAWER SESSIONS ---
function renderSessionList() {
  sessionList.innerHTML = '';
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  sortedSessions.forEach(s => {
    const item = document.createElement('div');
    item.className = `p-2 border border-neutral-200 rounded cursor-pointer flex justify-between items-center transition relative ${s.id === currentSessionId ? 'bg-black text-white' : 'hover:bg-neutral-50'}`;
    item.innerHTML = `
      <div class="flex items-center gap-1.5 truncate flex-1">
        ${s.pinned ? '<span class="text-[10px]">📌</span>' : ''}
        <span class="truncate font-mono">${escapeHtml(s.title)}</span>
      </div>
      <div class="flex items-center gap-1">
        <button class="px-1 text-[10px] text-neutral-400 hover:text-black pin-session-btn" data-id="${s.id}">${s.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="font-bold px-1 text-neutral-400 hover:text-red-600 delete-session-btn" data-id="${s.id}">✕</button>
      </div>
    `;

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

  document.querySelectorAll('.pin-session-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerHaptic(15);
      togglePinSession(btn.getAttribute('data-id'));
    });
  });

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
      <div id="empty-state" class="text-center py-24 select-none">
        <img src="https://i.ibb.co.com/BHf8jj3m/file-00000000cdd08211b0b7692d42ccf4ef.png" class="w-12 h-12 mx-auto mb-3 object-contain" alt="RZchat Logo">
        <p class="text-xs font-semibold uppercase tracking-wider text-neutral-400">RZchat Workspace</p>
        <p class="text-[11px] text-neutral-400 mt-1">Multi-Model AI · Voice Call · Vision Multimodal · Live Canvas</p>
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

// --- VOICE NOTES INPUT CHAT (STT) ---
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

// --- FILE PICKER DOCUMENTS & CAMERA ---
btnGallery.addEventListener('click', () => {
  triggerHaptic(15);
  inputUniversal.click();
});

btnCamera.addEventListener('click', () => {
  triggerHaptic(15);
  inputCamera.click();
});

[inputUniversal, inputCamera].forEach(inp => {
  inp.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileProcessingBar.classList.remove('hidden');
    sendBtn.disabled = true;

    try {
      if (file.type.startsWith('image/')) {
        processingStatus.textContent = 'Memuat gambar...';
        const base64Data = await fileToBase64(file);
        pendingAttachment = { type: 'image', name: file.name, base64Url: base64Data };
        thumbPreview.style.backgroundImage = `url(${base64Data})`;
        thumbPreview.classList.remove('hidden');
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
      } else {
        processingStatus.textContent = 'Membaca berkas...';
        const text = await file.text();
        pendingAttachment = { type: 'text', name: file.name, extractedText: text };
        thumbPreview.classList.add('hidden');
      }
      attachmentName.textContent = file.name;
      attachmentChip.classList.remove('hidden');
      triggerHaptic(20);
    } catch (err) {
      alert('Gagal membaca berkas: ' + err.message);
    } finally {
      fileProcessingBar.classList.add('hidden');
      inp.value = '';
      sendBtn.disabled = false;
    }
  });
});

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

// --- SUBMIT PESAN CHAT ---
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
        { type: "text", text: text || "Jelaskan dan analisis isi gambar ini secara detail." },
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

// Request AI Streaming Response
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
      retryBar.classList.remove('hidden');
    }
  } finally {
    sendBtn.disabled = false;
    stopContainer.classList.add('hidden');
    currentAbortController = null;
  }
}

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

// Dynamic Title Otomatis
async function generateDynamicTitle(session) {
  try {
    const prompt = "Buatkan judul sangat singkat 3 sampai 4 kata saja (tanpa tanda kutip atau titik) yang merangkum pertanyaan ini: " + (typeof session.messages[0].content === 'string' ? session.messages[0].content : 'Lampiran');
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

// Render Bubble UI
function appendUserBubble(htmlContent, autoScroll = true, index = null) {
  const el = document.createElement('div');
  el.className = 'flex flex-col items-end gap-1';
  el.innerHTML = `
    <div class="max-w-[85%] bg-black text-white p-3 rounded-lg text-sm">${htmlContent}</div>
    ${index !== null ? `<button class="text-[10px] uppercase font-bold text-neutral-400 hover:text-black edit-msg-btn" data-index="${index}">Edit ✎</button>` : ''}
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
    <div class="max-w-[90%] bg-white text-black p-3.5 border border-neutral-200 rounded-lg text-sm prose shadow-sm">
      ${showLoader ? `
        <div class="flex items-center gap-2 mb-2 loader-wrapper">
          <video src="https://videotourl.com/videos/1788670557376-a9c3e8e5-7da0-4f74-abfe-6e415b0f227d.mp4" autoplay loop muted playsinline class="loader-video"></video>
          <span class="text-xs font-mono text-neutral-400 animate-pulse">RZchat sedang mengetik...</span>
        </div>
      ` : ''}
      <div class="ai-content-body"><span class="inline-block w-1.5 h-3.5 bg-black animate-pulse"></span></div>
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

// Live Canvas Toolbar
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

    const isHtmlOrJs = codeText.includes('<html') || codeText.includes('<!DOCTYPE') || codeText.includes('<div') || codeText.includes('<button') || codeText.includes('<script');

    const toolbar = document.createElement('div');
    toolbar.className = 'absolute top-2 right-2 flex gap-1 z-10 not-prose';
    toolbar.innerHTML = `
      ${isHtmlOrJs ? '<button class="px-2 py-0.5 bg-white text-black text-[10px] uppercase font-bold border border-neutral-300 rounded hover:bg-black hover:text-white canvas-run-btn">Canvas 🌐</button>' : ''}
      <button class="px-2 py-0.5 bg-neutral-800 text-white text-[10px] uppercase font-bold rounded hover:bg-neutral-700 copy-code-btn">Salin</button>
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

// Edit & Actions Bubble
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
  actions.className = 'mt-3 pt-2 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-xs not-prose';
  actions.innerHTML = `
    <span class="text-[10px] font-mono text-neutral-400">${stats}</span>
    <div class="flex gap-1">
      <button class="px-2 py-0.5 border border-neutral-300 rounded hover:bg-neutral-100 uppercase font-bold text-[10px] copy-btn">Salin</button>
      <button class="px-2 py-0.5 border border-neutral-300 rounded hover:bg-neutral-100 uppercase font-bold text-[10px] regen-btn">Regenerate 🔁</button>
      <button class="px-2 py-0.5 border border-neutral-300 rounded hover:bg-neutral-100 uppercase font-bold text-[10px] speak-btn">Bicara 🔊</button>
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

// --- VOICE CALL DUA ARAH STABIL & BEBAS DEADLOCK ---
const callBtn = document.getElementById('call-btn');
const callOverlay = document.getElementById('call-overlay');
const hangupBtn = document.getElementById('hangup-btn');
const callStatus = document.getElementById('call-status');
const callTimer = document.getElementById('call-timer');
const callLiveText = document.getElementById('call-live-text');
const waveformContainer = document.getElementById('waveform-container');

let isCalling = false;
let callInterval = null;
let callSeconds = 0;
let callRecognition = null;
let isAiSpeaking = false;
let silenceTimer = null;
let speechUnlockTimeout = null;
let accumulatedUserSpeech = '';

const CallSR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (CallSR) {
  callRecognition = new CallSR();
  callRecognition.lang = 'id-ID';
  callRecognition.continuous = true;
  callRecognition.interimResults = true;

  callRecognition.onstart = () => {
    if (isCalling && !isAiSpeaking) {
      callStatus.textContent = 'Mendengarkan Anda...';
      waveformContainer.classList.add('wave-active');
    }
  };

  callRecognition.onresult = (e) => {
    if (!isCalling) return;

    // Audio Interrupt: Jika AI sedang bicara dan pengguna memotong omongan
    if (isAiSpeaking) {
      window.speechSynthesis.cancel();
      isAiSpeaking = false;
      callStatus.textContent = 'Mendengarkan Anda...';
    }

    let interim = '';
    let final = '';

    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        final += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }

    const currentSpoken = (final || interim).trim();

    if (currentSpoken.length > 1) {
      callLiveText.textContent = `Anda: "${currentSpoken}"`;
      accumulatedUserSpeech = currentSpoken;
      waveformContainer.classList.add('wave-active');

      // Debounce: deteksi hening 1.2 detik tanda selesai berbicara
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (accumulatedUserSpeech.trim().length > 1 && !isAiSpeaking) {
          const textToSend = accumulatedUserSpeech.trim();
          accumulatedUserSpeech = '';

          try { callRecognition.stop(); } catch (_) {}
          waveformContainer.classList.remove('wave-active');
          callStatus.textContent = 'AI sedang berpikir...';
          sendVoiceToAI(textToSend);
        }
      }, 1200);
    }
  };

  callRecognition.onerror = (e) => {
    console.warn('Call SR error:', e.error);
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

callBtn.addEventListener('click', () => {
  triggerHaptic(20);
  if (!callRecognition) {
    alert('Browser tidak mendukung Speech Recognition untuk mode telepon.');
    return;
  }
  startCall();
});

function startCall() {
  isCalling = true;
  isAiSpeaking = false;
  accumulatedUserSpeech = '';
  callSeconds = 0;
  callTimer.textContent = '00:00';
  callOverlay.classList.remove('hidden');

  callInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    callTimer.textContent = `${m}:${s}`;
  }, 1000);

  speakCallResponse("Halo! Saya RZchat. Ada yang bisa saya bantu?");
}

hangupBtn.addEventListener('click', endCall);

function endCall() {
  triggerHaptic(20);
  isCalling = false;
  isAiSpeaking = false;
  clearTimeout(silenceTimer);
  clearTimeout(speechUnlockTimeout);
  clearInterval(callInterval);

  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (callRecognition) {
    try { callRecognition.stop(); } catch (_) {}
  }
  waveformContainer.classList.remove('wave-active');
  callOverlay.classList.add('hidden');
}

async function sendVoiceToAI(text) {
  const session = getCurrentSession();
  const callPrompt = `[MODE TELEPON AKTIF: Jawablah langsung, santai, ringkas maksimal 2 kalimat tanpa markdown, tanpa bullet points, dan tanpa emoji]: ${text}`;
  
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
    callLiveText.textContent = 'Koneksi suara terputus.';
    speakCallResponse("Maaf, jaringan suara terputus. Bisa tolong ulangi?");
  }
}

function speakCallResponse(text) {
  if (!('speechSynthesis' in window) || !isCalling) return;

  window.speechSynthesis.cancel();
  isAiSpeaking = true;
  callStatus.textContent = 'AI sedang berbicara...';
  waveformContainer.classList.add('wave-active');

  try { callRecognition.stop(); } catch (_) {}

  const clean = text.replace(/[*#_`>\[\]]/g, '').trim();
  callLiveText.textContent = `AI: "${clean}"`;

  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'id-ID';
  utter.rate = parseFloat(speechRateRange?.value) || 1.05;

  const resumeTurn = () => {
    if (!isCalling) return;
    clearTimeout(speechUnlockTimeout);
    setTimeout(() => {
      isAiSpeaking = false;
      accumulatedUserSpeech = '';
      callStatus.textContent = 'Mendengarkan Anda...';
      waveformContainer.classList.remove('wave-active');
      try { callRecognition.start(); } catch (_) {}
    }, 500);
  };

  utter.onend = resumeTurn;
  utter.onerror = resumeTurn;

  // Fallback pengaman: cegah speech deadlock jika browser Android lupa menembakkan event onend
  clearTimeout(speechUnlockTimeout);
  const estimatedDuration = Math.max(3000, clean.split(' ').length * 450);
  speechUnlockTimeout = setTimeout(resumeTurn, estimatedDuration);

  window.speechSynthesis.speak(utter);
}

// Ekspor Obrolan
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
