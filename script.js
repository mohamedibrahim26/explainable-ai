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
  // Implemented at bottom of file (settings panel)
  _openSettingsPanel();
}

function closeSettings() {
  // Implemented at bottom of file (settings panel)
  _closeSettingsPanel();
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
    ollama:    '🧠 <strong>Runs 100% locally — no API key needed.</strong> Orion-XAI is a fine-tuned Llama 3.2 model specialised in XAI &amp; cybersecurity. Make sure Ollama is running: <code>ollama serve</code>.',
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


/* ============================
   WEB SEARCH (TAVILY)
   ============================ */
function getSearchKey() {
  return localStorage.getItem('orion_search_key') || '';
}

function toggleSearchMode() {
  searchModeActive = !searchModeActive;
  const btn = document.getElementById('searchToggleBtn');
  if (btn) btn.classList.toggle('active', searchModeActive);
}

function detectSearchIntent(text) {
  if (searchModeActive) return true;
  const t = text.toLowerCase();
  const triggers = [
    /^(search|look up|find|google|what is|who is|when did|latest|current|news|today|price of|how much|weather)/,
    /\b(search for|look up|find out|tell me about the latest|what happened|breaking news)\b/,
  ];
  return triggers.some(r => r.test(t));
}

function stripSearchPrefix(text) {
  return text
    .replace(/^(search for|look up|google|find)\s+/i, '')
    .replace(/^(what is the latest|what's the latest)\s+/i, '')
    .trim();
}

async function performSearch(query) {
  const key = getSearchKey();
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:          key,
        query:            query,
        search_depth:     'basic',
        include_answer:   true,
        max_results:      5,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

function buildSearchContext(results) {
  if (!results || !results.length) return '';
  let ctx = '\n\n[WEB SEARCH RESULTS — use these to answer accurately]\n';
  results.slice(0, 4).forEach((r, i) => {
    ctx += `\n[${i + 1}] ${r.title}\n${r.url}\n${r.content?.slice(0, 400) || ''}\n`;
  });
  ctx += '\n[END OF SEARCH RESULTS — cite sources in your response]\n';
  return ctx;
}

function showSearchIndicator() {
  const container = document.getElementById('messages');
  const row = document.createElement('div');
  row.className = 'msg-row ai search-indicator-row';
  row.innerHTML = `
    <div class="ai-card" style="padding:10px 14px">
      <div style="display:flex;align-items:center;gap:8px;color:var(--text3);font-size:0.82rem">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" style="flex-shrink:0;animation:spin 1s linear infinite">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.4" stroke-dasharray="20" stroke-dashoffset="5"/>
        </svg>
        Searching the web…
      </div>
    </div>`;
  container.appendChild(row);
  scrollBottom(true);
  return row;
}

function renderSourcesCard(results) {
  if (!results || !results.length) return;
  const container = document.getElementById('messages');
  const card = document.createElement('div');
  card.className = 'msg-row ai';
  const links = results.slice(0, 4).map((r, i) => `
    <a class="source-link" href="${r.url}" target="_blank" rel="noopener">
      <span class="source-num">${i + 1}</span>
      <span class="source-title">${escHtml((r.title || r.url).slice(0, 55))}</span>
    </a>`).join('');
  card.innerHTML = `
    <div class="ai-card sources-card">
      <div class="sources-header">
        <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M7 1.5C7 1.5 5 4 5 7s2 5.5 2 5.5M7 1.5C7 1.5 9 4 9 7s-2 5.5-2 5.5M1.5 7h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        Sources
      </div>
      <div class="sources-list">${links}</div>
    </div>`;
  container.appendChild(card);
  scrollBottom();
}

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
    let providerUsed = '';
    let modelUsed = '';

    if (isBackendMode) {
      // ── Route through Python AI service (provider-agnostic) ──────────────
      try {
        const result = await streamOrionPython(conv.messages, contentEl);
        fullText     = result.full;
        providerUsed = result.providerUsed;
        modelUsed    = result.modelUsed;
      } catch (pyErr) {
        // Python service unreachable — fall back to direct API
        console.warn('Python AI service unavailable, falling back to direct API:', pyErr.message);
        fullText = await _streamDirect(provider, conv.messages, apiKey, contentEl);
        providerUsed = provider;
      }
    } else {
      // ── Guest mode: direct API calls ──────────────────────────────────────
      fullText = await _streamDirect(provider, conv.messages, apiKey, contentEl);
      providerUsed = provider;
    }

    // Final render
    const liveCursor = contentEl.querySelector('.typing-cursor');
    if (liveCursor) liveCursor.remove();

    // ── Extract XAI metadata before rendering (pure string ops — no regex) ──────
    let xaiData = null;
    const _XAI_O = '[XAI_META]';
    const _XAI_C = '[/XAI_META]';
    const _xaiS  = fullText.indexOf(_XAI_O);
    if (_xaiS !== -1) {
      const _xaiE = fullText.indexOf(_XAI_C, _xaiS);
      if (_xaiE !== -1) {
        const inner  = fullText.slice(_xaiS + _XAI_O.length, _xaiE).trim();
        const jStart = inner.indexOf('{');
        const jEnd   = inner.lastIndexOf('}');
        if (jStart !== -1 && jEnd > jStart) {
          try { xaiData = JSON.parse(inner.slice(jStart, jEnd + 1)); } catch (_) {}
        }
        fullText = (fullText.slice(0, _xaiS) + fullText.slice(_xaiE + _XAI_C.length)).trimEnd();
      } else {
        // No closing tag — strip from opening tag to end of string
        fullText = fullText.slice(0, _xaiS).trimEnd();
      }
    }

    contentEl.innerHTML = parseMarkdown(fullText);
    addCodeCopyButtons(contentEl);

    // ── Uncertainty sentence highlighting — wrap [U]...[/U] in yellow underline spans
    _applyUncertaintyHighlight(contentEl);

    // ── Key concept highlighting (k field) ────────────────────────────────────
    if (xaiData && Array.isArray(xaiData.k) && xaiData.k.length) {
      _highlightKeywords(contentEl, xaiData.k);
    }

    // Provider badge — shows which AI backend actually answered
    if (providerUsed) {
      const badge = document.createElement('div');
      badge.className = 'provider-badge';
      const icons = { groq:'⚡', openai:'🟢', anthropic:'🟣', gemini:'🔵', ollama:'🦙' };
      const icon = icons[providerUsed] || '🤖';
      badge.innerHTML = `${icon} <span>Orion AI · ${providerUsed}${modelUsed ? ' · ' + modelUsed.split('-').slice(0,3).join('-') : ''}</span>`;
      row.appendChild(badge);
    }

    // ── XAI panel — confidence bar + reasoning type + hallucination + steps ───
    if (xaiData && typeof xaiData.c === 'number') {
      const conf    = Math.max(1, Math.min(10, xaiData.c));
      const pct     = conf * 10;
      const confCls = conf <= 4 ? 'xai-conf-low' : conf <= 7 ? 'xai-conf-mid' : 'xai-conf-high';

      // Reasoning type pill
      const rtype      = typeof xaiData.t === 'string' ? xaiData.t : '';
      const typeColors = { deductive:'xai-type-blue', inductive:'xai-type-purple', analogical:'xai-type-teal', empirical:'xai-type-green', creative:'xai-type-amber' };
      const typePill   = rtype
        ? `<span class="xai-type-badge ${typeColors[rtype] || 'xai-type-blue'}">${escHtml(rtype)}</span>`
        : '';

      // Hallucination risk row
      const hRaw = typeof xaiData.h === 'number' ? Math.max(1, Math.min(5, xaiData.h)) : null;
      let hallHtml = '';
      if (hRaw !== null) {
        const hCls  = hRaw <= 2 ? 'xai-risk-low' : hRaw === 3 ? 'xai-risk-mid' : 'xai-risk-high';
        const hIcon = hRaw <= 2 ? '✓' : '⚠';
        const hText = hRaw <= 2 ? 'Low hallucination risk' : hRaw === 3 ? 'Moderate — verify key facts' : 'High risk — double-check this answer';
        hallHtml = `<div class="xai-risk-row"><span class="xai-risk-badge ${hCls}">${hIcon} ${hText}</span><span style="font-size:0.7rem;color:var(--text3);margin-left:auto">${hRaw}/5</span></div>`;
      }

      // Reasoning steps
      const steps     = Array.isArray(xaiData.r) ? xaiData.r : [];
      const stepsHtml = steps.map((s, i) =>
        `<div class="xai-step"><span class="xai-step-num">${i + 1}</span>` +
        `<span class="xai-step-text">${escHtml(String(s))}</span></div>`
      ).join('');

      const panelId = 'xai-' + Date.now();
      const xaiPanel = document.createElement('div');
      xaiPanel.className = 'xai-panel';
      xaiPanel.innerHTML =
        `<div class="xai-header" onclick="_toggleXai('${panelId}')">` +
          `<span style="font-size:0.8rem;font-weight:600;color:var(--text2)">🔍 Explain Reasoning</span>` +
          `${typePill}` +
          `<div style="display:flex;align-items:center;gap:8px;margin-left:auto">` +
            `<div class="xai-confidence-bar">` +
              `<div class="xai-confidence-fill ${confCls}" style="width:${pct}%"></div>` +
            `</div>` +
            `<span style="font-size:0.75rem;color:var(--text3)">Confidence ${conf}/10</span>` +
          `</div>` +
          `<span class="xai-chevron" id="chev-${panelId}">▾</span>` +
        `</div>` +
        `<div class="xai-body" id="${panelId}">` +
          `${hallHtml}` +
          `<div class="xai-steps">${stepsHtml}</div>` +
        `</div>`;
      row.appendChild(xaiPanel);

      // Store XAI data for timeline and export
      _storeXaiData(convId, { c: conf, h: hRaw, t: rtype, r: steps, ts: Date.now() });

      // Timeline + Export buttons below panel
      const xaiActRow = document.createElement('div');
      xaiActRow.className = 'xai-act-row';
      xaiActRow.innerHTML =
        `<button class="xai-act-btn" onclick="_showXaiTimeline('${convId}')">📊 Timeline</button>` +
        `<button class="xai-act-btn" onclick="_exportXaiPdf('${convId}')">⬇ XAI Report</button>`;
      row.appendChild(xaiActRow);
    }

    // Save AI message
    const targetConv = getConv(convId);
    if (targetConv && fullText.trim()) {
      const aiMsg = { role: 'ai', text: fullText, ts: Date.now(), xai: xaiData || undefined };
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

/* ── Stream through Orion Python AI service (Node → Python → LLM) ─────────── */
async function streamOrionPython(messages, contentEl) {
  const history     = buildHistory(messages, 'openai');
  const agentPrompt = (typeof getActiveSystemPrompt === 'function' && getActiveSystemPrompt())
                      || SYSTEM_PROMPT;
  const token       = localStorage.getItem('orion_access_token') || '';

  const res = await fetch(`${API_BASE}/ai/chat`, {
    method:  'POST',
    signal:  abortCtrl.signal,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages:      history,
      system_prompt: agentPrompt,
      stream:        true,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || errData.error || `AI service error ${res.status}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let full      = '';
  let providerUsed = '';
  let modelUsed    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done || stopFlag) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6);
      if (raw.trim() === '' || raw.trim() === '[DONE]') continue;
      if (raw.trim().startsWith('[ERROR]')) throw new Error(raw.trim().slice(8));

      // Unescape newlines sent by Python service
      const token = raw.replace(/\\n/g, '\n');

      // Extract ORION_META marker (provider/model info)
      const metaIdx = token.indexOf('[ORION_META]');
      let textPart = token;
      if (metaIdx !== -1) {
        textPart = token.slice(0, metaIdx).trim();
        try {
          const meta = JSON.parse(token.slice(metaIdx + 12));
          providerUsed = meta.provider || '';
          modelUsed    = meta.model    || '';
        } catch (_) {}
      }

      if (textPart) {
        full += textPart;
        // Strip [U]/[/U] tags from live streaming display so they don't flash
        const displayText = full.replace(/\[U\]/g, '').replace(/\[\/U\]/g, '');
        contentEl.innerHTML = parseMarkdown(displayText) + '<span class="typing-cursor"></span>';
        scrollBottom();
      }
    }
  }

  return { full, providerUsed, modelUsed };
}

/* ── XAI panel toggle ────────────────────────────────────────────────────── */
function _toggleXai(id) {
  const body = document.getElementById(id);
  const chev = document.getElementById('chev-' + id);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  if (chev) chev.classList.toggle('open', isOpen);
}

/* ── XAI uncertainty sentence highlight ─────────────────────────────────── */
function _applyUncertaintyHighlight(el) {
  // Replace [U]...[/U] in the rendered innerHTML with yellow-underline spans
  // Works outside HTML tags (tags themselves won't contain [U])
  el.innerHTML = el.innerHTML
    .replace(/\[U\]([\s\S]*?)\[\/U\]/g,
      '<span class="xai-uncertain" title="The model is uncertain about this statement">$1</span>');
}

/* ── XAI keyword highlight ───────────────────────────────────────────────── */
function _highlightKeywords(el, keywords) {
  if (!keywords || !keywords.length) return;
  let html = el.innerHTML;
  keywords.forEach(kw => {
    if (!kw || kw.length < 2) return;
    // Escape regex special chars
    const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Only match outside HTML tags (negative lookahead: not followed by > without a < first)
    const re = new RegExp(`\\b(${safe})\\b(?![^<]*>)`, 'gi');
    html = html.replace(re, '<mark class="xai-keyword">$1</mark>');
  });
  el.innerHTML = html;
}

/* ── XAI data storage ────────────────────────────────────────────────────── */
function _storeXaiData(convId, entry) {
  if (!convId) return;
  const key = 'orion_xai_' + convId;
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  arr.push(entry);
  if (arr.length > 100) arr.shift();
  localStorage.setItem(key, JSON.stringify(arr));
}

function _getXaiData(convId) {
  if (!convId) return [];
  return JSON.parse(localStorage.getItem('orion_xai_' + convId) || '[]');
}

/* ── XAI confidence timeline ─────────────────────────────────────────────── */
function _showXaiTimeline(convId) {
  const existing = document.getElementById('xai-timeline-panel');
  if (existing) { existing.remove(); return; }

  const data  = _getXaiData(convId);
  const panel = document.createElement('div');
  panel.id        = 'xai-timeline-panel';
  panel.className = 'xai-timeline-panel';

  const closeBtn = `<button class="xai-tl-close" onclick="document.getElementById('xai-timeline-panel').remove()">✕</button>`;

  if (!data.length) {
    panel.innerHTML =
      `<div class="xai-tl-head"><span>📊 Confidence Timeline</span>${closeBtn}</div>` +
      `<div style="padding:16px;color:var(--text2);font-size:0.85rem">No data yet — send some messages first.</div>`;
    document.body.appendChild(panel);
    return;
  }

  // SVG sparkline
  const W = 300, H = 56, PAD = 8;
  const n   = data.length;
  const pts = data.map((d, i) => {
    const x = PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2);
    const y = PAD + (1 - (d.c - 1) / 9) * (H - PAD * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const dots = data.map((d, i) => {
    const x   = PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2);
    const y   = PAD + (1 - (d.c - 1) / 9) * (H - PAD * 2);
    const col = d.c <= 4 ? '#ef4444' : d.c <= 7 ? '#f59e0b' : '#10b981';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${col}" stroke="#fff" stroke-width="1.5"/>`;
  }).join('');
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<polyline points="${pts}" fill="none" stroke="#7c3aed" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `${dots}</svg>`;

  // Per-message rows
  const rows = data.map((d, i) => {
    const confCls  = d.c <= 4 ? 'xai-conf-low' : d.c <= 7 ? 'xai-conf-mid' : 'xai-conf-high';
    const riskTxt  = !d.h ? '' : d.h <= 2 ? '✓ Low' : d.h === 3 ? '⚠ Mid' : '⚠ High';
    const riskCls  = !d.h ? '' : d.h <= 2 ? 'xai-risk-low' : d.h === 3 ? 'xai-risk-mid' : 'xai-risk-high';
    const riskHtml = riskTxt ? `<span class="xai-risk-badge ${riskCls}" style="font-size:0.68rem;padding:2px 5px">${riskTxt}</span>` : '';
    const typeHtml = d.t ? `<span class="xai-type-badge xai-type-blue" style="font-size:0.65rem;padding:1px 5px">${escHtml(d.t)}</span>` : '';
    return `<div class="xai-tl-row">` +
      `<span class="xai-tl-num">#${i + 1}</span>` +
      `<span class="xai-tl-conf ${confCls}">${d.c}/10</span>` +
      `${riskHtml}${typeHtml}</div>`;
  }).join('');

  const avg = (data.reduce((s, d) => s + d.c, 0) / data.length).toFixed(1);
  panel.innerHTML =
    `<div class="xai-tl-head">` +
      `<span>📊 Confidence Timeline</span>` +
      `<span style="font-size:0.75rem;color:var(--text3);margin-left:8px">avg ${avg}/10</span>` +
      `${closeBtn}` +
    `</div>` +
    `<div style="padding:10px 14px 2px">${svg}</div>` +
    `<div style="padding:0 14px 6px;font-size:0.68rem;color:var(--text3)">● green = high  ● yellow = mid  ● red = low</div>` +
    `<div class="xai-tl-rows">${rows}</div>`;

  document.body.appendChild(panel);
}

/* ── XAI PDF export ──────────────────────────────────────────────────────── */
async function _exportXaiPdf(convId) {
  const data = _getXaiData(convId);
  if (!data.length) {
    alert('No XAI data to export yet. Send some messages first.');
    return;
  }

  // Load jsPDF lazily from CDN
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc  = new jsPDF();
  const conv = typeof getConv === 'function' ? getConv(convId) : null;
  const title = conv?.title || 'Conversation';
  const avg   = (data.reduce((s, d) => s + d.c, 0) / data.length).toFixed(1);

  // ── Cover / summary ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Orion AI — Explainable AI Report', 20, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Conversation: ' + title,                      20, 32);
  doc.text('Generated:    ' + new Date().toLocaleString(), 20, 39);
  doc.text('Messages:     ' + data.length,                20, 46);
  doc.text('Avg confidence: ' + avg + '/10',              20, 53);
  doc.setDrawColor(180, 180, 180);
  doc.line(20, 57, 190, 57);

  let y = 65;
  data.forEach((d, i) => {
    if (y > 265) { doc.addPage(); y = 20; }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Message ' + (i + 1), 20, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const riskLabel = !d.h ? 'N/A' : d.h <= 2 ? 'Low' : d.h === 3 ? 'Moderate' : 'High';
    doc.text(
      'Confidence: ' + d.c + '/10  |  Hallucination risk: ' + (d.h || '?') + '/5 (' + riskLabel + ')  |  Type: ' + (d.t || 'N/A'),
      24, y
    );
    y += 6;

    if (Array.isArray(d.r) && d.r.length) {
      doc.text('Reasoning steps:', 24, y);
      y += 5;
      d.r.forEach((step, si) => {
        if (y > 275) { doc.addPage(); y = 20; }
        const lines = doc.splitTextToSize('  ' + (si + 1) + '. ' + step, 158);
        doc.text(lines, 24, y);
        y += lines.length * 5;
      });
    }

    y += 3;
    doc.setDrawColor(220, 220, 220);
    doc.line(20, y, 190, y);
    y += 7;
  });

  // Page footers
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Orion AI XAI Report  —  Page ' + p + ' of ' + pages, 20, 290);
    doc.setTextColor(0);
  }

  doc.save('orion-xai-' + Date.now() + '.pdf');
}

/* ── Direct API fallback (guest mode or Python service down) ─────────────── */
async function _streamDirect(provider, messages, apiKey, contentEl) {
  if (provider === 'groq')      return streamGroq(messages, apiKey, contentEl);
  if (provider === 'openai')    return streamOpenAI(messages, apiKey, contentEl);
  if (provider === 'anthropic') return streamAnthropic(messages, apiKey, contentEl);
  if (provider === 'gemini')    return streamGemini(messages, apiKey, contentEl);
  if (provider === 'ollama')    return streamOllama(messages, contentEl);
  return streamGroq(messages, apiKey, contentEl); // default
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

/* ── Ollama (Orion-XAI local model) ── */
async function streamOllama(messages, contentEl) {
  const history = buildHistory(messages, 'openai');

  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    signal: abortCtrl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    'orion-xai',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      stream:   true,
      options:  { temperature: 0.7, num_predict: 4096 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error ${res.status} — is Ollama running? Try: ollama serve`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full      = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done || stopFlag) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const data  = JSON.parse(line);
        const token = data?.message?.content || '';
        if (token) {
          full += token;
          contentEl.innerHTML = parseMarkdown(full) + '<span class="typing-cursor"></span>';
          scrollBottom();
        }
      } catch { /* partial JSON line — skip */ }
    }
  }

  return full;
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
    const contentEl = row.querySelector('.ai-content');
    addCodeCopyButtons(contentEl);
    _applyUncertaintyHighlight(contentEl);
    if (msg.xai && Array.isArray(msg.xai.k) && msg.xai.k.length) {
      _highlightKeywords(contentEl, msg.xai.k);
    }

    // Re-render XAI panel from saved data
    if (msg.xai && typeof msg.xai.c === 'number') {
      const xd = msg.xai;
      const conf    = Math.max(1, Math.min(10, xd.c));
      const pct     = conf * 10;
      const confCls = conf <= 4 ? 'xai-conf-low' : conf <= 7 ? 'xai-conf-mid' : 'xai-conf-high';
      const rtype   = typeof xd.t === 'string' ? xd.t : '';
      const typeColors = { deductive:'xai-type-blue', inductive:'xai-type-purple', analogical:'xai-type-teal', empirical:'xai-type-green', creative:'xai-type-amber' };
      const typePill = rtype ? `<span class="xai-type-badge ${typeColors[rtype] || 'xai-type-blue'}">${escHtml(rtype)}</span>` : '';
      const hRaw  = typeof xd.h === 'number' ? Math.max(1, Math.min(5, xd.h)) : null;
      const hallCls  = hRaw === null ? '' : hRaw <= 2 ? 'xai-risk-low' : hRaw <= 3 ? 'xai-risk-mid' : 'xai-risk-high';
      const hallLabel = hRaw === null ? '' : hRaw <= 2 ? '✓ Low hallucination risk' : hRaw <= 3 ? '⚠ Medium hallucination risk' : '✗ High hallucination risk';
      const hallHtml  = hRaw !== null ? `<div class="xai-risk-row"><span class="xai-risk-badge ${hallCls}">${hallLabel}</span><span style="margin-left:auto;font-size:0.75rem;color:var(--text3)">${hRaw}/5</span></div>` : '';
      const steps = Array.isArray(xd.r) ? xd.r : [];
      const stepsHtml = steps.map((s, i) =>
        `<div class="xai-step"><span class="xai-step-num">${i+1}</span><span class="xai-step-text">${escHtml(s)}</span></div>`
      ).join('');
      const panelId = 'xai-' + (msg.ts || Date.now());
      const xaiPanel = document.createElement('div');
      xaiPanel.className = 'xai-panel';
      xaiPanel.innerHTML =
        `<div class="xai-header" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.xai-chevron').classList.toggle('open')">` +
          `<span style="font-size:0.8rem;font-weight:600;color:var(--text2)">🔍 Explain Reasoning</span>` +
          `${typePill}` +
          `<div class="xai-confidence-bar"><div class="xai-confidence-fill ${confCls}" style="width:${pct}%"></div></div>` +
          `<span style="font-size:0.75rem;color:var(--text3);white-space:nowrap">Confidence ${conf}/10</span>` +
          `<span class="xai-chevron">▾</span>` +
        `</div>` +
        `<div class="xai-body open" id="${panelId}">` +
          hallHtml +
          `<div class="xai-steps">${stepsHtml}</div>` +
        `</div>`;
      row.appendChild(xaiPanel);

      const convId = activeId;
      const xaiActRow = document.createElement('div');
      xaiActRow.className = 'xai-act-row';
      xaiActRow.innerHTML =
        `<button class="xai-act-btn" onclick="_showXaiTimeline('${convId}')">📊 Timeline</button>` +
        `<button class="xai-act-btn" onclick="_exportXaiPdf('${convId}')">⬇ XAI Report</button>`;
      row.appendChild(xaiActRow);
    }
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
  const user   = getUser();
  const avatar = document.getElementById('userAvatar');
  const name   = document.getElementById('userName');
  const email  = document.getElementById('userEmailDisplay');
  const signInBtn  = document.getElementById('accountSignInBtn');
  const signInDiv  = document.getElementById('accountSignInDivider');
  const signOutBtn = document.getElementById('accountSignOutBtn');
  const signOutDiv = document.getElementById('accountSignOutDivider');

  const loggedIn = !!(user && isBackendMode);

  if (loggedIn) {
    if (avatar) avatar.textContent = (user.name || user.email || '?')[0].toUpperCase();
    if (name)   name.textContent   = user.name  || 'User';
    if (email)  email.textContent  = user.email || '';
  } else {
    if (avatar) avatar.textContent = '?';
    if (name)   name.textContent   = 'Guest';
    if (email)  email.textContent  = 'Click to sign in';
  }

  // Menu items
  const show = v => v ? 'flex' : 'none';
  const showDiv = v => v ? 'block' : 'none';
  if (signInBtn)  signInBtn.style.display  = show(!loggedIn);
  if (signInDiv)  signInDiv.style.display  = showDiv(!loggedIn);
  if (signOutBtn) signOutBtn.style.display = show(loggedIn);
  if (signOutDiv) signOutDiv.style.display = showDiv(loggedIn);
}

function toggleAccountMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('accountMenu');
  const row  = document.getElementById('accountRow');
  if (!menu || !row) return;
  const isOpen = menu.style.display !== 'none';
  if (isOpen) { closeAccountMenu(); return; }

  // Position above the account row using fixed coords
  const rect = row.getBoundingClientRect();
  menu.style.display = 'block';
  const menuH = menu.offsetHeight;
  menu.style.left   = rect.left + 'px';
  menu.style.width  = rect.width + 'px';
  menu.style.top    = (rect.top - menuH - 6) + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeAccountMenu, { once: true });
  }, 0);
}

function closeAccountMenu() {
  const menu = document.getElementById('accountMenu');
  if (menu) menu.style.display = 'none';
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
  if (!res.ok) throw new Error('Save messages failed');
  return res.json();
}

/* ============================================================
   WORKSPACES & PROJECTS — STATE
   ============================================================ */

let workspaces = [];   // [{ id, name, color, projects: [{id,name,color,icon,...}] }]
let projects   = [];   // flat list of all projects
let _wsProjModalTarget = null; // { type:'workspace'|'project', wsId?, editing? }

/* ============================================================
   API HELPERS
   ============================================================ */

async function loadWorkspacesFromAPI() {
  if (!isBackendMode) return;
  try {
    const res  = await apiCall('GET', '/workspaces');
    if (!res.ok) return;
    const data = await res.json();
    workspaces = data.workspaces || [];
    // Flatten projects for quick lookup
    projects = [];
    workspaces.forEach(ws => ws.projects.forEach(p => projects.push(p)));
    renderWorkspacesSidebar();
  } catch (e) {
    console.warn('loadWorkspacesFromAPI failed:', e.message);
  }
}

async function loadProjectsFromAPI() {
  if (!isBackendMode) return;
  try {
    const res  = await apiCall('GET', '/projects');
    if (!res.ok) return;
    const data = await res.json();
    // Merge orphan projects (no workspaceId) into flat list
    const orphans = (data.projects || []).filter(p => !p.workspaceId);
    // Rebuild: keep workspace projects + add orphans not already present
    const wsProjectIds = new Set(workspaces.flatMap(ws => ws.projects.map(p => p.id)));
    orphans.forEach(p => { if (!wsProjectIds.has(p.id)) projects.push(p); });
    renderWorkspacesSidebar();
  } catch (e) {
    console.warn('loadProjectsFromAPI failed:', e.message);
  }
}

/* ============================================================
   SIDEBAR RENDER
   ============================================================ */

const _originalRenderSidebar = renderSidebar;
renderSidebar = function(filterQ = '') {
  // Show/hide workspace section
  const wsSection = document.getElementById('wsSection');
  if (wsSection) wsSection.style.display = (isBackendMode && isLoggedIn()) ? '' : 'none';
  renderWorkspacesSidebar();
  _originalRenderSidebar(filterQ);
};

function isLoggedIn() {
  return !!localStorage.getItem('orion_access_token');
}

function renderWorkspacesSidebar() {
  const wsList = document.getElementById('wsList');
  if (!wsList) return;
  wsList.innerHTML = '';

  workspaces.forEach(ws => {
    const item = document.createElement('div');
    item.className = 'ws-item';
    item.dataset.wsId = ws.id;

    const open = ws._open || false;

    item.innerHTML = `
      <div class="ws-row" onclick="toggleWs('${ws.id}')">
        <span class="ws-dot" style="background:${ws.color}"></span>
        <span class="ws-name">${escHtml(ws.name)}</span>
        <span class="ws-actions" onclick="event.stopPropagation()">
          <button class="ws-action-btn" title="Add project" onclick="showProjModal('${ws.id}')">＋</button>
          <button class="ws-action-btn" title="Edit" onclick="editWs('${ws.id}')">✎</button>
          <button class="ws-action-btn" title="Delete" onclick="deleteWs('${ws.id}')">🗑</button>
        </span>
        <svg class="ws-chevron ${open ? 'open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="ws-projects" style="display:${open ? 'block' : 'none'}" id="wsproj_${ws.id}">
        ${ws.projects.map(p => renderProjectHTML(p)).join('')}
        <button class="add-proj-btn" onclick="showProjModal('${ws.id}')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New project
        </button>
      </div>`;
    wsList.appendChild(item);
  });

  // Orphan projects (no workspace)
  const orphans = projects.filter(p => !p.workspaceId);
  if (orphans.length) {
    const div = document.createElement('div');
    div.className = 'ws-item';
    div.innerHTML = orphans.map(p => renderProjectHTML(p)).join('');
    wsList.appendChild(div);
  }
}

function renderProjectHTML(p) {
  const convCount = (window.conversations || []).filter(c => c.projectId === p.id).length;
  const open = p._open || false;
  return `
    <div class="proj-item" id="projitem_${p.id}">
      <div class="proj-row" onclick="toggleProj('${p.id}')">
        <span class="proj-icon-badge">${p.icon || '📁'}</span>
        <span class="proj-name">${escHtml(p.name)}</span>
        ${convCount ? `<span class="proj-count">${convCount}</span>` : ''}
        <span class="proj-actions" onclick="event.stopPropagation()">
          <button class="ws-action-btn" title="Edit" onclick="editProj('${p.id}')">✎</button>
          <button class="ws-action-btn" title="Delete" onclick="deleteProj('${p.id}')">🗑</button>
        </span>
        <svg class="proj-chevron ${open ? 'open' : ''}" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="proj-convs" style="display:${open ? 'block' : 'none'}" id="projconvs_${p.id}">
        ${(window.conversations || []).filter(c => c.projectId === p.id).map(c => `
          <div class="conv-item ${c.id === (window.currentConvId || '') ? 'active' : ''}" onclick="selectConv('${c.id}')">
            <span class="conv-title">${escHtml(c.title || 'New Chat')}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleWs(id) {
  const ws = workspaces.find(w => w.id === id);
  if (!ws) return;
  ws._open = !ws._open;
  renderWorkspacesSidebar();
}

function toggleProj(id) {
  const p = projects.find(p => p.id === id);
  if (!p) return;
  p._open = !p._open;
  renderWorkspacesSidebar();
}

/* ============================================================
   WORKSPACE MODAL
   ============================================================ */

const WS_COLORS = ['#7C3AED','#2563EB','#059669','#DC2626','#D97706','#DB2777','#0891B2','#65A30D'];

function showWsModal(editing) {
  _wsProjModalTarget = { type: 'workspace', editing: editing || null };
  const overlay = document.getElementById('wsModalOverlay');
  const title   = document.getElementById('wsModalTitle');
  const inp     = document.getElementById('wsNameInput');
  const swatches = document.getElementById('wsColorSwatches');

  title.textContent = editing ? 'Edit Workspace' : 'New Workspace';
  const ws = editing ? workspaces.find(w => w.id === editing) : null;
  inp.value = ws ? ws.name : '';

  swatches.innerHTML = WS_COLORS.map(c => `
    <span class="color-swatch ${(ws ? ws.color : WS_COLORS[0]) === c ? 'active' : ''}"
      style="background:${c}" data-color="${c}"
      onclick="selectWsColor('${c}')"></span>`).join('');

  overlay.classList.add('open');
  inp.focus();
}

function selectWsColor(c) {
  document.querySelectorAll('#wsColorSwatches .color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === c));
}

function closeWsModal() {
  document.getElementById('wsModalOverlay').classList.remove('open');
}

async function submitWsModal() {
  const name  = document.getElementById('wsNameInput').value.trim();
  if (!name) return;
  const color = document.querySelector('#wsColorSwatches .color-swatch.active')?.dataset.color || WS_COLORS[0];
  const { editing } = _wsProjModalTarget;

  try {
    if (editing) {
      const res = await apiCall('PATCH', `/workspaces/${editing}`, { name, color });
      if (!res.ok) throw new Error('Update failed');
      const data = await res.json();
      const idx = workspaces.findIndex(w => w.id === editing);
      if (idx !== -1) { workspaces[idx] = { ...workspaces[idx], ...data.workspace }; }
    } else {
      const res = await apiCall('POST', '/workspaces', { name, color });
      if (!res.ok) throw new Error('Create failed');
      const data = await res.json();
      workspaces.push({ ...data.workspace, projects: [] });
    }
    closeWsModal();
    renderWorkspacesSidebar();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function editWs(id) {
  showWsModal(id);
}

async function deleteWs(id) {
  if (!confirm('Delete this workspace? Projects inside will be kept but un-grouped.')) return;
  try {
    const res = await apiCall('DELETE', `/workspaces/${id}`);
    if (!res.ok) throw new Error('Delete failed');
    const ws = workspaces.find(w => w.id === id);
    // Orphan its projects
    if (ws) ws.projects.forEach(p => { p.workspaceId = null; projects.push(p); });
    workspaces = workspaces.filter(w => w.id !== id);
    renderWorkspacesSidebar();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

/* ============================================================
   PROJECT MODAL
   ============================================================ */

const PROJ_ICONS = ['📁','💼','🚀','🎨','📊','🔬','🛠️','📝','🎯','💡','🔐','🌐','📱','⚡','🎵','🏗️'];

function showProjModal(wsId, editing) {
  _wsProjModalTarget = { type: 'project', wsId: wsId || null, editing: editing || null };
  const overlay = document.getElementById('projModalOverlay');
  const title   = document.getElementById('projModalTitle');
  const inp     = document.getElementById('projNameInput');
  const swatches = document.getElementById('projColorSwatches');
  const icons   = document.getElementById('projIconPicker');

  title.textContent = editing ? 'Edit Project' : 'New Project';
  const proj = editing ? projects.find(p => p.id === editing) : null;
  inp.value = proj ? proj.name : '';

  swatches.innerHTML = WS_COLORS.map(c => `
    <span class="color-swatch ${(proj ? proj.color : WS_COLORS[0]) === c ? 'active' : ''}"
      style="background:${c}" data-color="${c}"
      onclick="selectProjColor('${c}')"></span>`).join('');

  const selIcon = proj ? proj.icon : PROJ_ICONS[0];
  icons.innerHTML = PROJ_ICONS.map(ic => `
    <span class="icon-opt ${ic === selIcon ? 'active' : ''}" data-icon="${ic}"
      onclick="selectProjIcon('${ic}')">${ic}</span>`).join('');

  overlay.classList.add('open');
  inp.focus();
}

function selectProjColor(c) {
  document.querySelectorAll('#projColorSwatches .color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === c));
}

function selectProjIcon(ic) {
  document.querySelectorAll('#projIconPicker .icon-opt').forEach(s => s.classList.toggle('active', s.dataset.icon === ic));
}

function closeProjModal() {
  document.getElementById('projModalOverlay').classList.remove('open');
}

async function submitProjModal() {
  const name  = document.getElementById('projNameInput').value.trim();
  if (!name) return;
  const color = document.querySelector('#projColorSwatches .color-swatch.active')?.dataset.color || WS_COLORS[0];
  const icon  = document.querySelector('#projIconPicker .icon-opt.active')?.dataset.icon || '📁';
  const { wsId, editing } = _wsProjModalTarget;

  try {
    if (editing) {
      const res = await apiCall('PATCH', `/projects/${editing}`, { name, color, icon });
      if (!res.ok) throw new Error('Update failed');
      const data = await res.json();
      const idx = projects.findIndex(p => p.id === editing);
      if (idx !== -1) projects[idx] = { ...projects[idx], ...data.project };
      // Also update in workspace.projects array
      workspaces.forEach(ws => {
        const pi = ws.projects.findIndex(p => p.id === editing);
        if (pi !== -1) ws.projects[pi] = { ...ws.projects[pi], ...data.project };
      });
    } else {
      const res = await apiCall('POST', '/projects', { name, color, icon, workspaceId: wsId || null });
      if (!res.ok) throw new Error('Create failed');
      const data = await res.json();
      const np = data.project;
      projects.push(np);
      if (wsId) {
        const ws = workspaces.find(w => w.id === wsId);
        if (ws) ws.projects.push(np);
      }
    }
    closeProjModal();
    renderWorkspacesSidebar();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function editProj(id) {
  const p = projects.find(p => p.id === id);
  showProjModal(p?.workspaceId || null, id);
}

async function deleteProj(id) {
  if (!confirm('Delete this project? Conversations inside will be kept but un-grouped.')) return;
  try {
    const res = await apiCall('DELETE', `/projects/${id}`);
    if (!res.ok) throw new Error('Delete failed');
    projects = projects.filter(p => p.id !== id);
    workspaces.forEach(ws => { ws.projects = ws.projects.filter(p => p.id !== id); });
    // Un-assign conversations in memory
    (window.conversations || []).forEach(c => { if (c.projectId === id) c.projectId = null; });
    renderWorkspacesSidebar();
    renderSidebar();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

/* ============================================================
   MOVE CONVERSATION TO PROJECT DROPDOWN
   ============================================================ */

function openMoveDropdown(convId, anchorEl) {
  const dd = document.getElementById('moveDropdown');
  const list = document.getElementById('moveDropdownList');
  list.innerHTML = '';

  // All projects flat
  const allProjs = [...projects, ...workspaces.flatMap(ws => ws.projects)];
  const unique = [...new Map(allProjs.map(p => [p.id, p])).values()];

  if (!unique.length) {
    list.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text3)">No projects yet</div>';
  } else {
    unique.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'move-dropdown-item';
      btn.innerHTML = `<span class="move-dropdown-item-dot" style="background:${p.color}"></span>${escHtml(p.name)}`;
      btn.onclick = () => moveConvToProject(convId, p.id);
      list.appendChild(btn);
    });
  }

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'move-dropdown-remove';
  removeBtn.textContent = '✕  Remove from project';
  removeBtn.onclick = () => moveConvToProject(convId, null);
  dd.appendChild(removeBtn);

  // Position
  const rect = anchorEl.getBoundingClientRect();
  dd.style.top  = rect.bottom + 4 + 'px';
  dd.style.left = rect.left + 'px';
  dd.classList.add('visible');

  setTimeout(() => document.addEventListener('click', closeMoveDropdown, { once: true }), 50);
}

function closeMoveDropdown() {
  document.getElementById('moveDropdown')?.classList.remove('visible');
}

async function moveConvToProject(convId, projectId) {
  closeMoveDropdown();
  try {
    const res = await apiCall('PATCH', `/conversations/${convId}`, { projectId: projectId || null });
    if (!res.ok) throw new Error('Move failed');
    const conv = (window.conversations || []).find(c => c.id === convId);
    if (conv) conv.projectId = projectId || null;
    renderWorkspacesSidebar();
    renderSidebar();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

/* ============================================================
   HOOKS — wire into existing load / logout / auth flows
   ============================================================ */

// Hook loadConversationsFromAPI to also load workspaces
const _origLoadConvs = loadConversationsFromAPI;
loadConversationsFromAPI = async function() {
  await _origLoadConvs.apply(this, arguments);
  await loadWorkspacesFromAPI();
};

// Hook handleLogout to clear workspace state
const _origHandleLogout = handleLogout;
handleLogout = function() {
  workspaces = [];
  projects   = [];
  const wsSection = document.getElementById('wsSection');
  if (wsSection) wsSection.style.display = 'none';
  _origHandleLogout.apply(this, arguments);
};

// Initial visibility fix: hide wsSection until we know auth state
(function() {
  const ws = document.getElementById('wsSection');
  if (ws) ws.style.display = 'none';
})();


/* ============================================================
   CANVAS PANEL
   ============================================================ */

const _canvas = {
  open:     false,
  mode:     'code',      // 'code' | 'doc' | 'preview'
  editing:  false,
  lang:     '',
  title:    '',
  content:  '',          // raw source content
  canPreview: false,     // true for html/js/css
};

/* ── Language metadata ── */
const LANG_META = {
  js:         { label: 'JS',         ext: 'js',   preview: false },
  javascript: { label: 'JS',         ext: 'js',   preview: false },
  ts:         { label: 'TS',         ext: 'ts',   preview: false },
  typescript: { label: 'TS',         ext: 'ts',   preview: false },
  html:       { label: 'HTML',       ext: 'html', preview: true  },
  css:        { label: 'CSS',        ext: 'css',  preview: false },
  python:     { label: 'Python',     ext: 'py',   preview: false },
  py:         { label: 'Python',     ext: 'py',   preview: false },
  java:       { label: 'Java',       ext: 'java', preview: false },
  cpp:        { label: 'C++',        ext: 'cpp',  preview: false },
  c:          { label: 'C',          ext: 'c',    preview: false },
  rust:       { label: 'Rust',       ext: 'rs',   preview: false },
  go:         { label: 'Go',         ext: 'go',   preview: false },
  sql:        { label: 'SQL',        ext: 'sql',  preview: false },
  bash:       { label: 'Bash',       ext: 'sh',   preview: false },
  sh:         { label: 'Shell',      ext: 'sh',   preview: false },
  json:       { label: 'JSON',       ext: 'json', preview: false },
  yaml:       { label: 'YAML',       ext: 'yaml', preview: false },
  markdown:   { label: 'Markdown',   ext: 'md',   preview: false },
  md:         { label: 'Markdown',   ext: 'md',   preview: false },
  doc:        { label: 'Document',   ext: 'md',   preview: false },
};

function getLangMeta(lang) {
  return LANG_META[lang?.toLowerCase()] || { label: (lang || 'Text').toUpperCase(), ext: 'txt', preview: false };
}

/* ── Open canvas ── */
function openCanvas(content, lang, title) {
  _canvas.content  = content;
  _canvas.lang     = lang || 'text';
  _canvas.title    = title || inferTitle(content, lang);
  _canvas.editing  = false;

  const meta = getLangMeta(lang);
  _canvas.canPreview = meta.preview || lang === 'html';

  // Update toolbar
  document.getElementById('canvasLangBadge').textContent = meta.label;
  document.getElementById('canvasTitle').textContent     = _canvas.title;

  // Show/hide preview button
  const previewBtn = document.getElementById('canvasPreviewBtn');
  previewBtn.style.display = _canvas.canPreview ? 'flex' : 'none';

  // Decide initial view: doc for markdown, code for everything else
  if (lang === 'markdown' || lang === 'md' || lang === 'doc') {
    _canvas.mode = 'doc';
    showCanvasDoc();
  } else {
    _canvas.mode = 'code';
    showCanvasCode();
  }

  // Hide edit mode
  exitCanvasEdit();

  // Open panel
  if (!_canvas.open) {
    _canvas.open = true;
    document.getElementById('canvasPanel').classList.add('open');
    syncHlTheme();
  }
}

function closeCanvas() {
  _canvas.open = false;
  document.getElementById('canvasPanel').classList.remove('open');
  exitCanvasEdit();
}

/* ── Code view ── */
function showCanvasCode() {
  _canvas.mode = 'code';
  document.getElementById('canvasCodeWrap').style.display  = '';
  document.getElementById('canvasEditWrap').style.display  = 'none';
  document.getElementById('canvasPreviewFrame').style.display = 'none';

  // Remove doc wrap if exists
  const dw = document.getElementById('canvasDocWrap');
  if (dw) dw.style.display = 'none';

  const codeEl = document.getElementById('canvasCode');
  codeEl.textContent = _canvas.content;
  codeEl.className   = '';

  if (typeof hljs !== 'undefined') {
    const lang = _canvas.lang?.toLowerCase();
    try {
      const result = lang && hljs.getLanguage(lang)
        ? hljs.highlight(_canvas.content, { language: lang })
        : hljs.highlightAuto(_canvas.content);
      codeEl.innerHTML  = result.value;
      codeEl.className  = `hljs language-${result.language || lang}`;
    } catch {
      codeEl.textContent = _canvas.content;
    }
  }

  // Update active button state
  document.getElementById('canvasPreviewBtn')?.classList.remove('active');
}

/* ── Document / markdown view ── */
function showCanvasDoc() {
  _canvas.mode = 'doc';
  document.getElementById('canvasCodeWrap').style.display  = 'none';
  document.getElementById('canvasEditWrap').style.display  = 'none';
  document.getElementById('canvasPreviewFrame').style.display = 'none';

  // Create or reuse doc wrap
  let dw = document.getElementById('canvasDocWrap');
  if (!dw) {
    dw = document.createElement('div');
    dw.id        = 'canvasDocWrap';
    dw.className = 'canvas-doc-wrap';
    const inner  = document.createElement('div');
    inner.id        = 'canvasDocContent';
    inner.className = 'canvas-doc-content';
    dw.appendChild(inner);
    document.getElementById('canvasPanel').insertBefore(dw, document.getElementById('canvasEditWrap'));
  }
  dw.style.display = '';
  document.getElementById('canvasDocContent').innerHTML = parseMarkdown(_canvas.content);
}

/* ── Live preview (HTML/JS) ── */
function showCanvasPreview() {
  _canvas.mode = 'preview';
  document.getElementById('canvasCodeWrap').style.display  = 'none';
  document.getElementById('canvasEditWrap').style.display  = 'none';
  const dw = document.getElementById('canvasDocWrap');
  if (dw) dw.style.display = 'none';

  const iframe = document.getElementById('canvasPreviewFrame');
  iframe.style.display = '';

  // Write HTML into iframe
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(_canvas.content);
  doc.close();

  document.getElementById('canvasPreviewBtn')?.classList.add('active');
}

/* ── Toggle preview button ── */
function toggleCanvasPreview() {
  if (_canvas.mode === 'preview') {
    showCanvasCode();
  } else {
    if (_canvas.canPreview) showCanvasPreview();
  }
}

/* ── Edit mode ── */
function toggleCanvasEdit() {
  if (_canvas.editing) {
    exitCanvasEdit();
  } else {
    enterCanvasEdit();
  }
}

function enterCanvasEdit() {
  _canvas.editing = true;
  document.getElementById('canvasCodeWrap').style.display = 'none';
  const dw = document.getElementById('canvasDocWrap');
  if (dw) dw.style.display = 'none';
  document.getElementById('canvasPreviewFrame').style.display = 'none';

  const editWrap = document.getElementById('canvasEditWrap');
  editWrap.style.display = '';
  document.getElementById('canvasEditor').value = _canvas.content;

  document.getElementById('canvasEditBtn').classList.add('active');
  document.getElementById('canvasAskBtn').style.display = 'flex';
  document.getElementById('canvasAskBar').style.display = 'flex';
  document.getElementById('canvasEditor').focus();
}

function exitCanvasEdit() {
  _canvas.editing = false;
  document.getElementById('canvasEditWrap').style.display  = 'none';
  document.getElementById('canvasAskBar').style.display    = 'none';
  document.getElementById('canvasAskBtn').style.display    = 'none';
  document.getElementById('canvasEditBtn')?.classList.remove('active');

  // Restore previous view
  if (_canvas.mode === 'doc') showCanvasDoc();
  else if (_canvas.mode === 'preview') showCanvasPreview();
  else showCanvasCode();
}

function applyCanvasEdit() {
  _canvas.content = document.getElementById('canvasEditor').value;
  exitCanvasEdit();
}

/* ── Ask AI to revise canvas content ── */
function askAIToRevise() {
  document.getElementById('canvasAskInput').focus();
}

async function sendCanvasRevision() {
  const instruction = document.getElementById('canvasAskInput').value.trim();
  if (!instruction) return;

  // Apply edits first
  _canvas.content = document.getElementById('canvasEditor').value;
  exitCanvasEdit();

  // Build prompt
  const langLabel = getLangMeta(_canvas.lang).label;
  const prompt = `Here is my current ${langLabel} code/document:\n\n\`\`\`${_canvas.lang}\n${_canvas.content}\n\`\`\`\n\nPlease revise it with the following instruction: ${instruction}\n\nReturn ONLY the updated code/document in a code block, no explanations before or after.`;

  document.getElementById('canvasAskInput').value = '';

  // Inject into chat and send
  const inp = document.getElementById('msgInput');
  inp.value = prompt;
  await sendMessage();
}

/* ── Copy ── */
function copyCanvasContent() {
  const text = _canvas.editing
    ? document.getElementById('canvasEditor').value
    : _canvas.content;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('canvasCopyBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => { btn.innerHTML = orig; }, 1800);
  });
}

/* ── Download ── */
function downloadCanvasContent() {
  const ext  = getLangMeta(_canvas.lang).ext;
  const name = (_canvas.title.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 40) || 'canvas') + '.' + ext;
  const blob = new Blob([_canvas.content], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Title inference ── */
function inferTitle(content, lang) {
  // Try to find a function/class name, heading, or filename hint
  const lines = content.split('\n').slice(0, 8);
  for (const line of lines) {
    const m =
      line.match(/^#\s+(.+)/)                              // markdown heading
      || line.match(/(?:function|def|class|const|let|var)\s+(\w+)/) // code identifier
      || line.match(/^<title>([^<]+)<\/title>/i);           // HTML title
    if (m) return m[1].trim().slice(0, 40);
  }
  return lang ? `${getLangMeta(lang).label} snippet` : 'Canvas';
}

/* ── Auto-detect canvas content in AI response ── */
function detectAndOpenCanvas(fullText) {
  // Find the LARGEST code block in the response
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  let best = null;
  let match;

  while ((match = codeBlockRe.exec(fullText)) !== null) {
    const lang    = match[1].trim().toLowerCase() || 'text';
    const content = match[2];
    // Open if: it's HTML, or content is substantial (>8 lines or >300 chars)
    const lines = content.split('\n').length;
    const score = lines * 10 + content.length;
    if (!best || score > best.score) {
      best = { lang, content, score };
    }
  }

  // Also detect large doc responses (no code blocks but long structured text)
  if (!best && fullText.length > 600 && (fullText.includes('\n## ') || fullText.includes('\n# '))) {
    best = { lang: 'doc', content: fullText, score: fullText.length };
  }

  if (best && best.score > 200) {
    openCanvas(best.content, best.lang);
    return true;
  }
  return false;
}

/* ── Patch finalizeAIResponse to auto-open canvas ── */
// We hook into the AI response completion in beginAIResponse.
// Store original and patch after load.
(function patchBeginAIResponse() {
  const _origBegin = window._beginAIResponsePatched;
  if (_origBegin) return; // already patched
  window._beginAIResponsePatched = true;
  // The actual patch happens via _postAIResponse hook called at end of beginAIResponse
})();

// Called at the end of a successful AI response (added via hook below)
function _onAIResponseComplete(fullText) {
  if (fullText && fullText.trim()) {
    detectAndOpenCanvas(fullText);
  }
}

/* ── Resize handle ── */
(function initCanvasResize() {
  document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('canvasResizer');
    const panel   = document.getElementById('canvasPanel');
    if (!resizer || !panel) return;

    let startX, startW;

    resizer.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = panel.offsetWidth;
      resizer.classList.add('dragging');
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup',   onDragEnd);
      e.preventDefault();
    });

    function onDrag(e) {
      const dx  = startX - e.clientX;
      const newW = Math.max(300, Math.min(900, startW + dx));
      panel.style.width    = newW + 'px';
      panel.style.minWidth = newW + 'px';
    }

    function onDragEnd() {
      resizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup',   onDragEnd);
    }
  });
})();

/* ── Sync highlight.js theme with app theme ── */
function syncHlTheme() {
  const link  = document.getElementById('hlThemeLink');
  if (!link) return;
  const theme = document.documentElement.getAttribute('data-theme');
  link.href   = theme === 'light'
    ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css'
    : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
}


/* ── Hook canvas detection into AI response ── */
(function() {
  const _orig = beginAIResponse;
  beginAIResponse = async function(convId) {
    await _orig.call(this, convId);
    // After AI responds, grab the last AI message from the conversation
    const conv = getConv(convId);
    if (conv && conv.messages.length) {
      const last = conv.messages[conv.messages.length - 1];
      if (last && last.role === 'ai' && last.text) {
        _onAIResponseComplete(last.text);
      }
    }
  };
})();


/* ════════════════════════════════════════════════════════════
   PROMPT TEMPLATE LIBRARY
   ════════════════════════════════════════════════════════════ */
const PROMPT_TEMPLATES = {
  'ML / AI': [
    {title:'Literature Review',    prompt:'Conduct a comprehensive literature review on [TOPIC]. Cover: (1) foundational papers and milestones, (2) current state-of-the-art, (3) open problems and research gaps, (4) promising future directions. Include key citations.'},
    {title:'Research Gap Analysis',prompt:'Analyze the research gaps in [FIELD/TOPIC]. What problems remain unsolved? Where do current methods fail? Suggest 3 specific, novel research questions that address these gaps.'},
    {title:'Paper Critique',       prompt:'Critically evaluate this research approach: [DESCRIPTION OR PASTE ABSTRACT]. Assess: novelty, methodology rigor, experimental validity, limitations the authors may have overlooked, and reproducibility concerns.'},
    {title:'Experiment Design',    prompt:'Design a rigorous ML experiment to test the hypothesis: [HYPOTHESIS]. Specify: baseline models, evaluation metrics, dataset splits, statistical significance tests, ablation studies, and potential confounds to control for.'},
    {title:'Model Comparison',     prompt:'Compare [MODEL A] vs [MODEL B] for the task of [TASK]. Cover: architecture differences, inductive biases, computational complexity, empirical performance benchmarks, when to prefer each, and key limitations.'},
    {title:'Concept Explanation',  prompt:'Explain [ALGORITHM/CONCEPT] from first principles. Build from intuition to mathematical formulation to implementation. Include a worked example and analyze time/space complexity.'},
  ],
  'Research': [
    {title:'Hypothesis Generator', prompt:'Generate 5 testable research hypotheses about [TOPIC]. For each: state it precisely, explain the theoretical basis, describe how you would test it, and identify what result would falsify it.'},
    {title:'Related Work',         prompt:'Help me write a related work section for a paper on [TOPIC]. Group prior work by theme, highlight how each contribution relates to my work, and identify what distinguishes my approach.'},
    {title:'Methodology',          prompt:'Write a rigorous methodology section for research on [TOPIC] using [APPROACH]. Justify each design choice, describe evaluation protocol, and anticipate reviewer concerns about validity and reproducibility.'},
    {title:'Abstract Writer',      prompt:'Write an academic abstract for my paper. Problem: [PROBLEM]. Method: [METHOD]. Results: [RESULTS]. Follow IMRaD structure, 150-250 words, emphasize contribution over background.'},
    {title:'Reviewer Rebuttal',    prompt:'Help me write a professional rebuttal to this reviewer comment: [PASTE COMMENT]. Acknowledge valid points, respond with evidence, propose concrete changes, and maintain a constructive tone.'},
  ],
  'Code': [
    {title:'Code Review',          prompt:'Review this code for correctness, efficiency, readability, and best practices. Provide specific, actionable feedback with improved code examples:\n\n```\n[PASTE CODE HERE]\n```'},
    {title:'Debug Help',           prompt:'I am getting this error: [ERROR MESSAGE]\n\nMy code:\n```\n[PASTE CODE]\n```\n\nExplain exactly what is wrong, why it happens, and provide the corrected version with explanation.'},
    {title:'Optimize Code',        prompt:'Optimize this code for [speed / memory / readability]. Show the before and after, explain each change, and compare time/space complexity:\n\n```\n[PASTE CODE]\n```'},
    {title:'Write Tests',          prompt:'Write comprehensive unit tests for this function. Cover: happy path, edge cases, error conditions, and boundary values. Use [pytest/jest]:\n\n```\n[PASTE CODE]\n```'},
    {title:'Architecture Review',  prompt:'Review my system architecture: [DESCRIBE SYSTEM]. Identify: scalability bottlenecks, single points of failure, security concerns, and provide concrete improvement suggestions with tradeoffs.'},
  ],
  'Writing': [
    {title:'Improve Writing',      prompt:'Improve this text for clarity, conciseness, and impact while preserving my voice and meaning:\n\n[PASTE TEXT]'},
    {title:'Email Draft',          prompt:'Write a professional email to [RECIPIENT] about [TOPIC]. Tone: [formal/friendly/assertive]. Key points to cover: [LIST POINTS]. Keep it concise and end with a clear call to action.'},
    {title:'Explain Simply',       prompt:'Explain [COMPLEX TOPIC] as if speaking to [a first-year PhD student / a non-technical manager / a curious high school student]. Use analogies, avoid jargon, and build intuition before details.'},
    {title:"Devil's Advocate",     prompt:"Challenge my position: [STATE YOUR ARGUMENT OR IDEA]. Give the strongest possible counterarguments, identify evidence against me, and expose assumptions I'm making that could be wrong. Be direct."},
  ],
};

let _templatesOpen     = false;
let _templatesCategory = 'ML / AI';

function toggleTemplates() { _templatesOpen ? closeTemplates() : openTemplates(); }

function openTemplates() {
  _templatesOpen = true;
  document.getElementById('templatesPanel')?.classList.add('open');
  document.getElementById('templatesBtn')?.classList.add('active');
  renderTemplateCategories();
  renderTemplateList(_templatesCategory);
  setTimeout(() => document.getElementById('templatesSearch')?.focus(), 60);
}

function closeTemplates() {
  _templatesOpen = false;
  document.getElementById('templatesPanel')?.classList.remove('open');
  document.getElementById('templatesBtn')?.classList.remove('active');
}

function renderTemplateCategories() {
  const cats = document.getElementById('templatesCats');
  if (!cats) return;
  cats.innerHTML = Object.keys(PROMPT_TEMPLATES).map(cat =>
    `<button class="tmpl-cat-btn${cat === _templatesCategory ? ' active' : ''}"
             onclick="selectTemplateCategory('${cat.replace(/'/g, "\\'")}')">${cat}</button>`
  ).join('');
}

function selectTemplateCategory(cat) {
  _templatesCategory = cat;
  renderTemplateCategories();
  renderTemplateList(cat, document.getElementById('templatesSearch')?.value || '');
}

function renderTemplateList(cat, filter = '') {
  const list = document.getElementById('templatesList');
  if (!list) return;
  const items = PROMPT_TEMPLATES[cat] || [];
  const q     = filter.toLowerCase();
  const filtered = q
    ? items.filter(t => t.title.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q))
    : items;
  if (!filtered.length) {
    list.innerHTML = '<div class="tmpl-empty">No templates match your search.</div>';
    return;
  }
  list.innerHTML = filtered.map((t, i) => {
    const safePrompt = t.prompt.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\${/g,'\\${');
    return `<button class="tmpl-item" onclick="insertTemplateByIndex(${JSON.stringify(cat)},${i})">
      <span class="tmpl-title">${escHtml(t.title)}</span>
      <span class="tmpl-preview">${escHtml(t.prompt.slice(0,88))}…</span>
    </button>`;
  }).join('');
}

function insertTemplateByIndex(cat, idx) {
  const t = PROMPT_TEMPLATES[cat]?.[idx];
  if (!t) return;
  const inp = document.getElementById('msgInput');
  if (!inp) return;
  inp.value = t.prompt;
  autoResize(inp);
  inp.focus();
  const firstBracket = t.prompt.indexOf('[');
  if (firstBracket !== -1) inp.setSelectionRange(firstBracket, t.prompt.indexOf(']', firstBracket) + 1);
  closeTemplates();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('templatesSearch')?.addEventListener('input', e => {
    renderTemplateList(_templatesCategory, e.target.value);
  });
  document.addEventListener('click', e => {
    const panel = document.getElementById('templatesPanel');
    const btn   = document.getElementById('templatesBtn');
    if (_templatesOpen && panel && !panel.contains(e.target) && !btn?.contains(e.target)) {
      closeTemplates();
    }
  });
});


/* ════════════════════════════════════════════════════════════
   CUSTOM AI AGENTS / PERSONAS
   ════════════════════════════════════════════════════════════ */
const DEFAULT_AGENTS = [
  {id:'default',  name:'Orion (Default)',        icon:'🔮', desc:'General-purpose AI assistant', system:''},
  {id:'research', name:'Research Assistant',     icon:'🔬', desc:'Expert academic research guide',
   system:'You are an expert academic research assistant. You help with literature reviews, hypothesis generation, methodology design, paper analysis, and academic writing. Be rigorous, cite your reasoning, acknowledge uncertainty, and structure responses clearly with headers and sections where appropriate.'},
  {id:'ml',       name:'ML Engineer',            icon:'🤖', desc:'Machine learning & deep learning expert',
   system:'You are a senior machine learning engineer with deep expertise in deep learning, classical ML, statistics, and MLOps. Provide technically precise, implementation-ready advice. Include code examples when helpful. Always discuss tradeoffs, computational costs, and practical deployment considerations.'},
  {id:'devil',    name:"Devil's Advocate",       icon:'😈', desc:'Stress-tests and challenges your ideas',
   system:"Your role is to constructively challenge the user's ideas, assumptions, and arguments. Push back, identify logical flaws, present the strongest counterarguments, and expose hidden assumptions. Be direct and precise but never dismissive. Always end your response with one sharp question that challenges their reasoning."},
  {id:'tutor',    name:'Socratic Tutor',         icon:'🦉', desc:'Guides you to discover answers yourself',
   system:"You are a Socratic tutor. Never give direct answers — instead guide the user to discover answers through targeted questions, well-chosen hints, and small prompts. Break complex topics into small digestible steps. Acknowledge partial progress. Never reveal the full solution until the user reaches it themselves."},
  {id:'code',     name:'Code Reviewer',          icon:'💻', desc:'Strict code quality expert',
   system:'You are a strict but fair senior software engineer doing code review. Analyze code for correctness, efficiency, security vulnerabilities, readability, and maintainability. Reference specific line numbers or patterns. Suggest concrete improvements with code examples. Apply language and framework best practices. Never just say "looks good" — always find something to improve.'},
];

let _activeAgentId     = localStorage.getItem('orion_active_agent') || 'default';
let _customAgents      = JSON.parse(localStorage.getItem('orion_custom_agents') || '[]');
let _agentModalEditing = null;

function getAllAgents()            { return [...DEFAULT_AGENTS, ..._customAgents]; }
function getActiveAgent()         { return getAllAgents().find(a => a.id === _activeAgentId) || DEFAULT_AGENTS[0]; }
function getActiveSystemPrompt()  { return getActiveAgent().system || ''; }

function setActiveAgent(id) {
  _activeAgentId = id;
  localStorage.setItem('orion_active_agent', id);
  renderAgentsSidebar();
  updateAgentPill();
}

function updateAgentPill() {
  const pill  = document.getElementById('activeAgentPill');
  const agent = getActiveAgent();
  if (!pill) return;
  if (agent.id === 'default') { pill.style.display = 'none'; return; }
  pill.style.display = 'flex';
  pill.innerHTML = `<span>${agent.icon}</span><span>${escHtml(agent.name)}</span>`;
}

function renderAgentsSidebar() {
  const list = document.getElementById('agentsList');
  if (!list) return;
  const agents = getAllAgents();

  function agentRowHTML(a) {
    const isBuiltin = DEFAULT_AGENTS.some(d => d.id === a.id);
    return `<div class="agent-row${a.id === _activeAgentId ? ' active' : ''}" onclick="setActiveAgent('${a.id}')">
      <span class="agent-icon">${a.icon}</span>
      <div class="agent-info">
        <span class="agent-name">${escHtml(a.name)}</span>
        <span class="agent-desc">${escHtml(a.desc)}</span>
      </div>
      ${!isBuiltin ? `<button class="agent-del-btn" onclick="event.stopPropagation();deleteCustomAgent('${a.id}')" title="Delete">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>` : ''}
    </div>`;
  }

  // First agent always pinned (Orion Default), rest collapsible
  const [first, ...rest] = agents;
  const extraDisplay = _agentsCollapsed ? 'none' : 'block';
  list.innerHTML =
    (first ? agentRowHTML(first) : '') +
    (rest.length ? `<div class="agents-extra" id="agentsExtra" style="display:${extraDisplay}">` +
      rest.map(agentRowHTML).join('') +
    `</div>` : '');
}

function showAgentModal(id = null) {
  _agentModalEditing = id;
  const agent = id ? _customAgents.find(a => a.id === id) : null;
  document.getElementById('agentModalTitle').textContent = id ? 'Edit Agent' : 'New Agent';
  document.getElementById('agentIconInput').value   = agent?.icon   || '🤖';
  document.getElementById('agentNameInput').value   = agent?.name   || '';
  document.getElementById('agentDescInput').value   = agent?.desc   || '';
  document.getElementById('agentSystemInput').value = agent?.system || '';
  document.getElementById('agentModalOverlay')?.classList.add('open');
  setTimeout(() => document.getElementById('agentNameInput')?.focus(), 60);
}

function closeAgentModal() {
  document.getElementById('agentModalOverlay')?.classList.remove('open');
}

function submitAgentModal() {
  const name   = document.getElementById('agentNameInput').value.trim();
  const icon   = document.getElementById('agentIconInput').value.trim() || '🤖';
  const desc   = document.getElementById('agentDescInput').value.trim();
  const system = document.getElementById('agentSystemInput').value.trim();
  if (!name) { document.getElementById('agentNameInput')?.focus(); return; }
  if (_agentModalEditing) {
    const idx = _customAgents.findIndex(a => a.id === _agentModalEditing);
    if (idx !== -1) _customAgents[idx] = {..._customAgents[idx], name, icon, desc, system};
  } else {
    _customAgents.push({id: 'agent_' + Date.now(), name, icon, desc, system});
  }
  localStorage.setItem('orion_custom_agents', JSON.stringify(_customAgents));
  renderAgentsSidebar();
  closeAgentModal();
}

function deleteCustomAgent(id) {
  if (!confirm('Delete this agent?')) return;
  _customAgents = _customAgents.filter(a => a.id !== id);
  localStorage.setItem('orion_custom_agents', JSON.stringify(_customAgents));
  if (_activeAgentId === id) setActiveAgent('default');
  else renderAgentsSidebar();
}

/* Patch buildHistory to inject agent persona as initial exchange */
(function() {
  const _orig = buildHistory;
  buildHistory = function(messages, provider) {
    const hist = _orig(messages, provider);
    const sys  = getActiveSystemPrompt();
    if (!sys) return hist;
    if (provider === 'openai' || provider === 'groq') {
      return [
        {role:'user',      content:`[Adopt this persona for our entire conversation: ${sys}]`},
        {role:'assistant', content:'Understood. I will maintain this persona throughout our conversation.'},
        ...hist,
      ];
    }
    if (provider === 'anthropic') {
      return [
        {role:'user',      content:`[Adopt this persona for our entire conversation: ${sys}]`},
        {role:'assistant', content:'Understood. I will maintain this persona throughout our conversation.'},
        ...hist,
      ];
    }
    if (provider === 'gemini') {
      return [
        {role:'user',  parts:[{text:`[Adopt this persona for our entire conversation: ${sys}]`}]},
        {role:'model', parts:[{text:'Understood. I will maintain this persona throughout our conversation.'}]},
        ...hist,
      ];
    }
    return hist;
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  renderAgentsSidebar();
  updateAgentPill();
});


/* ════════════════════════════════════════════════════════════
   PDF RESEARCH PAPER ANALYZER
   ════════════════════════════════════════════════════════════ */
const RESEARCH_ANALYSIS_PROMPT = `Analyze this research paper and provide a structured academic breakdown:

## 📋 Paper Overview
- **Title & Authors**: (extract from paper)
- **Venue / Year**: (if mentioned)
- **One-line summary**: (the core contribution in one sentence)

## 🎯 Problem & Motivation
What specific problem does this paper address? Why does it matter? What gap in existing work does it fill?

## 🔧 Methodology
Explain the core approach, model architecture, or algorithm. What are the key technical innovations? Include relevant equations or architecture details if helpful.

## 📊 Experiments & Results
What datasets were used? Which metrics? What were the key quantitative results? How does it compare to baselines?

## ✅ Strengths
What does this paper do particularly well? What are its most convincing contributions?

## ⚠️ Limitations & Weaknesses
What are the main limitations? What important scenarios does it not address? Are there experimental validity concerns?

## 🚀 Future Work & Open Questions
What follow-up research directions does this paper suggest? What are the most interesting open questions it raises?

## 🔗 Related Work to Explore
Suggest 3–5 key papers someone should read alongside this one.

---
Here is the paper content to analyze:

`;

function checkForPDFAttachment() {
  const hasPDF = attachedFiles.some(f =>
    f.type === 'pdf' || (f.name && f.name.toLowerCase().endsWith('.pdf'))
  );
  const btn = document.getElementById('paperAnalyzeBtn');
  if (btn) btn.classList.toggle('visible', hasPDF);
}

function analyzeResearchPaper() {
  const inp = document.getElementById('msgInput');
  if (!inp) return;
  inp.value = RESEARCH_ANALYSIS_PROMPT;
  autoResize(inp);
  sendMessage();
}

/* Hook into renderFileChips to show/hide the analyze button */
(function() {
  if (typeof renderFileChips !== 'function') return;
  const _orig = renderFileChips;
  renderFileChips = function() {
    _orig();
    checkForPDFAttachment();
  };
})();


/* ════════════════════════════════════════════════════════════
   MULTI-MODEL A/B COMPARISON
   ════════════════════════════════════════════════════════════ */
const COMPARE_MODELS = [
  {id:'orion-local',label:'🦙 Orion Local (Llama 3.2)',     provider:'orion',     model:'llama3.2'},
  {id:'groq-70b',   label:'⚡ Llama 3.3 70B (Groq — Cloud)', provider:'groq',     model:'llama-3.3-70b-versatile'},
  {id:'groq-8b',    label:'⚡ Llama 3.1 8B · Fast (Groq)',   provider:'groq',     model:'llama-3.1-8b-instant'},
  {id:'openai',     label:'🟢 GPT-4o-mini (OpenAI)',          provider:'openai',   model:'gpt-4o-mini'},
  {id:'anthropic',  label:'🟣 Claude Haiku (Anthropic)',      provider:'anthropic',model:'claude-haiku-4-5-20251001'},
  {id:'gemini',     label:'🔵 Gemini 1.5 Flash (Google)',     provider:'gemini',   model:'gemini-1.5-flash'},
];

let _compareMode = false;

function toggleCompareMode() {
  _compareMode = !_compareMode;
  const bar = document.getElementById('compareBar');
  const btn = document.getElementById('compareBtn');
  if (bar) bar.style.display = _compareMode ? 'flex' : 'none';
  if (btn) btn.classList.toggle('active', _compareMode);
  if (_compareMode) _populateCompareSelects();
}

function _populateCompareSelects() {
  ['compareModelA','compareModelB'].forEach((selId, i) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = COMPARE_MODELS.map(m =>
      `<option value="${m.id}">${m.label}</option>`
    ).join('');
    // Model A defaults to Orion Local, Model B defaults to Groq cloud
    const defaults = ['orion-local', 'groq-70b'];
    sel.value = defaults[i] || COMPARE_MODELS[i]?.id || COMPARE_MODELS[0].id;
  });
}

async function _streamForCompare(modelConfig, messages, contentEl) {
  const apiKey  = getApiKey();
  const {provider, model} = modelConfig;
  const fmtProvider = (provider === 'groq') ? 'groq' : provider;
  const hist    = buildHistory(messages, fmtProvider === 'groq' ? 'openai' : fmtProvider);
  const signal  = abortCtrl.signal;

  // Orion Local — route through Python AI service (Ollama/Llama 3.2)
  if (provider === 'orion') {
    const result = await streamOrionPython(messages, contentEl);
    return result.full;
  }

  if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', signal,
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model, messages:[{role:'system',content:SYSTEM_PROMPT},...hist], stream:true, max_tokens:2048}),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message||`Groq ${res.status}`); }
    return readStream(res.body, contentEl, chunk => {
      try { return JSON.parse(chunk.replace(/^data: /,'')).choices?.[0]?.delta?.content||''; } catch{return '';}
    });
  }
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST', signal,
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model, messages:[{role:'system',content:SYSTEM_PROMPT},...hist], stream:true, max_tokens:2048}),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message||`OpenAI ${res.status}`); }
    return readStream(res.body, contentEl, chunk => {
      try { return JSON.parse(chunk.replace(/^data: /,'')).choices?.[0]?.delta?.content||''; } catch{return '';}
    });
  }
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST', signal,
      headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model, max_tokens:2048, system:SYSTEM_PROMPT, stream:true, messages:hist}),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message||`Anthropic ${res.status}`); }
    return readStream(res.body, contentEl, chunk => {
      try { const d=JSON.parse(chunk.replace(/^data: /,'')); if(d.type==='content_block_delta') return d.delta?.text||''; } catch{}
      return '';
    });
  }
  throw new Error(`Provider "${provider}" not yet supported in compare mode.`);
}

async function beginABComparison(convId) {
  isTyping  = true;
  stopFlag  = false;
  abortCtrl = new AbortController();

  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';

  const thinkRow = createThinkRow();
  document.getElementById('messages').appendChild(thinkRow);
  scrollBottom(true);

  const conv = getConv(convId);
  if (!conv) { finishTyping(); return; }

  const modelAId = document.getElementById('compareModelA')?.value || 'groq-70b';
  const modelBId = document.getElementById('compareModelB')?.value || 'groq-8b';
  const modelA   = COMPARE_MODELS.find(m => m.id === modelAId) || COMPARE_MODELS[0];
  const modelB   = COMPARE_MODELS.find(m => m.id === modelBId) || COMPARE_MODELS[1];

  thinkRow.remove();
  if (stopFlag) { finishTyping(); return; }

  /* Build side-by-side DOM */
  const pair = document.createElement('div');
  pair.className = 'ab-pair';
  pair.innerHTML = `
    <div class="ab-col">
      <div class="ab-col-header">
        <span class="ab-dot" style="background:#7c3aed"></span>
        ${escHtml(modelA.label)}
      </div>
      <div class="ab-col-content" id="abContentA"></div>
    </div>
    <div class="ab-col">
      <div class="ab-col-header">
        <span class="ab-dot" style="background:#d97757"></span>
        ${escHtml(modelB.label)}
      </div>
      <div class="ab-col-content" id="abContentB"></div>
    </div>`;
  document.getElementById('messages').appendChild(pair);
  scrollBottom(true);

  const contentA = document.getElementById('abContentA');
  const contentB = document.getElementById('abContentB');
  let fullTextA = '', fullTextB = '';

  try {
    [fullTextA, fullTextB] = await Promise.all([
      _streamForCompare(modelA, conv.messages, contentA)
        .catch(e => { if(contentA) contentA.innerHTML = `<span style="color:#ef4444;font-size:.8rem">⚠ ${escHtml(e.message)}</span>`; return ''; }),
      _streamForCompare(modelB, conv.messages, contentB)
        .catch(e => { if(contentB) contentB.innerHTML = `<span style="color:#ef4444;font-size:.8rem">⚠ ${escHtml(e.message)}</span>`; return ''; }),
    ]);

    if (fullTextA) { contentA.innerHTML = parseMarkdown(fullTextA); addCodeCopyButtons(contentA); }
    if (fullTextB) { contentB.innerHTML = parseMarkdown(fullTextB); addCodeCopyButtons(contentB); }

    /* Save combined as the AI message */
    const combined = fullTextA || fullTextB;
    if (combined.trim()) {
      const aiMsg = {
        role: 'ai',
        text: `**${modelA.label}:**\n\n${fullTextA}\n\n---\n\n**${modelB.label}:**\n\n${fullTextB}`,
        ts: Date.now(),
      };
      conv.messages.push(aiMsg);
      if (!isBackendMode) save();
      if (isBackendMode && _pendingUserMsg) {
        setSyncDot('syncing');
        saveMessagesToAPI(convId, [_pendingUserMsg, aiMsg]).then(()=>setSyncDot('synced')).catch(()=>setSyncDot('error'));
        _pendingUserMsg = null;
      }
    }
  } catch(err) {
    if (err.name !== 'AbortError' && !stopFlag) showApiError(err.message);
  } finally {
    finishTyping();
  }
}

/* Override beginAIResponse to intercept compare mode */
(function() {
  const _prevBeginAI = beginAIResponse;  // captures canvas-patched version
  beginAIResponse = async function(convId) {
    if (_compareMode) return beginABComparison(convId);
    return _prevBeginAI(convId);
  };
})();


/* ════════════════════════════════════════════════════════════
   AGENT-SPECIFIC WELCOME PROMPT CARDS
   ════════════════════════════════════════════════════════════ */
const AGENT_PROMPT_CARDS = {
  default: [
    {cat:'career',   emoji:'🎯', label:'Career',       text:"I want to become a cybersecurity analyst — build my complete career roadmap"},
    {cat:'learn',    emoji:'📚', label:'Learning',      text:"Create a 6-month plan to master Python from complete beginner to job-ready"},
    {cat:'cyber',    emoji:'🛡', label:'Cybersecurity', text:"Explain how SQL injection works and how developers can defend against it"},
    {cat:'research', emoji:'🔬', label:'Research',      text:"Help me write a strong introduction for my thesis on AI in healthcare"},
    {cat:'code',     emoji:'⚡', label:'Code',          text:"Build a REST API in Node.js with Express, JWT auth, and PostgreSQL"},
    {cat:'writing',  emoji:'✍️', label:'Writing',       text:"Write a professional cover letter for a software engineering internship"},
  ],
  research: [
    {cat:'research', emoji:'📖', label:'Literature',    text:"Summarize the state of the art in transformer-based language models and key open problems"},
    {cat:'research', emoji:'💡', label:'Hypothesis',    text:"Generate 5 testable hypotheses about reinforcement learning from human feedback (RLHF)"},
    {cat:'research', emoji:'🔍', label:'Gap Analysis',  text:"What are the main open problems in continual learning for neural networks?"},
    {cat:'research', emoji:'📐', label:'Methodology',   text:"Design a rigorous study to measure the impact of AI tutoring systems on student learning outcomes"},
    {cat:'writing',  emoji:'✍️', label:'Paper Intro',   text:"Help me write a compelling introduction for a paper on federated learning with privacy guarantees"},
    {cat:'research', emoji:'📊', label:'Critique',      text:"What are the key limitations of large language models that current research has not yet solved?"},
  ],
  ml: [
    {cat:'code',     emoji:'🧠', label:'Architecture',  text:"Explain the multi-head attention mechanism in transformers from scratch, with PyTorch code"},
    {cat:'code',     emoji:'🐛', label:'Debug',         text:"My neural network loss oscillates and won't converge — what should I check first?"},
    {cat:'code',     emoji:'⚙️', label:'Implement',     text:"Implement a ResNet-18 from scratch in PyTorch with a full training loop and evaluation"},
    {cat:'code',     emoji:'🚀', label:'Optimize',      text:"How do I reduce inference latency for a BERT model deployed in production at scale?"},
    {cat:'learn',    emoji:'⚖️', label:'Compare',       text:"Compare Adam vs AdamW vs SGD with momentum — when should I use each for fine-tuning LLMs?"},
    {cat:'code',     emoji:'🏗️', label:'MLOps',         text:"Design a scalable ML pipeline for real-time fraud detection with feature drift monitoring"},
  ],
  devil: [
    {cat:'cyber',    emoji:'😈', label:'Challenge',     text:"AI will solve all of humanity's major problems within the next 10 years"},
    {cat:'research', emoji:'🔥', label:'Debate',        text:"Deep learning is just sophisticated curve fitting — it doesn't truly understand anything"},
    {cat:'career',   emoji:'💥', label:'Stress Test',   text:"My startup idea: build an AI-powered personal assistant that learns user habits"},
    {cat:'code',     emoji:'⚔️', label:'Push Back',     text:"More data always leads to better model performance — is this actually true?"},
    {cat:'research', emoji:'🧨', label:'Scrutinize',    text:"Explainable AI is essential before deploying any ML model in production environments"},
    {cat:'writing',  emoji:'🎯', label:'Critique',      text:"RAG (Retrieval-Augmented Generation) is always better than fine-tuning for domain adaptation"},
  ],
  tutor: [
    {cat:'learn',    emoji:'🤔', label:'Explore',       text:"I want to understand intuitively why neural networks can approximate any function"},
    {cat:'learn',    emoji:'🔎', label:'Discover',      text:"Help me understand what backpropagation is actually computing, step by step"},
    {cat:'learn',    emoji:'💭', label:'Investigate',   text:"Why does dropout work as a regularization technique? What is it really doing?"},
    {cat:'learn',    emoji:'🌱', label:'Unpack',        text:"Walk me through how attention in transformers is fundamentally different from RNNs"},
    {cat:'learn',    emoji:'🎯', label:'Intuition',     text:"What is the real intuition behind the bias-variance tradeoff in machine learning?"},
    {cat:'learn',    emoji:'🔄', label:'Trace',         text:"Guide me through how a GPT model generates the next token, one decision at a time"},
  ],
  code: [
    {cat:'code',     emoji:'🔍', label:'Review',        text:"Review this Python implementation and tell me everything wrong with it:\n\n```python\n# Paste your code here\n```"},
    {cat:'code',     emoji:'♻️', label:'Refactor',      text:"My Express.js API is getting messy and hard to maintain — how should I restructure it?"},
    {cat:'code',     emoji:'⚡', label:'Optimize',      text:"This function runs in O(n²) and is too slow for large inputs — how do I fix it?"},
    {cat:'code',     emoji:'🔒', label:'Security',      text:"Review my JWT authentication middleware for security vulnerabilities and edge cases"},
    {cat:'code',     emoji:'🧪', label:'Testing',       text:"Write comprehensive pytest tests for a user authentication service with edge cases"},
    {cat:'code',     emoji:'🏗️', label:'Design',        text:"Is my database schema properly normalized for an e-commerce application? Here's my schema:"},
  ],
};

function renderWelcomePrompts(agentId) {
  const grid = document.getElementById('promptGrid');
  if (!grid) return;
  const cards = AGENT_PROMPT_CARDS[agentId] || AGENT_PROMPT_CARDS['default'];
  grid.innerHTML = cards.map(c => `
    <button class="prompt-card" onclick="sendPrompt(this)">
      <div class="prompt-card-top">
        <span class="prompt-category ${c.cat}">${c.emoji} ${c.label}</span>
      </div>
      <div class="prompt-text">${escHtml(c.text)}</div>
    </button>`
  ).join('');
}

/* Patch setActiveAgent to also update the prompt cards */
(function() {
  const _origSetActive = setActiveAgent;
  setActiveAgent = function(id) {
    _origSetActive(id);
    renderWelcomePrompts(id);
  };
  /* Render on page load based on stored agent */
  document.addEventListener('DOMContentLoaded', () => {
    renderWelcomePrompts(_activeAgentId);
  });
})();


/* ════════════════════════════════════════════════════════════
   AGENT-SPECIFIC WELCOME HEADER (title + subtitle + badge)
   ════════════════════════════════════════════════════════════ */
const AGENT_WELCOME_HEADER = {
  default: {
    title:  'Your Intelligent AI Assistant',
    sub:    'Career guidance · Learning roadmaps · Cybersecurity · Research · Code · Writing',
    badge:  'Orion AI · MVP',
  },
  research: {
    title:  'Your Academic Research Partner',
    sub:    'Literature reviews · Hypothesis generation · Paper analysis · Methodology · Academic writing',
    badge:  '🔬 Research Assistant',
  },
  ml: {
    title:  'Your Machine Learning Expert',
    sub:    'Deep learning · Model architecture · Training optimization · Debugging · MLOps',
    badge:  '🤖 ML Engineer',
  },
  devil: {
    title:  'Challenge Your Thinking',
    sub:    'Stress-test ideas · Find logical flaws · Expose assumptions · Sharpen your reasoning',
    badge:  '😈 Devil\'s Advocate',
  },
  tutor: {
    title:  'Discover Answers Through Questions',
    sub:    'Guided learning · Intuition building · Step-by-step discovery · No spoilers, ever',
    badge:  '🦉 Socratic Tutor',
  },
  code: {
    title:  'Your Strict Code Quality Expert',
    sub:    'Code review · Security audits · Performance optimization · Best practices · Testing',
    badge:  '💻 Code Reviewer',
  },
};

function updateWelcomeHeader(agentId) {
  const h = AGENT_WELCOME_HEADER[agentId] || AGENT_WELCOME_HEADER['default'];
  const titleEl = document.querySelector('.welcome-title');
  const subEl   = document.querySelector('.welcome-sub');
  const badgeEl = document.querySelector('.welcome-badge');
  if (titleEl) titleEl.textContent = h.title;
  if (subEl)   subEl.textContent   = h.sub;
  if (badgeEl) badgeEl.textContent = h.badge;
}

/* Patch setActiveAgent to also update the header */
(function() {
  const _prev = setActiveAgent;
  setActiveAgent = function(id) {
    _prev(id);
    updateWelcomeHeader(id);
  };
  document.addEventListener('DOMContentLoaded', () => {
    updateWelcomeHeader(_activeAgentId);
  });
})();


/* ════════════════════════════════════════════════════════════
   AGENT-AWARE PROMPT TEMPLATES  (replaces generic PROMPT_TEMPLATES)
   ════════════════════════════════════════════════════════════ */
const AGENT_TEMPLATES = {

  default: {
    'Career': [
      {title:'Career Roadmap',      prompt:'Build me a complete career roadmap to become a [JOB TITLE] — skills to learn, timeline, certifications, and first steps.'},
      {title:'Resume Review',       prompt:'Review my resume for a [JOB TITLE] role and suggest specific improvements:\n\n[PASTE RESUME]'},
      {title:'Interview Prep',      prompt:'Prepare me for a [JOB TITLE] interview at [COMPANY]. Give me the 10 most likely questions with ideal answers.'},
      {title:'Career Switch',       prompt:'I want to transition from [CURRENT ROLE] to [TARGET ROLE]. What skills do I need, how long will it take, and what\'s the best path?'},
    ],
    'Writing': [
      {title:'Cover Letter',        prompt:'Write a compelling cover letter for a [JOB TITLE] role at [COMPANY]. My background: [BRIEF BACKGROUND].'},
      {title:'Professional Email',  prompt:'Write a professional email to [RECIPIENT] about [TOPIC]. Tone: [formal/friendly]. Key points: [POINTS].'},
      {title:'Essay / Report',      prompt:'Write a well-structured essay on [TOPIC]. Include: introduction, 3 main arguments with evidence, and a strong conclusion.'},
      {title:'Improve My Writing',  prompt:'Improve this text for clarity, conciseness, and impact while keeping my voice:\n\n[PASTE TEXT]'},
    ],
    'Learning': [
      {title:'Learning Plan',       prompt:'Create a structured 3-month learning plan to master [SKILL/TOPIC] from beginner to job-ready.'},
      {title:'Concept Explained',   prompt:'Explain [CONCEPT] in simple terms with a real-world analogy, then go deeper for someone who wants to truly understand it.'},
      {title:'Study Guide',         prompt:'Create a comprehensive study guide for [SUBJECT/EXAM] with key concepts, common pitfalls, and practice questions.'},
      {title:'Compare Options',     prompt:'Compare [OPTION A] vs [OPTION B] for [USE CASE] — pros, cons, when to choose each, and a clear recommendation.'},
    ],
    'Productivity': [
      {title:'Brainstorm Ideas',    prompt:'Brainstorm 10 creative ideas for [PROBLEM/PROJECT]. Push beyond the obvious — I want unexpected angles.'},
      {title:'Decision Framework',  prompt:'Help me decide between [OPTION A] and [OPTION B]. Factors I care about: [FACTORS]. Lay out a clear framework.'},
      {title:'Summarize',           prompt:'Summarize this in 5 bullet points, each under 2 sentences. Focus on the most important takeaways:\n\n[PASTE CONTENT]'},
      {title:'Action Plan',         prompt:'Turn this goal into a concrete 30-day action plan with daily/weekly milestones:\n\nGoal: [YOUR GOAL]'},
    ],
  },

  research: {
    'Literature': [
      {title:'Literature Review',   prompt:'Conduct a comprehensive literature review on [TOPIC]. Cover: foundational work, current state-of-the-art, competing approaches, and key open problems. Include influential citations.'},
      {title:'State of the Art',    prompt:'What is the current state of the art for [TASK/PROBLEM]? Summarize the top 5 methods, their benchmarks, and what distinguishes each.'},
      {title:'Related Work',        prompt:'Help me write a related work section for a paper on [TOPIC]. Group prior work by theme, highlight how each connects to my contribution, and note what my work does differently.'},
      {title:'Paper Summary',       prompt:'Summarize this paper for me: [TITLE or PASTE ABSTRACT]. Extract: contribution, method, results, limitations, and what I should read next.'},
    ],
    'Analysis': [
      {title:'Paper Critique',      prompt:'Critically evaluate this research: [PASTE TITLE/ABSTRACT/APPROACH]. Assess: novelty, methodology rigor, experimental validity, overlooked limitations, and reproducibility.'},
      {title:'Gap Analysis',        prompt:'Identify the research gaps in [FIELD/TOPIC]. What remains unsolved? Where do current methods fail or make questionable assumptions? Suggest 3 specific novel research questions.'},
      {title:'Claim Evaluation',    prompt:'Evaluate this research claim: "[CLAIM]". What evidence supports it? What would contradict it? How strong is the current evidence? Are there alternative explanations?'},
      {title:'Compare Methods',     prompt:'Compare these research approaches to [PROBLEM]: [METHOD A] vs [METHOD B]. Analyze tradeoffs in assumptions, scalability, evaluation, and applicability.'},
    ],
    'Methodology': [
      {title:'Hypothesis Generator',prompt:'Generate 5 testable research hypotheses about [TOPIC]. For each: state it precisely, give the theoretical basis, describe the test, and identify what would falsify it.'},
      {title:'Experiment Design',   prompt:'Design a rigorous experiment to test: [HYPOTHESIS]. Include: baselines, metrics, dataset splits, statistical tests, ablations, and confounds to control for.'},
      {title:'Study Design',        prompt:'Design a [quantitative/qualitative/mixed] study to investigate [RESEARCH QUESTION]. Cover: participants, instruments, procedure, analysis plan, and ethical considerations.'},
      {title:'Methodology Section', prompt:'Write a rigorous methodology section for research on [TOPIC] using [APPROACH]. Justify each design choice and anticipate reviewer questions about validity and reproducibility.'},
    ],
    'Academic Writing': [
      {title:'Abstract Writer',     prompt:'Write an academic abstract for my paper. Problem: [PROBLEM]. Method: [METHOD]. Results: [RESULTS]. Follow IMRaD, 150–250 words, lead with contribution.'},
      {title:'Introduction',        prompt:'Write a compelling introduction for my paper on [TOPIC]. Hook the reader, establish the problem, survey what\'s been tried, identify the gap, then state my contribution.'},
      {title:'Reviewer Rebuttal',   prompt:'Help me respond to this reviewer comment: [PASTE COMMENT]. Acknowledge valid points, counter invalid ones with evidence, propose concrete changes, and stay professional.'},
      {title:'Discussion Section',  prompt:'Write a discussion section for my paper. Results: [RESULTS]. Interpret them in context of [PRIOR WORK], acknowledge limitations, and suggest future directions.'},
    ],
  },

  ml: {
    'Architecture': [
      {title:'Explain from Scratch', prompt:'Explain [MODEL/ALGORITHM] from first principles — intuition first, then math, then implementation in PyTorch. Include a minimal working example.'},
      {title:'Model Comparison',     prompt:'Compare [MODEL A] vs [MODEL B] for [TASK]. Cover: architecture differences, inductive biases, computational cost, when to use each, and empirical tradeoffs.'},
      {title:'Design Architecture',  prompt:'Help me design a neural network architecture for [TASK]. Input: [INPUT DESC]. Output: [OUTPUT DESC]. Constraints: [CONSTRAINTS]. Suggest and justify the design.'},
      {title:'Attention Mechanism',  prompt:'Explain multi-head self-attention in transformers from scratch. Include the math, why it works, computational complexity, and a PyTorch implementation.'},
    ],
    'Training': [
      {title:'Debug Convergence',    prompt:'My model is not converging properly: [DESCRIBE SYMPTOMS — loss curve, metrics]. Architecture: [BRIEF DESC]. Help me systematically diagnose and fix it.'},
      {title:'Loss Analysis',        prompt:'My training loss is [DESCRIBE: oscillating/not decreasing/diverging]. Learning rate: [LR]. Batch size: [BS]. What could be wrong and how do I fix it?'},
      {title:'Hyperparameter Tune',  prompt:'Suggest a principled hyperparameter tuning strategy for [MODEL TYPE] on [TASK]. What to tune first, what ranges, and which search method to use.'},
      {title:'Optimizer Choice',     prompt:'Compare Adam vs AdamW vs SGD with momentum for [USE CASE: fine-tuning LLM / training from scratch / small dataset]. When should I use each?'},
    ],
    'Implementation': [
      {title:'Implement Model',      prompt:'Implement [MODEL NAME] from scratch in PyTorch. Include: model class, forward pass, training loop, evaluation, and brief explanation of each component.'},
      {title:'Training Pipeline',    prompt:'Write a clean, production-quality PyTorch training pipeline for [TASK]. Include: data loading, model, optimizer, scheduler, checkpointing, and metrics logging.'},
      {title:'Data Pipeline',        prompt:'Build an efficient data loading pipeline in PyTorch for [DATA TYPE/TASK]. Handle: preprocessing, augmentation, batching, and performance optimization.'},
      {title:'Fine-tuning Guide',    prompt:'Walk me through fine-tuning [PRETRAINED MODEL] on [TASK/DATASET]. Cover: what layers to freeze, learning rate, batch size, overfitting prevention, and evaluation.'},
    ],
    'Deployment': [
      {title:'Optimize Inference',   prompt:'How do I reduce inference latency for [MODEL] in production? I need [TARGET LATENCY] on [HARDWARE]. Cover: quantization, distillation, batching, and caching strategies.'},
      {title:'MLOps Pipeline',       prompt:'Design a production ML pipeline for [USE CASE]. Include: data ingestion, feature store, training, evaluation, deployment, monitoring, and drift detection.'},
      {title:'Model Evaluation',     prompt:'Design a rigorous evaluation framework for [TASK]. What metrics matter beyond accuracy? How do I test for robustness, fairness, and distribution shift?'},
      {title:'Scaling Strategy',     prompt:'I need to scale [MODEL/SYSTEM] from [CURRENT SCALE] to [TARGET SCALE]. What are the bottlenecks and what distributed training/serving strategies should I use?'},
    ],
  },

  devil: {
    'Challenge Ideas': [
      {title:'Challenge My Claim',   prompt:'Challenge this claim as strongly as possible: "[PASTE YOUR CLAIM OR BELIEF]". Find every logical flaw, weak assumption, and piece of contradicting evidence.'},
      {title:'Stress-Test Idea',     prompt:'Here is my idea: [DESCRIBE IDEA]. Act as the harshest critic. What assumptions am I making? What could go wrong? What would cause this to fail completely?'},
      {title:'Find the Flaws',       prompt:'Find every flaw in this argument: [PASTE ARGUMENT]. Look for: logical fallacies, unsupported assumptions, missing evidence, cherry-picked data, and weak causal claims.'},
      {title:'Best Counterargument', prompt:'What is the strongest possible counterargument to the position that [POSITION]? Steelman the opposition — give me the argument even they might not have articulated.'},
    ],
    'Debate Positions': [
      {title:'Debate: AI Claims',    prompt:'Challenge this AI-related claim: "[AI CLAIM]". What evidence contradicts it? What nuances is it ignoring? What would actually need to be true for it to hold?'},
      {title:'Debate: Tech Choices', prompt:'Challenge my technical decision: I chose [TECHNOLOGY/APPROACH] for [REASON]. Why might this be wrong? What am I overlooking? What would a skeptic say?'},
      {title:'Debate: Research',     prompt:'Push back on this research claim: "[RESEARCH CLAIM]". Is the evidence strong enough? Are there confounds? Could the effect be explained differently?'},
      {title:'Both Sides',           prompt:'Give me the strongest argument FOR and AGAINST [POSITION/DECISION]. Then tell me which side has stronger evidence and why.'},
    ],
    'Expose Assumptions': [
      {title:'Hidden Assumptions',   prompt:'What hidden assumptions am I making when I say: "[YOUR STATEMENT]"? List every assumption, rank them by how likely they are to be wrong, and suggest how to test them.'},
      {title:'Startup Critique',     prompt:'Tear apart this startup idea: [DESCRIBE IDEA]. What assumptions does it rest on? Who else has tried this? What would kill it in year 1? Be brutally honest.'},
      {title:'Plan Weaknesses',      prompt:'Find the weaknesses in this plan: [DESCRIBE PLAN]. What is most likely to go wrong? What dependencies are fragile? What have I not accounted for?'},
      {title:'Question My Logic',    prompt:'I believe [BELIEF] because [REASONING]. What is wrong with my reasoning? What am I missing? What would change my mind if I were thinking clearly?'},
    ],
  },

  tutor: {
    'Explore Concepts': [
      {title:'Explore Deeply',       prompt:'I want to deeply understand [CONCEPT]. Start from intuition — no jargon. Then build up step by step. Ask me questions along the way to check my understanding.'},
      {title:'Why Does It Work?',    prompt:'I understand what [CONCEPT/METHOD] does, but I don\'t understand WHY it works. Guide me to discover the deep reason — don\'t just tell me, ask me questions.'},
      {title:'Intuition First',      prompt:'Build my intuition for [MATHEMATICAL/TECHNICAL CONCEPT] before showing me any equations. Use analogies, pictures in words, and examples from everyday life.'},
      {title:'Challenge My Understanding', prompt:'I think I understand [CONCEPT]. Test me — ask me questions that probe my understanding, identify my gaps, and guide me to fill them without giving me the answer directly.'},
    ],
    'Guided Discovery': [
      {title:'Guide Me Through',     prompt:'Walk me through understanding [TOPIC] using the Socratic method. I\'ll share what I know first: [BRIEF WHAT YOU KNOW]. Find the gaps and guide me to fill them.'},
      {title:'Step by Step',         prompt:'I\'m stuck on [SPECIFIC PROBLEM/CONCEPT]. Don\'t solve it for me — ask me one question at a time that guides me toward the solution.'},
      {title:'Build From Basics',    prompt:'I want to understand [ADVANCED TOPIC]. Start from the most basic prerequisite knowledge and guide me through each layer. Check my understanding before moving on.'},
      {title:'Trace an Example',     prompt:'Walk me through one concrete example of [PROCESS/ALGORITHM] step by step. After each step, ask me to predict what comes next before you reveal it.'},
    ],
    'Deepen Knowledge': [
      {title:'Unpack Jargon',        prompt:'I keep hearing the term "[TERM/CONCEPT]" but I don\'t really understand what it means. Don\'t define it — ask me questions that help me construct the definition myself.'},
      {title:'Connect the Dots',     prompt:'Help me see the connection between [CONCEPT A] and [CONCEPT B]. I understand each separately but can\'t see how they relate. Guide me to discover the link.'},
      {title:'Why Is This Hard?',    prompt:'Why do people find [CONCEPT/TOPIC] difficult to understand? What are the most common misconceptions? Guide me to avoid them.'},
      {title:'Test My Limits',       prompt:'I feel confident about [TOPIC]. Push me to the edge of my understanding — ask increasingly harder questions until I reach what I don\'t yet know.'},
    ],
  },

  code: {
    'Code Review': [
      {title:'Full Review',          prompt:'Review this code thoroughly for correctness, efficiency, readability, security, and best practices. Be specific — reference exact issues:\n\n```\n[PASTE CODE]\n```'},
      {title:'Logic Review',         prompt:'Check this code for logic errors, edge cases I might have missed, and incorrect assumptions:\n\n```\n[PASTE CODE]\n```'},
      {title:'API Design Review',    prompt:'Review this API design for usability, consistency, and best practices:\n\n```\n[PASTE API CODE / ROUTES / SPEC]\n```'},
      {title:'PR Review',            prompt:'Review this diff as if you\'re doing a code review. Focus on what matters most — correctness, risks, and anything a reviewer would flag:\n\n```diff\n[PASTE DIFF]\n```'},
    ],
    'Refactor': [
      {title:'Refactor for Clarity', prompt:'Refactor this code to be cleaner and more readable without changing behavior. Explain each change:\n\n```\n[PASTE CODE]\n```'},
      {title:'Break Down Function',  prompt:'This function is too long and does too much. Help me break it into smaller, well-named pieces:\n\n```\n[PASTE FUNCTION]\n```'},
      {title:'Remove Duplication',   prompt:'Find and eliminate duplication in this codebase. Show the before and after:\n\n```\n[PASTE CODE]\n```'},
      {title:'Apply Design Pattern', prompt:'Which design pattern(s) would improve this code and why? Show me the refactored version:\n\n```\n[PASTE CODE]\n```'},
    ],
    'Testing': [
      {title:'Write Unit Tests',     prompt:'Write comprehensive unit tests for this code. Cover: happy path, edge cases, error conditions, and boundary values. Use [pytest/jest/mocha]:\n\n```\n[PASTE CODE]\n```'},
      {title:'Find Missing Tests',   prompt:'What test cases am I missing for this code? List every scenario that should be tested but isn\'t:\n\n```\n[PASTE CODE + EXISTING TESTS]\n```'},
      {title:'Test Edge Cases',      prompt:'What are all the edge cases and failure modes for this function? For each, tell me what should happen:\n\n```\n[PASTE CODE]\n```'},
      {title:'Mock Strategy',        prompt:'How should I mock the external dependencies in this code for testing? Show me the test setup:\n\n```\n[PASTE CODE]\n```'},
    ],
    'Security & Performance': [
      {title:'Security Audit',       prompt:'Audit this code for security vulnerabilities — injection, auth issues, data exposure, logic flaws. For each issue, explain the risk and the fix:\n\n```\n[PASTE CODE]\n```'},
      {title:'Performance Optimize', prompt:'This code is too slow. Profile it mentally, identify the bottlenecks, and suggest optimizations with complexity analysis:\n\n```\n[PASTE CODE]\n```'},
      {title:'SQL Injection Check',  prompt:'Check this database code for SQL injection vulnerabilities and other DB security issues:\n\n```\n[PASTE CODE]\n```'},
      {title:'Memory & Leaks',       prompt:'Analyze this code for memory leaks, excessive allocations, and resource management issues:\n\n```\n[PASTE CODE]\n```'},
    ],
  },
};

/* Sync PROMPT_TEMPLATES to match active agent */
function syncTemplatesToAgent(agentId) {
  const id  = agentId || _activeAgentId || 'default';
  const src = AGENT_TEMPLATES[id] || AGENT_TEMPLATES['default'];
  // Mutate the existing PROMPT_TEMPLATES object so all existing render functions work
  Object.keys(PROMPT_TEMPLATES).forEach(k => delete PROMPT_TEMPLATES[k]);
  Object.assign(PROMPT_TEMPLATES, src);
  _templatesCategory = Object.keys(src)[0];
}

/* Patch openTemplates to sync first */
(function() {
  const _orig = openTemplates;
  openTemplates = function() {
    syncTemplatesToAgent(_activeAgentId);
    _orig();
  };
})();

/* Also sync whenever agent changes */
(function() {
  const _prev = setActiveAgent;
  setActiveAgent = function(id) {
    _prev(id);
    syncTemplatesToAgent(id);
  };
})();


/* ════════════════════════════════════════════════════════════
   FIX: templates panel closes when clicking category tabs
   Root cause: renderTemplateCategories() replaces innerHTML,
   removing the clicked element from DOM before the click
   bubbles to the outside-click handler, causing a false positive.
   ════════════════════════════════════════════════════════════ */
let _preventTemplatesClose = false;

/* Patch closeTemplates to respect the guard flag */
(function() {
  const _origClose = closeTemplates;
  closeTemplates = function() {
    if (_preventTemplatesClose) return;
    _origClose();
  };
})();

/* Patch selectTemplateCategory to set the flag before re-rendering */
(function() {
  const _origSelect = selectTemplateCategory;
  selectTemplateCategory = function(cat) {
    _preventTemplatesClose = true;
    _origSelect(cat);
    /* Reset after the click has fully bubbled */
    setTimeout(() => { _preventTemplatesClose = false; }, 50);
  };
})();


/* ════════════════════════════════════════════════════════════
   FEATURE: ENHANCED SIDEBAR SEARCH WITH MESSAGE SNIPPETS
   ════════════════════════════════════════════════════════════ */
(function() {
  const _origRender = renderSidebar;
  renderSidebar = function(filterQ = '') {
    if (!filterQ || !filterQ.trim()) {
      return _origRender.call(this, filterQ);
    }

    const list = document.getElementById('convList');
    const q = filterQ.toLowerCase();

    const matched = conversations.map(c => {
      // Find first matching message snippet
      let snippet = null;
      for (const m of c.messages) {
        const idx = m.text.toLowerCase().indexOf(q);
        if (idx !== -1) {
          const start = Math.max(0, idx - 30);
          const raw = m.text.substring(start, idx + q.length + 50).replace(/\n/g, ' ');
          // Highlight match
          const hiRaw = raw.replace(new RegExp(`(${filterQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
            '<mark>$1</mark>');
          snippet = (start > 0 ? '…' : '') + hiRaw + (raw.length < m.text.length ? '…' : '');
          break;
        }
      }
      const titleMatch = c.title.toLowerCase().includes(q);
      if (!titleMatch && !snippet) return null;
      return { c, snippet };
    }).filter(Boolean);

    if (matched.length === 0) {
      list.innerHTML = `<div class="conv-empty"><div class="conv-empty-icon">🔍</div>No results found</div>`;
      return;
    }

    list.innerHTML = matched.map(({ c, snippet }) => {
      const isActive = c.id === activeId;
      const hiTitle = c.title.replace(new RegExp(`(${filterQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
        '<mark>$1</mark>');
      return `
        <div class="conv-item ${isActive ? 'active' : ''}" data-id="${c.id}"
             onclick="loadConv('${c.id}')" ondblclick="openRename('${c.id}')">
          <div class="conv-item-text">${hiTitle}</div>
          ${snippet ? `<div class="conv-snippet">${snippet}</div>` : ''}
          <div class="conv-item-actions">
            <button class="conv-action-btn" title="Rename"
                    onclick="event.stopPropagation();openRename('${c.id}')">✏️</button>
            <button class="conv-action-btn delete-btn" title="Delete"
                    onclick="event.stopPropagation();deleteConv('${c.id}')">🗑</button>
          </div>
        </div>`;
    }).join('');
  };
})();


/* ════════════════════════════════════════════════════════════
   FEATURE: EXPORT CHAT
   ════════════════════════════════════════════════════════════ */
function toggleExportMenu() {
  const menu = document.getElementById('exportMenu');
  const isHidden = menu.style.display === 'none' || !menu.style.display;
  // Close all dropdowns first
  document.querySelectorAll('.export-menu').forEach(m => m.style.display = 'none');
  menu.style.display = isHidden ? 'block' : 'none';
}

// Close export menu when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('#exportWrap')) {
    const menu = document.getElementById('exportMenu');
    if (menu) menu.style.display = 'none';
  }
});

function exportMarkdown() {
  document.getElementById('exportMenu').style.display = 'none';
  const conv = activeId ? getConv(activeId) : null;
  if (!conv || conv.messages.length === 0) {
    alert('No conversation to export.');
    return;
  }
  const date = new Date(conv.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  let md = `# ${conv.title}\n\n_Exported from Orion AI · ${date}_\n\n---\n\n`;
  conv.messages.forEach(m => {
    if (m.role === 'user') {
      md += `**You:** ${m.text}\n\n`;
    } else {
      md += `**Orion:**\n\n${m.text}\n\n---\n\n`;
    }
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  document.getElementById('exportMenu').style.display = 'none';
  const conv = activeId ? getConv(activeId) : null;
  if (!conv || conv.messages.length === 0) {
    alert('No conversation to export.');
    return;
  }
  // Add a print title then trigger print
  const title = document.createElement('div');
  title.id = 'print-title-bar';
  title.style.cssText = 'font-size:1.1rem;font-weight:700;padding:0 0 8px;margin-bottom:12px;border-bottom:2px solid #6366f1;color:#111;';
  title.textContent = conv.title;
  const msgs = document.getElementById('messages');
  msgs.insertBefore(title, msgs.firstChild);
  window.print();
  title.remove();
}


/* ════════════════════════════════════════════════════════════
   FEATURE: PINNED / STARRED MESSAGES
   ════════════════════════════════════════════════════════════ */
let _pins = JSON.parse(localStorage.getItem('orion_pins') || '[]');

function savePins() {
  localStorage.setItem('orion_pins', JSON.stringify(_pins));
  updatePinsBadge();
}

function updatePinsBadge() {
  const badge = document.getElementById('pinsBadge');
  if (!badge) return;
  if (_pins.length === 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'flex';
    badge.textContent = _pins.length;
  }
}

function pinMessage(convId, msgIndex, text) {
  const conv = getConv(convId);
  const convTitle = conv ? conv.title : 'Unknown';
  const existing = _pins.findIndex(p => p.convId === convId && p.msgIndex === msgIndex);
  if (existing !== -1) {
    _pins.splice(existing, 1); // unpin if already pinned
  } else {
    _pins.unshift({ convId, msgIndex, text, convTitle, ts: Date.now() });
  }
  savePins();
  return existing === -1; // true = newly pinned
}

function isPinned(convId, msgIndex) {
  return _pins.some(p => p.convId === convId && p.msgIndex === msgIndex);
}

function unpinFromPanel(convId, msgIndex) {
  _pins = _pins.filter(p => !(p.convId === convId && p.msgIndex === msgIndex));
  savePins();
  renderPinsPanel();
  // Update star button in DOM if it's visible
  const starBtn = document.querySelector(`.pin-btn[data-conv="${convId}"][data-idx="${msgIndex}"]`);
  if (starBtn) {
    starBtn.classList.remove('pinned');
    starBtn.title = 'Star message';
    starBtn.textContent = '☆';
  }
}

function togglePinsPanel() {
  const panel = document.getElementById('pinsPanel');
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) renderPinsPanel();
}

function renderPinsPanel() {
  const body = document.getElementById('pinsPanelBody');
  if (!body) return;
  if (_pins.length === 0) {
    body.innerHTML = `<div class="pins-empty">⭐ No starred messages yet.<br><span style="font-size:0.75rem;color:var(--text3)">Hover any AI response and click ☆ to star it.</span></div>`;
    return;
  }
  body.innerHTML = _pins.map((p, i) => `
    <div class="pin-card" onclick="loadConv('${p.convId}')">
      <div class="pin-card-conv">${escHtml(p.convTitle)}</div>
      <div class="pin-card-text">${escHtml(p.text.substring(0, 220))}${p.text.length > 220 ? '…' : ''}</div>
      <div class="pin-card-actions">
        <button class="pin-card-unpin" onclick="event.stopPropagation();unpinFromPanel('${p.convId}',${p.msgIndex})">✕ Unstar</button>
      </div>
    </div>
  `).join('');
}

// Patch appendMsgDOM to inject star button into AI messages
(function() {
  const _origAppend = appendMsgDOM;
  appendMsgDOM = function(msg) {
    _origAppend.call(this, msg);
    if (msg.role !== 'ai') return;
    // Find the last AI row and add star button
    const container = document.getElementById('messages');
    const allRows = container.querySelectorAll('.msg-row.ai');
    const row = allRows[allRows.length - 1];
    if (!row) return;
    const actionsEl = row.querySelector('.msg-actions');
    if (!actionsEl) return;
    const conv = getConv(activeId);
    if (!conv) return;
    const msgIndex = conv.messages.indexOf(msg);
    addStarButton(actionsEl, activeId, msgIndex, msg.text);
  };
})();

function addStarButton(actionsEl, convId, msgIndex, text) {
  const already = actionsEl.querySelector('.pin-btn');
  if (already) return;
  const pinned = isPinned(convId, msgIndex);
  const btn = document.createElement('button');
  btn.className = `msg-action-btn pin-btn${pinned ? ' pinned' : ''}`;
  btn.dataset.conv = convId;
  btn.dataset.idx = msgIndex;
  btn.title = pinned ? 'Unstar message' : 'Star message';
  btn.textContent = pinned ? '⭐' : '☆';
  btn.onclick = () => {
    const nowPinned = pinMessage(convId, msgIndex, text);
    btn.textContent = nowPinned ? '⭐' : '☆';
    btn.title = nowPinned ? 'Unstar message' : 'Star message';
    btn.classList.toggle('pinned', nowPinned);
    if (document.getElementById('pinsPanel').style.display !== 'none') renderPinsPanel();
  };
  actionsEl.appendChild(btn);
}

// Init badge on load
updatePinsBadge();


/* ════════════════════════════════════════════════════════════
   FEATURE: FOLLOW-UP QUESTION SUGGESTIONS
   ════════════════════════════════════════════════════════════ */
async function generateFollowUps(aiText, convId) {
  const apiKey  = getApiKey();
  const provider = getProvider();
  if (!apiKey) return null;
  // Only OpenAI-compatible endpoints supported for follow-ups
  if (provider !== 'groq' && provider !== 'openai') return null;

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini';

  const prompt = `Based on this AI response, write exactly 3 short follow-up questions a user might ask next. Each on its own line, no numbering, no bullet points, keep each under 12 words:\n\n${aiText.substring(0, 600)}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
        temperature: 0.7,
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    return raw.split('\n').map(l => l.trim().replace(/^[-*\d.]+\s*/, '')).filter(l => l.length > 5).slice(0, 3);
  } catch { return null; }
}

function renderFollowUps(questions) {
  if (!questions || questions.length === 0) return;
  const container = document.getElementById('messages');
  const row = document.createElement('div');
  row.className = 'followup-row';
  row.innerHTML = questions.map(q => `
    <button class="followup-chip" data-q="${escHtml(q)}" onclick="sendFollowUp(this)">
      ${escHtml(q)}
    </button>
  `).join('');
  container.appendChild(row);
  scrollBottom(false);
}

function sendFollowUp(btn) {
  const question = btn.getAttribute('data-q');
  // Remove the follow-up row
  const row = btn.closest('.followup-row');
  if (row) row.remove();
  // Populate and send
  const input = document.getElementById('msgInput');
  if (input) {
    input.value = question;
    autoResize(input);
  }
  sendMessage();
}

// Wrap beginAIResponse to inject follow-ups after response
(function() {
  const _prev = beginAIResponse;
  beginAIResponse = async function(convId) {
    await _prev.call(this, convId);
    // Remove any existing follow-up row first
    document.querySelectorAll('.followup-row').forEach(r => r.remove());
    // Get last AI message
    const conv = getConv(convId);
    if (!conv || !conv.messages.length) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'ai' || !last.text) return;
    // Also add star button to the streaming row (last AI row in DOM)
    const msgs = document.getElementById('messages');
    const allAI = msgs.querySelectorAll('.msg-row.ai');
    const lastRow = allAI[allAI.length - 1];
    if (lastRow) {
      const actEl = lastRow.querySelector('.msg-actions');
      if (actEl) {
        const msgIdx = conv.messages.length - 1;
        addStarButton(actEl, convId, msgIdx, last.text);
      }
    }
    // Generate and render follow-ups
    generateFollowUps(last.text, convId).then(qs => renderFollowUps(qs));
  };
})();



/* ════════════════════════════════════════════════════════════

/* === AGENTS SECTION COLLAPSE TOGGLE === */
var _agentsCollapsed = true;  // extra agents hidden by default

function toggleAgentsCollapse() {
  _agentsCollapsed = !_agentsCollapsed;
  var extra = document.getElementById('agentsExtra');
  var chevron = document.getElementById('agentsChevron');
  if (extra) extra.style.display = _agentsCollapsed ? 'none' : 'block';
  if (chevron) chevron.style.transform = _agentsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

/* ══════════════════════════════════════════════════════════════════
   SETTINGS PANEL  (overrides old openSettings / closeSettings)
══════════════════════════════════════════════════════════════════ */

function _openSettingsPanel() {
  document.getElementById('settingsPanel').classList.add('open');
  document.getElementById('settingsBackdrop').classList.add('open');

  // Restore AI provider
  const sel = document.getElementById('providerSelect');
  if (sel) { sel.value = getProvider(); updateProviderHint(); }

  // Restore API key (masked)
  const ki = document.getElementById('apiKeyInput');
  if (ki) ki.value = getApiKey() ? '••••••••' : '';

  // Restore search key (masked)
  const ski = document.getElementById('searchKeyInput');
  if (ski) ski.value = getSearchKey() ? '••••••••' : '';

  // Restore image OpenAI key (masked)
  const oki = document.getElementById('imageOpenAIKeyInput');
  if (oki) oki.value = _getImageKey() ? '••••••••' : '';

  // Restore voice settings
  const vot = document.getElementById('voiceOutputToggle');
  if (vot) vot.checked = localStorage.getItem('orion_voice_output') === 'true';
  const vspeed = document.getElementById('voiceSpeed');
  if (vspeed) { vspeed.value = localStorage.getItem('orion_voice_speed') || '1'; updateVoiceSpeedLabel(); }
  populateVoiceList();

  // Restore image gen settings
  const igt = document.getElementById('imageGenToggle');
  if (igt) igt.checked = localStorage.getItem('orion_image_gen') !== 'false';
  const igs = document.getElementById('imageGenSize');
  if (igs) igs.value = localStorage.getItem('orion_image_size') || '1024x1024';
  const igst = document.getElementById('imageGenStyle');
  if (igst) igst.value = localStorage.getItem('orion_image_style') || 'vivid';

  // Restore font size
  const fss = document.getElementById('fontSizeSelect');
  if (fss) fss.value = localStorage.getItem('orion_font_size') || '15';

  updateThemeSubLabel();
  document.addEventListener('keydown', _spEsc);
}

function _closeSettingsPanel() {
  document.getElementById('settingsPanel').classList.remove('open');
  document.getElementById('settingsBackdrop').classList.remove('open');
  const st = document.getElementById('settingsStatus');
  if (st) { st.textContent = ''; st.className = 'settings-status'; }
  document.removeEventListener('keydown', _spEsc);
}

function _spEsc(e) { if (e.key === 'Escape') closeSettings(); }

function switchSettingsTab(tab) {
  ['general','ai','voice','image','search'].forEach(t => {
    const sec = document.getElementById('stab-' + t);
    const btn = document.getElementById('stab-btn-' + t);
    if (sec) sec.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

function updateThemeSubLabel() {
  const el = document.getElementById('themeSubLabel');
  if (!el) return;
  el.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Dark mode' : 'Light mode';
}

function changeFontSize(size) {
  localStorage.setItem('orion_font_size', size);
  document.documentElement.style.setProperty('--chat-font-size', size + 'px');
  document.querySelectorAll('.msg-content').forEach(el => el.style.fontSize = size + 'px');
}

function saveSearchKey() {
  const raw = document.getElementById('searchKeyInput')?.value.trim();
  if (!raw || raw.startsWith('•')) return;
  localStorage.setItem('orion_search_key', raw);
  const st = document.getElementById('settingsStatus');
  if (st) { st.textContent = '✓ Search key saved!'; st.className = 'settings-status ok'; }
  setTimeout(() => { if (st) { st.textContent = ''; st.className = 'settings-status'; } }, 2000);
}

/* ══════════════════════════════════════════════════════════════════
   VOICE INPUT — Speech-to-Text (Web Speech API)
══════════════════════════════════════════════════════════════════ */
let _recognition = null;
let _voiceActive  = false;

function toggleVoiceInput() {
  _voiceActive ? stopVoiceInput() : startVoiceInput();
}

function startVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Voice input requires Chrome or Edge. Please open this page in Chrome.');
    return;
  }
  _recognition = new SR();
  _recognition.continuous    = false;
  _recognition.interimResults = true;
  _recognition.lang          = 'en-US';

  _recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    const inp = document.getElementById('msgInput');
    if (inp) { inp.value = transcript; autoResize(inp); }
    if (e.results[e.results.length - 1].isFinal) {
      stopVoiceInput();
      setTimeout(() => sendMessage(), 350);
    }
  };
  _recognition.onerror = () => stopVoiceInput();
  _recognition.onend   = () => stopVoiceInput();

  _voiceActive = true;
  document.getElementById('micBtn')?.classList.add('recording');
  const inp = document.getElementById('msgInput');
  if (inp) { inp.placeholder = '🎙 Listening…'; inp.focus(); }
  _recognition.start();
}

function stopVoiceInput() {
  _voiceActive = false;
  try { _recognition?.stop(); } catch(_) {}
  _recognition = null;
  document.getElementById('micBtn')?.classList.remove('recording');
  const inp = document.getElementById('msgInput');
  if (inp) inp.placeholder = 'Message Orion…';
}

/* ══════════════════════════════════════════════════════════════════
   VOICE OUTPUT — Text-to-Speech (Web Speech Synthesis)
══════════════════════════════════════════════════════════════════ */

function speakText(text) {
  if (!window.speechSynthesis) return;
  if (localStorage.getItem('orion_voice_output') !== 'true') return;

  window.speechSynthesis.cancel();

  // Strip markdown so TTS reads clean prose
  const clean = text
    .replace(/```[\s\S]*?```/g, 'code block omitted.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .slice(0, 1200);

  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate = parseFloat(localStorage.getItem('orion_voice_speed') || '1');

  const voiceName = localStorage.getItem('orion_voice_name');
  if (voiceName) {
    const v = window.speechSynthesis.getVoices().find(v => v.name === voiceName);
    if (v) utt.voice = v;
  }
  window.speechSynthesis.speak(utt);
}

function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

function populateVoiceList() {
  const sel = document.getElementById('voiceSelect');
  if (!sel || !window.speechSynthesis) return;
  const fill = () => {
    const voices = window.speechSynthesis.getVoices();
    const saved  = localStorage.getItem('orion_voice_name') || '';
    sel.innerHTML = '<option value="">Default</option>';
    voices.filter(v => v.lang.startsWith('en')).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === saved) opt.selected = true;
      sel.appendChild(opt);
    });
  };
  fill();
  // Chrome loads voices async
  if (window.speechSynthesis.onvoiceschanged !== undefined)
    window.speechSynthesis.onvoiceschanged = fill;
}

function saveVoiceSettings() {
  const vot = document.getElementById('voiceOutputToggle');
  const spd = document.getElementById('voiceSpeed');
  const vsel = document.getElementById('voiceSelect');
  if (vot  !== null && vot  !== undefined) localStorage.setItem('orion_voice_output', vot.checked);
  if (spd)  localStorage.setItem('orion_voice_speed', spd.value);
  if (vsel) localStorage.setItem('orion_voice_name',  vsel.value);
}

function updateVoiceSpeedLabel() {
  const val = document.getElementById('voiceSpeed')?.value;
  const lbl = document.getElementById('voiceSpeedLabel');
  if (lbl && val) lbl.textContent = parseFloat(val).toFixed(1) + '×';
}

function testTTS() {
  window.speechSynthesis?.cancel();
  const utt = new SpeechSynthesisUtterance('Hello! I am Orion, your intelligent AI assistant. Voice output is working correctly.');
  utt.rate = parseFloat(localStorage.getItem('orion_voice_speed') || '1');
  const voiceName = localStorage.getItem('orion_voice_name');
  if (voiceName) {
    const v = window.speechSynthesis.getVoices().find(v => v.name === voiceName);
    if (v) utt.voice = v;
  }
  window.speechSynthesis.speak(utt);
}

/* Hook TTS into AI responses — wrap beginAIResponse */
(function() {
  const _orig = beginAIResponse;
  beginAIResponse = async function(convId) {
    await _orig.call(this, convId);
    // After response renders, speak it
    const conv = getConv(convId);
    if (conv?.messages?.length) {
      const last = conv.messages[conv.messages.length - 1];
      if (last?.role === 'ai' && last.text) speakText(last.text);
    }
  };
})();

/* ══════════════════════════════════════════════════════════════════
   IMAGE GENERATION — DALL-E 3
══════════════════════════════════════════════════════════════════ */
const _IMG_PATTERNS = [
  /^(please\s+)?(generate|create|draw|make|paint|design|render|produce)\s+(an?\s+)?(image|picture|photo|illustration|artwork|painting|sketch|portrait|wallpaper|logo|icon|banner|thumbnail)\b/i,
  /^(generate|create|draw|make)\s+me\s+(an?\s+)/i,
  /^(show\s+me\s+an?\s+image\s+of|image\s+of|picture\s+of|photo\s+of)\b/i,
  /\bdall-?e\b/i,
];

function isImageGenRequest(text) {
  if (localStorage.getItem('orion_image_gen') === 'false') return false;
  return _IMG_PATTERNS.some(p => p.test(text.trim()));
}

/* Dedicated OpenAI key for image generation (independent of chat provider) */
function _getImageKey() {
  return localStorage.getItem('orion_image_key') || '';
}
function saveImageKey() {
  const raw = (document.getElementById('imageOpenAIKeyInput')?.value || '').trim();
  if (!raw || raw.startsWith('\u2022')) return;
  localStorage.setItem('orion_image_key', raw);
  const btn = document.getElementById('imageKeySaveBtn');
  if (btn) { btn.textContent = '\u2713 Saved'; setTimeout(() => { btn.textContent = 'Save Key'; }, 1800); }
}

async function handleImageGenRequest(prompt, convId) {
  isTyping  = true;
  stopFlag  = false;
  document.getElementById('sendBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'flex';

  // Show loading row
  const { row, contentEl, actionsEl } = createAIRow();
  contentEl.innerHTML = `
    <div class="img-gen-loading">
      <div class="img-gen-spinner"></div>
      <span>Generating image with DALL-E 3…</span>
    </div>`;
  document.getElementById('messages').appendChild(row);
  scrollBottom(true);

  try {
    // Use dedicated image key, or fall back to main key if it looks like an OpenAI key (sk-...)
    const imageKey = _getImageKey() || (getApiKey().startsWith('sk-') ? getApiKey() : '');

    let imageUrl, revised, generatedBy;

    if (imageKey) {
      const spanEl = contentEl.querySelector('span');
      if (spanEl) spanEl.textContent = 'Generating with DALL-E 3...';
      const size  = localStorage.getItem('orion_image_size')  || '1024x1024';
      const style = localStorage.getItem('orion_image_style') || 'vivid';
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${imageKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size, style, response_format: 'url' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${res.status}`);
      }
      const dalleData = await res.json();
      imageUrl    = dalleData.data[0].url;
      revised     = dalleData.data[0].revised_prompt || prompt;
      generatedBy = 'DALL-E 3';
    } else if (isBackendMode) {
      // Route through Node backend -> Pollinations (avoids CORS from file://)
      const spanEl = contentEl.querySelector('span');
      if (spanEl) spanEl.textContent = 'Generating with Pollinations AI (free)...';
      const token = localStorage.getItem('orion_access_token') || '';
      const r = await fetch(API_BASE + '/ai/image?prompt=' + encodeURIComponent(prompt), {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('Image generation failed (' + r.status + ')');
      const blob = await r.blob();
      imageUrl    = URL.createObjectURL(blob);
      revised     = prompt;
      generatedBy = 'Pollinations AI (free)';
    } else {
      throw new Error('Image generation needs an OpenAI API key or a logged-in account. Please sign in or add your key in Settings.');
    }

    const safeDesc = escHtml(revised.slice(0, 90)) + (revised.length > 90 ? '...' : '');

    if (generatedBy === 'Pollinations AI (free)') {
      contentEl.innerHTML =
        '<div class="img-gen-card">' +
          '<img src="' + imageUrl + '" alt="' + escHtml(prompt) + '" style="width:100%;border-radius:8px">' +
          '<div class="img-gen-card-footer">' +
            '<span class="img-gen-caption">Pollinations AI: ' + safeDesc + '</span>' +
            '<button class="img-gen-download" onclick="_dlImage(\'' + imageUrl + '\')">Download</button>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:0.8rem;color:var(--text3)">Generated by Pollinations AI (free)</div>';
    } else {
      const safeUrl = escHtml(imageUrl);
      contentEl.innerHTML =
        '<div class="img-gen-card">' +
          '<img src="' + safeUrl + '" alt="' + escHtml(prompt) + '" loading="lazy"' +
               ' onerror="this.closest(\'.img-gen-card\').innerHTML=\'<div style=padding:14px;color:#ef4444>Image could not be loaded.</div>\'">' +
          '<div class="img-gen-card-footer">' +
            '<span class="img-gen-caption">DALL-E 3: ' + safeDesc + '</span>' +
            '<button class="img-gen-download" onclick="_dlImage(\'' + safeUrl + '\')">Download</button>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:0.8rem;color:var(--text3)">Generated by DALL-E 3</div>';
    }

    const conv = getConv(convId);
    if (conv) {
      const aiMsg = { role: 'ai', text: '![Generated image](' + imageUrl + ')', ts: Date.now() };
      conv.messages.push(aiMsg);
      if (!isBackendMode) save();
      if (isBackendMode && _pendingUserMsg) {
        saveMessagesToAPI(convId, [_pendingUserMsg, aiMsg]).catch(() => {});
        _pendingUserMsg = null;
      }
    }

    actionsEl.style.display = 'flex';
  } catch (err) {
    contentEl.innerHTML = '<div style="color:#ef4444;font-size:0.85rem;padding:4px 0">Error: ' + escHtml(err.message) + '</div>';
  } finally {
    finishTyping();
    scrollBottom(true);
  }
}

function _dlImage(url) {
  const a = document.createElement('a');
  a.href = url; a.download = 'orion-image.png'; a.target = '_blank';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* Hook image gen into sendMessage */
(function() {
  const _origSend = sendMessage;
  sendMessage = async function() {
    const inp  = document.getElementById('msgInput');
    const text = (inp?.value || '').trim();

    if (text && isImageGenRequest(text) && getApiKey()) {
      inp.value = '';
      autoResize(inp);

      if (!activeId) {
        let conv;
        if (isBackendMode) {
          try { conv = await createConvBackend(text); } catch(_) { conv = createConv(text); }
        } else {
          conv = createConv(text);
        }
        activeId = conv.id;
        hideWelcome();
        renderSidebar();
      }

      const conv = getActive();
      if (!conv) return;

      const userMsg = { role: 'user', text, apiText: text, attachments: [], ts: Date.now() };
      conv.messages.push(userMsg);
      if (!isBackendMode) save();
      _pendingUserMsg = userMsg;

      appendMsgDOM(userMsg);
      scrollBottom(true);
      await handleImageGenRequest(text, conv.id);
      return;
    }

    return _origSend.call(this);
  };
})();
