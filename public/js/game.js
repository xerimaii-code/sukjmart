// ========================================================
// 📱 [화면 꺼짐 완전 방지 & 백그라운드 논블로킹 엔진]
// ========================================================
let wakeLock = null;
let lastUserActionTime = performance.now();
let isDimmed = false;
let bgGameInterval = null;

// 모바일 기기(스마트폰/태블릿) 여부 판별 (PC에서 창을 좁혀도 PC로 정확히 인식)
const isMobileDevice = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// 1. 화면 꺼짐 방지 함수 (에러 완전 격리형)
function requestWakeLock() {
    if (!isMobileDevice || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    
    navigator.wakeLock.request('screen')
        .then(lock => {
            wakeLock = lock;
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        })
        .catch(() => {
            wakeLock = null;
        });
}

// 2. 유저 터치/조작 시 화면 복귀 및 타이머 리셋
function resetIdleTimer() {
    lastUserActionTime = performance.now();
    if (isDimmed) {
        isDimmed = false;
        let dimOverlay = document.getElementById('dim-overlay');
        if (dimOverlay) {
            dimOverlay.style.opacity = '0';
            dimOverlay.style.pointerEvents = 'none';
        }
    }
    requestWakeLock();
}

['touchstart', 'touchmove', 'click', 'keydown'].forEach(evt => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
});

// 3. 탭 전환/화면 가림 시 백그라운드 무한 사냥 가동 (PC 창 가림 대응)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // 화면이 가려지면 50ms(초당 20회) 주기로 내부 전투/사냥 로직 강제 가동
        if (!bgGameInterval && gameStarted) {
            bgGameInterval = setInterval(() => {
                if (typeof update === 'function') {
                    update(performance.now());
                }
            }, 50);
        }
    } else {
        // 다시 화면이 보이면 백그라운드 타이머 정리 후 정상 프레임 복귀
        if (bgGameInterval) {
            clearInterval(bgGameInterval);
            bgGameInterval = null;
        }
        lastTime = performance.now();
        resetIdleTimer();
        requestAnimationFrame(update);
    }
});

// 4. 모바일 기기 전용 45초 스마트 절전 (PC는 작동하지 않음)
setInterval(() => {
    if (!isMobileDevice || typeof gameStarted === 'undefined' || !gameStarted) {
        if (isDimmed) {
            isDimmed = false;
            let dimOverlay = document.getElementById('dim-overlay');
            if (dimOverlay) dimOverlay.style.opacity = '0';
        }
        return;
    }

    if (!wakeLock) {
        requestWakeLock();
    }

    if (typeof player !== 'undefined' && player && (player.autoHunt || currentMap === 'boss_raid')) {
        lastUserActionTime = performance.now(); 
    }

    let idleTime = performance.now() - lastUserActionTime;
    if (idleTime > 45000 && !isDimmed) {
        isDimmed = true;
        let dimOverlay = document.getElementById('dim-overlay');
        if (dimOverlay) {
            dimOverlay.innerHTML = ''; 
            dimOverlay.style.opacity = '0.35';
            dimOverlay.style.pointerEvents = 'none';
        }
    }
}, 5000);





function addSkillText(x, y, text, tier = 'normal', customFontSize = null) {
    if (typeof dmgTexts === 'undefined') return;
    
    let offsetX = (Math.random() - 0.5) * 20;
    let offsetY = (Math.random() - 0.5) * 10;
    
    let color = '#ffffff';
    let size = customFontSize || 15;
    
    if (tier === 'ultimate') {
        color = '#fbbf24';
        if (!customFontSize) size = 20;
    } else if (tier === 'high') {
        color = '#ffea00';
        if (!customFontSize) size = 16;
    } else if (tier === 'buff') {
        color = '#38bdf8';
        if (!customFontSize) size = 13;
    } else if (tier === 'elf') {
        color = '#34d399';
        if (!customFontSize) size = 20;
    } else {
        color = '#c084fc';
        if (!customFontSize) size = 14;
    }

    dmgTexts.push({
        x: x + offsetX,
        y: y - 50 + offsetY,
        text: text,
        life: 1.5,
        color: color,
        fontSize: size
    });
}

function triggerPassiveBroadcast(skillName, targetX, targetY, targetId = null, tier = 'high', caster = null, customFontSize = null) {
    let c = caster || player;
    if (typeof addSkillText === 'function') {
        addSkillText(c.x, c.y, skillName, tier, customFontSize);
    }
    if (window.socket && currentUser) {
        window.socket.emit('player_magic_action', {
            magicName: skillName,
            tier: tier,
            fontSize: customFontSize,
            targetX: targetX,
            targetY: targetY,
            targetId: targetId,
            casterX: c.x,
            casterY: c.y,
            casterId: c.id || window.socket.id,
            map: currentMap
        });
    }
}

// ==========================================
// [1. 뷰포트, 캔버스 & 초고화질 맵 그래픽 텍스처]
// ==========================================
const canvas = document.getElementById('gameCanvas'); 
const ctx = canvas.getContext('2d', { alpha: false });
const minimapCanvas = document.getElementById('minimap'); 
const mCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
window.playerComboCount = 0;

// 캔버스 roundRect 미지원 환경 에러 방지 패치
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
        this.rect(x, y, w, h);
        return this;
    };
}

let width, height, lastTime = performance.now(), ZOOM = 0.75; 
let textures = {};
const generatedMaps = {};
let isBgTick = false;
let lastUiUpdateTime = 0;


function resize() {
    width = window.innerWidth; 
    height = window.innerHeight;
    
    // 💡 [아이폰 미니/저사양폰 최적화] DPR을 최대 1.5로 제한하여 GPU 과부하 원천 차단
    let rawDpr = window.devicePixelRatio || 1;
    let isMobile = width < 768 || ('ontouchstart' in window);
    let dpr = isMobile ? Math.min(rawDpr, 1.5) : rawDpr;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    
    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.scale(dpr, dpr);
    
    ctx.imageSmoothingEnabled = false;
    
    if (width < 768) { 
        ZOOM = Math.max(0.65, Math.min(0.85, width / 480));
    } else { 
        ZOOM = 0.72; 
    }
}


function isEntityOnScreen(ent, ref = player) {
    if (!ent || typeof ent.x !== 'number' || typeof ent.y !== 'number') return false;
    let zoom = (typeof ZOOM === 'number' && ZOOM > 0) ? ZOOM : 0.72;
    let halfW = (window.innerWidth / zoom) / 2;
    let uiBar = document.getElementById('ui-bottom-bar');
    let uiHeight = uiBar ? uiBar.offsetHeight : 165;
    let halfH = ((window.innerHeight - uiHeight) / zoom) / 2;
    
    // 💡 [핵심 패치] 스마트폰(모바일) 환경에서는 화면 가장자리에 몬스터가 걸쳐 있어도 
    // 화면 안에 있는 것으로 관대하게 판정하여 캐릭터가 밖으로 도망치거나 굳는 현상을 원천 차단합니다.
    let margin = (width < 768) ? 5 : 60;
    
    return Math.abs(ent.x - ref.x) < (halfW - margin) && 
           Math.abs(ent.y - ref.y) < (halfH - margin);
}


function checkOrientation() { if(document.getElementById('orientation-warning')) document.getElementById('orientation-warning').style.display = 'none'; }
window.addEventListener('resize', () => { resize(); checkOrientation(); });

function initTextures() {
    const createTex = (w, h, renderFn) => { 
        let c = document.createElement('canvas'); c.width = w; c.height = h; 
        let cx = c.getContext('2d', {alpha:false}); renderFn(cx, w, h); 
        return ctx.createPattern(c, 'repeat'); 
    };
    
    textures['grass'] = createTex(150, 150, (c, w, h) => { 
        let g = c.createLinearGradient(0,0,w,h);
        g.addColorStop(0, '#5a8240'); g.addColorStop(1, '#4a6b35');
        c.fillStyle = g; c.fillRect(0, 0, w, h); 
        for(let i=0; i<500; i++){ 
            c.fillStyle = Math.random()>0.5 ? 'rgba(120,150,90,0.6)' : 'rgba(80,110,60,0.6)'; 
            c.beginPath(); c.arc(Math.random()*w, Math.random()*h, Math.random()*1.5+0.5, 0, Math.PI*2); c.fill(); 
        } 
    });
    
    textures['dirt'] = createTex(150, 150, (c, w, h) => { 
        let g = c.createRadialGradient(w/2, h/2, 0, w/2, h/2, w);
        g.addColorStop(0, '#8c735a'); g.addColorStop(1, '#7a634c');
        c.fillStyle = g; c.fillRect(0, 0, w, h); 
        for(let i=0; i<400; i++){ 
            c.fillStyle = Math.random()>0.5 ? 'rgba(140,120,100,0.5)' : 'rgba(100,80,60,0.5)'; 
            c.beginPath(); c.ellipse(Math.random()*w, Math.random()*h, Math.random()*3+1, Math.random()*2+1, Math.random()*Math.PI, 0, Math.PI*2); c.fill();
        } 
    });
    
    textures['stone'] = createTex(120, 120, (c, w, h) => { 
        c.fillStyle = '#666666'; c.fillRect(0, 0, w, h); 
        for(let y=0; y<h; y+=40) { 
            let off = (y/40)%2===0 ? 0 : 20; 
            for(let x=-20; x<w; x+=40) { 
                let tg = c.createLinearGradient(x+off, y, x+off+36, y+36);
                tg.addColorStop(0, '#888'); tg.addColorStop(1, '#666');
                c.fillStyle = tg; c.fillRect(x+off+2, y+2, 36, 36); 
            } 
        } 
    });
    
    textures['dungeon'] = createTex(120, 120, (c, w, h) => { 
        c.fillStyle = '#3a3a3a'; c.fillRect(0, 0, w, h); 
        for(let y=0; y<h; y+=30) { 
            let off = (y/30)%2===0 ? 0 : 20; 
            for(let x=-20; x<w; x+=40) { 
                let tg = c.createRadialGradient(x+off+20, y+15, 0, x+off+20, y+15, 25);
                tg.addColorStop(0, '#555'); tg.addColorStop(1, '#3a3a3a');
                c.fillStyle = tg; c.fillRect(x+off+2, y+2, 36, 26); 
            } 
        } 
    });
    
    textures['tower'] = createTex(100, 100, (c, w, h) => { 
        let g = c.createLinearGradient(0,0,w,h);
        g.addColorStop(0, '#666677'); g.addColorStop(1, '#444455');
        c.fillStyle = g; c.fillRect(0, 0, w, h); 
        c.strokeStyle = '#333344'; c.lineWidth = 2; 
        for(let y=0; y<h; y+=50) {
            let off = (y/50)%2===0 ? 0 : 25;
            for(let x=-25; x<w; x+=50) { c.strokeRect(x+off, y, 50, 50); }
        } 
    });
    
    textures['lava'] = createTex(150, 150, (c, w, h) => { 
        c.fillStyle = '#510'; c.fillRect(0, 0, w, h); 
        for(let i=0; i<80; i++){ 
            let rg = c.createRadialGradient(0,0,0, 0,0, Math.random()*15+5);
            rg.addColorStop(0, Math.random()>0.5 ? 'rgba(255,120,0,0.6)' : 'rgba(220,50,0,0.5)');
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            c.save(); c.translate(Math.random()*w, Math.random()*h);
            c.fillStyle = rg; c.beginPath(); c.arc(0,0,20,0,Math.PI*2); c.fill(); c.restore();
        } 
    });
}

function generateRealisticMap(mapId, bgType) {
    let c = document.createElement('canvas');
    let w = mapSize; let h = mapSize; 
    c.width = w; c.height = h;
    let cx = c.getContext('2d', { alpha: false });

    if (bgType === 'grass') {
        cx.fillStyle = '#4a6b35'; cx.fillRect(0, 0, w, h);
        for(let i=0; i<150000; i++) {
            cx.fillStyle = Math.random() > 0.5 ? '#3d592a' : '#5a8240';
            cx.fillRect(Math.random()*w, Math.random()*h, 3, 3);
        }
        if (mapId.includes('town') || mapId === 'giran' || mapId === 'aden') {
            cx.fillStyle = '#7a7a7a'; cx.beginPath(); cx.arc(2000, 2000, 500, 0, Math.PI*2); cx.fill();
        }
        for(let i=0; i<3000; i++) {
            let tx = Math.random()*w; let ty = Math.random()*h;
            if (Math.hypot(tx-2000, ty-2000) < 600) continue; 
            let size = 20 + Math.random()*15;
            cx.fillStyle = 'rgba(0,0,0,0.2)'; cx.beginPath(); cx.ellipse(tx, ty+size/2, size, size/2, 0, 0, Math.PI*2); cx.fill(); 
            cx.fillStyle = '#2d4522'; cx.beginPath(); cx.arc(tx, ty-size/2, size, 0, Math.PI*2); cx.fill(); 
            cx.fillStyle = '#426332'; cx.beginPath(); cx.arc(tx-size/4, ty-size/2-size/4, size*0.65, 0, Math.PI*2); cx.fill(); 
        }
    } 
    else if (bgType === 'dirt') {
        cx.fillStyle = '#d1b98a'; cx.fillRect(0, 0, w, h);
        for(let i=0; i<150000; i++) {
            cx.fillStyle = Math.random() > 0.5 ? '#bfa573' : '#e2cd9e';
            cx.fillRect(Math.random()*w, Math.random()*h, 3, 3);
        }
        for(let i=0; i<1000; i++) {
            let tx = Math.random()*w; let ty = Math.random()*h;
            let size = 15;
            if (Math.random() > 0.5) { 
                cx.fillStyle = '#5c7a38'; cx.fillRect(tx, ty-size, 8, size*1.5);
                cx.fillRect(tx-6, ty-size/2, 6, 4); cx.fillRect(tx+8, ty-size+4, 6, 4);
            } else { 
                cx.strokeStyle = '#5c4033'; cx.lineWidth = 3;
                cx.beginPath(); cx.moveTo(tx, ty); cx.lineTo(tx-8, ty-20); cx.moveTo(tx, ty-5); cx.lineTo(tx+8, ty-15); cx.stroke();
            }
        }
    }
    else if (bgType === 'dungeon') {
        cx.fillStyle = '#2c2d38'; cx.fillRect(0, 0, w, h);
        let brickW = 64, brickH = 32; cx.strokeStyle = '#181822'; cx.lineWidth = 2;
        for (let y = 0; y < h; y += brickH) {
            let rowIdx = Math.floor(y / brickH);
            let offsetX = (rowIdx % 2 === 0) ? 0 : (brickW / 2); 
            for (let x = -brickW; x < w + brickW; x += brickW) {
                let bx = x + offsetX;
                let shade = Math.floor(Math.random() * 22);
                cx.fillStyle = `rgb(${48 + shade}, ${48 + shade}, ${58 + shade})`;
                cx.fillRect(bx, y, brickW - 2, brickH - 2);
                cx.strokeRect(bx, y, brickW, brickH);
            }
        }
        cx.lineWidth = 3;
        for(let x = 350; x < w - 350; x += 600) {
            for(let y = 350; y < h - 350; y += 600) {
                let px = x + (Math.random() * 140 - 70); let py = y + (Math.random() * 140 - 70); let pSize = 110;
                cx.fillStyle = 'rgba(0, 0, 0, 0.5)'; cx.beginPath(); cx.ellipse(px + 12, py + pSize/2 + 10, pSize * 0.48, pSize * 0.22, 0, 0, Math.PI * 2); cx.fill();
                cx.fillStyle = '#22222d'; cx.strokeStyle = '#101018'; cx.beginPath(); cx.roundRect(px - pSize/2, py - pSize/2, pSize, pSize, 8); cx.fill(); cx.stroke();
                cx.fillStyle = '#333342'; cx.fillRect(px - pSize/4, py - pSize/4, pSize/2, pSize/2);
            }
        }
        for(let i = 0; i < 50; i++) {
            let tx = Math.random() * w, ty = Math.random() * h;
            let grad = cx.createRadialGradient(tx, ty, 0, tx, ty, 240);
            grad.addColorStop(0, 'rgba(255, 140, 40, 0.32)'); grad.addColorStop(0.6, 'rgba(180, 70, 20, 0.12)'); grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            cx.fillStyle = grad; cx.beginPath(); cx.arc(tx, ty, 240, 0, Math.PI * 2); cx.fill();
        }
        let vGrad = cx.createRadialGradient(w/2, h/2, w/3, w/2, h/2, w/1.1);
        vGrad.addColorStop(0, 'rgba(0,0,0,0)'); vGrad.addColorStop(1, 'rgba(0,0,0,0.25)');
        cx.fillStyle = vGrad; cx.fillRect(0, 0, w, h);
    }
    else if (bgType === 'stone') {
        cx.fillStyle = mapId === 'oren' ? '#e0e8f0' : '#73737a'; cx.fillRect(0, 0, w, h);
        for(let i=0; i<100000; i++) {
            cx.fillStyle = mapId === 'oren' ? '#ffffff' : '#606066';
            cx.fillRect(Math.random()*w, Math.random()*h, 4, 4);
        }
    }
    else if (bgType === 'tower') {
        cx.fillStyle = '#555566'; cx.fillRect(0, 0, w, h);
        cx.strokeStyle = '#333344'; cx.lineWidth = 4;
        for(let y=0; y<h; y+=80) {
            let off = (y/80)%2===0 ? 0 : 40;
            for(let x=-40; x<w; x+=80) { cx.strokeRect(x+off, y, 80, 80); }
        }
    }
    else if (bgType === 'lava') {
        cx.fillStyle = '#3a1505'; cx.fillRect(0, 0, w, h);
        for(let i=0; i<500; i++) { 
            cx.strokeStyle = 'rgba(255, 80, 0, 0.7)'; cx.lineWidth = Math.random()*15 + 5;
            cx.beginPath(); let sx = Math.random()*w, sy = Math.random()*h;
            cx.moveTo(sx, sy); cx.bezierCurveTo(sx+100, sy+100, sx-50, sy+200, sx+150, sy+300); cx.stroke();
        }
    }
    return c;
}

resize(); 
initTextures(); 
checkOrientation();

function getGeneratedMap(mapId) {
    if (!generatedMaps[mapId] && maps[mapId]) {
        generatedMaps[mapId] = generateRealisticMap(mapId, maps[mapId].bg);
    }
    return generatedMaps[mapId];
}


// ==========================================
// [2. 원본 100% 그래픽 복구 (캐릭터/몬스터/마법)]
// ==========================================
function drawNameTag(ctx, text, x, y, isBoss, isNPC) { 
    if (!gameOptions.showNames) return; 
    ctx.save();
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle';
    
    let isMobile = window.innerWidth < 768;
    // 💡 일반/NPC: PC 18px, 모바일 15px (보스는 PC 20px, 모바일 17px)
    let fSize = isBoss ? (isMobile ? 17 : 20) : (isMobile ? 15 : 18);

    ctx.font = `bold ${fSize}px -apple-system, BlinkMacSystemFont, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`; 
    ctx.lineWidth = 4; // 글자 크기에 맞춰 테두리 굵게
    ctx.strokeStyle = '#000000'; 
    
    let rx = Math.round(x);
    let ry = Math.round(y);

    ctx.strokeText(text, rx, ry); 
    ctx.fillStyle = isBoss ? '#fbbf24' : (isNPC ? '#fed7aa' : '#ffffff'); 
    ctx.fillText(text, rx, ry); 
    ctx.restore();
}
function getArmorColor(charClass, grade) {
    if (grade >= 4) return ['#b91c1c', '#7f1d1d']; 
    if (grade === 3) return ['#9333ea', '#581c87']; 
    if (grade === 2) return ['#0ea5e9', '#0369a1']; 
    if (grade === 1) return ['#22c55e', '#15803d']; 
    
    if (charClass === 'knight') return ['#94a3b8', '#475569'];
    if (charClass === 'elf') return ['#65a30d', '#3f6212'];
    if (charClass === 'wizard') return ['#3b82f6', '#1e3a8a'];
    return ['#64748b', '#334155'];
}

// 🌟 [추가] 고급 망토 렌더링 전용 함수
// 🌟 [교체] 고급 망토 렌더링 전용 함수 (대형 로고 및 구겨짐 효과 추가)
function drawLuxuryCloak(ctx, eq, charClass, sz, isMoving, timestamp, isUp, isDown, isSide) {
    if (!eq || !eq.cloak) return;
    ctx.save();
    
    let cBase, cDark, cLight;
    if (eq.cloak.grade >= 4 || (eq.cloak.name && eq.cloak.name.includes('금빛'))) {
        cBase = '#b8860b'; cDark = '#5c4305'; cLight = '#ffd700'; 
    } else if (eq.cloak.name && eq.cloak.name.includes('은빛')) {
        cBase = '#94a3b8'; cDark = '#475569'; cLight = '#e2e8f0'; 
    } else if (eq.cloak.name && eq.cloak.name.includes('투명')) {
        cBase = 'rgba(255, 255, 255, 0.4)'; cDark = 'rgba(200, 200, 200, 0.2)'; cLight = 'rgba(255, 255, 255, 0.6)';
    } else if (charClass === 'elf') { 
        cBase = '#15803d'; cDark = '#064e3b'; cLight = '#4ade80'; 
    } else if (charClass === 'wizard') { 
        // 💡 마법사 망토: 깊이감 있는 다크 네이비 톤
        cBase = '#231f65'; cDark = '#0e0b30'; cLight = '#6366f1'; 
    } else { 
        cBase = '#991b1b'; cDark = '#450a0a'; cLight = '#f87171'; 
    }

    let sway = isMoving ? Math.sin(timestamp / 90) * (sz * 0.3) : Math.sin(timestamp / 200) * (sz * 0.05);
    let wave = isMoving ? Math.cos(timestamp / 120) * (sz * 0.15) : 0;
    
    let grad = ctx.createLinearGradient(-sz, 0, sz, 0);
    grad.addColorStop(0, cDark);
    grad.addColorStop(0.3, cBase);
    grad.addColorStop(0.5, cLight);
    grad.addColorStop(0.7, cBase);
    grad.addColorStop(1, cDark);

    ctx.fillStyle = grad;
    ctx.strokeStyle = cDark;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    if (isSide) {
        ctx.moveTo(-sz * 0.2, -sz * 0.7);
        ctx.quadraticCurveTo(-sz * 0.6, -sz * 0.3, -sz * 0.8 - sway, sz * 0.7 + wave);
        ctx.lineTo(-sz * 0.1 - sway * 0.5, sz * 0.8 + wave);
        ctx.quadraticCurveTo(sz * 0.2, 0, sz * 0.1, -sz * 0.7);
    } else if (isUp) {
        ctx.moveTo(-sz * 0.75, -sz * 0.85);
        ctx.quadraticCurveTo(-sz * 1.1, -sz * 0.2, -sz * 1.2 + sway, sz * 0.9 + wave);
        ctx.quadraticCurveTo(0, sz * 1.1 + Math.abs(sway), sz * 1.2 - sway, sz * 0.9 - wave);
        ctx.quadraticCurveTo(sz * 1.1, -sz * 0.2, sz * 0.75, -sz * 0.85);
    } else if (isDown) {
        ctx.moveTo(-sz * 0.6, -sz * 0.6);
        ctx.quadraticCurveTo(-sz * 1.0, 0, -sz * 1.1 - sway, sz * 0.8 + wave);
        ctx.lineTo(sz * 1.1 + sway, sz * 0.8 - wave);
        ctx.quadraticCurveTo(sz * 1.0, 0, sz * 0.6, -sz * 0.6);
    }
    ctx.closePath();
    
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    if (isUp) {
        ctx.save();
        ctx.translate(sway * 0.4, sz * 0.2 - wave * 0.3);
        
        let emblem = '🛡️';
        if (charClass === 'elf') emblem = '🏹';
        else if (charClass === 'wizard') emblem = '✨'; // 💡 신비로운 별 로고
        
        ctx.globalAlpha = 0.40; 
        ctx.globalCompositeOperation = 'source-over'; 
        
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.scale(1 + Math.abs(sway)/(sz*2), 0.85); 
        ctx.font = `bold ${sz * 1.3}px Arial`;
        ctx.fillText(emblem, 0, 0);

        ctx.globalAlpha = 0.20;
        ctx.fillStyle = cLight;
        ctx.fillText(emblem, 0, -1);
        
        ctx.restore();
    }
    
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;
    if (isSide) {
        ctx.beginPath(); ctx.moveTo(-sz * 0.15, -sz * 0.6); ctx.quadraticCurveTo(-sz * 0.5, 0, -sz * 0.6 - sway, sz * 0.7 + wave); ctx.stroke();
    } else if (isUp) {
        ctx.beginPath(); ctx.moveTo(-sz * 0.4, -sz * 0.8); ctx.quadraticCurveTo(-sz * 0.8, 0, -sz * 0.6 + sway, sz * 0.9 + wave); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -sz * 0.8); ctx.quadraticCurveTo(0, 0, sway * 0.5, sz * 1.0 + Math.abs(sway)*0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sz * 0.4, -sz * 0.8); ctx.quadraticCurveTo(sz * 0.8, 0, sz * 0.6 - sway, sz * 0.9 - wave); ctx.stroke();
    } else {
        ctx.beginPath(); ctx.moveTo(-sz * 0.3, -sz * 0.6); ctx.quadraticCurveTo(-sz * 0.7, 0, -sz * 0.5 + sway, sz * 0.9 + wave); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -sz * 0.6); ctx.quadraticCurveTo(0, 0, sway * 0.5, sz * 1.0 + Math.abs(sway)*0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sz * 0.3, -sz * 0.6); ctx.quadraticCurveTo(sz * 0.7, 0, sz * 0.5 - sway, sz * 0.9 - wave); ctx.stroke();
    }

    ctx.restore();
}

// 🌟 [교체] 캐릭터 통합 렌더링 함수 (렌더링 순서 버그 해결)
function drawCharacter(ctx, ent, sz, isAttacking, isMoving, frame, eq, timestamp) {
    if (isNaN(ent.x) || isNaN(ent.y)) { ent.x = 2000; ent.y = 2000; }
    if (isNaN(ent.lastAttack)) ent.lastAttack = 0;

    let charClass = ent.charClass || ent.mercType || 'knight';
    let buffs = ent.buffs || {};
    let actualAtkDelay = 500;
    if (buffs['가속(헤이스트)']) actualAtkDelay -= 150;
    if (buffs['용기물약']) actualAtkDelay -= 100;
    if (buffs['엘븐와퍼']) actualAtkDelay -= 100;

    let elapsed = timestamp - (ent.lastAttack || timestamp);
    let t = elapsed / actualAtkDelay; if (t > 1.0) t = 1.0;
    let isSwinging = isAttacking && t < 1.0;
    
    let isDeath = eq && eq.armor && typeof eq.armor.name === 'string' && eq.armor.name.includes('데스');
    
    let wpName = '';
    let wpType = 'sword'; 
    if (eq && eq.weapon) {
        wpName = typeof eq.weapon.name === 'string' ? eq.weapon.name : '';
        if (eq.weapon.isBow || wpName.includes('활') || wpName.includes('크로스보우')) wpType = 'bow'; 
        else if (wpName.includes('지팡이')) wpType = 'staff'; 
        else if (wpName.includes('단검')) wpType = 'dagger';
    }

    let normAngle = ent.angle || 0;
    let isUp = normAngle < -Math.PI*0.35 && normAngle > -Math.PI*0.65;
    let isDown = normAngle > Math.PI*0.35 && normAngle < Math.PI*0.65;
    let isSide = !isUp && !isDown;

    ctx.save();
    try {
        if (isSwinging && wpType !== 'bow') {
            if (t >= 0.2 && t < 0.6) {
                if (charClass === 'knight') ctx.translate(sz * 0.25, sz * 0.1); 
                else if (charClass === 'elf') ctx.translate(sz * 0.15, 0); 
                else if (charClass === 'wizard') ctx.translate(sz * 0.05, 0); 
            }
        }

        // 🌟 망토 레이어 1 (앞/측면일 때 등 뒤에 깔림)
        if (!isUp && !isDeath && eq && eq.cloak) {
            drawLuxuryCloak(ctx, eq, charClass, sz, isMoving, timestamp, isUp, isDown, isSide);
        }

        let bodyW = isSide ? sz*1.2 : sz*1.4;
        let bodyX = isSide ? -sz*0.6 : -sz*0.7;

        if (isDeath) {
            ctx.fillStyle = '#111'; ctx.fillRect(-sz*0.5, -sz*0.8, sz*1.0, sz*1.0);
            ctx.fillStyle = '#e2e8f0'; ctx.fillRect(-2, -sz*0.7, 4, sz*0.8);
            for(let i=0; i<4; i++) {
                ctx.beginPath(); ctx.moveTo(0, -sz*0.6 + i*4); ctx.lineTo(-sz*0.4, -sz*0.65 + i*4); ctx.lineTo(-sz*0.4, -sz*0.6 + i*4 + 2); ctx.lineTo(0, -sz*0.55 + i*4); ctx.fill();
                ctx.beginPath(); ctx.moveTo(0, -sz*0.6 + i*4); ctx.lineTo(sz*0.4, -sz*0.65 + i*4); ctx.lineTo(sz*0.4, -sz*0.6 + i*4 + 2); ctx.lineTo(0, -sz*0.55 + i*4); ctx.fill();
            }
            ctx.fillStyle = '#f00'; ctx.beginPath(); ctx.arc(0, -sz*1.1, sz*0.45, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            if (!isUp) { ctx.fillStyle = '#111'; ctx.fillRect(-sz*0.2, -sz*1.2, 2, 2); ctx.fillRect(sz*0.1, -sz*1.2, 2, 2); }
        } 
        else if (charClass === 'knight') {
            let cGrad = ctx.createLinearGradient(0, -sz*0.8, 0, 0); 
            let armorColor = getArmorColor('knight', (eq && eq.armor) ? (eq.armor.grade || 0) : 0);
            cGrad.addColorStop(0, armorColor[0]); cGrad.addColorStop(1, armorColor[1]);
            ctx.fillStyle = cGrad; ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
            
            ctx.beginPath(); ctx.roundRect(bodyX, -sz*0.8, bodyW, sz*0.9, 3); ctx.fill(); ctx.stroke();
            ctx.fillStyle = armorColor[1]; 
            ctx.beginPath(); ctx.arc(bodyX, -sz*0.8, sz*0.3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(bodyX + bodyW, -sz*0.8, sz*0.3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            ctx.fillStyle = (eq && eq.helmet) ? getArmorColor('knight', eq.helmet.grade || 0)[0] : '#e0ac69';
            ctx.beginPath(); ctx.arc(0, -sz*1.1, sz*0.45, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            if(eq && eq.helmet) {
                ctx.fillStyle = '#b4860b';
                if (!isUp) { 
                    ctx.beginPath(); ctx.moveTo(-sz*0.2, -sz*1.5); ctx.lineTo(-sz*0.4, -sz*1.8); ctx.lineTo(-sz*0.1, -sz*1.5); ctx.fill();
                    ctx.beginPath(); ctx.moveTo(sz*0.2, -sz*1.5); ctx.lineTo(sz*0.4, -sz*1.8); ctx.lineTo(sz*0.1, -sz*1.5); ctx.fill();
                }
            } else if (isUp) { 
                ctx.fillStyle = '#3e2723'; ctx.beginPath(); ctx.arc(0, -sz*1.2, sz*0.45, 0, Math.PI*2); ctx.fill(); 
            } else { 
                ctx.fillStyle = '#3e2723'; ctx.beginPath(); ctx.arc(0, -sz*1.2, sz*0.45, Math.PI, Math.PI*2); ctx.fill(); 
            }
        }
        else if (charClass === 'elf') {
            let eBodyW = isSide ? sz*0.9 : sz*1.1;
            let eBodyX = isSide ? -sz*0.45 : -sz*0.55;

            let cGrad = ctx.createLinearGradient(0, -sz*0.8, 0, 0); 
            let armorColor = getArmorColor('elf', (eq && eq.armor) ? (eq.armor.grade || 0) : 0);
            cGrad.addColorStop(0, armorColor[0]); cGrad.addColorStop(1, armorColor[1]);
            ctx.fillStyle = cGrad; ctx.strokeStyle = '#14532d'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(eBodyX, -sz*0.8, eBodyW, sz*0.9, 2); ctx.fill(); ctx.stroke();
            
            if (!isUp) {
                ctx.fillStyle = '#78350f'; ctx.fillRect(eBodyX, -sz*0.3, eBodyW, sz*0.15);
                ctx.beginPath(); ctx.moveTo(eBodyX, -sz*0.8); ctx.lineTo(eBodyX + eBodyW, -sz*0.3); ctx.stroke();
            }
            
            ctx.fillStyle = (eq && eq.helmet) ? getArmorColor('elf', eq.helmet.grade || 0)[0] : '#fde047'; 
            ctx.beginPath(); ctx.arc(0, -sz*1.1, sz*0.4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            if(!isUp && (!(eq && eq.helmet) || (eq.helmet.name && typeof eq.helmet.name === 'string' && eq.helmet.name.includes('엘름')))) {
                ctx.fillStyle = '#e0ac69';
                ctx.beginPath(); ctx.ellipse(-sz*0.4, -sz*1.1, sz*0.25, sz*0.1, Math.PI/4, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.ellipse(sz*0.4, -sz*1.1, sz*0.25, sz*0.1, -Math.PI/4, 0, Math.PI*2); ctx.fill();
            }
        }
        else if (charClass === 'wizard') {
            let wBodyW = isSide ? sz*1.2 : sz*1.4;
            let wBodyX = isSide ? -sz*0.6 : -sz*0.7;

            let cGrad = ctx.createLinearGradient(0, -sz*0.8, 0, sz*0.6); 
            let armorColor = getArmorColor('wizard', (eq && eq.armor) ? (eq.armor.grade || 0) : 0);
            cGrad.addColorStop(0, armorColor[0]); cGrad.addColorStop(1, armorColor[1]);
            ctx.fillStyle = cGrad; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1;
            
            ctx.beginPath(); ctx.moveTo(wBodyX + sz*0.2, -sz*0.8); ctx.lineTo(wBodyX + wBodyW - sz*0.2, -sz*0.8); 
            ctx.lineTo(wBodyX + wBodyW, sz*0.6); ctx.lineTo(wBodyX, sz*0.6); ctx.fill(); ctx.stroke();
            
            if (!isUp) {
                ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(-sz*0.2, -sz*0.8); ctx.lineTo(-sz*0.3, sz*0.6); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(sz*0.2, -sz*0.8); ctx.lineTo(sz*0.3, sz*0.6); ctx.stroke();
            }

            ctx.fillStyle = (eq && eq.helmet) ? getArmorColor('wizard', eq.helmet.grade || 0)[0] : '#e0ac69';
            ctx.beginPath(); ctx.arc(0, -sz*1.1, sz*0.45, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            
            if(eq && eq.helmet) {
                ctx.fillStyle = armorColor[1];
                ctx.beginPath(); ctx.ellipse(0, -sz*0.9, sz*0.8, sz*0.15, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                if (!isUp) { ctx.beginPath(); ctx.moveTo(-sz*0.3, -sz*0.9); ctx.lineTo(0, -sz*1.6); ctx.lineTo(sz*0.3, -sz*0.9); ctx.fill(); }
            } else if (isUp) {
                ctx.fillStyle = '#64748b'; ctx.beginPath(); ctx.arc(0, -sz*1.2, sz*0.45, 0, Math.PI*2); ctx.fill(); 
            } else { 
                ctx.fillStyle = '#64748b'; ctx.beginPath(); ctx.arc(0, -sz*1.2, sz*0.45, Math.PI, Math.PI*2); ctx.fill(); 
            }
        }

        if(!isDeath && !isUp) { 
            ctx.fillStyle = '#111'; ctx.fillRect(-sz*0.15, -sz*1.15, 2, 2); ctx.fillRect(sz*0.05, -sz*1.15, 2, 2); 
        }

        // 💡 [해결 3] 이 위치에 있던 망토 그리기 코드를 완전히 제거했습니다!
        
        let legOffset = (isMoving && !isSwinging && frame === 0) ? sz*0.3 : 0; 
        let legSpread = 0;
        let bowStance = 0;

        if (isSwinging) {
            if (wpType === 'bow') {
                bowStance = isSide ? sz * 0.25 : sz * 0.1; 
            } else {
                legSpread = charClass === 'knight' ? sz * 0.2 : (charClass === 'elf' ? sz * 0.1 : 0); 
                if (!isSide) legSpread *= 0.5; 
            }
        }
        
        if (charClass !== 'wizard' && !isDeath) {
            let legGrad = ctx.createLinearGradient(0, 0, 0, sz*0.8);
            legGrad.addColorStop(0, '#222'); legGrad.addColorStop(1, '#4a4a4a');
            ctx.fillStyle = legGrad; 
            
            ctx.fillRect(-sz*0.3 - legSpread - bowStance, 0, sz*0.25, sz*0.8 - legOffset); 
            ctx.strokeRect(-sz*0.3 - legSpread - bowStance, 0, sz*0.25, sz*0.8 - legOffset); 
            ctx.fillRect(sz*0.05 + legSpread + bowStance, 0, sz*0.25, sz*0.8 + legOffset); 
            ctx.strokeRect(sz*0.05 + legSpread + bowStance, 0, sz*0.25, sz*0.8 + legOffset); 
            
            if (!isUp) {
                ctx.fillStyle = '#181818'; ctx.fillRect(-sz*0.3, 0, sz*0.6, sz*0.15);
                ctx.fillStyle = '#d4af37'; ctx.fillRect(-sz*0.1, 0, sz*0.2, sz*0.15);
            }
        } else if (charClass === 'wizard' && !isDeath) {
            ctx.fillStyle = '#222';
            ctx.fillRect(-sz*0.25 - legSpread, sz*0.6, sz*0.2, sz*0.2 - legOffset); 
            ctx.fillRect(sz*0.05 + legSpread, sz*0.6, sz*0.2, sz*0.2 + legOffset); 
        }

        if (eq && eq.weapon) {
            ctx.save();
            let shoulderX = isSide ? sz * 0.1 : (isDown ? -sz * 0.4 : sz * 0.4); 
            let shoulderY = -sz * 0.5; 
            let armAngle = 0; let swordAbsAngle = 0; let armLen = sz * 0.5;

            if (isSwinging) {
                if (wpType === 'bow') {
                    armLen = sz * 0.6;
                    if (t < 0.5) {
                        let phase = t / 0.5; 
                        armAngle = (-Math.PI / 6) * (1 - phase) + (-Math.PI / 2) * phase; 
                        swordAbsAngle = (0) * (1 - phase) + (Math.PI / 2) * phase; 
                        shoulderX = (isSide ? sz * 0.1 : shoulderX) + (sz * 0.2 * phase);
                    } else {
                        let phase = (t - 0.5) / 0.5; 
                        armAngle = (-Math.PI / 2) * (1 - phase) + (-Math.PI / 6) * phase; 
                        swordAbsAngle = (Math.PI / 2) * (1 - phase) + (0) * phase; 
                        shoulderX = (isSide ? sz * 0.3 : shoulderX) * (1 - phase);
                    }
                } else if (charClass === 'knight') {
                    let idleArm = Math.PI / 8, idleSword = -Math.PI * 0.75; armLen = sz * 0.6;
                    if (t < 0.2) { armAngle = -Math.PI * 0.7; swordAbsAngle = -Math.PI * 0.2; shoulderY = -sz * 0.6; } 
                    else if (t < 0.5) { armAngle = Math.PI / 4; swordAbsAngle = Math.PI * 0.7; shoulderY = -sz * 0.4; } 
                    else { let p = (t - 0.5) / 0.5; armAngle = (Math.PI / 4) * (1 - p*p) + idleArm * (p*p); swordAbsAngle = (Math.PI * 0.7) * (1 - p*p) + idleSword * (p*p); }
                } else if (charClass === 'elf') {
                    let idleArm = Math.PI / 8, idleSword = -Math.PI * 0.75; armLen = sz * 0.6;
                    if (t < 0.2) { armAngle = 0; swordAbsAngle = -Math.PI * 0.3; shoulderY = -sz * 0.5; } 
                    else if (t < 0.5) { armAngle = -Math.PI * 0.3; swordAbsAngle = Math.PI * 0.55; shoulderY = -sz * 0.5; } 
                    else { let p = (t - 0.5) / 0.5; armAngle = (-Math.PI * 0.3) * (1 - p) + idleArm * p; swordAbsAngle = (Math.PI * 0.55) * (1 - p) + idleSword * p; }
                } else if (charClass === 'wizard') {
                    let idleArm = Math.PI / 6, idleSword = -Math.PI * 0.4; armLen = sz * 0.5;
                    if (t < 0.2) { armAngle = -Math.PI * 0.2; swordAbsAngle = -Math.PI * 0.2; shoulderY = -sz * 0.6; } 
                    else if (t < 0.5) { armAngle = Math.PI * 0.1; swordAbsAngle = -Math.PI * 0.6; shoulderY = -sz * 0.5; } 
                    else { let p = (t - 0.5) / 0.5; armAngle = (Math.PI * 0.1) * (1 - p) + idleArm * p; swordAbsAngle = (-Math.PI * 0.6) * (1 - p) + idleSword * p; }
                }
            } else {
                if (wpType === 'bow') { armAngle = -Math.PI / 6; swordAbsAngle = 0; } 
                else if (wpType === 'staff') { armAngle = Math.PI / 6; swordAbsAngle = -Math.PI * 0.4; } 
                else { armAngle = Math.PI / 8; swordAbsAngle = -Math.PI * 0.75; }
                
                if (isMoving && wpType !== 'bow') { 
                    let sway = (wpType === 'staff') ? 0.015 : 0.05;
                    armAngle += Math.sin(timestamp / 150) * (sway * 2); 
                    swordAbsAngle += Math.sin(timestamp / 150) * sway; 
                }
            }
            
            ctx.translate(shoulderX, shoulderY); ctx.rotate(armAngle);
            ctx.fillStyle = eq.armor ? getArmorColor(charClass, eq.armor.grade || 0)[0] : '#e0ac69'; 
            ctx.fillRect(-sz*0.15, 0, sz*0.3, armLen); 
            ctx.translate(0, armLen);
            if (wpType !== 'bow') { ctx.rotate(-armAngle); ctx.rotate(swordAbsAngle); }

            ctx.fillStyle = eq.gloves ? '#444' : '#e0ac69'; ctx.beginPath(); ctx.arc(0, 0, sz*0.2, 0, Math.PI*2); ctx.fill();

            let wColor = '#eee'; let glow = null;
            if (wpName.includes('데스') || wpName.includes('집행검')) { wColor = '#f33'; glow = '#f00'; } 
            else if (wpType === 'bow') { wColor = '#852'; } 
            else if (wpType === 'staff') { wColor = '#531'; glow = '#a3f'; }
            
            if ((eq.weapon.enchantValue || 0) >= 7 && !glow) glow = '#5cf'; 
            if ((eq.weapon.enchantValue || 0) >= 9) glow = '#f0f'; 
            if (glow) { ctx.shadowBlur = 15; ctx.shadowColor = glow; }
            
            if(wpType === 'bow') {
                ctx.lineWidth = 2; ctx.strokeStyle = wColor; 
                ctx.beginPath(); ctx.arc(0, -sz*0.6, sz*0.8, -Math.PI/2, Math.PI/2); ctx.stroke(); 
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,-sz*1.4); ctx.lineTo(0,sz*0.2); ctx.stroke();
            } else if(wpType === 'staff') {
                ctx.fillStyle = '#421'; ctx.fillRect(-2, -sz*1.7, 4, sz*2.3); 
                ctx.fillStyle = glow ? glow : (wColor === '#531' ? '#5cf' : wColor);
                ctx.beginPath(); ctx.arc(0, -sz*1.9, sz*0.3, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#fd0'; ctx.lineWidth = 1.5; ctx.stroke();
            } else if(wpType === 'dagger') {
                ctx.fillStyle = '#111'; ctx.fillRect(-2, -sz*0.1, 4, sz*0.4); ctx.fillStyle = '#b8860b'; ctx.fillRect(-sz*0.3, -4, sz*0.6, 4); 
                let bladeGrad = ctx.createLinearGradient(0, -sz*1.3, 0, 0); bladeGrad.addColorStop(0, '#fff'); bladeGrad.addColorStop(1, wColor); ctx.fillStyle = bladeGrad; 
                ctx.beginPath(); ctx.moveTo(-sz*0.15, -4); ctx.lineTo(-sz*0.08, -sz*1.0); ctx.lineTo(0, -sz*1.5); ctx.lineTo(sz*0.08, -sz*1.0); ctx.lineTo(sz*0.15, -4); ctx.fill();
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-0.5, -sz*1.2, 1, sz*1.2);
            } else {
                ctx.fillStyle = '#111'; ctx.fillRect(-3, -sz*0.1, 6, sz*0.5); ctx.fillStyle = '#b8860b'; ctx.fillRect(-sz*0.4, -4, sz*0.8, 6); 
                let bladeGrad = ctx.createLinearGradient(0, -sz*2.8, 0, 0); bladeGrad.addColorStop(0, '#fff'); bladeGrad.addColorStop(1, wColor); ctx.fillStyle = bladeGrad; 
                ctx.beginPath(); ctx.moveTo(-sz*0.2, -4); ctx.lineTo(-sz*0.12, -sz*2.4); ctx.lineTo(0, -sz*2.9); ctx.lineTo(sz*0.12, -sz*2.4); ctx.lineTo(sz*0.2, -4); ctx.fill();
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-1, -sz*2.4, 2, sz*2.3);
            }
            ctx.restore();
        }

        // 🌟 망토 레이어 2 (뒷모습일 때 몸, 팔, 다리, 무기 등 "모든 것"을 화면 앞으로 완벽히 덮어줌)
        if (isUp && !isDeath && eq && eq.cloak) {
            drawLuxuryCloak(ctx, eq, charClass, sz, isMoving, timestamp, isUp, isDown, isSide);
        }

    } finally {
        ctx.restore();
    }
}

window.checkLevelUp = function() {
    if (!player) return;
    let leveledUp = false;
    
    while (player.exp >= player.maxExp) {
        player.exp -= player.maxExp;
        player.level += 1;
        
        // 💡 [경험치 밸런스 수정] 1.5배 지수 폭발 대신 완만한 곡선으로 변경
        // 레벨이 오를수록 선형 증가 + 1.15배 지수 증가를 혼합
        let baseExp = 100;
        let scale = Math.pow(1.15, player.level - 1);
        player.maxExp = Math.floor(baseExp * player.level * scale); 
        
        leveledUp = true;
        
        if (typeof addMessage === 'function') addMessage(`🎉 레벨 업! [Lv.${player.level}] 달성!`, '#fd0');
        if (typeof playSound === 'function') playSound('spell');
    }
    
    if (leveledUp) {
        if (typeof updateUI === 'function') updateUI(); 
        player.hp = currentMaxHp; 
        player.mp = currentMaxMp;
        if (typeof updateUI === 'function') updateUI();
    }
};

function drawHumanoid(ctx, name, color, sz, isAttacking, isMoving, frame, isHit, timestamp) {
    ctx.save();
    let safeName = String(name || '').replace(/\(.*\)/g, '').trim();
    let s = sz || 20;
    let atkY = isAttacking ? -s * 0.6 : 0;
    let ts = typeof timestamp === 'number' ? timestamp : performance.now();

    if (isHit) { ctx.globalAlpha = 0.8; ctx.filter = 'brightness(200%)'; }

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(0, s * 0.75, s * 1.1, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();

    function drawBipedLegs(col, w, h, xOff) {
        ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        let walkSway = isMoving ? Math.sin(ts / 90) * (s * 0.25) : 0; 
        ctx.fillRect(-xOff - w / 2, 0, w, h - walkSway); ctx.strokeRect(-xOff - w / 2, 0, w, h - walkSway);
        ctx.fillRect(xOff - w / 2, 0, w, h + walkSway); ctx.strokeRect(xOff - w / 2, 0, w, h + walkSway);
    }

    function drawQuadLegs(col, bWidth, lHeight) {
        ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        let step1 = isMoving ? Math.sin(ts / 90) * (s * 0.22) : 0;
        let step2 = isMoving ? Math.sin(ts / 90 + Math.PI) * (s * 0.22) : 0;
        ctx.fillRect(-bWidth*0.6, -s*0.1, s*0.25, lHeight + step1); 
        ctx.fillRect(bWidth*0.4, -s*0.1, s*0.25, lHeight + step2); 
        ctx.fillRect(-bWidth*0.2, -s*0.1, s*0.25, lHeight + step2); 
        ctx.fillRect(bWidth*0.6, -s*0.1, s*0.25, lHeight + step1); 
    }

    if (safeName.includes('오염된')) { ctx.shadowBlur = 10; ctx.shadowColor = '#84cc16'; }

    if (safeName.includes('슬라임') || safeName.includes('브롭') || safeName.includes('정령') || safeName.includes('파이어 에그') || safeName.includes('해파리')) {
        let isBrome = safeName.includes('브롭');
        let isSpirit = safeName.includes('정령') || safeName.includes('파이어 에그') || safeName.includes('해파리');
        let floatY = isSpirit ? Math.sin(ts/150)*s*0.2 : 0;

        let squishX = (isMoving && !isSpirit) ? Math.sin(ts/100) * 0.15 : 0;
        let squishY = (isMoving && !isSpirit) ? Math.cos(ts/100) * 0.15 : 0;
        ctx.translate(0, s*0.5); ctx.scale(1 + squishX, 1 - squishY); ctx.translate(0, -s*0.5);

        ctx.fillStyle = color || (safeName.includes('슬라임') ? 'rgba(30, 200, 80, 0.8)' : 'rgba(255, 100, 50, 0.8)');
        if (safeName.includes('해파리')) ctx.fillStyle = 'rgba(150, 220, 255, 0.6)';
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1;

        if (isBrome) {
            ctx.beginPath(); ctx.ellipse(0, s*0.4, s*1.2, s*0.3, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#555'; ctx.beginPath(); ctx.ellipse(s*0.3, s*0.3, s*0.2, s*0.1, 0, 0, Math.PI*2); ctx.fill();
        } else if (isSpirit) {
            ctx.shadowBlur = 15; ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(0, -s*0.5 + floatY, s*0.8 + (Math.sin(ts/100)*3), 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
            if(safeName.includes('해파리')) { 
                ctx.strokeStyle = '#e0f2fe'; ctx.lineWidth = 2;
                for(let i=-2; i<=2; i++) {
                    let tSway = Math.sin(ts/80 + i)*s*0.3;
                    ctx.beginPath(); ctx.moveTo(i*s*0.2, -s*0.2 + floatY); ctx.quadraticCurveTo(i*s*0.4, s*0.4, i*s*0.2 + tSway, s*0.8 + floatY); ctx.stroke();
                }
            }
        } else {
            ctx.beginPath(); ctx.moveTo(-s*0.8, s*0.5); ctx.quadraticCurveTo(-s*0.8, -s*0.8, 0, -s*0.8);
            ctx.quadraticCurveTo(s*0.8, -s*0.8, s*0.8, s*0.5); ctx.quadraticCurveTo(0, s*0.7, -s*0.8, s*0.5); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'; ctx.beginPath(); ctx.ellipse(-s*0.3, -s*0.4, s*0.2, s*0.1, -Math.PI/6, 0, Math.PI*2); ctx.fill();
        }
    }
    else if ((safeName.includes('늑대') && !safeName.includes('인간')) || safeName.includes('도베르만') || safeName.includes('셰퍼드') || safeName.includes('멧돼지') || safeName.includes('유니콘') || safeName.includes('다이어 울프')) {
        let isBoar = safeName.includes('멧돼지');
        let isUni = safeName.includes('유니콘');
        let skin = color || (isBoar ? '#4a3219' : (safeName.includes('도베르만') ? '#1a1a1a' : '#4d4d4d'));
        ctx.fillStyle = skin; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;

        let bW = isBoar ? s*1.4 : (isUni ? s*1.2 : s*1.3);
        let bH = isBoar ? s*0.8 : (isUni ? s*0.8 : s*0.5);

        ctx.beginPath(); ctx.ellipse(0, -s*0.5, bW, bH, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
        let headY = isUni ? -s*1.2 : -s*0.7;
        ctx.beginPath(); ctx.ellipse(-bW*0.9, headY, s*0.4, s*0.3, -Math.PI/6, 0, Math.PI*2); ctx.fill(); ctx.stroke();

        ctx.beginPath();
        if (isBoar) {
            ctx.moveTo(bW*0.9, -s*0.5); ctx.lineTo(bW*1.1, -s*0.3); ctx.stroke(); 
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-bW*1.1, headY); ctx.lineTo(-bW*1.4, headY-s*0.3); ctx.lineTo(-bW*0.9, headY-s*0.1); ctx.fill();
        } else if (isUni) {
            ctx.fillStyle = '#6ee'; ctx.beginPath(); ctx.ellipse(bW, -s*0.5, s*0.4, s*0.8, Math.PI/4, 0, Math.PI*2); ctx.fill(); 
            ctx.strokeStyle = '#fd0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-bW*1.0, headY-s*0.2); ctx.lineTo(-bW*1.4, headY-s*0.8); ctx.stroke(); 
        } else {
            let tailSway = isMoving ? Math.sin(ts/80)*s*0.3 : 0;
            ctx.moveTo(bW*0.9, -s*0.6); ctx.quadraticCurveTo(bW*1.3, -s*0.8 + tailSway, bW*1.5, -s*0.2 + tailSway); ctx.stroke(); 
        }

        if (safeName.includes('도베르만') || safeName.includes('셰퍼드')) {
            ctx.fillStyle = '#b87333'; ctx.fillRect(-bW*1.0, -s*0.7, s*0.3, s*0.2); 
            ctx.fillStyle = skin; ctx.beginPath(); ctx.moveTo(-bW*0.9, -s*0.9); ctx.lineTo(-bW*0.7, -s*1.3); ctx.lineTo(-bW*0.5, -s*0.9); ctx.fill(); 
        }
        drawQuadLegs(skin, bW, isUni ? s*1.0 : s*0.65);
    }
    else if (safeName.includes('고블린') || safeName.includes('그렘린') || safeName.includes('코볼트') || safeName.includes('임프') || safeName.includes('난쟁이')) {
        let isKobold = safeName.includes('코볼트');
        let isImp = safeName.includes('임프');
        let isDwarf = safeName.includes('난쟁이');

        let skin = isKobold ? '#6d4c41' : (isImp ? '#f5f5dc' : (isDwarf ? '#4a5d23' : '#6b8e23'));
        let sway = isImp ? Math.sin(ts/150)*s*0.3 : 0; 

        if (isDwarf || isKobold || safeName.includes('그렘린')) {
            ctx.fillStyle = '#3e2723';
            ctx.beginPath(); ctx.ellipse(s*0.2, -s*0.6 + sway, s*0.4, s*0.6, Math.PI/6, 0, Math.PI*2); ctx.fill();
        }

        ctx.fillStyle = skin; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, -s*0.6 + sway, s*0.45, s*0.5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
        
        if (!isImp && !isDwarf) {
            ctx.beginPath(); ctx.moveTo(-s*0.2, -s*1.0); ctx.lineTo(-s*1.2, -s*1.1); ctx.lineTo(-s*0.3, -s*0.8); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(s*0.2, -s*1.0); ctx.lineTo(s*1.2, -s*1.1); ctx.lineTo(s*0.3, -s*0.8); ctx.fill(); ctx.stroke();
        }

        ctx.beginPath(); ctx.arc(0, -s*1.0 + sway, s*0.35, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
        
        if (isDwarf) {
            ctx.fillStyle = '#f0c8a0'; ctx.beginPath(); ctx.arc(0, -s*0.9, s*0.25, 0, Math.PI*2); ctx.fill(); 
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.8); ctx.lineTo(0, -s*0.4); ctx.lineTo(s*0.3, -s*0.8); ctx.fill(); 
            ctx.fillStyle = '#333'; ctx.fillRect(-s*0.7, atkY - s*1.0, 3, s*1.5);
            ctx.fillStyle = '#94a3b8'; ctx.beginPath(); ctx.arc(-s*0.7, atkY - s*0.8, s*0.35, Math.PI*0.5, Math.PI*1.5); ctx.fill();
        } else if (isKobold) {
            ctx.fillStyle = '#4e342e'; ctx.beginPath(); ctx.ellipse(-s*0.5, atkY - s*0.5 + sway, s*0.2, s*0.6, Math.PI/4, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
        } else if (isImp) {
            ctx.fillStyle = '#5c4033'; ctx.fillRect(s*0.4, atkY - s*1.6 + sway, 3, s*2.2); 
            if (safeName.includes('장로')) { ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(s*0.4, atkY - s*1.6 + sway, s*0.15, 0, Math.PI*2); ctx.fill(); } 
        } else {
            ctx.fillStyle = '#bdc3c7'; ctx.beginPath(); ctx.moveTo(-s*0.5, atkY - s*0.4 + sway); ctx.lineTo(-s*0.8, atkY - s*1.0 + sway); ctx.lineTo(-s*0.3, atkY - s*0.4 + sway); ctx.fill(); 
        }

        if (!isImp) drawBipedLegs(skin, s*0.2, s*0.5, s*0.15);
    }
    else if (safeName.includes('오크') || safeName.includes('오우거') || safeName.includes('미노타우르스') || safeName.includes('예티') || safeName.includes('골렘')) {
        let isOgre = safeName.includes('오우거');
        let skin = color || '#2e5a1b';
        ctx.fillStyle = skin; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;

        ctx.beginPath(); ctx.ellipse(0, -s*1.0, isOgre ? s*1.4 : s*0.9, isOgre ? s*1.2 : s*0.7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        
        if (safeName.includes('전사')) {
            ctx.fillStyle = '#2f3640'; ctx.beginPath(); ctx.ellipse(0, -s*1.0, s*0.95, s*0.4, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#7f8c8d'; ctx.beginPath(); ctx.arc(-s*0.8, -s*1.1, s*0.3, 0, Math.PI*2); ctx.fill(); 
        }

        ctx.fillStyle = skin;
        ctx.beginPath(); ctx.arc(-s*0.3, -s*1.5, isOgre ? s*0.5 : s*0.35, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        
        if (safeName.includes('미노타우르스')) {
            ctx.fillStyle = '#e5e7eb'; 
            ctx.beginPath(); ctx.moveTo(-s*0.2, -s*1.7); ctx.lineTo(-s*0.8, -s*2.2); ctx.lineTo(0, -s*1.7); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(s*0.2, -s*1.7); ctx.lineTo(s*0.8, -s*2.2); ctx.lineTo(0, -s*1.7); ctx.fill(); ctx.stroke();
        } else if (safeName.includes('예티') || safeName.includes('골렘')) {
            let punchY = isAttacking ? -s*1.5 : 0;
            ctx.beginPath(); ctx.ellipse(-s*1.2, -s*0.2 + punchY, s*0.6, s*0.8, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.ellipse(s*1.2, -s*0.2, s*0.6, s*0.8, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        } else {
            ctx.fillStyle = '#ff0000'; ctx.fillRect(-s*0.45, -s*1.6, s*0.15, s*0.1); 
            ctx.fillStyle = '#eaddcd'; ctx.beginPath(); ctx.moveTo(-s*0.5, -s*1.3); ctx.lineTo(-s*0.6, -s*1.5); ctx.lineTo(-s*0.3, -s*1.3); ctx.fill(); 
        }

        if (safeName.includes('궁수')) {
            ctx.strokeStyle = '#5c4033'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-s*0.7, atkY - s*0.6, s*0.8, -Math.PI/1.5, Math.PI/1.5); ctx.stroke(); 
        } else if (!safeName.includes('예티') && !safeName.includes('골렘')) {
            ctx.fillStyle = '#4e342e'; ctx.fillRect(-s*0.9, atkY - s*1.4, 4, isOgre ? s*3.0 : s*2.2); 
            ctx.fillStyle = '#7f8c8d'; ctx.beginPath(); ctx.moveTo(-s*0.9, atkY - s*1.0); ctx.lineTo(-s*1.5, atkY - s*1.2); ctx.lineTo(-s*1.5, atkY - s*0.6); ctx.fill();
        }
        
        drawBipedLegs(skin, isOgre ? s*0.5 : s*0.35, s*0.8, isOgre ? s*0.5 : s*0.3);
    }
    else if (safeName.includes('해골') || safeName.includes('스파토이')) {
        let isSpartoi = safeName.includes('스파토이');
        ctx.fillStyle = isSpartoi ? '#cbd5e1' : '#e2e8f0'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1;

        ctx.fillRect(-s*0.25, -s*1.1, s*0.5, s*0.6); ctx.strokeRect(-s*0.25, -s*1.1, s*0.5, s*0.6);
        ctx.fillStyle = '#111'; 
        ctx.fillRect(-s*0.25, -s*1.0, s*0.5, 2); ctx.fillRect(-s*0.25, -s*0.8, s*0.5, 2); ctx.fillRect(-s*0.25, -s*0.6, s*0.5, 2);

        ctx.fillStyle = isSpartoi ? '#e2e8f0' : '#f8fafc'; ctx.beginPath(); ctx.arc(0, -s*1.4, s*0.3, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#000'; ctx.fillRect(-s*0.15, -s*1.45, s*0.1, s*0.15); ctx.fillRect(s*0.05, -s*1.45, s*0.1, s*0.15); 

        if (safeName.includes('궁수') || safeName.includes('저격병')) {
            ctx.strokeStyle = '#8b4513'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-s*0.5, atkY - s*0.5, s*0.7, -Math.PI/2, Math.PI/2); ctx.stroke();
        } else {
            ctx.fillStyle = '#2c3e50'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(s*0.2, -s*1.1); ctx.lineTo(s*0.6, -s*1.1); ctx.lineTo(s*0.6, -s*0.4); ctx.lineTo(s*0.4, -s*0.1); ctx.lineTo(s*0.2, -s*0.4); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#94a3b8'; ctx.fillRect(-s*0.7, atkY - s*1.3, 3, s*2.0); 
        }
        drawBipedLegs(ctx.fillStyle, 4, s*0.8, s*0.15); 
    }
    else if (safeName.includes('좀비') || safeName.includes('구울')) {
        let isGhoul = safeName.includes('구울');
        ctx.fillStyle = isGhoul ? '#84cc16' : '#778ca3'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;

        ctx.beginPath(); ctx.ellipse(0, -s*0.9, s*0.4, s*0.9, Math.PI/10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(s*0.2, -s*1.6, s*0.35, s*0.4, Math.PI/4, 0, Math.PI*2); ctx.fill(); ctx.stroke();

        ctx.fillRect(-s*1.0, atkY - s*1.2, s*0.9, s*0.2); ctx.strokeRect(-s*1.0, atkY - s*1.2, s*0.9, s*0.2);
        ctx.fillRect(-s*1.0, atkY - s*0.9, s*0.7, s*0.2); ctx.strokeRect(-s*1.0, atkY - s*0.9, s*0.7, s*0.2);

        let limp = isMoving ? Math.sin(ts/150)*s*0.4 : 0;
        ctx.fillRect(-s*0.2, 0, s*0.2, s*0.8); 
        ctx.fillRect(s*0.2, 0, s*0.2, s*0.8 + limp); 
    }
    else if (safeName.includes('개미') || safeName.includes('거미') || safeName.includes('셀로브') || safeName.includes('전갈') || safeName.includes('아라크네') || safeName.includes('웅골리언트')) {
        let isAnt = safeName.includes('개미');
        ctx.fillStyle = color || '#800'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;

        if (isAnt) {
            ctx.beginPath(); ctx.ellipse(-s*0.5, -s*0.4, s*0.7, s*0.5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
            ctx.beginPath(); ctx.ellipse(s*0.3, -s*0.4, s*0.4, s*0.3, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
            ctx.beginPath(); ctx.arc(s*0.8, -s*0.4, s*0.25, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
            ctx.beginPath(); ctx.moveTo(s*1.0, -s*0.4); ctx.lineTo(s*1.2, atkY - s*0.2); ctx.moveTo(s*1.0, -s*0.3); ctx.lineTo(s*1.2, atkY); ctx.stroke();
        } else {
            ctx.beginPath(); ctx.ellipse(-s*0.5, -s*0.8, s*1.0, s*0.7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
            ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(s*0.5, -s*0.5, s*0.4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#f00'; ctx.fillRect(s*0.6, -s*0.6, 4, 4); ctx.fillRect(s*0.8, -s*0.5, 4, 4); 
            if(safeName.includes('전갈')) { 
                ctx.strokeStyle = color; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(-s*1.5, -s*0.8); ctx.lineTo(-s*2.0, -s*1.5); ctx.lineTo(-s*1.0, -s*2.0); ctx.lineTo(-s*0.5, -s*1.5 + atkY); ctx.stroke();
            }
        }

        ctx.strokeStyle = '#222'; ctx.lineWidth = 2.5;
        let legSway = isMoving ? Math.sin(ts/50)*s*0.3 : 0;
        let legs = isAnt ? 3 : 4;
        ctx.beginPath();
        for(let i=0; i<legs; i++) {
            let sDir = i%2 === 0 ? legSway : -legSway;
            ctx.moveTo(-s*0.2, -s*0.4); ctx.lineTo(-s*1.0 + i*s*0.5, -s*1.2 + sDir); ctx.lineTo(-s*1.3 + i*s*0.8, 0);
            ctx.moveTo(s*0.2, -s*0.4); ctx.lineTo(s*1.0 - i*s*0.5, -s*1.2 - sDir); ctx.lineTo(s*1.3 - i*s*0.8, 0);
        }
        ctx.stroke();
    }
    else if (safeName.includes('늑대인간') || safeName.includes('웨어울프') || safeName.includes('하피') || safeName.includes('머메이드') || safeName.includes('머맨') || safeName.includes('코카트리스') || safeName.includes('바실리스크')) {
        ctx.fillStyle = color || '#888'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;

        if (safeName.includes('늑대인간') || safeName.includes('웨어울프')) {
            ctx.beginPath(); ctx.ellipse(0, -s*0.8, s*0.7, s*0.9, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.ellipse(-s*0.2, -s*1.6, s*0.4, s*0.3, -Math.PI/6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-s*0.1, -s*1.8); ctx.lineTo(0, -s*2.3); ctx.lineTo(s*0.2, -s*1.7); ctx.fill(); 
            let armSway = isMoving ? Math.sin(ts/80)*s*0.4 : 0;
            ctx.fillRect(-s*0.7, atkY - s*1.0 + armSway, s*0.3, s*0.8); ctx.fillRect(s*0.4, atkY - s*1.0 - armSway, s*0.3, s*0.8);
            ctx.fillStyle = '#3e2723'; ctx.fillRect(s*0.5, atkY - s*1.8 - armSway, 4, s*2.5);
            drawBipedLegs(color, s*0.3, s*0.8, s*0.15);
        } 
        else if (safeName.includes('하피') || safeName.includes('머메이드') || safeName.includes('머맨')) {
            ctx.beginPath(); ctx.ellipse(0, -s*1.5, s*0.5, s*0.7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fbcfe8'; ctx.beginPath(); ctx.arc(0, -s*2.4, s*0.4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            if (safeName.includes('하피')) {
                ctx.fillStyle = color; let flap = isMoving ? Math.sin(ts/50)*s*0.6 : 0;
                ctx.beginPath(); ctx.moveTo(-s*0.3, -s*1.5); ctx.lineTo(-s*2.5, -s*2.5 + flap); ctx.lineTo(-s*1.0, -s*0.5); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(s*0.3, -s*1.5); ctx.lineTo(s*2.5, -s*2.5 + flap); ctx.lineTo(s*1.0, -s*0.5); ctx.fill(); ctx.stroke();
                drawBipedLegs('#d97706', s*0.15, s*0.8, s*0.2); 
            } else {
                ctx.fillStyle = color; let tail = isMoving ? Math.sin(ts/80)*s*0.5 : 0;
                ctx.beginPath(); ctx.moveTo(-s*0.5, -s*0.8); ctx.quadraticCurveTo(-s*1.5, 0, -s*2.0, -s*0.2 + tail); ctx.lineTo(-s*2.2, s*0.5 + tail); ctx.lineTo(-s*1.6, -s*0.2 + tail); ctx.quadraticCurveTo(-s*0.5, s*0.5, s*0.5, -s*0.8); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#ccc'; ctx.fillRect(s*0.6, atkY - s*2.5, 3, s*3.0);
            }
        } 
        else { 
            ctx.beginPath(); ctx.ellipse(0, -s*1.0, s*1.4, s*0.8, Math.PI/8, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-s*0.5, -s*1.2); ctx.lineTo(-s*1.5, -s*2.0); ctx.lineTo(-s*1.0, -s*0.5); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(-s*1.4, -s*1.9, s*0.4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            if (safeName.includes('바실리스크')) drawQuadLegs(color, s*1.0, s*0.6); 
            else drawBipedLegs('#fde047', s*0.2, s*0.8, s*0.4); 
        }
    }
    else if (safeName.includes('흑기사') || safeName.includes('데스나이트') || safeName.includes('바포메트') || safeName.includes('장로') || safeName.includes('마법사') || safeName.includes('네크로맨서') || safeName.includes('투사') || safeName.includes('검사') || safeName.includes('도끼병') || safeName.includes('리치')) {
        let isMage = safeName.includes('바포메트') || safeName.includes('장로') || safeName.includes('마법사') || safeName.includes('네크로맨서') || safeName.includes('리치');
        ctx.fillStyle = color || '#1a1a1a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;

        if (isMage) {
            ctx.beginPath(); ctx.moveTo(-s*0.2, -s*1.4); ctx.lineTo(-s*0.7, s*0.2); ctx.lineTo(s*0.7, s*0.2); ctx.lineTo(s*0.2, -s*1.4); ctx.fill(); ctx.stroke(); 
            ctx.beginPath(); ctx.moveTo(0, -s*2.0); ctx.lineTo(s*0.3, -s*1.4); ctx.lineTo(-s*0.3, -s*1.4); ctx.fill(); ctx.stroke(); 
            
            if (safeName.includes('바포메트')) {
                ctx.fillStyle = '#ff0000'; ctx.fillRect(-s*0.1, -s*1.5, s*0.08, s*0.08); ctx.fillRect(s*0.02, -s*1.5, s*0.08, s*0.08); 
                ctx.strokeStyle = '#555'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s*0.6, s*0.2); ctx.lineTo(s*0.8, atkY - s*2.5); ctx.stroke(); 
                ctx.fillStyle = '#999'; ctx.beginPath(); ctx.moveTo(s*0.6, atkY - s*2.5); ctx.lineTo(s*0.8, atkY - s*3.0); ctx.lineTo(s*1.0, atkY - s*2.5); ctx.fill(); 
            } else {
                ctx.strokeStyle = '#5a4a30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s*0.5, s*0.2); ctx.lineTo(s*0.6, atkY - s*1.7); ctx.stroke(); 
                ctx.fillStyle = '#9b30ff'; ctx.beginPath(); ctx.arc(s*0.6, atkY - s*1.8, s*0.15, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            }
        } else {
            ctx.beginPath(); ctx.roundRect(-s*0.6, -s*1.1, s*1.2, s*1.1, 4); ctx.fill(); ctx.stroke(); 
            ctx.beginPath(); ctx.arc(0, -s*1.35, s*0.35, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
            ctx.fillStyle = '#94a3b8'; ctx.strokeStyle = '#000'; 
            
            if (safeName.includes('데스나이트')) {
                ctx.fillStyle = '#ff2200'; ctx.fillRect(-s*0.22, -s*1.4, s*0.18, s*0.1); ctx.fillRect(s*0.04, -s*1.4, s*0.18, s*0.1); 
                ctx.fillStyle = '#ff4400'; ctx.strokeStyle = '#661100'; 
            }
            
            if (safeName.includes('도끼병')) {
                ctx.fillRect(s*0.6, atkY - s*0.5, 3, s*2.0); 
                ctx.beginPath(); ctx.arc(s*0.6, atkY + s*0.2, s*0.4, -Math.PI*0.5, Math.PI*0.5); ctx.fill(); 
            } else {
                ctx.beginPath(); ctx.moveTo(s*0.6, atkY); ctx.lineTo(s*1.6, atkY - s*2.5); ctx.lineTo(s*1.9, atkY - s*2.2); ctx.lineTo(s*0.8, atkY + s*0.2); ctx.fill(); ctx.stroke(); 
            }
            drawBipedLegs(color, s*0.3, s*0.8, s*0.15);
        }
    }
    else if (safeName.includes('괴물 눈') || safeName.includes('크로') || safeName.includes('실라칸스') || safeName.includes('악어') || safeName.includes('가고일')) {
        ctx.fillStyle = color || '#aaa'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;

        if (safeName.includes('괴물 눈')) {
            let floatY = Math.sin(ts/150)*s*0.2;
            ctx.beginPath(); ctx.arc(0, -s*1.0 + floatY, s*0.8, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#b91c1c'; ctx.beginPath(); ctx.arc(0, -s*1.0 + floatY, s*0.4, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -s*1.0 + floatY, s*0.15, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#c0392b'; ctx.strokeStyle = '#555';
            for(let i=-1; i<=1; i++) {
                let tSway = Math.sin(ts/100 + i)*s*0.2;
                ctx.beginPath(); ctx.moveTo(i*s*0.4, -s*0.4 + floatY); ctx.lineTo(i*s*0.5, s*0.2 + floatY + tSway); ctx.lineTo(i*s*0.2, -s*0.4 + floatY); ctx.fill(); ctx.stroke();
            }
        } else if (safeName.includes('크로')) {
            ctx.beginPath(); ctx.ellipse(0, -s*0.3, s*0.6, s*0.3, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            let crawlY = isMoving ? Math.sin(ts/50)*s*0.2 : 0;
            ctx.beginPath(); ctx.moveTo(-s*0.4, -s*0.3); ctx.lineTo(-s*0.8, -s*0.1 + crawlY); ctx.lineTo(-s*0.9, s*0.2 + crawlY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.3); ctx.lineTo(-s*0.3, -s*0.1 - crawlY); ctx.lineTo(-s*0.4, s*0.2 - crawlY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(s*0.2, -s*0.3); ctx.lineTo(s*0.3, -s*0.1 + crawlY); ctx.lineTo(s*0.4, s*0.2 + crawlY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(s*0.5, -s*0.3); ctx.lineTo(s*0.7, -s*0.1 - crawlY); ctx.lineTo(s*0.8, s*0.2 - crawlY); ctx.stroke();
        } else if (safeName.includes('실라칸스') || safeName.includes('악어')) {
            let len = s*1.4;
            ctx.beginPath(); ctx.ellipse(0, -s*0.3, len, s*0.4, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); 
            let flap = isMoving ? Math.sin(ts/60)*s*0.5 : 0;
            ctx.beginPath(); ctx.moveTo(0, -s*0.7); ctx.lineTo(-s*0.5, -s*1.2); ctx.lineTo(s*0.5, -s*0.7); ctx.fill(); 
            ctx.beginPath(); ctx.moveTo(len, -s*0.3); ctx.lineTo(len+s*0.8, -s*0.7 + flap); ctx.lineTo(len+s*0.8, s*0.1 + flap); ctx.fill(); 
        } else { 
            let wingFlap = isMoving ? Math.sin(ts/80)*s*0.5 : 0;
            ctx.beginPath(); ctx.moveTo(0, -s*0.8); ctx.lineTo(-s*1.8, -s*1.8 + wingFlap); ctx.lineTo(-s*0.5, 0); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -s*0.8); ctx.lineTo(s*1.8, -s*1.8 + wingFlap); ctx.lineTo(s*0.5, 0); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, -s*1.0, s*0.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        }
    }
    else if (safeName.includes('엔트') || safeName.includes('펑거스') || safeName.includes('플라워')) {
        if (safeName.includes('펑거스')) { 
            ctx.fillStyle = '#f5deb3'; ctx.fillRect(-s*0.2, -s*0.6, s*0.4, s*0.6); 
            ctx.fillStyle = color || '#8b4513'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.ellipse(0, -s*0.6, s*0.7, s*0.4, 0, Math.PI, Math.PI*2); ctx.fill(); ctx.stroke(); 
        } else { 
            ctx.fillStyle = '#4a3219'; ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
            ctx.fillRect(-s*0.4, -s*1.6, s*0.8, s*1.6); ctx.strokeRect(-s*0.4, -s*1.6, s*0.8, s*1.6); 
            ctx.fillStyle = color || '#228b22'; 
            ctx.beginPath(); ctx.arc(0, -s*1.8, s*0.9, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(-s*0.6, -s*1.4, s*0.7, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(s*0.6, -s*1.4, s*0.7, 0, Math.PI*2); ctx.fill();
            if (isAttacking) { 
                ctx.strokeStyle = '#4a3219'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(-s*0.4, -s*1.0); ctx.lineTo(-s*1.5, atkY - s*1.2); ctx.stroke();
            }
        }
    }
    else {
        ctx.fillStyle = color || '#888'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, -s*0.6, s*0.45, s*0.5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -s*1.0, s*0.35, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        drawBipedLegs(color, s*0.2, s*0.5, s*0.15);
        ctx.fillStyle = '#aaa'; ctx.fillRect(s*0.6, atkY - s*0.5, 3, s*2.0); 
    }

    ctx.restore();
}

// ==========================================
// 👑 [보스 몬스터 초정밀 원작 스타일 렌더링 - 60FPS 최적화 버전]
// ==========================================
function drawBossDetailed(ctx, name, sz, isAttacking, isMoving, isHit, ts) {
    ctx.save();
    let s = sz * 1.35; // 웅장한 보스 스케일
    let atkY = isAttacking ? -s * 0.45 : 0;
    let safeName = String(name || '').trim();

    if (isHit) {
        ctx.globalAlpha = 0.85;
        ctx.filter = 'brightness(230%)';
    }

    // 💡 [최적화] CPU 렉을 유발하는 shadowBlur를 완전히 제거하고 레이어 그래디언트로 대체
    ctx.shadowBlur = 0;

    // [1] 바닥 암흑 마법 오라 & 룬 진동 그림자
    ctx.save();
    ctx.scale(1, 0.35);
    let shadowPulse = Math.sin(ts / 150) * (s * 0.1);
    let sGrad = ctx.createRadialGradient(0, s * 2.2, 0, 0, s * 2.2, s * 1.5 + shadowPulse);
    sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    sGrad.addColorStop(0.5, 'rgba(45, 0, 0, 0.45)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sGrad;
    ctx.beginPath(); ctx.arc(0, s * 2.2, s * 1.5 + shadowPulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // ----------------------------------------------------
    // 🔥 [1] 데스나이트 (Death Knight)
    // ----------------------------------------------------
    if (safeName.includes('데스나이트')) {
        let capeSway = isMoving ? Math.sin(ts / 100) * (s * 0.25) : Math.sin(ts / 200) * (s * 0.08);

        // 1. 찢어진 흑적색 3단 망토
        ctx.fillStyle = '#1a0303';
        ctx.strokeStyle = '#050000'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-s * 0.6, -s * 0.8);
        ctx.bezierCurveTo(-s * 1.2 + capeSway, 0, -s * 1.3 + capeSway, s * 0.8, -s * 0.9 + capeSway, s * 1.05);
        ctx.lineTo(-s * 0.4, s * 0.7);
        ctx.lineTo(0, s * 1.0 + capeSway * 0.5);
        ctx.lineTo(s * 0.4, s * 0.7);
        ctx.lineTo(s * 0.9 - capeSway, s * 1.05);
        ctx.bezierCurveTo(s * 1.3 - capeSway, s * 0.8, s * 1.2 - capeSway, 0, s * 0.6, -s * 0.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // 2. 판금 정강이 갑옷 & 무릎 가시 스파이크
        let legStep = isMoving ? Math.sin(ts / 80) * (s * 0.22) : 0;
        let legGrad = ctx.createLinearGradient(0, 0, 0, s * 0.9);
        legGrad.addColorStop(0, '#334155'); legGrad.addColorStop(0.5, '#1e293b'); legGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = legGrad; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;

        // 좌/우 다리
        ctx.fillRect(-s * 0.5, 0, s * 0.38, s * 0.85 - legStep);
        ctx.strokeRect(-s * 0.5, 0, s * 0.38, s * 0.85 - legStep);
        ctx.fillRect(s * 0.12, 0, s * 0.38, s * 0.85 + legStep);
        ctx.strokeRect(s * 0.12, 0, s * 0.38, s * 0.85 + legStep);

        // 무릎 스파이크
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, s * 0.3 - legStep); ctx.lineTo(-s * 0.7, s * 0.4 - legStep); ctx.lineTo(-s * 0.5, s * 0.5 - legStep); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 0.5, s * 0.3 + legStep); ctx.lineTo(s * 0.7, s * 0.4 + legStep); ctx.lineTo(s * 0.5, s * 0.5 + legStep); ctx.fill(); ctx.stroke();

        // 3. 고딕 흑철 흉갑 & 황금/피 문양
        let chestGrad = ctx.createLinearGradient(0, -s * 1.0, 0, 0);
        chestGrad.addColorStop(0, '#475569'); chestGrad.addColorStop(0.4, '#1e293b'); chestGrad.addColorStop(1, '#090d16');
        ctx.fillStyle = chestGrad;
        ctx.beginPath(); ctx.roundRect(-s * 0.7, -s * 1.0, s * 1.4, s * 1.0, 5); ctx.fill(); ctx.stroke();

        // 흉부 해골 갈비뼈 문양
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            ctx.moveTo(-s * 0.45, -s * 0.8 + i * s * 0.22);
            ctx.lineTo(0, -s * 0.7 + i * s * 0.22);
            ctx.lineTo(s * 0.45, -s * 0.8 + i * s * 0.22);
        }
        ctx.stroke();

        // 4. 거대 악마형 견갑 (어깨 스파이크)
        ctx.fillStyle = '#334155'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        // 좌측 어깨 삼중 가시
        ctx.beginPath();
        ctx.moveTo(-s * 0.6, -s * 0.85); ctx.lineTo(-s * 1.25, -s * 1.45); ctx.lineTo(-s * 0.8, -s * 0.75);
        ctx.lineTo(-s * 1.15, -s * 1.1); ctx.lineTo(-s * 0.6, -s * 0.65); ctx.fill(); ctx.stroke();
        // 우측 어깨 삼중 가시
        ctx.beginPath();
        ctx.moveTo(s * 0.6, -s * 0.85); ctx.lineTo(s * 1.25, -s * 1.45); ctx.lineTo(s * 0.8, -s * 0.75);
        ctx.lineTo(s * 1.15, -s * 1.1); ctx.lineTo(s * 0.6, -s * 0.65); ctx.fill(); ctx.stroke();

        // 5. 해골 투구 & 날개형 투구 장식
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.arc(0, -s * 1.3, s * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // 투구 상단 왕관 뿔
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.moveTo(-s * 0.25, -s * 1.55); ctx.lineTo(-s * 0.55, -s * 2.05); ctx.lineTo(-s * 0.1, -s * 1.55);
        ctx.lineTo(0, -s * 1.85);
        ctx.lineTo(s * 0.1, -s * 1.55); ctx.lineTo(s * 0.55, -s * 2.05); ctx.lineTo(s * 0.25, -s * 1.55);
        ctx.fill(); ctx.stroke();

        // 💡 [최적화] shadowBlur 대신 이중 레이어로 불타는 붉은 안광 표현
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.arc(-s * 0.18, -s * 1.32, s * 0.14, 0, Math.PI * 2);
        ctx.arc(s * 0.18, -s * 1.32, s * 0.14, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ff1100';
        ctx.beginPath();
        ctx.ellipse(-s * 0.18, -s * 1.32, s * 0.09, s * 0.045, -Math.PI / 8, 0, Math.PI * 2);
        ctx.ellipse(s * 0.18, -s * 1.32, s * 0.09, s * 0.045, Math.PI / 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-s * 0.19, -s * 1.33, 2, 2);
        ctx.fillRect(s * 0.17, -s * 1.33, 2, 2);

        // 6. 진 데스나이트의 불타는 장검 (블레이드)
        ctx.save();
        ctx.translate(s * 0.8, atkY - s * 0.3);
        ctx.rotate(isAttacking ? Math.PI / 3 : -Math.PI / 6);

        // 검신 외곽 화염 잔상 레이어
        ctx.fillStyle = 'rgba(255, 60, 0, 0.35)';
        ctx.beginPath();
        ctx.moveTo(-s * 0.22, 0);
        ctx.lineTo(-s * 0.15, -s * 2.8);
        ctx.lineTo(0, -s * 3.45);
        ctx.lineTo(s * 0.15, -s * 2.8);
        ctx.lineTo(s * 0.22, 0);
        ctx.closePath(); ctx.fill();

        // 검신 본체 그라데이션
        let bGrad = ctx.createLinearGradient(0, -s * 3.2, 0, 0);
        bGrad.addColorStop(0, '#ffffff');
        bGrad.addColorStop(0.25, '#ffea00');
        bGrad.addColorStop(0.65, '#ff2200');
        bGrad.addColorStop(1, '#3b0000');
        ctx.fillStyle = bGrad;
        ctx.beginPath();
        ctx.moveTo(-s * 0.16, 0);
        ctx.lineTo(-s * 0.1, -s * 2.7);
        ctx.lineTo(0, -s * 3.3);
        ctx.lineTo(s * 0.1, -s * 2.7);
        ctx.lineTo(s * 0.16, 0);
        ctx.closePath(); ctx.fill();

        // 십자 코어 혈선
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 2.8); ctx.stroke();
        ctx.restore();
    }
    // ----------------------------------------------------
    // 🐐 [2] 바포메트 (Baphomet)
    // ----------------------------------------------------
    else if (safeName.includes('바포메트')) {
        let wingMotion = Math.sin(ts / 80) * (s * 0.25);

        // 1. 거대 악마 피막 날개 (좌/우)
        ctx.fillStyle = '#260808'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
        // 좌측 날개 골격 & 피막
        ctx.beginPath();
        ctx.moveTo(-s * 0.3, -s * 1.1);
        ctx.bezierCurveTo(-s * 1.8, -s * 2.5 + wingMotion, -s * 2.6, -s * 1.5 + wingMotion, -s * 2.4, -s * 0.2 + wingMotion);
        ctx.lineTo(-s * 1.8, -s * 0.3); ctx.lineTo(-s * 1.4, s * 0.2); ctx.lineTo(-s * 0.3, -s * 0.4);
        ctx.fill(); ctx.stroke();
        // 우측 날개
        ctx.beginPath();
        ctx.moveTo(s * 0.3, -s * 1.1);
        ctx.bezierCurveTo(s * 1.8, -s * 2.5 + wingMotion, s * 2.6, -s * 1.5 + wingMotion, s * 2.4, -s * 0.2 + wingMotion);
        ctx.lineTo(s * 1.8, -s * 0.3); ctx.lineTo(s * 1.4, s * 0.2); ctx.lineTo(s * 0.3, -s * 0.4);
        ctx.fill(); ctx.stroke();

        // 2. 흑마법사 로브 본체 & 오망성 자수
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, -s * 1.2); ctx.lineTo(s * 0.5, -s * 1.2);
        ctx.lineTo(s * 0.85, s * 0.85); ctx.lineTo(-s * 0.85, s * 0.85);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // 로브 중앙 붉은 결계선
        ctx.strokeStyle = '#991b1b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -s * 1.1); ctx.lineTo(0, s * 0.8); ctx.stroke();

        // 3. 거대 산양 두개골 & 주름진 뿔
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath(); ctx.ellipse(0, -s * 1.35, s * 0.38, s * 0.48, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // 산양 주둥이
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath(); ctx.roundRect(-s * 0.18, -s * 1.15, s * 0.36, s * 0.35, 3); ctx.fill(); ctx.stroke();

        // 거대 나선 뿔 (좌/우 굴곡)
        ctx.strokeStyle = '#451a03'; ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(-s * 0.2, -s * 1.5);
        ctx.bezierCurveTo(-s * 1.4, -s * 2.4, -s * 1.6, -s * 0.9, -s * 1.0, -s * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 0.2, -s * 1.5);
        ctx.bezierCurveTo(s * 1.4, -s * 2.4, s * 1.6, -s * 0.9, s * 1.0, -s * 0.7);
        ctx.stroke();

        // 산양 안광 (진홍빛 점 + 외곽 링)
        ctx.fillStyle = 'rgba(255, 0, 0, 0.45)';
        ctx.beginPath(); ctx.arc(-s * 0.15, -s * 1.35, 6, 0, Math.PI * 2); ctx.arc(s * 0.15, -s * 1.35, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff0000';
        ctx.beginPath(); ctx.arc(-s * 0.15, -s * 1.35, 3.5, 0, Math.PI * 2); ctx.arc(s * 0.15, -s * 1.35, 3.5, 0, Math.PI * 2); ctx.fill();

        // 4. 바포메트의 핏빛 대형 지팡이 (스태프)
        ctx.strokeStyle = '#543015'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(s * 0.85, s * 0.9); ctx.lineTo(s * 0.85, atkY - s * 2.7); ctx.stroke();

        // 스태프 상단 붉은 악마 보주 & 오망성
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.beginPath(); ctx.arc(s * 0.85, atkY - s * 2.7, s * 0.48, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(s * 0.85, atkY - s * 2.7, s * 0.35, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2; ctx.stroke();
    }
    // ----------------------------------------------------
    // 🐉 [3] 드래곤 (발라카스, 안타라스, 파푸리온, 린드비오르, 드레이크)
    // ----------------------------------------------------
    else if (safeName.includes('발라카스') || safeName.includes('안타라스') || safeName.includes('드레이크') || safeName.includes('드래곤') || safeName.includes('파푸리온')) {
        let isFire = safeName.includes('발라카스');
        let isWater = safeName.includes('파푸리온');
        let skin = isFire ? '#881337' : (isWater ? '#0369a1' : '#14532d');
        let belly = isFire ? '#ea580c' : (isWater ? '#38bdf8' : '#65a30d');

        // 1. 채찍 꼬리 & 등 가시
        let tailWave = Math.sin(ts / 70) * (s * 0.35);
        ctx.strokeStyle = skin; ctx.lineWidth = s * 0.28;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.2);
        ctx.quadraticCurveTo(-s * 1.5, s * 0.8 + tailWave, -s * 2.2, s * 0.2 + tailWave);
        ctx.stroke();

        // 2. 초거대 익룡형 드래곤 날개
        let wFlap = isMoving ? Math.sin(ts / 70) * (s * 0.45) : Math.sin(ts / 150) * (s * 0.15);
        ctx.fillStyle = skin; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;

        // 좌측 거대 날개
        ctx.beginPath();
        ctx.moveTo(-s * 0.3, -s * 0.5);
        ctx.lineTo(-s * 2.8, -s * 2.4 + wFlap);
        ctx.lineTo(-s * 2.0, -s * 0.7 + wFlap);
        ctx.lineTo(-s * 1.3, -s * 0.1);
        ctx.fill(); ctx.stroke();
        // 우측 거대 날개
        ctx.beginPath();
        ctx.moveTo(s * 0.3, -s * 0.5);
        ctx.lineTo(s * 2.8, -s * 2.4 + wFlap);
        ctx.lineTo(s * 2.0, -s * 0.7 + wFlap);
        ctx.lineTo(s * 1.3, -s * 0.1);
        ctx.fill(); ctx.stroke();

        // 3. 근육질 용체 & 복부 비늘
        ctx.fillStyle = skin;
        ctx.beginPath(); ctx.ellipse(0, -s * 0.35, s * 1.05, s * 0.75, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // 복부 분할 비늘
        ctx.fillStyle = belly;
        ctx.beginPath(); ctx.ellipse(s * 0.15, -s * 0.3, s * 0.55, s * 0.45, 0, 0, Math.PI * 2); ctx.fill();

        // 4. 사족보행 강철 발톱 다리
        ctx.fillStyle = skin;
        let walk1 = isMoving ? Math.sin(ts / 80) * (s * 0.22) : 0;
        let walk2 = isMoving ? Math.sin(ts / 80 + Math.PI) * (s * 0.22) : 0;
        ctx.fillRect(-s * 0.9, s * 0.1, s * 0.35, s * 0.7 + walk1); ctx.strokeRect(-s * 0.9, s * 0.1, s * 0.35, s * 0.7 + walk1);
        ctx.fillRect(s * 0.6, s * 0.1, s * 0.35, s * 0.7 + walk2); ctx.strokeRect(s * 0.6, s * 0.1, s * 0.35, s * 0.7 + walk2);
        ctx.fillRect(-s * 0.4, s * 0.1, s * 0.3, s * 0.7 + walk2); ctx.strokeRect(-s * 0.4, s * 0.1, s * 0.3, s * 0.7 + walk2);
        ctx.fillRect(s * 0.2, s * 0.1, s * 0.3, s * 0.7 + walk1); ctx.strokeRect(s * 0.2, s * 0.1, s * 0.3, s * 0.7 + walk1);

        // 5. 드래곤 두상 & 턱 & 불꽃 입김
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.ellipse(s * 0.9, atkY - s * 1.0, s * 0.65, s * 0.4, Math.PI / 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // 머리 뒤 뿔
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.moveTo(s * 0.6, atkY - s * 1.2); ctx.lineTo(s * 0.3, atkY - s * 1.8); ctx.lineTo(s * 0.8, atkY - s * 1.3); ctx.fill();

        // 파충류 황금 슬릿 눈
        ctx.fillStyle = '#facc15';
        ctx.fillRect(s * 1.05, atkY - s * 1.12, 5, 5);

        // 화염 브레스 연기
        if (isFire) {
            ctx.fillStyle = 'rgba(255, 80, 0, 0.35)';
            ctx.beginPath(); ctx.arc(s * 1.5, atkY - s * 0.9, s * 0.38 + Math.sin(ts / 50) * 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f97316';
            ctx.beginPath(); ctx.arc(s * 1.5, atkY - s * 0.9, s * 0.2 + Math.sin(ts / 50) * 4, 0, Math.PI * 2); ctx.fill();
        }
    }
    // ----------------------------------------------------
    // 💀 [4] 리치 (Lich)
    // ----------------------------------------------------
    else if (safeName.includes('리치')) {
        let hoverY = Math.sin(ts / 100) * (s * 0.28);
        ctx.translate(0, hoverY);

        // 1. 보랏빛 명계의 오라
        ctx.fillStyle = 'rgba(147, 51, 234, 0.22)';
        ctx.beginPath(); ctx.arc(0, -s * 0.8, s * 1.25, 0, Math.PI * 2); ctx.fill();

        // 2. 찢겨진 흑마도 로브
        ctx.fillStyle = '#0f172a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, -s * 1.2); ctx.lineTo(s * 0.5, -s * 1.2);
        ctx.lineTo(s * 0.75, s * 0.7); ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.75, s * 0.7);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // 3. 해골 흉부 (로브 사이로 드러난 갈비뼈)
        ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            ctx.moveTo(-s * 0.25, -s * 0.7 + i * s * 0.16);
            ctx.lineTo(s * 0.25, -s * 0.7 + i * s * 0.16);
        }
        ctx.stroke();

        // 4. 리치 황금 티아라 왕관 & 해골 얼굴
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath(); ctx.arc(0, -s * 1.35, s * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#000'; ctx.fillRect(-s * 0.16, -s * 1.4, 5, 7); ctx.fillRect(s * 0.06, -s * 1.4, 5, 7);

        // 황금 티아라 왕관
        ctx.fillStyle = '#eab308'; ctx.strokeStyle = '#713f12'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-s * 0.4, -s * 1.5); ctx.lineTo(-s * 0.4, -s * 1.9); ctx.lineTo(-s * 0.2, -s * 1.65);
        ctx.lineTo(0, -s * 2.05);
        ctx.lineTo(s * 0.2, -s * 1.65); ctx.lineTo(s * 0.4, -s * 1.9); ctx.lineTo(s * 0.4, -s * 1.5);
        ctx.fill(); ctx.stroke();

        // 5. 양손의 명계 마력구
        ctx.fillStyle = 'rgba(168, 85, 247, 0.4)';
        ctx.beginPath(); ctx.arc(-s * 0.9, atkY - s * 0.8, s * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.9, atkY - s * 0.8, s * 0.32, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#c084fc';
        ctx.beginPath(); ctx.arc(-s * 0.9, atkY - s * 0.8, s * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.9, atkY - s * 0.8, s * 0.2, 0, Math.PI * 2); ctx.fill();
    }
    // ----------------------------------------------------
    // 👹 [5] 데몬 / 커츠 / 기타 거대 보스
    // ----------------------------------------------------
    else {
        // 거대 근육질 몸체
        ctx.fillStyle = '#7f1d1d'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-s * 0.75, -s * 1.25, s * 1.5, s * 1.25, 6); ctx.fill(); ctx.stroke();

        // 거대 악마 뿔
        ctx.fillStyle = '#1c1917';
        ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 1.4); ctx.lineTo(-s * 1.0, -s * 2.3); ctx.lineTo(-s * 0.1, -s * 1.5); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.3, -s * 1.4); ctx.lineTo(s * 1.0, -s * 2.3); ctx.lineTo(s * 0.1, -s * 1.5); ctx.fill(); ctx.stroke();

        // 얼굴 & 불타는 눈
        ctx.fillStyle = '#991b1b';
        ctx.beginPath(); ctx.arc(0, -s * 1.45, s * 0.48, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.fillRect(-s * 0.2, -s * 1.5, 6, 6); ctx.fillRect(s * 0.1, -s * 1.5, 6, 6);

        // 거대 무기
        ctx.fillStyle = '#334155'; ctx.strokeStyle = '#0f172a';
        ctx.fillRect(s * 0.75, atkY - s * 2.6, s * 0.35, s * 3.2); ctx.strokeRect(s * 0.75, atkY - s * 2.6, s * 0.35, s * 3.2);

        // 두 다리
        ctx.fillStyle = '#450a0a';
        let dStep = isMoving ? Math.sin(ts / 90) * (s * 0.22) : 0;
        ctx.fillRect(-s * 0.55, 0, s * 0.42, s * 0.9 - dStep); ctx.strokeRect(-s * 0.55, 0, s * 0.42, s * 0.9 - dStep);
        ctx.fillRect(s * 0.13, 0, s * 0.42, s * 0.9 + dStep); ctx.strokeRect(s * 0.13, 0, s * 0.42, s * 0.9 + dStep);
    }

    ctx.restore();
}



function drawNPC(ctx, n, timestamp) { 
    ctx.save(); ctx.translate(n.x, n.y); let sz = 20; 
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0, sz*0.8, sz*0.8, sz*0.3, 0, 0, Math.PI*2); ctx.fill(); 
    ctx.fillStyle = n.color; ctx.fillRect(-sz*0.5, -sz, sz, sz); 
    ctx.fillStyle = '#ffe0bd'; ctx.beginPath(); ctx.arc(0, -sz*1.2, sz*0.4, 0, Math.PI*2); ctx.fill(); 
    if(n.name.includes('상인') || n.name.includes('잡화')) { ctx.fillStyle = '#a52'; ctx.fillRect(-sz*0.6, -sz*0.5, sz*1.2, 5); } 
    else { ctx.fillStyle = '#225'; ctx.beginPath(); ctx.moveTo(-sz*0.6, -sz*1.2); ctx.lineTo(sz*0.6, -sz*1.2); ctx.lineTo(0, -sz*2); ctx.fill(); } 
    ctx.restore(); 
}

function drawItem(ctx, it, timestamp) { 
    ctx.save(); ctx.translate(it.x, it.y); ctx.translate(0, Math.sin(timestamp/200 + it.x) * 3); 
    if (it.type === 'potion') { 
        ctx.fillStyle = it.name.includes('주홍') ? '#f80' : (it.name.includes('초록') ? '#5f5' : (it.name.includes('파란') ? '#55f' : (it.name.includes('맑은') ? '#fff' : (it.name.includes('고기') ? '#a42' : '#f22')))); 
        ctx.fillRect(-4, -4, 8, 8); ctx.fillStyle = '#ddd'; ctx.fillRect(-2, -8, 4, 4); 
    } else if (it.type === 'scroll' || it.type === 'book') { 
        ctx.fillStyle = '#ddb'; ctx.fillRect(-6, -6, 12, 12); ctx.fillStyle = '#822'; ctx.fillRect(-4, -4, 8, 8); 
    } else if (it.type === 'weapon') { 
        ctx.save(); ctx.rotate(Math.PI/4); ctx.fillStyle = '#eee'; ctx.fillRect(-2, -10, 4, 20); ctx.fillStyle = '#fd0'; ctx.fillRect(-6, 2, 12, 3); ctx.restore(); 
    } else { 
        ctx.fillStyle = gradeColors[it.grade||0]; ctx.fillRect(-6, -6, 12, 12); 
    } 
    ctx.restore(); 
}

function drawEntity(ctx, e, timestamp) { 
    if (isNaN(e.x) || isNaN(e.y)) return;

    ctx.save(); 
    ctx.translate(Math.round(e.x), Math.round(e.y));
    
    if (e.isDead) {
        if (e === player) {
            ctx.filter = 'grayscale(100%) brightness(60%)';
            ctx.rotate(Math.PI / 2); 
        } else {
            let p = Math.max(0, 1 - (timestamp - e.deadTime) / 1000);
            if (p <= 0) { ctx.restore(); return; } 
            ctx.globalAlpha = p; 
            ctx.filter = 'grayscale(80%)';
        }
    }

 let isHit = e.hitTime && (timestamp - e.hitTime < 180) && !e.isDead;
    if (isHit && e !== player) {
        // 피격 순간 맞은 방향으로 살짝 주춤하는 밀림 연출
        let hitProgress = (timestamp - e.hitTime) / 180; // 0 ~ 1
        let recoilDist = Math.sin(hitProgress * Math.PI) * 6; 
        let pushAngle = e.angle || 0;
        ctx.translate(-Math.cos(pushAngle) * recoilDist, -Math.sin(pushAngle) * recoilDist);
        
        // 💡 [자연스러운 피격 번쩍임]: 몬스터가 붉으스름하고 밝게 부드럽게 깜빡임
        let flashIntensity = Math.sin(hitProgress * Math.PI) * 100; // 서서히 밝아졌다 어두워짐
        ctx.filter = `brightness(${150 + flashIntensity}%) sepia(50%) saturate(200%)`;
    }

    let isLeft = Math.abs(e.angle || 0) > Math.PI/2; 
    if(isLeft) ctx.scale(-1, 1); 
    let frame = Math.floor(timestamp / 200) % 2; 
    let isAttacking = e.lastAttack && (timestamp - e.lastAttack < 500);
    let baseSz = (typeof e.size === 'number' && !isNaN(e.size)) ? e.size : 20;
    let sz = e.isBoss ? baseSz * 1.35 : baseSz; 
    
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, sz*0.8, sz*0.9, sz*0.35, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();
    
    // 진짜 이동 중일 때만 상하 2px 바운스 적용
    let realMoving = !!(e.isMoving && (e.moveX !== undefined || e.target));
    ctx.translate(0, (realMoving && frame === 0) ? -2 : 0);
    
    // 💡 [3단계 분기 렌더링] 플레이어/용병 -> 보스 몬스터 -> 일반 몬스터
    if (e === player || e.isMercenary || e.isPlayer || e.isOtherMerc) {
        let eq = e.equip || { weapon: null, armor: null };
        drawCharacter(ctx, e, sz, isAttacking, e.isMoving, frame, eq, timestamp); 
    } else if (e.isBoss) {
        // 👑 보스 몬스터 전용 고디테일 렌더링 호출
        drawBossDetailed(ctx, e.name, sz, isAttacking, e.isMoving, isHit, timestamp);
    } else {
        drawHumanoid(ctx, e.name, e.color, sz, isAttacking, e.isMoving, frame, isHit, timestamp);
    }
    
    ctx.restore(); 
}

function generateLightningPath(x, y) {
    let path = [{x: x, y: y - 300}];
    let curX = x, curY = y - 300;
    for(let i=0; i<5; i++) {
        curX += (Math.random() - 0.5) * 40;
        curY += 60;
        path.push({x: curX, y: curY});
    }
    path.push({x: x, y: y});
    return path;
}

function draw(timestamp) {
    ctx.imageSmoothingEnabled = false;

    let mData = maps[currentMap]; 
    let uiBar = document.getElementById('ui-bottom-bar');
    let uiHeight = uiBar ? uiBar.offsetHeight : 165; 
    let worldW = Math.round(width / ZOOM); 
    let worldH = Math.round(height / ZOOM); 
    let visibleWorldH = Math.round((height - uiHeight) / ZOOM); 

    let pX = Math.round(player.x); 
    let pY = Math.round(player.y);
    let camX = Math.max(0, Math.min(pX - Math.floor(worldW / 2), mapSize - worldW));
    let camY = Math.max(0, Math.min(pY - Math.floor(visibleWorldH / 2), mapSize - visibleWorldH));

    ctx.save(); 
    ctx.scale(ZOOM, ZOOM); 
    ctx.translate(-camX, -camY); 

    ctx.fillStyle = mData.bg === 'dungeon' ? '#2c2d38' : (mData.bg === 'stone' ? '#55555c' : '#4a6b35');
    ctx.fillRect(0, 0, mapSize, mapSize);

    let bgCanvas = getGeneratedMap(currentMap);
    if (bgCanvas) {
        ctx.drawImage(bgCanvas, 0, 0);
    } else {
        ctx.fillStyle = textures[mData.bg] || mData.bg || '#000'; 
        ctx.fillRect(0, 0, mapSize, mapSize);
    }
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1; let gridSize = 100; 
    let startX = Math.floor(camX / gridSize) * gridSize; let startY = Math.floor(camY / gridSize) * gridSize; 
    for(let x = startX; x < camX + worldW; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, camY); ctx.lineTo(x, camY + worldH); ctx.stroke(); } 
    for(let y = startY; y < camY + worldH; y += gridSize) { ctx.beginPath(); ctx.moveTo(camX, y); ctx.lineTo(camX + worldW, y); ctx.stroke(); }
    
    if(mData.links) mData.links.forEach(l => { ctx.fillStyle = '#4af'; ctx.beginPath(); ctx.ellipse(l.x, l.y, 30 + Math.sin(timestamp/200)*5, 15 + Math.sin(timestamp/200)*2, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = 'rgba(100, 150, 255, 0.4)'; ctx.beginPath(); ctx.ellipse(l.x, l.y - 20, 20, 40 + Math.sin(timestamp/150)*10, 0, 0, Math.PI*2); ctx.fill();
    if(gameOptions.showNames) { drawNameTag(ctx, `${l.name} 이동`, l.x, l.y - 40, false, true); } });
    
    // 💡 [교체할 코드] 바닥 아이템 렌더링 (map 속성 누락 방어)
    items.forEach(it => { 
        if (it && (it.map === currentMap || !it.map)) {
            if (it.x > camX - 50 && it.x < camX + worldW + 50 && it.y > camY - 50 && it.y < camY + worldH + 50) { 
                drawItem(ctx, it, timestamp); 
                if (gameOptions.showNames) {
                    drawNameTag(ctx, it.isEnchantScroll ? `[${it.enchantType}] ${it.name}` : it.name, it.x, it.y - 12, false, false); 
                }
            } 
        }
    });
    npcs.forEach(n => { if(n.map === currentMap) { drawNPC(ctx, n, timestamp); drawNameTag(ctx, n.name, n.x, n.y - 30, false, true); } });
   
       

particles.forEach(p => {
    

           // 💡 1. [몬스터 거대 검붉은 마법진 & 플레이어 은회색 마법진]
        if (p.type === 'magic_circle') {
            let progress = p.maxLife ? Math.max(0, Math.min(1, 1 - (p.life / p.maxLife))) : 0.5;
            let fadeAlpha = Math.sin(progress * Math.PI); 
            let r = p.size || 50; 

            ctx.save();
            // 💡 [핵심 보정] 캐릭터 발과 그림자 기준점(y + 14px)으로 중심점 정렬
            ctx.translate(p.x, p.y + 14);
            ctx.scale(1, 0.42);

            let isMob = p.isMonster || p.color === 'red' || p.color === '#ff0000';

            // 바닥 섀도우 결계 (밝은 맵에서도 룬이 또렷하게 보이도록 베이스 생성)
            ctx.fillStyle = isMob ? `rgba(40, 0, 0, ${fadeAlpha * 0.65})` : `rgba(0, 15, 35, ${fadeAlpha * 0.65})`;
            ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2); ctx.fill();

            // 네온 발광 및 룬 라인 설정
            ctx.shadowBlur = isMob ? 18 : 15;
            ctx.shadowColor = isMob ? '#ff0000' : '#00ffff';
            ctx.strokeStyle = isMob ? `rgba(255, 40, 40, ${fadeAlpha * 0.98})` : `rgba(0, 240, 255, ${fadeAlpha * 0.98})`;
            ctx.fillStyle = isMob ? `rgba(255, 80, 80, ${fadeAlpha * 0.95})` : `rgba(140, 240, 255, ${fadeAlpha * 0.95})`;
            ctx.lineWidth = 2.2;

            // 외곽 이중 테두리
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
            ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, r * 0.70, 0, Math.PI * 2); ctx.stroke();

            // 24개 고대 룬 문자
            let runes = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛇ','ᛈ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛜ','ᛞ','ᛟ'];
            let fontSize = Math.max(9, Math.round(r * 0.12));
            ctx.font = `bold ${fontSize}px "Malgun Gothic", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let i = 0; i < runes.length; i++) {
                let angle = (Math.PI * 2 / runes.length) * i;
                let rx = Math.cos(angle) * (r * 0.82);
                let ry = Math.sin(angle) * (r * 0.82);
                ctx.save();
                ctx.translate(rx, ry);
                ctx.rotate(angle + Math.PI / 2);
                ctx.fillText(runes[i], 0, 0);
                ctx.restore();
            }

            // 이중 육망성
            let drawDoubleTriangle = (rotOffset, rOuter, rInner) => {
                ctx.lineWidth = isMob ? 1.8 : 1.5;
                ctx.strokeStyle = isMob ? `rgba(255, 50, 50, ${fadeAlpha * 0.95})` : `rgba(0, 220, 255, ${fadeAlpha * 0.95})`;
                ctx.beginPath();
                for (let i = 0; i <= 3; i++) {
                    let a = (Math.PI * 2 / 3) * i + rotOffset;
                    let x = Math.cos(a) * rOuter; let y = Math.sin(a) * rOuter;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();

                ctx.lineWidth = 1.0;
                ctx.beginPath();
                for (let i = 0; i <= 3; i++) {
                    let a = (Math.PI * 2 / 3) * i + rotOffset;
                    let x = Math.cos(a) * rInner; let y = Math.sin(a) * rInner;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            };

            drawDoubleTriangle(Math.PI / 6, r * 0.70, r * 0.65);
            drawDoubleTriangle(-Math.PI / 6, r * 0.70, r * 0.65);

            // 중심 코어
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = isMob ? `rgba(255, 30, 30, ${fadeAlpha * 0.9})` : `rgba(0, 200, 255, ${fadeAlpha * 0.9})`;
            ctx.beginPath();
            for (let i = 0; i <= 4; i++) {
                let a = (Math.PI / 2) * i;
                let qx = Math.cos(a) * (r * 0.35); let qy = Math.sin(a) * (r * 0.35);
                if (i === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
            }
            ctx.stroke();

            ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }
        // 💡 2. [충전식 공격 예고 장판]
        else if (p.type === 'magic_telegraph') {
            let progress = p.maxLife ? Math.max(0, Math.min(1, 1 - (p.life / p.maxLife))) : 0.5;
            let r = p.size || 110;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(1, 0.42);
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#ff2200';

            // 바닥 위험 구역
            ctx.fillStyle = `rgba(255, 20, 20, ${0.15 + progress * 0.25})`;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

            // 충전 게이지 (시간이 차오르는 효과)
            ctx.fillStyle = 'rgba(255, 60, 0, 0.35)';
            ctx.beginPath(); ctx.arc(0, 0, r * progress, 0, Math.PI * 2); ctx.fill();

            // 외곽 경고 링
            ctx.strokeStyle = `rgba(255, 50, 50, ${0.7 + Math.sin(timestamp / 100) * 0.3})`;
            ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

            // 중앙 크로스헤어
            let cSize = Math.max(15, r * 0.22);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-cSize, 0); ctx.lineTo(cSize, 0);
            ctx.moveTo(0, -cSize); ctx.lineTo(0, cSize);
            ctx.stroke();

            ctx.restore();
        }
    });
    // 💡 마법진 코드 삽입 끝

// 💡 [오라 일괄 렌더링] 본인 + 파티원 + 타 플레이어 + 용병 전체 광폭화/실프 오라 렌더링
    let allAuraUnits = [player, ...entities.filter(e => e && (e.isPlayer || e.isMercenary || e.isOtherMerc || e.isSummon))];
    
    allAuraUnits.forEach(unit => {
        if (!unit || unit.hp <= 0 || unit.isDead) return;

        // 1. 기사/광폭화 황금빛 버서커 오라
        if (Date.now() < (unit.furyUntil || 0)) {
            ctx.save();
            ctx.translate(unit.x, unit.y + 10);
            ctx.scale(1, 0.45);
            let pulse = Math.sin(timestamp / 70) * 5;
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
            ctx.lineWidth = 3.5;
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#f59e0b';
            ctx.beginPath();
            ctx.arc(0, 0, (unit.size || 20) * 1.6 + pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 2. 요정/실프의 폭풍 에메랄드 바람 오라
        if ((unit.charClass === 'elf' || unit.mercType === 'elf') && Date.now() < (unit.elfFuryUntil || 0)) {
            ctx.save();
            ctx.translate(unit.x, unit.y + 10);
            ctx.scale(1, 0.45);
            let pulse = Math.sin(timestamp / 60) * 6;
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
            ctx.lineWidth = 3.5;
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#10b981';
            ctx.beginPath();
            ctx.arc(0, 0, (unit.size || 20) * 1.7 + pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    });


entities.forEach(e => {
        if (!e || typeof e.x !== 'number' || typeof e.y !== 'number') return;
        if (e === player || (window.socket && e.id === window.socket.id)) return;

        if (e.map === currentMap && e.x > camX - 300 && e.x < camX + worldW + 300 && e.y > camY - 300 && e.y < camY + worldH + 300) {
            
            // 타겟 표시 링
            if(player.target === e && !e.isDead) {
                ctx.save();
                ctx.translate(e.x, e.y);
                let sz = e.size || 20;
                ctx.fillStyle = e.isPlayer ? 'rgba(0, 200, 255, 0.3)' : 'rgba(255, 0, 0, 0.3)';
                ctx.beginPath(); ctx.ellipse(0, 0, sz*1.5, sz*0.8, 0, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = e.isPlayer ? '#5cf' : '#f33'; ctx.lineWidth = 2; ctx.stroke();
                ctx.restore();
            }

            drawEntity(ctx, e, timestamp);

            // 💡 여기서 몬스터, 보스, 타 유저, 용병의 이름과 색상이 결정됩니다.
            let sz = e.size || 20;
            let tagColor = e.isBoss ? '#fbbf24' : (e.isPlayer ? '#5cf' : (e.isOtherMerc ? '#6ee' : (e.isSummon ? '#5f5' : '#ffffff')));
            let displayName = e.isOtherMerc ? `[용병] ${e.name}` : e.name;
            
            let isMobile = window.innerWidth < 768;
            let otherFontSize = 12;

            if (e.isPlayer) {
                otherFontSize = isMobile ? 15 : 18; 
                displayName = e.alignment > 10000 ? `[정의] ${e.name}` : (e.alignment < -10000 ? `[악인] ${e.name}` : e.name);
                tagColor = e.alignment > 10000 ? '#38bdf8' : (e.alignment < -10000 ? '#f87171' : '#ffffff');
            } else if (e.isBoss) {
                // 보스 몬스터: PC 20px / 모바일 17px
                otherFontSize = isMobile ? 17 : 20;
            } else {
                // 💡 일반 몬스터 & 용병: PC 18px / 모바일 15px
                otherFontSize = isMobile ? 15 : 18;
            }
            
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            ctx.font = `bold ${otherFontSize}px -apple-system, BlinkMacSystemFont, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`; 
            ctx.lineWidth = 4; 
            ctx.strokeStyle = '#000000';
            
            // 소수점 번짐 방지 정수 렌더링
            let rx = Math.round(e.x);
            let ry = Math.round(e.y - sz - (e.isPlayer ? 33 : 30));

            ctx.strokeText(displayName, rx, ry);
            ctx.fillStyle = tagColor; 
            ctx.fillText(displayName, rx, ry);
            ctx.restore();

            // 💡 [수정] 용병 및 소환수는 전용 HUD가 있으므로 머리 위 HP 바 제외 (몬스터, 보스, 타 플레이어만 표시)
            let isMercOrSummon = e.isMercenary || e.isOtherMerc || e.isSummon;
            if (!e.isDead && !isMercOrSummon) {
                let safeMaxHp = e.maxHp || e.hp || 1; 
                let hpRatio = Math.max(0, Math.min(1, e.hp / safeMaxHp));
                let barW = e.isBoss ? 50 : (e.isPlayer ? 45 : 30);
                let barColor = e.isPlayer ? '#0ea5e9' : '#ef4444';

                ctx.fillStyle = '#000'; ctx.fillRect(e.x - barW/2, e.y - sz - 20, barW, 5);
                ctx.fillStyle = barColor; ctx.fillRect(e.x - barW/2, e.y - sz - 20, barW * hpRatio, 5);
                ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(e.x - barW/2, e.y - sz - 20, barW, 5);

                if (e.isBoss) {
                    ctx.fillStyle = '#fff'; ctx.font = '10px Gulim'; ctx.textAlign = 'center';
                    ctx.fillText(`${Math.floor(hpRatio * 100)}%`, e.x, e.y - sz - 22);
                }
            }
        }
    });
    

if (player && Date.now() < (player.furyUntil || 0)) {
        ctx.save();
        ctx.translate(player.x, player.y + 10);
        ctx.scale(1, 0.45);
        
        let pulse = Math.sin(timestamp / 70) * 5;
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.lineWidth = 3.5;
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#f59e0b';
        ctx.beginPath();
        ctx.arc(0, 0, (player.size || 20) * 1.6 + pulse, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, (player.size || 20) * 1.9 + pulse * 1.2, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
        ctx.beginPath();
        ctx.arc(0, 0, (player.size || 20) * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }


// 🏹 요정 광폭화(실프의 폭풍) 에메랄드 바람 오라 렌더링
    if (player && player.charClass === 'elf' && Date.now() < (player.elfFuryUntil || 0)) {
        ctx.save();
        ctx.translate(player.x, player.y + 10);
        ctx.scale(1, 0.45);
        
        let pulse = Math.sin(timestamp / 60) * 6;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
        ctx.lineWidth = 3.5;
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#10b981';
        ctx.beginPath();
        ctx.arc(0, 0, (player.size || 20) * 1.7 + pulse, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.strokeStyle = 'rgba(110, 231, 183, 0.6)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, (player.size || 20) * 2.0 + pulse * 1.3, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.beginPath();
        ctx.arc(0, 0, (player.size || 20) * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

  drawEntity(ctx, player, timestamp); 
  if(gameOptions.showNames) { 
        let pName = player.alignment > 10000 ? `[정의] ${player.name}` : (player.alignment < -10000 ? `[악인] ${player.name}` : player.name);
        ctx.save();
        ctx.textAlign = 'center'; 
        ctx.textBaseline = 'middle';
        
        let isMobile = window.innerWidth < 768;
        let pFontSize = isMobile ? 15 : 18; // 💡 닉네임 크기 확대

        ctx.font = `bold ${pFontSize}px -apple-system, BlinkMacSystemFont, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`; 
        ctx.lineWidth = 4; 
        ctx.strokeStyle = '#000000';
        
        let rx = Math.round(player.x);
        let ry = Math.round(player.y - player.size - 33);

        ctx.strokeText(pName, rx, ry); 
        ctx.fillStyle = player.alignment > 10000 ? '#38bdf8' : (player.alignment < -10000 ? '#f87171' : '#ffffff');
        ctx.fillText(pName, rx, ry); 
        
        let badgeLevel = Math.floor((player.level || 1) / 30);
        if (badgeLevel > 0) {
            let badgeColors = ['#fff', '#5f5', '#5cf', '#f55', '#fd0', '#f0f'];
            let badgeIcon = ['🌱', '⚔️', '🛡️', '🔥', '👑', '🌟'][Math.min(badgeLevel - 1, 5)];
           ctx.fillStyle = badgeColors[Math.min(badgeLevel - 1, badgeColors.length - 1)];
            ctx.font = isMobile ? '17px Arial' : '15px Arial';
            ctx.fillText(badgeIcon, rx, Math.round(player.y - player.size - 55)); 
        }        
        ctx.restore();
    }

    if (!player.isDead) {
        let hpRatio = Math.max(0, player.hp / currentMaxHp);
        let barW = 70; 
        ctx.fillStyle = '#000'; ctx.fillRect(player.x - barW/2, player.y - player.size - 25, barW, 6);
        ctx.fillStyle = '#5f5'; 
        ctx.fillRect(player.x - barW/2, player.y - player.size - 25, barW * hpRatio, 6);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(player.x - barW/2, player.y - player.size - 25, barW, 6);
    }

    particles.forEach(p => { 
         if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || isNaN(p.x) || isNaN(p.y)) return;
        


        ctx.save();
        try {
            let progress = p.maxLife ? Math.max(0, Math.min(1, 1 - (p.life / p.maxLife))) : 0.5;
            let easeOut = 1 - Math.pow(1 - progress, 3);
            let alpha = p.maxLife ? (progress < 0.2 ? progress / 0.2 : (progress > 0.8 ? (1 - progress) / 0.2 : 1)) : 1;
            ctx.globalAlpha = alpha;
            
            let isMagic = ['explosion','eruption','lightning','blizzard','meteor','tornado','judgment','disintegrate','drain','classic_heal','haste_tornado','classic_shield','energy_bolt','classic_potion','advance_spirit','immune_to_harm','absolute_barrier','majesty_shield','summon_effect','cancellation','buff_effect'].includes(p.type);
            if (isMagic) ctx.globalCompositeOperation = 'screen';

            ctx.translate(p.x, p.y);

            if (p.isArrow) {
                ctx.rotate(p.angle || 0);
                ctx.fillStyle = '#fde047'; ctx.fillRect(-12, -1.5, 20, 3); 
                ctx.fillStyle = '#ffffff'; ctx.beginPath(); 
                ctx.moveTo(8, -4); ctx.lineTo(16, 0); ctx.lineTo(8, 4); ctx.fill(); 
                
                let trailGrad = ctx.createLinearGradient(-30, 0, -12, 0);
                trailGrad.addColorStop(0, 'rgba(255,255,255,0)');
                trailGrad.addColorStop(1, 'rgba(255,255,255,0.6)');
                ctx.fillStyle = trailGrad; ctx.fillRect(-30, -2, 18, 4);
            }


        else if (p.type === 'stun_effect') {
        let progress = p.maxLife ? Math.max(0, Math.min(1, 1 - (p.life / p.maxLife))) : 0.5;
        let r = p.size || 60;
        
        ctx.save();
        ctx.scale(1, 0.45);
        ctx.strokeStyle = `rgba(255, 230, 0, ${1 - progress})`;
        ctx.lineWidth = 5 * (1 - progress);
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.4 + progress * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#ffea00';
        ctx.lineWidth = 2.5;
        for (let k = 0; k < 4; k++) {
            let ang = (Math.PI / 2) * k + (progress * 12);
            let sx = Math.cos(ang) * (r * 0.5);
            let sy = Math.sin(ang) * (r * 0.25) - 35;
            ctx.beginPath();
            ctx.arc(sx, sy, 5 * (1 - progress * 0.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        if (progress < 0.3) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(0, -120);
            ctx.lineTo((Math.random() - 0.5) * 20, -70);
            ctx.lineTo(0, -25);
            ctx.stroke();
        }
    }

            else if (p.type === 'energy_bolt') {
                ctx.rotate(p.angle || 0);
                ctx.shadowBlur = 18; ctx.shadowColor = '#0055ff';
                let grad = ctx.createLinearGradient(-25, 0, 15, 0);
                grad.addColorStop(0, 'rgba(0,100,255,0)'); grad.addColorStop(0.7, '#00aaff'); grad.addColorStop(1, '#ffffff');
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.ellipse(5, 0, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
            }
            else if (p.type === 'classic_heal') { 
                let h = 120 * easeOut;
                ctx.shadowBlur = 25; ctx.shadowColor = '#00ff88';
                let grad = ctx.createLinearGradient(0, -h, 0, 0);
                grad.addColorStop(0, 'rgba(0,255,136,0)'); grad.addColorStop(0.5, 'rgba(0,255,136,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0.95)');
                ctx.fillStyle = grad; ctx.fillRect(-30, -h, 60, h);
                ctx.fillStyle = '#ffffff';
                let crossSize = 25 * Math.sin(progress * Math.PI);
                ctx.fillRect(-5, -h/2 - crossSize, 10, crossSize*2);
                ctx.fillRect(-crossSize, -h/2 - 5, crossSize*2, 10);
            }
            else if (p.type === 'haste_tornado') {
                ctx.strokeStyle = '#22ff55'; ctx.lineWidth = 4; ctx.shadowBlur = 15; ctx.shadowColor = '#00ff00';
                let h = 85 * progress;
                ctx.beginPath();
                for(let k=0; k<20; k++) {
                    let a = (progress * 35) + (k * 0.3);
                    let rx = Math.cos(a) * (25 - k * 0.8);
                    let ry = -h * (k/20) + Math.sin(a) * 6;
                    if(k===0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
                }
                ctx.stroke();
            }
// 🌪️ 스톰 블레이드 360도 풍압 칼날 링
            else if (p.type === 'storm_blade_ring') {
                let progress = p.maxLife ? Math.max(0, Math.min(1, 1 - (p.life / p.maxLife))) : 0.5;
                let r = (p.size || 120) * progress;
                
                ctx.save();
                ctx.scale(1, 0.45);
                ctx.strokeStyle = `rgba(52, 211, 153, ${1 - progress})`;
                ctx.lineWidth = 4 * (1 - progress);
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.stroke();

                // 8방향 바람 칼날
                for (let k = 0; k < 8; k++) {
                    let ang = (Math.PI / 4) * k + (progress * 8);
                    let bx = Math.cos(ang) * r;
                    let by = Math.sin(ang) * r;
                    ctx.fillStyle = '#6ee7b7';
                    ctx.beginPath();
                    ctx.arc(bx, by, 4 * (1 - progress * 0.5), 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            else if (p.type === 'eruption') { 
                let r = p.size || 95;
                ctx.save(); ctx.scale(1, 0.42); 
                ctx.shadowBlur = 15; ctx.shadowColor = '#991b1b'; 

                ctx.strokeStyle = '#450a0a'; ctx.lineWidth = 3.5;
                let crackCount = 5; 
                for (let k = 0; k < crackCount; k++) {
                    let angle = (Math.PI * 2 / crackCount) * k + (k % 2 === 0 ? 0.3 : -0.3);
                    let maxLen = r * (0.8 + (k % 2) * 0.3) * progress; 
                    ctx.beginPath(); ctx.moveTo(0, 0);
                    ctx.lineTo(Math.cos(angle) * (maxLen * 0.4), Math.sin(angle) * (maxLen * 0.4));
                    ctx.lineTo(Math.cos(angle + 0.2) * maxLen, Math.sin(angle + 0.2) * maxLen);
                    ctx.stroke();
                }

                let glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * progress);
                glowGrad.addColorStop(0, 'rgba(239, 68, 68, 0.8)');
                glowGrad.addColorStop(0.5, 'rgba(185, 28, 28, 0.5)');
                glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = glowGrad;
                ctx.beginPath(); ctx.arc(0, 0, r * progress, 0, Math.PI * 2); ctx.fill();

                ctx.fillStyle = '#78350f';
                for (let i = 0; i < 6; i++) {
                    let pAngle = (Math.PI * 2 / 6) * i;
                    let pDist = r * 0.9 * progress;
                    ctx.beginPath(); ctx.arc(Math.cos(pAngle) * pDist, Math.sin(pAngle) * pDist, 3, 0, Math.PI * 2); ctx.fill();
                }
                ctx.restore();
            }
            else if (p.type === 'lightning') { 
                if (progress % 0.2 < 0.12) {
                    let r = p.size || 90; // 콜 라이트닝은 작게, 라이트닝 스톰은 크게 적용
                    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.shadowBlur = 35; ctx.shadowColor = '#00ffff';
                    
                    // 스톰같이 반경이 크면 번개를 3갈래로 내리침
                    let boltCount = r > 150 ? 3 : 1; 
                    
                    for(let b = 0; b < boltCount; b++) {
                        let offsetX = boltCount > 1 ? (Math.random() - 0.5) * (r * 0.8) : 0;
                        let offsetY = boltCount > 1 ? (Math.random() - 0.5) * (r * 0.3) : 0;
                        
                        ctx.beginPath(); ctx.moveTo(offsetX, -800);
                        let lx = offsetX, ly = -800;
                        for(let k=0; k<7; k++) {
                            lx += (Math.random() - 0.5) * 80; ly += 110;
                            ctx.lineTo(lx, ly);
                        }
                        ctx.lineTo(offsetX, offsetY); ctx.stroke();
                    }
                    
                    // 범위 링 표시
                    let ringR = r * easeOut;
                    ctx.strokeStyle = '#88ffff'; ctx.lineWidth = 4.5;
                    ctx.beginPath(); ctx.ellipse(0, 0, ringR, ringR * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
                }
            }
            else if (p.type === 'disintegrate') { 
                let h = 900;
                let beamWidth = 35 * Math.sin(progress * Math.PI);

                // 지면 충격파 링[cite: 6]
                let impactR = 120 * easeOut;
                ctx.save();
                ctx.scale(1, 0.42);
                ctx.strokeStyle = `rgba(180, 80, 255, ${1 - progress})`;
                ctx.lineWidth = 8 * (1 - progress);
                ctx.beginPath(); ctx.arc(0, 0, impactR, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = `rgba(255, 255, 255, ${1 - progress})`;
                ctx.lineWidth = 4 * (1 - progress);
                ctx.beginPath(); ctx.arc(0, 0, impactR * 0.6, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();

                // 하늘에서 지면으로 수직 낙하하는 메인 광선 기둥[cite: 6]
                ctx.shadowBlur = 45; 
                ctx.shadowColor = '#a855f7';

                let grad = ctx.createLinearGradient(0, -h, 0, 0);
                grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
                grad.addColorStop(0.3, 'rgba(168, 85, 247, 0.6)');
                grad.addColorStop(0.8, 'rgba(192, 132, 252, 0.9)');
                grad.addColorStop(1, '#ffffff');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.moveTo(-beamWidth, -h);
                ctx.lineTo(beamWidth, -h);
                ctx.lineTo(beamWidth * 1.4, 0);
                ctx.lineTo(-beamWidth * 1.4, 0);
                ctx.closePath();
                ctx.fill();

                // 중심 코어 백색 기둥[cite: 6]
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(-beamWidth * 0.4, -h, beamWidth * 0.8, h);
            }
         else if (p.type === 'ice_spike') {
                let r = p.size || 80;
                let h = 180 * Math.sin(progress * Math.PI);
                ctx.shadowBlur = 20; ctx.shadowColor = '#00ffff';
                ctx.fillStyle = `rgba(180, 255, 255, ${1 - progress})`;
                
                // 날카로운 얼음 기둥
                ctx.beginPath();
                ctx.moveTo(0, -h);
                ctx.lineTo(-r * 0.3, 0);
                ctx.lineTo(r * 0.3, 0);
                ctx.fill();
                
                // 흩날리는 얼음 가루
                ctx.fillStyle = '#ffffff';
                for(let k = 0; k < 6; k++) {
                    let px = Math.cos(k * 1.2) * (r * 0.4 * progress);
                    let py = -h * 0.4 + Math.sin(k) * (r * 0.4 * progress);
                    ctx.fillRect(px, py, 3, 3);
                }
            }
            else if (p.type === 'meteor') {
                if (progress < 0.4) { 
                    let fallP = progress / 0.4;
                    let mx = 600 * (1 - fallP); let my = -800 * (1 - fallP);
                    ctx.translate(mx, my);
                    ctx.shadowBlur = 40; ctx.shadowColor = '#ff3300';
                    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = '#ff1100'; ctx.beginPath(); ctx.moveTo(-45, -45); ctx.lineTo(300, -350); ctx.lineTo(45, -45); ctx.fill();
                } else { 
                    let r = (p.size || 400) * ((progress - 0.4) / 0.6);
                    let grad = ctx.createRadialGradient(0,0,0, 0,0,r);
                    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.2, '#ffcc00'); grad.addColorStop(0.6, '#ff2200'); grad.addColorStop(1, 'rgba(100,0,0,0)');
                    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill(); 
                }
            }
            else if (p.type === 'blizzard') { 
    let r = p.size || 300;
    let ring1 = r * easeOut;
    
    // shadowBlur 제거 -> 반투명 이중 원형 스트로크로 렉 없는 발광 구현
    ctx.strokeStyle = `rgba(100, 230, 255, ${0.9 * (1 - progress)})`; 
    ctx.lineWidth = 3;
    ctx.beginPath(); 
    ctx.ellipse(0, 0, ring1, ring1 * 0.45, 0, 0, Math.PI * 2); 
    ctx.stroke();

    let ring2 = (r * 0.65) * easeOut;
    ctx.strokeStyle = `rgba(200, 255, 255, ${0.7 * (1 - progress)})`; 
    ctx.lineWidth = 2;
    ctx.beginPath(); 
    ctx.ellipse(0, 0, ring2, ring2 * 0.45, 0, 0, Math.PI * 2); 
    ctx.stroke();

    // 35회 난수 생성 루프를 고정 12개 결정체로 최적화
    ctx.fillStyle = `rgba(230, 250, 255, ${1 - progress})`;
    for(let k = 0; k < 12; k++) {
        let ang = (k * Math.PI / 6) + (progress * 8);
        let dist = r * (0.2 + (k % 4) * 0.2) * easeOut;
        let px = Math.cos(ang) * dist;
        let py = Math.sin(ang) * dist * 0.45 - (progress * 40);
        ctx.fillRect(px - 2, py - 2, 4, 4);
    }
}
            else if (p.type === 'cancellation') {
                ctx.shadowBlur = 30; ctx.shadowColor = '#ff0000';
                ctx.strokeStyle = '#ff1111'; ctx.lineWidth = 7;
                let size = 45 * (1 - Math.abs(progress - 0.5) * 2);
                ctx.beginPath();
                ctx.moveTo(-size, -35 - size); ctx.lineTo(size, -35 + size);
                ctx.moveTo(size, -35 - size); ctx.lineTo(-size, -35 + size);
                ctx.stroke();
            }
            else if (p.type === 'immune_to_harm') {
                ctx.shadowBlur = 30; ctx.shadowColor = '#ff44bb';
                ctx.strokeStyle = 'rgba(255, 100, 210, 0.95)'; ctx.lineWidth = 4;
                ctx.fillStyle = 'rgba(255, 140, 220, 0.25)';
                let size = 50 + Math.sin(progress * Math.PI * 6) * 6;
                ctx.beginPath();
                ctx.moveTo(0, -35 - size); ctx.lineTo(size, -35); ctx.lineTo(0, -35 + size); ctx.lineTo(-size, -35);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            }
            else if (p.type === 'absolute_barrier') {
                let r = 55;
                ctx.shadowBlur = 35; ctx.shadowColor = '#ffaa00';
                ctx.fillStyle = 'rgba(255, 200, 0, 0.3)'; ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 3.5;
                ctx.beginPath(); ctx.arc(0, -20, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
                ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 255, 150, 0.9)';
                ctx.beginPath(); ctx.ellipse(0, -20, r, r/3, 0, 0, Math.PI*2); ctx.stroke();
                ctx.beginPath(); ctx.ellipse(0, -20, r/3, r, 0, 0, Math.PI*2); ctx.stroke();
            }
            else if (p.type === 'advance_spirit') {
                ctx.shadowBlur = 25;
                for(let j=0; j<2; j++) {
                    let angle = (progress * Math.PI * 10) + (j * Math.PI);
                    let px = Math.cos(angle) * 42; let py = Math.sin(angle) * 16 - 20;
                    ctx.fillStyle = j === 0 ? '#ff2200' : '#2255ff';
                    ctx.shadowColor = ctx.fillStyle;
                    ctx.beginPath(); ctx.arc(px, py, 9.5, 0, Math.PI*2); ctx.fill();
                }
            }
            else if (p.type === 'summon_effect') {
                ctx.shadowBlur = 30; ctx.shadowColor = '#aa00ff';
                ctx.strokeStyle = '#cc44ff'; ctx.lineWidth = 4;
                let mSize = 65 * easeOut;
                ctx.beginPath(); ctx.ellipse(0, 10, mSize, mSize * 0.4, 0, 0, Math.PI*2); ctx.stroke();
                ctx.fillStyle = '#f0d9ff';
                for(let j=0; j<15; j++) {
                    let sy = -progress * 110 - Math.random() * 25; let sx = (j - 7) * 7;
                    ctx.fillRect(sx, sy, 5, 5);
                }
            }
            else if (p.type === 'drain') { 
                let r = 110 * (1 - progress); 
                ctx.shadowBlur = 35; ctx.shadowColor = '#cc0000'; 
                ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 7;
                ctx.beginPath(); ctx.ellipse(0, -20, r, r * 0.5, 0, 0, Math.PI*2); ctx.stroke(); 
                ctx.beginPath(); ctx.ellipse(0, -20, r * 0.7, r * 0.35, 0, 0, Math.PI*2); ctx.stroke();
            }
            else if (p.type === 'judgment') {
                if (progress < 0.4) {
                    let fall = -900 * (1 - progress/0.4);
                    ctx.shadowBlur = 45; ctx.shadowColor = '#ffff00'; ctx.fillStyle = '#ffffff';
                    ctx.fillRect(-14, fall - 220, 28, 280);
                    ctx.fillRect(-70, fall - 80, 140, 22);
                } else {
                    let r = (p.size || 360) * ((progress - 0.4) / 0.6);
                    ctx.shadowBlur = 35; ctx.shadowColor = '#ffbb00';
                    ctx.strokeStyle = `rgba(255, 255, 100, ${1-progress})`; ctx.lineWidth = 12;
                    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.35, 0, 0, Math.PI*2); ctx.stroke();
                }
            }
            else if (p.type === 'tornado') {
                let r = p.size || 240; 
                ctx.shadowBlur = 25; ctx.shadowColor = '#222222';
                let dustR = (r * 0.8) * easeOut;
                ctx.strokeStyle = 'rgba(100, 100, 100, ' + (1 - progress) + ')'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.ellipse(0, 0, dustR, dustR * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
                for (let j = 0; j < 10; j++) {
                    ctx.strokeStyle = j % 2 === 0 ? '#dddddd' : '#444444'; 
                    ctx.lineWidth = 4 + (j * 0.6);
                    let tr = r * (0.15 + j * 0.1) * easeOut; 
                    let ty = -progress * 300 + (j * 25);
                    ctx.beginPath(); ctx.ellipse(0, ty, tr, tr * 0.3, progress * (25 + j * 2), 0, Math.PI * 2); ctx.stroke();
                }
            }
            else if (p.type === 'explosion') { 
                let r = (p.size || 120) * Math.pow(easeOut, 0.4);
                let grad = ctx.createRadialGradient(0, -10, 0, 0, -10, r);
                grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, '#ff5500'); grad.addColorStop(1, 'rgba(120,0,0,0)');
                ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, -10, r, 0, Math.PI*2); ctx.fill();
            }
            else if (p.type === 'classic_shield') {
                let r = 45 * Math.sin(progress * Math.PI);
                ctx.fillStyle = 'rgba(0, 220, 255, 0.3)'; ctx.strokeStyle = '#66ffff'; ctx.lineWidth = 3.5;
                ctx.beginPath(); ctx.arc(0, -20, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            }
            else if (p.type === 'majesty_shield') {
                ctx.fillStyle = '#ffcc00'; ctx.shadowBlur = 25; ctx.shadowColor = '#ff8800';
                let h = 60 * (1 - progress);
                ctx.beginPath();
                ctx.moveTo(-30, -10 - h); ctx.lineTo(-18, -45 - h); ctx.lineTo(-7, -22 - h);
                ctx.lineTo(0, -60 - h); ctx.lineTo(7, -22 - h); ctx.lineTo(18, -45 - h);
                ctx.lineTo(30, -10 - h); ctx.closePath(); ctx.fill();
            }
            else if (p.type === 'classic_potion') {
                p.angle += 0.15; 
                let moveUp = (1 - progress) * 60; 
                let px = Math.cos(p.angle) * p.radius;
                let py = Math.sin(p.angle) * p.radius * 0.4 - moveUp;
                ctx.strokeStyle = p.color; ctx.fillStyle = p.color;
                let starSize = 8 * Math.sin(progress * Math.PI);
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(px, py - starSize); ctx.lineTo(px, py + starSize); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(px - starSize, py); ctx.lineTo(px + starSize, py); ctx.stroke();
                ctx.beginPath(); ctx.arc(px, py, starSize*0.4, 0, Math.PI*2); ctx.fill();
            }
            else if (p.type === 'hit_spark') {
                //ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 20 * (1-progress), 0, Math.PI*2); ctx.fill();
            }
            else if (p.type === 'fireball_pixel') {
                ctx.shadowBlur = 0; 
                ctx.globalAlpha = p.life / p.maxLife;
                ctx.fillStyle = p.color;
                let s = p.size;
                ctx.fillRect(-s/2, -s/2, s, s);
            }
            else if (p.type === 'fire_spark') {
                let alpha = Math.max(0, p.life / p.maxLife);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color || '#ff4400';
                ctx.beginPath();
                ctx.arc(0, 0, Math.max(1, (p.size || 4) * alpha), 0, Math.PI * 2);
                ctx.fill();
            }
            else if (p.type === 'fireball_core_flash') {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color || '#ffea00';
                ctx.beginPath(); ctx.arc(0, 0, p.size * alpha, 0, Math.PI*2); ctx.fill();
            }
            else if (p.type === 'fireball_flame') {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color || '#ff2200';
                ctx.beginPath(); ctx.arc(0, 0, p.size * alpha, 0, Math.PI*2); ctx.fill();
            }
            else if (p.type === 'magic_circle' || p.type === 'magic_telegraph') {
                // 바닥 장판은 첫 번째 루프에서 처리
            }
            else {
               // ctx.fillStyle = p.color || '#fff'; ctx.beginPath(); ctx.arc(0, 0, (p.size||6)*(1-progress), 0, Math.PI*2); ctx.fill();
            }
        } catch(err) {
            console.error("이펙트 렌더링 에러 격리:", p.type, err);
        } finally {
            ctx.restore();
        }
    });

    dmgTexts.forEach(d => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, d.life));
        let fSize = d.fontSize || 16;
        ctx.font = `bold ${fSize}px "Malgun Gothic", sans-serif`;
        ctx.fillStyle = d.color || '#fff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3.5;
        ctx.strokeText(d.text, d.x, d.y);
        ctx.fillText(d.text, d.x, d.y);
        ctx.restore();
    });
    ctx.restore(); 

    // game.js -> draw() 내부 상단 타겟 HP 바 렌더링[cite: 6]
    if (player.target && player.target.hp > 0 && !player.target.isDead) {
        if (!(player.target.isSummon && player.target.owner === player)) {
            let ty = width < 768 ? 45 : 75;
            let tx = width / 2;
            
            ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.fillRect(tx - 85, ty, 170, 38);
            ctx.strokeRect(tx - 85, ty, 170, 38);

            let tName = player.target.name;
            let tColor = player.target.isBoss ? '#fd0' : '#f55';
            
            ctx.font = 'bold 12px "Malgun Gothic"';
            ctx.textAlign = 'center';
            ctx.fillStyle = tColor;
            // 💡 터치/클릭 시 해제됨을 시각적으로 안내[cite: 6]
            ctx.fillText(`${tName} [✕해제]`, tx, ty + 15);

            let targetMaxHp = player.target.maxHp || player.target.hp;
            let hpRatio = Math.max(0, player.target.hp / targetMaxHp);
            
            ctx.fillStyle = '#222';
            ctx.fillRect(tx - 75, ty + 20, 150, 8);
            ctx.fillStyle = player.target.isBoss ? '#ea580c' : '#dc2626';
            ctx.fillRect(tx - 75, ty + 20, 150 * hpRatio, 8);
            ctx.strokeStyle = '#333';
            ctx.strokeRect(tx - 75, ty + 20, 150, 8);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px "Malgun Gothic"';
            ctx.fillText(`${Math.floor(player.target.hp)} / ${Math.floor(targetMaxHp)}`, tx, ty + 27);
        }
    }

    if(mCtx) {
        mCtx.setTransform(1, 0, 0, 1, 0, 0); 
        mCtx.clearRect(0, 0, 150, 150); 
        mCtx.fillStyle = '#111'; mCtx.fillRect(0,0,150,150); 
        mCtx.save(); mCtx.translate(75, 75); mCtx.scale(0.04, 0.04); mCtx.translate(-player.x, -player.y);
        
        if(mData.safeZones) { 
            mCtx.fillStyle = 'rgba(0, 255, 0, 0.15)'; 
            mData.safeZones.forEach(sz => { mCtx.beginPath(); mCtx.arc(sz.x, sz.y, sz.r, 0, Math.PI*2); mCtx.fill(); }); 
        }
        if(mData.links) {
            mData.links.forEach(l => { mCtx.fillStyle = '#0ff'; mCtx.beginPath(); mCtx.arc(l.x, l.y, 120, 0, Math.PI*2); mCtx.fill(); });
        }
        
        npcs.forEach(n => { 
            if(n.map === currentMap){ mCtx.fillStyle = n.color || '#f0f'; mCtx.beginPath(); mCtx.arc(n.x, n.y, 120, 0, Math.PI*2); mCtx.fill(); } 
        });
        
        entities.forEach(e => { 
            if(e.map === currentMap && !e.isSummon && !e.isDead) { 
                mCtx.fillStyle = e.isBoss ? '#fa0' : '#f33'; 
                if (e.isPlayer) mCtx.fillStyle = '#fff'; 
                mCtx.beginPath(); 
                mCtx.arc(e.x, e.y, e.isBoss ? 250 : 150, 0, Math.PI * 2); 
                mCtx.fill(); 
            } 
        });
        
        mCtx.fillStyle = '#0f0'; 
        mCtx.beginPath(); mCtx.arc(player.x, player.y, 120, 0, Math.PI*2); mCtx.fill(); 
        mCtx.restore();

        let allPlayers = [player, ...entities.filter(e => e.isPlayer)];
        allPlayers.forEach(pEnt => {
            if (pEnt.bubbleText && pEnt.bubbleTimer && Date.now() < pEnt.bubbleTimer) {
                ctx.save();
                ctx.font = 'bold 12px "Malgun Gothic"';
                ctx.textAlign = 'center';
                
                let textWidth = ctx.measureText(pEnt.bubbleText).width;
                let boxWidth = textWidth + 16;
                let boxHeight = 24;

                let worldW = width / ZOOM;
                let visibleWorldH = (height - (uiBar ? uiBar.offsetHeight : 165)) / ZOOM;
                let camX = Math.max(0, Math.min(Math.round(player.x) - Math.floor(worldW / 2), mapSize - worldW));
                let camY = Math.max(0, Math.min(Math.round(player.y) - Math.floor(visibleWorldH / 2), mapSize - visibleWorldH));

                let screenX = (pEnt.x - camX) * ZOOM;
                let screenY = (pEnt.y - camY) * ZOOM;

                let bx = screenX;
                let by = screenY - 55 - (pEnt.size || 20) + 15;

                ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.roundRect(bx - boxWidth / 2, by - boxHeight / 2, boxWidth, boxHeight, 6);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.fillText(pEnt.bubbleText, bx, by + 4);
                ctx.restore();
            } else if (pEnt.bubbleTimer && Date.now() >= pEnt.bubbleTimer) {
                pEnt.bubbleText = null;
                pEnt.bubbleTimer = null;
            }
        });
    }
}



// ==========================================
// [4. 전투 및 이벤트 시스템]
// ==========================================
window.damageEntity = function(e, dmg, attacker, hitType = 'physical', skillName = null) {
    if (!e || e.isDead) return; 

    // 💡 [핵심] 내가 공격을 가하는 즉시 클라이언트 몬스터에 피격 타이머 강제 주입
    e.hitTime = performance.now();
    e.angle = Math.atan2(e.y - attacker.y, e.x - attacker.x);

    let isMyAttack = (attacker === player) || (attacker && attacker.isSummon && attacker.owner === player);
    if (isMyAttack && !e.isPlayer && !e.isSummon) {
        if (window.socket && currentUser) {
            let attackerId = (attacker && attacker.isSummon) ? attacker.id : window.socket.id;
            window.socket.emit('player_attack_request', {
                targetId: e.id,
                attackerId: attackerId,
                attackType: hitType,
                calculatedDmg: dmg,
                magicName: skillName || player.selectedManualSpell || null
            });
        }
    }
};
function createFireballExplosionEffect(x, y, aoeRadius) {
    if (typeof isBgTick !== 'undefined' && isBgTick) return;
    if (typeof particles === 'undefined' || !Array.isArray(particles)) return;

    particles.push({
        type: 'fireball_core_flash',
        x: x, y: y,
        life: 0.25, maxLife: 0.25,
        size: aoeRadius * 0.9,
        color: '#ffea00'
    });

    for (let i = 0; i < 6; i++) {
        let angle = (Math.PI * 2 / 6) * i;
        particles.push({
            type: 'fireball_spark', x: x, y: y,
            vx: Math.cos(angle) * 80, vy: Math.sin(angle) * 80,
            life: 0.3, maxLife: 0.3, size: 8, color: '#ff3300'
        });
    }

    for (let i = 0; i < 12; i++) {
        let rx = (Math.random() - 0.5) * (aoeRadius * 0.5);
        let ry = (Math.random() - 0.5) * (aoeRadius * 0.5);
        particles.push({
            type: 'fireball_flame',
            x: x + rx, y: y + ry,
            vx: (Math.random() - 0.5) * 30,
            vy: -Math.random() * 60 - 20,
            life: 0.6, maxLife: 0.6,
            size: Math.random() * 14 + 8,
            color: Math.random() < 0.5 ? '#ff2200' : '#ff8800'
        });
    }
}

function castAttackSpell(target, magicName, caster = player, ignoreLearnCheck = false) {
    if (!magicName || typeof magicDb === 'undefined' || !magicDb[magicName]) return;
    let mData = magicDb[magicName];

    if (caster === player && !ignoreLearnCheck && (!player.magic || !player.magic.includes(magicName))) {
        if (typeof addMessage === 'function') addMessage("습득하지 않은 마법입니다.", '#f55');
        return;
    }

    if (magicName === '서먼 몬스터') {
        if (caster.mp >= mData.mp) {
            caster.mp -= mData.mp;
            if (window.socket && currentUser) {
                window.socket.emit('player_summon_monster', { level: caster.level || 1 });
            }
            if (typeof playSound === 'function') playSound('spell');
            if (typeof addMessage === 'function') addMessage("✨ 소환수를 소환합니다!", '#5ff');
            if (typeof updateUI === 'function') updateUI();
        } else {
            if (caster === player && typeof addMessage === 'function') addMessage("MP가 부족합니다.", '#f55');
        }
        return;
    }

    let isHealSpell = mData.heal || magicName.includes('힐') || magicName === '네이쳐스 터치' || magicName === '워터 라이프';
    if (isHealSpell) {
        if (caster.mp >= mData.mp) {
            caster.mp -= mData.mp;
            let healAmt = mData.heal || 40;
            let actualTarget = target || caster;
            
            actualTarget.hp = Math.min(actualTarget.maxHp || (actualTarget === player ? currentMaxHp : 100), actualTarget.hp + healAmt);
            
            if (window.socket && currentUser) {
                window.socket.emit('player_magic_action', {
                    magicName: magicName, targetX: actualTarget.x, targetY: actualTarget.y, targetId: actualTarget.id || window.socket.id,
                    casterX: caster.x, casterY: caster.y, casterId: caster.id || window.socket.id, map: currentMap
                });
            }
            if (typeof playSound === 'function') playSound('heal');
            if (typeof dmgTexts !== 'undefined') dmgTexts.push({ x: actualTarget.x, y: actualTarget.y - 30, text: `+${healAmt} 힐!`, life: 1.2, color: '#5f5' });
            if (typeof updateUI === 'function') updateUI();
        } else {
            if (caster === player && typeof addMessage === 'function') addMessage("MP가 부족합니다.", '#f55');
        }
        return;
    }

    let isBuffSpell = mData.type === 'buff' || magicName === '가속' || magicName === '가속(헤이스트)' || magicName === '윈드 워크' || magicName === '실드';
    if (isBuffSpell) {
        if (caster.mp >= mData.mp) {
            caster.mp -= mData.mp;
            let actualTarget = target || caster;
            
            if (window.socket && currentUser) {
                window.socket.emit('player_magic_action', {
                    magicName: magicName, targetX: actualTarget.x, targetY: actualTarget.y, targetId: actualTarget.id || window.socket.id,
                    casterX: caster.x, casterY: caster.y, casterId: caster.id || window.socket.id, map: currentMap
                });
            }
            if (typeof applyBuff === 'function') applyBuff(magicName, mData.duration || 300000, mData.icon || '💨', mData.buffType || 'speed', mData.val || 60, actualTarget);
            if (typeof playSound === 'function') playSound('spell');
            if (typeof updateUI === 'function') updateUI();
            if (caster === player && typeof addMessage === 'function') addMessage(`✨ [마법 시전] ${magicName}!`, '#5fd');
        } else {
            if (caster === player && typeof addMessage === 'function') addMessage("MP가 부족합니다.", '#f55');
        }
        return;
    }

    let isAttackMagic = mData.type === 'attack' || mData.dmg;
    if (isAttackMagic) {
        if (typeof isInSafeZone === 'function' && (isInSafeZone(currentMap, caster.x, caster.y) || (target && isInSafeZone(currentMap, target.x, target.y)))) { 
            if (caster === player && typeof addMessage === 'function') addMessage("안전지대에서는 공격 마법을 사용할 수 없습니다.", '#f55'); 
            return; 
        }
        let isAllyTarget = target && (target === player || target.isSummon || target.isMercenary || target.owner === player);
        if (isAllyTarget) {
            if (caster === player && typeof addMessage === 'function') addMessage("아군에게는 공격 마법을 사용할 수 없습니다.", '#f55');
            return;
        }
    }

    if (!target || typeof target.x === 'undefined' || typeof target.y === 'undefined') return;

    let spellBaseRange = mData.range || 280;
    let allowedRange = spellBaseRange + (target.size || 20) + 40; 
    let dist = Math.hypot(target.x - caster.x, target.y - caster.y);

    if (dist > allowedRange) { 
        if (caster === player) player.isMoving = true;
        return; 
    }
    
    if (caster.mp >= mData.mp) {
        caster.mp -= mData.mp; 
        if (caster === player) lastSpellCastTime = performance.now();

        if (caster === player) {
            if (magicName === '에너지 볼트') playSound('energy_bolt');
            else if (magicName === '파이어볼' || magicName === '이럽션' || magicName === '선버스트') playSound('fireball'); 
            else if (magicName === '콜 라이트닝' || magicName === '라이트닝 스톰') playSound('lightning'); 
            else if (magicName === '블리자드' || magicName === '헤일 스톰' || magicName === '아이스 스파이크') playSound('blizzard'); 
            else if (magicName === '디스인티그레이트') playSound('disintegrate');
            else playSound('spell');
        } else {
            if (typeof playSound === 'function') playSound('fireball');
        }

        caster.lastAttack = performance.now(); 
        if (caster === player) caster.target = target; 
        caster.angle = Math.atan2(target.y - caster.y, target.x - caster.x);

        if ((caster === player || caster.owner === player) && window.socket && currentUser) {
            window.socket.emit('player_magic_action', {
                magicName: magicName, targetX: target ? target.x : caster.x, targetY: target ? target.y : caster.y, targetId: target ? target.id : null,
                casterX: caster.x, casterY: caster.y, casterId: caster.id || window.socket.id, map: currentMap
            });
        }

        let mainStat = (caster.charClass === 'elf') ? (player.dex || 18) : (player.int || 10);
        let weaponSp = (caster.equip && caster.equip.weapon && caster.equip.weapon.sp) ? caster.equip.weapon.sp : 0;
        let casterSp = (caster === player) ? ((player.sp || 0) + weaponSp + Math.floor((mainStat - 10) / 2)) : Math.floor((caster.level || 1) / 5);
        let scale = 1 + (casterSp * 0.15) + Math.max(0, (mainStat - 12) * 0.05); 
        let finalDmg = Math.floor((mData.dmg || 15) * scale);

        if (caster === player && window.playerComboCount >= 3) {
            finalDmg = Math.floor(finalDmg * 1.5);
            window.playerComboCount = 0;
            if (!isBgTick && typeof dmgTexts !== 'undefined') {
                dmgTexts.push({ x: target.x, y: target.y - 40, text: "COMBO ATTACK! 1.5x", life: 1.2, color: '#ff00ff' });
            }
        }

        // 💡 이곳에 있던 수백 줄의 파티클 코드가 완벽히 삭제되어 엔진 꼬임을 방지합니다.

        if (magicName === '트리플 애로우') {
            let now = Date.now();
            let isCoolingDown = now < (caster.elfFuryCooldownUntil || 0);

            if (caster === player && !(now < (caster.elfFuryUntil || 0)) && !isCoolingDown) {
                caster.elfHitCount = (caster.elfHitCount || 0) + 3; 
                if (caster.elfHitCount >= 5) {
                    caster.elfHitCount = 0;
                    caster.elfFuryUntil = now + 4000;
                    caster.elfFuryCooldownUntil = now + 6000;
                    if (typeof dmgTexts !== 'undefined') dmgTexts.push({ x: caster.x, y: caster.y - 50, text: "🌪️ SYLPH TEMPEST! (실프의 폭풍)", life: 1.5, color: '#34d399', fontSize: 25});
                }
            }

            let isFury = (caster.charClass === 'elf' && Date.now() < (caster.elfFuryUntil || 0));

            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    if (target && target.hp > 0 && target.map === currentMap) {
                        if (isFury) {
                            let splashTargets = entities.filter(e => e && e.map === currentMap && !e.isPlayer && !e.isSummon && e.hp > 0 && !e.isDead && Math.hypot(e.x - target.x, e.y - target.y) <= 200);
                            let subDmg = Math.floor((finalDmg / 3) * 1.4);
                            let totalTripleFuryDmg = 0;
                            
                            splashTargets.forEach(st => {
                                totalTripleFuryDmg += subDmg;
                                damageEntity(st, subDmg, caster, 'physical', '트리플 애로우');
                            });

                            if (caster === player) {
                                let hpHeal = Math.max(1, Math.floor(totalTripleFuryDmg * 0.02));
                                let mpGain = Math.max(1, Math.floor(totalTripleFuryDmg * 0.05));
                                player.hp = Math.min(window.currentMaxHp || player.maxHp, player.hp + hpHeal);
                                player.mp = Math.min(window.currentMaxMp || player.maxMp, player.mp + mpGain);
                            }
                        } else {
                            damageEntity(target, Math.floor(finalDmg / 3), caster, 'physical', '트리플 애로우');
                        }
                        if (typeof playSound === 'function') playSound('bow');
                        if (typeof updateUI === 'function') updateUI();
                    }
                }, i * 90);
            }
        }
        else {
            let delay = (magicName === '미티어 스트라이크' || magicName === '저지먼트') ? 400 : 50;
            setTimeout(() => {
                if (!target || target.hp <= 0 || target.isDead || target.map !== currentMap) return;
                if (mData.aoe) {
                    let targetsToDamage = entities.filter(e => e.map === currentMap && !e.isSummon && e.hp > 0 && Math.hypot(e.x - target.x, e.y - target.y) <= mData.aoe && !isInSafeZone(currentMap, e.x, e.y));
                    targetsToDamage.forEach(t => damageEntity(t, finalDmg, caster, 'magic', magicName));
                } else {
                    damageEntity(target, finalDmg, caster, 'magic', magicName);
                }
                if (typeof updateUI === 'function') updateUI();
            }, delay);
        }
        if (typeof updateUI === 'function') updateUI();
    } else { 
        if (caster === player && typeof addMessage === 'function') addMessage("MP가 부족합니다.", '#f55'); 
    }
}



function getWorldPos(cx, cy) {
    let uiBar = document.getElementById('ui-bottom-bar'); let uiHeight = uiBar ? uiBar.offsetHeight : 165;
    let worldW = width / ZOOM; let visibleWorldH = (height - uiHeight) / ZOOM;
    let camX = Math.max(0, Math.min(player.x - worldW / 2, mapSize - worldW));
    let camY = Math.max(0, Math.min(player.y - visibleWorldH / 2, mapSize - visibleWorldH));
    return { x: camX + cx / ZOOM, y: camY + cy / ZOOM };
}

function handleInput(cx, cy, button) {
    if(activeEnchantScrollKey) { 
        activeEnchantScrollKey = null; 
        document.body.style.cursor = 'default'; 
        addMessage("강화가 취소되었습니다.", '#aaa'); 
        return; 
    }

    // 💡 [수정] 상단 타겟바 터치/클릭 시 타겟 해제 & 다음 몬스터 즉시 탐색 활성화
    if (player.target) {
        let ty = width < 768 ? 45 : 75;
        let tx = width / 2;
        let boxHalfW = 95;
        let boxH = 48;
        
        if (cx >= tx - boxHalfW && cx <= tx + boxHalfW && cy >= ty - 5 && cy <= ty + boxH) {
            let prevTargetId = player.target.id;
            player.target = null;
            player.manualOverrideUntil = 0; // 💡 1.5초 이동 딜레이 제거
            player.moveX = undefined;
            player.moveY = undefined;
            player.isMoving = false;
            
            // 💡 방금 푼 몬스터는 3.5초간 탐색에서 제외 -> 다음 몬스터로 자연스럽게 전환
            player.ignoredTargetId = prevTargetId;
            player.ignoredUntil = performance.now() + 3500;

            if (typeof playSound === 'function') playSound('click');
            if (typeof addMessage === 'function') addMessage("타겟 해제 -> 다음 몬스터를 탐색합니다.", '#5cf');
            return; // 빈 땅 이동 로직으로 넘어가지 않음
        }
    }

    let pos = getWorldPos(cx, cy); 
    let worldX = pos.x; 
    let worldY = pos.y;
    
    // 소환수/용병 클릭 검사
    let clickedSummon = entities.find(ent => ent.map === currentMap && ent.isSummon && ent.owner === player && Math.hypot(ent.x - worldX, ent.y - worldY) < (ent.size||20) + 15);

    if (clickedSummon && !isCtrlPressed) {
        if (button === 2) window.openPetUI(clickedSummon);
        else { player.target = clickedSummon; player.moveX = undefined; player.moveY = undefined; addMessage(`[소환수 지정] ${clickedSummon.name}`, '#5ff'); }
        return;
    }

    // NPC 상호작용
    for(let n of npcs) { 
        if(n.map === currentMap && Math.hypot(n.x - worldX, n.y - worldY) < 50 && !isCtrlPressed) { 
            if(n.id.includes('warehouse')) openWarehouseUI(); 
            else if(n.id.includes('petkeeper')) openPetKeeperUI();
            else if(n.id.includes('mercenary')) openMercenaryUI(); 
            else openShop(n.id); 
            return; 
        } 
    }
    
    // 몬스터 클릭 검사
    let clickedMob = null;
    for(let i = entities.length - 1; i >= 0; i--) {
        let e = entities[i];
        if(e.map === currentMap && !e.isPlayer && !e.isOtherMerc && Math.hypot(e.x - worldX, e.y - worldY) < (e.size || 20) + 10) { clickedMob = e; break; }
    }
    
    if (clickedMob) {
        if(clickedMob.isSummon && clickedMob.hp <= 0) { entities.splice(entities.indexOf(clickedMob), 1); addMessage("죽은 소환수를 정리했습니다.", "#aaa"); return; }
        
        let isOwnSummon = (clickedMob.isSummon && clickedMob.owner === player);
        if(isOwnSummon && !isCtrlPressed) { player.target = null; player.isMoving = true; player.moveX = worldX; player.moveY = worldY; return; }
        
        player.target = clickedMob; 
        player.isMoving = false; 
        player.moveX = undefined; 
        player.moveY = undefined;
        
        if (window.socket && currentUser) {
            window.socket.emit('player_target', { targetId: clickedMob.id });
        }

        if (player.selectedManualSpell) {
            let sData = magicDb[player.selectedManualSpell];
            if (sData && sData.type === 'attack') castAttackSpell(clickedMob, player.selectedManualSpell);
        }
    } else {
        // 💡 [수정] 빈 땅 클릭 시: 자동사냥 중에도 수동 조작 우선권(1.5초) 부여
       // player.target = null; 
        player.isMoving = true; 
        player.moveX = worldX; 
        player.moveY = worldY;
        player.manualOverrideUntil = performance.now() + 1500; 
        particles.push({x: pos.x, y: pos.y, life: 0.4, maxLife: 0.4, type: 'click_marker', color: '#5f5'});
    }
}


let lastTouchHandledTime = 0;
canvas.addEventListener('pointerdown', (e) => { 
    if(!gameStarted) return; 
    if (e.pointerType === 'touch') return; // 💡 모바일 터치는 touchstart에서 전담 처리하여 중복 차단
    let uiBar = document.getElementById('ui-bottom-bar'); 
    let uiHeight = uiBar ? uiBar.offsetHeight : 165; 
    if(e.clientY > window.innerHeight - uiHeight) return; 
    handleInput(e.clientX, e.clientY, e.button); 
});

// ==========================================
// 📱 모바일 길게 터치 & 💻 PC 우클릭 완벽 연동 (변수 중복 제거 버전)
// ==========================================
window.touchStartX = window.touchStartX || 0;
window.touchStartY = window.touchStartY || 0;
touchTimer = null; // let을 제거하여 기존 선언된 touchTimer 재사용

canvas.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    if (!gameStarted) return; 

    let uiBar = document.getElementById('ui-bottom-bar'); 
    let uiHeight = uiBar ? uiBar.offsetHeight : 140; 
    let cx = e.touches[0].clientX; 
    let cy = e.touches[0].clientY;
    if (cy > window.innerHeight - uiHeight) return; 

    window.touchStartX = cx;
    window.touchStartY = cy;

    let now = performance.now();
    if (now - (window.lastTouchHandledTime || 0) < 60) return; // 💡 터치 씹힘 방지를 위해 딜레이를 100ms -> 60ms로 단축
    window.lastTouchHandledTime = now;

    let pos = getWorldPos(cx, cy);

    let myId = window.currentUser ? window.currentUser.id : null;
    let mySockId = window.socket ? window.socket.id : null;

    // 💡 [판정 범위 확장] 타 유저 클릭/롱탭 판정 범위를 70px -> 110px로 확대하여 소형폰에서도 쉽게 잡히도록 개선
    let targetPlayer = entities.find(ent => 
        ent && ent.map === currentMap && ent.isPlayer && 
        ent.id !== myId && ent.socketId !== mySockId && ent !== player &&
        Math.hypot(ent.x - pos.x, ent.y - pos.y) < 110
    );

    if (targetPlayer) {
        touchTimer = setTimeout(() => {
            if (typeof window.showPartyMenu === 'function') {
                window.showPartyMenu(targetPlayer);
            }
        }, 380); // 💡 길게 누르기 반응 속도를 500ms -> 380ms로 경쾌하게 개선
        return;
    }

    let clickedSummon = entities.find(ent => 
        ent && ent.map === currentMap && ent.isSummon && ent.owner === player && 
        Math.hypot(ent.x - pos.x, ent.y - pos.y) < (ent.size || 20) + 45
    );

    if (clickedSummon) {
        if (!player.autoHunt) player.target = clickedSummon; 
        player.moveX = undefined; 
        player.moveY = undefined;
        if (typeof addMessage === 'function') addMessage(`[소환수 지정] ${clickedSummon.name}`, '#5ff');  
        touchTimer = setTimeout(() => { 
            if (typeof window.openPetUI === 'function') window.openPetUI(clickedSummon); 
        }, 380); 
    } else { 
        handleInput(cx, cy, 0); 
    }
}, { passive: false });


canvas.addEventListener('touchmove', (e) => { 
    if (e.touches && e.touches[0]) {
        let moveDist = Math.hypot(e.touches[0].clientX - window.touchStartX, e.touches[0].clientY - window.touchStartY);
        if (moveDist > 12) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }
    }
}, { passive: false });

canvas.addEventListener('touchend', () => { 
    clearTimeout(touchTimer); 
    touchTimer = null;
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault(); 
    if (!gameStarted) return;

    let rect = canvas.getBoundingClientRect(); 
    let cx = e.clientX - rect.left; 
    let cy = e.clientY - rect.top;
    let pos = getWorldPos(cx, cy);

    let myId = window.currentUser ? window.currentUser.id : null;
    let mySockId = window.socket ? window.socket.id : null;

    let targetEntity = entities.find(ent => 
        ent && ent.map === currentMap && ent.isPlayer && 
        ent.id !== myId && ent.socketId !== mySockId && ent !== player &&
        Math.hypot(ent.x - pos.x, ent.y - pos.y) < 55
    );

    if (targetEntity) {
        if (typeof window.showPartyMenu === 'function') {
            window.showPartyMenu(targetEntity);
            return;
        }
    }

    let clickedOther = entities.find(ent => 
        ent && ent.map === currentMap && Math.hypot(ent.x - pos.x, ent.y - pos.y) < (ent.size || 20) + 35
    );

    if (clickedOther) {
        if (clickedOther.isSummon && clickedOther.owner === player) { 
            if (typeof window.openPetUI === 'function') window.openPetUI(clickedOther); 
        } else { 
            if (typeof addMessage === 'function') {
                addMessage(`[대상 정보] ${clickedOther.name || '몬스터'} | HP: ${Math.floor(clickedOther.hp)}/${clickedOther.maxHp || clickedOther.hp} | ATK: ${clickedOther.atk || 0}`, '#ff0'); 
            }
        }
    }
});



canvas.addEventListener('touchend', () => { clearTimeout(touchTimer); });
canvas.addEventListener('touchmove', () => { clearTimeout(touchTimer); });
window.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    if (typeof draggedItemIndex === 'undefined' || draggedItemIndex === null || !draggedItemData) return;
    let rect = canvas.getBoundingClientRect();
    let pos = getWorldPos(e.clientX - rect.left, e.clientY - rect.top);
    let targetMerc = entities.find(ent => ent.map === currentMap && ent.isSummon && ent.owner === player && Math.hypot(ent.x - pos.x, ent.y - pos.y) < 50);
    if (targetMerc && typeof handleItemDropOnMercenary === 'function') window.handleItemDropOnMercenary(targetMerc, draggedItemIndex, draggedItemData);
});

// ==========================================
// [5. 메인 게임 루프 (AI 및 이동)]
// ==========================================
function update(timestamp) {
    if (!gameStarted) return;
    let dt = Math.min(70, Math.max(1, timestamp - lastTime)); 
    lastTime = timestamp;
    const now = Date.now();

  if (typeof window.processAutoConsumablesAndBuffs === 'function') {
        window.processAutoConsumablesAndBuffs();
    }

    // 1. 엔티티 부드러운 보간 이동 (보스 포함)
    let moveDelta = Math.min(1.0, (dt / 1000) * 4.5);

for (let i = 0; i < entities.length; i++) {
    let e = entities[i];
    if (!e) continue;
    if ((e.isPlayer || e.isOtherMerc || !e.isSummon) && e.moveX !== undefined && e.moveY !== undefined) {
        let dist = Math.hypot(e.moveX - e.x, e.moveY - e.y);
        if (dist > 1.5) {
            e.x += (e.moveX - e.x) * moveDelta;
            e.y += (e.moveY - e.y) * moveDelta;
            e.isMoving = true;
            e.lastMoveAnimTime = timestamp;
            e.angle = Math.atan2(e.moveY - e.y, e.moveX - e.x);
        } else { 
            if (timestamp - (e.lastMoveAnimTime || 0) > 120) {
                e.isMoving = false; 
            }
        }
    }
}
    

    // 2. 플레이어 자연 회복 (HP / MP)
    if (timestamp - (player.lastRegen || 0) > 2000) {
        player.lastRegen = timestamp;
        let hpRegenAmt = 1 + (player.totalHpRegen || 0);
        let mpRegenAmt = 1 + (player.totalMpRegen || 0);
        
        if (player.hp > 0 && player.hp < currentMaxHp) player.hp = Math.min(currentMaxHp, player.hp + hpRegenAmt);
        if (player.hp > 0 && player.mp < currentMaxMp) player.mp = Math.min(currentMaxMp, player.mp + mpRegenAmt);
        if (typeof updateUI === 'function') updateUI();
    }

    // 3. 안전지대 판정 및 UI 표시
    let playerInSafeZone = typeof isInSafeZone === 'function' ? isInSafeZone(currentMap, player.x, player.y) : false;
let zoneEl = document.getElementById('zone-indicator');
if (playerInSafeZone) {
    if (zoneEl && zoneEl.innerText !== '[ 안전 지대 ]') { zoneEl.innerText = '[ 안전 지대 ]'; zoneEl.style.color = '#5f5'; }
    if (player.autoHunt || player.autoPotion) { 
        player.autoHunt = false; 
        player.autoPotion = false; // 💡 안전지대 워프 시 물약/사냥 모두 OFF
        player.target = null; 
        player.isMoving = false; 
        if (typeof addMessage === 'function') addMessage("[안전지대 진입] 자동사냥 및 자동물약이 해제되었습니다.", '#f55'); 
        if (typeof updateUI === 'function') updateUI(); 
    }
    } else {
        if (zoneEl && zoneEl.innerText !== '[ 전투 지대 ]') { zoneEl.innerText = '[ 전투 지대 ]'; zoneEl.style.color = '#f55'; }
    }

    isBgTick = document.visibilityState !== 'visible';
    
 
   // ========================================================
    // 4. 타겟 유효성 및 수동 도망 시 어그로 이탈 검사
    // ========================================================
    if (player.target) {
        // 💡 고유 ID로 현재 맵에 살아있는 몬스터인지 확실하게 동기화
        let liveTarget = entities.find(e => e && e.id === player.target.id && e.hp > 0 && !e.isDead);
        
        if (!liveTarget || liveTarget.map !== currentMap || liveTarget.isPlayer || (liveTarget.isSummon && liveTarget.owner === player)) {
            player.target = null;
            player.isMoving = false;
        } else {
            player.target = liveTarget; // 최신 좌표 객체로 갱신
            
            // 💡 [수정] 수동 조작 중일 때만 650px 이상 도망치면 타겟 해제 (자동사냥 중에는 먼 몬스터도 끝까지 추적)
            let distToTarget = Math.hypot(liveTarget.x - player.x, liveTarget.y - player.y);
            if (!player.autoHunt && distToTarget > 650) {
                player.target = null;
                if (typeof addMessage === 'function') addMessage("몬스터와 거리가 멀어져 타겟이 해제되었습니다.", "#aaa");
            }
        }
    }
  // 5. UI 및 소환수 갱신 (매 프레임 실행하지 않고 200ms 주기로 제한하여 DOM 렉 제거)
if (!window._lastHudUpdateTime || timestamp - window._lastHudUpdateTime > 200) {
    window._lastHudUpdateTime = timestamp;
    if (typeof window.renderMercenaryHUD === 'function') window.renderMercenaryHUD();
    if (document.getElementById('win-pet') && document.getElementById('win-pet').style.display === 'flex' && typeof window.updatePetUI === 'function') window.updatePetUI();
}


if (typeof updateMercenaryAI === 'function') updateMercenaryAI();

if (!window._lastSocketSendTime || timestamp - window._lastSocketSendTime > 100) {
    window._lastSocketSendTime = timestamp;
    // 💡 [수정] 제자리 사냥 중이어도 용병의 물약 복용/현재 HP가 서버에 실시간으로 반영되도록 조건 완화
    if (window.socket && currentUser) {
let myActiveMercs = entities.filter(ent => ent && ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0);
        window.socket.emit('player_update', {
            name: player.name,
            charClass: player.charClass,
            x: player.x,
            y: player.y,
            hp: player.hp,
            maxHp: currentMaxHp,
            atk: player.atk || 20,       // 💡 실제 최종 연산 공격력 전송
            def: player.def || 0,        // 💡 실제 최종 연산 방어력 전송
            str: player.str || 18,
            dex: player.dex || 14,
            int: player.int || 8,
            level: player.level || 1,
            map: currentMap,
            equip: player.equip,
            mercs: myActiveMercs.map(m => ({
                id: m.id,
                name: m.name,
                mercType: m.mercType || 'knight',
                charClass: m.mercType || m.charClass || 'knight',
                ownerId: window.socket.id,
                ownerName: player.name,
                x: m.x,
                y: m.y,
                hp: m.hp,
                maxHp: m.maxHp,
                atk: m.atk || 15,        // 💡 용병 실시간 공격력
                def: m.def || 5,         // 💡 용병 실시간 방어력
                equip: m.equip || { weapon: null, armor: null, helmet: null, cloak: null },
                angle: m.angle || 0,
                isMoving: m.isMoving || false
            }))
        });
    }
}

    // 7. 파티클 수명 및 물리 연산
    if (typeof particles !== 'undefined' && Array.isArray(particles)) {
        let delta = (typeof dt === 'number' && dt > 0) ? (dt / 1000) : 0.016;
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            if (!p) { particles.splice(i, 1); continue; }

            if (p.vy !== undefined) p.y -= p.vy * delta;
            else if (p.type === 'damage' || p.type === 'text' || p.type === 'adena' || p.text !== undefined || p.damage !== undefined) p.y -= 35 * delta;
            
            if (p.vx !== undefined) p.x += p.vx * delta;
            if (typeof p.life !== 'number' && typeof p.timer !== 'number' && typeof p.duration !== 'number') p.life = 0.8;

            if (typeof p.life === 'number') { p.life -= delta; if (p.life <= 0) { particles.splice(i, 1); continue; } } 
            else if (typeof p.timer === 'number') { p.timer -= delta; if (p.timer <= 0) { particles.splice(i, 1); continue; } } 
            else if (typeof p.duration === 'number') { p.duration -= delta; if (p.duration <= 0) { particles.splice(i, 1); continue; } }
        }
    }

    // 8. 데미지 텍스트 갱신
    if (typeof dmgTexts !== 'undefined' && Array.isArray(dmgTexts)) {
        let delta = (typeof dt === 'number' && dt > 0) ? (dt / 1000) : 0.016;
        for (let i = dmgTexts.length - 1; i >= 0; i--) {
            let d = dmgTexts[i];
            if (!d) { dmgTexts.splice(i, 1); continue; }
            d.y -= 35 * delta;
            d.life = (typeof d.life === 'number' ? d.life : 0.8) - delta;
            if (d.life <= 0) dmgTexts.splice(i, 1);
        }
    }

    // 9. 투사체(발사체) 이동 및 충돌 판정
    if (typeof particles !== 'undefined' && Array.isArray(particles)) {
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            if (!p) continue;

            if (p.isProj && (p.type === 'fireball_proj' || p.type === 'fireball')) {
                p.x += Math.cos(p.angle || 0) * (p.speed || 8);
                p.y += Math.sin(p.angle || 0) * (p.speed || 8);

                if (Math.random() < 0.6) {
                    particles.push({
                        type: 'fireball_spark',
                        x: p.x + (Math.random() - 0.5) * 8,
                        y: p.y + (Math.random() - 0.5) * 8,
                        vx: (Math.random() - 0.5) * 1.5,
                        vy: (Math.random() - 0.5) * 1.5,
                        size: Math.random() * 4 + 2,
                        life: 12,
                        maxLife: 12,
                        color: Math.random() < 0.5 ? '#FF4500' : '#FFD700'
                    });
                }

        if (p.target && typeof p.target.x === 'number' && typeof p.target.y === 'number' && !p.isHit) {
            if (Math.hypot(p.target.x - p.x, p.target.y - p.y) < 35) {
                p.isHit = true;
                p.life = 0;

                // 💡 [핵심] 화살이나 마법 투사체가 명중하는 순간에도 피격 번쩍임 적용
                p.target.hitTime = performance.now();
                p.target.angle = p.angle || Math.atan2(p.target.y - p.y, p.target.x - p.x);

                const isArrowType = p.isArrow || p.type === 'arrow';
                if (typeof damageEntity === 'function') {
                    if (!isArrowType || p.rollHit) {
                        damageEntity(p.target, p.dmg, p.attacker, isArrowType ? 'physical' : 'magic');
                    }
                }
                particles.splice(i, 1);
                continue;
            }
        }
            }
            else if (p.type === 'fireball_spark') {
                p.x += p.vx || 0;
                p.y += p.vy || 0;
                if (p.vx !== undefined) p.vx *= 0.92;
                if (p.vy !== undefined) p.vy *= 0.92;
            }
            else if (p.isProj) {
                if (p.homing && p.target && typeof p.target.x === 'number' && typeof p.target.y === 'number') {
                    p.angle = Math.atan2(p.target.y - p.y, p.target.x - p.x);
                }

                p.x += Math.cos(p.angle || 0) * (p.speed || 10);
                p.y += Math.sin(p.angle || 0) * (p.speed || 10);

                if (p.target && typeof p.target.x === 'number' && typeof p.target.y === 'number' && !p.isHit) {
                    if (Math.hypot(p.target.x - p.x, p.target.y - p.y) < 20) {
                        p.isHit = true;
                        p.life = 0;

                        const isArrowType = p.isArrow || p.type === 'arrow';
                        if (typeof damageEntity === 'function') {
                            if (!isArrowType || p.rollHit) {
                                damageEntity(p.target, p.dmg, p.attacker, isArrowType ? 'physical' : 'magic');
                            }
                        }
                        particles.splice(i, 1);
                        continue;
                    }
                }
            }
            if (p.vx !== undefined && p.vy !== undefined && !p.type) {
                p.vx *= 0.92;
                p.vy *= 0.92;
            }
        }
    }

    // 10. 바닥 아이템 드랍 수명 및 렌더링
  if (typeof items !== 'undefined' && Array.isArray(items)) {
    for (let i = items.length - 1; i >= 0; i--) {
        let it = items[i];
        if (!it) { items.splice(i, 1); continue; }
        if (it.spawnTime === undefined) it.spawnTime = Date.now();
        if (Date.now() - it.spawnTime > 60000) { items.splice(i, 1); continue; }
    }
}

    // 버프에 따른 속도 및 공격 딜레이 보정
    let pSpeed = player.currentSpeed || 180;
    let atkDelay = player.currentAtkDelay || 800;
    if (player.buffs && player.buffs['가속(헤이스트)']) { pSpeed += 100; atkDelay -= 200; }
    if (player.buffs && player.buffs['용기물약']) atkDelay -= 100;
    if (player.buffs && player.buffs['엘븐와퍼']) atkDelay -= 100;

    let target = player.target;

    // 11. [기사 전용 패시브] 돌진(Rush)
    if (player.charClass === 'knight' && target && !player.isMoving) {
        let rushDist = Math.hypot(target.x - player.x, target.y - player.y);
        if (rushDist > 55 && rushDist <= 350 && (!player.lastRushTime || now - player.lastRushTime > 2000)) {
            player.lastRushTime = now;
            
            if (!isBgTick && typeof particles !== 'undefined') {
                particles.push({ x: player.x, y: player.y, life: 0.4, maxLife: 0.4, type: 'haste_tornado', size: 40 });
            }
            if (typeof playSound === 'function') playSound('spell');

            // 💡 [수정] 돌진 시 타겟을 바라보는 현재 각도를 정확히 계산하여 엇나가지 않게 처리
            let rushAngle = Math.atan2(target.y - player.y, target.x - player.x);
            player.angle = rushAngle; 
            player.x = target.x - Math.cos(rushAngle) * 30;
            player.y = target.y - Math.sin(rushAngle) * 30;
            
            if (window.socket && currentUser) {
                window.socket.emit('player_update', {
                    name: player.name, charClass: player.charClass,
                    x: player.x, y: player.y, hp: player.hp, maxHp: currentMaxHp, map: currentMap,
                    equip: player.equip
                });
            }
            if (typeof dmgTexts !== 'undefined') {
                triggerPassiveBroadcast("⚡ RUSH!", target.x, target.y, target.id, 'high', player, 16);
            }
        }
    }
// ========================================================
// 12. 타겟 추적 이동 및 패시브 공격 실행 (기사/요정 완결판)
// ========================================================
if (target && typeof target === 'object' && typeof target.y === 'number' && typeof target.x === 'number' && target.hp > 0 && !target.isDead) {
    if (target.isSummon && target.owner === player) {
        player.isMoving = false;
    } 
    else if (typeof isInSafeZone === 'function' && isInSafeZone(currentMap, target.x, target.y)) {
        player.target = null;
    } else {
        let dist = Math.hypot(target.x - player.x, target.y - player.y);
        let isBow = Boolean(player.equip && player.equip.weapon && player.equip.weapon.isBow);
        let isWizard = player.charClass === 'wizard';
        let isRangedAttacker = isBow || isWizard;
        let atkRange = isRangedAttacker ? 280 : ((target.size || 20) + 55);
        let isManualMoving = performance.now() < (player.manualOverrideUntil || 0);

        // ⚔️ [기사 돌진 패시브]
        if ((player.charClass === 'knight' || player.charClass === 'royal') && !isManualMoving) {
            let rushDist = dist;
            if (rushDist >= 56 && rushDist <= 350 && (!player.lastRushTime || now - player.lastRushTime > 2000)) {
                player.lastRushTime = now;
                let rushAngle = Math.atan2(target.y - player.y, target.x - player.x);
                player.angle = rushAngle;
                player.x = target.x - Math.cos(rushAngle) * 30;
                player.y = target.y - Math.sin(rushAngle) * 30;

                if (typeof particles !== 'undefined') {
                    particles.push({ x: player.x, y: player.y, life: 0.4, maxLife: 0.4, type: 'haste_tornado', size: 40 });
                }
                if (typeof playSound === 'function') playSound('spell');
                triggerPassiveBroadcast('돌진', target.x, target.y, target.id, 'high');
            }
        }

        // 🏹 [원거리 카이팅 이동]
        if (!isManualMoving) {
            if (isRangedAttacker && dist < 150) {
                let fleeAngle = Math.atan2(player.y - target.y, player.x - target.x);
                player.moveX = Math.max(100, Math.min(mapSize - 100, player.x + Math.cos(fleeAngle) * 120));
                player.moveY = Math.max(100, Math.min(mapSize - 100, player.y + Math.sin(fleeAngle) * 120));
                player.isMoving = true;
            } else if (dist > atkRange - 10) {
                let charAngle = Math.atan2(target.y - player.y, target.x - player.x);
                player.moveX = target.x - Math.cos(charAngle) * (isRangedAttacker ? 210 : 40);
                player.moveY = target.y - Math.sin(charAngle) * (isRangedAttacker ? 210 : 40);
                player.isMoving = true;
            } else {
                player.isMoving = false;
                player.moveX = undefined;
                player.moveY = undefined;
            }
        }

        // 💥 [실제 타격 및 패시브 발동]
        let timeSinceLastAtk = timestamp - (player.lastAttack || 0);

        if (dist <= atkRange + 30 && timeSinceLastAtk > atkDelay) {
            player.lastAttack = timestamp;
            player.angle = Math.atan2(target.y - player.y, target.x - player.x);
            let baseAtk = player.atk;
// ⚔️ 기사 타격 (쇼크 스턴 자동 우선 시전 + 광폭화 클리브)
            if (player.charClass === 'knight' || player.charClass === 'royal') {
                let now = Date.now();
                let chosenKnightSpell = typeof getSmartAutoCombatSpell === 'function' ? getSmartAutoCombatSpell(target) : null;

                if (chosenKnightSpell && typeof castAttackSpell === 'function') {
                    castAttackSpell(target, chosenKnightSpell, player);
                } else {
                    let isFury = now < (player.furyUntil || 0);
                    let finalDamage = isFury ? Math.floor(baseAtk * 2.0) : baseAtk;

                    if (typeof playSound === 'function') playSound('swing');
                    damageEntity(target, finalDamage, player, 'physical');

                    if (isFury) {
                        let splashTargets = entities.filter(e => 
                            e && e.map === currentMap && !e.isPlayer && !e.isSummon && 
                            e.hp > 0 && !e.isDead && Math.hypot(e.x - target.x, e.y - target.y) <= 95
                        );
                        let totalCleaveDmg = 0;

                        splashTargets.forEach(st => {
                            if (st.id !== target.id) {
                                let sDmg = Math.floor(finalDamage * 0.6);
                                totalCleaveDmg += sDmg;
                                damageEntity(st, sDmg, player, 'physical');
                            }
                        });

                        let healAmount = Math.floor((finalDamage + totalCleaveDmg) * 0.25);
                        player.hp = Math.min(currentMaxHp, player.hp + healAmount);

                        if (typeof dmgTexts !== 'undefined' && healAmount > 0) {
                            dmgTexts.push({ 
                                x: player.x + (Math.random() * 16 - 8), 
                                y: player.y - 30, 
                                text: `+${healAmount} 흡혈`, 
                                life: 0.9, 
                                color: '#e879f9',
                                fontSize: 13
                            });
                        }

                        if (!player.furyCleavedThisCycle) {
                            player.furyCleavedThisCycle = true;
                            triggerPassiveBroadcast('광폭화 클리브', target.x, target.y, target.id, 'ultimate');
                        }
                    } else {
                        player.furyCleavedThisCycle = false;
                    }
                }
            }
          


 // 🏹 요정 타격 (평타 5타 적중 시 4초간 실프의 폭풍 발동)
            else if (player.charClass === 'elf') {
                let now = Date.now();
                let isCoolingDown = now < (player.elfFuryCooldownUntil || 0);
                
                // 💡 [핵심 추가] 평타 스택 누적 및 광폭화 텍스트 팝업 (기사와 동일한 20px)
                if (!(now < (player.elfFuryUntil || 0)) && !isCoolingDown) {
                    player.elfHitCount = (player.elfHitCount || 0) + 1;
                    if (player.elfHitCount >= 5) {
                        player.elfHitCount = 0;
                        player.elfFuryUntil = now + 4000;
                        player.elfFuryCooldownUntil = now + 6000;
                        player.elfFuryTextShown = false;
                        if (typeof dmgTexts !== 'undefined') {
                            dmgTexts.push({ x: player.x, y: player.y - 50, text: "🌪️ SYLPH TEMPEST! (실프의 폭풍)", life: 1.5, color: '#34d399', fontSize: 20 });
                        }
                    }
                }

                let isFury = now < (player.elfFuryUntil || 0);
                if (typeof playSound === 'function') playSound('bow');

                if (isFury) {
                    let splashTargets = entities.filter(e => 
                        e && e.map === currentMap && !e.isPlayer && !e.isSummon && 
                        e.hp > 0 && !e.isDead && Math.hypot(e.x - target.x, e.y - target.y) <= 200
                    );
                    
                    let furyAtk = Math.floor(baseAtk * 1.4);
                    let totalFuryDamage = 0;

                    splashTargets.forEach(st => {
                        damageEntity(st, furyAtk, player, 'physical', '실프의 폭풍');
                        totalFuryDamage += furyAtk;

                        if (!isBgTick && typeof particles !== 'undefined') {
                            particles.push({ 
                                x: player.x, y: player.y, speed: 28, life: 1.0, maxLife: 1.0, 
                                color: '#34d399', isProj: true, isArrow: true, homing: true, 
                                type: 'arrow', target: st, dmg: furyAtk, attacker: player, rollHit: true 
                            });
                        }
                    });

                    let hpHeal = Math.max(1, Math.floor(totalFuryDamage * 0.02));
                    let mpGain = Math.max(1, Math.floor(totalFuryDamage * 0.05));

                    player.hp = Math.min(currentMaxHp, player.hp + hpHeal);
                    player.mp = Math.min(currentMaxMp, player.mp + mpGain);

                    if (typeof dmgTexts !== 'undefined') {
                        dmgTexts.push({ 
                            x: player.x + (Math.random() * 16 - 8), 
                            y: player.y - 35, 
                            text: `+${hpHeal} HP / +${mpGain} MP`, 
                            life: 0.9, 
                            color: '#6ee7b7',
                            fontSize: 13
                        });
                    }

                    if (!player.elfFuryTextShown) {
                        player.elfFuryTextShown = true;
                        triggerPassiveBroadcast('실프의 폭풍', target.x, target.y, target.id, 'ultimate');
                    }
                } else {
                    player.elfFuryTextShown = false;
                    let isEcho = Math.random() < 0.25;
                    if (isEcho) {
                        let trueDmg = Math.floor(baseAtk * 1.3);
                        player.mp = Math.min(currentMaxMp, player.mp + 4);
                        damageEntity(target, trueDmg, player, 'magic', '에코 오브 실프');
                        triggerPassiveBroadcast('에코 오브 실프', target.x, target.y, target.id, 'normal');
                    } else {
                        if (!isBgTick && typeof particles !== 'undefined') {
                            particles.push({ 
                                x: player.x, y: player.y, speed: 24, life: 1.5, maxLife: 1.5, 
                                color: '#ffffff', isProj: true, isArrow: true, homing: true, 
                                type: 'arrow', target: target, dmg: baseAtk, attacker: player, rollHit: true 
                            });
                        }
                    }
                }
            }



            // 🔮 마법사 마법 공격
            else if (isWizard) {
                let chosenSpell = typeof getSmartAutoCombatSpell === 'function' ? getSmartAutoCombatSpell(target) : null;
                if (chosenSpell && typeof castAttackSpell === 'function') {
                    castAttackSpell(target, chosenSpell, player);
                } else if (player.mp >= 4 && typeof castAttackSpell === 'function') {
                    castAttackSpell(target, '에너지 볼트', player, true);
                }
            }
        }
    }
}


// ========================================================
    // 13. [자동사냥 & 타겟 탐색 - 파티 점사 완벽 동기화]
    // ========================================================
    if (player.autoHunt) {
        let amIFollower = window.currentPartyData && window.currentPartyData.party && window.socket && window.currentPartyData.party.leader !== window.socket.id;
        let isFocusMode = window.currentPartyData && window.currentPartyData.party && window.currentPartyData.party.mode === 'focus';
        let leaderSocketId = window.currentPartyData?.party?.leader;
        let leaderEnt = amIFollower ? entities.find(e => e.isPlayer && (e.id === leaderSocketId || e.socketId === leaderSocketId)) : null;
        let isManualSteering = performance.now() < (player.manualOverrideUntil || 0);

        if (!isManualSteering) {
            let skipSearch = false; // 💡 게임 멈춤(루프 종료) 방지용 플래그

            // [A] 아이템 루팅 (비전투 중 최우선)
            if (!player.target) {
                let closestItem = null;
                let minItemDist = Infinity;
                if (typeof items !== 'undefined' && Array.isArray(items)) {
                    items.forEach(it => {
                        if (it && (it.map === currentMap || !it.map)) {
                            let itemGrade = (typeof it.grade === 'number') ? it.grade : 0;
                            let isAlwaysLoot = ['scroll', 'book', 'potion', 'currency'].includes(it.type);
                            let minGrade = (typeof gameOptions !== 'undefined' && gameOptions.minLootGrade) || 0;
                            let isGradeOk = isAlwaysLoot || (itemGrade >= minGrade);
                            if (isGradeOk && !isInSafeZone(currentMap, it.x, it.y)) {
                                let d = Math.hypot(it.x - player.x, it.y - player.y);
                                if (d < minItemDist) { minItemDist = d; closestItem = it; }
                            }
                        }
                    });
                }

                if (closestItem && minItemDist < 300) {
                    player.targetItem = closestItem;
                    player.moveX = closestItem.x;
                    player.moveY = closestItem.y;
                    player.isMoving = true;
                    if (minItemDist <= 25) {
                        let itemIdx = items.indexOf(closestItem);
                        if (itemIdx > -1) {
                            items.splice(itemIdx, 1);
                            let existingIdx = player.inv.findIndex(p => typeof getStackKey === 'function' && getStackKey(p) === getStackKey(closestItem) && (!p.magicOptions || p.magicOptions.length === 0));
                            if (existingIdx > -1 && ['potion', 'scroll', 'book', 'etc', 'currency'].includes(closestItem.type || 'etc')) {
                                player.inv[existingIdx].count = (player.inv[existingIdx].count || 1) + (closestItem.count || 1);
                            } else {
                                player.inv.push(JSON.parse(JSON.stringify(closestItem)));
                            }
                            if (typeof playSound === 'function') playSound('click');
                            if (typeof addMessage === 'function') addMessage(`[루팅] ${closestItem.name} 획득!`, '#af5');
                            player.targetItem = null;
                            player.isMoving = false;
                            if (typeof updateUI === 'function') updateUI();
                        }
                    }
                    skipSearch = true; // 💡 return; 대신 플래그 활성화
                }
            }

       // [B] 🎯 파티 점사 모드 (생존/반격/카이팅 최우선 루틴)
            if (!skipSearch && amIFollower && isFocusMode) {
                // 💡 [루틴 1순위] 나를 치는 적이 있는지 가장 먼저 스캔합니다.
                let attackerMob = entities.find(e => 
                    e && !e.isPlayer && !e.isSummon && !e.isOtherMerc && e.map === currentMap && e.hp > 0 && !e.isDead &&
                    (e.targetId === player.socketId || e.target === player) &&
                    Math.hypot(e.x - player.x, e.y - player.y) <= 400
                );

                let leaderTargetMob = null;
                if (leaderEnt && leaderEnt.targetId) {
                    leaderTargetMob = entities.find(e => e && e.id === leaderEnt.targetId && e.hp > 0 && !e.isDead && e.map === currentMap);
                }

                // 나를 때리는 몹이 있고 그게 파티장의 타겟이 아니라면? -> 즉시 반격 타겟으로 잡음. (원거리면 기존 카이팅 로직으로 자연스럽게 뒷걸음질 침)
                if (attackerMob && attackerMob.id !== (leaderTargetMob ? leaderTargetMob.id : null)) {
                    if (!player.target || player.target.id !== attackerMob.id) {
                        player.target = attackerMob;
                        player.isMoving = false;
                        if (typeof addMessage === 'function') {
                            addMessage(`[생존 우선] 나를 공격하는 ${attackerMob.name} 먼저 반격/카이팅 합니다!`, '#f55');
                        }
                    }
                    skipSearch = true;
                }
                // 나를 때리는 적이 없으면 파티장이 점사하는 타겟 같이 때리기
                else if (leaderTargetMob) {
                    if (!player.target || player.target.id !== leaderTargetMob.id) {
                        player.target = leaderTargetMob;
                        player.isMoving = false;
                    }
                    skipSearch = true;
                } 
                // 타겟이 아예 없으면 파티장 뒤로 안전하게 이동
                else if (leaderEnt) {
                    if (player.target) player.target = null;
                    let distToLeader = Math.hypot(leaderEnt.x - player.x, leaderEnt.y - player.y);
                    if (distToLeader > 90) {
                        let angle = Math.atan2(leaderEnt.y - player.y, leaderEnt.x - player.x);
                        player.moveX = leaderEnt.x - Math.cos(angle) * 60;
                        player.moveY = leaderEnt.y - Math.sin(angle) * 60;
                        player.isMoving = true;
                    } else {
                        player.isMoving = false;
                        player.moveX = undefined;
                        player.moveY = undefined;
                    }
                    skipSearch = true;
                }
            }

            // [C] 일반 몬스터 탐색 (자유 사냥 모드 또는 파티장일 때)
            if (!skipSearch && !player.target) {
                let closestMob = null;
                let minMobDist = Infinity;
                let isIgnoredActive = performance.now() < (player.ignoredUntil || 0);

                entities.forEach(e => {
                    if (e && typeof e.y === 'number' && e.map === currentMap && !e.isSummon && !e.isPlayer && !e.isOtherMerc && e.hp > 0 && !e.isDead) {
                        if (typeof isInSafeZone === 'function' && isInSafeZone(currentMap, e.x, e.y)) return;
                        if (isIgnoredActive && e.id === player.ignoredTargetId) return;

                        let d = Math.hypot(e.x - player.x, e.y - player.y);
                        if (d < minMobDist) {
                            minMobDist = d;
                            closestMob = e;
                        }
                    }
                });

                if (closestMob) {
                    player.target = closestMob;
                    if (window.socket && currentUser) {
                        window.socket.emit('player_target', { targetId: closestMob.id });
                    }
                } else if (!player.isMoving || (player.moveX && Math.hypot(player.moveX - player.x, player.moveY - player.y) < 20)) {
                    let rx = player.x + (Math.random() * 800 - 400);
                    let ry = player.y + (Math.random() * 800 - 400);
                    if (!isInSafeZone(currentMap, rx, ry) && rx > 150 && rx < mapSize - 150 && ry > 150 && ry < mapSize - 150) {
                        player.moveX = rx; player.moveY = ry; player.isMoving = true;
                    }
                }
            }
        }
    }


    // 💡 14. [플레이어 실제 이동 적용] - 누락되었던 핵심 이동 연산 복구!
    if (player.moveX === undefined || player.moveY === undefined) {
        player.isMoving = false;
    } else {
        let dist = Math.hypot(player.moveX - player.x, player.moveY - player.y);
        let moveStep = pSpeed * (dt / 1000);
        
        if (dist <= Math.max(moveStep, 3)) {
            player.x = Math.round(player.moveX); 
            player.y = Math.round(player.moveY); 
            player.isMoving = false; 
            player.moveX = undefined; 
            player.moveY = undefined;
        } else {
            player.isMoving = true;
            player.angle = Math.atan2(player.moveY - player.y, player.moveX - player.x);
            player.x = Math.max(50, Math.min(mapSize - 50, player.x + Math.cos(player.angle) * moveStep));
            player.y = Math.max(50, Math.min(mapSize - 50, player.y + Math.sin(player.angle) * moveStep));
        }
    }

    // 맵 테두리 제한
    let margin = 30;
    player.x = Math.max(margin, Math.min(mapSize - margin, player.x));
    player.y = Math.max(margin, Math.min(mapSize - margin, player.y));

    // 15. 안티 스턱 (끼임 방지) 체크
    // 💡 [수정] 플레이어가 '이동 중(isMoving)'일 때만 끼임 판정이 작동하도록 조건 변경
    if (player.autoHunt && player.isMoving) {
        if (!player.stuckCheckTime) player.stuckCheckTime = performance.now();
        if (!player.lastX) { player.lastX = player.x; player.lastY = player.y; }

        if (performance.now() - player.stuckCheckTime > 2000) { // 체크 주기를 2초로 완화
            let movedDist = Math.hypot(player.x - player.lastX, player.y - player.lastY);
            if (movedDist < 5) { 
                // 💡 맵 가장자리(Margin) 안쪽으로 안전하게 텔레포트 및 탈출하도록 보정
                player.x = Math.max(200, Math.min(mapSize - 200, player.x + (Math.random() - 0.5) * 150));
                player.y = Math.max(200, Math.min(mapSize - 200, player.y + (Math.random() - 0.5) * 150));
                player.target = null; 
                player.manualOverrideUntil = performance.now() + 1000; // 강제 이동 딜레이 부여
                if (typeof addMessage === 'function') addMessage("지형 끼임 감지 -> 안전한 위치로 탈출합니다.", "#5f5");
            }
            player.lastX = player.x;
            player.lastY = player.y;
            player.stuckCheckTime = performance.now();
        }
    } else {
        player.stuckCheckTime = performance.now();
    }

 // ========================================================
// 16. 발밑 근접 아이템 습득 처리
// ========================================================
if (typeof items !== 'undefined' && Array.isArray(items)) {
    let nearbyItem = null;

    if (player.autoHunt) {
        nearbyItem = player.targetItem || items.find(it => {
            if (!it || (it.map && it.map !== currentMap)) return false;
            if (it.dropperId === (window.socket ? window.socket.id : 'me') && Date.now() - (it.droppedTime || 0) < 5000) return false;
            let itemGrade = (typeof it.grade === 'number') ? it.grade : 0;
            let isAlwaysLoot = ['scroll', 'book', 'potion', 'currency'].includes(it.type);
            let minGrade = (typeof gameOptions !== 'undefined' && gameOptions.minLootGrade) || 0;
            return (isAlwaysLoot || (itemGrade >= minGrade)) && Math.hypot(it.x - player.x, it.y - player.y) <= 35;
        });
    } else {
        nearbyItem = items.find(it => {
            if (!it || (it.map && it.map !== currentMap)) return false;
            if (it.dropperId === (window.socket ? window.socket.id : 'me') && Date.now() - (it.droppedTime || 0) < 5000) return false;
            return Math.hypot(it.x - player.x, it.y - player.y) <= 35;
        });
    }

    if (nearbyItem && Math.hypot(nearbyItem.x - player.x, nearbyItem.y - player.y) <= 35) {
        if (window.socket && currentUser) {
            if (!player.lastLootAttempt || Date.now() - player.lastLootAttempt > 300) {
                player.lastLootAttempt = Date.now();
                window.socket.emit('player_loot_item', { itemId: nearbyItem.id });
                player.targetItem = null;
            }
        }
    }
} 

    // 17. 사망 엔티티 제거 (보스/일반 몬스터 공통 1.5초 후 화면에서 삭제)
    for (let i = entities.length - 1; i >= 0; i--) {
        let e = entities[i];
        if (e && e.isDead && (timestamp - e.deadTime > 1500)) {
            entities.splice(i, 1);
        }
    }

if (document.visibilityState === 'visible') {
        try {
            if (typeof draw === 'function') draw(timestamp);
        } catch (renderErr) {
            console.error("[-] 렌더링 중 일시적 오류 발생 (루프 유지됨):", renderErr);
        }
        requestAnimationFrame(update);
    }
}


function updateMercenaryCombat(merc) {
    if (!merc || merc.hp <= 0) return;

    let nearbyEnemies = entities.filter(e => 
        e && e.map === currentMap && !e.isSummon && e.hp > 0 && !e.isDead && 
        Math.hypot(e.x - merc.x, e.y - merc.y) < 250
    );

    let chosenSpell = selectOptimalSpell(merc, nearbyEnemies.length);

    if (chosenSpell && nearbyEnemies.length > 0) {
        let target = nearbyEnemies[0];
        let mData = magicDb[chosenSpell];

        if (mData && merc.mp >= mData.mp && (Date.now() - (merc.lastSpellTime || 0) > 1200)) {
            merc.lastSpellTime = Date.now();
            merc.mp -= mData.mp;

            if (mData.heal) {
                merc.hp = Math.min(merc.maxHp, merc.hp + mData.heal);
                if (typeof playSound === 'function') playSound('heal');
            } else if (mData.dmg) {
                if (typeof damageEntity === 'function') {
                    damageEntity(target, mData.dmg + Math.floor(merc.level * 2), merc, 'magic');
                }
                if (typeof playSound === 'function') playSound('magic_hit');
            }
        }
    }
}

function getSafeEscapePosition(currentX, currentY, targetX, targetY) {
    let margin = 200;
    let safeX = targetX;
    let safeY = targetY;

    if (safeX < margin) safeX = margin + 150;
    if (safeX > mapSize - margin) safeX = mapSize - margin - 150;
    if (safeY < margin) safeY = margin + 150;
    if (safeY > mapSize - margin) safeY = mapSize - margin - 150;

    let mData = maps[currentMap];
    if (mData && mData.safeZones) {
        for (let sz of mData.safeZones) {
            let distToSafe = Math.hypot(safeX - sz.x, safeY - sz.y);
            if (distToSafe < sz.r + 150) {
                let escapeAngle = Math.atan2(safeY - sz.y, safeX - sz.x);
                safeX = sz.x + Math.cos(escapeAngle) * (sz.r + 200);
                safeY = sz.y + Math.sin(escapeAngle) * (sz.r + 200);
            }
        }
    }

    return { x: safeX, y: safeY };
}

const mercenarySkillTree = {
    wizard: [
        { level: 1, skill: "에너지 볼트" },
        { level: 10, skill: "파이어볼" },
        { level: 20, skill: "아이스 스파이크" },
        { level: 30, skill: "이럽션" },
        { level: 40, skill: "블리자드" }
    ],
    elf: [
        { level: 1, skill: "네이쳐스 터치" },
        { level: 10, skill: "스톰 샷" },
        { level: 20, skill: "트리플 애로우" }
    ],
    knight: [
        { level: 10, skill: "쇼크 스턴" },
        { level: 25, skill: "리덕션 아머" },
        { level: 40, skill: "카운터 바리어" }
    ]
};

function getSkillsForMercenary(mercType, level) {
    let unlockedSkills = [];
    let tree = mercenarySkillTree[mercType];
    if (tree) {
        tree.forEach(node => {
            if (level >= node.level) {
                unlockedSkills.push(node.skill);
            }
        });
    }
    return unlockedSkills;
}

function levelUpMercenary(merc) {
    merc.level++;
    let raceKey = merc.mercType || merc.race;
    merc.skills = getSkillsForMercenary(raceKey, merc.level);
    addMessage(`✨ [용병 성장] ${merc.name}이(가) Lv.${merc.level}로 레벨업했습니다!`, '#ff0');
}


function spawnFloorItem(itemTemplate, mob) {
    if (!items || !Array.isArray(items)) return;

    let newItem = JSON.parse(JSON.stringify(itemTemplate));
    newItem.id = 'item_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    newItem.map = mob.map || currentMap;
    
    newItem.x = Math.max(50, Math.min(mapSize - 50, mob.x + (Math.random() * 60 - 30)));
    newItem.y = Math.max(50, Math.min(mapSize - 50, mob.y + (Math.random() * 60 - 30)));

    items.push(newItem);
}


if (window.socket) {
    // 💡 [추가] 서버 재부팅 1분 전 경고 수신 시 강제 DB 저장
    window.socket.on('force_client_save', async () => {
        if (gameStarted && currentUser) {
            if (typeof addMessage === 'function') {
                addMessage("서버 점검에 대비하여 클라우드에 캐릭터 데이터를 긴급 저장합니다...", "#fd0");
            }
            if (typeof saveGameToLocal === 'function') saveGameToLocal(true);
            if (typeof autoSaveToSupabase === 'function') await autoSaveToSupabase(true);
        }
    });

    // 1. 타 플레이어 및 용병 타격 모션 동기화
    window.socket.on('sync_player_action', (data) => {
        let p = entities.find(e => e.id === data.socketId || e.socketId === data.socketId);
        if (!p || isBgTick) return;

        p.lastAttack = performance.now();
        p.angle = data.angle;

        let targetEnt = entities.find(e => e.id === data.targetId);
        let tx = data.targetX !== undefined ? data.targetX : (targetEnt ? targetEnt.x : p.x + Math.cos(p.angle) * 300);
        let ty = data.targetY !== undefined ? data.targetY : (targetEnt ? targetEnt.y : p.y + Math.sin(p.angle) * 300);
        let calcAngle = Math.atan2(ty - p.y, tx - p.x);

        if (data.isBow || (p.equip && p.equip.weapon && p.equip.weapon.isBow)) {
            let shootArrow = (delay = 0) => {
                setTimeout(() => {
                    if (typeof particles !== 'undefined') {
                        particles.push({
                            x: p.x, y: p.y, speed: 22, life: 1.5, maxLife: 1.5,
                            color: '#ffffff', isProj: true, isArrow: true, homing: true,
                            type: 'arrow', angle: calcAngle, target: targetEnt || { x: tx, y: ty }
                        });
                    }
                    if (typeof playSound === 'function') playSound('bow');
                }, delay);
            };

            shootArrow(0);
            if (data.actionType === 'double_shot') {
                shootArrow(110);
                if (typeof dmgTexts !== 'undefined') {
                    dmgTexts.push({ x: p.x, y: p.y - 40, text: "Double Shot!", life: 1.0, color: '#5f5' });
                }
            }
        } else {
            if (typeof playSound === 'function') playSound('swing');
            if (data.actionType === 'crit_slash') {
                if (typeof particles !== 'undefined') {
                    particles.push({ x: tx, y: ty, life: 0.4, maxLife: 0.4, type: 'explosion', size: 55, color: '#ff2200' });
                }
                if (typeof dmgTexts !== 'undefined') {
                    dmgTexts.push({ x: p.x, y: p.y - 45, text: "💥 CRITICAL!", life: 1.0, color: '#ff1100' });
                }
            }
        }
    });

   




// ========================================================
    // 💡 [통합] 40여 종 모든 마법 1:1 고유 이펙트 중앙 생성기
    // ========================================================
    window.spawnMagicParticle = function(cX, cY, mName, angle = 0, tX = cX, tY = cY) {
        if (typeof particles === 'undefined' || window.isBgTick) return;

        // 1. 공격 마법류 고유 이펙트
        if (mName === '파이어볼') {
            if (typeof createFireballExplosionEffect === 'function') createFireballExplosionEffect(tX, tY, 150);
        } else if (mName === '선버스트') {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'sunburst_explosion', size: 220 });
        } else if (mName === '이럽션') {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'eruption', size: 95 });
        } else if (mName === '아이스 스파이크') {
            particles.push({ x: tX, y: tY, life: 0.6, maxLife: 0.6, type: 'ice_spike', size: 100 });
        } else if (mName === '토네이도' || mName === '에어 블래스트') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'tornado', size: 240, color: '#e2e8f0' });
        } else if (mName === '포그 오브 슬리핑') {
            particles.push({ x: tX, y: tY, life: 1.2, maxLife: 1.2, type: 'tornado', size: 300, color: '#475569' });
        } else if (mName.includes('실프의 폭풍') || mName === '피어싱 애로우') {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'storm_blade_ring', size: 250 });
        } else if (mName.includes('광폭화') || mName === '광폭화 클리브') {
            particles.push({ x: tX, y: tY, life: 0.5, maxLife: 0.5, type: 'explosion', size: 150, color: '#ff2200' });
        } else if (mName === '에너지 볼트') {
            particles.push({ x: cX, y: cY - 15, speed: 16, life: 1.0, maxLife: 1.0, color: '#88aaff', isProj: true, type: 'energy_bolt', target: { x: tX, y: tY } });
        } else if (mName === '디스인티그레이트') {
            particles.push({ x: tX, y: tY, angle: angle, life: 0.8, maxLife: 0.8, type: 'disintegrate' });
        } else if (mName === '미티어 스트라이크') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'meteor', size: 350 });
        } else if (mName === '콜 라이트닝' || mName === '라이트닝 스톰') {
            particles.push({ x: tX, y: tY, life: 0.6, maxLife: 0.6, type: 'lightning', size: mName === '콜 라이트닝' ? 100 : 250 });
        } else if (mName === '블리자드' || mName === '헤일 스톰') {
            particles.push({ x: tX, y: tY, life: 1.2, maxLife: 1.2, type: 'blizzard', size: 300 });
        } else if (mName === '저지먼트') {
            particles.push({ x: tX, y: tY, life: 1.2, maxLife: 1.2, type: 'judgment', size: 400 });
        } else if (mName === '쇼크 스턴') {
            particles.push({ x: tX, y: tY, life: 0.9, maxLife: 0.9, type: 'stun_effect', size: 70 });
        } 
        // 2. 디버프 및 군중제어
        else if (['어스 바인드'].includes(mName)) {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'earth_bind' });
        } else if (['커스 파라다이스', '폴루트 워터', '커스 디지즈', '다크니스', '사일런스', '슬로우'].includes(mName)) {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'curse_poison' });
        } else if (['스트라이커 게일'].includes(mName)) {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'striker_gale' });
        } else if (['뱀파이어릭 터치', '데스 힐', '블러드 투 소울'].includes(mName)) {
            particles.push({ x: mName === '블러드 투 소울' ? cX : tX, y: mName === '블러드 투 소울' ? cY : tY, life: 0.8, maxLife: 0.8, type: 'drain' });
        } else if (['캔슬레이션'].includes(mName)) {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'cancellation' });
        } 
        // 3. 힐, 버프 및 오라
        else if (mName.includes('힐') || mName === '네이쳐스 터치') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'classic_heal', color: '#10b981' });
        } else if (mName === '워터 라이프' || mName === '아쿠아 프로텍트') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'water_shield' });
        } else if (mName === '솔리드 캐리지' || mName === '리덕션 아머' || mName === '실드' || mName === '어스 스킨') {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'iron_shield' });
        } else if (mName === '마제스티') {
            particles.push({ x: tX, y: tY, life: 0.8, maxLife: 0.8, type: 'majesty_shield' });
        } else if (mName === '앱솔루트 배리어' || mName === '카운터 바리어') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'absolute_barrier' });
        } else if (mName === '이뮨 투 함') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'immune_to_harm' });
        } else if (mName === '어드밴스 스피릿') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'advance_spirit' });
        } else if (mName === '매스 텔레포트') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'classic_shield', color: '#8b5cf6', size: 100 });
        } else if (mName.includes('홀리 워크')) {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'holy_aura' });
        } else if (mName.includes('파이어 웨폰') || mName.includes('소울 오브 프레임')) {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'fire_aura' });
        } else if (mName.includes('바운스 어택') || mName.includes('블로우 어택')) {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'weapon_buff' });
        } else if (mName.includes('가속') || mName.includes('윈드 워크') || mName.includes('스톰 샷') || mName === '돌진' || mName === '에코 오브 실프') {
            let colorMap = { '돌진': '#facc15', '에코 오브 실프': '#4ade80' };
            particles.push({ x: tX, y: tY, life: 1.2, maxLife: 1.2, type: 'haste_tornado', size: 55, color: colorMap[mName] || '#22ff55' });
        } else if (mName === '서먼 몬스터') {
            particles.push({ x: tX, y: tY, life: 1.0, maxLife: 1.0, type: 'summon_effect' });
        } else {
            particles.push({ x: tX, y: tY, life: 0.6, maxLife: 0.6, type: 'explosion', size: 90, color: '#c084fc' });
        }
    };

    

// 💡 [타인/용병 마법 및 오라 동기화 리스너]
    window.socket.on('sync_player_magic', (data) => {
        if (!gameStarted) return;
        let mName = data.magicName;
        if (!mName) return;

        let caster = entities.find(e => e.id === data.casterId || e.socketId === data.casterId || e.id === 'merc_' + data.casterId);
        let realCasterX = caster ? caster.x : (data.casterX !== undefined ? data.casterX : 2000);
        let realCasterY = caster ? caster.y : (data.casterY !== undefined ? data.casterY : 2000);
        
        let targetEnt = entities.find(e => e.id === data.targetId);
        let tx = targetEnt ? targetEnt.x : (data.targetX !== undefined ? data.targetX : realCasterX);
        let ty = targetEnt ? targetEnt.y : (data.targetY !== undefined ? data.targetY : realCasterY);
        let aimAngle = Math.atan2(ty - realCasterY, tx - realCasterX);

        if (caster) { 
            caster.lastAttack = performance.now(); 
            caster.angle = aimAngle; 

            // 💡 타 플레이어 및 용병의 광폭화 / 실프의 폭풍 오라 상태 실시간 동기화
            if (mName.includes('광폭화') || mName.includes('BERSERK')) {
                caster.furyUntil = Date.now() + 4000;
            } else if (mName.includes('실프의 폭풍') || mName.includes('SYLPH')) {
                caster.elfFuryUntil = Date.now() + 4000;
            }
        }

        // 스킬 텍스트 폰트/티어 설정
        let customTier = data.tier || 'normal';
        let customSize = data.fontSize || null;

        if (mName.includes('BERSERK FURY') || mName.includes('광폭화')) { customTier = 'ultimate'; customSize = 20; } 
        else if (mName.includes('SYLPH TEMPEST') || mName.includes('실프의 폭풍')) { customTier = 'elf'; customSize = 20; } 
        else if (mName === '돌진') { customTier = 'high'; customSize = 16; }

     if (typeof addSkillText === 'function') {
            let isKeyPassive = mName.includes('광폭화') || mName.includes('BERSERK') || 
                               mName.includes('실프') || mName.includes('SYLPH') || 
                               mName === '돌진';
            if (isKeyPassive) {
                addSkillText(realCasterX, realCasterY, mName.startsWith('[') || mName.startsWith('🔥') || mName.startsWith('🌪️') || mName.startsWith('⚡') ? mName : `[${mName}]`, customTier, customSize);
            }
        }

        // 💡 1번 중앙 파티클 생성기 즉시 호출
        if (typeof window.spawnMagicParticle === 'function') {
            window.spawnMagicParticle(realCasterX, realCasterY, mName, aimAngle, tx, ty);
        }
        
        // 사운드 매핑
        if (typeof playSound === 'function') {
            if (mName.includes('파이어') || mName === '선버스트' || mName === '이럽션') playSound('fireball');
            else if (mName.includes('라이트닝') || mName === '쇼크 스턴') playSound('lightning');
            else if (mName.includes('블리자드') || mName.includes('아이스') || mName === '헤일 스톰') playSound('blizzard');
            else if (mName === '디스인티그레이트') playSound('disintegrate');
            else if (mName.includes('힐') || mName === '네이쳐스 터치') playSound('heal');
            else if (mName.includes('애로우') || mName.includes('실프의 폭풍')) playSound('bow');
            else if (mName.includes('클리브') || mName.includes('광폭화')) playSound('swing');
            else if (mName === '에너지 볼트') playSound('energy_bolt');
            else playSound('spell');
        }
    });




    // 3. 타 유저 물약 이펙트
    window.socket.on('sync_player_potion', (data) => {
        let p = entities.find(e => e.isPlayer && (e.id === data.socketId || e.socketId === data.socketId));
        if (p) {
            let pInfo = typeof getPotionColorInfo === 'function' ? getPotionColorInfo(data.potionName) : { c: '#f80' };
            if (typeof particles !== 'undefined') {
                for (let i = 0; i < 10; i++) {
                    particles.push({
                        x: p.x, y: p.y, life: 0.8, maxLife: 0.8, 
                        type: 'classic_potion', color: pInfo.c, radius: Math.random() * 15 + 8, angle: Math.random() * Math.PI * 2
                    });
                }
            }
            if (typeof playSound === 'function') playSound('drink');
        }
    });

    window.socket.on('system_message', (data) => {
        if (typeof addMessage === 'function') addMessage(data.message, data.color || '#fd0');
    });

    window.socket.on('sync_map_state', (data) => {
        entities = entities.filter(e => e.isSummon);
        data.monsters.forEach(m => { entities.push({ ...m, map: currentMap, size: 20 }); });
        items = data.items.filter(it => it.map === currentMap);
        if (typeof updateUI === 'function') updateUI();
    });

    window.socket.on('sync_entities', (data) => {
    if (!gameStarted || !currentUser) return;

    // 1. 플레이어 동기화
    data.players.forEach(sp => {
        if (window.socket && sp.socketId === window.socket.id) return;
        
        let existingPlayer = entities.find(e => e.isPlayer && (e.id === sp.socketId || e.socketId === sp.socketId));
        if (existingPlayer) {
            existingPlayer.moveX = sp.x; 
            existingPlayer.moveY = sp.y;
            existingPlayer.hp = sp.hp;
            existingPlayer.maxHp = sp.maxHp;
            existingPlayer.targetId = sp.targetId;
            existingPlayer.partyId = sp.partyId;
            existingPlayer.charClass = sp.charClass || 'knight';
            existingPlayer.equip = sp.equip || existingPlayer.equip;
            existingPlayer.name = sp.name || existingPlayer.name;
        } else {
            entities.push({
                id: sp.socketId, socketId: sp.socketId, isPlayer: true, name: sp.name, charClass: sp.charClass || 'knight',
                x: sp.x, y: sp.y, moveX: sp.x, moveY: sp.y,
                hp: sp.hp, maxHp: sp.maxHp, size: 20, map: currentMap,
                equip: sp.equip || { weapon: null, armor: null }, partyId: sp.partyId, targetId: sp.targetId, angle: 0
            });
        }
    });
    
    // 서버 목록에 없는 타 플레이어 안전 제거
    const serverPlayerIds = data.players.map(p => p.socketId);
    for (let i = entities.length - 1; i >= 0; i--) { 
        if (entities[i].isPlayer && !serverPlayerIds.includes(entities[i].id) && !serverPlayerIds.includes(entities[i].socketId)) {
            if (player.target && player.target.id === entities[i].id) {
                player.target = null;
            }
            entities.splice(i, 1); 
        }
    }

    // 2. 용병 및 소환수 동기화 (기존 로직 유지)
    const serverMercIds = data.mercs ? data.mercs.map(m => m.id) : [];
    if (data.mercs) {
        data.mercs.forEach(sm => {
            if (window.socket && sm.ownerId === window.socket.id) return;
            let existingMerc = entities.find(e => e.isOtherMerc && e.id === sm.id);
            if (existingMerc) {
                existingMerc.moveX = sm.x;
                existingMerc.moveY = sm.y;
                existingMerc.hp = sm.hp;
                existingMerc.maxHp = sm.maxHp;
                existingMerc.angle = sm.angle;
                existingMerc.isMoving = sm.isMoving;
                existingMerc.equip = sm.equip || existingMerc.equip;
                existingMerc.mercType = sm.mercType || existingMerc.mercType || 'knight';
                existingMerc.charClass = sm.charClass || sm.mercType || existingMerc.charClass || 'knight';
                existingMerc.name = sm.name || existingMerc.name;
                existingMerc.ownerName = sm.ownerName || existingMerc.ownerName;
            } else {
                entities.push({
                    ...sm,
                    isOtherMerc: true,
                    isSummon: true,
                    size: 20,
                    map: currentMap,
                    moveX: sm.x,
                    moveY: sm.y,
                    charClass: sm.charClass || sm.mercType || 'knight',
                    mercType: sm.mercType || 'knight',
                    equip: sm.equip || { weapon: null, armor: null, helmet: null, cloak: null }
                });
            }
        });
    }
    for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].isOtherMerc && !serverMercIds.includes(entities[i].id)) entities.splice(i, 1);
    }

    // 3. 몬스터 동기화 (기존 로직 유지)
    const serverMobIds = data.monsters.map(sm => sm.id);
    data.monsters.forEach(sm => {
        let existingMob = entities.find(e => !e.isSummon && !e.isPlayer && e.id === sm.id);
        if (existingMob) {
            let distMoved = Math.hypot(existingMob.moveX - sm.x, existingMob.moveY - sm.y);
            if (distMoved > 1) {
                existingMob.isMoving = true;
                existingMob.lastMoveAnimTime = performance.now();
            }

            existingMob.moveX = sm.x; 
            existingMob.moveY = sm.y;
            existingMob.hp = sm.hp;
            existingMob.maxHp = sm.maxHp || existingMob.maxHp;
            existingMob.name = sm.name || existingMob.name;
            existingMob.map = currentMap; 
            existingMob.color = existingMob.color || sm.color || '#ff3333'; 
        } else {
            entities.push({ 
                id: sm.id, 
                name: sm.name || '몬스터', 
                x: sm.x, 
                y: sm.y, 
                moveX: sm.x, 
                moveY: sm.y, 
                hp: sm.hp || 100, 
                maxHp: sm.maxHp || 100, 
                isBoss: sm.isBoss || false, 
                color: sm.color || '#ff3333', 
                angle: sm.angle || 0, 
                size: sm.size || (sm.isBoss ? 35 : 20), 
                map: currentMap,
                isMoving: false 
            });
        }
    });
    
    for (let i = entities.length - 1; i >= 0; i--) { 
        if (entities[i] && !entities[i].isSummon && !entities[i].isPlayer && !serverMobIds.includes(entities[i].id)) {
            entities.splice(i, 1); 
        }
    }
});

window.socket.on('monster_hit', (data) => {
        let mob = entities.find(e => e.id === data.monsterId);
        if (mob && gameOptions.showDamage && typeof dmgTexts !== 'undefined') {
            dmgTexts.push({ 
                x: mob.x + (Math.random() * 20 - 10), 
                y: mob.y - 25, 
                text: data.damage, 
                life: 1.0, 
                color: data.hitType === 'magic' ? '#38bdf8' : '#ffffff' 
            });
            
            // 타 유저 공격 적중 시에도 스파크 발생
            if (typeof particles !== 'undefined') {
                particles.push({ x: mob.x, y: mob.y, life: 0.25, maxLife: 0.25, type: 'hit_spark' });
            }
            if (typeof playSound === 'function') playSound(data.hitType === 'magic' ? 'magic_hit' : 'monster_hit', mob);
        }
    });
    window.socket.on('player_hp_sync', (data) => {
        player.hp = data.hp;
        if (data.type === 'drain' && typeof dmgTexts !== 'undefined') {
            dmgTexts.push({ 
                x: player.x, 
                y: player.y - 35, 
                text: `+${data.healAmount} HP 흡혈!`, 
                life: 1.2, 
                color: '#ff00ff' 
            });
        }
        if (typeof updateUI === 'function') updateUI();
    });

    window.socket.on('take_damage', (data) => {
        if (data.isDodge) {
            dmgTexts.push({ x: player.x, y: player.y - 40, text: "DODGE! (장판 회피)", life: 1.2, color: '#5cf' });
            return;
        }

        let rawDamage = data.damage || 10;
        if (data.targetId && data.targetId !== (window.socket ? window.socket.id : '') && data.targetId !== player.id) {
            let merc = entities.find(e => e.id === data.targetId && e.owner === player);
            if (merc) {
                merc.hp = Math.max(0, (data.hpRemaining !== undefined ? data.hpRemaining : merc.hp - rawDamage));
                merc.hitTime = performance.now();
                if (gameOptions.showDamage && typeof dmgTexts !== 'undefined') {
                    dmgTexts.push({ x: merc.x, y: merc.y - 30, text: rawDamage, life: 1.2, color: '#f55' });
                }
                return;
            }
        }

        player.hp = Math.max(0, (data.hpRemaining !== undefined ? data.hpRemaining : player.hp - rawDamage));
        player.hitTime = performance.now();

        if (player.charClass === 'knight' && !player.isDead) {
            let now = Date.now();

            let isCoolingDown = now < (player.furyCooldownUntil || 0);
            let isAlreadyFury = now < (player.furyUntil || 0);

            if (!isAlreadyFury && !isCoolingDown) {
                player.recentHitDetails = player.recentHitDetails || [];
                let attackerId = data.attackerMonsterId || ('unknown_' + Math.random());
                player.recentHitDetails.push({ time: now, id: attackerId });
                player.recentHitDetails = player.recentHitDetails.filter(h => now - h.time <= 2000);

                let pMaxHp = window.currentMaxHp || player.maxHp || 1000;
                let isBigHit = rawDamage >= (pMaxHp * 0.25);

                let uniqueAttackers = new Set(player.recentHitDetails.map(h => h.id));
                let isCrowded = (player.recentHitDetails.length >= 4) && (uniqueAttackers.size >= 3);

                if (isBigHit || isCrowded) {
                    player.recentHitDetails = [];
                    player.furyUntil = now + 4000;
                    player.furyCooldownUntil = now + 6000;
                    player.furyCleavedThisCycle = false;

                    triggerPassiveBroadcast("🔥 BERSERK FURY! (광폭화)", player.x, player.y, null, 'ultimate', player, 20);
                    if (typeof playSound === 'function') playSound('spell');
                }
            }
        }

        if (gameOptions.showDamage && typeof dmgTexts !== 'undefined') {
            dmgTexts.push({ x: player.x, y: player.y - 20, text: rawDamage, life: 1.2, color: '#f55' });
            if (typeof playSound === 'function') playSound('player_hit');
        }

        if (player.hp <= 0) {
            handlePlayerDeath();
        }

        if (!player.target && !player.isDead) {
            let attackers = entities.filter(e => e && e.map === currentMap && !e.isPlayer && !e.isSummon && !e.isOtherMerc && e.hp > 0 && !e.isDead);
            if (attackers.length > 0) {
                attackers.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
                let closest = attackers[0];
                if (Math.hypot(closest.x - player.x, closest.y - player.y) < 300) {
                    player.target = closest;
                    player.isMoving = false;
                    player.manualOverrideUntil = 0;
                    if (typeof addMessage === 'function') addMessage(`[반격] ${closest.name}에게 반격합니다!`, '#f55');
                    if (window.socket && currentUser) {
                        window.socket.emit('player_target', { targetId: closest.id });
                    }
                }
            }
        }
        if (typeof updateUI === 'function') updateUI();
    });

  window.socket.on('monster_attack_action', (data) => {
        // 💡 [추가] 로그아웃 상태면 몬스터 공격 사운드 및 이펙트 처리 차단
        if (!gameStarted) return;

        let mob = entities.find(e => e.id === data.monsterId);
        if (!mob) return;

        mob.lastAttack = performance.now(); 
        let targetX = (typeof data.targetX === 'number') ? data.targetX : mob.x;
        let targetY = (typeof data.targetY === 'number') ? data.targetY : mob.y;
        mob.angle = Math.atan2(targetY - mob.y, targetX - mob.x); 

        if (data.hitType === 'magic' && data.magicName) {
            let mName = data.magicName;
            const SPELL_RULES = {
                '미티어 스트라이크': { ultimate: true,  radius: 130, delay: 1.4, sound: 'fireball' },
                '디스인티그레이트': { ultimate: true,  radius: 120, delay: 1.3, sound: 'disintegrate' },
                '저지먼트':         { ultimate: true,  radius: 135, delay: 1.4, sound: 'spell' },
                '블리자드':         { ultimate: true,  radius: 125, delay: 1.3, sound: 'blizzard' },
                '라이트닝 스톰':     { ultimate: false, radius: 110, delay: 1.1, sound: 'lightning' },
                '선버스트':         { ultimate: false, radius: 105, delay: 1.0, sound: 'fireball' },
                '이럽션':           { ultimate: false, radius: 100, delay: 1.0, sound: 'fireball' },
                '토네이도':         { ultimate: false, radius: 110, delay: 1.1, sound: 'spell' },
                '파이어볼':         { ultimate: false, radius: 90,  delay: 0.9, sound: 'fireball' },
                '콜 라이트닝':       { ultimate: false, radius: 85,  delay: 0.8, sound: 'lightning' },
                '에너지 볼트':       { ultimate: false, radius: 50,  delay: 0.6, sound: 'energy_bolt' }
            };

            let rule = SPELL_RULES[mName] || { ultimate: false, radius: data.radius || 80, delay: data.delay || 0.8, sound: 'spell' };

            if (typeof particles !== 'undefined') {
                particles.push({
                    x: mob.x, y: mob.y, life: rule.delay, maxLife: rule.delay,
                    type: 'magic_circle', size: mob.isBoss ? 115 : 80, isMonster: true
                });
                particles.push({
                    x: targetX, y: targetY, life: rule.delay, maxLife: rule.delay,
                    type: 'magic_telegraph', size: rule.radius
                });
            }

            if (rule.ultimate && mob.isBoss) {
                if (typeof addMessage === 'function') {
                    addMessage(`⚠️ [경고] ${mob.name}이(가) 광폭화 마법(${mName})을 시전합니다!`, '#f55');
                }
                if (typeof playSound === 'function') playSound('spell');
            }

            const castX = targetX;
            const castY = targetY;
            const spellName = mName;
            const currentMobAngle = mob.angle;
            const currentMobX = mob.x;
            const currentMobY = mob.y;
            const currentRadius = rule.radius;
            const currentSound = rule.sound;

            setTimeout(() => {
                if (!gameStarted || typeof particles === 'undefined') return;

                if (spellName === '미티어 스트라이크') {
                    particles.push({ x: castX, y: castY, life: 1.0, maxLife: 1.0, type: 'meteor', size: currentRadius * 2.5 });
                } else if (spellName === '디스인티그레이트') {
                    particles.push({ x: castX, y: castY, angle: currentMobAngle, life: 0.8, maxLife: 0.8, type: 'disintegrate' });
                } else if (spellName === '저지먼트') {
                    particles.push({ x: castX, y: castY, life: 1.2, maxLife: 1.2, type: 'judgment', size: currentRadius * 2 });
                } else if (spellName === '블리자드' || spellName === '헤일 스톰') {
                    particles.push({ x: castX, y: castY, life: 1.2, maxLife: 1.2, type: 'blizzard', size: currentRadius * 2 });
                } else if (spellName === '선버스트') {
                    particles.push({ x: castX, y: castY, life: 0.8, maxLife: 0.8, type: 'explosion', size: 180, color: '#ffffaa' });
                } else if (spellName === '이럽션') {
                    particles.push({ x: castX, y: castY, life: 0.8, maxLife: 0.8, type: 'eruption', size: currentRadius });
                } else if (spellName === '토네이도') {
                    particles.push({ x: castX, y: castY, life: 1.0, maxLife: 1.0, type: 'tornado', size: currentRadius * 2 });
                } else if (spellName === '파이어볼') {
                    if (typeof createFireballExplosionEffect === 'function') {
                        createFireballExplosionEffect(castX, castY, currentRadius);
                    } else {
                        particles.push({ x: castX, y: castY, life: 0.8, maxLife: 0.8, type: 'explosion', size: currentRadius * 1.5, color: '#ff4400' });
                    }
                } else if (spellName === '콜 라이트닝' || spellName === '라이트닝 스톰') {
                    particles.push({ x: castX, y: castY, life: 0.6, maxLife: 0.6, type: 'lightning', size: currentRadius });
                } else if (spellName === '에너지 볼트') {
                    particles.push({ x: currentMobX, y: currentMobY - 15, speed: 16, life: 1.0, maxLife: 1.0, color: '#88aaff', isProj: true, type: 'energy_bolt', target: { x: castX, y: castY } });
                } else {
                    particles.push({ x: castX, y: castY, life: 0.8, maxLife: 0.8, type: 'explosion', size: currentRadius });
                }
                
                if (typeof playSound === 'function' && currentSound) playSound(currentSound);
            }, rule.delay * 1000);
        } else {
            if (typeof playSound === 'function') playSound('swing');
        }
    });

    window.socket.on('player_attack_action', (data) => {
        let p = entities.find(e => e.id === data.socketId);
        if (p) {
            p.lastAttack = performance.now();
            p.angle = data.angle;
        }
    });

    window.socket.on('monster_dead', (data) => {
    let mobIndex = entities.findIndex(e => e.id === data.monsterId);
    if (mobIndex > -1) { 
        let mob = entities[mobIndex];
        mob.isDead = true; 
        mob.deadTime = performance.now(); 
        if (typeof playSound === 'function') playSound('monster_dead', mob);
    }
});

    window.socket.on('player_exp_gain', (data) => {
        let activeMercs = entities.filter(ent => ent && ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0 && !ent.isDead);
        player.exp += data.exp;

        if (typeof checkLevelUp === 'function') {
            checkLevelUp();
        }

        if (activeMercs.length > 0) {
            activeMercs.forEach(merc => {
                if (merc.level < player.level) {
                    merc.level = player.level;
                }
                merc.maxExp = player.maxExp;
                merc.exp = (merc.exp || 0) + data.exp;

                while (merc.exp >= merc.maxExp) {
                    merc.exp -= merc.maxExp;
                    merc.level = (merc.level || 1) + 1;
                    merc.maxExp = player.maxExp;
                    merc.maxHp += 30;
                    merc.maxMp += 10;
                    merc.hp = merc.maxHp;
                    merc.mp = merc.maxMp;
                    merc.atk += 3;
                    
                    let raceKey = merc.mercType || merc.race || 'knight';
                    if (typeof getSkillsForMercenary === 'function') {
                        merc.skills = getSkillsForMercenary(raceKey, merc.level);
                    }
                    if (typeof addMessage === 'function') addMessage(`✨ [용병 성장] ${merc.name}이(가) Lv.${merc.level}로 레벨업했습니다!`, '#ff0');
                    if (typeof dmgTexts !== 'undefined') dmgTexts.push({x: merc.x, y: merc.y - 30, text: `Lv.UP!`, life: 1.5, color: '#ff0'});
                }
            });
        }

        player.alignment = Math.min(32767, player.alignment + Math.floor(data.exp / 2));
        if (typeof updateUI === 'function') updateUI();
        if (typeof window.updatePetUI === 'function' && currentSelectedPet) window.updatePetUI();
    });

    window.socket.on('item_spawned', (data) => { if (typeof items !== 'undefined') items.push(data.item); });

    window.socket.on('item_removed', (data) => {
        let itemIdx = items.findIndex(it => it.id === data.itemId);
        if (itemIdx > -1) items.splice(itemIdx, 1);
    });

    window.socket.on('item_looted_success', (data) => {
    let loot = data.item;
    if (loot.type === 'currency' && loot.name === '아데나') {
        player.adena += loot.count;
        if (typeof addMessage === 'function') addMessage(`${loot.count} 아데나 획득`, '#fd0');
        if (typeof dmgTexts !== 'undefined') dmgTexts.push({ x: player.x, y: player.y - 40, text: `+${loot.count} 💰`, life: 1.5, color: '#fd0' });
        // 💡 아데나 획득음 제거 완료
    } else {
        let existingIdx = player.inv.findIndex(p => getStackKey(p) === getStackKey(loot) && (!p.magicOptions || p.magicOptions.length === 0));
        if (existingIdx > -1 && ['potion', 'scroll', 'book', 'etc'].includes(loot.type)) {
            player.inv[existingIdx].count = (player.inv[existingIdx].count || 1) + (loot.count || 1);
        } else { player.inv.push(JSON.parse(JSON.stringify(loot))); }
        if (typeof addMessage === 'function') addMessage(`[루팅] ${loot.name} 획득!`, '#af5');
        if (typeof playSound === 'function') playSound('click');
    }
    if (typeof updateUI === 'function') updateUI();
});

    window.socket.on('chat_broadcast', (data) => {
    let msgType = data.chatType || 'normal';
    if (typeof addMessage === 'function') addMessage(`[전체] ${data.name}: ${data.message}`, '#ffffff', msgType);
        let targetEnt = null;
        if (data.senderId === currentUser?.id) { targetEnt = player; } 
        else { targetEnt = entities.find(e => e.isPlayer && e.id === data.socketId); }
        if (targetEnt) { targetEnt.bubbleText = data.message; targetEnt.bubbleTimer = Date.now() + 5000; }
    });

    window.socket.on('party_invite_received', (data) => {
        showConfirm(`${data.inviterName}님께서 파티 초대를 보냈습니다.\n수락하시겠습니까?`, () => {
            window.socket.emit('party_accept', { inviterSocketId: data.inviterSocketId });
        });
    });

// 💡 [클릭과 드래그 구분용 전역 변수]
   window.currentPartyData = null;

    window.currentPartyData = null;

    window.renderPartyHUD = function() {
        let data = window.currentPartyData;
        let hudList = document.getElementById('party-hud-list');
        if (!hudList || !data || !data.party) {
            if (hudList) hudList.innerHTML = '';
            return;
        }

        // 파티 HUD 컨테이너 기본 스타일
        hudList.style.position = 'fixed';
        hudList.style.top = hudList.style.top || '70px';
        hudList.style.left = hudList.style.left || '10px';
        hudList.style.zIndex = '99999';
        hudList.style.cursor = 'move';
        hudList.style.pointerEvents = 'auto';

        // 💡 [클릭과 드래그 완벽 분리 드래그 로직]
        if (!hudList.dataset.dragInitialized) {
            hudList.dataset.dragInitialized = 'true';
            let isDragging = false, startX, startY, initialLeft, initialTop, moved = false;

            const onDown = (e) => {
                isDragging = true;
                moved = false;
                startX = e.clientX || (e.touches && e.touches[0].clientX);
                startY = e.clientY || (e.touches && e.touches[0].clientY);
                initialLeft = hudList.offsetLeft;
                initialTop = hudList.offsetTop;
            };

            const onMove = (e) => {
                if (!isDragging) return;
                let clientX = e.clientX || (e.touches && e.touches[0].clientX);
                let clientY = e.clientY || (e.touches && e.touches[0].clientY);
                let dx = clientX - startX;
                let dy = clientY - startY;

                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                    moved = true; // 조금이라도 움직이면 드래그로 판정
                }

                hudList.style.left = (initialLeft + dx) + 'px';
                hudList.style.top = (initialTop + dy) + 'px';
            };

            const onUp = () => {
                if (isDragging && moved) {
                    window._blockClickDueToDrag = true;
                    setTimeout(() => { window._blockClickDueToDrag = false; }, 100);
                }
                isDragging = false;
            };

            hudList.addEventListener('mousedown', onDown);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            hudList.addEventListener('touchstart', onDown, {passive: true});
            window.addEventListener('touchmove', onMove, {passive: true});
            window.addEventListener('touchend', onUp);
        }

     let isMobile = window.innerWidth <= 768;
    let html = '';

    if (isMobile) {
        html = `
        <div style="background:rgba(15, 15, 22, 0.9); border:1px solid #445; border-radius:4px; padding:3px; display:flex; flex-direction:column; gap:3px; width:95px; box-shadow:0 2px 5px rgba(0,0,0,0.5);">
            <div style="font-size:6.5px; color:#aaa; text-align:center; border-bottom:1px solid #333; padding-bottom:1px; margin-bottom:1px; user-select:none;">👑 파티 (우클릭 메뉴)</div>
            <div style="display:flex; flex-direction:column; gap:2px;">`;

        data.party.members.forEach(member => {
            let hpPct = Math.max(0, Math.min(100, (member.hp / member.maxHp) * 100));
            let isLeader = data.party.leader === member.socketId;
            let icon = member.charClass === 'elf' ? '🏹' : (member.charClass === 'wizard' ? '🔮' : '🛡️');
            
            html += `
            <div oncontextmenu="event.preventDefault(); if(!window._isPartyMoved) window.handlePartyHudClick('${member.socketId}', '${member.name}'); return false;"
                 style="cursor:pointer; background:rgba(20, 20, 30, 0.85); border:1px solid ${isLeader ? '#fd0' : '#334155'}; border-radius:2px; padding:2px 4px; width:100%; box-sizing:border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:7.5px; font-weight:bold; color:${isLeader ? '#fd0' : '#5cf'}; line-height:1.1; margin-bottom:1px;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:62px;">
                        ${isLeader ? '👑' : icon} ${member.name}
                    </span>
                    <span style="font-size:6px; color:#aaa;">${Math.floor(hpPct)}%</span>
                </div>
                <div style="width:100%; height:3px; background:#111; border-radius:1px; overflow:hidden; border:0.5px solid #222;">
                    <div style="width: ${hpPct}%; height: 100%; background: #ef4444;"></div>
                </div>
            </div>`;
        });

        html += `</div></div>`;
    } else {
        let isFocus = data.party.mode === 'focus';
        let modeBadgeText = isFocus ? '🎯점사' : '⚔️자유';
        let modeBadgeBg = isFocus ? '#991b1b' : '#1e3a8a';
        let modeBadgeBorder = isFocus ? '#dc2626' : '#2563eb';

        html = `
        <div style="background:rgba(15, 15, 22, 0.9); border:1px solid #556; border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:4px; width:140px; box-shadow:0 4px 10px rgba(0,0,0,0.6);">
            <div style="font-size:10px; color:#fd0; text-align:center; border-bottom:1px solid #444; padding-bottom:3px; margin-bottom:2px; user-select:none; font-weight:bold;">👑 파티원 (우클릭 메뉴)</div>
            <div style="display:flex; flex-direction:column; gap:4px;">`;

        data.party.members.forEach(member => {
            let hpPct = Math.max(0, Math.min(100, (member.hp / member.maxHp) * 100));
            let isLeader = data.party.leader === member.socketId;
            let icon = member.charClass === 'elf' ? '🏹' : (member.charClass === 'wizard' ? '🔮' : '🛡️');
            
            html += `
            <div oncontextmenu="event.preventDefault(); if(!window._isPartyMoved) window.handlePartyHudClick('${member.socketId}', '${member.name}'); return false;"
                 style="cursor:pointer; background:rgba(20, 20, 32, 0.9); border:1px solid ${isLeader ? '#fd0' : '#475569'}; border-radius:4px; padding:4px 6px; width:100%; box-sizing:border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:bold; color:${isLeader ? '#fd0' : '#5cf'}; line-height:1.2; margin-bottom:2px;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px;">
                        ${isLeader ? '👑' : icon} ${member.name}
                    </span>
                    <span style="font-size:8.5px; color:#fff; background:${modeBadgeBg}; border:1px solid ${modeBadgeBorder}; padding:0 3px; border-radius:2px;">
                        ${modeBadgeText}
                    </span>
                </div>
                <div style="width:100%; height:5px; background:#111; border-radius:2px; overflow:hidden; border:0.5px solid #333;">
                    <div style="width: ${hpPct}%; height: 100%; background: #ef4444;"></div>
                </div>
            </div>`;
        });

        html += `</div></div>`;
    }
    
    hudList.innerHTML = html;
    };

    // 소켓 수신 시 렌더링
    if (window.socket) {
        window.socket.off('party_update');
        window.socket.on('party_update', (data) => {
            window.currentPartyData = data;
            window.renderPartyHUD();
        });
    }

// 💡 [화면 사이즈 자동 보정]: 브라우저 창 크기가 바뀌거나 모바일 회전 시 파티 HUD가 화면 밖으로 숨는 현상 방지
        if (!window._partyResizeListenerAdded) {
            window._partyResizeListenerAdded = true;
            window.addEventListener('resize', () => {
                let el = document.getElementById('party-hud-list');
                if (!el || !el.innerHTML.trim()) return;
                
                let rect = el.getBoundingClientRect();
                let maxW = window.innerWidth - rect.width - 10;
                let maxH = window.innerHeight - rect.height - 10;
                
                let currentLeft = parseInt(el.style.left) || 10;
                let currentTop = parseInt(el.style.top) || 70;
                
                // 화면 밖으로 벗어났다면 안쪽으로 강제로 끌어오기
                if (currentLeft > maxW || currentLeft < 5) {
                    el.style.left = Math.max(5, Math.min(maxW, currentLeft)) + 'px';
                }
                if (currentTop > maxH || currentTop < 5) {
                    el.style.top = Math.max(5, Math.min(maxH, currentTop)) + 'px';
                }
            });
        }


    window.socket.on('party_target_shared', (data) => {
        // 💡 파티장이 타겟을 해제한 경우(null)
        if (!data || !data.targetId) {
            if (player.target) {
                player.target = null;
                player.isMoving = false;
            }
            return;
        }

        // 💡 파티장이 새로운 몬스터를 타겟한 경우
        let targetMob = entities.find(e => e && e.id === data.targetId && e.hp > 0 && !e.isDead && e.map === currentMap);
        if (targetMob) {
            if (!player.target || player.target.id !== targetMob.id) {
                player.target = targetMob; 
                player.isMoving = false;
                if (typeof addMessage === 'function') {
                    addMessage(`[파티 점사] 파티장의 타겟(${targetMob.name})을 집중 공격합니다!`, '#f55');
                }
            }
        }
    });
 }

window.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    return false;
}, { passive: false });

// ==========================================
// 🧠 [궁극의 고지능 용병 AI 시스템] (원형 카이팅, 마나 관리, 스마트 마법)
// ==========================================
window.updateMercenaryAI = function() {
    if (!gameStarted || !player) return;
    const now = performance.now();
    
    if (!window._lastMercAiTime) window._lastMercAiTime = now;
    const dt = Math.min(70, Math.max(1, now - window._lastMercAiTime));
    window._lastMercAiTime = now;

    const activeMercs = entities.filter(ent => ent && ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0 && !ent.isDead);
    if (activeMercs.length === 0) return;

    const playerHasHaste = Boolean(player.buffs && (player.buffs['가속(헤이스트)'] || player.buffs['초록물약']));
    const baseSpeed = player.currentSpeed || 180;
    const followSpeed = (baseSpeed + (playerHasHaste ? 100 : 0)) * (dt / 1000);
    const combatApproachSpeed = (baseSpeed * 0.95 + (playerHasHaste ? 50 : 0)) * (dt / 1000);

    const executeMercAttack = (e, chosenSpell) => {
        e.lastAttack = now;
        if (chosenSpell && magicDb?.[chosenSpell] && e.mp >= magicDb[chosenSpell].mp) {
            if (typeof castAttackSpell === 'function') {
                castAttackSpell(e.target, chosenSpell, e, true);
            }
        } else {
            // 💡 마법사 용병은 마나가 없어도 절대 지팡이로 맞짱을 뜨지 않고 대기/도주
            if (e.mercType === 'wizard') return; 

            const totalAtk = typeof getEntityTotalAtk === 'function' ? getEntityTotalAtk(e) : (e.atk || 15);
            const isBow = Boolean(e.equip?.weapon?.isBow);
            if (typeof playSound === 'function') playSound(isBow ? 'bow' : 'swing');
            if (typeof damageEntity === 'function') {
                damageEntity(e.target, Math.max(1, totalAtk - (e.target.def || 0)), e, 'physical');
            }
        }
    };

    activeMercs.forEach(e => {
        if (e.maxMp === undefined || isNaN(e.maxMp)) e.maxMp = (e.level || 1) * 50 + 100;
        if (e.mp === undefined || isNaN(e.mp)) e.mp = e.maxMp;
        const expectedMaxExp = typeof getExpRequiredForLevel === 'function' ? getExpRequiredForLevel(e.level || 1) : 100;
        if (!e.maxExp || e.maxExp < expectedMaxExp) e.maxExp = expectedMaxExp;
        if (e.exp === undefined || isNaN(e.exp)) e.exp = 0;

        const inSafeZone = typeof isInSafeZone === 'function' && (isInSafeZone(currentMap, player.x, player.y) || isInSafeZone(currentMap, e.x, e.y));

        if (now - (e.lastRegen || 0) > 2000) {
            e.lastRegen = now;
            let hpRegenAmt = 3 + Math.floor((e.level || 1) / 2);
            let mpRegenAmt = 2 + Math.floor((e.level || 1) / 3);

            if (e.equip) {
                hpRegenAmt += (e.equip.armor?.hpRegen || 0) + (e.equip.weapon?.hpRegen || 0);
                mpRegenAmt += (e.equip.armor?.mpRegen || 0) + (e.equip.weapon?.mpRegen || 0);
            }

            if (inSafeZone) { hpRegenAmt *= 3; mpRegenAmt *= 3; }

            if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + hpRegenAmt);
            if (e.mp < e.maxMp) e.mp = Math.min(e.maxMp, e.mp + mpRegenAmt);
        }

        if (inSafeZone) {
            e.target = null;
            e.aggro = false;
            const pDist = Math.hypot(player.x - e.x, player.y - e.y);
            if (pDist > 50) {
                const angle = Math.atan2(player.y - e.y, player.x - e.x);
                e.x += Math.cos(angle) * followSpeed;
                e.y += Math.sin(angle) * followSpeed;
                e.isMoving = true;
                e.angle = angle;
            } else {
                e.isMoving = false;
            }
            return;
        }

        if (e.stance === 'rest') {
            e.target = null;
            e.isMoving = false;
            return;
        }

        const pDist = Math.hypot(player.x - e.x, player.y - e.y);
        if (pDist > 600) {
            e.x = player.x + (Math.random() * 40 - 20);
            e.y = player.y + (Math.random() * 40 - 20);
            e.target = null;
        }

        let pushX = 0, pushY = 0;
        activeMercs.forEach(other => {
            if (other !== e) {
                const d = Math.hypot(e.x - other.x, e.y - other.y);
                if (d < 45 && d > 0) {
                    const factor = 0.8 * (dt / 16.6);
                    pushX += ((e.x - other.x) / d) * factor;
                    pushY += ((e.y - other.y) / d) * factor;
                }
            }
        });

        if (typeof e.mercHpPotionCount === 'undefined') e.mercHpPotionCount = 100;
        if (typeof e.mercMpPotionCount === 'undefined') e.mercMpPotionCount = 50;

        // [물약 보급 자율 복용] HP 60% 미만 주홍물약 / MP 20% 미만 파란물약
        if (e.hp < e.maxHp * 0.60 && e.mercHpPotionCount > 0 && now - (e.lastMercHpPotTime || 0) > 800) {
            e.lastMercHpPotTime = now;
            e.mercHpPotionCount--;
            e.hp = Math.min(e.maxHp, e.hp + Math.floor(e.maxHp * 0.35));
        }

        if (e.mp < e.maxMp * 0.20 && e.mercMpPotionCount > 0 && now - (e.lastMercMpPotTime || 0) > 800) {
            e.lastMercMpPotTime = now;
            e.mercMpPotionCount--;
            e.mp = Math.min(e.maxMp, e.mp + 50);
        }

        const raceKey = e.mercType || 'knight';
        if (typeof getSkillsForMercenary === 'function') {
            e.skills = getSkillsForMercenary(raceKey, e.level || 1);
        }

        // [힐러 모드] MP 10% 이하 시 마법 공격을 멈추고 힐 전념
        let isLowMpMode = (e.mp / e.maxMp) < 0.10;

        if (e.mercType === 'wizard' && now - (e.lastHealTime || 0) > 4000) {
            const woundedAllies = [player, ...activeMercs].filter(a => a && a.hp > 0 && !a.isDead && (a.hp / (a.maxHp || currentMaxHp)) <= 0.45);
            if (woundedAllies.length > 0 && e.mp >= 20) {
                woundedAllies.sort((a, b) => (a.hp / (a.maxHp || currentMaxHp)) - (b.hp / (b.maxHp || currentMaxHp)));
                const targetWounded = woundedAllies[0];
                e.lastHealTime = now;
                e.mp -= 15;
                let healAmt = 50 + ((e.level || 1) * 10);
                targetWounded.hp = Math.min(targetWounded.maxHp || currentMaxHp, targetWounded.hp + healAmt);
                
                if (window.socket && currentUser) {
                    window.socket.emit('player_magic_action', {
                        magicName: '힐', targetX: targetWounded.x, targetY: targetWounded.y, targetId: targetWounded.id || window.socket.id,
                        casterX: e.x, casterY: e.y, casterId: e.id, map: currentMap
                    });
                }
                if (typeof particles !== 'undefined') particles.push({ x: targetWounded.x, y: targetWounded.y, life: 1.0, maxLife: 1.0, type: 'classic_heal' });
                if (typeof addSkillText === 'function') addSkillText(e.x, e.y, `[그레이트 힐]`, 'buff');
                if (typeof dmgTexts !== 'undefined') dmgTexts.push({ x: targetWounded.x, y: targetWounded.y - 30, text: `+${healAmt} 힐!`, life: 1.2, color: '#5f5' });
                if (typeof playSound === 'function') playSound('heal');
                return;
            }
        }

        const isPlayerEnemyTarget = player.target && typeof player.target.y === 'number' &&
            player.target.hp > 0 && !player.target.isDead && player.target !== player &&
            !(player.target.isSummon && player.target.owner === player) && player.target.map === currentMap;

        const enemyAttackingUs = entities.find(m =>
            m && !m.isSummon && !m.isPlayer && m.hp > 0 && !m.isDead && m.map === currentMap &&
            (Math.hypot(m.x - e.x, m.y - e.y) < 150 || Math.hypot(m.x - player.x, m.y - player.y) < 150)
        );

        e.target = isPlayerEnemyTarget ? player.target : (enemyAttackingUs || null);

        let mercAtkDelay = (e.mercType === 'wizard' || e.mercType === 'elf') ? 700 : 450;
        if (playerHasHaste) mercAtkDelay = Math.max(300, mercAtkDelay - 150);

        if (e.target && e.target.hp > 0 && !e.target.isDead) {
            const distToEnemy = Math.hypot(e.target.x - e.x, e.target.y - e.y);
            const isRanged = e.mercType === 'wizard' || (e.mercType === 'elf' && e.equip?.weapon?.isBow !== false);
            const maxAttackRange = isRanged ? 280 : 55;

            // [생존 최우선] 체력 25% 이하인데 물약도 없으면 전력 도주
            const isFleeing = (e.hp / e.maxHp) <= 0.25 && e.mercHpPotionCount <= 0;

            const nearbyCount = entities.filter(en => en && en.map === currentMap && !en.isSummon && en.hp > 0 && !en.isDead && Math.hypot(en.x - e.target.x, en.y - e.target.y) < 250).length;
            const chosenSpell = isLowMpMode && e.mercType === 'wizard' ? null : (typeof selectOptimalSpell === 'function' ? selectOptimalSpell(e, nearbyCount, e.target) : null);

            const kiteDistance = isRanged ? 220 : 0;

            if (isFleeing) {
                e.isMoving = true;
                const fleeAngle = Math.atan2(player.y - e.y, player.x - e.x);
                e.x += Math.cos(fleeAngle) * combatApproachSpeed * 1.2 + pushX;
                e.y += Math.sin(fleeAngle) * combatApproachSpeed * 1.2 + pushY;
                e.angle = fleeAngle;
            } 
            else if (isRanged && distToEnemy < kiteDistance) {
                // 💡 [완성된 강강술래 원형 오르빗 카이팅]
                // 플레이어를 중심축으로 삼아 큰 원을 그리며 돌면서 적을 사격합니다.
                e.isMoving = true;
                const orbitRadius = 220;
                e.orbitAngle = (e.orbitAngle || Math.atan2(e.y - player.y, e.x - player.x)) + (0.02 * (dt / 16));
                
                const targetSpotX = player.x + Math.cos(e.orbitAngle) * orbitRadius;
                const targetSpotY = player.y + Math.sin(e.orbitAngle) * orbitRadius;
                const moveAngle = Math.atan2(targetSpotY - e.y, targetSpotX - e.x);

                const mapLimit = typeof mapSize !== 'undefined' ? mapSize : 2000;
                e.x = Math.max(60, Math.min(mapLimit - 60, e.x + Math.cos(moveAngle) * combatApproachSpeed * 1.1 + pushX));
                e.y = Math.max(60, Math.min(mapLimit - 60, e.y + Math.sin(moveAngle) * combatApproachSpeed * 1.1 + pushY));
                e.angle = Math.atan2(e.target.y - e.y, e.target.x - e.x); // 시선은 항상 적 고정

                if (now - (e.lastAttack || 0) >= mercAtkDelay && distToEnemy <= maxAttackRange) {
                    executeMercAttack(e, chosenSpell);
                }
            } 
            else if (distToEnemy > maxAttackRange) {
                e.isMoving = true;
                const moveAngle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                e.x += Math.cos(moveAngle) * combatApproachSpeed + pushX;
                e.y += Math.sin(moveAngle) * combatApproachSpeed + pushY;
                e.angle = moveAngle;
            } 
            else {
                e.isMoving = false;
                e.angle = Math.atan2(e.target.y - e.y, e.target.x - e.x);
                if (now - (e.lastAttack || 0) >= mercAtkDelay) {
                    executeMercAttack(e, chosenSpell);
                }
            }
        } else {
            const followDistLimit = isPlayerEnemyTarget ? 40 : 75;
            const minThreshold = e.isMoving ? Math.max(35, followDistLimit - 20) : (followDistLimit + 15);

            if (pDist > minThreshold) {
                const angle = Math.atan2(player.y - e.y, player.x - e.x);
                e.x += Math.cos(angle) * followSpeed + pushX;
                e.y += Math.sin(angle) * followSpeed + pushY;
                e.angle = angle;
                e.isMoving = true;
            } else {
                e.x += pushX * 0.5;
                e.y += pushY * 0.5;
                e.isMoving = false;
            }
        }
    });
};

// ==========================================
// 🧠 [스마트 마법 선택 엔진] (단일/광역, 보스 집중)
// ==========================================
window.selectOptimalSpell = function(unit, nearbyEnemiesCount, target) {
    if (!unit.skills || unit.skills.length === 0) return null;

    let availableSkills = unit.skills.map(sName => {
        return { name: sName, data: magicDb[sName] };
    }).filter(item => item.data && unit.mp >= item.data.mp);

    if (availableSkills.length === 0) return null;

    let attackSpells = availableSkills.filter(item => item.data.type === 'attack' || item.data.dmg);
    if (attackSpells.length === 0) return null;

    // 1. 보스 집중 공격: 단일/광역 따지지 않고 가장 센 대미지 마법
    if (target && target.isBoss) {
        return attackSpells.sort((a, b) => (b.data.dmg || 0) - (a.data.dmg || 0))[0].name;
    }

    // 2. 3마리 이상 뭉쳐있을 때: 광역 마법(AoE) 우선
    if (nearbyEnemiesCount >= 3) {
        let aoeSpells = attackSpells.filter(item => Boolean(item.data.aoe));
        if (aoeSpells.length > 0) {
            return aoeSpells.sort((a, b) => (b.data.dmg || 0) - (a.data.dmg || 0))[0].name;
        }
    }

    // 3. 1~2마리 단일 몹: 단일 마법 우선
    let singleSpells = attackSpells.filter(item => !item.data.aoe);
    if (singleSpells.length > 0) {
        return singleSpells.sort((a, b) => (b.data.dmg || 0) - (a.data.dmg || 0))[0].name;
    }

    return attackSpells.sort((a, b) => (b.data.dmg || 0) - (a.data.dmg || 0))[0].name;
};

function selectOptimalSpell(unit, nearbyEnemiesCount, target) {
    if (!unit.skills || unit.skills.length === 0) return null;

    let availableSkills = unit.skills.map(sName => {
        return { name: sName, data: magicDb[sName] };
    }).filter(item => item.data && unit.mp >= item.data.mp);

    if (availableSkills.length === 0) return null;

    let mpRatio = unit.mp / unit.maxMp;

    // 💡 [수정] 본인 체력이 35% 이하로 극도로 위험할 때만 자가 치유 (평소엔 공격 우선)
    if ((unit.hp / unit.maxHp) <= 0.35 && unit.mp >= 20) {
        let healSpells = availableSkills.filter(item => item.data.heal > 0);
        if (healSpells.length > 0) return healSpells.sort((a, b) => b.data.heal - a.data.heal)[0].name;
    }

    let attackSpells = availableSkills.filter(item => item.data.type === 'attack' || item.data.dmg);
    if (attackSpells.length === 0) return null;

    let isStrongTarget = target && (target.isBoss || (target.maxHp && target.maxHp > 250));
    let wantAoe = nearbyEnemiesCount >= 3;

    // MP 60% 이상 또는 보스전 -> 강력한 공격 마법 우선
    if (isStrongTarget || mpRatio >= 0.60) {
        let matchedAttacks = attackSpells.filter(item => wantAoe ? Boolean(item.data.aoe) : !Boolean(item.data.aoe));
        if (matchedAttacks.length === 0) matchedAttacks = attackSpells;
        matchedAttacks.sort((a, b) => (b.data.dmg || 0) - (a.data.dmg || 0));
        return matchedAttacks[0].name;
    }

    // MP 25% ~ 60% -> 효율형 공격 마법
    if (mpRatio >= 0.25) {
        let matchedAttacks = attackSpells.filter(item => wantAoe ? Boolean(item.data.aoe) : !Boolean(item.data.aoe));
        if (matchedAttacks.length === 0) matchedAttacks = attackSpells;
        matchedAttacks.sort((a, b) => (b.data.dmg / (b.data.mp || 1)) - (a.data.dmg / (a.data.mp || 1)));
        return matchedAttacks[0].name;
    }

    // MP 25% 미만 -> 최저 MP 공격 마법 사용
    let lowestMpSpells = [...attackSpells].sort((a, b) => (a.data.mp || 0) - (b.data.mp || 0));
    return lowestMpSpells[0] ? lowestMpSpells[0].name : null;
}
window.handlePartyHudClick = function(socketId, name) {
    // 💡 [안전 장치 강화]: 화면에 엔티티가 없어도 소켓 ID와 이름으로 즉시 모달 객체 구성
    let target = entities.find(e => e.isPlayer && (e.id === socketId || e.socketId === socketId));
    
    if (!target) {
        target = { 
            isPlayer: true, 
            id: socketId, 
            socketId: socketId,
            name: name,
            partyId: window.myParty?.id,
            charClass: 'knight' // 기본값 설정
        };
    }
    
    // 다른 플레이어 정보 및 파티 관리 메뉴 모달 호출
    if (typeof showPartyMenu === 'function') {
        showPartyMenu(target);
    } else {
        addMessage(`${name} 선택됨`, "#aaa");
    }
};


function clearPlayerAggro() {
    if (!entities) return;
    entities.forEach(e => {
        if (e && e.target === player) {
            e.target = null;
            e.aggro = false;
        }
    });
    player.target = null;
    player.isMoving = false;
}










// ==========================================
// 💡 [주문서/강화 모드 취소 (ESC 키 및 우클릭 지원)]
// ==========================================
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // 1. 주문서 강화 모드 취소
        if (window.activeEnchantScrollKey) {
            window.activeEnchantScrollKey = null;
            document.body.style.cursor = 'default';
            if (typeof addMessage === 'function') addMessage("주문서 사용이 취소되었습니다.", '#aaa');
        }
        
        // 2. 수동 마법 선택 취소
        if (typeof player !== 'undefined' && player.selectedManualSpell) {
            player.selectedManualSpell = null;
            if (typeof addMessage === 'function') addMessage("수동 마법 선택이 취소되었습니다.", '#aaa');
        }

        // 3. 타겟팅 몬스터 해제 및 다음 몬스터 탐색 활성화
        if (typeof player !== 'undefined' && player.target) {
            let prevId = player.target.id;
            player.target = null;
            player.manualOverrideUntil = 0;
            player.moveX = undefined;
            player.moveY = undefined;
            player.isMoving = false;
            player.ignoredTargetId = prevId;
            player.ignoredUntil = performance.now() + 3500;
            if (typeof addMessage === 'function') addMessage("타겟 해제 -> 다음 몬스터를 탐색합니다.", '#5cf');
        }
    }
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.activeEnchantScrollKey) {
        window.activeEnchantScrollKey = null;
        document.body.style.cursor = 'default';
        if (typeof addMessage === 'function') addMessage("주문서 사용이 취소되었습니다.", '#aaa');
        return;
    }
});

// ==========================================
// 💡 [스마트 자동전투 마법 선택 함수 선언]
// ==========================================
window.getSmartAutoCombatSpell = function(target) {
    if (!player || !target) return null;
    if (!player.activeSpellSlots || player.activeSpellSlots.length === 0) return null;

    // 퀵슬롯에 등록된 공격 마법 중 MP가 충분한 마법 필터링
    let availableSpells = player.activeSpellSlots
        .map(idx => hotkeys[idx])
        .filter(hk => hk && hk.type === 'magic' && magicDb[hk.id])
        .map(hk => ({ id: hk.id, ...magicDb[hk.id] }))
        .filter(s => (s.type === 'attack' || s.dmg > 0) && player.mp >= s.mp);

    if (availableSpells.length === 0) return null;

    // 1. 보스 몬스터 상대 시: 가장 대미지가 강한 마법 선택
    if (target.isBoss) {
        availableSpells.sort((a, b) => (b.dmg || 0) - (a.dmg || 0));
        return availableSpells[0].id;
    }

    // 2. 타겟 주변 180px 내의 생존 몬스터 수 계산
    let nearbyEnemies = entities.filter(e => 
        e && e.map === currentMap && !e.isSummon && !e.isPlayer && 
        e.hp > 0 && !e.isDead && Math.hypot(e.x - target.x, e.y - target.y) <= 180
    );

    // 3. 2마리 이상: 광역 마법(aoe) 우선 시전
    if (nearbyEnemies.length >= 2) {
        let aoeSpells = availableSpells.filter(s => Boolean(s.aoe));
        if (aoeSpells.length > 0) {
            aoeSpells.sort((a, b) => (b.dmg || 0) - (a.dmg || 0));
            return aoeSpells[0].id;
        }
    }

    // 4. 1마리(단일몹): 단일 공격 마법 우선 시전
    let singleSpells = availableSpells.filter(s => !s.aoe);
    if (singleSpells.length > 0) {
        singleSpells.sort((a, b) => (b.dmg || 0) - (a.dmg || 0));
        return singleSpells[0].id;
    }

    // 조건에 딱 맞는 게 없으면 가장 강한 마법 사용
    availableSpells.sort((a, b) => (b.dmg || 0) - (a.dmg || 0));
    return availableSpells[0].id;
};





window.castBuff = function(magicName, targetEntity = null) {
    let dbRef = typeof magicDb !== 'undefined' ? magicDb : (window.magicDb || {});
    let mData = dbRef[magicName];
    if (!mData) return;

    let target = targetEntity || player;
    let pMaxHp = window.currentMaxHp || player.maxHp || 150;
    let pMaxMp = window.currentMaxMp || player.maxMp || 30;

    let isDefaultClassSpell = (player.charClass === 'wizard' && ['에너지 볼트', '힐', '실드', '가속', '그레이트 힐', '어드밴스 스피릿', '이뮨 투 함', '앱솔루트 배리어', '마제스티', '홀리 워크'].some(n => magicName.includes(n))) ||
                              (player.charClass === 'knight' && ['쇼크 스턴', '리덕션 아머', '카운터 바리어', '바운스 어택', '솔리드 캐리지', '블로우 어택'].some(n => magicName.includes(n))) ||
                              (player.charClass === 'elf' && ['네이쳐스 터치', '윈드 워크', '트리플 애로우', '스톰 샷', '블러드 투 소울', '어스 스킨', '파이어 웨폰', '워터 라이프', '소울 오브 프레임'].some(n => magicName.includes(n)));

    let hasLearned = (player.magic && player.magic.includes(magicName)) || isDefaultClassSpell;
    if (!hasLearned) {
        if (typeof addMessage === 'function') addMessage(`[${magicName}] 습득하지 않은 마법입니다.`, '#f55');
        return;
    }
    
    if (magicName !== '블러드 투 소울' && player.mp < (mData.mp || 0)) {
        return;
    }        
    if (magicName !== '블러드 투 소울') {
        player.mp -= (mData.mp || 0);
    }
    if (typeof playSound === 'function') playSound('spell');

    if (mData.heal || magicName.includes('힐') || magicName === '네이쳐스 터치') {
        let healAmt = Math.floor((mData.heal || 40) * (1 + ((player.int || 10) - 10) * 0.05));
        target.hp = Math.min(pMaxHp, target.hp + healAmt);
        if (typeof addMessage === 'function') addMessage(`[${magicName}] HP ${healAmt} 회복`, '#5f5');
    } else if (magicName === '블러드 투 소울') {
        if (player.hp > 40) {
            player.hp -= 40;
            player.mp = Math.min(pMaxMp, player.mp + 15);
            if (typeof addMessage === 'function') addMessage(`[블러드 투 소울] HP 40 소모 ➔ MP 15 회복`, '#55f');
        }
    } else {
        let bType = mData.buffType || 'stat';
        if (magicName.includes('가속') || magicName.includes('초록') || magicName.includes('워크')) bType = 'speed';
        else if (magicName.includes('실드') || magicName.includes('아머') || magicName.includes('스킨')) bType = 'def';
        
        if (typeof applyBuff === 'function') {
            applyBuff(magicName, mData.duration || 300000, mData.icon || '✨', bType, mData.val || 0, target);
        }
    }

    if (window.socket && currentUser) {
        window.socket.emit('player_magic_action', {
            magicName: magicName,
            targetX: target.x, targetY: target.y,
            targetId: target.id || window.socket.id,
            casterX: player.x, casterY: player.y,
            casterId: window.socket.id,
            map: currentMap
        });
    }
    if (typeof updateUI === 'function') updateUI();
};

// JS: 전체화면 토글 함수
window.toggleFullScreenMode = function() {
    if (typeof playSound === 'function') playSound('click');
    const btn = document.getElementById('btn-fullscreen-toggle');
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
            docEl.requestFullscreen().catch(err => {});
        } else if (docEl.webkitRequestFullscreen) {
            docEl.webkitRequestFullscreen();
        }
        if (btn) {
            btn.innerText = '전체화면 끄기';
            btn.className = 'confirm-btn bg-dark-red';
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => {});
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        if (btn) {
            btn.innerText = '전체화면 켜기';
            btn.className = 'confirm-btn bg-dark-green';
        }
    }
};

document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('btn-fullscreen-toggle');
    if (btn) {
        const isFS = !!document.fullscreenElement;
        btn.innerText = isFS ? '전체화면 끄기' : '전체화면 켜기';
        btn.className = isFS ? 'confirm-btn bg-dark-red' : 'confirm-btn bg-dark-green';
    }
    if (typeof resize === 'function') resize();
});



window.processAutoConsumablesAndBuffs = function() {
    if (!gameStarted || !player || player.hp <= 0 || player.isDead) return;
    let now = Date.now();
    let pMaxHp = window.currentMaxHp || player.maxHp || 150;
    let pMaxMp = window.currentMaxMp || player.maxMp || 30;

    let hkList = window.hotkeys || [];

    // ----------------------------------------------------
    // 1. [물약 ON] 자동 물약 복용 (순삭 방지 쿨타임 적용)
    // ----------------------------------------------------
    if (player.autoPotion) {
        // [A] 체력 70% 미만 시 HP 물약 (쿨타임 500ms)
        if (player.hp < pMaxHp * 0.70 && (now - (player.lastAutoHpPotTime || 0) > 500)) {
            for (let hk of hkList) {
                if (!hk) continue;
                let slotName = typeof hk === 'string' ? hk : (hk.id || hk.name || '');
                if (/주홍|맑은|빨간|고기|체력|물약/.test(slotName)) {
                    let pot = player.inv.find(it => it && it.type === 'potion' && (it.heal || it.name.includes(slotName) || slotName.includes(it.name) || /주홍|맑은|빨간/.test(it.name)));
                    if (pot && typeof window.useItem === 'function') {
                        player.lastAutoHpPotTime = now;
                        window.useItem(typeof getStackKey === 'function' ? getStackKey(pot) : pot.name);
                        break; 
                    }
                }
            }
        }

        // [B] 마나 20% 미만 시 MP 물약 (쿨타임 800ms)
        if (player.mp < pMaxMp * 0.20 && (now - (player.lastAutoMpPotTime || 0) > 800)) {
            for (let hk of hkList) {
                if (!hk) continue;
                let slotName = typeof hk === 'string' ? hk : (hk.id || hk.name || '');
                if (/파란|마나/.test(slotName)) {
                    let pot = player.inv.find(it => it && it.type === 'potion' && (it.name.includes(slotName) || slotName.includes(it.name) || /파란|마나/.test(it.name)));
                    if (pot && typeof window.useItem === 'function') {
                        player.lastAutoMpPotTime = now;
                        window.useItem(typeof getStackKey === 'function' ? getStackKey(pot) : pot.name);
                        break;
                    }
                }
            }
        }

        // [C] 버프 물약 (초록, 용기, 와퍼)
        if (player.autoHunt) {
            const autoDrinkBuff = (keyword, targetBuffKey) => {
                let slot = hkList.find(hk => hk && (typeof hk === 'string' ? hk : (hk.id || hk.name || '')).includes(keyword));
                if (!slot) return;

                let activeBuff = player.buffs && player.buffs[targetBuffKey];
                if (!activeBuff || (activeBuff.expire - performance.now()) <= 3000) {
                    let pot = player.inv.find(it => it && it.type === 'potion' && it.name.includes(keyword));
                    if (pot && typeof window.useItem === 'function') {
                        window.useItem(typeof getStackKey === 'function' ? getStackKey(pot) : pot.name);
                    }
                }
            };
            autoDrinkBuff('초록 물약', '가속(헤이스트)');
            if (player.charClass === 'knight' || player.charClass === 'royal') autoDrinkBuff('용기의 물약', '용기물약');
            if (player.charClass === 'elf') autoDrinkBuff('엘븐 와퍼', '엘븐와퍼');
        }
    }

    // ----------------------------------------------------
    // 2. [자동사냥 ON] 버프 마법 자동 시전
    // ----------------------------------------------------
    if (!player.autoHunt) return;
    let activeSlots = player.activeSpellSlots || [];
    if (activeSlots.length === 0) return;

    let dbRef = (typeof magicDb !== 'undefined') ? magicDb : {};
    player.lastAutoSkillTime = player.lastAutoSkillTime || {};

    for (let slotNum of activeSlots) {
        let hk = hkList[Number(slotNum)];
        if (!hk) continue;

        let rawName = typeof hk === 'string' ? hk : (hk.id || hk.name || '');
        let cleanName = rawName.replace(/마법서|기술서|정령의 수정|\s+|\(|\)/g, '').trim();
        
        let spellKey = Object.keys(dbRef).find(k => {
            let dbClean = k.replace(/\s+/g, '');
            return dbClean === cleanName || cleanName.includes(dbClean) || dbClean.includes(cleanName);
        });

        if (!spellKey) continue;
        let mData = dbRef[spellKey];
        if (!mData) continue;

        let lastCast = player.lastAutoSkillTime[spellKey] || 0;
        let isBuffOrHeal = (mData.type === 'buff') || Boolean(mData.heal) || 
                           ['실드', '윈드 워크', '홀리 워크', '가속', '힐', '그레이트 힐', '블러드 투 소울', '어스 스킨', '스톰 샷', '이뮨 투 함', '어드밴스 스피릿', '리덕션 아머', '카운터 바리어', '바운스 어택', '솔리드 캐리지', '블로우 어택', '파이어 웨폰', '워터 라이프', '마제스티'].some(n => spellKey.includes(n));

        if (isBuffOrHeal) {
            let checkKey = spellKey.includes('가속') || spellKey.includes('초록') || spellKey.includes('윈드') || spellKey.includes('홀리') ? '가속(헤이스트)' : (spellKey.includes('용기') ? '용기물약' : (spellKey.includes('와퍼') ? '엘븐와퍼' : spellKey));
            let currentBuff = player.buffs ? player.buffs[checkKey] : null;
            let needsCast = !currentBuff || ((currentBuff.expire - performance.now()) <= 4000);

            if (needsCast && (spellKey === '블러드 투 소울' || player.mp >= (mData.mp || 0)) && (now - lastCast > 600 || lastCast > now)) {
                player.lastAutoSkillTime[spellKey] = now;
                if (typeof window.castBuff === 'function') {
                    window.castBuff(spellKey, player);
                }
                break;
            }
        }
    }
};

// ==========================================
// 🔥 [보스 레이드: 15초 대기실, 단계별 스폰 및 자동 귀환]
// ==========================================
window.enterBossRaid = function() {
    if (!gameStarted || !player) return;
    
    window.closeAllWindows(); 

  
    player.isMoving = false;
    player.target = null;
    player.moveX = undefined;
    player.moveY = undefined;
    player.autoHunt = false;
    if (typeof updateUI === 'function') updateUI();

    let wpEnchant = (player.equip && player.equip.weapon && player.equip.weapon.enchantValue) ? player.equip.weapon.enchantValue : 0;
    let amEnchant = (player.equip && player.equip.armor && player.equip.armor.enchantValue) ? player.equip.armor.enchantValue : 0;
    
    let mainStat = 0;
    let classPowerBonus = 0;

// 1. 동행 중인 용병들의 화력 가중치 산출
    let mercsCombatPower = 0;
    let activeMercs = entities.filter(ent => ent && ent.isSummon && ent.owner === player && ent.hp > 0);
    
    activeMercs.forEach(m => {
        if (m.mercType === 'wizard' || m.charClass === 'wizard') {
            mercsCombatPower += 2000 + ((m.level || 1) * 100);
        } else {
            mercsCombatPower += 800 + ((m.level || 1) * 50);
        }
    });

    // 2. 클래스별 실질 초당 화력(DPS 배율) 정밀 반영
    let realDpsPower = 0;
    if (player.charClass === 'wizard') {
        let intVal = player.int || 18;
        let spVal = (player.sp || 0) + Math.floor((intVal - 10) / 2);
        // 실제 마법 대미지 증폭 공식 반영 (INT 128 / SP 24 스펙 완벽 인식)
        let magicScale = 1 + (spVal * 0.15) + Math.max(0, (intVal - 12) * 0.05);
        realDpsPower = Math.floor(250 * magicScale * 15); 
    } else if (player.charClass === 'elf') {
        let dexVal = player.dex || 14;
        realDpsPower = Math.floor((player.atk || 20) * 25 + dexVal * 100);
    } else {
        let strVal = player.str || 18;
        realDpsPower = Math.floor((player.atk || 20) * 25 + strVal * 100);
    }

    // 3. 최종 통합 전투력 (레벨 + 장비 + 실질 화력 + 용병)
    let combatPower = (player.level * 400) + (wpEnchant * 300) + (amEnchant * 150) + realDpsPower + mercsCombatPower;

    if (window.socket && currentUser) {
        window.socket.emit('request_join_raid', { combatPower });
    }

    let raidOverlay = document.createElement('div');
    raidOverlay.id = 'raid-cutscene';
    raidOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.9); z-index:9999999; display:flex; flex-direction:column; justify-content:center; align-items:center; opacity:0; transition:opacity 0.3s ease;';
    
    let textEl = document.createElement('div');
    textEl.style.cssText = 'color:#fff; font-size:20px; font-weight:bold; text-align:center; text-shadow: 2px 2px 4px #000; line-height: 2.0;';
    textEl.innerHTML = `[ 차원의 틈새 대기실 ]<br><span style="color:#fd0; font-size:24px;">파티원 모집 중... (15초 후 시작)</span><br><span style="font-size:13px; color:#aaa;">⚠️ 시작 후에는 추가 난입이 불가능합니다.</span>`;
    raidOverlay.appendChild(textEl);
    document.body.appendChild(raidOverlay);

    setTimeout(() => raidOverlay.style.opacity = '1', 50);

    window.socket.off('raid_countdown_tick');
    window.socket.on('raid_countdown_tick', (data) => {
        textEl.innerHTML = `[ 차원의 틈새 대기실 ]<br><span style="color:#fd0; font-size:26px;">⚔️ 전투 시작까지 ${data.countdown}초 전!</span><br><span style="font-size:13px; color:#aaa;">대기 중인 파티원과 함께 진입합니다.</span>`;
        if (typeof playSound === 'function') playSound('click');
    });

    window.socket.off('raid_battle_start');
    window.socket.on('raid_battle_start', (data) => {
    let bgTypes = ['lava', 'dungeon', 'tower', 'stone'];
    let timeSeed = Math.floor(Date.now() / 600000);
    let randomBg = bgTypes[timeSeed % bgTypes.length];
    
    if (maps['boss_raid']) maps['boss_raid'].bg = randomBg;
    if (generatedMaps['boss_raid']) delete generatedMaps['boss_raid'];
    
    changeMap('boss_raid', 2000, 3600);
    window.spawnRaidBoss(data.tierIndex, 1);
    
    if (typeof playSound === 'function') playSound('boss_roar'); // 💡 보스 포효

    raidOverlay.style.opacity = '0';
    setTimeout(() => raidOverlay.remove(), 400);
});

   // 💡 레이드 2차 종료 시 자동사냥 강제 해제 수신 (정상 정돈)
    window.socket.off('raid_clear_return_town');
    window.socket.off('raid_clear_disable_autohunt');
    window.socket.on('raid_clear_disable_autohunt', () => {
        if (typeof player !== 'undefined' && player) {
            player.autoHunt = false;
            player.target = null;
            player.isMoving = false;
            player.moveX = undefined;
            player.moveY = undefined;
            
            if (typeof updateUI === 'function') updateUI();
            if (typeof addMessage === 'function') {
                addMessage("⚔️ 보스 레이드가 종료되어 자동사냥이 해제되었습니다.", "#aaa");
            }
        }
    });

        player.autoHunt = false;
        player.autoPotion = false;
        player.target = null;
        player.isMoving = false;
        player.moveX = undefined;
        player.moveY = undefined;

        if (typeof changeMap === 'function') {
            changeMap(data.map || 'talking_island', data.x || 2000, data.y || 2000);
        }
        if (typeof updateUI === 'function') updateUI();
    
};

window.spawnRaidBoss = function(tierIndex, waveNum = 1) {
    let baseBosses = Object.values(templates.bosses).map(b => b.name);
    let selectedBoss = baseBosses[Math.floor(Math.random() * baseBosses.length)];
    let tierTitles = ["", "[정예]", "[악몽]", "[지옥]", "[불지옥]"];
    
    // 💡 1차 웨이브 기본 스펙
    let pAtk = (player.atk || 20) + ((player.equip && player.equip.weapon && player.equip.weapon.atk) || 10);
    let calculatedHp = Math.max(150000, pAtk * 40 * (1 + waveNum * 0.2));

    let raidBoss = {
        id: 'raid_boss_w' + waveNum + '_' + Date.now(),
        name: `${tierTitles[tierIndex || 0]} ${selectedBoss} (${waveNum}/2)`,
        isBoss: true,
        x: 2000, 
        y: 800, // 맵 안쪽 스폰
        map: 'boss_raid',
        size: 30 + ((tierIndex || 0) * 3),
        hp: calculatedHp,
        maxHp: calculatedHp,
        atk: 80 + (waveNum * 15),
        def: 50 + (waveNum * 10),
        exp: 30000 * waveNum,
        color: '#ff3333',
        angle: 0,
        isMoving: false,
        raidTier: tierIndex || 0
    };

    if (window.socket && currentUser) {
        window.socket.emit('spawn_raid_boss', raidBoss);
    }

    entities.push(raidBoss);
    if (typeof addMessage === 'function') {
        addMessage(`차원의 틈새 최심부에 [${waveNum}차 웨이브] ${raidBoss.name}이(가) 나타났습니다!`, '#f55');
    }
};
