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
        // 移除失败提示
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
                        <td style="padding: 8px 6px; font-weight: 500;">${difficultyNames[diffKey]}</td>
                        <td style="padding: 8px 6px;">${level}</td>
                        <td style="padding: 8px 6px; font-size: 12px;">${escapeHtml(charter)}</td>
                        <td style="padding: 8px 6px;">${notes}</td>
                        <td style="padding: 8px 6px; font-size: 11px; color: #a0c0ff;">T:${tap} H:${hold} D:${drag} F:${flick}</td>
                      </tr>
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
                                  </tr>
                            </thead>
                            <tbody>
                                ${tableRows || '<tr><td colspan="5" style="padding: 12px; text-align: center;">无可用难度</td></tr>'}
                            </tbody>
                          </table>
                    </div>
                    <div style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                        <select id="diffSelect_${songIdSafe}" style="padding: 6px 12px; border-radius: 8px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); font-size: 13px; cursor: pointer;">
                            ${diffOptions}
                        </select>
                        <button class="download-chart-btn" data-track-id="${trackId}" data-select-id="diffSelect_${songIdSafe}" style="padding: 6px 14px; background: #27ae60; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px; transition: all 0.2s;">下载谱面</button>
                        <button class="download-audio-btn" data-track-id="${trackId}" style="padding: 6px 14px; background: #3498db; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px; transition: all 0.2s;">下载音频</button>
                        <button class="download-illust-btn" data-song-id="${song.id}" data-chart-key="${chartKey}" data-img-id="img_${songIdSafe}" style="padding: 6px 14px; background: #f39c12; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 13px; transition: all 0.2s;">下载曲绘</button>
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
    
    document.querySelectorAll('.download-audio-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = `https://phidata.tx4.de5.net/Tracks/${btn.dataset.trackId}/music.mp3`;
            window.open(url, '_blank');
        });
    });
    
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