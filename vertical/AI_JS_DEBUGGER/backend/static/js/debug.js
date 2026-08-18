/**
 * 实时调试功能模块
 * 集成 Monaco Editor 用于代码查看和调试
 */


let monacoEditor = null;
let currentDebugSession = null;
let currentCallStack = [];
let currentVariables = {};
let currentBreakpoint = null;
let debugLogContainer = null;
let pendingDebugLogs = [];
let lastPausedSeq = 0;
let debugPollTimer = null;
let breakpointTriggeredShown = false; // 记录是否已显示"断点已触发"提示
let wsFailureCount = 0; // WebSocket连接失败计数
let pollEnabled = false; // 轮询是否已启用
let wsHealthy = true; // WebSocket连接健康状态
let sessionMetadata = {};
let selectedSessionIds = new Set();
let currentLogSessionId = null;
let stepSnapshots = [];
let currentStepIndex = -1;
let sessionDialogOpen = false;
let analysisSuccessNotified = false;

const SessionLogStore = {
    _store: {},
    _loaded: false,
    _key: 'debugLogsV1',
    load() {
        if (this._loaded) return;
        try {
            const raw = localStorage.getItem(this._key);
            if (raw) this._store = JSON.parse(raw) || {};
        } catch (e) { this._store = {}; }
        this._loaded = true;
    },
    save() {
        try { localStorage.setItem(this._key, JSON.stringify(this._store)); } catch (e) {}
    },
    ensureEntry(sessionId, fallbackName) {
        this.load();
        let changed = false;
        if (!this._store[sessionId]) {
            this._store[sessionId] = {
                name: fallbackName || sessionId,
                logs: '',
                target_url: '',
                created_at: ''
            };
            changed = true;
        }
        if (fallbackName && this._store[sessionId].name !== fallbackName) {
            this._store[sessionId].name = fallbackName;
            changed = true;
        }
        if (changed) this.save();
        return this._store[sessionId];
    },
    append(sessionId, name, text) {
        if (!sessionId || !text) return;
        const entry = this.ensureEntry(sessionId, name);
        entry.logs += text;
        this.save();
    },
    set(sessionId, name, text) {
        const entry = this.ensureEntry(sessionId, name);
        entry.logs = text || '';
        this.save();
    },
    get(sessionId) {
        this.load();
        return this._store[sessionId] || null;
    },
    list() {
        this.load();
        return this._store;
    },
    ensureName(sessionId, name) {
        if (!name) return;
        const entry = this.ensureEntry(sessionId, name);
        if (entry.name !== name) {
            entry.name = name;
            this.save();
        }
    },
    updateMeta(sessionId, meta = {}) {
        const entry = this.ensureEntry(sessionId);
        let changed = false;
        if (meta.name && entry.name !== meta.name) {
            entry.name = meta.name;
            changed = true;
        }
        if (meta.target_url && entry.target_url !== meta.target_url) {
            entry.target_url = meta.target_url;
            changed = true;
        }
        if (meta.created_at && entry.created_at !== meta.created_at) {
            entry.created_at = meta.created_at;
            changed = true;
        }
        if (changed) this.save();
    },
    remove(sessionId) {
        this.load();
        if (this._store[sessionId]) {
            delete this._store[sessionId];
            this.save();
        }
    }
};

const PauseStore = {
    _store: {},
    _loaded: false,
    _key: 'debugSnapshotsV1',
    load() { if (this._loaded) return; try { const raw = localStorage.getItem(this._key); if (raw) this._store = JSON.parse(raw)||{}; } catch(e){ this._store = {}; } this._loaded=true; },
    save() { try { localStorage.setItem(this._key, JSON.stringify(this._store)); } catch(e){} },
    append(sessionId, snap) { this.load(); if (!this._store[sessionId]) this._store[sessionId]=[]; this._store[sessionId].push(snap); if (this._store[sessionId].length>200) this._store[sessionId].shift(); this.save(); },
    list(sessionId){ this.load(); return this._store[sessionId]||[]; }
};

window.onWebSocketConnect = function() {
    console.log('✅ WebSocket已连接（debug模块收到通知）');
    wsFailureCount = 0;
    wsHealthy = true;
    if (pollEnabled) {
        stopPolling(); // WebSocket恢复后停止轮询
    }
};

window.onWebSocketError = function(error) {
    console.warn('❌ WebSocket连接失败（debug模块收到通知）:', error);
    wsFailureCount++;
    wsHealthy = false;
    if (wsFailureCount >= 3 && currentDebugSession && !pollEnabled) {
        startPolling();
    }
};

window.onWebSocketDisconnect = function(reason) {
    console.warn('⚠️ WebSocket已断开（debug模块收到通知）:', reason);
    wsHealthy = false;
    setTimeout(() => {
        if (!wsHealthy && currentDebugSession && !pollEnabled) {
            startPolling();
        }
    }, 10000);
};

function startPolling() {
    if (pollEnabled || debugPollTimer) return;
    console.log('🔄 WebSocket连接异常，启动HTTP轮询兜底机制...');
    if (currentDebugSession) {
        appendDebugLog('⚠️ WebSocket连接异常，切换到轮询模式');
    }
    pollEnabled = true;
    debugPollTimer = setInterval(() => {
        tryFetchLastEvent();
    }, 3000);
}

function stopPolling() {
    if (!pollEnabled || !debugPollTimer) return;
    console.log('✅ WebSocket连接恢复，停止HTTP轮询');
    if (currentDebugSession) {
        appendDebugLog('✅ WebSocket连接已恢复');
    }
    clearInterval(debugPollTimer);
    debugPollTimer = null;
    pollEnabled = false;
}

function getSessionHost(targetUrl, fallback) {
    if (!targetUrl) return fallback || '未命名会话';
    try {
        const urlObj = new URL(targetUrl);
        return urlObj.host || fallback || targetUrl;
    } catch (e) {
        return targetUrl || fallback || '未命名会话';
    }
}

function formatSessionTimestamp(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}.${month} ${hours}:${minutes}`;
}

async function ensureSessionName(sessionId) {
    try {
        const resp = await fetch(`/debug/session/${sessionId}`);
        const json = await resp.json();
        if (!json.success) return;
        const s = json.data || {};
        const url = s.target_url || '';
        const name = `${getSessionHost(url, sessionId)} · ${formatSessionTimestamp(s.created_at || Date.now())}`;
        sessionMetadata[sessionId] = s;
        SessionLogStore.updateMeta(sessionId, {
            name,
            target_url: url,
            created_at: s.created_at || ''
        });
        renderSessionManager();
    } catch (e) {
        console.warn('ensureSessionName failed', e);
    }
}

function setSessionLoadingState(loading) {
    const compact = document.getElementById('session-chip-compact');
    const dialogList = document.getElementById('session-dialog-list');
    [compact, dialogList].forEach((el) => {
        if (el) {
            el.classList.toggle('loading', loading);
        }
    });
}

let sessionListLoading = false;
async function refreshSessionManager() {
    if (sessionListLoading) return;
    try {
        sessionListLoading = true;
        setSessionLoadingState(true);
        const resp = await fetch('/debug/sessions');
        const json = await resp.json();
        if (json.success) {
            sessionMetadata = {};
            const sessions = json.data?.sessions || [];
            sessions.forEach((session) => {
                if (!session.id) return;
                sessionMetadata[session.id] = session;
                const displayName = `${getSessionHost(session.target_url, session.id)} · ${formatSessionTimestamp(session.created_at || session.updated_at)}`;
                SessionLogStore.updateMeta(session.id, {
                    name: displayName,
                    target_url: session.target_url || '',
                    created_at: session.created_at || session.updated_at || ''
                });
            });
        } else {
            throw new Error(json.error || '加载失败');
        }
    } catch (error) {
        console.warn('Failed to refresh sessions:', error);
        if (typeof showNotification === 'function') {
            showNotification('刷新会话列表失败', 'error');
        }
    } finally {
        sessionListLoading = false;
        setSessionLoadingState(false);
        renderSessionManager();
    }
}

function renderSessionManager() {
    const compactContainer = document.getElementById('session-chip-compact');
    const dialogContainer = document.getElementById('session-dialog-list');
    if (!compactContainer || !dialogContainer) return;

    const storeEntries = SessionLogStore.list();
    const entries = Object.entries(storeEntries);

    selectedSessionIds.forEach((id) => {
        if (!storeEntries[id]) {
            selectedSessionIds.delete(id);
        }
    });

    if (currentLogSessionId && !storeEntries[currentLogSessionId]) {
        currentLogSessionId = null;
    }

    if (!entries.length) {
        compactContainer.innerHTML = '<div class="session-chip-empty">暂无会话</div>';
        dialogContainer.innerHTML = '<div class="session-dialog-empty">暂无会话</div>';
        updateBatchDeleteState();
        return;
    }

    const sortedList = entries.slice().sort(([aId, aEntry], [bId, bEntry]) => {
        const metaA = sessionMetadata[aId] || {};
        const metaB = sessionMetadata[bId] || {};
        const tsA = new Date(metaA.created_at || aEntry.created_at || 0).getTime();
        const tsB = new Date(metaB.created_at || bEntry.created_at || 0).getTime();
        return tsB - tsA;
    });

    if (!currentLogSessionId) {
        currentLogSessionId = currentDebugSession || sortedList[0][0];
    }

    const compactHtml = sortedList.slice(0, 3).map(([sid, entry]) => {
        const meta = sessionMetadata[sid] || {};
        const host = getSessionHost(meta.target_url || entry.target_url, entry.name || sid);
        const ts = formatSessionTimestamp(meta.created_at || entry.created_at || Date.now());
        const activeClass = sid === currentLogSessionId ? 'active' : '';
        return `
            <button type="button" class="session-chip compact ${activeClass}" onclick="switchDebugSession('${sid}')">
                <span class="session-chip-title">${escapeHtml(host)}</span>
                <span class="session-chip-meta">${escapeHtml(ts)}</span>
            </button>
        `;
    }).join('');

    compactContainer.innerHTML = compactHtml || '<div class="session-chip-empty">暂无会话</div>';

    const dialogHtml = sortedList.map(([sid, entry]) => {
        const meta = sessionMetadata[sid] || {};
        const host = getSessionHost(meta.target_url || entry.target_url, entry.name || sid);
        const ts = formatSessionTimestamp(meta.created_at || entry.created_at || Date.now());
        const activeClass = sid === currentLogSessionId ? 'active' : '';
        const selectedClass = selectedSessionIds.has(sid) ? 'selected' : '';
        return `
            <div class="session-dialog-item ${activeClass} ${selectedClass}" data-session-id="${sid}">
                <button type="button" class="session-dialog-info" onclick="switchDebugSession('${sid}')">
                    <span class="session-chip-title">${escapeHtml(host)}</span>
                    <span class="session-chip-meta">${escapeHtml(ts)}</span>
                </button>
                <label class="session-dialog-checkbox">
                    <input type="checkbox" ${selectedSessionIds.has(sid) ? 'checked' : ''} onchange="toggleSessionSelection('${sid}', this.checked)">
                </label>
            </div>
        `;
    }).join('');

    dialogContainer.innerHTML = dialogHtml;
    updateBatchDeleteState();
}

function updateBatchDeleteState() {
    const deleteBtn = document.getElementById('session-dialog-delete-btn');
    if (deleteBtn) {
        deleteBtn.disabled = selectedSessionIds.size === 0;
    }
}

function toggleSessionSelection(sessionId, checked) {
    if (checked) {
        selectedSessionIds.add(sessionId);
    } else {
        selectedSessionIds.delete(sessionId);
    }
    renderSessionManager();
}

function selectAllSessions() {
    const storeEntries = SessionLogStore.list();
    selectedSessionIds = new Set(Object.keys(storeEntries));
    renderSessionManager();
}

async function deleteSelectedSessions(skipConfirm = false) {
    if (selectedSessionIds.size === 0) return;
    if (!skipConfirm && !window.confirm('确定要删除选中的会话及其本地数据吗？')) {
        return;
    }
    try {
        const ids = Array.from(selectedSessionIds);
        ids.forEach((sid) => {
            SessionLogStore.remove(sid);
            PauseStore.load();
            if (PauseStore._store[sid]) {
                delete PauseStore._store[sid];
                PauseStore.save();
            }
            delete sessionMetadata[sid];
            selectedSessionIds.delete(sid);
            fetch(`/debug/session/${sid}/delete`, { method: 'DELETE' }).catch(() => {});
        });
        if (ids.includes(currentLogSessionId)) {
            currentLogSessionId = null;
            stepSnapshots = [];
            currentStepIndex = -1;
            const sel = document.getElementById('debug-step-selector');
            if (sel) {
                sel.innerHTML = '<option value="">暂无步骤</option>';
                sel.disabled = true;
            }
            updateStepNavButtons();
        }
        if (ids.includes(currentDebugSession)) {
            currentDebugSession = null;
        }
        selectedSessionIds.clear();
        renderSessionManager();
        const el = ensureDebugLogContainer();
        if (el && !currentLogSessionId) {
            el.textContent = '';
        }
        showNotification('已删除选中的会话', 'success');
    } catch (error) {
        console.warn('批量删除会话失败', error);
        showNotification('删除会话失败', 'error');
    }
}

function switchDebugSession(sessionId) {
    if (!sessionId) return;
    currentLogSessionId = sessionId;
    const el = ensureDebugLogContainer();
    const entry = SessionLogStore.get(sessionId);
    if (el && entry) {
        el.textContent = entry.logs || '';
        scrollConsoleToBottom();
    }
    renderLatestSnapshot(sessionId);
    renderSessionManager();
}

function deleteCurrentSessionData() {
    const sid = currentLogSessionId || currentDebugSession;
    if (!sid) return;
    selectedSessionIds = new Set([sid]);
    deleteSelectedSessions();
}

function openSessionDialog() {
    const dialog = document.getElementById('session-dialog');
    if (!dialog) return;
    renderSessionManager();
    dialog.classList.add('active');
    dialog.setAttribute('aria-hidden', 'false');
    sessionDialogOpen = true;
    document.body.classList.add('modal-open');
}

function closeSessionDialog() {
    const dialog = document.getElementById('session-dialog');
    if (!dialog) return;
    dialog.classList.remove('active');
    dialog.setAttribute('aria-hidden', 'true');
    sessionDialogOpen = false;
    document.body.classList.remove('modal-open');
}

function toggleSessionDialog() {
    if (sessionDialogOpen) {
        closeSessionDialog();
    } else {
        openSessionDialog();
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sessionDialogOpen) {
        closeSessionDialog();
    }
});

window.refreshSessionManager = refreshSessionManager;
window.deleteSelectedSessions = deleteSelectedSessions;
window.selectAllSessions = selectAllSessions;
window.toggleSessionDialog = toggleSessionDialog;
window.closeSessionDialog = closeSessionDialog;
window.jumpStep = jumpStep;


function initMonacoEditor() {
    if (monacoEditor) {
        return; // Already initialized
    }

    const editorContainer = document.getElementById('monaco-editor');
    if (!editorContainer) {
        console.error('Monaco editor container not found');
        return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    try {
        monacoEditor = monaco.editor.create(editorContainer, {
            value: '// 等待调试会话启动...\n// 代码将在断点触发时显示',
            language: 'javascript',
            theme: isDark ? 'vs-dark' : 'vs-light',
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: true },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: 'SF Mono, Monaco, Menlo, monospace',
            folding: true,
            renderLineHighlight: 'all',
            scrollbar: {
                vertical: 'auto',
                horizontal: 'auto'
            }
        });

        console.log('Monaco Editor initialized');
    } catch (error) {
        console.error('Failed to initialize Monaco Editor:', error);
    }
}



function updateDebugStatus(status, icon = 'activity', color = 'var(--accent-success)') {
    const statusIndicator = document.getElementById('debug-status');
    const statusLabel = document.getElementById('debug-status-label');
    const statusIcon = document.getElementById('debug-status-icon');

    if (statusIndicator && statusLabel && statusIcon) {
        statusLabel.textContent = status;
        statusIcon.setAttribute('data-lucide', icon);
        statusIcon.style.color = color;
        lucide.createIcons(); // 重新渲染图标
        statusIndicator.style.display = 'block';
    }
}

function hideDebugStatus() {
    const statusIndicator = document.getElementById('debug-status');
    if (statusIndicator) {
        statusIndicator.style.display = 'none';
    }
}

function startDebugFromConfig() {
    const sessionId = AppState.currentSession;
    console.log('🚀 startDebugFromConfig called, session_id:', sessionId);

    if (!sessionId) {
        console.error('❌ No session_id found in AppState.currentSession');
        showNotification('请先创建调试会话', 'warning');
        return;
    }

    analysisSuccessNotified = false;

    enableDebugControls(false);

    updateDebugStatus('正在启动浏览器...', 'loader', 'var(--accent-blue)');

    if (AppState.socket) {
        AppState.socket.off && AppState.socket.off('debug_paused');
        AppState.socket.off && AppState.socket.off('debug_resumed');
        AppState.socket.off && AppState.socket.off('debug_stopped');
        AppState.socket.off && AppState.socket.off('session_joined');
        AppState.socket.off && AppState.socket.off('browser_launched');
        AppState.socket.off && AppState.socket.off('breakpoint_set');
        AppState.socket.off && AppState.socket.off('debug_analysis_done');
        AppState.socket.off && AppState.socket.off('debug_analysis_failed');
        AppState.socket.off && AppState.socket.off('xhr_stack_ready');

        AppState.socket.on('debug_paused', handleDebugPaused);
        AppState.socket.on('debug_resumed', handleDebugResumed);
        AppState.socket.on('debug_stopped', handleDebugStopped);
        AppState.socket.on('session_joined', (d) => {
            console.log('🛰️ session_joined event received:', d);
            appendDebugLog(`🛰️ 已加入调试会话: ${d && d.session_id ? d.session_id : ''}`);
        });

        AppState.socket.on('browser_launched', (data) => {
            console.log('🌐 Browser launched event received:', data);
            console.log('Current debug session:', currentDebugSession);
            updateDebugStatus('调试中...', 'activity', 'var(--accent-success)');
            showNotification('✅ 浏览器已启动', 'success');
            appendDebugLog('🌐 浏览器已启动，正在设置断点...');
        });

        AppState.socket.on('breakpoint_set', (data) => {
            console.log('🎯 Breakpoint set:', data);
            if (data.mode === 'xhr') {
                showNotification(`✅ 已在 ${data.url_pattern} 设置XHR断点`, 'success');
                appendDebugLog(`🎯 已在 ${data.url_pattern} 设置XHR断点`);
            } else if (data.mode === 'js') {
                showNotification(`✅ 已在 ${data.file}:${data.line} 设置JS断点`, 'success');
                appendDebugLog(`🎯 已在 ${data.file} 第${data.line}行 设置JS断点`);
            }
        });

        AppState.socket.on('debug_analysis_done', (data) => {
            console.log('✅ Analysis done:', data);
            updateDebugStatus('分析完成', 'check-circle', 'var(--accent-success)');
            showNotification('✅ AI分析完成，请到报告中心查看', 'success');
            analysisSuccessNotified = true;
            appendDebugLog(`✅ AI分析完成，报告已生成: ${data.report || ''}`);

            setTimeout(() => {
                hideDebugStatus();
            }, 3000);
        });

        AppState.socket.off && AppState.socket.off('debug_hook_log');
        const seenHookLogs = new Set();

        AppState.socket.on('debug_hook_log', (data) => {
            console.log('🎣 Hook log:', data);
            const logType = data.type || 'log';
            const logText = data.text || '';
            const timestamp = data.timestamp || Date.now() / 1000;

            const messageKey = `${timestamp}:${logText}`;
            if (seenHookLogs.has(messageKey)) {
                console.log('🎣 跳过重复 Hook 日志:', logText.substring(0, 50));
                return;
            }
            seenHookLogs.add(messageKey);

            appendDebugLog(`🎣 ${logText}`, logType);

            if (logText.includes('==========')) {
                const match = logText.match(/=+ (.+) =+/);
                if (match) {
                    showNotification(`🎣 Hook: ${match[1]}`, 'info');
                }
            }
        });

        AppState.socket.on('debug_analysis_failed', (data) => {
            console.log('❌ Analysis failed:', data);
            updateDebugStatus('分析失败', 'alert-circle', 'var(--accent-danger)');
            showNotification('❌ AI分析失败', 'error');
            appendDebugLog('❌ AI分析失败');
        });

        AppState.socket.on('xhr_stack_ready', (data) => {
            console.log('🔁 XHR 堆栈回溯完成:', data);
            const message = data?.message || 'XHR模式已回溯堆栈，请重新触发断点';
            showNotification(message, 'info');
            appendDebugLog(`🔁 ${message}`);
        });

        console.log('✅ WebSocket事件监听器已绑定 (debug_paused, debug_resumed, debug_stopped, session_joined, browser_launched, breakpoint_set, analysis)');

        if (AppState.socket.connected) {
            console.log('✅ WebSocket已连接，socket.connected =', AppState.socket.connected);
            wsHealthy = true;
            wsFailureCount = 0;
        } else {
            console.warn('⚠️ WebSocket未连接，将在连接失败时启用轮询');
            wsHealthy = false;
        }
    } else {
        console.error('❌ AppState.socket 不存在！WebSocket未初始化');
        console.error('❌ 立即启动HTTP轮询兜底机制');
        appendDebugLog('⚠️ WebSocket未初始化，使用轮询模式获取调试数据');
        wsHealthy = false;
        wsFailureCount = 999; // 强制启用轮询
        startPolling();
    }

    currentDebugSession = sessionId;
    currentLogSessionId = sessionId;
    breakpointTriggeredShown = false; // 重置断点触发提示标志
    console.log('✅ currentDebugSession设置为:', currentDebugSession);
    setStopButtonEnabled(true);
    showNotification('🚀 开始调试会话...', 'info');
    appendDebugLog('🚀 开始调试会话，正在设置断点...');

    ensureSessionName(sessionId);
    renderSessionManager();
    const entry = SessionLogStore.get(sessionId);
    const el = ensureDebugLogContainer();
    if (el) el.textContent = (entry && entry.logs) ? entry.logs : '';

    lastPausedSeq = 0;
    wsFailureCount = 0;

    console.log('✅ startDebugFromConfig 完成，监听器已绑定');
}

function handleDebugPaused(data) {
    console.log('🎯 Debug paused event received:', data);
    console.log('Current session:', currentDebugSession);
    console.log('Event session:', data?.session_id);

    try {
        appendDebugLogFromPaused(data);
    } catch (e) {
        console.warn('appendDebugLogFromPaused error:', e);
    }

    try {
        updateDebugStatus('已暂停于断点', 'pause-circle', 'var(--accent-warning)');
    } catch (e) {}

    if (!breakpointTriggeredShown) {
        try {
            showNotification('✅ 断点已成功触发！', 'success');
            appendDebugLog('✅ 断点已成功触发，开始调试...');
            breakpointTriggeredShown = true;
        } catch (e) {}
    }

    try {
        PauseStore.append(AppState.currentSession, {
            ts: data.ts || Date.now()/1000,
            seq: data.seq || 0,
            location: data.location || {},
            context: data.context || [],
            callFrames: data.callFrames || [],
            scopeChain: data.scopeChain || []
        });
    } catch (e) {}

    if (data.callFrames) {
        selectedCallFrameIndex = 0;
        currentCallStack = data.callFrames;
        renderCallStack(data.callFrames);
    }

    if (data.scopeChain) {
        currentVariables = data.scopeChain;
        renderVariables(data.scopeChain);
    }

    if (data.location) {
        if (typeof data.context_text === 'string' && data.context_text.trim()) {
            renderCodeContextText(data.context_text);
        } else if (Array.isArray(data.context) && data.context.length > 0) {
            renderCodeContext({ context_lines: data.context, start_line: (data.start_line||1), current_line: data.location.lineNumber || 1 });
        } else if (data.location.scriptId) {
            fetchFrameContext(String(data.location.scriptId), data.location.lineNumber || 1, data.location.columnNumber || 1);
        }

        const fileNameEl = document.getElementById('current-file-name');
        if (fileNameEl && data.location.scriptUrl) {
            fileNameEl.textContent = extractFileName(data.location.scriptUrl);
        }
    }


    enableDebugControls(true);

    if (typeof data.seq === 'number') {
        lastPausedSeq = Math.max(lastPausedSeq, data.seq);
    }

    try { updateStepSelector(AppState.currentSession); } catch (e) {}
}

function handleDebugResumed(data) {
    console.log('Debug resumed:', data);

    const step = (data && data.step) ? String(data.step) : 'resume';
    appendDebugLog(`▶️ 继续执行: ${step}`);

    if (monacoEditor) {
        monacoEditor.deltaDecorations([], []);
    }

    currentBreakpoint = null;
    enableDebugControls(false);

    try {
        updateDebugStatus('调试中...', 'activity', 'var(--accent-success)');
    } catch (e) {}
}

function handleDebugStopped(data) {
    console.log('Debug stopped:', data);

    enableDebugControls(false);
    setStopButtonEnabled(false);

    const reportPath = data && data.report;
    const hasReport = !!reportPath || analysisSuccessNotified;
    const statusText = hasReport ? '调试会话已停止，报告已生成' : '调试会话已停止，正在分析结果...';
    const statusIcon = hasReport ? 'check-circle' : 'loader';
    const statusColor = hasReport ? 'var(--accent-success)' : 'var(--accent-blue)';

    updateDebugStatus(statusText, statusIcon, statusColor);

    clearDebugDisplay();

    currentDebugSession = null;

    if (hasReport) {
        if (reportPath && !analysisSuccessNotified) {
            showNotification(`✅ 调试会话已停止，报告已生成：${reportPath}`, 'success');
            appendDebugLog(`✅ 调试会话已停止，报告已生成：${reportPath}`);
            analysisSuccessNotified = true;
        } else if (!analysisSuccessNotified) {
            showNotification('✅ 调试会话已停止，报告已生成', 'success');
            appendDebugLog('✅ 调试会话已停止，报告已生成');
            analysisSuccessNotified = true;
        }
    } else {
        showNotification('调试会话已停止，正在生成分析报告...', 'info');
        appendDebugLog('■ 调试会话已停止，正在进行AI分析...');
    }

    stopPolling();
}


async function debugStop() {
    const activeSession = currentDebugSession || AppState.currentSession;
    if (!activeSession) {
        showNotification('当前没有运行中的调试会话', 'warning');
        return;
    }

    setStopButtonEnabled(false);
    updateDebugStatus('正在停止调试...', 'loader', 'var(--accent-blue)');
    appendDebugLog('⏹️ 正在请求停止当前调试会话...');

    try {
        const response = await fetch(`/debug/session/${activeSession}/stop`, {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            appendDebugLog('⏹️ 停止指令已发送，等待会话终止事件...');
        } else {
            showNotification('停止调试失败：' + result.error, 'error');
            setStopButtonEnabled(true);
        }
    } catch (error) {
        console.error('Error stopping debug:', error);
        showNotification('停止调试时发生错误', 'error');
        setStopButtonEnabled(true);
    }
}

function enableDebugControls(enabled) {
    const buttons = [
        'debug-continue-btn',
        'debug-step-into-btn',
        'debug-step-out-btn'
    ];

    buttons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = !enabled;
        }
    });
}

function setStopButtonEnabled(enabled) {
    const stopBtn = document.getElementById('debug-stop-btn');
    if (stopBtn) {
        stopBtn.disabled = !enabled;
    }
}


let selectedCallFrameIndex = 0;
function renderCallStack(callFrames) {
    const container = document.getElementById('call-stack-list');
    if (!container) return;

    if (!callFrames || callFrames.length === 0) {
        container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 0.875rem;">无调用栈</div>';
        return;
    }

    container.innerHTML = callFrames.map((frame, index) => `
        <div class="call-stack-card ${index === selectedCallFrameIndex ? 'active' : ''}" onclick="selectCallFrame(${index})">
            <div class="call-stack-title">
                ${escapeHtml(frame.functionName || '(anonymous)')}
            </div>
            <div class="call-stack-subtitle">
                ${escapeHtml(extractFileName(frame.url))}:${frame.lineNumber || ''}
            </div>
        </div>
    `).join('');
}

function renderVariables(scopeChain) {
    const container = document.getElementById('variables-list');
    if (!container) return;

    if (!scopeChain || scopeChain.length === 0) {
        container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 0.875rem;">无变量</div>';
        return;
    }

    let html = '';
    scopeChain.forEach(scope => {
        html += `
            <div style="border-bottom: 1px solid var(--divider-color);">
                <div style="padding: 12px 16px; background: var(--bg-hover); font-weight: 600; font-size: 0.8125rem; color: var(--text-secondary);">
                    ${scope.type}
                </div>
                <div style="padding: 8px 16px;">
        `;

        if (scope.object && scope.object.properties) {
            scope.object.properties.forEach(prop => {
                html += renderVariable(prop, 0);
            });
        } else if (scope.object && scope.object.objectId) {
            html += renderVariable({
                name: scope.type || '(scope)',
                value: { type: 'object', objectId: scope.object.objectId }
            }, 0);
        }

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html || '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 0.875rem;">无变量</div>';
}

function renderVariable(variable, depth) {
    const indent = depth * 16;
    let valueDisplay = '';

    if (variable.value) {
        if (variable.value.type === 'object') {
            valueDisplay = `<span style="color: var(--accent-blue);">{...}</span>`;
        } else if (variable.value.type === 'string') {
            valueDisplay = `<span style="color: var(--accent-success);">"${escapeHtml(variable.value.value)}"</span>`;
        } else if (variable.value.type === 'number') {
            valueDisplay = `<span style="color: var(--accent-warning);">${variable.value.value}</span>`;
        } else if (variable.value.type === 'boolean') {
            valueDisplay = `<span style="color: var(--accent-danger);">${variable.value.value}</span>`;
        } else {
            valueDisplay = `<span style="color: var(--text-tertiary);">${variable.value.value || 'undefined'}</span>`;
        }
    }

    return `
        <div style="padding: 6px 0; margin-left: ${indent}px; font-size: 0.8125rem; font-family: var(--font-mono);">
            <span style="color: var(--text-primary);">${escapeHtml(variable.name)}:</span>
            ${valueDisplay}
        </div>
    `;
}

function renderVariable(variable, depth) {
    const indent = depth * 16;
    let valueDisplay = '';
    let expandIcon = '';
    let attrs = '';

    if (variable.value) {
        if (variable.value.type === 'object') {
            valueDisplay = `<span style="color: var(--accent-blue);">{...}</span>`;
            const oid = variable.value.objectId || '';
            if (oid) {
                expandIcon = `<span class="var-expand" data-obj-id="${escapeHtml(oid)}" style="cursor:pointer; color: var(--accent-blue); margin-right: 6px;">▶</span>`;
                attrs = ` data-obj-id="${escapeHtml(oid)}"`;
            }
        } else if (variable.value.type === 'string') {
            valueDisplay = `<span style="color: var(--accent-success);">"${escapeHtml(variable.value.value)}"</span>`;
        } else if (variable.value.type === 'number') {
            valueDisplay = `<span style="color: var(--accent-warning);">${variable.value.value}</span>`;
        } else if (variable.value.type === 'boolean') {
            valueDisplay = `<span style="color: var(--accent-danger);">${variable.value.value}</span>`;
        } else {
            valueDisplay = `<span style="color: var(--text-tertiary);">${variable.value.value || 'undefined'}</span>`;
        }
    }

    return `
        <div class="var-row" style="padding: 6px 0; margin-left: ${indent}px; font-size: 0.8125rem; font-family: var(--font-mono);"${attrs}>
            ${expandIcon}<span style="color: var(--text-primary);">${escapeHtml(variable.name)}:</span>
            ${valueDisplay}
            <div class="var-children"></div>
        </div>
    `;
}

document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t) return;
    const row = t.classList && t.classList.contains('var-row') ? t : (t.closest && t.closest('.var-row'));
    if (!row) return;
    if (!(t.classList && (t.classList.contains('var-expand') || (t.closest && t.closest('.var-expand'))))) return;
    const oid = row.getAttribute('data-obj-id');
    if (!oid || !currentDebugSession) return;
    const children = row.querySelector('.var-children');
    if (!children) return;
    if (children.getAttribute('data-loaded') === '1') {
        children.style.display = (children.style.display === 'none') ? 'block' : 'none';
        return;
    }
    try {
        const resp = await fetch(`/debug/session/${currentDebugSession}/object/${encodeURIComponent(oid)}/properties`);
        const json = await resp.json();
        if (!json.success) return;
        const props = (json.data && json.data.properties) || [];
        let html = '';
        props.forEach(p => { html += renderVariable(p, (parseInt(row.style.marginLeft)||0)/16 + 1); });
        children.innerHTML = html;
        children.setAttribute('data-loaded', '1');
        children.style.display = 'block';
    } catch (err) { console.warn('加载对象属性失败', err); }
});

function updateEditorContent(source, lineNumber) {
    if (!monacoEditor) return;

    monacoEditor.setValue(source);

    if (lineNumber) {
        const model = monacoEditor.getModel();
        const total = model ? model.getLineCount() : 0;
        const ln = Math.max(1, Math.min(total || lineNumber, lineNumber));
        monacoEditor.revealLineInCenter(ln);
        monacoEditor.setPosition({ lineNumber: ln, column: 1 });
    }
}

function selectCallFrame(index) {
    if (!currentCallStack[index]) return;

    const frame = currentCallStack[index];
    selectedCallFrameIndex = index;

    if (frame.scriptId) {
        fetchFrameContext(frame.scriptId, frame.lineNumber || 1, frame.columnNumber || 1);
    }

    if (Array.isArray(frame.scopeChain) && frame.scopeChain.length) {
        renderVariables(frame.scopeChain);
    } else {
        fetchFrameScopes(index);
    }

    const items = document.querySelectorAll('.call-stack-card');
    items.forEach((item, i) => {
        item.classList.toggle('active', i === index);
    });
}

async function fetchFrameSource(callFrameId) {
    if (!currentDebugSession) return;

    try {
        const response = await fetch(`/debug/session/${currentDebugSession}/frame/${callFrameId}/source`);
        const result = await response.json();

        if (result.success && result.data.source) {
            updateEditorContent(result.data.source, result.data.lineNumber);
        }
    } catch (error) {
        console.error('Error fetching frame source:', error);
    }
}

async function fetchScriptSource(scriptId, lineNumber) {
    if (!currentDebugSession || !scriptId) return;
    try {
        const response = await fetch(`/debug/session/${currentDebugSession}/script/${encodeURIComponent(scriptId)}/source`);
        const result = await response.json();
        if (result.success && result.data.source) {
            updateEditorContent(result.data.source, lineNumber);
        }
    } catch (e) {
        console.error('Error fetching script source:', e);
    }
}

async function fetchFrameScopes(index) {
    if (!currentDebugSession) return;
    try {
        const response = await fetch(`/debug/session/${currentDebugSession}/frame/${index}/scopes`);
        const result = await response.json();
        if (result.success && result.data) {
            const sc = result.data.scopeChain || [];
            renderVariables(sc);
            if (currentCallStack[index]) currentCallStack[index].scopeChain = sc;
        }
    } catch (e) {
        console.error('Error fetching frame scopes:', e);
    }
}

async function fetchFrameContext(scriptId, lineNumber, columnNumber) {
    if (!currentDebugSession || !scriptId) return;
    try {
        const url = `/debug/session/${currentDebugSession}/context?scriptId=${encodeURIComponent(scriptId)}&line=${lineNumber||1}&column=${columnNumber||1}`;
        const response = await fetch(url);
        const result = await response.json();
        if (result.success && result.data && Array.isArray(result.data.context_lines)) {
            const ctxEl = document.getElementById('code-context');
            if (ctxEl) {
                ctxEl.textContent = result.data.context_lines.join('\n');
                ctxEl.style.display = 'block';
            }
        } else if (result.error) {
            console.warn('获取代码上下文失败:', result.error);
        }
    } catch (e) {
        console.error('Error fetching frame context:', e);
    }
}

function clearDebugDisplay() {
    const callStackContainer = document.getElementById('call-stack-list');
    if (callStackContainer) {
        callStackContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 0.875rem;">无调用栈</div>';
    }

    const variablesContainer = document.getElementById('variables-list');
    if (variablesContainer) {
        variablesContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 0.875rem;">无变量</div>';
    }

    if (monacoEditor) {
        monacoEditor.setValue('// 调试会话已结束');
        monacoEditor.deltaDecorations([], []);
    }

    const fileNameEl = document.getElementById('current-file-name');
    if (fileNameEl) {
        fileNameEl.textContent = '';
    }

    currentCallStack = [];
    currentVariables = {};
    currentBreakpoint = null;
}


function ensureDebugLogContainer() {
    if (!debugLogContainer) {
        debugLogContainer = document.getElementById('debug-log-content') || document.getElementById('debug-console') || document.getElementById('debug-log-content');
    }
    if (debugLogContainer && pendingDebugLogs.length) {
        debugLogContainer.textContent += pendingDebugLogs.join('');
        pendingDebugLogs = [];
        scrollConsoleToBottom();
    }
    return debugLogContainer;
}

function scrollConsoleToBottom() {
    const consoleEl = document.getElementById('debug-console');
    if (consoleEl) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function clearDebugLog() {
    const el = ensureDebugLogContainer();
    if (el) el.textContent = '';
    if (currentDebugSession) {
        const entry = SessionLogStore.get(currentDebugSession);
        if (entry) {
            entry.logs = '';
            SessionLogStore.save();
        }
    }
}

function appendDebugLog(text) {
    const el = ensureDebugLogContainer();
    if (!text) return;

    if (text.includes('XHR断点已触发')) {
        showNotification('🎯 XHR断点已触发', 'info');
    } else if (text.includes('已在顶层调用堆栈位置设置新的JS断点')) {
        showNotification('🔍 正在回溯顶层调用堆栈...', 'info');
    } else if (text.includes('已完成XHR断点处理并设置新JS断点')) {
        showNotification('✅ XHR回溯完成，准备触发断点', 'success');
    }

    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${text}\n`;
    if (!el) {
        pendingDebugLogs.push(line);
        return;
    }
    el.textContent += line;
    scrollConsoleToBottom();
    if (currentDebugSession) {
        let name = (SessionLogStore.get(currentDebugSession) || {}).name;
        SessionLogStore.append(currentDebugSession, name, line);
        if (!name) ensureSessionName(currentDebugSession);
        renderSessionManager();
    }
}

function appendDebugLogFromPaused(data) {
    const loc = (data && data.location) || {};
    const fn = loc.functionName || '<匿名函数>';
    const scriptId = (loc.scriptId !== undefined && loc.scriptId !== null) ? String(loc.scriptId) : '';
    const scriptUrl = loc.scriptUrl || '';
    const line = Number(loc.lineNumber || 0);
    const col = Number(loc.columnNumber || 0);

    const where = scriptUrl ? extractFileName(scriptUrl) : (scriptId ? `脚本ID: ${scriptId}` : '(unknown)');

    let block = '';
    block += `📍 暂停位置: ${fn} 在 ${where}\n`;
    block += `📍 具体位置: 行 ${line}, 列 ${col}\n\n`;

    const ctxLines = (data && Array.isArray(data.context)) ? data.context : [];
    if (ctxLines.length) {
        block += '📝 代码上下文:\n';
        block += ctxLines.join('\n') + '\n\n';
    }

    const frames = (data && Array.isArray(data.callFrames)) ? data.callFrames : [];
    if (frames.length) {
        block += '🔄 调用堆栈:\n';
        frames.forEach((f, i) => {
            const ff = (f.functionName || '(anonymous)');
            const fl = (f.lineNumber != null) ? Number(f.lineNumber) : 0;
            const fwhere = f.url ? extractFileName(f.url) : where;
            block += `  ${i + 1}. ${ff} (${fwhere}${fl ? `, 行:${fl}` : ''})\n`;
        });
        block += '\n';
    }

    const scopes = (data && Array.isArray(data.scopeChain)) ? data.scopeChain : [];
    if (scopes.length) {
        block += '🔍 作用域变量:\n';
        scopes.forEach((s, idx) => {
            const stype = s.type || 'unknown';
            block += `  📋 ${stype === 'local' ? '局部' : stype}作用域 (${fn} ${idx})\n`;
            const props = (s.object && Array.isArray(s.object.properties)) ? s.object.properties : [];
            props.forEach(p => {
                const name = p.name || '';
                const v = p.value || {};
                let vv = 'undefined';
                if (v && v.type === 'string') vv = JSON.stringify(v.value);
                else if (v && (v.type === 'number' || v.type === 'boolean')) vv = String(v.value);
                else vv = '[object]';
                block += `    ${name}: ${vv}\n`;
            });
        });
    }

    appendDebugLog(block.trimEnd());
}

async function tryFetchLastEvent() {
    if (!currentDebugSession) return;
    try {
        const resp = await fetch(`/debug/session/${currentDebugSession}/last`);
        const result = await resp.json();
        if (!result || !result.success || !result.data) return;
        const evt = result.data;
        const seq = Number(evt.seq || 0);
        if (seq && seq <= lastPausedSeq) return;
        handleDebugPaused(evt);
    } catch (e) {
    }
}

function formatStepTime(ts) {
    const date = new Date((ts || Date.now() / 1000) * 1000);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatStepLabel(index, snap) {
    return `第${index + 1}步 @ ${formatStepTime(snap.ts)}`;
}

function updateStepNavButtons() {
    const prevBtn = document.getElementById('debug-step-prev');
    const nextBtn = document.getElementById('debug-step-next');
    const hasSteps = stepSnapshots.length > 0;
    if (prevBtn) {
        prevBtn.disabled = !hasSteps || currentStepIndex <= 0;
    }
    if (nextBtn) {
        nextBtn.disabled = !hasSteps || currentStepIndex >= stepSnapshots.length - 1;
    }
}

function updateStepSelector(sessionId) {
    const sel = document.getElementById('debug-step-selector');
    if (!sel) return;
    const list = PauseStore.list(sessionId);
    if (!list.length) {
        stepSnapshots = [];
        currentStepIndex = -1;
        sel.innerHTML = '<option value="">暂无步骤</option>';
        sel.disabled = true;
        updateStepNavButtons();
        return;
    }
    stepSnapshots = list.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    sel.innerHTML = stepSnapshots.map((snap, idx) => (
        `<option value="${idx}">${formatStepLabel(idx, snap)}</option>`
    )).join('');
    sel.disabled = false;
    currentStepIndex = stepSnapshots.length - 1;
    sel.value = String(currentStepIndex);
    sel.onchange = () => {
        const i = parseInt(sel.value, 10);
        if (Number.isNaN(i) || !stepSnapshots[i]) return;
        currentStepIndex = i;
        renderSnapshot(stepSnapshots[i]);
        updateStepNavButtons();
    };
    updateStepNavButtons();
}

function renderLatestSnapshot(sessionId) {
    updateStepSelector(sessionId);
    if (currentStepIndex >= 0 && stepSnapshots[currentStepIndex]) {
        renderSnapshot(stepSnapshots[currentStepIndex]);
    }
}

function jumpStep(direction) {
    if (!stepSnapshots.length) return;
    const targetIndex = currentStepIndex + direction;
    if (targetIndex < 0 || targetIndex >= stepSnapshots.length) return;
    currentStepIndex = targetIndex;
    const sel = document.getElementById('debug-step-selector');
    if (sel) {
        sel.value = String(targetIndex);
    }
    renderSnapshot(stepSnapshots[targetIndex]);
    updateStepNavButtons();
}

function renderSnapshot(snap) {
    try {
        if (Array.isArray(snap.callFrames)) {
            selectedCallFrameIndex = 0;
            currentCallStack = snap.callFrames;
            renderCallStack(currentCallStack);
        }
        if (Array.isArray(snap.scopeChain)) {
            renderVariables(snap.scopeChain);
        }
        if (Array.isArray(snap.context) && snap.context.length) {
            renderCodeContext({
                context_lines: snap.context,
                start_line: (snap.start_line || 1),
                current_line: (snap.location && snap.location.lineNumber) || 1
            });
        } else if (snap.location && snap.location.scriptId) {
            fetchFrameContext(snap.location.scriptId, snap.location.lineNumber||1, snap.location.columnNumber||1);
        }
    } catch (e) { console.warn('renderSnapshot error', e); }
}

function renderCodeContext(ctx) {
    const el = document.getElementById('code-context');
    if (!el || !ctx || !Array.isArray(ctx.context_lines)) return;
    const start = parseInt(ctx.start_line || 1, 10);
    const current = parseInt(ctx.current_line || start, 10);
    let html = '';
    for (let i=0;i<ctx.context_lines.length;i++) {
        const ln = start + i;
        const raw = String(ctx.context_lines[i]||'');
        const lineText = highlightJS(raw);
        const isCur = (ln === current);
        html += `<div class="code-line ${isCur?'code-current':''}"><div class="code-gutter">${ln}</div><div class="code-content">${lineText}</div></div>`;
    }
    el.innerHTML = html;
}

function renderCodeContextText(text) {
    const el = document.getElementById('code-context');
    if (!el) return;
    const lines = String(text||'').split(/\r?\n/);
    let html = '';
    for (let i=0;i<lines.length;i++) {
        const lineText = highlightJS(lines[i]);
        html += `<div class="code-line"><div class="code-gutter"></div><div class="code-content">${lineText}</div></div>`;
    }
    el.innerHTML = html;
}

function highlightJS(line) {
    const hasMarker = line.includes('➤');
    line = line.replace('➤', '__MARK__');
    const tokens = [];
    let i=0, n=line.length;
    let buf='';
    let mode='code'; // 'code'|'str'|'comment'
    let quote='';
    while (i<n) {
        const ch=line[i];
        const next=line[i+1]||'';
        if (mode==='comment') {
            buf += ch;
            i++;
            if (i>=n) { tokens.push({t:'comment',v:buf}); buf=''; }
            continue;
        }
        if (mode==='str') {
            buf += ch;
            if (ch==='\\') {
                if (i+1<n) { buf += line[i+1]; i+=2; continue; }
            }
            if (ch===quote) { tokens.push({t:'string',v:buf}); buf=''; mode='code'; quote=''; i++; continue; }
            i++; continue;
        }
        if (ch==='/' && next==='/' ) { // start comment
            if (buf) { tokens.push({t:'code',v:buf}); buf=''; }
            buf='//'; i+=2; mode='comment'; continue;
        }
        if (ch==='"' || ch==="'" || ch==='`') { // start string
            if (buf) { tokens.push({t:'code',v:buf}); buf=''; }
            mode='str'; quote=ch; buf=ch; i++; continue;
        }
        buf += ch; i++;
    }
    if (buf) { tokens.push({t: mode==='str'?'string': mode==='comment'?'comment':'code', v:buf}); }

    const kw = /\b(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|get|if|import|in|instanceof|let|new|return|set|super|switch|this|throw|try|typeof|var|void|while|with|yield|of)\b/g;
    const boolNull = /\b(true|false)\b|\b(null|undefined)\b/g;
    const num = /\b(0x[0-9a-fA-F]+|\d+\.?\d*)\b/g;

    function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
    function span(cls, s){ return `<span class="${cls}">${s}</span>`; }

    let out='';
    for (const tk of tokens) {
        if (tk.t==='string') { out += span('tok-string', esc(tk.v)); continue; }
        if (tk.t==='comment') { out += span('tok-comment', esc(tk.v)); continue; }
        let s = esc(tk.v);
        s = s.replace(boolNull, (m)=>{
            if (m==='true' || m==='false') return span('tok-boolean', m);
            if (m==='null') return span('tok-null', m);
            if (m==='undefined') return span('tok-undef', m);
            return m;
        });
        s = s.replace(num, (m)=> span('tok-number', m));
        s = s.replace(kw, (m)=> span('tok-keyword', m));
        out += s;
    }
    out = out.replace(/__MARK__/g, '<span class="tok-operator">➤</span>');
    return out;
}


function extractFileName(url) {
    if (!url) return '(unknown)';

    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const parts = pathname.split('/');
        return parts[parts.length - 1] || '(unknown)';
    } catch (e) {
        const parts = url.split('/');
        return parts[parts.length - 1] || url;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


function updateMonacoTheme() {
    if (!monacoEditor) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs-light');
}

const themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
            updateMonacoTheme();
        }
    });
});


if (typeof window.pageChangeCallbacks === 'undefined') {
    window.pageChangeCallbacks = [];
}

window.pageChangeCallbacks.push((pageName) => {
    if (pageName === 'debug') {
        if (!monacoEditor && typeof monaco !== 'undefined') {
            initMonacoEditor();

            themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme']
            });
        }

        setTimeout(() => {
            initResizablePanel();
        }, 100);

        ensureDebugLogContainer();
        renderSessionManager();
        refreshSessionManager();

        if (window.debugViewHint && !currentDebugSession) {
            try {
                const hint = window.debugViewHint; // {host, created_at}
                const list = SessionLogStore.list();
                let bestSid = null; let bestScore = -1;
                Object.entries(list).forEach(([sid, v]) => {
                    const name = (v && v.name) || '';
                    let score = 0;
                    if (hint.host && name.includes(hint.host)) score += 2;
                    if (hint.created_at && name.includes(hint.created_at.replace(/[-:T]/g,'').slice(0,12))) score += 1;
                    if (score > bestScore) { bestScore = score; bestSid = sid; }
                });
                if (bestSid) {
                    switchDebugSession(bestSid);
                    renderLatestSnapshot(bestSid);
                }
            } catch (e) {}
            window.debugViewHint = null;
        }
        renderSessionManager();

        if (AppState.currentSession && !currentDebugSession) {
            startDebugFromConfig();
        }
    }
});


function initResizablePanel() {
    const handle = document.getElementById('resize-handle');
    const codeContext = document.getElementById('code-context');
    const debugConsole = document.getElementById('debug-console');
    const container = codeContext?.parentElement;

    if (!handle || !codeContext || !debugConsole || !container) {
        console.warn('无法初始化可调整大小的面板：元素未找到');
        return;
    }

    let isResizing = false;
    let startY = 0;
    let startCodeHeight = 0;
    let startConsoleHeight = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startCodeHeight = codeContext.offsetHeight;
        startConsoleHeight = debugConsole.offsetHeight;

        handle.style.background = 'var(--accent-blue)';
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        e.preventDefault();
    });

    const handleMouseMove = (e) => {
        if (!isResizing) return;

        const deltaY = e.clientY - startY;
        const newCodeHeight = startCodeHeight + deltaY;
        const newConsoleHeight = startConsoleHeight - deltaY;

        const minHeight = 100;
        if (newCodeHeight >= minHeight && newConsoleHeight >= minHeight) {
            codeContext.style.flex = 'none';
            codeContext.style.height = newCodeHeight + 'px';
            debugConsole.style.flex = 'none';
            debugConsole.style.height = newConsoleHeight + 'px';
        }

        e.preventDefault();
    };

    const handleMouseUp = () => {
        if (isResizing) {
            isResizing = false;
            handle.style.background = 'var(--divider-color)';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    handle.addEventListener('dblclick', () => {
        codeContext.style.flex = '6';
        codeContext.style.height = '';
        debugConsole.style.flex = '4';
        debugConsole.style.height = '';
    });

    console.log('✅ 可调整大小的面板已初始化');
}

const debugStyles = document.createElement('style');
debugStyles.textContent = `
    .debugger-line-highlight {
        background-color: rgba(255, 215, 0, 0.2);
    }

    .debugger-glyph-margin {
        background-color: #FFD700;
        width: 6px !important;
        margin-left: 3px;
        border-radius: 3px;
    }

    .call-stack-item:hover {
        background: var(--bg-hover) !important;
    }

    /* 代码上下文编辑器样式 */
    .code-view {
        background: var(--bg-secondary);
        border: 1px solid var(--divider-color);
        overflow: auto;
        counter-reset: linenumber var(--start-line, 0);
        line-height: 1.2em;
    }
    .code-line { display: flex; align-items: flex-start; }
    .code-gutter {
        width: 52px; flex: 0 0 52px; text-align: right; padding-right: 10px;
        color: var(--text-tertiary);
        user-select: none;
        background: var(--bg-hover);
    }
    .code-content { white-space: pre; flex: 1; }
    .code-current { background: rgba(255,215,0,0.12); }
    #debug-console { background: #111; color: #e6e6e6; }

    /* 拖动手柄悬停效果 */
    #resize-handle:hover {
        background: var(--accent-blue) !important;
    }

    /* VSCode-like tokens */
    .tok-keyword { color: #c586c0; }
    .tok-string { color: #ce9178; }
    .tok-number { color: #b5cea8; }
    .tok-boolean { color: #4fc1ff; }
    .tok-null, .tok-undef { color: #808080; font-style: italic; }
    .tok-comment { color: #6a9955; }
    .tok-func { color: #dcdcaa; }
    .tok-operator { color: #d4d4d4; }
    .no-wrap { white-space: nowrap; }
`;
document.head.appendChild(debugStyles);

console.log('Debug module loaded');
