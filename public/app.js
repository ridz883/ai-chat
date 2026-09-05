pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const STORAGE_KEY = 'rzchat_history';
let conversationHistory = [];
let pendingAttachmentText = '';

const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const micBtn = document.getElementById('mic-btn');
const fileInput = document.getElementById('file-input');
const fileProcessingBar = document.getElementById('file-processing-bar');
const processingStatus = document.getElementById('processing-status');
const attachmentChip = document.getElementById('attachment-chip');
const attachmentName = document.getElementById('attachment-name');
const removeAttachmentBtn = document.getElementById('remove-attachment-btn');
const emptyState = document.getElementById('empty-state');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const wipeStorageBtn = document.getElementById('wipe-storage-btn');

marked.setOptions({ breaks: true, gfm: true });

// --- 1. PERBAIKAN BUG KEYBOARD TERTUTUP (VISUAL VIEWPORT) ---
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.body.style.height = `${window.visualViewport.height}px`;
    chatBox.scrollTop = chatBox.scrollHeight;
  });
  window.visualViewport.addEventListener('scroll', () => {
    window.scrollTo(0, 0);
  });
}

// Auto resize textarea
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

// --- 2. LOCAL STORAGE MANAGEMENT ---
function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
  } catch (e) {
    console.warn('Gagal menyimpan ke LocalStorage', e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    conversationHistory = JSON.parse(raw);

    if (conversationHistory.length > 0) {
      if (emptyState) emptyState.remove();
      chatBox.innerHTML = '';
      conversationHistory.forEach((msg) => {
        if (msg.role === 'user') {
          appendUserBubble(msg.content, false);
        } else if (msg.role === 'assistant') {
          const b = appendAiBubble(false);
          b.innerHTML = marked.parse(msg.content);
          b.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
      });
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  } catch (e) {
    console.error('Gagal membaca history:', e);
  }
}

// --- 3. PERBAIKAN FITUR VOICE NOTES (MIC) ---
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

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value = userInput.value ? `${userInput.value} ${transcript}` : transcript;
    userInput.dispatchEvent(new Event('input'));
  };

  recognition.onerror = (e) => {
    console.warn('Mic error:', e.error);
    stopRecording();
  };

  recognition.onend = () => stopRecording();

  micBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        // Meminta izin media eksplisit untuk Chrome Android
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        recognition.start();
      } catch (err) {
        alert('Izin mikrofon ditolak atau tidak didukung di browser ini.');
        stopRecording();
      }
    } else {
      recognition.stop();
    }
  });
} else {
  micBtn.classList.add('opacity-40');
  micBtn.title = 'Browser ini belum mendukung Web Speech API.';
}

function stopRecording() {
  isRecording = false;
  micBtn.classList.remove('recording-active');
}

// --- 4. PERBAIKAN FITUR OCR DENGAN CANVAS PREPROCESSING ---
async function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Grayscale & Thresholding filter
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Binarization kontras tinggi
        const val = avg > 140 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
  });
}

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  fileProcessingBar.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    const ext = file.name.split('.').pop().toLowerCase();

    if (file.type === 'application/pdf' || ext === 'pdf') {
      processingStatus.textContent = `Membaca PDF: ${file.name}...`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      setAttachment(file.name, text.trim());
    } else if (file.type.startsWith('image/')) {
      processingStatus.textContent = `Memproses & membersihkan gambar...`;
      const preprocessedUrl = await preprocessImage(file);
      
      processingStatus.textContent = `Menjalankan OCR teks...`;
      const ocr = await Tesseract.recognize(preprocessedUrl, 'ind+eng');
      const resultText = ocr.data.text.trim();

      if (!resultText) {
        alert('OCR selesai, teks tidak terdeteksi jelas. Pastikan foto cukup terang dan fokus.');
      }
      setAttachment(file.name, resultText || '[Teks pada gambar tidak terbaca]');
    } else {
      processingStatus.textContent = `Membaca file teks...`;
      const text = await file.text();
      setAttachment(file.name, text);
    }
  } catch (err) {
    alert(`Gagal memproses file: ${err.message}`);
  } finally {
    fileProcessingBar.classList.add('hidden');
    fileInput.value = '';
    sendBtn.disabled = false;
  }
});

function setAttachment(name, content) {
  pendingAttachmentText = `\n\n[ISI DOKUMEN: "${name}"]\n"""\n${content}\n"""`;
  attachmentName.textContent = name;
  attachmentChip.classList.remove('hidden');
}

removeAttachmentBtn.addEventListener('click', () => {
  pendingAttachmentText = '';
  attachmentChip.classList.add('hidden');
});

// --- 5. STREAMING & PENGIRIMAN PESAN ---
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let text = userInput.value.trim();
  if (!text && !pendingAttachmentText) return;

  let finalContent = text;
  if (pendingAttachmentText) {
    finalContent = text ? `${text}\n${pendingAttachmentText}` : `Jelaskan isi dokumen ini:\n${pendingAttachmentText}`;
  }

  userInput.value = '';
  userInput.style.height = 'auto';
  pendingAttachmentText = '';
  attachmentChip.classList.add('hidden');

  if (document.getElementById('empty-state')) {
    document.getElementById('empty-state').remove();
  }

  appendUserBubble(finalContent, true);
  conversationHistory.push({ role: 'user', content: finalContent });
  saveHistory();

  const aiBubble = appendAiBubble(true);
  sendBtn.disabled = true;
  let fullStreamText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(dataStr);
          const chunk = parsed.choices?.[0]?.delta?.content || '';
          if (chunk) {
            fullStreamText += chunk;
            aiBubble.innerHTML = marked.parse(fullStreamText);
            aiBubble.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
            chatBox.scrollTop = chatBox.scrollHeight;
          }
        } catch (_) {}
      }
    }

    conversationHistory.push({ role: 'assistant', content: fullStreamText });
    saveHistory();
  } catch (err) {
    aiBubble.innerHTML = `<span class="text-red-600 font-mono">[Error: ${err.message}]</span>`;
  } finally {
    sendBtn.disabled = false;
  }
});

function appendUserBubble(text, autoScroll = true) {
  const el = document.createElement('div');
  el.className = 'flex justify-end';
  el.innerHTML = `<div class="max-w-[85%] bg-black text-white p-3 border border-black text-sm whitespace-pre-wrap">${escapeHtml(text)}</div>`;
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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Reset Chat
clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  pendingAttachmentText = '';
  attachmentChip.classList.add('hidden');
  localStorage.removeItem(STORAGE_KEY);
  chatBox.innerHTML = `
    <div id="empty-state" class="text-center py-16">
      <p class="text-sm font-semibold uppercase tracking-wider text-neutral-400">Chat Direset</p>
      <p class="text-xs text-neutral-500 mt-1">Riwayat percakapan telah dibersihkan.</p>
    </div>
  `;
});

// Modal Settings Handler
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});

wipeStorageBtn.addEventListener('click', () => {
  if (confirm('Hapus seluruh riwayat percakapan yang tersimpan di perangkat ini?')) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
});

// Inisialisasi saat web pertama dibuka
loadHistory();
