pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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

marked.setOptions({ breaks: true, gfm: true });

// Auto resize textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = `${Math.min(userInput.scrollHeight, 144)}px`;
});

// Kirim dengan Enter (Shift + Enter untuk baris baru)
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// Voice-to-Text (VN langsung jadi teks di browser)
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

  recognition.onerror = () => stopRecording();
  recognition.onend = () => stopRecording();

  micBtn.addEventListener('click', () => {
    if (!isRecording) {
      try { recognition.start(); } catch (_) { stopRecording(); }
    } else {
      recognition.stop();
    }
  });
} else {
  micBtn.title = 'Browser tidak mendukung voice recognition';
  micBtn.disabled = true;
}

function stopRecording() {
  isRecording = false;
  micBtn.classList.remove('recording-active');
}

// Baca Dokumen & Foto (PDF & OCR Gambar)
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  fileProcessingBar.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    const ext = file.name.split('.').pop().toLowerCase();

    if (file.type === 'application/pdf' || ext === 'pdf') {
      processingStatus.textContent = `Mengekstrak teks PDF: ${file.name}...`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      setAttachment(file.name, text);
    } else if (file.type.startsWith('image/')) {
      processingStatus.textContent = `Mengekstrak teks foto (OCR): ${file.name}...`;
      const ocr = await Tesseract.recognize(file, 'ind+eng');
      setAttachment(file.name, ocr.data.text.trim() || '[Tidak ada teks terdeteksi di foto]');
    } else {
      processingStatus.textContent = `Membaca file teks: ${file.name}...`;
      const text = await file.text();
      setAttachment(file.name, text);
    }
  } catch (err) {
    alert(`Gagal membaca file: ${err.message}`);
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

// Pengiriman Pesan & SSE Streaming
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let text = userInput.value.trim();
  if (!text && !pendingAttachmentText) return;

  let finalContent = text;
  if (pendingAttachmentText) {
    finalContent = text ? `${text}\n${pendingAttachmentText}` : `Tolong jelaskan isi file ini:\n${pendingAttachmentText}`;
  }

  userInput.value = '';
  userInput.style.height = 'auto';
  pendingAttachmentText = '';
  attachmentChip.classList.add('hidden');

  if (emptyState) emptyState.remove();

  appendUserBubble(finalContent);
  conversationHistory.push({ role: 'user', content: finalContent });

  const aiBubble = appendAiBubble();
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
            aiBubble.querySelectorAll('pre code').forEach((block) => {
              hljs.highlightElement(block);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
          }
        } catch (_) {}
      }
    }

    conversationHistory.push({ role: 'assistant', content: fullStreamText });
  } catch (err) {
    aiBubble.innerHTML = `<span class="text-red-600 font-mono">[Error: ${err.message}]</span>`;
  } finally {
    sendBtn.disabled = false;
  }
});

function appendUserBubble(text) {
  const el = document.createElement('div');
  el.className = 'flex justify-end';
  el.innerHTML = `<div class="max-w-[85%] md:max-w-[75%] bg-black text-white p-3 border border-black text-sm whitespace-pre-wrap">${escapeHtml(text)}</div>`;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendAiBubble() {
  const el = document.createElement('div');
  el.className = 'flex justify-start';
  el.innerHTML = `<div class="max-w-[90%] md:max-w-[80%] bg-white text-black p-3.5 border border-black text-sm prose shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"><span class="inline-block w-2 h-4 bg-black animate-pulse"></span></div>`;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
  return el.querySelector('.prose');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  pendingAttachmentText = '';
  attachmentChip.classList.add('hidden');
  chatBox.innerHTML = `
    <div id="empty-state" class="text-center py-16">
      <p class="text-sm font-semibold uppercase tracking-wider text-neutral-400">Chat Direset</p>
      <p class="text-xs text-neutral-500 mt-1">Riwayat percakapan telah dibersihkan.</p>
    </div>
  `;
});
