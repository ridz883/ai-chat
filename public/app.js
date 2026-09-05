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

// --- SESSION & STORAGE MANAGEMENT ---
const SESSIONS_KEY = 'rzchat_sessions';
const ACTIVE_SESSION_KEY = 'rzchat_active_id';
const MODEL_KEY = 'rzchat_selected_model';
const SYSTEM_PROMPT_KEY = 'rzchat_system_prompt';
const SPEECH_RATE_KEY = 'rzchat_speech_rate';

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

let pendingAttachment = null;
let currentAbortController = null;

marked.setOptions({ breaks: true, gfm: true });

// Mobile Viewport Keyboard Fix
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
        <p class="text-xs text-neutral-500 mt-1">Mendukung Telepon AI, Edit/Regenerate, Stop Generating, Multimodal & VN.</p>
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

// --- VOICE NOTES / STT ---
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

  micBtn.addEventListener('click', () => {
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

// --- FILE UPLOAD (VISION BASE64 & PDF) ---
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  fileProcessingBar.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    if (file.type.startsWith('image/')) {
      processingStatus.textContent = 'Memproses visual gambar...';
      const base64Data = await fileToBase64(file);
      pendingAttachment = { type: 'image', name: file.name, base64Url: base64Data };
      thumbPreview.style.backgroundImage = `url(${base64Data})`;
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

// --- SUBMIT PESAN, REALTIME TYPING & ANIMASI LOADING ---
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

  const userMsgIndex = session.messages.length;
  appendUserBubble(displayHtml, true, userMsgIndex);
  session.messages.push({ role: 'user', content: aiContentPayload, displayHtml: displayHtml });
  saveSessions();

  await requestAIResponse();
});

// Fungsi Eksekusi Response dengan Streaming Realtime + Video Loader
async function requestAIResponse(isRegenerate = false) {
  const session = getCurrentSession();
  const aiBubble = appendAiBubble(true, true); // true = include video animasi
  sendBtn.disabled = true;
  stopContainer.classList.remove('hidden');

  currentAbortController = new AbortController();
  let fullRes = '';

  // Gabungkan riwayat chat dengan system prompt jika ada
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
        messages: payloadMessages
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
            // Ketikan teks AI muncul langsung saat sedang mikir / streaming
            updateAiTypingContent(aiBubble, fullRes);
            chatBox.scrollTop = chatBox.scrollHeight;
          }
        } catch (_) {}
      }
    }

    // Selesai streaming: Hilangkan video animasi loader
    finalizeAiBubble(aiBubble, fullRes);

    if (isRegenerate) {
      session.messages[session.messages.length - 1] = { role: 'assistant', content: fullRes };
    } else {
      session.messages.push({ role: 'assistant', content: fullRes });
    }
    saveSessions();

    const aiMsgIndex = session.messages.length - 1;
    addBubbleActionButtons(aiBubble, fullRes, aiMsgIndex);

  } catch (err) {
    if (err.name === 'AbortError') {
      finalizeAiBubble(aiBubble, fullRes + '\n\n*(Dihentikan oleh pengguna)*');
      session.messages.push({ role: 'assistant', content: fullRes });
      saveSessions();
    } else {
      aiBubble.innerHTML = `<span class="text-red-600 font-mono">[Error: ${err.message}]</span>`;
    }
  } finally {
    sendBtn.disabled = false;
    stopContainer.classList.add('hidden');
    currentAbortController = null;
  }
}

// Stop Generating Handler
stopBtn.addEventListener('click', () => {
  if (currentAbortController) {
    currentAbortController.abort();
  }
});

// Render Bubble UI & Animasi Loading Video
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
  }
}

function finalizeAiBubble(bubbleEl, text) {
  const loader = bubbleEl.querySelector('.loader-wrapper');
  if (loader) loader.remove();
  const body = bubbleEl.querySelector('.ai-content-body');
  if (body) {
    body.innerHTML = marked.parse(text);
    body.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
  }
}

// Fitur Edit Pesan User
function handleEditMessage(index) {
  const session = getCurrentSession();
  const targetMsg = session.messages[index];
  if (!targetMsg) return;

  const rawText = typeof targetMsg.content === 'string' ? targetMsg.content : (targetMsg.content[0]?.text || '');
  userInput.value = rawText;
  userInput.focus();

  // Potong riwayat percakapan sampai sebelum pesan ini
  session.messages = session.messages.slice(0, index);
  saveSessions();
  loadCurrentChat();
}

// Fitur Regenerate, Copy & Voice TTS
function addBubbleActionButtons(bubbleEl, text, index) {
  const actions = document.createElement('div');
  actions.className = 'mt-3 pt-2 border-t border-black/20 flex gap-2 text-xs not-prose';
  actions.innerHTML = `
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] copy-btn">Salin</button>
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] regen-btn">Regenerate 🔁</button>
    <button class="px-2 py-0.5 border border-black hover:bg-black hover:text-white uppercase font-bold text-[10px] speak-btn">Bicara 🔊</button>
  `;

  actions.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(text);
    alert('Teks disalin!');
  });

  actions.querySelector('.regen-btn').addEventListener('click', async () => {
    const session = getCurrentSession();
    // Hapus pesan AI terakhir
    session.messages.pop();
    saveSessions();
    loadCurrentChat();
    await requestAIResponse(true);
  });

  actions.querySelector('.speak-btn').addEventListener('click', () => {
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

// --- OPTIMASI FITUR VOICE CALL (TELEPONAN INTERAKTIF) ---
const callBtn = document.getElementById('call-btn');
const callOverlay = document.getElementById('call-overlay');
const hangupBtn = document.getElementById('hangup-btn');
const callStatus = document.getElementById('call-status');
const callTimer = document.getElementById('call-timer');
const callLiveText = document.getElementById('call-live-text');

let isCalling = false;
let callInterval = null;
let callSeconds = 0;
let callRecognition = null;

if (SpeechRecognition) {
  callRecognition = new SpeechRecognition();
  callRecognition.lang = 'id-ID';
  callRecognition.continuous = false;
  callRecognition.interimResults = false;

  callRecognition.onstart = () => {
    if (!isCalling) return;
    callStatus.textContent = 'Mendengarkan Anda...';
  };

  callRecognition.onresult = async (e) => {
    if (!isCalling) return;
    const userSpoke = e.results[0][0].transcript;
    callLiveText.textContent = `Anda: "${userSpoke}"`;
    callStatus.textContent = 'AI sedang berpikir...';
    await sendVoiceToAI(userSpoke);
  };

  callRecognition.onerror = (e) => {
    if (isCalling && e.error === 'no-speech') {
      try { callRecognition.start(); } catch (_) {}
    }
  };
}

callBtn.addEventListener('click', async () => {
  if (!callRecognition) {
    alert('Browser Anda tidak mendukung Speech Recognition untuk telepon.');
    return;
  }
  try {
    if (navigator.mediaDevices) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
    }
    startCall();
  } catch {
    alert('Izin mic dibutuhkan untuk telepon.');
  }
});

function startCall() {
  isCalling = true;
  callSeconds = 0;
  callTimer.textContent = '00:00';
  callOverlay.classList.remove('hidden');

  callInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    callTimer.textContent = `${m}:${s}`;
  }, 1000);

  speakCallResponse("Halo! Saya RZchat. Ada yang bisa saya bantu sekarang?");
}

hangupBtn.addEventListener('click', endCall);

function endCall() {
  isCalling = false;
  clearInterval(callInterval);
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (callRecognition) {
    try { callRecognition.stop(); } catch (_) {}
  }
  callOverlay.classList.add('hidden');
}

async function sendVoiceToAI(text) {
  const session = getCurrentSession();
  const callPrompt = `[MODE TELEPON AKTIF: Jawablah dengan sangat singkat, padat, santai layaknya orang teleponan tanpa bullet point, tanpa simbol markdown, dan tanpa emoji]: ${text}`;
  
  session.messages.push({ role: 'user', content: callPrompt, displayHtml: escapeHtml(text) });
  saveSessions();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
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
    callLiveText.textContent = 'Gagal memproses respons.';
    speakCallResponse("Maaf, suara kurang jelas. Bisa tolong ulangi?");
  }
}

function speakCallResponse(text) {
  if (!('speechSynthesis' in window) || !isCalling) return;

  window.speechSynthesis.cancel();
  callStatus.textContent = 'AI sedang berbicara...';
  const clean = text.replace(/[*#_`>\[\]]/g, '').trim();
  callLiveText.textContent = `AI: "${clean}"`;

  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'id-ID';
  utter.rate = parseFloat(speechRateRange.value) || 1.05;

  utter.onend = () => {
    if (!isCalling) return;
    callStatus.textContent = 'Mendengarkan Anda...';
    try { callRecognition.start(); } catch (_) {}
  };

  window.speechSynthesis.speak(utter);
}

// Ekspor Chat Sesi
exportTxtBtn.addEventListener('click', () => {
  const session = getCurrentSession();
  let content = `=== RIWAYAT OBROLAN RZCHAT ===\nJudul: ${session.title}\n\n`;
  session.messages.forEach(m => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    content += `[${m.role.toUpperCase()}]:\n${text}\n\n`;
  });
  downloadFile(content, `${session.title}.txt`, 'text/plain');
});

exportJsonBtn.addEventListener('click', () => {
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

// Drawer & Modal Event Listeners
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

// Mulai aplikasi
renderSessionList();
loadCurrentChat();
