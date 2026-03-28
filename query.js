// ==================== 工具函数 ====================
function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// AES-CBC 解密
async function aesDecrypt(encryptedData, key, iv) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'AES-CBC' },
        false,
        ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: iv },
        cryptoKey,
        encryptedData
    );
    return new Uint8Array(decrypted);
}

// 读取 VarInt
function readVarint(data, pos) {
    if (pos >= data.length) return [0, pos];
    if (data[pos] > 127) {
        if (pos + 1 >= data.length) return [0, pos];
        const value = (data[pos] & 0b01111111) | (data[pos + 1] << 7);
        return [value, pos + 2];
    } else {
        return [data[pos], pos + 1];
    }
}

function readString(data, pos) {
    const [length, newPos] = readVarint(data, pos);
    if (newPos + length > data.length) return ['', newPos];
    const str = new TextDecoder().decode(data.slice(newPos, newPos + length));
    return [str, newPos + length];
}

function bitsToList(byteVal, length = 8) {
    const result = [];
    for (let i = 0; i < length; i++) {
        result.push((byteVal >> i) & 1);
    }
    return result;
}

// 安全读取小端序32位整数
function readUint32LE(data, offset) {
    if (offset + 3 >= data.length) return 0;
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
}

// 安全读取小端序32位浮点数
function readFloat32LE(data, offset) {
    if (offset + 3 >= data.length) return 0;
    const buffer = data.buffer.slice(offset, offset + 4);
    return new DataView(buffer).getFloat32(0, true);
}

// ==================== 云存档获取 ====================
async function queryCloud(token) {
    const sessionToken = token.trim();
    
    const userResponse = await fetch('https://rak3ffdi.cloud.tds1.tapapis.cn/1.1/users/me', {
        headers: {
            "X-LC-Id": "rAK3FfdieFob2Nn8Am",
            "X-LC-Key": "Qr9AEqtuoSVS3zeD6iVbM4ZC0AtkJcQ89tywVyi0",
            "X-LC-Session": sessionToken,
            "User-Agent": "LeanCloud-CSharp-SDK/1.0.3",
            "Accept": "application/json"
        }
    });
    
    if (!userResponse.ok) {
        throw new Error(`获取用户信息失败: ${userResponse.status}`);
    }
    const userInfo = await userResponse.json();
    
    const saveResponse = await fetch('https://rak3ffdi.cloud.tds1.tapapis.cn/1.1/classes/_GameSave?limit=1', {
        headers: {
            "X-LC-Id": "rAK3FfdieFob2Nn8Am",
            "X-LC-Key": "Qr9AEqtuoSVS3zeD6iVbM4ZC0AtkJcQ89tywVyi0",
            "X-LC-Session": sessionToken,
            "User-Agent": "LeanCloud-CSharp-SDK/1.0.3",
            "Accept": "application/json"
        }
    });
    
    if (!saveResponse.ok) {
        throw new Error(`获取存档失败: ${saveResponse.status}`);
    }
    const saveInfo = await saveResponse.json();
    
    const saveUrl = saveInfo.results[0].gameFile.url;
    const zipResponse = await fetch(saveUrl);
    const zipData = await zipResponse.arrayBuffer();
    
    const JSZip = window.JSZip;
    if (!JSZip) {
        throw new Error('需要引入 JSZip 库');
    }
    
    const zip = await JSZip.loadAsync(zipData);
    const result = {
        nickname: userInfo.nickname || 'GUEST',
        userInfo: userInfo,
        summary: saveInfo
    };
    
    const files = ['gameRecord', 'gameKey', 'gameProgress', 'settings', 'user'];
    const aesKey = base64ToBytes("6Jaa0qVAJZuXkZCLiOa/Ax5tIZVu+taKUN1V1nqwkks=");
    const aesIv = base64ToBytes("Kk/wisgNYwcAV8WVGMgyUw==");
    
    for (const fileName of files) {
        const fileData = await zip.file(fileName).async('uint8array');
        const decrypted = await decryptCloudFile(fileName, fileData, aesKey, aesIv);
        result[fileName] = decrypted;
    }
    
    return result;
}

async function decryptCloudFile(fileName, data, key, iv) {
    let content = data;
    if (data[0] === 1 || data[0] === 2 || data[0] === 3 || data[0] === 4) {
        content = data.slice(1);
    }
    
    const decrypted = await aesDecrypt(content, key, iv);
    const padLen = decrypted[decrypted.length - 1];
    const unpadded = decrypted.slice(0, decrypted.length - padLen);
    
    switch (fileName) {
        case 'gameRecord':
            return parseGameRecord(unpadded);
        case 'gameKey':
            return parseGameKey(unpadded);
        case 'gameProgress':
            return parseGameProgress(unpadded);
        case 'settings':
            return parseSettings(unpadded);
        case 'user':
            return parseUser(unpadded);
        default:
            return new TextDecoder().decode(unpadded);
    }
}

function parseGameRecord(data) {
    const result = {};
    let pos = 0;
    
    if (pos >= data.length) return result;
    const [songCount, newPos] = readVarint(data, pos);
    pos = newPos;
    
    console.log(`=== 解析 gameRecord，共 ${songCount} 首歌曲 ===`);
    
    for (let i = 0; i < songCount && pos < data.length; i++) {
        let [songName, newPos] = readString(data, pos);
        pos = newPos;
        
        // 原始歌曲名（可能是 Verruckt.Raimukun.0 或 Verruckt.Raimukun）
        console.log(`[${i}] 原始歌曲名: "${songName}"`);
        
        // 去掉 .0 后缀（如果有）
        let songId = songName;
        if (songId.endsWith('.0')) {
            songId = songId.slice(0, -2);
        }
        console.log(`  处理后 songId: "${songId}"`);
        
        if (pos >= data.length) break;
        let [dataLen, newPos2] = readVarint(data, pos);
        pos = newPos2;
        const endPos = Math.min(pos + dataLen, data.length);
        
        if (pos + 1 >= data.length) break;
        const unlockByte = data[pos];
        const fcByte = data[pos + 1];
        pos += 2;
        
        const songData = {};
        for (let diffIdx = 0; diffIdx < 5; diffIdx++) {
            if ((unlockByte >> diffIdx) & 1) {
                if (pos + 7 >= data.length) break;
                const score = readUint32LE(data, pos);
                const acc = readFloat32LE(data, pos + 4);
                pos += 8;
                
                const diffName = ['EZ', 'HD', 'IN', 'AT', 'Legacy'][diffIdx];
                if (diffName !== 'Legacy') {
                    songData[diffName] = {
                        score: score,
                        acc: acc,
                        ifFC: Boolean((fcByte >> diffIdx) & 1)
                    };
                    console.log(`    ${diffName}: score=${score}, acc=${acc}`);
                }
            }
        }
        
        if (Object.keys(songData).length > 0) {
            result[songId] = songData;
            console.log(`  添加到结果: ${songId}`);
        }
        pos = endPos;
    }
    
    console.log(`=== gameRecord 解析完成，共 ${Object.keys(result).length} 首歌曲 ===`);
    console.log("歌曲列表:", Object.keys(result).slice(0, 20));
    
    return result;
}

function parseGameKey(data) {
    const result = { keyList: {} };
    let pos = 0;
    
    if (pos >= data.length) return result;
    const [keySum, newPos] = readVarint(data, pos);
    pos = newPos;
    
    for (let i = 0; i < keySum && pos < data.length; i++) {
        let [name, newPos] = readString(data, pos);
        pos = newPos;
        if (pos >= data.length) break;
        let [length, newPos2] = readVarint(data, pos);
        pos = newPos2;
        
        if (pos >= data.length) break;
        const typeByte = data[pos];
        pos += 1;
        
        const flag = [];
        for (let j = 0; j < length - 1 && pos < data.length; j++) {
            flag.push(data[pos]);
            pos += 1;
        }
        
        result.keyList[name] = {
            type: bitsToList(typeByte, 5),
            flag: flag
        };
    }
    
    if (data.length - pos >= 6) {
        result.lanotaReadKeys = bitsToList(data[pos], 6);
        pos += 1;
    }
    if (data.length - pos >= 1) {
        result.camelliaReadKey = bitsToList(data[pos], 1);
        pos += 1;
    }
    if (data.length - pos >= 1) {
        result.sideStory4BeginReadKey = data[pos];
        pos += 1;
    }
    if (data.length - pos >= 1) {
        result.oldScoreClearedV390 = data[pos];
    }
    
    return result;
}

function parseGameProgress(data) {
    const result = {};
    let pos = 0;
    
    if (pos >= data.length) return result;
    result.isFirstRun = Boolean((data[pos] >> 0) & 1);
    result.legacyChapterFinished = Boolean((data[pos] >> 1) & 1);
    result.alreadyShowCollectionTip = Boolean((data[pos] >> 2) & 1);
    result.alreadyShowAutoUnlockINTip = Boolean((data[pos] >> 3) & 1);
    pos += 1;
    
    if (pos >= data.length) return result;
    let [completed, newPos] = readString(data, pos);
    pos = newPos;
    result.completed = completed;
    
    if (pos >= data.length) return result;
    let [songUpdateInfo, newPos2] = readVarint(data, pos);
    pos = newPos2;
    result.songUpdateInfo = songUpdateInfo;
    
    if (pos + 1 >= data.length) return result;
    result.challengeModeRank = data[pos] | (data[pos + 1] << 8);
    pos += 2;
    
    const money = [];
    for (let i = 0; i < 5 && pos < data.length; i++) {
        let [val, newPos] = readVarint(data, pos);
        pos = newPos;
        money.push(val);
    }
    result.money = money;
    
    if (pos >= data.length) return result;
    result.unlockFlagOfSpasmodic = bitsToList(data[pos], 4);
    pos += 1;
    if (pos >= data.length) return result;
    result.unlockFlagOfIgallta = bitsToList(data[pos], 4);
    pos += 1;
    if (pos >= data.length) return result;
    result.unlockFlagOfRrharil = bitsToList(data[pos], 4);
    pos += 1;
    if (pos >= data.length) return result;
    result.flagOfSongRecordKey = bitsToList(data[pos], 1);
    pos += 1;
    if (pos >= data.length) return result;
    result.randomVersionUnlocked = bitsToList(data[pos], 6);
    pos += 1;
    
    if (pos >= data.length) return result;
    result.chapter8UnlockBegin = Boolean((data[pos] >> 0) & 1);
    result.chapter8UnlockSecondPhase = Boolean((data[pos] >> 1) & 1);
    result.chapter8Passed = Boolean((data[pos] >> 2) & 1);
    pos += 1;
    
    if (pos >= data.length) return result;
    result.chapter8SongUnlocked = bitsToList(data[pos], 6);
    
    return result;
}

function parseSettings(data) {
    const result = {};
    let pos = 0;
    
    if (pos >= data.length) return result;
    result.chordSupport = Boolean((data[pos] >> 0) & 1);
    result.fcAPIndicator = Boolean((data[pos] >> 1) & 1);
    result.enableHitSound = Boolean((data[pos] >> 2) & 1);
    result.lowResolutionMode = Boolean((data[pos] >> 3) & 1);
    pos += 1;
    
    if (pos >= data.length) return result;
    let [deviceName, newPos] = readString(data, pos);
    pos = newPos;
    result.deviceName = deviceName;
    
    if (pos + 3 >= data.length) return result;
    result.bright = readFloat32LE(data, pos);
    pos += 4;
    if (pos + 3 >= data.length) return result;
    result.musicVolume = readFloat32LE(data, pos);
    pos += 4;
    if (pos + 3 >= data.length) return result;
    result.effectVolume = readFloat32LE(data, pos);
    pos += 4;
    if (pos + 3 >= data.length) return result;
    result.hitSoundVolume = readFloat32LE(data, pos);
    pos += 4;
    if (pos + 3 >= data.length) return result;
    result.soundOffset = readFloat32LE(data, pos);
    pos += 4;
    if (pos + 3 >= data.length) return result;
    result.noteScale = readFloat32LE(data, pos);
    
    return result;
}

function parseUser(data) {
    const result = {};
    let pos = 0;
    
    if (pos >= data.length) return result;
    result.showPlayerId = data[pos];
    pos += 1;
    
    if (pos >= data.length) return result;
    let [selfIntro, newPos] = readString(data, pos);
    pos = newPos;
    result.selfIntro = selfIntro;
    
    if (pos >= data.length) return result;
    let [avatar, newPos2] = readString(data, pos);
    pos = newPos2;
    result.avatar = avatar;
    
    if (pos >= data.length) return result;
    let [background, newPos3] = readString(data, pos);
    result.background = background;
    
    return result;
}

// ==================== 获取定数数据 ====================
let chartDataCache = null;

async function loadChartData() {
    if (chartDataCache) return chartDataCache;
    const response = await fetch('https://phidata.tx4.de5.net/chartData.json');
    chartDataCache = await response.json();
    return chartDataCache;
}

function getSongConst(songId, difficulty) {
    const chartData = chartDataCache;
    if (!chartData) return null;
    
    console.log(`查找定数: songId="${songId}", difficulty="${difficulty}"`);
    
    // 尝试多种匹配方式
    let matchedKey = null;
    let songData = null;
    
    // 方式1: 直接匹配
    if (chartData[songId]) {
        matchedKey = songId;
        songData = chartData[songId];
        console.log(`  匹配方式1: 直接匹配 "${songId}"`);
    }
    // 方式2: 添加 .0
    else if (chartData[songId + '.0']) {
        matchedKey = songId + '.0';
        songData = chartData[matchedKey];
        console.log(`  匹配方式2: 添加.0 -> "${matchedKey}"`);
    }
    // 方式3: 去掉 .0（如果 songId 本身带 .0）
    else if (songId.endsWith('.0') && chartData[songId.slice(0, -2)]) {
        matchedKey = songId.slice(0, -2);
        songData = chartData[matchedKey];
        console.log(`  匹配方式3: 去掉.0 -> "${matchedKey}"`);
    }
    // 方式4: 遍历查找（大小写不敏感）
    else {
        for (const [key, value] of Object.entries(chartData)) {
            const keyWithoutDot = key.endsWith('.0') ? key.slice(0, -2) : key;
            if (keyWithoutDot === songId) {
                matchedKey = key;
                songData = value;
                console.log(`  匹配方式4: 遍历找到 "${key}"`);
                break;
            }
        }
    }
    
    if (!songData) {
        console.warn(`  ❌ 未找到歌曲定数: ${songId}`);
        return null;
    }
    
    const diffLower = difficulty.toLowerCase();
    const diffData = songData[diffLower];
    if (!diffData) {
        console.warn(`  ❌ 未找到难度 ${difficulty} 定数: ${songId}`);
        return null;
    }
    
    const constant = parseFloat(diffData.level);
    console.log(`  ✅ 找到定数: ${constant}`);
    return constant;
}

// ==================== RKS 计算 ====================

function calculateSingleRKS(constant, acc) {
    if (acc < 70) return 0;
    const rks = ((acc - 55) / 45) **2 * constant;
    return rks;
}

// ==================== 格式化查分结果 ====================
async function formatQueryResult(record) {
    await loadChartData();
    
    const gameRecord = record.gameRecord;
    const nickname = record.nickname || 'GUEST';
    const challengeRank = record.gameProgress?.challengeModeRank || 0;
    const avatar = record.user?.avatar || '';
    
    console.log("=== 开始计算成绩 ===");
    console.log("gameRecord 中的歌曲:", Object.keys(gameRecord));
    
    // 计算所有谱面的单曲RKS
    const allScores = [];
    const phiScores = [];
    
    for (const [songId, difficulties] of Object.entries(gameRecord)) {
        console.log(`\n--- 处理歌曲: ${songId} ---`);
        for (const [diff, data] of Object.entries(difficulties)) {
            const constant = getSongConst(songId, diff);
            if (constant === null) {
                console.log(`  ${diff}: 跳过 - 无定数数据`);
                continue;
            }
            
            const accPercent = data.acc;
            const score = data.score;
            const rks = calculateSingleRKS(constant, accPercent);
            
            console.log(`  ${diff}: 定数=${constant}, 分数=${score}, ACC=${accPercent.toFixed(2)}%, RKS=${rks.toFixed(4)}`);
            
            const item = {
                songId,
                diff,
                constant,
                acc: accPercent,
                score,
                rks
            };
            
            if (rks > 0) {
                allScores.push(item);
            }
            
            if (score === 1000000) {
                console.log(`    ★ 满分谱面: ${songId} [${diff}] 定数=${constant}`);
                phiScores.push(item);
            }
        }
    }
    
    console.log(`\n=== 统计结果 ===`);
    console.log(`满分谱面总数: ${phiScores.length}`);
    console.log(`有效成绩总数: ${allScores.length}`);
    
    // 按 RKS 降序排序
    allScores.sort((a, b) => b.rks - a.rks);
    
    // Phi 谱面按定数从高到低排序
    phiScores.sort((a, b) => b.constant - a.constant);
    
    console.log("\nPhi排序结果:");
    phiScores.forEach((item, idx) => {
        console.log(`  Phi${idx+1}: ${item.songId} [${item.diff}] 定数=${item.constant}`);
    });
    
    // 计算总 RKS (取前30首)
    const top30 = allScores.slice(0, 30);
    const totalRKS = top30.reduce((sum, item) => sum + item.rks, 0);
    const rksValue = (totalRKS / 30).toFixed(6);
    
    // 获取 Phi1, Phi2, Phi3
    const phi1 = phiScores[0] || null;
    const phi2 = phiScores[1] || null;
    const phi3 = phiScores[2] || null;
    
    // 格式化挑战模式等级
    let challengeText = '';
    if (challengeRank > 0) {
        const colorMap = {1: '绿', 2: '蓝', 3: '红', 4: '金', 5: '彩'};
        const colorIndex = Math.floor(challengeRank / 100);
        const num = challengeRank % 100;
        challengeText = `${colorMap[colorIndex] || ''}${num}`;
    }
    
    // 生成 Best 列表 HTML
    let bestListHtml = '';
    allScores.forEach((item, index) => {
        const rank = index + 1;
        bestListHtml += `
            <div class="best-item">
                <span class="best-rank">${rank}</span>
                <span class="best-name">${escapeHtml(item.songId)}</span>
                <span class="best-diff">[${item.diff}]</span>
                <span class="best-const">${item.constant.toFixed(1)}</span>
                <span class="best-score">${item.score}</span>
                <span class="best-acc">${item.acc.toFixed(2)}%</span>
                <span class="best-rks">${item.rks.toFixed(4)}</span>
            </div>
        `;
    });
    
    return `
        <div class="query-result">
            <div class="player-info">
                <div class="player-name">Player: ${escapeHtml(nickname)}</div>
                <div class="player-rks">RKS: ${rksValue}</div>
                ${challengeText ? `<div class="player-challenge">Challenge: ${challengeText}</div>` : ''}
                ${avatar ? `<div class="player-avatar">Avatar: ${escapeHtml(avatar)}</div>` : ''}
            </div>
            
            <div class="phi-section">
                <h3>Phi 满分谱面</h3>
                <div class="phi-list">
                    ${phi1 ? `<div class="phi-item">Phi1: ${phi1.songId} [${phi1.diff}] (${phi1.constant.toFixed(1)})</div>` : '<div>暂无满分谱面</div>'}
                    ${phi2 ? `<div class="phi-item">Phi2: ${phi2.songId} [${phi2.diff}] (${phi2.constant.toFixed(1)})</div>` : ''}
                    ${phi3 ? `<div class="phi-item">Phi3: ${phi3.songId} [${phi3.diff}] (${phi3.constant.toFixed(1)})</div>` : ''}
                </div>
            </div>
            
            <div class="best-section">
                <h3>Best 30</h3>
                <div class="best-list">
                    <div class="best-header">
                        <span>#</span>
                        <span>曲目</span>
                        <span>难度</span>
                        <span>定数</span>
                        <span>分数</span>
                        <span>ACC</span>
                        <span>RKS</span>
                    </div>
                    ${bestListHtml || '<div>暂无成绩</div>'}
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ==================== 主查询函数 ====================
async function Query() {
    const tokenInput = document.getElementById("token");
    const resultDiv = document.getElementById("queryResult");
    const loadingDiv = document.getElementById("loading");
    
    if (!tokenInput || !tokenInput.value.trim()) {
        alert("请输入 session token");
        return;
    }
    
    const token = tokenInput.value.trim();
    
    if (loadingDiv) loadingDiv.style.display = "block";
    if (resultDiv) resultDiv.innerHTML = "";
    
    try {
        const record = await queryCloud(token);
        const formattedHtml = await formatQueryResult(record);
        
        if (resultDiv) {
            resultDiv.innerHTML = formattedHtml;
        }
        if (loadingDiv) loadingDiv.style.display = "none";
        
    } catch (error) {
        console.error("查询失败:", error);
        if (loadingDiv) loadingDiv.style.display = "none";
        if (resultDiv) {
            resultDiv.innerHTML = `<div class="error-message">查询失败: ${escapeHtml(error.message)}</div>`;
        }
        alert("查询失败: " + error.message);
    }
}

function backtohome() {
    window.location.href = "index.html";
}

console.log("query.js 已加载");