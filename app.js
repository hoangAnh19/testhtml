const REPO_OWNER = 'hoangAnh19';
const REPO_NAME = 'testhtml';
const BRANCH = 'main';
const CHAT_PATH = 'data/chat.json';
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CHAT_PATH}`;
const STORAGE_KEY = 'github-json-chat-settings';
const POLL_MS = 5000;

const state = {
  messages: [],
  sha: null,
  isSending: false,
  settings: {
    identity: 'person_a',
    displayName: 'Người 1',
    token: '',
  },
};

const elements = {
  statusPill: document.querySelector('#statusPill'),
  statusText: document.querySelector('#statusText'),
  identitySelect: document.querySelector('#identitySelect'),
  displayNameInput: document.querySelector('#displayNameInput'),
  tokenInput: document.querySelector('#tokenInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  messages: document.querySelector('#messages'),
  emptyState: document.querySelector('#emptyState'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
  sendButton: document.querySelector('#sendButton'),
};

function loadSettings() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return;
  }

  try {
    state.settings = { ...state.settings, ...JSON.parse(saved) };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveSettings() {
  state.settings = {
    identity: elements.identitySelect.value,
    displayName: elements.displayNameInput.value.trim() || defaultName(elements.identitySelect.value),
    token: elements.tokenInput.value.trim(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  fillSettings();
  setStatus('Đã lưu cài đặt', 'online');
}

function fillSettings() {
  elements.identitySelect.value = state.settings.identity;
  elements.displayNameInput.value = state.settings.displayName || defaultName(state.settings.identity);
  elements.tokenInput.value = state.settings.token || '';
}

function defaultName(identity) {
  return identity === 'person_b' ? 'Người 2' : 'Người 1';
}

function authHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (state.settings.token) {
    headers.Authorization = `Bearer ${state.settings.token}`;
  }

  return headers;
}

async function fetchChat() {
  const response = await fetch(`${API_BASE}?ref=${encodeURIComponent(BRANCH)}&t=${Date.now()}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  const json = JSON.parse(decodeBase64(payload.content));

  return {
    sha: payload.sha,
    messages: Array.isArray(json.messages) ? json.messages : [],
  };
}

async function refreshChat({ silent = false } = {}) {
  try {
    const next = await fetchChat();
    state.sha = next.sha;
    state.messages = normalizeMessages(next.messages);
    renderMessages();
    setStatus('Đã đồng bộ', 'online');
  } catch (error) {
    if (!silent) {
      setStatus('Lỗi đồng bộ', 'error');
    }

    console.error(error);
  }
}

function normalizeMessages(messages) {
  return messages
    .filter((message) => message && message.id && message.text)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function renderMessages() {
  elements.messages.replaceChildren();
  elements.emptyState.classList.toggle('is-hidden', state.messages.length > 0);

  const fragment = document.createDocumentFragment();

  for (const message of state.messages) {
    const item = document.createElement('li');
    const bubble = document.createElement('article');
    const meta = document.createElement('div');
    const author = document.createElement('span');
    const time = document.createElement('time');
    const text = document.createElement('p');

    item.className = `message${message.author === state.settings.identity ? ' is-own' : ''}`;
    bubble.className = 'bubble';
    meta.className = 'meta';
    text.className = 'text';

    author.textContent = message.name || defaultName(message.author);
    time.dateTime = message.createdAt;
    time.textContent = formatTime(message.createdAt);
    text.textContent = message.text;

    meta.append(author, time);
    bubble.append(meta, text);
    item.append(bubble);
    fragment.append(item);
  }

  elements.messages.append(fragment);
  elements.messages.parentElement.scrollTop = elements.messages.parentElement.scrollHeight;
}

function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

async function sendMessage(text) {
  if (!state.settings.token) {
    setStatus('Cần token để gửi', 'error');
    elements.tokenInput.focus();
    return;
  }

  state.isSending = true;
  elements.sendButton.disabled = true;
  setStatus('Đang gửi', 'pending');

  const message = {
    id: `${Date.now()}-${randomId()}`,
    author: state.settings.identity,
    name: state.settings.displayName || defaultName(state.settings.identity),
    text,
    createdAt: new Date().toISOString(),
  };

  try {
    await commitMessageWithRetry(message);
    elements.messageInput.value = '';
    resizeComposer();
    await refreshChat();
    setStatus('Đã gửi', 'online');
  } catch (error) {
    console.error(error);
    setStatus('Gửi thất bại', 'error');
  } finally {
    state.isSending = false;
    elements.sendButton.disabled = false;
    elements.messageInput.focus();
  }
}

async function commitMessageWithRetry(message) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await fetchChat();
    const merged = mergeMessages(latest.messages, [message]);
    const body = {
      message: `Add chat message ${message.id}`,
      content: encodeBase64(JSON.stringify({
        updatedAt: new Date().toISOString(),
        messages: merged,
      }, null, 2)),
      sha: latest.sha,
      branch: BRANCH,
    };

    const response = await fetch(API_BASE, {
      method: 'PUT',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const result = await response.json();
      state.sha = result.content.sha;
      state.messages = normalizeMessages(merged);
      renderMessages();
      return;
    }

    if (response.status !== 409) {
      throw new Error(await response.text());
    }
  }

  throw new Error('Could not update chat after multiple merge attempts.');
}

function mergeMessages(current, additions) {
  const byId = new Map();

  for (const message of [...current, ...additions]) {
    byId.set(message.id, message);
  }

  return normalizeMessages([...byId.values()]);
}

function randomId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 12);
}

function decodeBase64(value) {
  const clean = value.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function setStatus(text, type) {
  elements.statusText.textContent = text;
  elements.statusPill.classList.toggle('is-online', type === 'online');
  elements.statusPill.classList.toggle('is-error', type === 'error');
}

function resizeComposer() {
  elements.messageInput.style.height = 'auto';
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 140)}px`;
}

elements.saveSettingsButton.addEventListener('click', saveSettings);

elements.identitySelect.addEventListener('change', () => {
  if (!elements.displayNameInput.value.trim() || /^Người [12]$/.test(elements.displayNameInput.value.trim())) {
    elements.displayNameInput.value = defaultName(elements.identitySelect.value);
  }
});

elements.messageInput.addEventListener('input', resizeComposer);

elements.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.messageForm.requestSubmit();
  }
});

elements.messageForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (state.isSending) {
    return;
  }

  saveSettings();

  const text = elements.messageInput.value.trim();

  if (text) {
    sendMessage(text);
  }
});

loadSettings();
fillSettings();
refreshChat();
setInterval(() => refreshChat({ silent: true }), POLL_MS);
