// ==================== 工具函数 ====================
function getData(url) {
    return fetch(url).then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    });
}

// 将歌曲ID转换为chartData中的key格式（去掉末尾的.0）
function getChartKey(songId) {
    if (songId.endsWith('.0')) {
        return songId.slice(0, -2);
    }
    return songId;
}

// 将歌曲ID转换为Tracks路径格式（确保以.0结尾）
function getTrackId(songId) {
    if (!songId.endsWith('.0')) {
        const parts = songId.split('.');
        if (parts.length === 2) {
            return songId + '.0';
        }
    }
    return songId;
}

// 获取曲绘URL（主备两个数据源）
function getIllustrationUrls(songId, chartKey) {
    const trackId = getTrackId(songId);
    const primaryUrl = `https://phidata.tx4.de5.net/Tracks/${trackId}/Illustration.jpg`;
    const backupUrl = `https://raw.githubusercontent.com/Catrong/phi-plugin-ill/refs/heads/main/ill/${chartKey}.png`;
    return { primary: primaryUrl, backup: backupUrl };
}

// 测试图片是否可加载
function testImageUrl(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

// ==================== 全局变量 ====================
let chartData = {};
let chaptersData = [];
let currentSongList = [];
let currentSort = 'default';
let currentOrder = 'asc';
let currentSearch = '';
let selectedDifficulties = { ez: true, hd: true, in: true, at: true, legacy: true, sp: true };
let selectedChapters = {};
let floatingWindow = null;
let blurOverlay = null;

const difficultyNames = { ez: 'EZ', hd: 'HD', in: 'IN', at: 'AT', legacy: 'Legacy', sp: 'SP' };
const difficultyOrder = ['ez', 'hd', 'in', 'at', 'legacy', 'sp'];

// 存储每首歌曲的曲绘加载状态
const illustrationState = {};

// ==================== 评论系统配置 ====================
const COMMENT_API_URL = 'https://txnet-phiconstable-cmt.teinxiction.workers.dev/api/comments';

// ==================== Markdown 解析 ====================
function parseMarkdown(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: #667eea;">$1</a>')
        .replace(/\n/g, '<br>');
}

// ==================== 构建章节筛选器 ====================
function buildChapterFilter() {
    const container = document.getElementById('chapterFilter');
    if (!container) return;
    
    container.innerHTML = '';
    chaptersData.forEach(chapter => {
        const label = document.createElement('label');
        label.style.cssText = 'display: inline-flex; align-items: center; margin-right: 12px; margin-bottom: 8px; cursor: pointer; font-size: 13px;';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = chapter.code;
        cb.checked = selectedChapters[chapter.code] !== false;
        cb.addEventListener('change', (e) => {
            selectedChapters[chapter.code] = e.target.checked;
            filterAndRender();
        });
        
        let title = chapter.title || chapter.code;
        if (title) {
            title = title.replace(/\\Chapter/g, '').replace(/Title|SubTitle/g, '').trim();
            if (!title) title = chapter.code;
        }
        
        const span = document.createElement('span');
        span.textContent = title;
        span.style.marginLeft = '4px';
        
        label.appendChild(cb);
        label.appendChild(span);
        container.appendChild(label);
    });
}

// ==================== 难度筛选器 ====================
function buildDifficultyFilter() {
    const container = document.getElementById('difficultyFilter');
    if (!container) return;
    
    const diffs = [
        { key: 'ez', name: 'EZ' },
        { key: 'hd', name: 'HD' },
        { key: 'in', name: 'IN' },
        { key: 'at', name: 'AT' },
        { key: 'legacy', name: 'Legacy' },
        { key: 'sp', name: 'SP' }
    ];
    
    container.innerHTML = '';
    diffs.forEach(diff => {
        const label = document.createElement('label');
        label.style.cssText = 'display: inline-flex; align-items: center; margin-right: 12px; cursor: pointer; font-size: 13px;';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedDifficulties[diff.key];
        cb.addEventListener('change', (e) => {
            selectedDifficulties[diff.key] = e.target.checked;
            filterAndRender();
        });
        
        const span = document.createElement('span');
        span.textContent = diff.name;
        span.style.marginLeft = '4px';
        
        label.appendChild(cb);
        label.appendChild(span);
        container.appendChild(label);
    });
}

// ==================== 获取歌曲详细信息 ====================
function getSongDetails(songId) {
    const chartKey = getChartKey(songId);
    return chartData[chartKey] || null;
}

// ==================== 获取歌曲可用难度 ====================
function getAvailableDifficulties(songDetails) {
    const available = [];
    difficultyOrder.forEach(diffKey => {
        if (songDetails[diffKey]) {
            available.push({
                key: diffKey.toUpperCase(),
                name: difficultyNames[diffKey],
                level: songDetails[diffKey].level || '?'
            });
        }
    });
    return available;
}

// ==================== 搜索过滤 ====================
function filterAndRender() {
    let allSongs = [];
    chaptersData.forEach(chapter => {
        if (selectedChapters[chapter.code] !== false && chapter.songs) {
            chapter.songs.forEach(song => {
                allSongs.push({
                    ...song,
                    chapterCode: chapter.code,
                    chapterTitle: chapter.title
                });
            });
        }
    });
    
    if (currentSearch) {
        const searchLower = currentSearch.toLowerCase();
        allSongs = allSongs.filter(song => {
            const details = getSongDetails(song.id);
            return song.id.toLowerCase().includes(searchLower) ||
                   song.name.toLowerCase().includes(searchLower) ||
                   (details?.composer || '').toLowerCase().includes(searchLower) ||
                   (details?.ill || '').toLowerCase().includes(searchLower) ||
                   Object.values(details || {}).some(v => v?.charter?.toLowerCase().includes(searchLower));
        });
    }
    
    allSongs.sort((a, b) => {
        let valA, valB;
        switch(currentSort) {
            case 'name':
                valA = a.name;
                valB = b.name;
                break;
            case 'difficulty':
                const getMaxDiff = (song) => {
                    const diffs = song.difficulty.map(d => parseFloat(d)).filter(d => d > 0);
                    return Math.max(...diffs, 0);
                };
                valA = getMaxDiff(a);
                valB = getMaxDiff(b);
                break;
            default:
                valA = a.id;
                valB = b.id;
        }
        if (typeof valA === 'string') {
            return currentOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return currentOrder === 'asc' ? valA - valB : valB - valA;
    });
    
    currentSongList = allSongs;
    renderSongList();
}

// ==================== 加载曲绘 ====================
async function loadIllustration(imgElement, songId, chartKey, onSuccess, onFail) {
    const urls = getIllustrationUrls(songId, chartKey);
    
    const primaryValid = await testImageUrl(urls.primary);
    if (primaryValid) {
        imgElement.src = urls.primary;
        if (onSuccess) onSuccess(true);
        return true;
    }
    
    const backupValid = await testImageUrl(urls.backup);
    if (backupValid) {
        imgElement.src = urls.backup;
        if (onSuccess) onSuccess(true);
        return true;
    }
    
    imgElement.src = '';
    imgElement.style.objectFit = 'contain';
    if (onFail) onFail();
    return false;
}

// ==================== 重新加载曲绘 ====================
async function reloadIllustration(imgElement, songId, chartKey, btnElement) {
    imgElement.src = '';
    imgElement.style.objectFit = 'cover';
    imgElement.style.background = 'rgba(0,0,0,0.5)';
    if (btnElement) {
        btnElement.textContent = '加载中...';
        btnElement.disabled = true;
    }
    
    const urls = getIllustrationUrls(songId, chartKey);
    
    const primaryValid = await testImageUrl(urls.primary);
    if (primaryValid) {
        imgElement.src = urls.primary;
        imgElement.style.objectFit = 'cover';
        if (btnElement) {
            btnElement.textContent = '下载曲绘';
            btnElement.disabled = false;
            btnElement.classList.remove('reload-btn');
        }
        const parent = imgElement.parentElement;
        const tipSpan = parent.querySelector('.ill-fail-tip');
        if (tipSpan) tipSpan.remove();
        return true;
    }
    
    const backupValid = await testImageUrl(urls.backup);
    if (backupValid) {
        imgElement.src = urls.backup;
        imgElement.style.objectFit = 'cover';
        if (btnElement) {
            btnElement.textContent = '下载曲绘';
            btnElement.disabled = false;
            btnElement.classList.remove('reload-btn');
        }
        const parent = imgElement.parentElement;
        const tipSpan = parent.querySelector('.ill-fail-tip');
        if (tipSpan) tipSpan.remove();
        return true;
    }
    
    imgElement.src = '';
    imgElement.style.objectFit = 'contain';
    imgElement.style.background = 'rgba(0,0,0,0.3)';
    if (btnElement) {
        btnElement.textContent = '重新加载曲绘';
        btnElement.disabled = false;
        btnElement.classList.add('reload-btn');
    }
    return false;
}

// ==================== 渲染评论 ====================
function renderComment(comment, isReply = false) {
    const date = new Date(comment.created_at).toLocaleString();
    const replyCount = comment.replies ? comment.replies.length : 0;
    
    return `
        <div class="comment-item" data-comment-id="${comment.id}" style="background: rgba(255,255,255,0.05); border-radius: 10px; padding: 15px; margin-bottom: 15px; ${isReply ? 'margin-left: 40px; border-left: 3px solid #667eea;' : ''}">
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap;">
                <div>
                    <strong style="color: #667eea;">${escapeHtml(comment.username)}</strong>
                    ${comment.difficulty ? `<span style="background: rgba(102,126,234,0.3); padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 8px;">${comment.difficulty.toUpperCase()}</span>` : ''}
                    ${isReply ? '<span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 8px;">回复</span>' : ''}
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <span style="color: rgba(255,255,255,0.5); font-size: 12px;">${date}</span>
                    <button class="delete-comment-btn" data-id="${comment.id}" style="background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 14px; padding: 4px 8px;" title="删除（只能删除自己的评论）">🗑️</button>
                </div>
            </div>
            <div style="color: white; line-height: 1.6; margin-bottom: 12px;">${parseMarkdown(comment.content)}</div>
            <div>
                <button class="reply-to-btn" data-id="${comment.id}" data-username="${escapeHtml(comment.username)}" style="background: none; border: none; color: #667eea; cursor: pointer; font-size: 13px; padding: 4px 8px;">
                    💬 回复 ${replyCount > 0 ? `(${replyCount})` : ''}
                </button>
            </div>
            ${comment.replies && comment.replies.length > 0 ? 
                `<div class="replies-container" style="margin-top: 15px;">
                    ${comment.replies.map(reply => renderComment(reply, true)).join('')}
                </div>` : ''
            }
        </div>
    `;
}

// ==================== 打开评论系统 ====================
async function openCommentSystem(songId, songName, difficulties) {
    // 创建模态框
    const modal = document.createElement('div');
    modal.id = 'commentModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.95);
        backdrop-filter: blur(10px);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); border-radius: 20px; width: 90%; max-width: 900px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column;">
            <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 20px; color: white;">💬 评论 · ${escapeHtml(songName)}</h2>
                <button id="closeModalBtn" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">✕</button>
            </div>
            
            <div style="padding: 20px; overflow-y: auto; flex: 1;">
                <!-- 发表评论表单 -->
                <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div style="margin-bottom: 15px;">
                        <input type="text" id="commentUsername" placeholder="你的名字" maxlength="50" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <select id="commentDifficulty" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white;">
                            <option value="">选择难度（可选）</option>
                            ${difficulties.map(d => `<option value="${d.key}">${d.name} (Lv.${d.level})</option>`).join('')}
                        </select>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <div id="replyIndicator" style="display: none; background: rgba(102,126,234,0.2); padding: 8px 12px; border-radius: 8px; margin-bottom: 10px; font-size: 13px;">
                            正在回复: <span id="replyToUser"></span>
                            <button id="cancelReplyBtn" style="margin-left: 10px; background: none; border: none; color: #ff6b6b; cursor: pointer;">取消</button>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                        <textarea id="commentContent" placeholder="支持 Markdown: **粗体** *斜体* \`代码\` [链接](url)" maxlength="1000" style="width: 100%; min-height: 120px; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; resize: vertical;"></textarea>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; overflow-y: auto;">
                            <div style="color: rgba(255,255,255,0.5); font-size: 12px; margin-bottom: 8px;">预览</div>
                            <div id="previewContent" style="color: white; font-size: 14px; line-height: 1.6;"></div>
                        </div>
                    </div>
                    <button id="submitCommentBtn" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer;">发送评论</button>
                </div>
                
                <!-- 评论列表 -->
                <div id="commentsList">
                    <div style="text-align: center; padding: 40px;">加载中...</div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 状态变量
    let replyToId = null;
    let replyToUser = null;
    
    // 关闭模态框
    document.getElementById('closeModalBtn').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    // 实时预览
    const contentTextarea = document.getElementById('commentContent');
    const previewDiv = document.getElementById('previewContent');
    contentTextarea.oninput = () => {
        previewDiv.innerHTML = parseMarkdown(contentTextarea.value);
    };
    
    // 取消回复
    const cancelReplyBtn = document.getElementById('cancelReplyBtn');
    const replyIndicator = document.getElementById('replyIndicator');
    cancelReplyBtn.onclick = () => {
        replyToId = null;
        replyToUser = null;
        replyIndicator.style.display = 'none';
        contentTextarea.placeholder = '支持 Markdown: **粗体** *斜体* `代码` [链接](url)';
    };
    
    // 加载评论
    async function loadComments() {
        const commentsList = document.getElementById('commentsList');
        try {
            const response = await fetch(`${COMMENT_API_URL}/by-song?song_id=${encodeURIComponent(songId)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const comments = await response.json();
            
            if (comments.length === 0) {
                commentsList.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">✨ 暂无评论，来做第一个评论的人吧！</div>';
                return;
            }
            
            commentsList.innerHTML = comments.map(comment => renderComment(comment)).join('');
            
            // 绑定回复按钮
            document.querySelectorAll('.reply-to-btn').forEach(btn => {
                btn.onclick = () => {
                    replyToId = btn.dataset.id;
                    replyToUser = btn.dataset.username;
                    replyIndicator.style.display = 'block';
                    document.getElementById('replyToUser').textContent = replyToUser;
                    contentTextarea.placeholder = `回复 @${replyToUser}...`;
                    contentTextarea.focus();
                };
            });
            
            // 绑定删除按钮
            document.querySelectorAll('.delete-comment-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    if (confirm('确定要删除这条评论吗？\n注意：只能删除你自己发布的评论，删除后无法恢复。')) {
                        try {
                            const response = await fetch(`${COMMENT_API_URL}/${id}`, {
                                method: 'DELETE'
                            });
                            if (response.ok) {
                                loadComments();
                            } else {
                                const error = await response.json();
                                alert('删除失败: ' + (error.error || '未知错误'));
                            }
                        } catch (error) {
                            alert('删除失败，请重试');
                        }
                    }
                };
            });
            
        } catch (error) {
            commentsList.innerHTML = `<div style="text-align: center; padding: 40px; color: #ff6b6b;">加载失败: ${error.message}</div>`;
        }
    }
    
    // 提交评论/回复
    document.getElementById('submitCommentBtn').onclick = async () => {
        const username = document.getElementById('commentUsername').value.trim();
        const content = document.getElementById('commentContent').value.trim();
        const difficulty = document.getElementById('commentDifficulty').value;
        
        if (!username || !content) {
            alert('请填写用户名和评论内容');
            return;
        }
        
        const submitBtn = document.getElementById('submitCommentBtn');
        submitBtn.textContent = '发送中...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch(COMMENT_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    content,
                    difficulty: difficulty || null,
                    song_id: songId,
                    parent_id: replyToId
                })
            });
            
            if (response.ok) {
                // 清空表单
                document.getElementById('commentContent').value = '';
                document.getElementById('previewContent').innerHTML = '';
                replyToId = null;
                replyToUser = null;
                replyIndicator.style.display = 'none';
                contentTextarea.placeholder = '支持 Markdown: **粗体** *斜体* `代码` [链接](url)';
                // 重新加载评论
                loadComments();
            } else {
                const error = await response.json();
                alert('发送失败: ' + (error.error || '未知错误'));
            }
        } catch (error) {
            alert('网络错误，请重试');
        } finally {
            submitBtn.textContent = '发送评论';
            submitBtn.disabled = false;
        }
    };
    
    // 初始加载评论
    loadComments();
}

// ==================== 渲染歌曲列表 ====================
function renderSongList() {
    const container = document.getElementById('songList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (currentSongList.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.6);">暂无歌曲</div>';
        return;
    }
    
    currentSongList.forEach(song => {
        const songDetails = getSongDetails(song.id);
        if (!songDetails) {
            console.warn('未找到谱面数据:', song.id);
            return;
        }
        
        const chartKey = getChartKey(song.id);
        const trackId = getTrackId(song.id);
        
        if (!illustrationState[song.id]) {
            illustrationState[song.id] = { loaded: false, usingBackup: false };
        }
        
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; margin-bottom: 16px; backdrop-filter: blur(5px); border: 1px solid rgba(255,255,255,0.2); transition: all 0.3s ease;';
        
        let tableRows = '';
        difficultyOrder.forEach(diffKey => {
            const diffData = songDetails[diffKey];
            if (diffData && selectedDifficulties[diffKey]) {
                const level = diffData.level || '?';
                const notes = diffData.notes || 0;
                const tap = diffData.tap || 0;
                const hold = diffData.hold || 0;
                const drag = diffData.drag || 0;
                const flick = diffData.flick || 0;
                const charter = diffData.charter || '?';
                
                tableRows += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <td style="padding: 8px 6px; font-weight: 500;">${difficultyNames[diffKey]}<\/td>
                        <td style="padding: 8px 6px;">${level}<\/td>
                        <td style="padding: 8px 6px; font-size: 12px;">${escapeHtml(charter)}<\/td>
                        <td style="padding: 8px 6px;">${notes}<\/td>
                        <td style="padding: 8px 6px; font-size: 11px; color: #a0c0ff;">T:${tap} H:${hold} D:${drag} F:${flick}<\/td>
                    <\/tr>
                `;
            }
        });
        
        let diffOptions = '';
        difficultyOrder.forEach(diffKey => {
            if (songDetails[diffKey]) {
                const level = songDetails[diffKey].level || '';
                diffOptions += `<option value="${diffKey}">${difficultyNames[diffKey]}${level ? ` (${level})` : ''}</option>`;
            }
        });
        
        const songIdSafe = song.id.replace(/\./g, '_');
        const availableDifficulties = getAvailableDifficulties(songDetails);
        
        card.innerHTML = `
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                <div style="position: relative;">
                    <img id="img_${songIdSafe}" class="song-illustration" data-song-id="${song.id}" data-chart-key="${chartKey}" 
                         src="" alt="曲绘" 
                         style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; background: rgba(0,0,0,0.3); box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <div><strong style="font-size: 18px;">${escapeHtml(songDetails.name || song.name)}</strong> <span style="color: rgba(255,255,255,0.5); font-size: 12px;">[${song.id}]</span></div>
                    <div style="font-size: 13px; margin-top: 6px; color: rgba(255,255,255,0.8);">Composer: ${escapeHtml(songDetails.composer || '?')} | Illustrator: ${escapeHtml(songDetails.ill || '?')}</div>
                    <div style="margin-top: 12px; overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: rgba(255,255,255,0.15);">
                                    <th style="padding: 8px 6px; text-align: left;">难度</th>
                                    <th style="padding: 8px 6px; text-align: left;">定数</th>
                                    <th style="padding: 8px 6px; text-align: left;">谱师</th>
                                    <th style="padding: 8px 6px; text-align: left;">总Note</th>
                                    <th style="padding: 8px 6px; text-align: left;">详情</th>
                                <\/tr>
                            </thead>
                            <tbody>
                                ${tableRows || '<tr><td colspan="5" style="padding: 12px; text-align: center;">无可用难度<\/tr>'}
                            </tbody>
                        <\/table>
                    </div>
                    <div style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                        <select id="diffSelect_${songIdSafe}" style="padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); font-size: 13px; cursor: pointer;">
                            ${diffOptions}
                        </select>
                        <button class="download-chart-btn" data-track-id="${trackId}" data-select-id="diffSelect_${songIdSafe}" style="padding: 6px 14px; background: #27ae60; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px;">下载谱面</button>
                        <button class="download-audio-btn" data-track-id="${trackId}" style="padding: 6px 14px; background: #3498db; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px;">下载音频</button>
                        <button class="download-illust-btn" data-song-id="${song.id}" data-chart-key="${chartKey}" data-img-id="img_${songIdSafe}" style="padding: 6px 14px; background: #f39c12; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px;">下载曲绘</button>
                        <button class="comment-btn" 
                                data-song-id="${song.id}" 
                                data-song-name="${escapeHtml(songDetails.name)}"
                                data-difficulties='${JSON.stringify(availableDifficulties)}'
                                style="padding: 6px 14px; background: #9b59b6; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px;">
                            💬 评论
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
        
        const imgElement = document.getElementById(`img_${songIdSafe}`);
        if (imgElement) {
            loadIllustration(imgElement, song.id, chartKey, 
                (success) => {
                    if (success) {
                        illustrationState[song.id].loaded = true;
                    }
                },
                () => {
                    imgElement.style.display = 'flex';
                    imgElement.style.alignItems = 'center';
                    imgElement.style.justifyContent = 'center';
                    imgElement.style.fontSize = '12px';
                    imgElement.style.color = '#ffaa44';
                    imgElement.style.background = 'rgba(0,0,0,0.6)';
                    const parent = imgElement.parentElement;
                    const existingSpan = parent.querySelector('.ill-fail-tip');
                    if (!existingSpan) {
                        const tipSpan = document.createElement('span');
                        tipSpan.className = 'ill-fail-tip';
                        tipSpan.textContent = '⚠';
                        tipSpan.style.position = 'absolute';
                        tipSpan.style.top = '50%';
                        tipSpan.style.left = '50%';
                        tipSpan.style.transform = 'translate(-50%, -50%)';
                        tipSpan.style.fontSize = '32px';
                        tipSpan.style.opacity = '0.7';
                        tipSpan.style.pointerEvents = 'none';
                        parent.style.position = 'relative';
                        parent.appendChild(tipSpan);
                    }
                }
            );
        }
    });
    
    // 绑定下载谱面按钮
    document.querySelectorAll('.download-chart-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectId = btn.dataset.selectId;
            const select = document.getElementById(selectId);
            const diff = select?.value || 'in';
            const trackId = btn.dataset.trackId;
            const url = `https://phidata.tx4.de5.net/Tracks/${trackId}/Chart_${diff.toUpperCase()}.json`;
            window.open(url, '_blank');
        });
    });
    
    // 绑定下载音频按钮
    document.querySelectorAll('.download-audio-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = `https://phidata.tx4.de5.net/Tracks/${btn.dataset.trackId}/music.mp3`;
            window.open(url, '_blank');
        });
    });
    
    // 绑定下载曲绘按钮
    document.querySelectorAll('.download-illust-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const songId = btn.dataset.songId;
            const chartKey = btn.dataset.chartKey;
            const imgId = btn.dataset.imgId;
            const imgElement = document.getElementById(imgId);
            
            if (btn.textContent === '重新加载曲绘') {
                await reloadIllustration(imgElement, songId, chartKey, btn);
            } else {
                const trackId = getTrackId(songId);
                const url = `https://phidata.tx4.de5.net/Tracks/${trackId}/Illustration.jpg`;
                window.open(url, '_blank');
            }
        });
    });
    
    // 绑定评论按钮
    document.querySelectorAll('.comment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const songId = btn.dataset.songId;
            const songName = btn.dataset.songName;
            const difficulties = JSON.parse(btn.dataset.difficulties);
            openCommentSystem(songId, songName, difficulties);
        });
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ==================== 关闭窗口 ====================
function closeWindow() {
    if (floatingWindow) {
        floatingWindow.remove();
        floatingWindow = null;
    }
    if (blurOverlay) {
        blurOverlay.remove();
        blurOverlay = null;
    }
    document.body.style.overflow = '';
}

// ==================== 创建浮动窗口 ====================
function createFloatingWindow() {
    if (floatingWindow) {
        closeWindow();
    }
    
    document.body.style.overflow = 'hidden';
    
    blurOverlay = document.createElement('div');
    blurOverlay.id = 'windowOverlay';
    blurOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(8px);
        z-index: 9999;
        transition: all 0.3s ease;
    `;
    blurOverlay.addEventListener('click', (e) => {
        if (e.target === blurOverlay) {
            closeWindow();
        }
    });
    document.body.appendChild(blurOverlay);
    
    floatingWindow = document.createElement('div');
    floatingWindow.id = 'floatingWindow';
    floatingWindow.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 85%;
        max-width: 1300px;
        height: 85vh;
        background: linear-gradient(135deg, rgba(26, 26, 46, 0.98) 0%, rgba(22, 33, 62, 0.98) 100%);
        backdrop-filter: blur(20px);
        border-radius: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        z-index: 10000;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        color: white;
        border: 1px solid rgba(255,255,255,0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;
    
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
        padding: 16px 20px;
        background: rgba(0,0,0,0.4);
        border-radius: 24px 24px 0 0;
        cursor: move;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
        border-bottom: 1px solid rgba(255,255,255,0.2);
    `;
    titleBar.innerHTML = `
        <span style="font-weight: bold; font-size: 18px;">曲目浏览器 | Phigros Chart Viewer</span>
        <button id="closeWindowBtn" style="background: rgba(255,255,255,0.2); border: none; color: white; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 8px; transition: all 0.2s;">✕</button>
    `;
    
    const contentDiv = document.createElement('div');
    contentDiv.id = 'windowContent';
    contentDiv.style.cssText = `
        padding: 20px;
        flex: 1;
        overflow-y: auto;
    `;
    
    contentDiv.innerHTML = `
        <div id="difficultyFilter" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 12px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 12px;"></div>
        <div id="chapterFilter" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 10px; max-height: 120px; overflow-y: auto; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 12px;"></div>
        <div style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 12px;">
            <input type="text" id="searchInput" placeholder="搜索 ID / 名称 / 曲师 / 谱师 / 画师..." style="flex: 2; min-width: 200px; padding: 10px 14px; border-radius: 10px; border: none; background: rgba(255,255,255,0.15); color: white; outline: none; font-size: 14px;">
            <select id="sortSelect" style="padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.15); color: white; border: none; cursor: pointer;">
                <option value="default">默认顺序</option>
                <option value="name">按曲名排序</option>
                <option value="difficulty">按最高难度排序</option>
            </select>
            <select id="orderSelect" style="padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.15); color: white; border: none; cursor: pointer;">
                <option value="asc">正序 ↑</option>
                <option value="desc">倒序 ↓</option>
            </select>
        </div>
        <div id="songList" style="overflow-y: auto;"></div>
    `;
    
    floatingWindow.appendChild(titleBar);
    floatingWindow.appendChild(contentDiv);
    document.body.appendChild(floatingWindow);
    
    const closeBtn = document.getElementById('closeWindowBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeWindow();
        });
    }
    
    let isDragging = false;
    let offsetX, offsetY;
    titleBar.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn || e.target.closest('#closeWindowBtn')) return;
        isDragging = true;
        const rect = floatingWindow.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        floatingWindow.style.transition = 'none';
        floatingWindow.style.transform = 'none';
        floatingWindow.style.top = rect.top + 'px';
        floatingWindow.style.left = rect.left + 'px';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        floatingWindow.style.left = (e.clientX - offsetX) + 'px';
        floatingWindow.style.top = (e.clientY - offsetY) + 'px';
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        floatingWindow.style.transition = '';
    });
}

// ==================== 主函数 ====================
async function ViewConstable() {
    if (floatingWindow) {
        closeWindow();
    }
    
    createFloatingWindow();
    
    try {
        const songListDiv = document.getElementById('songList');
        if (songListDiv) songListDiv.innerHTML = '<div style="text-align: center; padding: 40px;">加载数据中...</div>';
        
        const [chapters, charts] = await Promise.all([
            getData('https://phidata.tx4.de5.net/info/chapters.json'),
            getData('https://phidata.tx4.de5.net/chartData.json')
        ]);
        
        chaptersData = chapters;
        chartData = charts;
        
        chaptersData.forEach(ch => { selectedChapters[ch.code] = true; });
        
        buildDifficultyFilter();
        buildChapterFilter();
        
        const searchInput = document.getElementById('searchInput');
        const sortSelect = document.getElementById('sortSelect');
        const orderSelect = document.getElementById('orderSelect');
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                currentSearch = e.target.value;
                filterAndRender();
            });
        }
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                currentSort = e.target.value;
                filterAndRender();
            });
        }
        if (orderSelect) {
            orderSelect.addEventListener('change', (e) => {
                currentOrder = e.target.value;
                filterAndRender();
            });
        }
        
        filterAndRender();
    } catch (error) {
        console.error('初始化失败:', error);
        const songList = document.getElementById('songList');
        if (songList) songList.innerHTML = '<div style="color: #ff6b6b; text-align: center; padding: 40px;">加载数据失败，请检查网络连接</div>';
    }
}

window.ViewConstable = ViewConstable;
function ViewQuery() {
    window.location.href = "query.html";
}