/* ============================
   STATE
   ============================ */
let conversations  = JSON.parse(localStorage.getItem('orion_convs') || '[]');
let activeId       = null;
let isTyping       = false;
let stopFlag       = false;
let typingTimer    = null;
let renamingId     = null;
let abortCtrl      = null;   // for cancelling fetch streams
let attachedFiles  = [];     // pending file attachments
let _pendingUserMsg = null;  // user msg waiting to be saved to backend after AI responds
let _currentSearchResults = null; // Tavily results for current message (rendered as sources card)
let searchModeActive = false;     // toggled by globe button

/* ============================
   ORION SYSTEM PROMPT
   ============================ */
const SYSTEM_PROMPT = `You are Orion, an advanced AI assistant platform built to help students, professionals, organizations, and future generations. You were created by Ibrahim as part of the Orion AI project.

You specialize in:
- Natural, helpful conversation on any topic
- Career guidance and roadmap generation (engineering, medicine, cybersecurity, AI, etc.)
- Learning path creation and educational mentorship
- Coding help across all languages and frameworks
- Research assistance, thesis support, and academic writing
- Cybersecurity awareness and guidance
- Document analysis and summarization
- Professional writing, emails, and communication

Personality: Thoughtful, precise, honest, encouraging, and concise. Never pad responses unnecessarily. Format clearly with markdown — use code blocks, headers, and bullet points where they genuinely help.

Important: You are Orion AI, not ChatGPT or Claude. Do not claim to be any other AI.`;

/* ============================
   API CONFIGURATION
   ============================ */
function getApiKey()    { return localStorage.getItem('orion_api_key') || ''; }
function getProvider()  { return localStorage.getItem('orion_provider') || 'openai'; }

function saveApiConfig(key, provider) {
  localStorage.setItem('orion_api_key', key);
  localStorage.setItem('orion_provider', provider);
  updateApiStatusDot();
}

function updateApiStatusDot() {
  const dot = document.getElementById('apiStatusDot');
  if (!dot) return;
  dot.classList.toggle('connected', !!getApiKey());
  dot.classList.remove('error');
}

/* ============================
   INIT
   ============================ */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('orion_theme') || 'dark');
  updateApiStatusDot();

  // Restore auth session if tokens exist
  const savedToken = localStorage.getItem('orion_access_token');
  const savedUser  = localStorage.getItem('orion_user');
  if (savedToken && savedUser) {
    isBackendMode = true;
    updateUserUI();
    loadConversationsFromAPI().catch(() => renderSidebar());
    checkAdminLink(); // show admin dashboard link if user is admin
  } else {
    updateUserUI();
    renderSidebar();
  }

  document.getElementById('sidebarCollapseBtn').addEventListener('click', collapseSidebar);
  document.getElementById('sidebarOpenBtn').addEventListener('click', expandSidebar);
  document.getElementById('newChatBtn').addEventListener('click', startNewChat);

  showWelcome();
  initFileUpload();

  // Prefill textarea if arriving from career page
  const prefill = localStorage.getItem('orion_prefill');
  if (prefill) {
    localStorage.removeItem('orion_prefill');
    const inp = document.getElementById('msgInput');
    if (inp) { inp.value = prefill; autoResize(inp); inp.focus(); }
  }

  // Restore provider selector in settings
  const providerSelect = document.getElementById('providerSelect');
  if (providerSelect) {
    providerSelect.value = getProvider();
    updateProviderHint();
  }
});

/* ============================
   THEME
   ============================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('orion_theme', t);
  const isDark = t === 'dark';
  const icon   = isDark ? '☀️' : '🌙';
  const label  = isDark ? 'Light mode' : 'Dark mode';
  const ti  = document.getElementById('themeIcon');
  const tl  = document.getElementById('themeLabel');
  const hti = document.getElementById('headerThemeIcon');
  if (ti)  ti.textContent  = icon;
  if (tl)  tl.textContent  = label;
  if (hti) hti.textContent = icon;
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ============================
   SETTINGS MODAL
   ============================ */
function openSettings() {
  const overlay  = document.getElementById('settingsOverlay');
  const keyInput = document.getElementById('apiKeyInput');
  const sel      = document.getElementById('providerSelect');
  const skInput  = document.getElementById('searchKeyInput');
  if (keyInput) keyInput.value = getApiKey();
  if (sel)      sel.value      = getProvider();
  if (skInput)  skInput.value  = getSearchKey();
  updateProviderHint();
  overlay.classList.add('open');
  setTimeout(() => keyInput && keyInput.focus(), 80);
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
  document.getElementById('settingsStatus').textContent = '';
  document.getElementById('settingsStatus').className   = 'settings-status';
}

function saveApiKey() {
  const key      = document.getElementById('apiKeyInput').value.trim();
  const provider = document.getElementById('providerSelect').value;
  const status   = document.getElementById('settingsStatus');

  if (!key) {
    status.textContent = '⚠ Please enter your API key.';
    status.className   = 'settings-status err';
    return;
  }

  saveApiConfig(key, provider);

  // Also save search key if filled
  const sk = (document.getElementById('searchKeyInput')?.value || '').trim();
  if (sk) localStorage.setItem('orion_search_key', sk);

  status.textContent = '✓ Saved! You\'re ready to chat with Orion.';
  status.className   = 'settings-status ok';

  // Remove any no-key banner that may be showing
  document.querySelectorAll('.no-key-banner').forEach(el => el.remove());

  setTimeout(closeSettings, 1200);
}

function clearApiKey() {
  localStorage.removeItem('orion_api_key');
  localStorage.removeItem('orion_provider');
  document.getElementById('apiKeyInput').value = '';
  const status = document.getElementById('settingsStatus');
  status.textContent = 'Key cleared.';
  status.className   = 'settings-status';
  updateApiStatusDot();
}

function toggleKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  input.type  = input.type === 'password' ? 'text' : 'password';
}

function updateProviderHint() {
  const provider = document.getElementById('providerSelect').value;
  const hint     = document.getElementById('providerHint');
  if (!hint) return;

  const hints = {
    groq:      '✅ <strong>100% Free, no credit card.</strong> Get a key at <a href="https://console.groq.com/keys" target="_blank">console.groq.com</a>. Uses Llama 3 (very fast & smart).',
    openai:    'Get a free key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>. New accounts get $5 free credit. Uses gpt-4o-mini (fast & affordable).',
    anthropic: 'Get a key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>. Uses Claude 3 Haiku (smart & fast).',
    gemini:    'Free tier available at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a>. No credit card required. Uses Gemini 1.5 Flash.',
  };

  hint.innerHTML = hints[provider] || '';
}

/* ============================
   SIDEBAR COLLAPSE / EXPAND
   ============================ */
function collapseSidebar() {
  document.getElementById('sidebar').classList.add('collapsed');
  document.getElementById('sidebarOpenBtn').classList.add('visible');
}

function expandSidebar() {
  document.getElementById('sidebar').classList.remove('collapsed');
  document.getElementById('sidebarOpenBtn').classList.remove('visible');
}

function toggleSidebarMobile() {
  document.getElementById('sidebar').classList.toggle('mobile-hidden');
}

/* ============================
   STORAGE HELPERS
   ============================ */
function save() {
  localStorage.setItem('orion_convs', JSON.stringify(conversations));
}

function getConv(id) {
  return conversations.find(c => c.id === id) || null;
}

function getActive() {
  return getConv(activeId);
}

function newConvId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createConv(firstMsg) {
  const id    = newConvId();
  const title = firstMsg.slice(0, 46) + (firstMsg.length > 46 ? '…' : '');
  const conv  = { id, title, messages: [], createdAt: Date.now() };
  conversations.unshift(conv);
  save();
  return conv;
}

/* ============================
   WELCOME SCREEN
   ============================ */
function showWelcome() {
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('messages').innerHTML = '';
  activeId = null;
}

function hideWelcome() {
  document.getElementById('welcomeScreen').style.display = 'none';
}

/* ============================
   SIDEBAR RENDER
   ============================ */
function renderSidebar(filterQ = '') {
  const list     = document.getElementById('convList');
  let   filtered = conversations;

  if (filterQ.trim()) {
    const q = filterQ.toLowerCase();
    filtered = conversations.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some(m => m.text.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = filterQ
      ? `<div class="conv-empty"><div class="conv-empty-icon">🔍</div>No results found</div>`
      : `<div class="conv-empty"><div class="conv-empty-icon">💬</div>No conversations yet.<br>Start a new chat!</div>`;
    return;
  }

  const now = Date.now();
  const DAY = 86400000;
  const groups = { today: [], yesterday: [], week: [], older: [] };

  filtered.forEach(c => {
    const diff = now - c.createdAt;
    if      (diff < DAY)       groups.today.push(c);
    else if (diff < 2 * DAY)   groups.yesterday.push(c);
    else if (diff < 7 * DAY)   groups.week.push(c);
    else                       groups.older.push(c);
  });

  const labels = { today: 'Today', yesterday: 'Yesterday', week: 'Previous 7 days', older: 'Older' };
  let html = '';

  Object.keys(groups).forEach(key => {
    if (groups[key].length === 0) return;
    html += `<div class="conv-group-label">${labels[key]}</div>`;
    groups[key].forEach(c => {
      const isActive = c.id === activeId;
      html += `
        <div class="conv-item ${isActive ? 'active' : ''}"
             data-id="${c.id}"
             onclick="loadConv('${c.id}')"
             ondblclick="openRename('${c.id}')">
          <div class="conv-item-text">${escHtml(c.title)}</div>
          <div class="conv-item-actions">
            <button class="conv-action-btn" title="Rename"
                    onclick="event.stopPropagation();openRename('${c.id}')">✏️</button>
            <button class="conv-action-btn delete-btn" title="Delete"
                    onclick="event.stopPropagation();deleteConv('${c.id}')">🗑</button>
          </div>
        </div>`;
    });
  });

  list.innerHTML = html;
}

function searchConversations(q) {
  renderSidebar(q);
}

/* ============================
   LOAD / SWITCH CONVERSATION
   ============================ */
async function loadConv(id) {
  if (isTyping && id !== activeId) return;

  const conv = getConv(id);
  if (!conv) return;

  activeId = id;
  hideWelcome();
  renderSidebar();

  // In backend mode, fetch messages lazily on first open
  if (isBackendMode && conv._fromApi && conv.messages.length === 0) {
    renderMessages([]);
    setSyncDot('syncing');
    try {
      conv.messages = await fetchMessages(id);
      setSyncDot('synced');
    } catch (err) {
      console.warn('Failed to load messages:', err.message);
      setSyncDot('error');
    }
  }

  renderMessages(conv.messages);

  if (window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.add('mobile-hidden');
  }
}

function renderMessages(msgs) {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  msgs.forEach(m => appendMsgDOM(m));
  scrollBottom(true);
}

/* ============================
   START NEW CHAT
   ============================ */
function startNewChat() {
  if (isTyping) return;
  activeId = null;
  showWelcome();
  renderSidebar();
  document.getElementById('msgInput').focus();
}

/* ============================
   SEND MESSAGE
   ============================ */
async function sendMessage() {
  const inp  = document.getElementById('msgInput');
  const text = inp.value.trim();
  if ((!text && attachedFiles.length === 0) || isTyping) return;

  // Check API key — show banner instead of blocking entirely
  if (!getApiKey()) {
    showNoKeyBanner();
    return;
  }

  // Build file context to send to AI (text/PDF content prepended)
  const fileCtx  = buildFileContext();
  const apiText  = fileCtx
    ? (fileCtx + (text ? '\n\n' + text : ''))
    : text;

  // Snapshot attachments for this message (cleared after)
  const snapFiles = attachedFiles.map(f => ({
    name:   f.name,
    type:   f.type,
    dataUrl: f.type === 'image' ? f.dataUrl : null,
  }));

  inp.value = '';
  autoResize(inp);
  attachedFiles = [];
  renderFileChips();

  if (!activeId) {
    const title = text || (snapFiles.length ? snapFiles.map(f => f.name).join(', ') : 'New Chat');
    let conv;
    if (isBackendMode) {
      try {
        conv = await createConvBackend(title);
      } catch (_e) {
        conv = createConv(title);
      }
    } else {
      conv = createConv(title);
    }
    activeId = conv.id;
    hideWelcome();
    renderSidebar();
  }

  const conv = getActive();
  if (!conv) return;

  const userMsg = {
    role:        'user',
    text,               // displayed in bubble
    apiText,            // sent to AI (includes file content)
    attachments: snapFiles,
    ts:          Date.now(),
  };
  conv.messages.push(userMsg);
  if (!isBackendMode) save();
  _pendingUserMsg = userMsg;

  appendMsgDOM(userMsg);
  scrollBottom(true);

  // ── Web search: augment apiText with live results before AI call ──
  _currentSearchResults = null;
  if (detectSearchIntent(text) && getSearchKey()) {
    const searchQuery = stripSearchPrefix(text) || text;
    const indicator   = showSearchIndicator();
    const results     = await performSearch(searchQuery);
    indicator.remove();
    if (results && results.length > 0) {
      _currentSearchResults = results;
      userMsg.apiText = (userMsg.apiText || '') + buildSearchContext(results);
    }
    // Disable toggle after single use
    if (searchModeActive) toggleSearchMode();
    await beginAIResponse(conv.id);
  } else {
    setTimeout(() => beginAIResponse(conv.id), 200);
  }
}

function sendPrompt(btn) {
  if (isTyping) return;
  document.getElementById('msgInput').value = btn.querySelector('.prompt-text').textContent;
  sendMessage();
}

function showNoKeyBanner() {
  // Remove any existing banner
  document.querySelectorAll('.no-key-banner').forEach(el => el.remove());

  const banner = document.createElement('div');
  banner.className = 'no-key-banner';
  banner.innerHTML = `
    <span class="no-key-banner-icon">🔑</span>
    <span>No API key set. <strong>Click here to add your key</strong> and start chatting with real AI. (Free options available!)</span>`;
  banner.onclick = openSettings;

  const inputArea = document.getElementById('inputArea');
  inputArea.parentNode.insertBefore(banner, inputArea);
}

/* ============================
   AUTO-RESIZE TEXTAREA
   ============================ */
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

/* ============================
   KEYBOARD HANDLER
   ============================ */
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

/* ============================
   AI RESPONSE — REAL API
   ============================ */
async function beginAIResponse(convId) {
  isTyping  = true;
  stopFlag  = false;
  abortCtrl = new AbortController();

  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';

  const thinkRow = createThinkRow();
  document.getElementById('messages').appendChild(thinkRow);
  scrollBottom(true);

  try {
    const conv     = getConv(convId);
    const provider = getProvider();
    const apiKey   = getApiKey();

    thinkRow.remove();
    if (stopFlag) { finishTyping(); return; }

    // Build the streaming AI row
    const { row, contentEl, actionsEl } = createAIRow();
    document.getElementById('messages').appendChild(row);
    scrollBottom(true);

    let fullText = '';

    if (provider === 'groq') {
      fullText = await streamGroq(conv.messages, apiKey, contentEl);
    } else if (provider === 'openai') {
      fullText = await streamOpenAI(conv.messages, apiKey, contentEl);
    } else if (provider === 'anthropic') {
      fullText = await streamAnthropic(conv.messages, apiKey, contentEl);
    } else if (provider === 'gemini') {
      fullText = await streamGemini(conv.messages, apiKey, contentEl);
    }

    // Final render
    const liveCursor = contentEl.querySelector('.typing-cursor');
    if (liveCursor) liveCursor.remove();
    contentEl.innerHTML = parseMarkdown(fullText);
    addCodeCopyButtons(contentEl);

    // Save AI message
    const targetConv = getConv(convId);
    if (targetConv && fullText.trim()) {
      const aiMsg = { role: 'ai', text: fullText, ts: Date.now() };
      targetConv.messages.push(aiMsg);
      if (!isBackendMode) save();

      // Save user + AI messages to backend
      if (isBackendMode && _pendingUserMsg) {
        setSyncDot('syncing');
        saveMessagesToAPI(convId, [_pendingUserMsg, aiMsg])
          .then(() => setSyncDot('synced'))
          .catch(() => setSyncDot('error'));
        _pendingUserMsg = null;
      }
    }

    actionsEl.style.display = 'flex';
    const copyBtn = document.createElement('button');
    copyBtn.className   = 'msg-action-btn';
    copyBtn.textContent = '📋 Copy';
    copyBtn.onclick     = () => copyMsgText(copyBtn, fullText);
    actionsEl.appendChild(copyBtn);

    // Render web search sources card if this response used search
    if (_currentSearchResults && _currentSearchResults.length > 0) {
      renderSourcesCard(_currentSearchResults);
      _currentSearchResults = null;
    }

  } catch (err) {
    thinkRow.remove();
    if (err.name !== 'AbortError' && !stopFlag) {
      showApiError(err.message);
    }
  } finally {
    finishTyping();
  }
}

/* ── OpenAI Streaming ── */
async function streamOpenAI(messages, apiKey, contentEl) {
  const history = buildHistory(messages, 'openai');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal: abortCtrl.signal,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:    'gpt-4o-mini',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      stream:   true,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI error ${res.status}`);
  }

  return readStream(res.body, contentEl, chunk => {
    try {
      const data = JSON.parse(chunk.replace(/^data: /, ''));
      return data.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
  });
}

/* ── Groq Streaming (free, OpenAI-compatible) ── */
async function streamGroq(messages, apiKey, contentEl) {
  const history = buildHistory(messages, 'openai'); // same format as OpenAI

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: abortCtrl.signal,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:    'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      stream:   true,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq error ${res.status}`);
  }

  return readStream(res.body, contentEl, chunk => {
    try {
      const data = JSON.parse(chunk.replace(/^data: /, ''));
      return data.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
  });
}

/* ── Anthropic Streaming ── */
async function streamAnthropic(messages, apiKey, contentEl) {
  const history = buildHistory(messages, 'anthropic');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: abortCtrl.signal,
    headers: {
      'x-api-key':                               apiKey,
      'anthropic-version':                       '2023-06-01',
      'content-type':                            'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      stream:     true,
      messages:   history,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic error ${res.status}`);
  }

  return readStream(res.body, contentEl, chunk => {
    try {
      const data = JSON.parse(chunk.replace(/^data: /, ''));
      if (data.type === 'content_block_delta') return data.delta?.text || '';
    } catch {}
    return '';
  });
}

/* ── Gemini (non-streaming, most compatible) ── */
async function streamGemini(messages, apiKey, contentEl) {
  const history = buildHistory(messages, 'gemini');

  // Try models in order until one works
  const models = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];

  let lastError = '';
  for (const model of models) {
    if (stopFlag) break;

    contentEl.innerHTML = `<span style="color:var(--text3);font-size:0.82em">Connecting to ${model}…</span>`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: history,
          generationConfig: { maxOutputTokens: 4096 },
        }),
      }
    );

    if (res.status === 404) { lastError = `Model ${model} not found`; continue; }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      lastError = err.error?.message || `Gemini error ${res.status}`;
      if (res.status === 429) break; // rate limit — no point trying more models
      continue;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) { lastError = 'Empty response from Gemini'; continue; }

    // Simulate streaming by revealing text gradually
    contentEl.innerHTML = '';
    let displayed = '';
    for (let i = 0; i < text.length; i += 3) {
      if (stopFlag) break;
      displayed = text.slice(0, i + 3);
      contentEl.innerHTML = parseMarkdown(displayed) + '<span class="typing-cursor"></span>';
      scrollBottom();
      await new Promise(r => setTimeout(r, 12));
    }
    return text;
  }

  throw new Error(lastError || 'All Gemini models failed. Check your API key.');
}

/* ── Generic SSE reader (OpenAI / Anthropic) ── */
async function readStream(body, contentEl, parseChunk) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let full      = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done || stopFlag) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep last incomplete line

    for (const line of lines) {
      if (!line.trim() || line === 'data: [DONE]') continue;
      const token = parseChunk(line);
      if (token) {
        full += token;
        contentEl.innerHTML = parseMarkdown(full) + '<span class="typing-cursor"></span>';
        scrollBottom();
      }
    }
  }

  return full;
}

/* ── Build message history for each provider ── */
function buildHistory(messages, provider) {
  const recent = messages.slice(-20);

  if (provider === 'openai') {
    return recent.map(m => {
      if (m.role === 'ai') return { role: 'assistant', content: m.text };
      const text   = m.apiText || m.text;
      const images = (m.attachments || []).filter(a => a.type === 'image' && a.dataUrl);
      if (!images.length) return { role: 'user', content: text };
      // Vision message
      const parts = [];
      if (text) parts.push({ type: 'text', text });
      images.forEach(a => parts.push({ type: 'image_url', image_url: { url: a.dataUrl, detail: 'auto' } }));
      return { role: 'user', content: parts };
    });
  }

  if (provider === 'groq') {
    // Llama 3.3 doesn't support vision — text context only
    return recent.map(m => ({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.apiText || m.text,
    }));
  }

  if (provider === 'anthropic') {
    return recent.map(m => {
      if (m.role === 'ai') return { role: 'assistant', content: m.text };
      const text   = m.apiText || m.text;
      const images = (m.attachments || []).filter(a => a.type === 'image' && a.dataUrl);
      if (!images.length) return { role: 'user', content: text };
      // Vision message
      const parts = [];
      images.forEach(a => {
        const [hdr, b64] = a.dataUrl.split(',');
        const mt = (hdr.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        parts.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
      });
      if (text) parts.push({ type: 'text', text });
      return { role: 'user', content: parts };
    });
  }

  if (provider === 'gemini') {
    return recent.map(m => {
      if (m.role === 'ai') return { role: 'model', parts: [{ text: m.text }] };
      const text   = m.apiText || m.text;
      const images = (m.attachments || []).filter(a => a.type === 'image' && a.dataUrl);
      if (!images.length) return { role: 'user', parts: [{ text: text || '' }] };
      const parts = [];
      if (text) parts.push({ text });
      images.forEach(a => {
        const [hdr, b64] = a.dataUrl.split(',');
        const mt = (hdr.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        parts.push({ inlineData: { mimeType: mt, data: b64 } });
      });
      return { role: 'user', parts };
    });
  }

  return [];
}

/* ============================
   CREATE AI ROW (live streaming)
   ============================ */
function createAIRow() {
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.innerHTML = `
    <div class="ai-card">
      <div class="ai-header">
        <div class="ai-avatar">O</div>
        <div class="ai-name">Orion</div>
      </div>
      <div class="ai-content"></div>
      <div class="msg-actions" style="display:none"></div>
    </div>`;

  const contentEl = row.querySelector('.ai-content');
  const actionsEl = row.querySelector('.msg-actions');
  return { row, contentEl, actionsEl };
}

function createThinkRow() {
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.innerHTML = `
    <div class="ai-card">
      <div class="ai-header">
        <div class="ai-avatar">O</div>
        <div class="ai-name">Orion</div>
      </div>
      <div class="thinking-wrap">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <div class="thinking-label">Thinking…</div>
      </div>
    </div>`;
  return row;
}

function showApiError(msg) {
  const container = document.getElementById('messages');
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.innerHTML = `
    <div class="ai-card">
      <div class="ai-header">
        <div class="ai-avatar" style="background:linear-gradient(135deg,#ef4444,#dc2626)">!</div>
        <div class="ai-name" style="color:#ef4444">Error</div>
      </div>
      <div class="ai-content" style="color:#ef4444">
        ${escHtml(msg)}<br><br>
        <span style="color:var(--text2);font-size:0.85em">
          Check your API key in Settings, or try a different provider.
        </span>
      </div>
    </div>`;
  container.appendChild(row);
  scrollBottom(true);

  // Mark dot as error
  const dot = document.getElementById('apiStatusDot');
  if (dot) { dot.classList.remove('connected'); dot.classList.add('error'); }
}

function finishTyping() {
  isTyping  = false;
  stopFlag  = false;
  abortCtrl = null;
  document.getElementById('sendBtn').style.display = 'flex';
  document.getElementById('stopBtn').style.display = 'none';
}

/* ============================
   STOP GENERATION
   ============================ */
function stopGeneration() {
  stopFlag = true;
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  finishTyping();
}

/* ============================
   APPEND MSG TO DOM (history)
   ============================ */
function appendMsgDOM(msg) {
  const container = document.getElementById('messages');
  const row       = document.createElement('div');
  row.className   = `msg-row ${msg.role}`;
  const timeStr   = formatTime(msg.ts);

  if (msg.role === 'user') {
    // Build attachment chips
    let attachHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      const chips = msg.attachments.map(a => {
        if (a.type === 'image' && a.dataUrl) {
          return `<div class="msg-attach-chip image"><img class="msg-attach-thumb" src="${a.dataUrl}" alt="${escHtml(a.name)}"/><span class="msg-attach-name">${escHtml(a.name)}</span></div>`;
        }
        const icon = a.type === 'pdf' ? '📄' : getFileIcon(a.name);
        return `<div class="msg-attach-chip"><span class="msg-attach-icon">${icon}</span><span class="msg-attach-name">${escHtml(a.name)}</span></div>`;
      }).join('');
      attachHtml = `<div class="msg-attachments">${chips}</div>`;
    }
    const displayText = msg.text || '';
    row.innerHTML = `
      ${attachHtml}
      ${displayText ? `<div class="user-bubble">${escHtml(displayText)}</div>` : ''}
      <div class="msg-meta">${timeStr}</div>`;
  } else {
    row.innerHTML = `
      <div class="ai-card">
        <div class="ai-header">
          <div class="ai-avatar">O</div>
          <div class="ai-name">Orion</div>
        </div>
        <div class="ai-content">${parseMarkdown(msg.text)}</div>
        <div class="msg-actions">
          <button class="msg-action-btn">📋 Copy</button>
        </div>
      </div>`;
    const btn = row.querySelector('.msg-action-btn');
    btn.onclick = () => copyMsgText(btn, msg.text);
    addCodeCopyButtons(row.querySelector('.ai-content'));
  }

  container.appendChild(row);
}

/* ============================
   COPY HELPERS
   ============================ */
function copyMsgText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '📋 Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

function addCodeCopyButtons(el) {
  el.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.closest('.code-block').querySelector('code').textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '✅ Copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });
}

/* ============================
   MARKDOWN PARSER
   ============================ */
function parseMarkdown(md) {
  const codeBlocks = [];
  md = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i        = codeBlocks.length;
    const safeLang = escHtml(lang || 'code');
    const safeCode = escHtml(code.trimEnd());
    codeBlocks.push(`<div class="code-block"><div class="code-header"><span class="code-lang">${safeLang}</span><button class="code-copy-btn">📋 Copy</button></div><pre><code>${safeCode}</code></pre></div>`);
    return `\x00CODE${i}\x00`;
  });

  md = md.replace(/`([^`\n]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`);
  md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  md = md.replace(/^#{6}\s(.+)$/gm, '<h6>$1</h6>');
  md = md.replace(/^#{5}\s(.+)$/gm, '<h5>$1</h5>');
  md = md.replace(/^#{4}\s(.+)$/gm, '<h4>$1</h4>');
  md = md.replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>');
  md = md.replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>');
  md = md.replace(/^#\s(.+)$/gm,    '<h1>$1</h1>');
  md = md.replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>');

  md = md.replace(/\|(.+)\|\r?\n\|[-:| ]+\|\r?\n((?:\|.+\|\r?\n?)+)/g, (_, headerRow, bodyRows) => {
    const headers = headerRow.split('|').slice(1, -1).map(h => `<th>${h.trim()}</th>`).join('');
    const rows    = bodyRows.trim().split('\n').map(row => {
      const cells = row.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table class="md-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  md = md.replace(/^[-*+]\s(.+)$/gm, '<__LI__>$1</__LI__>');
  md = md.replace(/(<__LI__>[\s\S]*?<\/__LI__>\n?)+/g, match =>
    `<ul>${match.replace(/<__LI__>/g, '<li>').replace(/<\/__LI__>/g, '</li>')}</ul>`);

  md = md.replace(/^\d+\.\s(.+)$/gm, '<__OLI__>$1</__OLI__>');
  md = md.replace(/(<__OLI__>[\s\S]*?<\/__OLI__>\n?)+/g, match =>
    `<ol>${match.replace(/<__OLI__>/g, '<li>').replace(/<\/__OLI__>/g, '</li>')}</ol>`);

  md = md.replace(/^---$/gm, '<hr>');

  const lines = md.split('\n');
  const out   = [];
  let para    = '';

  const isBlockTag = l =>
    l.startsWith('\x00CODE') ||
    /^<(h[1-6]|ul|ol|li|hr|blockquote|table|thead|tbody|tr|th|td)/.test(l);

  for (const line of lines) {
    if (isBlockTag(line)) {
      if (para.trim()) { out.push(`<p>${para.trim()}</p>`); para = ''; }
      out.push(line);
    } else if (line.trim() === '') {
      if (para.trim()) { out.push(`<p>${para.trim()}</p>`); para = ''; }
    } else {
      para += (para ? ' ' : '') + line;
    }
  }
  if (para.trim()) out.push(`<p>${para.trim()}</p>`);

  let result = out.join('\n');
  codeBlocks.forEach((block, i) => {
    result = result.replace(`\x00CODE${i}\x00`, block);
  });

  return result;
}

/* ============================
   DELETE CONVERSATION
   ============================ */
async function deleteConv(id) {
  if (isBackendMode) {
    try { await deleteConvBackend(id); } catch (err) { console.warn('Delete failed:', err.message); }
  }
  conversations = conversations.filter(c => c.id !== id);
  if (!isBackendMode) save();
  if (activeId === id) {
    activeId = null;
    showWelcome();
  }
  renderSidebar();
}

/* ============================
   RENAME
   ============================ */
function openRename(id) {
  renamingId    = id;
  const conv    = getConv(id);
  if (!conv) return;
  const overlay = document.getElementById('renameOverlay');
  const input   = document.getElementById('renameInput');
  input.value   = conv.title;
  overlay.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 80);
}

function closeRename() {
  document.getElementById('renameOverlay').classList.remove('open');
  renamingId = null;
}

async function confirmRename() {
  if (!renamingId) return;
  const val  = document.getElementById('renameInput').value.trim();
  if (!val) return;
  const conv = getConv(renamingId);
  if (conv) {
    if (isBackendMode) {
      try { await renameConvBackend(renamingId, val); } catch (err) { console.warn('Rename failed:', err.message); }
    }
    conv.title = val;
    if (!isBackendMode) save();
    renderSidebar();
  }
  closeRename();
}

/* ============================
   UTILITIES
   ============================ */
function scrollBottom(force = false) {
  const ca = document.getElementById('chatArea');
  if (!force) {
    const distFromBottom = ca.scrollHeight - ca.scrollTop - ca.clientHeight;
    if (distFromBottom > 140) return;
  }
  requestAnimationFrame(() => { ca.scrollTop = ca.scrollHeight; });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================
   FILE UPLOAD
   ============================ */
function initFileUpload() {
  // Configure PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const chatArea = document.getElementById('chatArea');
  let dragCounter = 0;

  chatArea.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    document.getElementById('dragOverlay').classList.add('active');
  });

  chatArea.addEventListener('dragover', e => { e.preventDefault(); });

  chatArea.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.getElementById('dragOverlay').classList.remove('active');
    }
  });

  chatArea.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    document.getElementById('dragOverlay').classList.remove('active');
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  });
}

function handleFileInputChange(input) {
  if (input.files.length > 0) handleFiles(input.files);
  input.value = '';
}

async function handleFiles(fileList) {
  const MAX = 5;
  for (const file of Array.from(fileList)) {
    if (attachedFiles.length >= MAX) {
      showToast(`Max ${MAX} files per message.`);
      break;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} is too large (max 10 MB).`);
      continue;
    }
    try {
      const processed = await processFile(file);
      attachedFiles.push(processed);
    } catch (err) {
      showToast(`Could not read ${file.name}.`);
    }
  }
  renderFileChips();
  document.getElementById('msgInput').focus();
}

async function processFile(file) {
  if (file.type.startsWith('image/')) {
    const dataUrl = await readAsDataUrl(file);
    return { name: file.name, type: 'image', dataUrl, content: null };
  }
  if (file.type === 'application/pdf') {
    const content = await extractPdfText(file);
    return { name: file.name, type: 'pdf', dataUrl: null, content };
  }
  // Text / code
  const content = await readAsText(file);
  return { name: file.name, type: 'text', dataUrl: null, content };
}

function readAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsText(file);
  });
}

function readAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsDataURL(file);
  });
}

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js not loaded — refresh and try again.');
  }
  const buf  = await file.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
  let   text = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += `\n--- Page ${i} ---\n` + content.items.map(t => t.str).join(' ');
  }
  return text.trim();
}

function renderFileChips() {
  const strip = document.getElementById('filePreviewStrip');
  if (!strip) return;

  if (attachedFiles.length === 0) {
    strip.innerHTML     = '';
    strip.style.display = 'none';
    return;
  }

  strip.style.display = 'flex';
  strip.innerHTML = attachedFiles.map((f, i) => {
    if (f.type === 'image') {
      return `<div class="file-chip image">
        <img class="file-chip-thumb" src="${f.dataUrl}" alt="${escHtml(f.name)}"/>
        <span class="file-chip-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        <button class="file-chip-remove" onclick="removeFile(${i})" title="Remove">✕</button>
      </div>`;
    }
    const icon = f.type === 'pdf' ? '📄' : getFileIcon(f.name);
    return `<div class="file-chip">
      <span class="file-chip-icon">${icon}</span>
      <span class="file-chip-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <button class="file-chip-remove" onclick="removeFile(${i})" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function removeFile(index) {
  attachedFiles.splice(index, 1);
  renderFileChips();
}

function getFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({
    js: '🟨', ts: '🔷', jsx: '⚛️', tsx: '⚛️', py: '🐍',
    html: '🌐', css: '🎨', json: '📋', md: '📝', txt: '📄',
    sh: '⚙️', sql: '🗄️', csv: '📊', yaml: '⚙️', yml: '⚙️', env: '🔒',
  })[ext] || '📄';
}

function buildFileContext() {
  if (attachedFiles.length === 0) return '';
  return attachedFiles.map(f => {
    if (f.type === 'image') return `[Image attached: ${f.name}]`;
    if (!f.content)         return '';
    const preview = f.content.length > 8000
      ? f.content.slice(0, 8000) + '\n...[truncated]'
      : f.content;
    return `[File: ${f.name}]\n\`\`\`\n${preview}\n\`\`\``;
  }).filter(Boolean).join('\n\n');
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:var(--surface); border:1px solid var(--border2);
    padding:8px 18px; border-radius:8px; font-size:0.82rem; color:var(--text2);
    z-index:300; pointer-events:none; white-space:nowrap;
    animation:fadeUp 0.25s ease;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

/* ============================
   BACKEND CONFIG & AUTH STATE
   ============================ */
const API_BASE    = 'http://localhost:3001/api';
let   isBackendMode = false;   // true when user is logged in with a JWT

/* ── Token / user helpers ── */
function getToken()        { return localStorage.getItem('orion_access_token') || ''; }
function getRefreshToken() { return localStorage.getItem('orion_refresh_token') || ''; }
function getUser() {
  try { return JSON.parse(localStorage.getItem('orion_user') || 'null'); }
  catch { return null; }
}
function setAuth(data) {
  localStorage.setItem('orion_access_token',  data.accessToken);
  localStorage.setItem('orion_refresh_token', data.refreshToken);
  localStorage.setItem('orion_user',          JSON.stringify(data.user));
}
function clearAuth() {
  localStorage.removeItem('orion_access_token');
  localStorage.removeItem('orion_refresh_token');
  localStorage.removeItem('orion_user');
}

/* ── Authenticated API call with auto-refresh on 401 ── */
async function apiCall(method, path, body) {
  const makeReq = token => fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res = await makeReq(getToken());

  if (res.status === 401) {
    const errBody = await res.clone().json().catch(() => ({}));
    if (errBody.code === 'TOKEN_EXPIRED' && getRefreshToken()) {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: getRefreshToken() }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setAuth(data);
        res = await makeReq(data.accessToken);
      } else {
        clearAuth();
        isBackendMode = false;
        updateUserUI();
        throw new Error('Session expired. Please sign in again.');
      }
    }
  }

  return res;
}

/* ============================
   AUTH MODAL
   ============================ */
function showAuthModal(tab = 'login') {
  switchAuthTab(tab);
  document.getElementById('authError').textContent = '';
  document.getElementById('authOverlay').classList.add('open');
  setTimeout(() => {
    const first = tab === 'login'
      ? document.getElementById('loginEmail')
      : document.getElementById('signupName');
    if (first) first.focus();
  }, 80);
}

function hideAuthModal() {
  document.getElementById('authOverlay').classList.remove('open');
  document.getElementById('authError').textContent = '';
}

function switchAuthTab(tab) {
  document.getElementById('loginTab').classList.toggle('active',  tab === 'login');
  document.getElementById('signupTab').classList.toggle('active', tab === 'signup');
  document.getElementById('loginForm').style.display  = tab === 'login'  ? '' : 'none';
  document.getElementById('signupForm').style.display = tab === 'signup' ? '' : 'none';
  document.getElementById('authError').textContent = '';
}

async function submitLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('authError');
  const btn      = document.getElementById('loginSubmit');

  if (!email || !password) { errEl.textContent = 'Please fill in all fields.'; return; }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';
  errEl.textContent = '';

  try {
    const res  = await fetch(`${API_BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Login failed.'; return; }

    setAuth(data);
    isBackendMode = true;
    updateUserUI();
    hideAuthModal();
    checkAdminLink();
    await loadConversationsFromAPI();
  } catch (_err) {
    errEl.textContent = 'Could not reach server. Is the backend running on port 3001?';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

async function submitSignup() {
  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errEl    = document.getElementById('authError');
  const btn      = document.getElementById('signupSubmit');

  if (!name || !email || !password) { errEl.textContent = 'Please fill in all fields.'; return; }
  if (password.length < 6)          { errEl.textContent = 'Password must be at least 6 characters.'; return; }

  btn.disabled    = true;
  btn.textContent = 'Creating account…';
  errEl.textContent = '';

  try {
    const res  = await fetch(`${API_BASE}/auth/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Signup failed.'; return; }

    setAuth(data);
    isBackendMode = true;
    updateUserUI();
    hideAuthModal();
    checkAdminLink();
    await loadConversationsFromAPI();
  } catch (_err) {
    errEl.textContent = 'Could not reach server. Is the backend running on port 3001?';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Create Account';
  }
}

/* ── Check admin status and show/hide admin nav link ── */
function checkAdminLink() {
  const link = document.getElementById('adminNavLink');
  if (!link) return;
  apiCall('GET', '/admin/check')
    .then(async r => {
      if (!r.ok) return;
      const d = await r.json();
      link.style.display = d.isAdmin ? 'flex' : 'none';
    })
    .catch(() => {}); // Silently skip if backend is down
}

function handleLogout() {
  clearAuth();
  isBackendMode = false;
  updateUserUI();
  setSyncDot('');
  // Hide admin link
  const adminLink = document.getElementById('adminNavLink');
  if (adminLink) adminLink.style.display = 'none';
  // Reload from localStorage (guest mode)
  conversations = JSON.parse(localStorage.getItem('orion_convs') || '[]');
  renderSidebar();
  if (activeId && !getConv(activeId)) {
    activeId = null;
    showWelcome();
  }
}

/* ============================
   USER UI
   ============================ */
function updateUserUI() {
  const user        = getUser();
  const userInfo    = document.getElementById('userInfo');
  const loginPrompt = document.getElementById('loginPromptBtn');
  const logoutBtn   = document.getElementById('logoutBtn');

  if (user && isBackendMode) {
    if (userInfo)    { userInfo.style.display    = 'flex'; }
    if (loginPrompt) { loginPrompt.style.display = 'none'; }
    if (logoutBtn)   { logoutBtn.style.display   = 'flex'; }
    const avatar = document.getElementById('userAvatar');
    const name   = document.getElementById('userName');
    const email  = document.getElementById('userEmailDisplay');
    if (avatar) avatar.textContent = (user.name || user.email || '?')[0].toUpperCase();
    if (name)   name.textContent   = user.name  || 'User';
    if (email)  email.textContent  = user.email || '';
  } else {
    if (userInfo)    { userInfo.style.display    = 'none'; }
    if (loginPrompt) { loginPrompt.style.display = 'flex'; }
    if (logoutBtn)   { logoutBtn.style.display   = 'none'; }
  }
}

function setSyncDot(state) {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  dot.classList.remove('synced', 'syncing', 'error');
  if (state) dot.classList.add(state);
}

/* ============================
   LOAD CONVERSATIONS FROM API
   ============================ */
async function loadConversationsFromAPI() {
  setSyncDot('syncing');
  try {
    const res = await apiCall('GET', '/conversations');
    if (!res.ok) throw new Error('Failed to load conversations');
    const data = await res.json();
    conversations = data.conversations.map(c => ({
      id:        c.id,
      title:     c.title,
      messages:  [],           // loaded lazily when opened
      createdAt: new Date(c.createdAt).getTime(),
      _fromApi:  true,
    }));
    renderSidebar();
    setSyncDot('synced');
    // If no active chat, show welcome
    if (!activeId) showWelcome();
  } catch (err) {
    console.warn('loadConversationsFromAPI failed:', err.message);
    setSyncDot('error');
  }
}

/* ============================
   BACKEND CONVERSATION CRUD
   ============================ */
async function createConvBackend(title) {
  const res = await apiCall('POST', '/conversations', { title });
  if (!res.ok) throw new Error('Failed to create conversation on backend');
  const data = await res.json();
  const conv = {
    id:        data.conversation.id,
    title:     data.conversation.title,
    messages:  [],
    createdAt: new Date(data.conversation.createdAt).getTime(),
    _fromApi:  true,
  };
  conversations.unshift(conv);
  return conv;
}

async function deleteConvBackend(id) {
  const res = await apiCall('DELETE', `/conversations/${id}`);
  if (!res.ok) throw new Error('Delete failed');
}

async function renameConvBackend(id, title) {
  const res = await apiCall('PATCH', `/conversations/${id}`, { title });
  if (!res.ok) throw new Error('Rename failed');
}

async function fetchMessages(convId) {
  const res = await apiCall('GET', `/conversations/${convId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  const data = await res.json();
  return data.messages.map(m => ({
    role:        m.role,
    text:        m.text,
    apiText:     m.apiText || null,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    ts:          new Date(m.createdAt).getTime(),
  }));
}

async function saveMessagesToAPI(convId, messages) {
  const res = await apiCall('POST', `/conversations/${convId}/messages`, { messages });
  if (!res.ok) console.warn('saveMessagesToAPI: non-OK response');
}

/* ============================================================
   WEB SEARCH — Tavily integration
   ============================================================ */

/* ── Config helpers ── */
function getSearchKey() { return localStorage.getItem('orion_search_key') || ''; }

function toggleSearchKeyVisibility() {
  const inp = document.getElementById('searchKeyInput');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

/* ── Toggle search mode (globe button) ── */
function toggleSearchMode() {
  searchModeActive = !searchModeActive;
  const btn = document.getElementById('searchToggleBtn');
  const inp = document.getElementById('msgInput');
  if (btn) btn.classList.toggle('search-active', searchModeActive);
  if (inp) inp.placeholder = searchModeActive
    ? '🌐 Web search ON — ask anything…'
    : 'Message Orion…';
}

/* ── Detect search intent from message text ── */
function detectSearchIntent(text) {
  if (!getSearchKey()) return false;           // No key = no search
  if (searchModeActive) return true;
  const t = text.toLowerCase();
  return (
    t.startsWith('/search ') ||
    /^search (for |up |about )?/i.test(text) ||
    /^look up /i.test(text) ||
    /\b(latest|breaking|current|today's|right now)\b.{0,40}\b(news|update|price|score|result|weather)\b/i.test(text) ||
    /who (is|are|won|leads?) (the )?(current|new|latest)/i.test(text)
  );
}

/* ── Strip search command prefix from text ── */
function stripSearchPrefix(text) {
  return text
    .replace(/^\/search\s+/i, '')
    .replace(/^search (for |up |about )?/i, '')
    .replace(/^look up /i, '')
    .trim();
}

/* ── Call Tavily API ── */
async function performSearch(query) {
  const key = getSearchKey();
  if (!key) return null;
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results:  5,
        include_answer:      false,
        include_raw_content: false,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.results || []).map((item, i) => ({
      num:     i + 1,
      title:   item.title   || 'Untitled',
      url:     item.url     || '#',
      snippet: item.content || '',
    }));
  } catch { return null; }
}

/* ── Format search results as AI context ── */
function buildSearchContext(results) {
  const today   = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const sources = results.map(r =>
    `[${r.num}] ${r.title}\nURL: ${r.url}\n${r.snippet ? r.snippet.slice(0, 400) : ''}`
  ).join('\n\n');
  return (
    `\n\n---\n[WEB SEARCH RESULTS — ${today}]\n\n${sources}` +
    `\n\n---\nUsing the above web search results, answer the user's question. ` +
    `Cite sources inline with [1], [2], etc. after relevant claims. Be factual and current.`
  );
}

/* ── Show "Searching…" indicator in chat ── */
function showSearchIndicator() {
  const container = document.getElementById('messages');
  const el = document.createElement('div');
  el.className = 'search-indicator';
  el.innerHTML = `<span class="search-indicator-dot"></span>Searching the web…`;
  container.appendChild(el);
  scrollBottom(true);
  return el;
}

/* ── Render sources card below AI response ── */
function renderSourcesCard(results) {
  if (!results || results.length === 0) return;
  const container = document.getElementById('messages');
  const card = document.createElement('div');
  card.className = 'sources-card';

  const items = results.map(r => {
    let host = r.url;
    try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return `
      <a class="source-item" href="${escHtml(r.url)}" target="_blank" rel="noopener noreferrer">
        <span class="source-num">[${r.num}]</span>
        <div class="source-info">
          <div class="source-title">${escHtml(r.title)}</div>
          <div class="source-url">${escHtml(host)}</div>
        </div>
        <span class="source-arrow">↗</span>
      </a>`;
  }).join('');

  card.innerHTML = `
    <div class="sources-header">
      <span class="sources-icon">🌐</span>
      <span>Sources</span>
      <span class="sources-count">${results.length}</span>
    </div>
    <div class="sources-list">${items}</div>`;

  container.appendChild(card);
  scrollBottom(true);
}
