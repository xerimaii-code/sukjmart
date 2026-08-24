
v1
// ==========================================
// [1. 최상단 DOM 헬퍼 & 전역 상태 변수 및 멀티플레이 소켓 준비]
// ==========================================
window.$ = (id) => document.getElementById(id);

// 서버 주도형 멀티플레이를 위한 Socket.io 객체 준비 (추후 server.js와 연동)
window.socket = typeof io !== 'undefined' ? io() : null;

const SUPABASE_URL = 'https://vnagjrhnvtngsomxwair.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fo-6ibZ51qwEpX7XYsLyRw_BprsNvR5';

let supabaseInstance = null;

window.getSupabaseClient = function() {
    if (supabaseInstance) return supabaseInstance;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
        supabaseInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return supabaseInstance;
    }
    return null;
};

window.currentUser = null;
window.myCharacters = [];
window.currentSlotIndex = 0;

// [공통 헬퍼] 메시지에서 [타이틀] 문구를 자동 추출하여 윈도우 헤더 제목으로 변환
function parseTitleAndMsg(msg, defaultTitle) {
    let title = defaultTitle;
    let body = msg;
    if (msg && typeof msg === 'string' && msg.startsWith('[')) {
        let closeIdx = msg.indexOf(']');
        if (closeIdx > 0) {
            title = msg.substring(1, closeIdx);
            body = msg.substring(closeIdx + 1).trim();
        }
    }
    return { title, body };
}

// 1. 단순 알림창 (Window 형태)
window.showAlert = function(msg) {
    const modal = $('confirm-modal');
    if (!modal) return alert(msg);
    
    let { title, body } = parseTitleAndMsg(msg, "알림");
    if ($('confirm-win-title')) $('confirm-win-title').innerText = title;
    if ($('confirm-msg')) $('confirm-msg').innerText = body;
    
    let inputEl = $('confirm-input');
    if (inputEl) inputEl.style.display = 'none';

    let container = $('confirm-btn-container');
    if (container) container.innerHTML = '<button class="confirm-btn" id="btn-yes">확인</button>';
    
    let closeContainer = $('modal-fixed-close-wrap');
    if (closeContainer) closeContainer.innerHTML = '';

    modal.style.display = 'flex';
    bindPromptButtons();
    confirmCallback = null;
};

// ==========================================
// [2. 계정 인증 & 슬롯 관리 (탭 및 자동 로그인)]
// ==========================================
let currentAuthMode = 'login'; // 'login' 또는 'signup'

window.addEventListener('DOMContentLoaded', async () => {
    let savedId = localStorage.getItem('lineage_saved_id');
    if (savedId && $('auth-email')) {
        $('auth-email').value = savedId;
        if ($('auth-remember-id')) $('auth-remember-id').checked = true;
    }

    let checkInterval = setInterval(async () => {
        const sb = getSupabaseClient();
        if (sb) {
            clearInterval(checkInterval);
            try {
                const { data: { session }, error } = await sb.auth.getSession();
                if (session && session.user) {
                    currentUser = session.user;
                    console.log("자동 로그인 성공:", currentUser.email);
                    await fetchCharacterList();
                }
            } catch(e) {
                console.error("자동 로그인 세션 확인 중 에러:", e);
            }
        }
    }, 200);
});

window.switchAuthMode = function(mode) {
    currentAuthMode = mode;
    let confirmWrap = $('signup-confirm-wrap');
    let actionBtn = $('auth-action-btn');
    let loginTab = $('tab-login-btn');
    let signupTab = $('tab-signup-btn');

    if (mode === 'signup') {
        if(confirmWrap) confirmWrap.style.display = 'block'; 
        if(actionBtn) {
            actionBtn.innerText = '회원가입 하기';
            actionBtn.className = 'confirm-btn bg-gray w-full';
        }
        if(loginTab) { loginTab.style.color = '#888'; loginTab.style.borderBottom = 'none'; }
        if(signupTab) { signupTab.style.color = '#fd0'; signupTab.style.borderBottom = '2px solid #fd0'; }
    } else {
        if(confirmWrap) confirmWrap.style.display = 'none'; 
        if(actionBtn) {
            actionBtn.innerText = '로그인';
            actionBtn.className = 'confirm-btn bg-dark-green w-full';
        }
        if(loginTab) { loginTab.style.color = '#fd0'; loginTab.style.borderBottom = '2px solid #fd0'; }
        if(signupTab) { signupTab.style.color = '#888'; signupTab.style.borderBottom = 'none'; }
    }
};

window.handleAuthSubmit = async function() {
    if (currentAuthMode === 'signup') {
        await handleSignUp();
    } else {
        await handleSignIn();
    }
};

window.handleSignUp = async function() {
    const sb = getSupabaseClient();
    if (!sb) return alert("Supabase 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");

    let email = $('auth-email').value.trim();
    let password = $('auth-password').value;
    let passwordConfirm = $('auth-password-confirm') ? $('auth-password-confirm').value : '';

    if (!email || !password) return showAlert("이메일과 비밀번호를 모두 입력해주세요.");
    
    if (password !== passwordConfirm) {
        return showAlert("비밀번호가 일치하지 않습니다. 다시 확인해주세요.");
    }

    if (password.length < 6) {
        return showAlert("비밀번호는 최소 6자리 이상이어야 합니다.");
    }

    try {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) {
            showAlert("회원가입 실패: " + error.message);
        } else {
            showAlert("회원가입이 완료되었습니다! 바로 로그인됩니다.");
            if($('auth-password-confirm')) $('auth-password-confirm').value = '';
            await handleSignInAfterSignup(email, password);
        }
    } catch(err) {
        showAlert("회원가입 처리 중 에러: " + err.message);
    }
};

async function handleSignInAfterSignup(email, password) {
    const sb = getSupabaseClient();
    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (!error && data.user) {
            currentUser = data.user;
            await fetchCharacterList();
        }
    } catch(e) {
        console.error("자동 로그인 연동 중 예외:", e);
    }
}

window.handleSignIn = async function() {
    const sb = getSupabaseClient();
    if (!sb) return alert("Supabase 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");

    let email = $('auth-email').value.trim();
    let password = $('auth-password').value;
    if (!email || !password) return showAlert("이메일과 비밀번호를 입력해주세요.");

    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
            return showAlert("로그인 실패: 아이디 또는 비밀번호를 확인하세요.\n(" + error.message + ")");
        }

        let rememberChk = $('auth-remember-id');
        if (rememberChk && rememberChk.checked) {
            localStorage.setItem('lineage_saved_id', email);
        } else {
            localStorage.removeItem('lineage_saved_id');
        }

        currentUser = data.user;
        await fetchCharacterList();
    } catch(err) {
        showAlert("로그인 처리 중 에러: " + err.message);
    }
};

window.logout = async function() {
    closeAllWindows();
    let emailInput = $('auth-email');
    let rememberChk = $('auth-remember-id');
    if (rememberChk && rememberChk.checked && emailInput && emailInput.value.trim()) {
        localStorage.setItem('lineage_saved_id', emailInput.value.trim());
    }

    if (gameStarted) {
        saveGameToLocal(true); 
        await autoSaveToSupabase(true);
    }
    await window.handleSignOut(); 
};

window.handleSignOut = async function() {
    closeAllWindows();
    const sb = getSupabaseClient();
    
    let emailInput = $('auth-email');
    let rememberChk = $('auth-remember-id');
    if (rememberChk && rememberChk.checked && emailInput && emailInput.value.trim()) {
        localStorage.setItem('lineage_saved_id', emailInput.value.trim());
    }

    if (gameStarted && currentUser) {
        try {
            let saveData = getCompleteSavePayload(null, 0); 
            await sb.from('characters').update({
                name: saveData.player.name, 
                class_name: classData[saveData.player.charClass] ? classData[saveData.player.charClass].name : '기사', 
                data: saveData, 
                updated_at: new Date()
            }).eq('user_id', currentUser.id).eq('slot_index', currentSlotIndex);
        } catch(e) {}
    }

    if (sb) await sb.auth.signOut();
    gameStarted = false;
    currentUser = null;
    myCharacters = [];
    
    let savedId = localStorage.getItem('lineage_saved_id');
    if($('auth-email')) {
        $('auth-email').value = savedId ? savedId : '';
        if($('auth-remember-id')) $('auth-remember-id').checked = !!savedId;
    }
    if($('auth-password')) $('auth-password').value = '';
    if($('auth-password-confirm')) $('auth-password-confirm').value = '';

    if($('main-ui')) $('main-ui').style.display = 'none';
    if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'flex';
    if($('auth-box')) $('auth-box').style.display = 'block';
    if($('slot-box')) $('slot-box').style.display = 'none';
};

window.triggerFileImport = function() {
    let fileInput = $('file-import');
    if(fileInput) { 
        fileInput.value = ''; 
        fileInput.click(); 
    } else { 
        alert("파일 입력 요소(#file-import)를 찾을 수 없습니다."); 
    }
};

window.returnToCharSelect = async function() {
    if (gameStarted) {
        saveGameToLocal(true);
        await autoSaveToSupabase(true);
    }
    closeAllWindows();
    gameStarted = false;
    
    if($('main-ui')) $('main-ui').style.display = 'none';
    if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'flex';
    if($('auth-box')) $('auth-box').style.display = 'none';
    if($('slot-box')) $('slot-box').style.display = 'block';
    
    await fetchCharacterList(); 
    addMessage("캐릭터 선택 화면으로 이동했습니다.", "#fd0");
};

window.fetchCharacterList = async function() {
    if(!currentUser) return;
    const sb = getSupabaseClient();
    if(!sb) return;

    const { data, error } = await sb
        .from('characters')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('slot_index', { ascending: true });

    if(error) {
        console.error("캐릭터 목록 불러오기 에러:", error);
        return;
    }

    myCharacters = data || [];
    renderCharacterSlotsUI();
};

window.renderCharacterSlotsUI = function() {
    $('auth-box').style.display = 'none';
    $('slot-box').style.display = 'block';
    if ($('user-info-text')) $('user-info-text').innerText = `계정: ${currentUser.email}`;

    let container = $('character-slots');
    if (!container) return;
    let html = '';

    for(let i = 0; i < 3; i++) {
        let charData = myCharacters.find(c => c.slot_index === i);
       
        if(charData) {
            let className = charData.class_name || '기사';
            let charLv = charData.data?.player?.level || 1;

            html += `
                <div style="background:linear-gradient(to right, #1a1a24, #121218); border:1px solid #556; padding:10px 14px; border-radius:6px; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; box-shadow:0 3px 6px rgba(0,0,0,0.5);">
                    <div style="text-align:left; display:flex; flex-direction:column; overflow:hidden; padding-right:8px;">
                        <div style="font-weight:bold; color:#fd0; font-size:13px;">[슬롯 ${i+1}] ${charData.name}</div>
                        <div style="font-size:11px; color:#ccc; margin-top:2px;">${className} · <span style="color:#5cf; font-weight:bold;">Lv.${charLv}</span></div>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <button class="confirm-btn bg-dark-red" style="padding:6px 10px; font-size:11px; color:#f88; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="deleteCharacter(${i}, '${charData.name}')">삭제</button>
                        <button class="confirm-btn bg-dark-green" style="padding:6px 12px; font-size:11px; border-radius:4px; font-weight:bold; cursor:pointer;" onclick="selectSlotAndStart(${i})">접속</button>
                    </div>
                </div>`;
        } else {
            html += `
                <div style="background:#111115; border:1px dashed #444; padding:10px 14px; border-radius:6px; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="color:#666; font-size:12px; font-weight:bold;">[슬롯 ${i+1}] 빈 슬롯</span>
                    <button class="confirm-btn bg-gray" style="padding:6px 14px; font-size:11px; border-radius:4px; cursor:pointer;" onclick="openCreateCharModal(${i})">생성</button>
                </div>`;
        }
    }
    container.innerHTML = html;
};
window.selectSlotAndStart = async function(slotIndex) {
    let charObj = myCharacters.find(c => c.slot_index === slotIndex);
    if(!charObj) return;

    let loadedData = charObj.data || {};
    const lastSync = loadedData.last_sync_time || 0;
    const isOnline = lastSync > 0 && (Date.now() - lastSync) < 90000;

    if (isOnline) {
        showConfirm("현재 다른 기기(또는 브라우저)에서 접속 중인 캐릭터입니다.\n기존 연결을 강제로 끊고 접속하시겠습니까?", () => {
            executeLogin(slotIndex, charObj, loadedData);
        });
    } else {
        executeLogin(slotIndex, charObj, loadedData);
    }
};

window.openCreateCharModal = function(slotIndex) {
    currentSlotIndex = slotIndex;
    showPrompt("생성할 캐릭터 이름을 입력하세요:", "리니지마스터", 12, (inputName) => {
        window.pendingCharName = inputName;
        $('main-menu-overlay').style.display = 'none';
        $('char-select-overlay').style.display = 'flex';
    }, true); 
};

window.deleteCharacter = function(slotIndex, charName) {
    showConfirm(`정말 [${charName}] 캐릭터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`, async () => {
        const sb = getSupabaseClient();
        
        const { error } = await sb.from('characters').delete()
            .eq('user_id', currentUser.id)
            .eq('slot_index', slotIndex);
        
        if (error) {
            showAlert("캐릭터 삭제 실패: " + error.message);
        } else {
            localStorage.removeItem('lineage_saved_id');
            showAlert(`${charName} 캐릭터가 영구적으로 삭제되었습니다.`);
            await fetchCharacterList(); 
        }
    });
};

function sanitizeMercenaryData(merc) {
    if (!merc) return null;
    return {
        id: merc.id,
        name: merc.name,
        mercType: merc.mercType,
        level: merc.level || 1,
        hp: merc.hp,
        maxHp: merc.maxHp,
        mp: merc.mp || 0,
        maxMp: merc.maxMp || 50,
        atk: merc.atk,
        def: merc.def,
        speed: merc.speed,
        mercHpPotionCount: merc.mercHpPotionCount || 0,
        mercMpPotionCount: merc.mercMpPotionCount || 0,
        equip: merc.equip ? {
            weapon: merc.equip.weapon ? { ...merc.equip.weapon } : null,
            armor: merc.equip.armor ? { ...merc.equip.armor } : null
        } : { weapon: null, armor: null },
        stance: merc.stance || 'attack',
        inventory: Array.isArray(merc.inventory) ? merc.inventory.map(i => ({ ...i })) : []
    };
}

let sessionCheckInterval = null;
function startSessionCheckTimer() {
    if (sessionCheckInterval) clearInterval(sessionCheckInterval);
    sessionCheckInterval = setInterval(async () => {
        if (!gameStarted || !currentUser) return;
        const sb = getSupabaseClient();
        if (!sb) return;

        try {
            const { data: dbChar } = await sb.from('characters')
                .select('data')
                .eq('user_id', currentUser.id)
                .eq('slot_index', currentSlotIndex)
                .single();

            const dbToken = dbChar?.data?.session_token;
            if (window.mySessionToken && typeof dbToken === 'string' && dbToken.length > 0 && dbToken !== window.mySessionToken) {
                clearInterval(sessionCheckInterval);
                gameStarted = false;
                alert("다른 기기에서 접속하여 기존 연결이 강제 종료됩니다.");
                location.reload();
            }
        } catch(e) {
            console.error("토큰 검사 에러:", e);
        }
    }, 5000);
}

// ==========================================
// [3. 기본 상태 변수 및 오디오 시스템]
// ==========================================
const gameOptions = { volume: 0.025, showDamage: true, showNames: true, minLootGrade: 0 };
let gameStarted = false;
let lastSpellCastTime = 0;
let activeEnchantScrollKey = null;
let isCtrlPressed = false;
let currentShopNpcId = null;
let currentSelectedPet = null;
let lastHotkeyClickTime = {};
let selectedItemForAction = null;
let confirmCallback = null;

let hotkeys = new Array(8).fill(null);
window.hotkeys = hotkeys;

const getInitialPlayer = () => ({
    name: '리니지 마스터', 
    charClass: 'knight', 
    x: 2000, y: 2000, size: 20, angle: 0, 
    hp: 150, maxHp: 150, mp: 10, maxMp: 10, atk: 3, def: 0, level: 1, exp: 0, maxExp: 100, 
    adena: 500000,
    alignment: 0, str: 18, dex: 14, int: 8, 
    
    // ⚔️ [기사 고유 패시브 상태값]
    knightHitStack: 0,        // 누적 피격 카운트 (3회 누적 시 광폭화)
    furyUntil: 0,             // 2배 데미지 버프 지속 만료 시간
    
    equip: { 
        helmet: null, tshirt: null, armor: null, cloak: null, 
        weapon: null, shield: null, gloves: null, boots: null, 
        belt: null, ring1: null, ring2: null 
    },
    inv: [
        { id: 'ring_teleport_init', name: '순간이동 조종 반지', type: 'ring', grade: 2, desc: '착용 시 어디든 자유롭게 순간이동할 수 있는 마법의 반지.' },
        { id: 'potion_init_1', name: '주홍 물약', type: 'potion', count: 500, heal: 60, price: 72 },
        { id: 'scroll_init_1', name: '귀환 주문서', type: 'scroll', count: 10, price: 100 }
    ], 
    magic: [], magicLevels: {}, buffs: {}, currentSpeed: 180, currentAtkDelay: 800,
    target: null, isMoving: false, moveX: undefined, moveY: undefined, lastAttack: 0, lastRegen: 0, autoPotion: false, autoHunt: false, activeSpellSlots: [], map: 'talking_island', totalHpRegen: 0, totalMpRegen: 0, totalDmgReduction: 0, manualOverrideUntil: 0,
    selectedManualSpell: null
});


let player = getInitialPlayer();
let camera = { x: 2000, y: 2000 };
let currentMap = 'talking_island';
const mapSize = 4000;
let entities = [], items = [], particles = [], dmgTexts = [];

window.player = player;
window.currentMap = currentMap;
window.mapSize = mapSize;
window.entities = entities;
window.items = items;
window.particles = particles;
window.dmgTexts = dmgTexts;

let audioCtx = null;
function initAudio() { if(!audioCtx) { const AudioContext = window.AudioContext || window.webkitAudioContext; if(AudioContext) audioCtx = new AudioContext(); } }

function playSound(type, targetEntity = null) {
    try {
        if(!audioCtx || gameOptions.volume <= 0) return;
        const now = audioCtx.currentTime; 
        let vol = gameOptions.volume; 

        const createNoise = (duration) => {
            let bufferSize = audioCtx.sampleRate * duration;
            let buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            let data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            let noise = audioCtx.createBufferSource(); noise.buffer = buffer; return noise;
        };

        if (type === 'swing') {
            let dur = 0.08 + Math.random() * 0.02; let noise = createNoise(dur);
            let filter = audioCtx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.setValueAtTime(1500 + Math.random()*500, now); filter.frequency.exponentialRampToValueAtTime(300, now + dur);
            let gain = audioCtx.createGain(); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(vol * 3.5, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
            noise.connect(filter).connect(gain).connect(audioCtx.destination); noise.start(now);
        } else if (type === 'monster_hit') {
            if (!targetEntity) return;
            let name = targetEntity.name || ''; let p = 0.8 + Math.random() * 0.3; let hitVol = vol * 4.0; 
            let osc1 = audioCtx.createOscillator(); let osc1Gain = audioCtx.createGain();
            osc1.type = 'triangle'; osc1.frequency.setValueAtTime(150 * p, now); osc1.frequency.exponentialRampToValueAtTime(40 * p, now + 0.1);
            osc1Gain.gain.setValueAtTime(hitVol, now); osc1Gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc1.connect(osc1Gain).connect(audioCtx.destination);
            let noise = createNoise(0.2); let filter = audioCtx.createBiquadFilter(); let noiseGain = audioCtx.createGain();
            if (name.includes('해골') || targetEntity.isUndead) { filter.type = 'highpass'; filter.frequency.value = 2500 * p; noiseGain.gain.setValueAtTime(hitVol * 1.5, now); noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15); } 
            else if (name.includes('버그베어') || name.includes('오우거') || name.includes('골렘')) { filter.type = 'lowpass'; filter.frequency.value = 800 * p; osc1.type = 'sine'; osc1.frequency.setValueAtTime(100 * p, now); noiseGain.gain.setValueAtTime(hitVol * 2.0, now); noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2); } 
            else { filter.type = 'bandpass'; filter.frequency.value = 1200 * p; filter.Q.value = 1.0; noiseGain.gain.setValueAtTime(hitVol * 1.2, now); noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); }
            noise.connect(filter).connect(noiseGain).connect(audioCtx.destination); osc1.start(now); osc1.stop(now + 0.2); noise.start(now);
        } else if (type === 'magic_hit') {
            let p = 0.8 + Math.random() * 0.4; let osc = audioCtx.createOscillator(); let noise = createNoise(0.15); let filter = audioCtx.createBiquadFilter(); let masterGain = audioCtx.createGain();
            masterGain.connect(audioCtx.destination); osc.connect(masterGain); noise.connect(filter).connect(masterGain);
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(1500 * p, now); osc.frequency.exponentialRampToValueAtTime(100 * p, now + 0.1);
            filter.type = 'bandpass'; filter.frequency.value = 3000 * p; filter.Q.value = 2.0; masterGain.gain.setValueAtTime(vol * 3.5, now); masterGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now); osc.stop(now + 0.15); noise.start(now);
        } else if (type === 'player_hit') { 
            let noise = createNoise(0.15); let filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 350; 
            let gain = audioCtx.createGain(); gain.connect(audioCtx.destination); gain.gain.setValueAtTime(vol * 5.0, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15); noise.connect(filter).connect(gain); noise.start(now);
        } else {
            let gain = audioCtx.createGain(); gain.connect(audioCtx.destination);
            if (type === 'fireball') { let noise = createNoise(0.5); let filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(800, now); filter.frequency.exponentialRampToValueAtTime(100, now + 0.5); noise.connect(filter).connect(gain); gain.gain.setValueAtTime(vol * 3.5, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5); noise.start(now); }
            else if (type === 'lightning') { const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='sawtooth'; osc.frequency.setValueAtTime(600,now); osc.frequency.exponentialRampToValueAtTime(50,now+0.25); gain.gain.setValueAtTime(vol*2.5,now); gain.gain.exponentialRampToValueAtTime(0.01,now+0.25); osc.start(now); osc.stop(now+0.25); }
            else if (type === 'heal') { const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='sine'; osc.frequency.setValueAtTime(500,now); osc.frequency.linearRampToValueAtTime(1000,now+0.4); gain.gain.setValueAtTime(vol,now); gain.gain.linearRampToValueAtTime(0.01,now+0.5); osc.start(now); osc.stop(now+0.5); }
            else if (type === 'spell' || type === 'drink') { const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='sawtooth'; osc.frequency.setValueAtTime(400,now); osc.frequency.exponentialRampToValueAtTime(150,now+(type==='drink'?0.15:0.3)); gain.gain.setValueAtTime(vol,now); gain.gain.exponentialRampToValueAtTime(0.01,now+0.3); osc.start(now); osc.stop(now+0.3); }
            else if (type === 'click' || type==='buy') { const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='triangle'; osc.frequency.setValueAtTime(900,now); gain.gain.setValueAtTime(vol,now); gain.gain.exponentialRampToValueAtTime(0.01,now+0.05); osc.start(now); osc.stop(now+0.05); }
            else if (type === 'bow') { const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='triangle'; osc.frequency.setValueAtTime(800,now); osc.frequency.exponentialRampToValueAtTime(200,now+0.1); gain.gain.setValueAtTime(vol*2.5,now); gain.gain.exponentialRampToValueAtTime(0.01,now+0.15); osc.start(now); osc.stop(now+0.15); }
else if (type === 'disintegrate') { 
                const osc = audioCtx.createOscillator(); 
                osc.connect(gain); 
                osc.type = 'sine'; // 맑은 종/징 소리를 위한 사인파
                osc.frequency.setValueAtTime(2200, now); 
                osc.frequency.exponentialRampToValueAtTime(300, now + 1.2); 
                gain.gain.setValueAtTime(vol * 5.0, now); 
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2); 
                osc.start(now); osc.stop(now + 1.2); 
            
        }
}
    } catch(e){}
}

window.updateOptions = function() { 
    if($('opt-vol')) {
        let vol = $('opt-vol').value; gameOptions.volume = (vol / 100) * 0.05; 
        gameOptions.showDamage = $('opt-dmg').checked; 
        gameOptions.showNames = $('opt-names').checked; 
        gameOptions.minLootGrade = parseInt($('opt-loot-grade').value);
        if(gameOptions.volume > 0 && gameStarted) playSound('click');
    }
};

window.addEventListener('click', initAudio, {once:true});
window.addEventListener('touchstart', initAudio, {once:true});

// [게임 진입 로직 연동 (데이터 세팅)]
async function executeLogin(slotIndex, charObj, loadedData) {
    try {
        closeAllWindows();
        currentSlotIndex = slotIndex;
        window.mySessionToken = Date.now().toString() + Math.random().toString(36).substring(2);
        loadedData.session_token = window.mySessionToken;
        loadedData.last_sync_time = Date.now();

        const sb = getSupabaseClient();
        if (sb) {
            await sb.from('characters').update({ data: loadedData }).eq('id', charObj.id);
        }

        let freshPlayer = getInitialPlayer();
        if (loadedData.player) {
            deepMerge(freshPlayer, loadedData.player);
        }
        for(let k in player) delete player[k];
        Object.assign(player, freshPlayer);

        if (loadedData.options) {
            Object.assign(gameOptions, loadedData.options);
            if ($('opt-vol')) $('opt-vol').value = Math.floor((gameOptions.volume / 0.05) * 100);
            if ($('opt-dmg')) $('opt-dmg').checked = gameOptions.showDamage;
            if ($('opt-names')) $('opt-names').checked = gameOptions.showNames;
            if ($('opt-loot-grade')) $('opt-loot-grade').value = gameOptions.minLootGrade || 0;
            
         
        }

        window.hotkeys = loadedData.hotkeys || new Array(8).fill(null); hotkeys = window.hotkeys;
        applyStatsPostLoad();

        let targetMap = loadedData.map || player.map || 'silver_knight_town';
        let targetX = player.x || 2000; let targetY = player.y || 2000;
        
        entities.length = 0; 
        for(let m in maps) { 
            if(maps[m].b) { maps[m].b.forEach(b => { let bt = templates.bosses[b.id]; if(bt) entities.push({ ...bt, id: b.id, maxHp: bt.hp, x: b.x, y: b.y, map: m, spawnMap: m, spawnX: b.x, spawnY: b.y, angle: 0, isMoving: false, isBoss: true }); }); } 
        }

        if (loadedData.activeMercenaries) {
            loadedData.activeMercenaries.forEach(m => {
                entities.push({
                    ...m, map: targetMap, x: targetX + (Math.random()*40-20), y: targetY + (Math.random()*40-20),
                    isSummon: true, owner: player, isMercenary: true,
                    color: m.mercType === 'wizard' ? '#88f' : (m.mercType === 'elf' ? '#8f8' : '#ccc')
                });
            });
        }

        changeMap(targetMap, targetX, targetY);
        if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'none'; 
        if($('main-ui')) $('main-ui').style.display = 'block';

        gameStarted = true; updateOptions(); 

        if (typeof update === 'function') {
            requestAnimationFrame(update);
        } else if (typeof window.update === 'function') {
            requestAnimationFrame(window.update);
        } else {
            setTimeout(() => {
                if (typeof window.update === 'function') requestAnimationFrame(window.update);
            }, 100);
        }

        addMessage(`[${player.name}] 캐릭터로 접속했습니다.`, "#5f5");
        startSessionCheckTimer();
        
        if (window.socket) {
            window.socket.emit('player_join', {
                id: currentUser.id,
                name: player.name,
                charClass: player.charClass,
                x: player.x,
                y: player.y,
                map: currentMap
            });
        }

    } catch (err) {
        console.error("게임 진입 중 에러 발생:", err);
        showAlert("게임 진입 중 오류가 발생했습니다: " + err.message);
        loadedData.last_sync_time = 0;
        const sb = getSupabaseClient();
        if (sb) {
            await sb.from('characters').update({ data: loadedData }).eq('id', charObj.id);
        }
    }
}

// ==========================================
// [4. UI 메시지, 스탯 계산, 버프]
// ==========================================
window.addMessage = function(msg, color='#ddd') {
    const chat = $('chat-messages'); if(!chat) return;
    const div = document.createElement('div'); div.style.color = color; div.innerText = msg;
    chat.appendChild(div);
    if (chat.childNodes.length > 50) chat.removeChild(chat.firstChild);
    requestAnimationFrame(() => { if(chat.lastChild) chat.lastChild.scrollIntoView({ behavior: 'smooth', block: 'end' }); });
};

function recalculateStats() {
    if (!player) return;

    let lv = player.level || 1; 

    const CLASS_GROWTH = {
        'knight': { baseHp: 150, baseMp: 10, hpPerLv: 45, mpPerLv: 5 },
        'elf':    { baseHp: 100, baseMp: 30, hpPerLv: 28, mpPerLv: 19 },
        'wizard': { baseHp: 80,  baseMp: 50, hpPerLv: 15, mpPerLv: 45 },
        'royal':  { baseHp: 120, baseMp: 30, hpPerLv: 30, mpPerLv: 10 }
    };

    let growth = CLASS_GROWTH[player.charClass] || CLASS_GROWTH['knight'];

    player.maxHp = growth.baseHp + Math.max(0, lv - 1) * growth.hpPerLv;
    player.maxMp = growth.baseMp + Math.max(0, lv - 1) * growth.mpPerLv;

    let baseExp = 100;
    let scale = Math.pow(1.15, Math.max(0, lv - 1));
    player.maxExp = Math.floor(baseExp * lv * scale);

    const localClassData = {
        'knight': { name: '기사', str: 18, dex: 14, int: 8 },
        'elf':    { name: '요정', str: 11, dex: 18, int: 11 },
        'wizard': { name: '마법사', str: 8, dex: 14, int: 18 },
        'royal':  { name: '군주', str: 14, dex: 14, int: 12 }
    };

    let cData = localClassData[player.charClass] || localClassData['knight'];
    
    player.str = cData.str + Math.floor(lv / 4); 
    player.dex = cData.dex + Math.floor(lv / 4); 
    player.int = cData.int + Math.floor(lv / 4);
    
    let totalDef = 0, totalMr = player.int * 2, totalSp = Math.floor(player.int / 3);
    let meleeBonus = 0, rangedBonus = 0;
    let totalDmgReduction = (player.charClass === 'knight') ? (10 + Math.floor(lv / 3)) : 0;
    let bonusSpeed = 0;
    let totalPotionEffect = 0;

    for (let k in player.equip) {
        let eq = player.equip[k];
        if (eq) {
            player.str += eq.str || 0;
            player.dex += eq.dex || 0;
            player.int += eq.int || 0;
            totalSp += eq.sp || 0;
            if (eq.mr) totalMr += eq.mr;
            if (eq.dmgReduct) totalDmgReduction += eq.dmgReduct; // 💡 신화 방어구 대미지 감소 합산
            if (eq.speed) bonusSpeed += eq.speed;               // 💡 신화 부츠 이동속도 합산
            if (eq.potionEffect) totalPotionEffect += eq.potionEffect; // 💡 투구 물약 회복량 합산

            if (k !== 'weapon') {
                totalDef += (eq.def || 0) + (eq.enchantValue || 0);
                if (eq.mr || eq.name.includes('마법') || eq.name.includes('면갑') || eq.name.includes('반지') || eq.name.includes('망토')) {
                    totalMr += (eq.enchantValue || 0);
                }
            }

            if (eq.magicOptions) {
                eq.magicOptions.forEach(opt => {
                    let val = parseInt(opt.match(/\+(\d+)/)?.[1]) || 0;
                    if (opt.includes('근거리 대미지') || opt.includes('추가 대미지') || opt.includes('속성')) meleeBonus += val;
                    if (opt.includes('원거리 대미지') || opt.includes('속성')) rangedBonus += val;
                    if (opt.includes('SP') || opt.includes('마법 공격력')) totalSp += val;
                    if (opt.includes('MR') || opt.includes('마법 방어력')) totalMr += val;
                    if (opt.includes('대미지 감소')) totalDmgReduction += val;
                });
            }
        }
    }

    player.sp = totalSp;
    player.totalMr = totalMr;
    player.totalDmgReduction = totalDmgReduction;
    player.totalPotionEffect = totalPotionEffect;
    player.currentSpeed = 180 + bonusSpeed; // 💡 신화 장비 이동속도 적용
    
    let wp = player.equip.weapon; 
    let wpAtk = wp ? (wp.atk || 0) + (wp.enchantValue || 0) : 0;
    let enchantBonus = wp ? Math.floor((wp.enchantValue || 0) * 2.0) : 0;
    
    if (wp && wp.isBow) {
        player.atk = Math.max(1, Math.floor((player.dex - 10) * 2.5)) + Math.floor(lv / 4) + wpAtk + enchantBonus + rangedBonus;
    } else {
        player.atk = Math.max(1, Math.floor((player.str - 10) * 3.2)) + Math.floor(lv / 3) + wpAtk + enchantBonus + meleeBonus;
    }

    player.def = Math.max(0, Math.floor((player.dex - 10) / 2)) + totalDef; 
}




let currentMaxHp = 150; let currentMaxMp = 30;

window.renderBuffs = function() {
    const buffListEl = $('buff-list');
    if (!buffListEl || !player || !player.buffs) return;
    
    let now = performance.now();
    let html = '';
    
    for (let key in player.buffs) {
        let b = player.buffs[key];
        if (b.expire > now) {
            let timeLeft = Math.ceil((b.expire - now) / 1000);
            let pct = Math.max(0, Math.min(100, ((b.expire - now) / b.maxDuration) * 100));
            
            html += `
                <div class="buff-wrap" style="
                    position: relative;
                    width: 38px; 
                    height: 38px; 
                    background: conic-gradient(#fd0 ${pct}%, #222 ${pct}% 100%); 
                    padding: 2px; 
                    border-radius: 4px; 
                    display: inline-flex; 
                    align-items: center; 
                    justify-content: center;
                    box-shadow: 0 0 4px rgba(0,0,0,0.5);
                    flex-shrink: 0;
                    margin-right: 4px;
                " title="${key} (${timeLeft}초 남음)">
                    <div style="
                        width: 34px; 
                        height: 34px; 
                        background: #1a1a24; 
                        border-radius: 3px; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        font-size: 18px;
                    ">${b.icon || '✨'}</div>
                </div>`;
        } else {
            delete player.buffs[key];
        }
    }
    buffListEl.innerHTML = html;
};


window.applyBuff = function(name, duration, icon, type, val, target = player) { 
    let now = performance.now(); 
    let keyName = name.includes('가속') || name.includes('초록') ? '가속(헤이스트)' : name; 
    target.buffs = target.buffs || {};
    
    if(target.buffs[keyName]) { 
        target.buffs[keyName].expire += duration; 
        target.buffs[keyName].maxDuration = target.buffs[keyName].expire - now; 
        addMessage(`[${target.name} - ${keyName}] 지속시간 누적!`, '#5f5'); 
    } 
    else { 
        target.buffs[keyName] = { expire: now + duration, maxDuration: duration, icon: icon, type: type, val: val }; 
        addMessage(`[${target.name} - ${keyName}] 버프 적용됨`, '#5f5'); 
    } 
    updateUI(); 
};

window.handlePlayerDeath = function() {
    if (!player || player.isDead) return;
    
    player.isDead = true;
    player.hp = 0;
    player.autoHunt = false;
    player.autoPotion = false;
    player.isMoving = false;
    player.target = null;
    updateUI();

    addMessage("💀 사망하셨습니다... 3초 후 안전지대에서 부활합니다.", "#f55");
    setTimeout(() => {
        window.respawnPlayer();
    }, 3000);
};

// ui.js의 updateUI 함수 전체 덮어쓰기
// ui_4.js - updateUI 함수 전체 덮어쓰기
function updateUI() {
    if (player && player.hp <= 0 && !player.isDead && gameStarted) {
        handlePlayerDeath();
        return;
    }
    
    // 💡 [핵심 패치 1] 장비 탈착 시 스탯(SP 등) 즉시 최신화 강제 호출
    recalculateStats();

    let totalDef = player.def; 
    let totalAtk = player.atk; 
    let totalMr = player.totalMr || (player.int * 2); 

    let totalHpBonus = 0; 
    let totalMpBonus = 0; 
    let totalHpRegen = 0; 
    let totalMpRegen = 0; 
    // 💡 [핵심 패치 2] 기사 패시브(대미지 감소)가 0으로 초기화되지 않도록 연동
    let totalDmgReduction = player.totalDmgReduction || 0; 
    
    for (let k in player.equip) {
        if(player.equip[k]) {
            let eq = player.equip[k]; 
            
            if(k !== 'weapon') {
                totalDef += (eq.def || 0) + (eq.enchantValue || 0);
                if (eq.mr || eq.name.includes('마법') || eq.name.includes('면갑') || eq.name.includes('반지')) {
                    totalMr += (eq.enchantValue || 0);
                }
            }

            if(eq.hpBonus) totalHpBonus += eq.hpBonus; 
            if(eq.mpBonus) totalMpBonus += eq.mpBonus;
            if(eq.hpRegen) totalHpRegen += eq.hpRegen; 
            if(eq.mpRegen) totalMpRegen += eq.mpRegen;
            
      if(eq.magicOptions) { 
                eq.magicOptions.forEach(opt => { 
                    let val = parseInt(opt.match(/\+(\d+)/)?.[1]) || 0; 
                    
                    // 💡 [수정] [생명]과 [마력]의 20배/10배 중복 증폭 코드를 삭제 (이미 eq.hpBonus에 합산됨)
                    if(opt.includes('추가 방어력') || opt.includes('[보호]')) totalDef += val; 
                    if(opt.includes('마법 방어력')) totalMr += val; 
                    if(opt.includes('HP 회복률')) totalHpRegen += val; 
                    if(opt.includes('MP 회복률')) totalMpRegen += val; 
                    if(opt.includes('[재생]')) { totalHpRegen += val; totalMpRegen += val; } 
                    if(opt.includes('대미지 감소')) totalDmgReduction += val; 
                }); 
            }
        }
    }
    
    if (player.buffs['용기물약']) totalAtk += 3;
    player.totalHpRegen = totalHpRegen; player.totalMpRegen = totalMpRegen; player.totalDmgReduction = totalDmgReduction;
    player.totalMr = totalMr; 
    if (player.buffs['실드']) totalDef += player.buffs['실드'].val;
    if (player.buffs['어드밴스 스피릿']) { totalHpBonus += player.buffs['어드밴스 스피릿'].val; totalMpBonus += player.buffs['어드밴스 스피릿'].val; }
    if (player.buffs['이뮨 투 함']) player.totalDmgReduction += player.buffs['이뮨 투 함'].val;

    currentMaxHp = player.maxHp + totalHpBonus; currentMaxMp = player.maxMp + totalMpBonus; 
    if(player.hp > currentMaxHp) player.hp = currentMaxHp; if(player.mp > currentMaxMp) player.mp = currentMaxMp;

    if($('st-lv')) $('st-lv').innerText = player.level; 
    if($('st-class')) $('st-class').innerText = classData[player.charClass] ? classData[player.charClass].name : '기사'; 
    if($('st-stats')) $('st-stats').innerText = `S:${player.str} D:${player.dex} I:${player.int}`;
    if($('st-ac')) {
        $('st-ac').innerText = `-${totalDef} / ${totalMr}`; 
    }
    if($('st-atk')) {
        $('st-atk').innerText = `${totalAtk} / ${player.sp || 0}`;
        $('st-atk').style.color = '#aaf'; 
    }
    if($('st-adena')) $('st-adena').innerText = player.adena.toLocaleString(); 
    
    let hpPercent = Math.max(0, Math.min(100, (player.hp / currentMaxHp) * 100));
    let mpPercent = Math.max(0, Math.min(100, (player.mp / currentMaxMp) * 100));
    let expPercentVal = Math.max(0, Math.min(100, (player.exp / player.maxExp) * 100));

    if ($('hp-bar')) $('hp-bar').style.width = hpPercent + '%';
    if ($('mp-bar')) $('mp-bar').style.width = mpPercent + '%';
    if ($('exp-bar')) $('exp-bar').style.width = expPercentVal + '%';

    if ($('hp-text')) $('hp-text').innerText = `${Math.floor(player.hp)} / ${currentMaxHp}`;
    if ($('mp-text')) $('mp-text').innerText = `${Math.floor(player.mp)} / ${currentMaxMp}`;
    if ($('exp-text')) $('exp-text').innerText = `${expPercentVal.toFixed(2)}%`;

    if($('btn-auto')) { $('btn-auto').className = player.autoPotion ? 'toggle-btn active' : 'toggle-btn'; $('btn-auto').innerText = `물약 ${player.autoPotion ? 'ON' : 'OFF'}`; }
    if($('btn-auto-hunt')) { $('btn-auto-hunt').className = player.autoHunt ? 'toggle-btn active' : 'toggle-btn'; $('btn-auto-hunt').innerText = `사냥 ${player.autoHunt ? 'ON' : 'OFF'}`; }
    
    renderHotkeys(); 
    renderBuffs();
    if($('win-inv') && $('win-inv').style.display === 'flex') renderInventory();
}


let windowZIndex = 2000;
window.bringToFront = function(id) {
    let el = document.getElementById(id);
    if (el) { windowZIndex += 10; el.style.setProperty('z-index', windowZIndex, 'important'); }
    let transferWin = document.getElementById('win-transfer');
    if (transferWin) transferWin.style.setProperty('z-index', windowZIndex + 10000, 'important');
};

window.autoCenterWindow = function(id, forceCenter = true) {
    const el = document.getElementById(id);
    if (!el) return;

    // 1. 숨겨져 있는 창일 경우 일시적으로 표시하여 실제 크기(offsetWidth, offsetHeight)를 정확히 측정
    let wasHidden = el.style.display === 'none';
    if (wasHidden) { 
        el.style.visibility = 'hidden'; 
        el.style.display = 'flex'; 
    }

    // 2. 💡 [핵심] 현재 화면 사이즈(window.innerWidth, window.innerHeight)를 실시간 체크하여 정중앙 좌표 계산
    let cx = Math.max(0, (window.innerWidth - el.offsetWidth) / 2);
    let cy = Math.max(0, (window.innerHeight - el.offsetHeight) / 2);
    
    // 3. 계산된 정중앙 좌표를 강제로 적용
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.setProperty('transform', 'none', 'important'); // 고정 변환 해제

    // 4. 상태 복원
    if (wasHidden) { 
        el.style.display = 'none'; 
        el.style.visibility = 'visible'; 
    }
};

window.toggleWindow = function(id) { 
    playSound('click'); const el = $(id); if (!el) return;
    
    if (el.style.display === 'flex' || el.style.display === 'block') { 
        el.style.display = 'none'; hideTooltip(); 
    } else { 
        if(id === 'win-shop') el.style.display = 'flex'; 
        else el.style.display = 'flex'; 
        
        // 창을 열 때 정보 갱신 후 화면 중앙으로 강제 이동
        if(id === 'win-inv') { switchInvTab('bag'); renderInventory(); }
        if(id === 'win-magic') renderMagicBook(); 
        
        autoCenterWindow(id, true); // 무조건 중앙에 띄우기
        bringToFront(id); // 무조건 맨 앞으로
    } 
};

let dragEl = null, dragOffsetX = 0, dragOffsetY = 0; 
window.startDrag = function(e, id) { 
    dragEl = $(id); 
    if(!dragEl) return;
    bringToFront(id);
    if (dragEl.style.transform && dragEl.style.transform !== 'none') {
        let rect = dragEl.getBoundingClientRect();
        dragEl.style.setProperty('transform', 'none', 'important');
        dragEl.style.left = rect.left + 'px';
        dragEl.style.top = rect.top + 'px';
    }
    let rect = dragEl.getBoundingClientRect(); 
    let cx = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX; 
    let cy = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY; 
    dragOffsetX = cx - rect.left; dragOffsetY = cy - rect.top; 
    document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', stopDrag); 
    document.addEventListener('touchmove', onDrag, {passive: false}); document.addEventListener('touchend', stopDrag); 
};


window.closeAllWindows = function() { 
    ['win-inv', 'win-magic', 'win-option', 'win-shop', 'win-pet', 'win-mercenary', 'save-modal', 'confirm-modal', 'item-action-modal', 'teleport-modal', 'win-party', 'win-transfer'].forEach(id => { if($(id)) $(id).style.display = 'none'; }); 
    hideTooltip(); 
};

// ui.js -> toggleAutoHunt 함수 교체[cite: 7]
window.toggleAutoHunt = function() {
    playSound('click');
    if (!player.autoHunt && isInSafeZone(currentMap, player.x, player.y)) {
        addMessage("안전지대에서는 자동사냥을 켤 수 없습니다.", '#f55');
        return;
    }
    
    player.autoHunt = !player.autoHunt;
    
    if (player.autoHunt) {
        addMessage("자동 사냥 모드가 활성화되었습니다.", '#5f5');
    } else {
        // 💡 [수정] player.target = null 제거! 타겟은 고정 유지하고 자동 이동만 정지[cite: 7]
        player.isMoving = false;
        player.moveX = undefined;
        player.moveY = undefined;
        addMessage("수동 조작 모드 (타겟 유지 / 자유 무빙 가능)", '#aaa');
    }
    updateUI();
};

window.toggleAutoPotion = function() {
    playSound('click');
    player.autoPotion = !player.autoPotion;
    
    if (player.autoPotion) {
        addMessage("자동 물약 복용이 켜졌습니다 (HP 50% 이하 시 복용).", '#5f5');
    } else {
        addMessage("자동 물약 복용이 꺼졌습니다.", '#aaa');
    }
    updateUI();
};

window.respawnPlayer = function() {
    let townMaps = ['talking_island', 'gludin', 'silver_knight_town', 'windawood', 'giran'];
    let targetMap = townMaps.includes(currentMap) ? currentMap : 'silver_knight_town';
    let targetX = 2000, targetY = 2000;
    
    if (maps[targetMap] && maps[targetMap].safeZones && maps[targetMap].safeZones.length > 0) {
        targetX = maps[targetMap].safeZones[0].x;
        targetY = maps[targetMap].safeZones[0].y;
    }
    
    player.hp = currentMaxHp;
    player.mp = currentMaxMp;
    player.isDead = false;
    
    changeMap(targetMap, targetX, targetY);
    addMessage("마을 안전지대에서 부활하였습니다.", "#5f5");

    // 💡 [핵심] 부활 즉시 서버에 살아난 체력과 위치를 전송하여 몬스터 AI 멈춤 현상 해결
    if (window.socket && currentUser) {
        window.socket.emit('player_update', {
            name: player.name,
            charClass: player.charClass,
            x: player.x,
            y: player.y,
            hp: player.hp,
            maxHp: currentMaxHp,
            map: currentMap,
            equip: player.equip
        });
    }

    updateUI();
};
// ==========================================
// [5. 툴팁 & 단축키]
// ==========================================
function getItemDetailsHTML(it, isEq) {
    let dName = it.isEnchantScroll ? `[${it.enchantType}] ${it.name}` : (it.enchantValue && isEq ? `+${it.enchantValue} ${it.name}` : it.name);
    let gIdx = it.grade || 0; 
    let html = `<b class="tooltip-title grade-${gIdx}">${dName}</b><span style="font-size:12px; color:#aaa;">[${gradeNames[gIdx]}]</span><br>`; 
    
    // ★ [추가] 마법서(book)일 경우 배우기 위한 요구 레벨 표시
    if (it.type === 'book') {
        let reqLv = (it.grade || 0) * 15 + 1;
        html += `<span style="color:#fd0; font-weight:bold;">요구 레벨: Lv.${reqLv} 이상</span><br>`;
    }

    let mrBonus = (it.type !== 'weapon' && it.enchantValue > 0) ? `<br><span style="color:#5cf;">마법 방어력(MR): +${it.enchantValue} (강화 보너스)</span>` : '';

    if(!isEq && it.type && !['potion','scroll', 'book'].includes(it.type)) { 
        let cur = player.equip[it.type]; if(it.type==='ring') cur = player.equip.ring1; let diff = 0; 
        if(it.type === 'weapon') { 
            diff = it.atk - (cur ? cur.atk + (cur.enchantValue||0) : 0); 
            html += `공격력: ${it.atk} ${diff>0?`<span class="compare-up">(▲${diff})</span>`:diff<0?`<span class="compare-down">(▼${-diff})</span>`:''}<br>`; 
        } 
        else { 
            diff = it.def - (cur ? cur.def + (cur.enchantValue||0) : 0); 
            html += `방어력: ${it.def} ${diff>0?`<span class="compare-up">(▲${diff})</span>`:diff<0?`<span class="compare-down">(▼${-diff})</span>`:''}${mrBonus}<br>`; 
        } 
    } else { 
        if(it.atk) html += `공격력: ${it.atk}<br>`; 
        if(it.def) html += `방어력: ${it.def}${mrBonus}<br>`; 
    }
    
    if(it.skill) html += `<div class="tooltip-magic">발동: ${it.skill}</div>`; 
    if(it.desc) html += `<div class="tooltip-desc">${it.desc}</div>`; 
   
    if(it.magicOptions && it.magicOptions.length > 0) { html += `<div style="margin-top:5px; border-top:1px dashed #555; padding-top:5px;">`; it.magicOptions.forEach(opt => { html += `<div class="tooltip-bonus">✨ ${opt}</div>`; }); html += `</div>`; } 
    
    if (isEq && it.type && !['potion','scroll','book'].includes(it.type)) {
        let best = null;
        player.inv.forEach(invIt => {
            if(invIt.type === it.type) {
                if(!best) best = invIt;
                else {
                    let invVal = (invIt.atk||0) + (invIt.def||0) + (invIt.enchantValue||0);
                    let bestVal = (best.atk||0) + (best.def||0) + (best.enchantValue||0);
                    if(invVal > bestVal) best = invIt;
                }
            }
        });
        if(best) {
            let myVal = (it.atk||0) + (it.def||0) + (it.enchantValue||0);
            let bestVal = (best.atk||0) + (best.def||0) + (best.enchantValue||0);
            let diff = bestVal - myVal;
            if(diff > 0) html += `<div style="color:#f55; font-size:12px; margin-top:6px; font-weight:bold; border-top:1px dashed #555; padding-top:5px;">⚠️ 가방에 더 좋은 장비 있음 (수치 ▲${diff})</div>`;
        }
    }

    let extra = getExtraDesc(it.name); if(extra) html += `<div class="tooltip-desc" style="color:#ada;">${extra}</div>`;
    if (it.type === 'book' && it.magicName && magicDb[it.magicName] && magicDb[it.magicName].desc) { html += `<div class="tooltip-desc" style="color:#aaf; margin-top:6px; border-top:1px dashed #555; padding-top:5px;">${magicDb[it.magicName].desc}</div>`; }
    return html;
}

window.showTooltip = function(e, dataStr, isEq) { let it = JSON.parse(decodeURIComponent(dataStr)); let t = $('tooltip'); t.innerHTML = getItemDetailsHTML(it, isEq); t.style.display = 'block'; positionTooltip(e, t); };
window.showHotkeyTooltip = function(e, idx) { if (window.innerWidth < 768 || (e.type && e.type.includes('touch'))) return; const hk = hotkeys[idx]; if(!hk) return; let t = $('tooltip'); let html = ''; if(hk.type === 'item') { html = `<b class="tooltip-title" style="margin:0; font-size:13px;">${hk.id} <span style="font-size:11px; color:#aaa;">[F${idx+5}]</span></b>`; } else if (hk.type === 'magic') { html = `<b class="tooltip-title" style="color:#aaf; margin:0; font-size:13px;">${hk.id} <span style="font-size:11px; color:#aaa;">[F${idx+5}]</span></b>`; } t.innerHTML = html; t.style.display = 'block'; positionTooltip(e, t); };
function positionTooltip(e, t) { let x = (e.clientX || (e.touches && e.touches[0].clientX)) + 15; let y = (e.clientY || (e.touches && e.touches[0].clientY)) + 15; if(x + t.offsetWidth > window.innerWidth) x = window.innerWidth - t.offsetWidth - 10; if(y + t.offsetHeight > window.innerHeight) y = window.innerHeight - t.offsetHeight - 10; t.style.left = x + 'px'; t.style.top = y + 'px'; }
window.hideTooltip = function() { if($('tooltip')) $('tooltip').style.display = 'none'; };

function initHotkeyUI() {
    const hotkeysContainer = $('hotkeys'); if(!hotkeysContainer) return; let html = '';
    for(let i = 0; i < 8; i++) {
        html += `<div class="hotkey-slot" id="hk-${i}" onclick="useHotkey(${i})" ondragover="allowDrop(event)" ondrop="dropHotkey(event, ${i})" onmouseenter="showHotkeyTooltip(event, ${i})" onmouseleave="hideTooltip()"><span class="hk-label">F${i + 5}</span><div class="hk-icon" id="hk-ic-${i}"></div><span class="hk-count" id="hk-cnt-${i}"></span><div class="cooldown-overlay" id="hk-cd-${i}" style="height:0%;"></div></div>`;
    }
    hotkeysContainer.innerHTML = html;
}

function renderHotkeys() {
    let now = performance.now();
    for(let i=0; i<8; i++) {
        const slot = $(`hk-${i}`); const icon = $(`hk-ic-${i}`); const cnt = $(`hk-cnt-${i}`); const cdOverlay = $(`hk-cd-${i}`);
        if (!slot) continue; slot.className = 'hotkey-slot'; 
        
        let isActiveAuto = player.activeSpellSlots && player.activeSpellSlots.includes(i);
        let isSelectedManual = hotkeys[i] && hotkeys[i].type === 'magic' && player.selectedManualSpell === hotkeys[i].id;

        if (isActiveAuto) {
            slot.classList.add('active-spell');
            slot.style.border = '2px solid #f33'; 
            slot.style.boxShadow = '0 0 10px #f33 inset'; 
        } else if (isSelectedManual) {
            slot.style.border = '2px solid #5cf'; 
            slot.style.boxShadow = '0 0 10px #5cf inset';
        } else { 
            slot.style.border = ''; 
            slot.style.boxShadow = ''; 
        }
        
        let hk = hotkeys[i];
        if(hk && hk.id) {
            if(hk.type === 'magic') { 
                icon.innerHTML = magicDb[hk.id] ? magicDb[hk.id].icon : '✨'; cnt.innerText = ''; 
                let mData = magicDb[hk.id];
                if (mData && lastSpellCastTime > 0 && now - lastSpellCastTime < mData.cd) { cdOverlay.style.height = `${100 - ((now - lastSpellCastTime) / mData.cd) * 100}%`; } else { cdOverlay.style.height = '0%'; }
            } else {
                let hName = hk.id; 
                icon.innerHTML = getItemIcon({name: hName, type: hk.itemType || 'potion'});
                let count = 0; 
                player.inv.forEach(it => { if(it && it.name === hName) count += (it.count || 1); }); 
                if(typeof hName === 'string' && hName.includes('반지')) {
                    count = (player.equip.ring1?.name === hName || player.equip.ring2?.name === hName) ? 1 : count; 
                }
                cnt.innerText = count > 0 ? count : ''; 
                if(count === 0) icon.innerHTML = ''; 
                cdOverlay.style.height = '0%';
            }
        } else { 
            icon.innerHTML = ''; 
            cnt.innerText = ''; 
            cdOverlay.style.height = '0%'; 
        }
    }
}

window.allowDrop = function(e) { e.preventDefault(); };
window.startDragMagic = function(e, mName) { e.dataTransfer.setData('text/plain', JSON.stringify({type:'magic', id:mName})); };
window.startDragItem = function(e, iName, iType) { if(iType === 'ring' || iName.includes('반지')) e.dataTransfer.setData('text/plain', JSON.stringify({type:'item', id:iName, itemType:'ring'})); else e.dataTransfer.setData('text/plain', JSON.stringify({type:'item', id:iName})); };
window.dropHotkey = function(e, idx) { e.preventDefault(); try { hotkeys[idx] = JSON.parse(e.dataTransfer.getData('text/plain')); addMessage(`단축키 등록됨`, '#5f5'); playSound('click'); updateUI(); } catch(err) {} };

window.useHotkey = function(idx) { 
    const hk = hotkeys[idx]; if(!hk) return; 
    let now = performance.now(); 
    let isDoubleClick = lastHotkeyClickTime[idx] && (now - lastHotkeyClickTime[idx] < 350); 
    lastHotkeyClickTime[idx] = now;

    if(hk.type === 'item') { 
        if(hk.id === '순간이동 조종 반지' || hk.name === '순간이동 조종 반지') { 
            if (typeof teleportPrompt === 'function') {
                teleportPrompt(); 
            } else {
                addMessage("텔레포트 창을 불러올 수 없습니다.", '#f55');
            }
        } 
        else { 
            useItemByName(hk.id); 
        } 
    } 
    else if(hk.type === 'magic') { 
        let mData = magicDb[hk.id]; if (!mData) return;
        
        if (isDoubleClick) {
            player.activeSpellSlots = player.activeSpellSlots || []; 
            let slotIdx = player.activeSpellSlots.indexOf(idx);
            
            if(slotIdx > -1) { 
                player.activeSpellSlots.splice(slotIdx, 1); 
                addMessage(`[${hk.id}] 자동사냥 마법 세팅 해제`, '#aaa'); 
            } 
            else { 
                if(player.activeSpellSlots.length >= 8) player.activeSpellSlots.shift(); 
                player.activeSpellSlots.push(idx); 
                addMessage(`[${hk.id}] 자동사냥 마법 세팅 완료`, '#5f5'); 
            }
            player.selectedManualSpell = null;
        } else {
            if (mData.type === 'buff' || mData.heal) {
                castBuff(hk.id); 
                player.selectedManualSpell = null;
            } else {
                if (player.selectedManualSpell === hk.id) { 
                    player.selectedManualSpell = null; 
                    addMessage(`[${hk.id}] 수동 마법 선택 취소`, '#aaa'); 
                } 
                else { 
                    player.selectedManualSpell = hk.id; 
                    addMessage(`[${hk.id}] 준비 완료! 몬스터를 클릭(터치)하세요.`, '#5cf'); 
                }
            }
        }
    } 
    updateUI(); 
};

window.addEventListener('keydown', (e) => { if(e.key === 'Control') isCtrlPressed = true; if(e.key.startsWith('F')) { let fNum = parseInt(e.key.substring(1)); if(fNum >= 5 && fNum <= 12) { e.preventDefault(); useHotkey(fNum - 5); } } });
window.addEventListener('keyup', (e) => { if(e.key === 'Control') isCtrlPressed = false; });
window.addEventListener('blur', () => { isCtrlPressed = false; });


window.currentInvTab = 'bag';

window.switchInvTab = function(tabName) {
    if (typeof playSound === 'function') playSound('click');
    window.currentInvTab = tabName;
    
    let tabBag = $('tab-btn-bag');
    let tabEquip = $('tab-btn-equip');
    let contentBag = $('inv-tab-bag');
    let contentEquip = $('inv-tab-equip');

    // ★ 요소가 존재할 때만 안전하게 제어하여 null 에러 원천 차단
    if (tabBag) tabBag.className = tabName === 'bag' ? 'inv-tab active' : 'inv-tab';
    if (tabEquip) tabEquip.className = tabName === 'equip' ? 'inv-tab active' : 'inv-tab';
    if (contentBag) contentBag.style.display = tabName === 'bag' ? 'block' : 'none';
    if (contentEquip) contentEquip.style.display = tabName === 'equip' ? 'block' : 'none';
    
    renderInventory();
};

function renderInventory() {
    // 1. 인벤토리 및 장착 아이템 목록 취합
    const displayList = [];
    player.inv.forEach((it, idx) => {
        displayList.push({ ...it, isEquipped: false, originalIndex: idx });
    });
    for (let k in player.equip) {
        if (player.equip[k]) {
            displayList.push({ ...player.equip[k], isEquipped: true, equipSlot: k });
        }
    }

    // 2. 아이템 정렬 (포션 -> 장비 -> 스킬북 -> 주문서 순 / 장착 여부 / 등급 순)
    const typeOrder = {
        'potion': 1,
        'weapon': 3, 'armor': 3, 'helmet': 3, 'shield': 3, 'tshirt': 3,
        'cloak': 3, 'gloves': 3, 'boots': 3, 'belt': 3, 'ring': 3, 'ring1': 3, 'ring2': 3,
        'book': 4,
        'scroll': 5
    };

    displayList.sort((a, b) => {
        const orderA = typeOrder[a.type] || 99;
        const orderB = typeOrder[b.type] || 99;

        if (orderA === 1 && orderB !== 1) return -1;
        if (orderB === 1 && orderA !== 1) return 1;
        if (a.isEquipped && !b.isEquipped) return -1;
        if (!a.isEquipped && b.isEquipped) return 1;
        if (orderA !== orderB) return orderA - orderB;
        return (b.grade || 0) - (a.grade || 0);
    });

    if ($('inv-title')) {
        $('inv-title').innerText = `인벤토리 (${player.inv.length}/100)`;
    }

    // 3. 중복 아이템 스택(수량) 집계
    const counts = new Map();
    displayList.forEach((it) => {
        const key = getStackKey(it);
        if (!counts.has(key)) {
            counts.set(key, {
                item: it,
                count: 0,
                rawKey: key,
                isEquipped: it.isEquipped,
                equipSlot: it.equipSlot
            });
        }
        counts.get(key).count += (it.count || 1);
    });

    // 4. 인벤토리 슬롯 DOM 렌더링
    const invListEl = $('inv-list');
    if (invListEl) {
        invListEl.innerHTML = '';

        if (counts.size === 0) {
            invListEl.innerHTML = '<div style="color:#666;text-align:center;padding:10px; grid-column: 1 / -1;">가방이 비었습니다.</div>';
        } else {
            const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

            counts.forEach((c) => {
                const dStr = encodeURIComponent(JSON.stringify(c.item)).replace(/'/g, "%27");
                const itemElement = document.createElement('div');
                itemElement.className = `inv-slot grade-${c.item.grade || 0}`;
                itemElement.draggable = !isTouchDevice; // 모바일 롱터치 가로챔 방지

                // 터치 / 클릭 제어 변수
                let touchTimer = null;
                let isLongTouch = false;
                let clickCount = 0;
                let clickTimer = null;

                // [PC] 툴팁 표시
                itemElement.addEventListener('mouseenter', (e) => {
                    if (!isTouchDevice && !window.activeEnchantScrollKey) {
                        showTooltip(e, dStr, c.isEquipped);
                    }
                });
                itemElement.addEventListener('mouseleave', hideTooltip);

                // [PC] 우클릭 설정창 오픈
                itemElement.addEventListener('mousedown', (e) => {
                    if (e.button === 2) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!c.isEquipped) {
                            openItemActionModal(e, c.rawKey, c.item.name, c.count, dStr);
                            bringToFront('item-action-modal');
                            autoCenterWindow('item-action-modal', true);
                        }
                    }
                });
                itemElement.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });

                // [모바일] 터치 이벤트 (원터치 툴팁 & 0.4초 롱터치 설정창)
                itemElement.addEventListener('touchstart', (e) => {
                    isLongTouch = false;
                    if (e.touches && e.touches.length > 1) return;

                    // 1) 즉시 툴팁 표시
                    if (!c.isEquipped) {
                        showTooltip(e, dStr, false);
                    }

                    // 2) 0.4초 롱터치 타이머 시작 (모달 오픈)
                    touchTimer = setTimeout(() => {
                        isLongTouch = true;
                        if (!c.isEquipped) {
                            openItemActionModal(e, c.rawKey, c.item.name, c.count, dStr);
                            bringToFront('item-action-modal');
                            autoCenterWindow('item-action-modal', true);
                        }
                    }, 400);
                }, { passive: true });

                itemElement.addEventListener('touchmove', () => {
                    if (touchTimer) clearTimeout(touchTimer);
                }, { passive: true });

                itemElement.addEventListener('touchcancel', () => {
                    if (touchTimer) clearTimeout(touchTimer);
                }, { passive: true });

                itemElement.addEventListener('touchend', (e) => {
                    if (touchTimer) clearTimeout(touchTimer);
                    // 롱터치 모달이 열린 경우 클릭 이벤트 트리거 방지
                    if (isLongTouch && e.cancelable) {
                        e.preventDefault();
                    }
                }, { passive: false });

                // [공통] 클릭 이벤트 (인챈트 적용 및 더블 클릭 아이템 사용/장착)
                itemElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isLongTouch) return;
                    hideTooltip();

                    // 인챈트 스크롤 사용 중인 경우 즉시 적용
                    if (window.activeEnchantScrollKey) {
                        if (!c.isEquipped) {
                            useItem(c.rawKey);
                        }
                        return;
                    }

                    // 더블 클릭(터치) 판정
                    clickCount++;
                    if (clickCount === 1) {
                        clickTimer = setTimeout(() => {
                            clickCount = 0;
                        }, 300);
                    } else if (clickCount === 2) {
                        clearTimeout(clickTimer);
                        clickCount = 0;
                        if (c.isEquipped) {
                            unequip(c.equipSlot);
                        } else {
                            useItem(c.rawKey);
                        }
                    }
                });

                // 슬롯 내부 HTML 구성
                const eMarkHtml = c.isEquipped ? `<div class="e-mark">E</div>` : '';
                const qtyHtml = c.count > 1 ? `<span class="inv-qty">${c.count}</span>` : '';
                itemElement.innerHTML = `${eMarkHtml}<div class="inv-icon">${getItemIcon(c.item)}</div>${qtyHtml}`;

                invListEl.appendChild(itemElement);
            });
        }
    }

    // 5. 장착 장비 그리드 렌더링
    let eqHTML = '';
    const slots = [
        { k: 'helmet', n: '투구', c: 'ce-helm' },
        { k: 'tshirt', n: '티셔츠', c: 'ce-tshirt' },
        { k: 'armor', n: '갑옷', c: 'ce-armor' },
        { k: 'cloak', n: '망토', c: 'ce-cloak' },
        { k: 'weapon', n: '무기', c: 'ce-weapon' },
        { k: 'shield', n: '방패', c: 'ce-shield' },
        { k: 'belt', n: '벨트', c: 'ce-belt' },
        { k: 'gloves', n: '장갑', c: 'ce-gloves' },
        { k: 'boots', n: '신발', c: 'ce-boots' },
        { k: 'ring1', n: '반지1', c: 'ce-ring1' },
        { k: 'ring2', n: '반지2', c: 'ce-ring2' }
    ];

    slots.forEach(s => {
        const it = player.equip[s.k];
        const dropAttr = `ondragover="allowDrop(event)" ondrop="dropEquipment(event, '${s.k}')"`;

        if (it) {
            const dStr = encodeURIComponent(JSON.stringify(it)).replace(/'/g, "%27");
            const name = it.enchantValue ? `+${it.enchantValue}` : '';
            const enchantBadge = name ? `<span style="position:absolute; top:2px; right:2px; font-size:10px; font-weight:bold; color:#fff;">${name}</span>` : '';

            eqHTML += `<div class="ce-slot ${s.c} grade-${it.grade || 0}" ${dropAttr} onclick="unequip('${s.k}'); hideTooltip();" onmouseenter="showTooltip(event, '${dStr}', true)" onmouseleave="hideTooltip()">${getItemIcon(it)}${enchantBadge}</div>`;
        } else {
            eqHTML += `<div class="ce-slot ${s.c}" ${dropAttr}><span class="ce-label">${s.n}</span></div>`;
        }
    });

    if ($('equip-grid')) {
        $('equip-grid').innerHTML = eqHTML;
    }
}

function getMagicLevelTier(mName) {
    let m = magicDb[mName];
    if (!m) return 1;
    if (m.mp >= 35 || m.dmg >= 200) return 4; 
    if (m.mp >= 18 || m.dmg >= 80) return 3;  
    if (m.mp >= 8 || m.dmg >= 30) return 2;   
    return 1;                                  
}

window.currentMagicTab = 'all';

window.setMagicTab = function(tab) {
    playSound('click');
    window.currentMagicTab = tab;
    renderMagicBook();
};

window.renderMagicBook = function() {
    let listEl = $('magic-list');
    if (!listEl) return;

    // 마법책 창 너비 및 높이 자동 보정 (기존 250px -> 340px)
    let winMagic = $('win-magic');
    if (winMagic) {
        winMagic.style.width = '340px';
        winMagic.style.maxWidth = '95vw';
    }

    player.magicLevels = player.magicLevels || {};
    let html = '';

    // 상단 탭 버튼 (세로로 늘어나지 않도록 1줄 고정 정렬)
    html += `
    <div style="display:flex; flex-direction:row; gap:3px; margin-bottom:8px; background:#111116; padding:3px; border-radius:4px; border:1px solid #33333d; width:100%; box-sizing:border-box;">
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab==='all'?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab('all')">전체</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===1?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(1)">1단계</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===2?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(2)">2단계</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===3?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(3)">3단계</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===4?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(4)">4단계</button>
    </div>
    <div style="max-height:280px; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:4px; padding-right:2px;">`;

    let sortedMagic = [...player.magic].sort((a, b) => getMagicLevelTier(a) - getMagicLevelTier(b) || a.localeCompare(b));
    let filteredMagic = sortedMagic.filter(m => window.currentMagicTab === 'all' || getMagicLevelTier(m) === window.currentMagicTab);
    let currentTier = 0;

    if (filteredMagic.length === 0) {
        html += `<div style="color:#666; text-align:center; padding:25px 0; font-size:12px;">습득한 마법이 없습니다.</div>`;
    } else {
        filteredMagic.forEach(m => { 
            let mData = magicDb[m]; 
            if (!mData) return; 
            let lv = player.magicLevels[m] || 1;
            let tier = getMagicLevelTier(m);

            if (window.currentMagicTab === 'all' && tier !== currentTier) {
                currentTier = tier;
                html += `<div style="color:#fd0; font-size:11px; font-weight:bold; margin:6px 0 2px 2px; border-bottom:1px dashed #444; padding-bottom:2px;">[ ${currentTier} 서클 ]</div>`;
            }

            // 개별 마법 카드 (좌측 정보 + 우측 버튼 1줄 정렬)
            html += `
            <div style="padding:6px 8px; border:1px solid #333344; border-radius:4px; background:linear-gradient(to right, #181824, #0f0f16); color:#ddd; display:flex; flex-direction:row; align-items:center; justify-content:space-between; box-sizing:border-box; width:100%;" oncontextmenu="openMagicActionModal('${m}'); return false;">
                <div style="display:flex; gap:8px; align-items:center; min-width:0; overflow:hidden;">
                    <span style="font-size:18px; flex-shrink:0;">${mData.icon || '✨'}</span>
                    <div style="display:flex; flex-direction:column; min-width:0;">
                        <span style="font-weight:bold; color:#fff; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${m} <span style="color:#fd0; font-size:10px;">[Lv.${lv}]</span>
                        </span>
                        <span style="color:#88aaff; font-size:10.5px; margin-top:1px;">MP ${mData.mp}</span>
                    </div>
                </div>
                <div style="display:flex; gap:3px; flex-shrink:0; margin-left:4px;">
                    <button type="button" class="btn-magic-setup" style="padding:2px 6px; font-size:10.5px; height:22px; cursor:pointer;" onclick="openMagicActionModal('${m}')">설정</button>
                    ${(mData.type === 'buff' || mData.heal) ? `<button type="button" class="btn-magic-use" style="padding:2px 6px; font-size:10.5px; height:22px; cursor:pointer;" onclick="castBuff('${m}')">사용</button>` : ''}
                </div>
            </div>`; 
        });
    }

    html += `</div>`;
    listEl.innerHTML = html;
};
// ==========================================
// [7. 팝업 / 확인 모달 및 윈도우 드래그]
// ==========================================
window.showConfirm = function(msg, callback) {
    const modal = $('confirm-modal');
    if (!modal) return;
    
    let { title, body } = parseTitleAndMsg(msg, "확인");
    if ($('confirm-win-title')) $('confirm-win-title').innerText = title;
    if ($('confirm-msg')) $('confirm-msg').innerText = body;

    let inputEl = $('confirm-input');
    if (inputEl) inputEl.style.display = 'none';

    let container = $('confirm-btn-container');
    if (container) {
        container.innerHTML = '<button class="confirm-btn bg-dark-green" id="btn-yes">확인</button><button class="confirm-btn bg-gray" id="btn-no">취소</button>';
    }
    let closeContainer = $('modal-fixed-close-wrap');
    if (closeContainer) closeContainer.innerHTML = '';

    modal.style.display = 'flex';
    
    // 💡 [핵심 해결] 팝업이 캐릭터 선택창 등 다른 창 뒤로 숨는 현상을 강제로 차단!
    modal.style.setProperty('z-index', '99999999', 'important'); 
    
    bindPromptButtons();
    confirmCallback = callback;
};

window.showPrompt = function(msg, defaultVal, maxVal, callback, isText = false) { 
    const modal = $('confirm-modal'); 
    if (!modal) return; 
    
    let { title, body } = parseTitleAndMsg(msg, "수량 입력");
    if ($('confirm-win-title')) $('confirm-win-title').innerText = title;
    if ($('confirm-msg')) $('confirm-msg').innerText = body;

    let container = $('confirm-btn-container');
    if (container) container.innerHTML = `<button class="confirm-btn bg-dark-green" id="btn-yes">확인</button><button class="confirm-btn bg-gray" id="btn-no">취소</button>`; 
    bindPromptButtons(); 
    
    let inputEl = $('confirm-input'); 
    if (inputEl) {
        inputEl.type = isText ? 'text' : 'number';
        inputEl.style.display = 'block'; 
        inputEl.value = defaultVal; 
        inputEl.max = maxVal; 
    }
    
    let closeContainer = $('modal-fixed-close-wrap');
    if (closeContainer) closeContainer.innerHTML = '';

    modal.style.display = 'flex'; 
    
    confirmCallback = () => { 
        if (isText) {
            callback(inputEl.value);
        } else {
            let val = parseInt(inputEl.value);
            if (isNaN(val) || val < 1) val = 1; 
            if (val > maxVal) val = maxVal; 
            callback(val); 
        }
    }; 
};

window.showCustomPrompt = function(msg, buttonsArray) { 
    const modal = $('confirm-modal'); 
    if (!modal) return;
    
    let { title, body } = parseTitleAndMsg(msg, "선택 메뉴");
    if ($('confirm-win-title')) $('confirm-win-title').innerText = title;

    let container = $('confirm-btn-container'); 
    if (container) container.innerHTML = ''; 

    if ($('confirm-input')) $('confirm-input').style.display = 'none'; 
    if ($('confirm-msg')) $('confirm-msg').innerHTML = body; 

    let normalButtons = buttonsArray.filter(btn => !btn.text.includes('닫기') && !btn.text.includes('취소') && !btn.text.includes('뒤로가기'));
    let closeButton = buttonsArray.find(btn => btn.text.includes('닫기') || btn.text.includes('취소') || btn.text.includes('뒤로가기'));

    if (!closeButton) closeButton = { text: '닫기', color: '#555', callback: () => {} };

    normalButtons.forEach(btn => { 
        let bEl = document.createElement('button'); 
        bEl.className = 'confirm-btn'; 
        bEl.style.width = '100%'; bEl.style.flex = 'none'; bEl.style.padding = '8px'; bEl.style.fontSize = '12px';
        bEl.innerHTML = btn.text; 
        if (btn.color) bEl.style.background = btn.color; 
        bEl.onclick = () => { if (typeof hideTooltip === 'function') hideTooltip(); modal.style.display = 'none'; if (btn.callback) btn.callback(); }; 
        container.appendChild(bEl); 
    }); 

    let closeContainer = $('modal-fixed-close-wrap');
    if (!closeContainer) { closeContainer = document.createElement('div'); closeContainer.id = 'modal-fixed-close-wrap'; container.parentNode.appendChild(closeContainer); }
    closeContainer.innerHTML = '';
    
    let cEl = document.createElement('button');
    cEl.className = 'confirm-btn bg-gray'; cEl.style.width = '100%'; cEl.style.padding = '8px'; cEl.style.fontWeight = 'bold'; cEl.style.marginTop = '6px';
    cEl.innerHTML = closeButton.text;
    if (closeButton.color) cEl.style.background = closeButton.color;
    
    cEl.onclick = () => { if (typeof hideTooltip === 'function') hideTooltip(); modal.style.display = 'none'; if (closeButton.callback) closeButton.callback(); };
    closeContainer.appendChild(cEl);

    modal.style.display = 'flex'; 
};

function bindPromptButtons() { 
    if($('btn-yes')) $('btn-yes').onclick = () => { $('confirm-modal').style.display = 'none'; if($('btn-no').style.display === 'none') { $('btn-no').style.display = 'inline-block'; } if(confirmCallback) { let cb = confirmCallback; confirmCallback = null; cb(); } }; 
    if($('btn-no')) $('btn-no').onclick = () => { $('confirm-modal').style.display = 'none'; confirmCallback = null; }; 
}

// ==========================================
// [8. 아이템 사용, 액션 모달 & 강화]
// ==========================================
window.openItemActionModal = function(e, stackKey, itemName, count, dataStr) { 
    e.stopPropagation(); hideTooltip(); 
    let it = JSON.parse(decodeURIComponent(dataStr)); 
    let hasMagic = (it.magicOptions && it.magicOptions.length > 0); 
    selectedItemForAction = { isMagic: false, stackKey, itemName, count, itemType: it.type, hasMagic: hasMagic, magicOptions: it.magicOptions }; 
    if($('action-modal-title')) $('action-modal-title').innerText = `아이템 관리 (${count}개)`; 
    let dName = it.isEnchantScroll ? `[${it.enchantType}] ${it.name}` : (it.enchantValue ? `+${it.enchantValue} ${it.name}` : it.name);
    let gIdx = it.grade || 0; 
    let html = `<b class="tooltip-title grade-${gIdx}">${dName}</b><span style="font-size:12px; color:#aaa;">[${gradeNames[gIdx]}]</span><br>`; 
    if(it.atk) html += `공격력: ${it.atk}<br>`; if(it.def) html += `방어력: ${it.def}<br>`;
    if(it.skill) html += `<div class="tooltip-magic">발동: ${it.skill}</div>`; 
    if(hasMagic) { 
        html += `<div style="margin-top:5px; border-top:1px dashed #555; padding-top:5px;">`; 
        it.magicOptions.forEach((opt, idx) => { 
            html += `<div class="tooltip-bonus flex justify-between items-center my-1">✨ ${opt} <button onclick="removeMagicOption('${stackKey}', ${idx})" class="text-red-500 bg-gray-800 px-2 rounded border border-gray-600 hover:bg-gray-700 font-bold ml-2">삭제</button></div>`; 
        }); 
        html += `</div>`; 
    } 
    let extra = getExtraDesc(it.name); if(extra) html += `<div class="tooltip-desc" style="color:#ada;">${extra}</div>`;
    if($('action-modal-desc')) $('action-modal-desc').innerHTML = html; 
    if($('btn-purge-magic')) $('btn-purge-magic').style.display = hasMagic ? 'block' : 'none'; 
    if($('action-modal-item-mgmt')) $('action-modal-item-mgmt').style.display = 'flex'; 
    if($('item-action-modal')) $('item-action-modal').style.display = 'flex'; 
};

window.hideItemActionModal = function() { if($('item-action-modal')) $('item-action-modal').style.display = 'none'; hideTooltip(); };

window.openMagicActionModal = function(mName) { 
    selectedItemForAction = { isMagic: true, itemName: mName }; 
    let mData = magicDb[mName]; if(!mData) return;
    let lv = player.magicLevels?.[mName] || 1; 
    let scale = 1 + (lv - 1) * 0.2 + Math.max(0, (player.int - 10) * 0.05);
    let powerText = '';
    if(mData.dmg) powerText = `<br><span style="color:#f55;">위력(공격력): ${Math.floor(mData.dmg * scale)}</span>`;
    else if(mData.heal) powerText = `<br><span style="color:#5f5;">위력(회복량): ${Math.floor(mData.heal * scale)}</span>`;
    let html = `<b class="tooltip-title" style="color:#aaf;">${mName} <span style="color:#fd0; font-weight:bold;">[Lv.${lv}]</span></b><br><div style="font-size:12px; color:#aaa; line-height:1.4;">${mData.type === 'attack' ? '공격 마법' : '보조 마법'} (소모 MP: ${mData.mp})${powerText}</div>`; 
    let extra = getExtraDesc(mName); if(extra) html += `<div class="tooltip-desc" style="color:#ada; margin-top:5px;">${extra}</div>`; 
    if(mData.desc) html += `<div class="tooltip-desc" style="color:#aaf; margin-top:5px; border-top:1px dashed #555; padding-top:5px;">${mData.desc}</div>`;
    if($('action-modal-title')) $('action-modal-title').innerText = `마법 상세 및 단축키 등록`; 
    if($('action-modal-desc')) $('action-modal-desc').innerHTML = html; 
    if($('action-modal-item-mgmt')) $('action-modal-item-mgmt').style.display = 'none'; 
    
    // 💡 [핵심] 모달창이 뒤로 숨지 않게 최상단 배치 및 정중앙 자동 정렬
    let modal = $('item-action-modal');
    if (modal) {
        modal.style.display = 'flex';
        bringToFront('item-action-modal');
        autoCenterWindow('item-action-modal', true);
    }
};
window.removeMagicOption = function(stackKey, idx) {
    let targetItem = null;
    for(let k in player.equip) { if(player.equip[k] && getStackKey(player.equip[k]) === stackKey) { targetItem = player.equip[k]; break; } }
    if(!targetItem) targetItem = player.inv.find(it => getStackKey(it) === stackKey);
    if(targetItem && targetItem.magicOptions) {
        let removed = targetItem.magicOptions.splice(idx, 1)[0];
        addMessage(`[${targetItem.name}]에서 [${removed}] 속성이 삭제되었습니다.`, '#f88');
        playSound('spell'); updateUI(); hideItemActionModal();
        if ($('win-inv') && $('win-inv').style.display === 'flex') renderInventory();
    }
};

window.assignHotkeyFromModal = function(idx) { 
    if(!selectedItemForAction) return; 
    if(selectedItemForAction.isMagic) { 
        hotkeys[idx] = { type: 'magic', id: selectedItemForAction.itemName }; 
        addMessage(`[F${idx+5}] 슬롯에 [${selectedItemForAction.itemName}] 등록 완료`, '#5f5'); 
    } else { 
        let { itemName, itemType } = selectedItemForAction; 
        let payload = {type: 'item', id: itemName}; 
        if(itemType === 'ring' || itemName.includes('반지')) payload.itemType = 'ring'; 
        hotkeys[idx] = payload; 
        addMessage(`[F${idx+5}] 슬롯에 [${itemName}] 등록 완료`, '#5f5'); 
    } 
    playSound('click'); updateUI(); hideItemActionModal(); window.hotkeys = hotkeys; 
};

window.execItemAction = function(action) { 
    hideItemActionModal(); 
    if(!selectedItemForAction || selectedItemForAction.isMagic || action === 'cancel') return; 
    let { stackKey, itemName, count } = selectedItemForAction; 
    if(action === 'use') { useItem(stackKey); } 
    else if(action === 'drop' || action === 'delete') { 
        if(count > 1) { showPrompt(`몇 개를 ${action==='drop'?'버리':'삭제하'}시겠습니까?\n(최대 ${count}개)`, count, count, (qty) => { handleItemRemoval(stackKey, qty, action); }); } 
        else { handleItemRemoval(stackKey, 1, action); } 
    } else if(action === 'purge') { 
        showConfirm("마법 속성을 모두 초기화(삭제) 하시겠습니까?", () => { 
            let idx = player.inv.findIndex(it => getStackKey(it) === stackKey); 
            if(idx > -1) { player.inv[idx].magicOptions = []; addMessage(`${player.inv[idx].name}의 속성이 완전히 초기화되었습니다.`, '#aaf'); playSound('spell'); updateUI(); } 
        }); 
    } 
};

function handleItemRemoval(stackKey, qty, action) { 
    let remainingToRemove = qty; let lastItem = null;
    for(let i = player.inv.length - 1; i >= 0; i--) { 
        if(getStackKey(player.inv[i]) === stackKey) { 
            lastItem = player.inv[i];
            if (lastItem.count && lastItem.count > remainingToRemove) { lastItem.count -= remainingToRemove; remainingToRemove = 0; break; } 
            else if (lastItem.count) { remainingToRemove -= lastItem.count; player.inv.splice(i, 1); } 
            else { player.inv.splice(i, 1); remainingToRemove--; }
            if(remainingToRemove <= 0) break; 
        } 
    } 
    if(qty > remainingToRemove && lastItem) { 
        let actualRemoved = qty - remainingToRemove;
        if(action === 'drop') { items.push({ ...lastItem, count: actualRemoved, x: player.x + (Math.random()*40-20), y: player.y + (Math.random()*40-20), map: currentMap, droppedTime: performance.now() }); addMessage(`${lastItem.name} ${actualRemoved}개를 땅에 버렸습니다.`, '#aaa'); } 
        else { addMessage(`${lastItem.name} ${actualRemoved}개를 영구적으로 파괴했습니다.`, '#f55'); } 
        playSound('click'); updateUI(); 
    } 
}

let itemClickTimer = null;
window.handleItemClick = function(e, stackKey, itemName, count, dataStr) {
    if (itemClickTimer) {
        clearTimeout(itemClickTimer);
        itemClickTimer = null;
        useItem(stackKey); 
    } else {
        itemClickTimer = setTimeout(() => {
            itemClickTimer = null;
            openItemActionModal(e, stackKey, itemName, count, dataStr); 
        }, 250);
    }
};

let equipClickTimer = null;
let equipTouchTimer = null;
let isEquipLongPressed = false;

window.handleEquipClick = function(e, type, dataStr) {
    if (isEquipLongPressed) {
        isEquipLongPressed = false; 
        return;
    }
    if (equipClickTimer) {
        clearTimeout(equipClickTimer);
        equipClickTimer = null;
        unequip(type); 
        hideTooltip();
    } else {
        equipClickTimer = setTimeout(() => {
            equipClickTimer = null;
            let t = $('tooltip');
            if (t && t.style.display === 'block') {
                hideTooltip(); 
            } else {
                showTooltip(e, dataStr, true);
            }
        }, 250);
    }
};

window.startEquipTouch = function(e, type) {
    if(e.touches && e.touches.length > 1) return;
    isEquipLongPressed = false;
    equipTouchTimer = setTimeout(() => {
        equipTouchTimer = null;
        isEquipLongPressed = true;
        unequip(type); 
        hideTooltip();
    }, 500); 
};

window.cancelEquipTouch = function() {
    if (equipTouchTimer) {
        clearTimeout(equipTouchTimer);
        equipTouchTimer = null;
    }
};

window.useItemByName = function(name) { let idx = player.inv.findIndex(it => it.name === name); if(idx > -1) useItem(getStackKey(player.inv[idx])); };

// ==========================================
// 🌟 [인챈트 시스템 / 아이템 사용 / 장착 통합 코드]
// ==========================================
window.activeEnchantScrollKey = null;

// 1. 슬롯 타입 판별 헬퍼
function getEquipSlotType(it) {
    if (!it || !it.type) return null;
    let t = it.type.toLowerCase();
    let n = (it.name || '').toLowerCase();
    
    if (t === 'weapon') return 'weapon';
    if (t === 'shield' || n.includes('방패')) return 'shield';
    if (t === 'helmet' || n.includes('투구') || n.includes('면갑') || n.includes('축복')) return 'helmet';
    if (t === 'armor' || n.includes('갑옷') || n.includes('로브') || n.includes('옷')) return 'armor';
    if (t === 'tshirt' || n.includes('티셔츠')) return 'tshirt';
    if (t === 'cloak' || n.includes('망토')) return 'cloak';
    if (t === 'gloves' || n.includes('장갑')) return 'gloves';
    if (t === 'boots' || n.includes('신발') || n.includes('부츠') || n.includes('샌달')) return 'boots';
    if (t === 'belt' || n.includes('벨트')) return 'belt';
    if (t === 'ring' || t.includes('ring') || n.includes('반지')) return 'ring';
    return t;
}

// 2. 장착 해제 및 장착 중인 아이템 인챈트
window.unequip = function(type) { 
    if (window.activeEnchantScrollKey) { 
        if (player.equip[type]) { 
            window.attemptEnchant(window.activeEnchantScrollKey, player.equip[type]); 
        } 
        return; 
    }
    
    if (player.equip[type]) { 
        playSound('click'); 
        player.inv.push(player.equip[type]); 
        player.equip[type] = null; 
        updateUI(); 
        hideTooltip(); 
    } 
};

// 3. 인벤토리 아이템 사용 및 인챈트 트리거
window.useItem = function(stackKey) {
    if (window.activeEnchantScrollKey) {
        let targetIdx = player.inv.findIndex(it => getStackKey(it) === stackKey);
        if (targetIdx > -1) window.attemptEnchant(window.activeEnchantScrollKey, player.inv[targetIdx]);
        return;
    }

    let idx = player.inv.findIndex(it => getStackKey(it) === stackKey); 
    if (idx === -1) return; 
    let it = player.inv[idx]; 
    hideTooltip();

    if (it.type === 'scroll') {
        if (it.name === '무기 마법 주문서' || it.name === '갑옷 마법 주문서' || it.isEnchantScroll || it.name.includes('마법 부여서')) { 
            window.activeEnchantScrollKey = stackKey; 
            addMessage(`[${it.name}] 강화할 장비(가방 또는 착용창)를 클릭하세요.`, '#ff8'); 
            document.body.classList.add('enchanting-mode');
            document.body.style.cursor = 'crosshair'; 
            return; 
        }
        if (it.name === '귀환 주문서') { 
            playSound('spell'); 
            if (it.count > 1) it.count--; else player.inv.splice(idx, 1); 
            addMessage("귀환 주문서 사용", '#4af'); 
            let townMaps = ['talking_island', 'gludin', 'silver_knight_town', 'windawood', 'giran']; 
            let targetMap = townMaps.indexOf(currentMap) > -1 ? currentMap : 'silver_knight_town'; 
            let targetX = 2000, targetY = 2000; 
            if (maps[targetMap] && maps[targetMap].safeZones && maps[targetMap].safeZones.length > 0) { 
                targetX = maps[targetMap].safeZones[0].x; 
                targetY = maps[targetMap].safeZones[0].y; 
            } 
            changeMap(targetMap, targetX, targetY); 
            return;
        }
    } 

    if (it.type === 'potion') {
        let pInfo = getPotionColorInfo(it.name);
        for (let i = 0; i < 10; i++) {
            particles.push({
                x: player.x, y: player.y, life: 0.8, maxLife: 0.8, 
                type: 'classic_potion', color: pInfo.c, radius: Math.random() * 15 + 8, angle: Math.random() * Math.PI * 2
            });
        }
        if (window.socket && currentUser) {
            window.socket.emit('player_use_potion', { potionName: it.name, map: currentMap });
        }

        if (it.isMeat) {
            playSound('drink');
            let nearbyDoberman = entities.find(e => e.map === currentMap && e.name.includes('도베르만') && !e.isSummon && e.hp > 0 && !e.isDead && Math.hypot(e.x - player.x, e.y - player.y) < 100);
            if (nearbyDoberman) {
                if (Math.random() < 0.3) {
                    addMessage("도베르만 길들이기에 성공했습니다!", '#af5');
                    nearbyDoberman.isSummon = true; 
                    nearbyDoberman.owner = player; 
                    nearbyDoberman.name = "도베르만 (펫)"; 
                    nearbyDoberman.color = '#5a5'; 
                    nearbyDoberman.hp = nearbyDoberman.maxHp; 
                    nearbyDoberman.aggro = false; 
                    nearbyDoberman.target = null;
                    if (player.target === nearbyDoberman) { player.target = null; player.isMoving = false; }
                } else { 
                    addMessage("도베르만 길들이기에 실패했습니다.", '#f55'); 
                }
            } else { 
                addMessage("근처에 테이밍할 대상(도베르만)이 없습니다.", '#aaa'); 
            }
        }
        else if (it.name.includes('초록 물약')) { playSound('drink'); applyBuff('초록물약', 300000, '🍾', 'speed', 60); } 
        else if (it.name.includes('용기')) { 
            if (player.charClass !== 'knight') { addMessage("기사 클래스 전용 아이템입니다.", '#f55'); return; }
            playSound('drink'); applyBuff('용기물약', 300000, '🏺', 'atkSpeed', -300); 
        } 
        else if (it.name.includes('와퍼')) { 
            if (player.charClass !== 'elf') { addMessage("요정 클래스 전용 아이템입니다.", '#f55'); return; }
            playSound('drink'); applyBuff('엘븐와퍼', 300000, '🍃', 'atkSpeed', -300); 
        }
        else if (it.name.includes('파란')) { 
            playSound('drink'); 
            player.mp = Math.min(currentMaxMp, player.mp + 30); 
            addMessage(`${it.name} 복용`, '#55f'); 
        }
        else { 
            // 💡 모든 체력 회복 물약 (주홍, 맑은, 빨간 등) 공통 증폭 처리
            playSound('drink');
            let healAmount = (it.heal || 40);
            if (player.totalPotionEffect) {
                healAmount = Math.floor(healAmount * (1 + player.totalPotionEffect / 100));
            }
            player.hp = Math.min(currentMaxHp, player.hp + healAmount);
            addMessage(`${it.name} 복용 (+${healAmount} HP)`, '#5f5');
        }
        
        if (it.count > 1) it.count--; else player.inv.splice(idx, 1);
    }
    else if (it.type === 'book') {
        if (it.name.includes('정령의 수정') && player.charClass !== 'elf') return showAlert("요정 클래스만 학습할 수 있는 정령의 수정입니다.");
        if (it.name.includes('기술서') && player.charClass !== 'knight') return showAlert("기사 클래스만 학습할 수 있는 기술서입니다.");
        if (it.name.includes('마법서') && player.charClass !== 'wizard') return showAlert("마법사 클래스만 학습할 수 있는 마법서입니다.");

        let requiredLv = (it.grade || 0) * 15 + 1;
        if ((player.level || 1) < requiredLv) return showAlert(`레벨이 부족하여 학습할 수 없습니다. (요청 레벨: Lv.${requiredLv})`);

        player.magicLevels = player.magicLevels || {}; 
        if (player.magic.includes(it.magicName)) return showAlert("이미 습득한 마법입니다.");

        playSound('spell');
        player.magic.push(it.magicName);
        player.magicLevels[it.magicName] = 1; 
        addMessage(`[${it.magicName}] 마법을 습득했습니다!`, '#af5');
        
        if (it.count > 1) it.count--; else player.inv.splice(idx, 1);
    } 
    else { 
        playSound('click'); 
        let exactSlot = getEquipSlotType(it);

        if (exactSlot === 'ring') { 
            if (!player.equip.ring1) { player.equip.ring1 = it; } 
            else if (!player.equip.ring2) { player.equip.ring2 = it; } 
            else { player.inv.push(player.equip.ring1); player.equip.ring1 = it; } 
        } else { 
            if (player.equip[exactSlot]) player.inv.push(player.equip[exactSlot]); 
            player.equip[exactSlot] = it; 
        } 

        if (it.count > 1) { 
            it.count--; 
            let newIt = {...it}; delete newIt.count; 
            player.equip[exactSlot] = newIt; 
        } else { 
            player.inv.splice(idx, 1); 
        }
        addMessage(`${it.name} 장착`, '#aaa'); 
    }
    updateUI();
};

// 4. 인챈트 유효성 검증
window.attemptEnchant = function(scrollKey, targetItem) {
    document.body.style.cursor = 'default'; 
    document.body.classList.remove('enchanting-mode');
    
    let scrollIdx = player.inv.findIndex(it => getStackKey(it) === scrollKey || it.id === scrollKey || it.name === scrollKey); 
    window.activeEnchantScrollKey = null; 

    if (scrollIdx === -1) { 
        addMessage("주문서를 찾을 수 없습니다.", '#f55'); 
        return; 
    }
    
    let scrollItem = player.inv[scrollIdx];

    if (['potion', 'scroll', 'book', 'etc', 'currency'].includes(targetItem.type)) {
        addMessage("장비 아이템에만 사용할 수 있습니다.", '#f55');
        return;
    }

    let isWeapon = targetItem.type === 'weapon';
    let isArmor = ['armor', 'helmet', 'gloves', 'boots', 'cloak', 'shield', 'ring', 'belt', 'tshirt'].includes(targetItem.type);
    let isFantasy = scrollItem.enchantType === '환상' || scrollItem.name.includes('환상') || scrollItem.name.includes('마법 부여서');

    if (!isWeapon && !isArmor && !isFantasy) { 
        addMessage("이 장비에는 해당 주문서를 사용할 수 없습니다.", '#f55'); 
        return; 
    }

    if (scrollItem.name.includes('무기 마법') && !isWeapon) { 
        addMessage("무기에만 바를 수 있습니다.", '#f55'); 
        return; 
    }
    
    if (scrollItem.name.includes('갑옷 마법') && isWeapon) { 
        addMessage("방어구 및 장신구에만 바를 수 있습니다.", '#f55'); 
        return; 
    }

    if (isFantasy) { 
        window.executeEnchant(targetItem, scrollItem, scrollIdx); 
    } else { 
        window.executeNormalEnchant(targetItem, scrollItem, scrollIdx, isWeapon ? 'weapon' : 'armor'); 
    }
};

// 5. 일반 무기/갑옷 주문서 처리
window.executeNormalEnchant = function(targetItem, scrollItem, idx, type) {
    if (!targetItem) return; 
    
    let invScroll = player.inv[idx]; 
    if (invScroll.count > 1) { invScroll.count--; } 
    else { player.inv.splice(idx, 1); }

    let itemToEnchant = targetItem;
    let isEquipped = false;

    for (let k in player.equip) {
        if (player.equip[k] && player.equip[k].id === targetItem.id) {
            isEquipped = true;
            break;
        }
    }

    if (!isEquipped && targetItem.count > 1) { 
        targetItem.count--; 
        itemToEnchant = JSON.parse(JSON.stringify(targetItem)); 
        itemToEnchant.count = 1; 
        itemToEnchant.id = itemToEnchant.name + '_' + Date.now(); 
        player.inv.push(itemToEnchant); 
    }

    let safeLimit = type === 'weapon' ? 6 : 4; 
    let currentEnchant = itemToEnchant.enchantValue || 0;
    let success = true;

    if (currentEnchant >= safeLimit) {
        if (Math.random() > 0.33) { success = false; }
    }

    if (success) { 
        itemToEnchant.enchantValue = currentEnchant + 1; 
        addMessage(`강화 성공! +${itemToEnchant.enchantValue} ${itemToEnchant.name}`, '#5f5'); 
        playSound('spell'); 
    } else { 
        addMessage(`강화 실패... 하지만 ${itemToEnchant.name}은(는) 무사합니다.`, '#f88'); 
        playSound('swing'); 
    }

    updateUI();
    if (typeof renderInventory === 'function') renderInventory();
    
    if (window.socket && currentUser) {
        window.socket.emit('player_update', {
            name: player.name, charClass: player.charClass,
            x: player.x, y: player.y, hp: player.hp, maxHp: currentMaxHp, map: currentMap,
            equip: player.equip
        });
    }
};

// 6. 환상의 마법 부여서 처리
window.executeEnchant = function(targetItem, scrollItem, idx) {
    if (!targetItem) return; 
    let itemToEnchant = targetItem;
    
    let isEquipped = false;
    for (let k in player.equip) {
        if (player.equip[k] && player.equip[k].id === targetItem.id) { isEquipped = true; break; }
    }

    if (!isEquipped && targetItem.count > 1) { 
        targetItem.count--; 
        itemToEnchant = JSON.parse(JSON.stringify(targetItem)); 
        itemToEnchant.count = 1; 
        itemToEnchant.id = itemToEnchant.name + '_' + Date.now(); 
        player.inv.push(itemToEnchant); 
    }
    
    itemToEnchant.magicOptions = itemToEnchant.magicOptions || []; 
    let existingOptIndex = itemToEnchant.magicOptions.findIndex(o => o.includes(`[${scrollItem.enchantType}]`)); 
    playSound('spell');
    
    if (existingOptIndex > -1) { 
        let currentVal = parseInt(itemToEnchant.magicOptions[existingOptIndex].match(/\+(\d+)/)[1]) || 0; 
        let newVal = currentVal + scrollItem.enchantValue; 
        itemToEnchant.magicOptions[existingOptIndex] = `[${scrollItem.enchantType}] 속성 부여 +${newVal}`; 
        addMessage(`[${scrollItem.enchantType}] 속성이 강화되었습니다! (+${newVal})`, '#f55'); 
    } else { 
        if (itemToEnchant.magicOptions.length >= 5) { addMessage("더 이상 마법을 부여할 수 없습니다 (최대 5개)", '#f55'); return; } 
        itemToEnchant.magicOptions.push(`[${scrollItem.enchantType}] 속성 부여 +${scrollItem.enchantValue}`); 
        addMessage(`[${scrollItem.enchantType}] 마법 부여 성공!`, '#f55'); 
    }
    
    let invScroll = player.inv[idx]; 
    if (invScroll.count > 1) { invScroll.count--; } else { player.inv.splice(idx, 1); }
    
    if (typeof particles !== 'undefined') {
        for (let i = 0; i < 20; i++) particles.push({x: player.x, y: player.y, vx: (Math.random()-0.5)*5, vy: (Math.random()-0.5)*5, life: 1, color: '#f5f'}); 
    }
    
    updateUI();
    if (typeof renderInventory === 'function') renderInventory();
    if (window.socket && currentUser) {
        window.socket.emit('player_update', {
            name: player.name, charClass: player.charClass,
            x: player.x, y: player.y, hp: player.hp, maxHp: currentMaxHp, map: currentMap,
            equip: player.equip
        });
    }
};

// 7. 장비 드래그 드롭 착용
window.dropEquipment = function(e, slotType) {
    e.preventDefault();
    try {
        let dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;
        let data = JSON.parse(dataStr);
        if (!data || !data.stackKey) return;
        let it = data.item;
        if (!it) return;

        if (it.type !== slotType && !(it.type === 'ring' && slotType.includes('ring'))) {
            if (typeof addMessage === 'function') addMessage("해당 슬롯에 장착할 수 없는 아이템입니다.", "#f55");
            return;
        }
        
        useItem(data.stackKey); 
    } catch (err) {
        console.error("드래그 장착 에러:", err);
    }
};

window.openShop = function(npcId) { playSound('click'); currentShopNpcId = npcId; let npc = npcs.find(n => n.id === npcId); if(npc && $('shop-title')) $('shop-title').innerText = npc.name; if($('win-shop')) { $('win-shop').style.display = 'flex'; bringToFront('win-shop'); setTimeout(() => autoCenterWindow('win-shop', true), 10); } setShopTab('buy'); };
window.setShopTab = function(tab) { playSound('click'); if($('tab-buy')) { $('tab-buy').style.background = tab==='buy' ? '#222' : '#111'; $('tab-buy').style.color = tab==='buy' ? '#fff' : '#888'; } if($('tab-sell')) { $('tab-sell').style.background = tab==='sell' ? '#222' : '#111'; $('tab-sell').style.color = tab==='sell' ? '#fff' : '#888'; } renderShopList(currentShopNpcId, tab); };

function renderShopList(npcId, tab) {
    if(!npcId) return; 
    let html = ''; 
    let baseType = npcId.split('_')[0]; 
    let wares = shopWares[baseType] || [];

    if(tab === 'buy') { 
        wares.forEach(w => { 
            let dStr = encodeURIComponent(JSON.stringify(w)).replace(/'/g, "%27"); 
            let iconHtml = getItemIcon(w); 
            let sName = w.dispName || w.name; 
            let sPrice = w.dispPrice || w.price; 
            
            html += `
            <div class="shop-row">
                <div class="shop-item-info" oncontextmenu="showTooltip(event, '${dStr}', false); return false;" onmouseenter="if(window.innerWidth >= 768) showTooltip(event, '${dStr}', false)" onmouseleave="hideTooltip()">
                    <span class="shop-item-icon">${iconHtml}</span>
                    <span class="shop-item-name">${sName}</span>
                    <span class="shop-item-price">(${sPrice.toLocaleString()} A)</span>
                </div>
                <div class="shop-item-btns">
                    <button type="button" class="btn-shop-action" onclick="buyItemFast('${baseType}', '${w.name}')">구매</button>
                    <button type="button" class="btn-shop-action" onclick="buyItemPrompt('${baseType}', '${w.name}')">수량</button>
                </div>
            </div>`; 
        }); 
    } else { 
        let counts = {}; 
        player.inv.forEach(it => { 
            let key = getStackKey(it); 
            if(!counts[key]) counts[key] = {item: it, count:0, rawKey: key}; 
            counts[key].count += (it.count || 1); 
        }); 
        
        for(let k in counts) { 
            let c = counts[k]; 
            let sellPrice = Math.floor((c.item.price || 50) * 0.3); 
            let dStr = encodeURIComponent(JSON.stringify(c.item)).replace(/'/g, "%27"); 
            let iconHtml = getItemIcon(c.item); 
            
            html += `
            <div class="shop-row">
                <div class="shop-item-info" oncontextmenu="showTooltip(event, '${dStr}', false); return false;" onmouseenter="if(window.innerWidth >= 768) showTooltip(event, '${dStr}', false)" onmouseleave="hideTooltip()">
                    <span class="shop-item-icon">${iconHtml}</span>
                    <span class="shop-item-name">${c.item.name}</span>
                    <span class="shop-item-count">(${c.count}개)</span>
                    <span class="shop-item-price">+${sellPrice.toLocaleString()}</span>
                </div>
                <div class="shop-item-btns">
                    <button type="button" class="btn-shop-action" onclick="sellItemGroup('${c.rawKey}', ${sellPrice}, ${c.count}, '${c.item.name}')">판매</button>
                </div>
            </div>`; 
        } 
    }
    if($('shop-list')) $('shop-list').innerHTML = html;
}
window.buyItemFast = function(baseType, itemName) { let w = shopWares[baseType].find(i => i.name === itemName); if(!w) return; let cost = w.dispPrice || w.price; let qty = w.bundleQty || 1; executeBuy(w, cost, qty, 1); };
window.buyItemPrompt = function(baseType, itemName) { let w = shopWares[baseType].find(i => i.name === itemName); if(!w) return; let cost = w.dispPrice || w.price; let qty = w.bundleQty || 1; showPrompt(`${w.dispName || w.name} 구매 묶음/수량을 입력하세요.\n(1묶음당 ${cost} 아데나)`, 1, 999, (bundleCount) => { executeBuy(w, cost, qty, bundleCount); }); };

function executeBuy(w, bundleCost, qtyPerBundle, bundleCount) { 
    let totalCost = bundleCost * bundleCount; 
    if(player.adena >= totalCost) { 
        player.adena -= totalCost; playSound('buy'); let totalItems = qtyPerBundle * bundleCount; 
        let existingIdx = player.inv.findIndex(it => getStackKey(it) === getStackKey(w));
        if (existingIdx > -1) { player.inv[existingIdx].count += totalItems; } 
        else { player.inv.push({id: w.name+'_'+Date.now(), count: totalItems, ...w}); }
        addMessage(`${w.name} ${totalItems}개 구매`, '#af5'); updateUI(); 
    } else { addMessage("아데나 부족", '#f55'); } 
}

window.sellItemGroup = function(stackKey, price, maxCount, itemName) { playSound('click'); if (maxCount > 1) { showPrompt(`${itemName} 몇 개를 판매하시겠습니까?\n(최대 ${maxCount}개)`, maxCount, maxCount, (qty) => { executeSell(stackKey, price, qty); }); } else { executeSell(stackKey, price, 1); } };
function executeSell(stackKey, price, qty) { let soldCount = 0; let itemName = ""; let remainingToSell = qty; for (let i = player.inv.length - 1; i >= 0; i--) { if (getStackKey(player.inv[i]) === stackKey) { itemName = player.inv[i].name; let stackCount = player.inv[i].count || 1; if(stackCount > remainingToSell) { player.inv[i].count -= remainingToSell; soldCount += remainingToSell; remainingToSell = 0; } else { soldCount += stackCount; remainingToSell -= stackCount; player.inv.splice(i, 1); } if (remainingToSell <= 0) break; } } if (soldCount > 0) { let totalEarned = price * soldCount; player.adena += totalEarned; playSound('buy'); addMessage(`${itemName} ${soldCount}개 판매 (+${totalEarned} 아데나)`, '#fd0'); updateUI(); renderShopList(currentShopNpcId, 'sell'); } }

let lastPetUiUpdateTime = 0;

window.openPetUI = function(pet) { 
    if (!pet) return;
    if (typeof playSound === 'function') playSound('click'); 
    currentSelectedPet = pet; 
    
    const petTitle = $('pet-title');
    if (petTitle) petTitle.innerText = "소환수 정보"; 
    
    const winPet = $('win-pet');
    if (winPet) {
        winPet.style.display = 'flex'; 
        bringToFront('win-pet');
        setTimeout(() => autoCenterWindow('win-pet', true), 10);
    }
    window.updatePetUI(true); 
};

window.updatePetUI = function(force = false) {
    const now = performance.now();
    // 강제 호출이 아니면 200ms 주기로만 DOM을 갱신하여 렉/다운 원천 차단
    if (!force && now - lastPetUiUpdateTime < 200) return;
    lastPetUiUpdateTime = now;

    const winPet = $('win-pet');
    if (!winPet || winPet.style.display === 'none' || !currentSelectedPet) return;
    
    // 유효하지 않거나 사망한 용병이면 창 닫기
    if (currentSelectedPet.hp <= 0 || currentSelectedPet.isDead) { 
        winPet.style.display = 'none'; 
        currentSelectedPet = null; 
        return; 
    }
    
    if (!currentSelectedPet.equip) currentSelectedPet.equip = { weapon: null, armor: null };
    
    if ($('pet-name')) $('pet-name').innerText = currentSelectedPet.name || '용병';
    if ($('pet-lv')) $('pet-lv').innerText = currentSelectedPet.level || 1;
    if ($('pet-hp')) $('pet-hp').innerText = `${Math.floor(currentSelectedPet.hp)} / ${currentSelectedPet.maxHp || 100}`;
    
    let reqExp = currentSelectedPet.maxExp || ((currentSelectedPet.level || 1) * 500);
    if ($('pet-exp')) $('pet-exp').innerText = `${currentSelectedPet.exp || 0} / ${reqExp}`;
    
    if ($('pet-hp-pot-count')) $('pet-hp-pot-count').innerText = currentSelectedPet.mercHpPotionCount || 0;
    if ($('pet-mp-pot-count')) $('pet-mp-pot-count').innerText = currentSelectedPet.mercMpPotionCount || 0;

    let w = currentSelectedPet.equip.weapon;
    let wpEl = $('pet-eq-wp');
    if (wpEl) { 
        wpEl.innerText = w ? `${w.enchantValue ? '+' + w.enchantValue + ' ' : ''}${w.name}` : "무기 없음"; 
        wpEl.style.color = w ? "#fd0" : "#aaa"; 
    }

    let a = currentSelectedPet.equip.armor;
    let amEl = $('pet-eq-am');
    if (amEl) { 
        amEl.innerText = a ? `${a.enchantValue ? '+' + a.enchantValue + ' ' : ''}${a.name}` : "방어구 없음"; 
        amEl.style.color = a ? "#fd0" : "#aaa"; 
    }
    
    let stance = currentSelectedPet.stance || 'attack';
    ['attack', 'defend', 'rest'].forEach(st => {
        let btn = $(`btn-stance-${st}`);
        if (btn) {
            if (stance === st) { 
                btn.style.background = '#242'; 
                btn.style.color = '#5f5'; 
                btn.style.border = '1px solid #5f5'; 
            } else { 
                btn.style.background = '#2a2a35'; 
                btn.style.color = '#ccc'; 
                btn.style.border = '1px outset #555'; 
            }
        }
    });
};
window.openPetEquipModal = function(type) {
    let items = player.inv.filter(it => it.type === type);
    if(items.length === 0) { 
        addMessage(`가방에 장착할 ${type==='weapon'?'무기':'방어구'}가 없습니다.`, "#f55"); 
        return; 
    }
    
    let btns = items.map(it => ({ 
        text: `${it.enchantValue?'+'+it.enchantValue+' ':''}${it.name}`, 
        callback: () => equipPetItem(getStackKey(it), type) 
    }));
    
    btns.push({ text: '❌ 닫기', color: '#555', callback: () => {} });
    showCustomPrompt(`소환수에게 장착할 ${type==='weapon'?'무기':'방어구'}를 선택하세요.`, btns);
};

function equipPetItem(stackKey, type) {
    let idx = player.inv.findIndex(it => getStackKey(it) === stackKey);
    if(idx > -1 && currentSelectedPet) {
        if(!currentSelectedPet.equip) currentSelectedPet.equip = { weapon: null, armor: null };
        if(currentSelectedPet.equip[type]) { player.inv.push(currentSelectedPet.equip[type]); }
        let itemToGive = {...player.inv[idx]}; itemToGive.count = 1;
        if(player.inv[idx].count > 1) player.inv[idx].count--; else player.inv.splice(idx, 1);
        currentSelectedPet.equip[type] = itemToGive; playSound('click'); addMessage(`${currentSelectedPet.name}에게 ${itemToGive.name} 장착 완료!`, '#5f5');
        updatePetUI(); if($('win-inv') && $('win-inv').style.display === 'flex') renderInventory();
    }
}

window.unequipPetItem = function(type) {
    if(currentSelectedPet && currentSelectedPet.equip && currentSelectedPet.equip[type]) {
        let unequipped = currentSelectedPet.equip[type];
        showConfirm(`[${unequipped.name}] 장비를 해제하여 가방으로 가져오시겠습니까?`, () => {
            player.inv.push(unequipped);
            currentSelectedPet.equip[type] = null;
            playSound('click');
            addMessage(`${currentSelectedPet.name}의 ${unequipped.name} 장착 해제!`, '#aaa');
            updatePetUI();
            if($('win-inv') && $('win-inv').style.display === 'flex') renderInventory();
        });
    }
};

window.setPetStance = function(stance) {
    if(currentSelectedPet) {
        currentSelectedPet.stance = stance; playSound('click'); updatePetUI();
        addMessage(`[${currentSelectedPet.name}] ${stance === 'attack' ? '공격' : (stance === 'defend' ? '방어' : '휴식')} 태세 전환!`, '#5cf');
    }
};

window.dismissPet = function() {
    if(currentSelectedPet) {
        showConfirm(`${currentSelectedPet.name}을(를) 자연으로 돌려보내시겠습니까?`, () => {
            let idx = entities.indexOf(currentSelectedPet);
            if(idx > -1) {
                for(let i=0; i<15; i++) particles.push({x: currentSelectedPet.x, y: currentSelectedPet.y, vx: (Math.random()-0.5)*3, vy: -Math.random()*4, life: 1, color: '#aaa'});
                if (currentSelectedPet.equip) {
                    if (currentSelectedPet.equip.weapon) player.inv.push(currentSelectedPet.equip.weapon);
                    if (currentSelectedPet.equip.armor) player.inv.push(currentSelectedPet.equip.armor);
                }
                entities.splice(idx, 1); addMessage(`${currentSelectedPet.name} 해산됨.`, '#aaa'); playSound('spell');
            }
            if($('win-pet')) $('win-pet').style.display = 'none'; currentSelectedPet = null; updateUI();
        });
    }
};

let currentTransferContext = { maxCount: 0, onConfirmCallback: null };

window.openTransferWindow = function(itemName, maxCount, onConfirm) {
    currentTransferContext = { maxCount: maxCount, onConfirmCallback: onConfirm };
    document.getElementById('transfer-item-name').innerText = itemName;
    document.getElementById('transfer-item-count').innerText = `(최대: ${maxCount}개)`;
    const inputEl = document.getElementById('transfer-input');
    inputEl.value = 1; inputEl.max = maxCount;
    
    let winTransfer = document.getElementById('win-transfer');
    winTransfer.style.display = 'flex';
    bringToFront('win-transfer');
    setTimeout(() => autoCenterWindow('win-transfer', true), 10);
};

window.closeTransferWindow = function() { document.getElementById('win-transfer').style.display = 'none'; };

window.setTransferQuickQty = function(type) {
    const inputEl = document.getElementById('transfer-input');
    const max = currentTransferContext.maxCount;
    if (type === 'min') inputEl.value = 1;
    else if (type === 'half') inputEl.value = Math.max(1, Math.floor(max / 2));
    else if (type === 'max') inputEl.value = max;
};

window.validateTransferInput = function() {
    const inputEl = document.getElementById('transfer-input');
    let val = parseInt(inputEl.value) || 0;
    if (val > currentTransferContext.maxCount) inputEl.value = currentTransferContext.maxCount;
    else if (val < 1) inputEl.value = 1;
};

window.submitTransfer = function() {
    const count = parseInt(document.getElementById('transfer-input').value);
    if (!isNaN(count) && count > 0 && typeof currentTransferContext.onConfirmCallback === 'function') {
        currentTransferContext.onConfirmCallback(count);
    }
    closeTransferWindow();
};

window.giveMercenaryPotion = function(type) {
    if (!currentSelectedPet) return;
    let potionName = type === 'hp' ? '주홍 물약' : '파란 물약';
    let countKey = type === 'hp' ? 'mercHpPotionCount' : 'mercMpPotionCount';

    let potIdx = player.inv.findIndex(it => it.name === potionName && it.type === 'potion');
    if (potIdx === -1 || !player.inv[potIdx]) {
        return showAlert(`가방에 전달할 [${potionName}]이(가) 없습니다.`);
    }

    let maxCount = player.inv[potIdx].count || 1;

    openTransferWindow(`내 가방 ➔ ${currentSelectedPet.name} (${potionName} 주기)`, maxCount, (qty) => {
        if (qty > 0 && qty <= maxCount) {
            currentSelectedPet[countKey] = (currentSelectedPet[countKey] || 0) + qty;
            if (player.inv[potIdx].count > qty) {
                player.inv[potIdx].count -= qty;
            } else {
                player.inv.splice(potIdx, 1);
            }
            playSound('drink');
            addMessage(`${currentSelectedPet.name}에게 ${potionName} ${qty}개를 전달했습니다.`, '#5f5');
            updatePetUI();
            renderInventory();
            if (typeof renderMercenaryHUD === 'function') renderMercenaryHUD();
        }
    });
};

window.retrieveMercenaryPotion = function(type) {
    if (!currentSelectedPet) return;
    let countKey = type === 'hp' ? 'mercHpPotionCount' : 'mercMpPotionCount';
    let potionName = type === 'hp' ? '주홍 물약' : '파란 물약'; 
    let maxCount = currentSelectedPet[countKey] || 0;

    if (maxCount <= 0) {
        return showAlert(`회수할 ${type === 'hp' ? '체력' : '마나'} 물약이 없습니다.`);
    }

    openTransferWindow(`${currentSelectedPet.name} ➔ 내 가방 (${potionName} 회수)`, maxCount, (qty) => {
        if (qty > 0 && qty <= maxCount) {
            currentSelectedPet[countKey] -= qty;
            
            let baseItem = itemDb.find(i => i.name === potionName) || { name: potionName, type: 'potion', price: type==='hp'?72:300, heal: type==='hp'?60:0 };
            let existingIdx = player.inv.findIndex(it => it.name === potionName && it.type === 'potion');
            
            if (existingIdx > -1) {
                player.inv[existingIdx].count = (player.inv[existingIdx].count || 1) + qty;
            } else {
                player.inv.push({ id: 'potion_' + Date.now(), count: qty, ...baseItem });
            }

            playSound('click');
            addMessage(`${currentSelectedPet.name}에게서 ${potionName} ${qty}개를 회수했습니다.`, '#5f5');
            updatePetUI();
            renderInventory();
            if (typeof renderMercenaryHUD === 'function') renderMercenaryHUD();
        }
    });
};

// ==========================================
// [10. 저장 / 불러오기 & 파일 백업]
// ==========================================
const SAVE_KEY = 'lineage_web_saves';
function getLocalSaves() { try { let saves = localStorage.getItem(SAVE_KEY); return saves ? JSON.parse(saves) : {}; } catch(e) { return {}; } }
function saveLocalSaves(savesObj) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(savesObj)); } catch(e) {} }

function getSafePlayerData() {
    let p = JSON.parse(JSON.stringify(player, (key, value) => {
        if (key === 'target' || key === 'owner') return null;
        return value;
    }));
    p.isMoving = false; p.isDrinking = false; p.lastAttack = 0; p.manualOverrideUntil = 0;

    let activeMercs = entities.filter(ent => ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0)
    .map(merc => ({
        id: merc.id, name: merc.name, mercType: merc.mercType, level: merc.level || 1,
        exp: merc.exp || 0,          // 💡 [필수 추가] 저장 시점의 용병 현재 경험치
        maxExp: merc.maxExp || 100,  // 💡 [필수 추가] 저장 시점의 용병 필요 경험치통
        hp: merc.hp, maxHp: merc.maxHp, mp: merc.mp, maxMp: merc.maxMp,
        atk: merc.atk, def: merc.def, speed: merc.speed,
        mercHpPotionCount: merc.mercHpPotionCount || 0, 
        mercMpPotionCount: merc.mercMpPotionCount || 0, 
        equip: merc.equip || { weapon: null, armor: null }, 
        stance: merc.stance || 'attack'
    }));
    return {
        playerData: p,
        options: gameOptions,         
        activeMercenaries: activeMercs 
    };
}

function getCompleteSavePayload(customToken, customSyncTime) {
    let safePackage = getSafePlayerData();
    return {
        player: safePackage.playerData,
        options: safePackage.options,
        activeMercenaries: safePackage.activeMercenaries, 
        hotkeys: window.hotkeys,
        map: currentMap,
        session_token: customToken !== undefined ? customToken : window.mySessionToken,
        last_sync_time: customSyncTime !== undefined ? customSyncTime : Date.now()
    };
}

function saveGameToLocal(isAuto = false) { 
    if(!gameStarted) return;
    try { 
        let p = getSafePlayerData(); let saveData = { time: Date.now(), player: p, hotkeys: window.hotkeys, map: currentMap, options: gameOptions }; 
        let saves = getLocalSaves(); saves[isAuto ? 'auto_save' : 'save_' + Date.now()] = saveData; saveLocalSaves(saves); 
        if(!isAuto) { addMessage("로컬 저장소에 게임이 저장되었습니다.", "#5f5"); if($('save-modal') && $('save-modal').style.display === 'flex') renderSaveList(); } 
    } catch(e) { if(!isAuto) addMessage("저장 실패: " + e.message, "#f55"); } 
}

async function autoSaveToSupabase(isAuto = true) {
    if (!gameStarted || typeof currentUser === 'undefined' || !currentUser) return;
    const sb = getSupabaseClient(); if (!sb) return;

    try {
        let saveData = getCompleteSavePayload(); 

        const { error } = await sb.from('characters').update({
            name: saveData.player.name, 
            class_name: classData[saveData.player.charClass] ? classData[saveData.player.charClass].name : '기사', 
            data: saveData, 
            updated_at: new Date()
        }).eq('user_id', currentUser.id).eq('slot_index', currentSlotIndex);
        
        if (error) throw error;
        if (!isAuto) addMessage("클라우드 저장이 완료되었습니다.", "#5f5");
    } catch(e) { if (!isAuto) addMessage("클라우드 저장 실패: " + e.message, "#f55"); }
}

window.manualSave = function() { saveGameToLocal(false); autoSaveToSupabase(false); };

setInterval(() => { if (gameStarted) { saveGameToLocal(true); autoSaveToSupabase(true); } }, 30000);

document.addEventListener('visibilitychange', async () => { 
    if (document.visibilityState === 'hidden' && gameStarted) { 
        saveGameToLocal(true); 
        autoSaveToSupabase(true); 
    } else if (document.visibilityState === 'visible' && gameStarted && currentUser) {
        const sb = getSupabaseClient();
        if (!sb) return;

        try {
            const { data: dbChar } = await sb.from('characters')
                .select('data')
                .eq('user_id', currentUser.id)
                .eq('slot_index', currentSlotIndex)
                .single();

            if (dbChar && dbChar.data) {
                if (window.mySessionToken && dbChar.data.session_token && dbChar.data.session_token !== window.mySessionToken) {
                    gameStarted = false;
                    alert("다른 기기에서 접속하여 기존 연결이 강제 종료됩니다.");
                    location.reload();
                    return;
                }
            }
        } catch(e) {
            console.error("복귀 시점 서버 동기화 검사 에러:", e);
        }
    }
});

function saveOnExit() {
    if (!gameStarted || typeof currentUser === 'undefined' || !currentUser) return;
    let saveData = getCompleteSavePayload(null, 0); 

    const endpoint = `${SUPABASE_URL}/rest/v1/characters?user_id=eq.${currentUser.id}&slot_index=eq.${currentSlotIndex}`;
    const payload = JSON.stringify({
        name: saveData.player.name,
        class_name: classData[saveData.player.charClass] ? classData[saveData.player.charClass].name : '기사',
        data: saveData,
        updated_at: new Date()
    });

    if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
    }
}

window.addEventListener('pagehide', (e) => { if (gameStarted) { saveOnExit(); } });
window.addEventListener('beforeunload', (e) => { if (gameStarted) { saveOnExit(); } });

function deepMerge(target, source) { 
    for (const key in source) { 
        if (source[key] instanceof Object && !Array.isArray(source[key]) && source[key] !== null) { 
            if (!target[key]) Object.assign(target, { [key]: {} }); deepMerge(target[key], source[key]); 
        } else { target[key] = source[key]; } 
    } 
}

function applyStatsPostLoad() { 
    if(!player.charClass) player.charClass = 'knight'; 
    if (player.activeSpellSlot !== undefined) { player.activeSpellSlots = player.activeSpellSlot !== -1 ? [player.activeSpellSlot] : []; delete player.activeSpellSlot; }
    if (!player.activeSpellSlots) player.activeSpellSlots = [];
    if (Array.isArray(hotkeys)) {
        hotkeys = hotkeys.map(hk => (hk && hk.id) ? hk : null);
        window.hotkeys = hotkeys;
    }
    
    player.isDrinking = false; player.target = null; player.isMoving = false; 
    player.moveX = undefined; player.moveY = undefined; player.lastAttack = 0; player.manualOverrideUntil = 0; 
    player.lastRegen = performance.now(); player.buffs = {}; 
    player.vx = 0; player.vy = 0; player.isKitingActive = false;
    
    if (player.equip.ring) { 
        player.inv.push(JSON.parse(JSON.stringify(player.equip.ring))); 
        delete player.equip.ring; 
    }
    
    recalculateStats(); 
    
    if (player.hp <= 0 || player.isDead) {
        player.hp = currentMaxHp;
        player.mp = currentMaxMp;
        player.isDead = false;
        
        let mData = maps[currentMap];
        if (mData && mData.safeZones && mData.safeZones.length > 0) {
            player.x = mData.safeZones[0].x;
            player.y = mData.safeZones[0].y;
        } else {
            currentMap = 'talking_island';
            player.map = 'talking_island';
            player.x = 2000;
            player.y = 2000;
        }
        addMessage("사망 상태의 캐릭터가 안전하게 복구(부활)되었습니다.", "#5f5");
    } else {
        player.hp = Math.min(player.hp, currentMaxHp); 
        player.mp = Math.min(player.mp, currentMaxMp); 
    }
    
    updateUI(); 
}

function renderSaveList() {
    let saves = getLocalSaves(); let container = $('save-list-container'); if(!container) return;
    let keys = Object.keys(saves).sort((a,b) => (saves[b].time || 0) - (saves[a].time || 0));
    if(keys.length === 0) { container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">저장된 데이터가 없습니다.</div>'; return; }
    let html = '';
    keys.forEach(k => {
        let s = saves[k]; let dateStr = s.time ? new Date(s.time).toLocaleString('ko-KR') : '알 수 없음';
        let pName = s.player ? s.player.name : '캐릭터'; let pLv = s.player ? s.player.level : 1;
        let cName = s.player && classData[s.player.charClass] ? classData[s.player.charClass].name : '기사';
        let tag = (k === 'auto_save') ? '<span style="color:#5f5;">[자동저장]</span> ' : '<span style="color:#fd0;">[수동저장]</span> ';
        html += `<div style="background:#1a1a24; border:1px solid #445; padding:10px; margin-bottom:6px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;"><div style="text-align:left;"><div style="font-weight:bold; color:#fff; font-size:13px;">${tag}${pName} (${cName} Lv.${pLv})</div><div style="font-size:11px; color:#888; margin-top:3px;">${dateStr}</div></div><div style="display:flex; gap:5px;"><button class="menu-btn bg-dark-green" style="padding:4px 8px; font-size:11px;" onclick="loadGameFromLocal('${k}')">불러오기</button><button class="menu-btn bg-dark-red" style="padding:4px 8px; font-size:11px; color:#f88;" onclick="deleteLocalSave('${k}')">삭제</button></div></div>`;
    });
    container.innerHTML = html;
}

window.manualLoadLocal = function() { renderSaveList(); if($('save-modal')) $('save-modal').style.display = 'flex'; };
window.deleteLocalSave = function(docId) { showConfirm("이 저장 데이터를 삭제하시겠습니까?", () => { let saves = getLocalSaves(); delete saves[docId]; saveLocalSaves(saves); renderSaveList(); checkAndInitMainMenu(); }); };

window.loadGameFromLocal = function(docId, isAutoResume = false) { 
    let saves = getLocalSaves(); 
    if(saves[docId]) { 
        let loaded = saves[docId]; let freshPlayer = getInitialPlayer(); deepMerge(freshPlayer, loaded.player); 
        for(let k in player) delete player[k]; Object.assign(player, freshPlayer);
        if(loaded.hotkeys) { hotkeys = loaded.hotkeys; window.hotkeys = hotkeys; } 
        else if(loaded.player && loaded.player.hotkeys) { hotkeys = loaded.player.hotkeys; window.hotkeys = hotkeys; }
        else { hotkeys = new Array(8).fill(null); window.hotkeys = hotkeys; }
        if(loaded.options) { Object.assign(gameOptions, loaded.options); if($('opt-vol')) $('opt-vol').value = Math.floor((gameOptions.volume / 0.05) * 100); if($('opt-dmg')) $('opt-dmg').checked = gameOptions.showDamage; if($('opt-names')) $('opt-names').checked = gameOptions.showNames; if($('opt-loot-grade')) $('opt-loot-grade').value = gameOptions.minLootGrade; }
        applyStatsPostLoad(); 
        let targetMap = loaded.map || player.map || 'silver_knight_town'; let targetX = player.x || (maps[targetMap]?.safeZones?.[0]?.x || 2000); let targetY = player.y || (maps[targetMap]?.safeZones?.[0]?.y || 2000);
        entities.length = 0; for(let m in maps) { if(maps[m].b) { maps[m].b.forEach(bossDef => { let bt = templates.bosses[bossDef.id]; if(bt) entities.push({ ...bt, id: bossDef.id, maxHp: bt.hp, x: bossDef.x, y: bossDef.y, map: m, spawnMap: m, spawnX: bossDef.x, spawnY: bossDef.y, angle: 0, isMoving: false, isBoss: true }); }); } }
        changeMap(targetMap, targetX, targetY); 
        if($('char-select-overlay')) $('char-select-overlay').style.display = 'none'; 
        if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'none'; 
        if($('save-modal')) $('save-modal').style.display = 'none'; 
        if($('main-ui')) $('main-ui').style.display = 'block';
        let wasNotStarted = !gameStarted; gameStarted = true;
        if (wasNotStarted) { updateOptions(); requestAnimationFrame(update); }
        if(!isAutoResume) addMessage("게임을 성공적으로 불러왔습니다.", "#5f5");
    } else { if(!isAutoResume) showAlert("데이터를 찾을 수 없습니다."); } 
};

window.exportCharacterFile = async function() { 
    let p = getSafePlayerData(); let saveData = { player: p, map: currentMap, time: Date.now(), hotkeys: window.hotkeys, options: gameOptions }; 
    let dataStr = btoa(encodeURIComponent(JSON.stringify(saveData))); 
    try {
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({ suggestedName: `lineage_save_${player.level}_${Date.now()}.txt`, types: [{ description: 'Text file', accept: {'text/plain': ['.txt']} }] });
            const writable = await handle.createWritable(); await writable.write(dataStr); await writable.close();
            addMessage("캐릭터 데이터가 안전하게 백업되었습니다.", "#5f5");
        } else { throw new Error("API Not Supported"); }
    } catch(e) {
        if (e.name === 'AbortError') { addMessage("파일 저장이 취소되었습니다.", "#aaa"); return; }
        let blob = new Blob([dataStr], { type: "text/plain" }); let url = URL.createObjectURL(blob); let a = document.createElement('a'); a.href = url; a.download = `lineage_save_${player.level}_${Date.now()}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); 
        addMessage("캐릭터 데이터가 [다운로드] 폴더에 백업되었습니다.", "#5f5"); 
    }
};

window.importCharacterFile = function(e) { 
    let file = e.target.files[0]; if(!file) return; let reader = new FileReader(); 
    reader.onload = function(evt) { 
        try { 
            let rawData = evt.target.result; let saveData = null;
            try { let cleanBase64 = rawData.replace(/\s+/g, ''); saveData = JSON.parse(decodeURIComponent(atob(cleanBase64))); } 
            catch(bErr) { saveData = JSON.parse(rawData); }

            if(saveData && saveData.player) { 
                let freshPlayer = getInitialPlayer(); deepMerge(freshPlayer, saveData.player); 
                for(let k in player) delete player[k]; Object.assign(player, freshPlayer);
                if(saveData.hotkeys) { hotkeys = saveData.hotkeys; window.hotkeys = hotkeys; }
                else if(saveData.player && saveData.player.hotkeys) { hotkeys = saveData.player.hotkeys; window.hotkeys = hotkeys; }
                else { hotkeys = new Array(8).fill(null); window.hotkeys = hotkeys; }
                if(saveData.options) { Object.assign(gameOptions, saveData.options); if($('opt-vol')) $('opt-vol').value = Math.floor((gameOptions.volume / 0.05) * 100); if($('opt-dmg')) $('opt-dmg').checked = gameOptions.showDamage; if($('opt-names')) $('opt-names').checked = gameOptions.showNames; if($('opt-loot-grade')) $('opt-loot-grade').value = gameOptions.minLootGrade; }
                applyStatsPostLoad(); 
                let targetMap = saveData.map || player.map || 'silver_knight_town'; let targetX = player.x || (maps[targetMap]?.safeZones?.[0]?.x || 2000); let targetY = player.y || (maps[targetMap]?.safeZones?.[0]?.y || 2000);
                entities.length = 0; for(let m in maps) { if(maps[m].b) { maps[m].b.forEach(bossDef => { let bt = templates.bosses[bossDef.id]; if(bt) entities.push({ ...bt, id: bossDef.id, maxHp: bt.hp, x: bossDef.x, y: bossDef.y, map: m, spawnMap: m, spawnX: bossDef.x, spawnY: bossDef.y, angle: 0, isMoving: false, isBoss: true }); }); } }
                changeMap(targetMap, targetX, targetY); 
                if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'none'; 
                if($('char-select-overlay')) $('char-select-overlay').style.display = 'none'; 
                if($('save-modal')) $('save-modal').style.display = 'none';
                if($('main-ui')) $('main-ui').style.display = 'block';
                let wasNotStarted = !gameStarted; gameStarted = true;
                if (wasNotStarted) { updateOptions(); requestAnimationFrame(update); }
                showAlert("캐릭터를 성공적으로 불러왔습니다!"); 
            } else { throw new Error("Invalid Format"); } 
        } catch(err) { showAlert("잘못되거나 손상된 세이브 파일입니다."); } 
        e.target.value = ''; 
    }; 
    reader.readAsText(file); 
};

window.showCharSelect = function() { $('main-menu-overlay').style.display = 'none'; $('char-select-overlay').style.display = 'flex'; };
window.hideCharSelect = function() { $('char-select-overlay').style.display = 'none'; $('main-menu-overlay').style.display = 'flex'; };

window.inGameNewGame = function() {
    showConfirm("현재 캐릭터 진행 상황을 자동 저장하고 새 캐릭터를 생성하시겠습니까?", () => {
        saveGameToLocal(true); closeAllWindows(); showCharSelect();
    });
};

function checkAndInitMainMenu() { if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'flex'; }

window.sharedWarehouse = { adena: 0, items: [], pets: [] };

window.loadWarehouse = async function() {
    if (currentUser) {
        try {
            let localWh = localStorage.getItem('lineage_warehouse_' + currentUser.id);
            if (localWh) { window.sharedWarehouse = JSON.parse(localWh); }
        } catch(e) {}
    }

    const sb = getSupabaseClient();
    if (!sb || !currentUser) return;

    try {
        const { data, error } = await sb.from('characters').select('data').eq('user_id', currentUser.id).eq('slot_index', 99).maybeSingle();
        if (data && data.data) { 
            window.sharedWarehouse = data.data; 
            localStorage.setItem('lineage_warehouse_' + currentUser.id, JSON.stringify(window.sharedWarehouse));
        }
    } catch(e) { console.error("수파베이스 창고 로드 실패 (로컬 데이터 유지):", e); }
};

window.saveWarehouse = async function() {
    if (currentUser) {
        try { localStorage.setItem('lineage_warehouse_' + currentUser.id, JSON.stringify(window.sharedWarehouse)); } catch(e) {}
    }

    const sb = getSupabaseClient();
    if (!sb || !currentUser) return;

    try {
        await sb.from('characters').upsert({
            user_id: currentUser.id, 
            slot_index: 99, 
            name: '계정공용창고', 
            class_name: '창고', 
            data: window.sharedWarehouse, 
            updated_at: new Date()
        }, { onConflict: 'user_id,slot_index' });
    } catch(e) { console.error("수파베이스 창고 동기화 실패 (로컬에 안전하게 보관됨):", e); }
};

window.openWarehouseUI = async function() {
    await loadWarehouse();
    let btns = [
        { text: `💰 아데나 맡기기`, callback: depositAdena },
        { text: `💰 아데나 찾기`, callback: withdrawAdena },
        { text: `🎒 아이템 맡기기`, color: '#242', callback: openDepositItemUI },
        { text: `📦 아이템 찾기 (${sharedWarehouse.items?.length||0}/100)`, color: '#422', callback: openWithdrawItemUI },
        { text: '닫기', color: '#555', callback: () => {} }
    ];
    showCustomPrompt(`[창고지기]\n창고 아데나: ${(sharedWarehouse.adena || 0).toLocaleString()} A\n보관된 아이템: ${sharedWarehouse.items?.length||0}/100 칸`, btns);
};

window.openDepositItemUI = function() {
    if(!sharedWarehouse.items) sharedWarehouse.items = [];
    if(sharedWarehouse.items.length >= 100) return showAlert("창고가 가득 찼습니다. (최대 100칸)");
    if(player.inv.length === 0) return showAlert("가방이 비어있습니다.", openWarehouseUI);
    
    let btns = player.inv.map((it) => {
        let dStr = encodeURIComponent(JSON.stringify(it)).replace(/'/g, "%27");
        let nameStr = `${it.enchantValue?'+'+it.enchantValue+' ':''}${it.name} (${it.count||1}개)`;
        return { text: `${nameStr} <span style="font-size:11px; color:#5cf; font-weight:bold;">[정보]</span>`, dataStr: dStr, callback: () => openItemDepositConfirm(it) };
    });
    btns.push({ text: '뒤로가기', color: '#555', callback: openWarehouseUI });
    
    showCustomPrompt(`<div style="flex-shrink:0; font-size:12px; color:#aaa; margin-bottom:4px;">[창고에 맡길 아이템 선택]</div><div style="flex-shrink:0; font-size:11px; color:#888;">아이템을 누르면 상세 능력치를 확인하고 맡길 수 있습니다.</div>`, btns);
};

function openItemDepositConfirm(it) {
    let details = getItemDetailsHTML(it, false);
    let btns = [
        {
            text: '<span style="color:#fd5; font-weight:bold;">[창고에 맡기기]</span>',
            color: '#166534',
            callback: async () => {
                if(!sharedWarehouse.items) sharedWarehouse.items = [];
                if(sharedWarehouse.items.length >= 100) {
                    const modal = $('confirm-modal');
                    if(modal) modal.style.display = 'none';
                    return showAlert("창고가 가득 찼습니다. (최대 100칸)", openWarehouseUI);
                }

                let currentIdx = player.inv.findIndex(p => getStackKey(p) === getStackKey(it));
                if (currentIdx === -1) {
                    const modal = $('confirm-modal');
                    if(modal) modal.style.display = 'none';
                    return showAlert("해당 아이템이 가방에 없습니다.", openDepositItemUI);
                }
                
                let itemToStore = JSON.parse(JSON.stringify(player.inv[currentIdx]));
                player.inv.splice(currentIdx, 1);
                
                let existing = sharedWarehouse.items.find(w => getStackKey(w) === getStackKey(itemToStore) && (!w.magicOptions || w.magicOptions.length === 0));
                if(existing) {
                    existing.count = (parseInt(existing.count) || 1) + (parseInt(itemToStore.count) || 1);
                } else {
                    sharedWarehouse.items.push(itemToStore);
                }
                
                await saveWarehouse();
                addMessage(`${itemToStore.name}을(를) 창고에 맡겼습니다.`, '#fd0');
                updateUI(); 
                
                const modal = $('confirm-modal');
                if(modal) modal.style.display = 'none';
                
                if(player.inv.length === 0) {
                    setTimeout(openWarehouseUI, 10);
                } else {
                    setTimeout(openDepositItemUI, 10);
                }
            }
        },
        {
            text: '취소 (목록으로)',
            color: '#555',
            callback: () => {
                const modal = $('confirm-modal');
                if(modal) modal.style.display = 'none';
                setTimeout(openDepositItemUI, 10);
            }
        }
    ];
    showCustomPrompt(`<div style="text-align:left; background:#111; padding:12px; border:1px solid #444; border-radius:4px; margin-bottom:10px; font-size:12px; max-height:160px; overflow-y:auto;">${details}</div>`, btns);
}

function openItemWithdrawConfirm(it) {
    let details = getItemDetailsHTML(it, false);
    let btns = [
        {
            text: '<span style="color:#5f5; font-weight:bold;">[창고에서 찾기]</span>',
            color: '#1d4ed8',
            callback: async () => {
                if(player.inv.length >= 100) {
                    const modal = $('confirm-modal');
                    if(modal) modal.style.display = 'none';
                    return showAlert("가방이 가득 찼습니다.", openWithdrawItemUI);
                }

                let currentWhIdx = sharedWarehouse.items.findIndex(w => getStackKey(w) === getStackKey(it));
                if (currentWhIdx === -1) {
                    const modal = $('confirm-modal');
                    if(modal) modal.style.display = 'none';
                    return showAlert("창고에 해당 아이템이 없습니다.", openWithdrawItemUI);
                }
                
                let itemToTake = JSON.parse(JSON.stringify(sharedWarehouse.items[currentWhIdx]));
                sharedWarehouse.items.splice(currentWhIdx, 1);
                
                let existing = player.inv.find(p => getStackKey(p) === getStackKey(itemToTake) && (!p.magicOptions || p.magicOptions.length === 0));
                if(existing) {
                    existing.count = (parseInt(existing.count) || 1) + (parseInt(itemToTake.count) || 1);
                } else {
                    player.inv.push(itemToTake);
                }
                
                await saveWarehouse();
                addMessage(`${itemToTake.name}을(를) 창고에서 찾았습니다.`, '#5f5');
                updateUI(); 
                
                const modal = $('confirm-modal');
                if(modal) modal.style.display = 'none';
                
                if(!sharedWarehouse.items || sharedWarehouse.items.length === 0) {
                    setTimeout(openWarehouseUI, 10);
                } else {
                    setTimeout(openWithdrawItemUI, 10);
                }
            }
        },
        {
            text: '취소 (목록으로)',
            color: '#555',
            callback: () => {
                const modal = $('confirm-modal');
                if(modal) modal.style.display = 'none';
                setTimeout(openWithdrawItemUI, 10);
            }
        }
    ];
    showCustomPrompt(`<div style="text-align:left; background:#111; padding:12px; border:1px solid #444; border-radius:4px; margin-bottom:10px; font-size:12px; max-height:160px; overflow-y:auto;">${details}</div>`, btns);
}

window.openWithdrawItemUI = function() {
    if(!sharedWarehouse.items || sharedWarehouse.items.length === 0) return showAlert("창고에 보관된 아이템이 없습니다.", openWarehouseUI);
    if(player.inv.length >= 100) return showAlert("가방이 가득 찼습니다.");
    
    let btns = sharedWarehouse.items.map((it) => {
        let dStr = encodeURIComponent(JSON.stringify(it)).replace(/'/g, "%27");
        let nameStr = `${it.enchantValue?'+'+it.enchantValue+' ':''}${it.name} (${it.count||1}개)`;
        return { text: `${nameStr} <span style="font-size:11px; color:#5cf; font-weight:bold;">[정보]</span>`, dataStr: dStr, callback: () => openItemWithdrawConfirm(it) };
    });
    btns.push({ text: '뒤로가기', color: '#555', callback: openWarehouseUI });
    
    showCustomPrompt(`<div style="flex-shrink:0; font-size:12px; color:#aaa; margin-bottom:4px;">[창고에서 찾을 아이템 선택]</div><div style="flex-shrink:0; font-size:11px; color:#888;">아이템을 누르면 상세 능력치를 확인하고 찾을 수 있습니다.</div>`, btns);
};

window.depositAdena = function() {
    showPrompt(`얼마를 입금하시겠습니까?\n(현재 보유: ${player.adena} A)`, 0, player.adena, async (amount) => {
        if(amount > 0 && amount <= player.adena) {
            player.adena -= amount; sharedWarehouse.adena = (sharedWarehouse.adena || 0) + amount;
            await saveWarehouse();
            addMessage(`창고에 ${amount} 아데나를 맡겼습니다.`, "#fd0"); updateUI();
        }
    });
};

window.withdrawAdena = function() {
    let max = sharedWarehouse.adena || 0;
    showPrompt(`얼마를 출금하시겠습니까?\n(창고 보유: ${max} A)`, 0, max, async (amount) => {
        if(amount > 0 && amount <= max) {
            sharedWarehouse.adena -= amount; player.adena += amount;
            await saveWarehouse();
            addMessage(`창고에서 ${amount} 아데나를 찾았습니다.`, "#fd0"); updateUI();
        }
    });
};

window.openPetKeeperUI = async function() {
    await loadWarehouse(); 
    
    let myPet = entities.find(e => e.isSummon && e.owner === player && !e.isMercenary);
    let storedPet = (sharedWarehouse.pets && sharedWarehouse.pets.length > 0) 
        ? sharedWarehouse.pets.find(p => !p.isMercenary) 
        : null;

    let btns = [];
    if (myPet) {
        btns.push({ text: `[맡기기] 현재 펫 (${myPet.name})`, callback: () => storePet(myPet) });
    }
    if (storedPet) {
        btns.push({ text: `[찾기] 보관된 펫 (${storedPet.name})`, callback: retrievePet });
    }
    btns.push({ text: '닫기', color: '#555', callback: () => {} });

    showCustomPrompt(`[펫 관리인]\n펫을 안전하게 맡기거나 찾을 수 있습니다.`, btns);
};

window.storePet = async function(petEntity) {
    if (sharedWarehouse.pets && sharedWarehouse.pets.length > 0) {
        return showAlert("이미 창고에 보관 중인 소환수나 용병이 있습니다. 먼저 찾아주세요!");
    }
    
    let petData = { ...petEntity, owner: null, target: null };
    sharedWarehouse.pets = [petData];
    await saveWarehouse();
    
    let idx = entities.indexOf(petEntity);
    if(idx > -1) entities.splice(idx, 1);
    
    let typeName = petEntity.isMercenary ? "용병" : "펫";
    addMessage(`${typeName}을(를) 안전하게 맡겼습니다. (다른 캐릭터로 찾을 수 있습니다)`, "#5f5"); 
    updateUI();
};

window.retrievePet = async function() {
    let existingPet = entities.find(e => e.isSummon && e.owner === player && !e.isMercenary);
    if (existingPet) {
        return showAlert("이미 소환된 펫이 있습니다. 먼저 기존 펫을 맡겨주세요.");
    }

    if (!sharedWarehouse.pets || sharedWarehouse.pets.length === 0) {
        return showAlert("맡겨둔 펫이 없습니다.");
    }

    let petIndex = sharedWarehouse.pets.findIndex(p => !p.isMercenary);
    if (petIndex === -1) {
        return showAlert("맡겨둔 펫이 없습니다.");
    }

    let storedPet = sharedWarehouse.pets.splice(petIndex, 1)[0];

    storedPet.owner = player; 
    storedPet.isSummon = true;
    storedPet.isMercenary = false;
    storedPet.x = player.x; 
    storedPet.y = player.y; 
    storedPet.map = currentMap;
    entities.push(storedPet);

    await saveWarehouse();
    
    addMessage(`맡겨둔 펫 [${storedPet.name}]을(를) 찾았습니다!`, "#5f5"); 
    if (typeof updateUI === 'function') updateUI();
};

window.openMercenaryUI = async function() {
    await loadWarehouse();
    if (!sharedWarehouse.mercenaries) sharedWarehouse.mercenaries = [];
    
    let activeMercs = entities.filter(e => e.isSummon && e.owner === player && e.isMercenary && e.hp > 0);
    let storedMercs = sharedWarehouse.mercenaries;

    let msg = `[용병단장]\n현재 동행 중인 용병: <span style="color:#5f5; font-weight:bold;">${activeMercs.length}명</span> / 3명\n보관 중인 용병: <span style="color:#fd0; font-weight:bold;">${storedMercs.length}명</span> / 3명`;

    let btns = [
        { text: "⚔️ 용병 고용하기", callback: () => showMercenaryHireMenu() },
        { text: `📥 용병 맡기기 (${activeMercs.length}명 보유)`, callback: () => depositMercenary() },
        { text: `📤 용병 찾기 (${storedMercs.length}명 보관 중)`, callback: () => withdrawMercenary() },
        { text: "닫기", color: "#555" }
    ];

    showCustomPrompt(msg, btns);
};

window.showMercenaryHireMenu = function() {
    let cost = player.level * 2000;
    let activeMercs = entities.filter(e => e.isSummon && e.owner === player && e.isMercenary && e.hp > 0);

    let contentEl = $('mercenary-content');
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="font-weight:bold; color:#fd0; margin-bottom:10px;">⚔️ 용병 단장 영입소</div>
            <p style="font-size:13px; color:#ccc;">전투를 보조할 강력한 용병을 고용합니다.<br>(현재 동행: <span style="color:#5f5; font-weight:bold;">${activeMercs.length}명</span> / 최대 3명)</p>
            <button class="confirm-btn bg-dark-green w-full mb-3" onclick="hireMercenary('knight', ${cost})">기사 용병 고용 (${cost.toLocaleString()} A)</button>
            <button class="confirm-btn bg-dark-green w-full mb-3" onclick="hireMercenary('elf', ${cost})">요정 용병 고용 (${cost.toLocaleString()} A)</button>
            <button class="confirm-btn bg-dark-green w-full mb-3" onclick="hireMercenary('wizard', ${cost})">마법사 용병 고용 (${cost.toLocaleString()} A)</button>
        `;
    }
    if ($('win-mercenary')) $('win-mercenary').style.display = 'flex';
  bringToFront('win-mercenary');
        setTimeout(() => autoCenterWindow('win-mercenary', true), 10);
};

window.hireMercenary = function(mercType, cost) {
    if (player.adena < cost) {
        return showAlert("아데나가 부족합니다.");
    }
    
    let activeMercs = entities.filter(e => e.isSummon && e.owner === player && e.isMercenary && e.hp > 0);
    if (activeMercs.length >= 3) {
        return showAlert("용병은 최대 3명까지만 동시에 데리고 다닐 수 있습니다.");
    }

    player.adena -= cost;
    if (typeof playSound === 'function') playSound('buy');

    let typeTitle = mercType === 'knight' ? '기사 용병' : (mercType === 'wizard' ? '마법사 용병' : '요정 용병');
    let mercName = `${typeTitle} ${activeMercs.length + 1}호`;
    let color = mercType === 'wizard' ? '#88f' : (mercType === 'elf' ? '#8f8' : '#ccc');
    let maxHp = player.level * 100 + 200;
    let maxMp = player.level * 50 + 100;

    let defaultWeapon = null;
    let defaultArmor = null;
    let starterInventory = [];

    if (mercType === 'knight') {
        defaultWeapon = { id: 'w_knight_6saura', name: '+6 싸울아비 장검', type: 'weapon', atk: 16 };
        defaultArmor = { id: 'a_knight_4plate', name: '+4 무관의 갑옷', type: 'armor', def: 8 };
        starterInventory = [
            { name: '주홍 물약', count: 100, type: 'potion' },
            { name: '초록 물약', count: 20, type: 'potion' },
            { name: '용기의 물약', count: 10, type: 'potion' }
        ];
    } else if (mercType === 'elf') {
        defaultWeapon = { id: 'w_elf_6bow', name: '+6 화염의 활', type: 'weapon', atk: 14, isBow: true };
        defaultArmor = { id: 'a_elf_4plate', name: '+4 요정족 판금 갑옷', type: 'armor', def: 6 };
        starterInventory = [
            { name: '주홍 물약', count: 100, type: 'potion' },
            { name: '초록 물약', count: 20, type: 'potion' },
            { name: '엘븐 와퍼', count: 10, type: 'potion' }
        ];
    } else if (mercType === 'wizard') {
        defaultWeapon = { id: 'w_wiz_6staff', name: '+6 마나의 지팡이', type: 'weapon', atk: 10 };
        defaultArmor = { id: 'a_wiz_4robe', name: '+4 신관의 로브', type: 'armor', def: 5 };
        starterInventory = [
            { name: '주홍 물약', count: 100, type: 'potion' },
            { name: '파란 물약', count: 50, type: 'potion' },
            { name: '초록 물약', count: 20, type: 'potion' }
        ];
    }

   
    let targetLevel = player.level;
    let correctMaxExp = getExpRequiredForLevel(targetLevel); // 💡 레벨에 맞는 정확한 필요 경험치 계산

    let newMerc = {
        id: 'merc_' + Date.now() + '_' + Math.floor(Math.random()*1000),
        name: mercName,
        mercType: mercType,
        x: player.x + (Math.random() * 40 - 20),
        y: player.y + (Math.random() * 40 - 20),
        map: currentMap,
        size: 20,
        hp: maxHp,
        maxHp: maxHp,
        mp: maxMp,
        maxMp: maxMp,
        atk: targetLevel * 3 + 10,
        def: targetLevel + 2,
        speed: 150,
        
        // 💡 [핵심] 고용 시 플레이어의 레벨과, 그 레벨에 맞는 정확한 maxExp 적용
        level: targetLevel,
        exp: 0,
        maxExp: correctMaxExp, 
        
        color: color,
        isSummon: true,
        owner: player,
        isMercenary: true,
        stance: 'attack',
        equip: { weapon: defaultWeapon, armor: defaultArmor },
        mercHpPotionCount: 100,
        mercMpPotionCount: mercType === 'wizard' ? 50 : 10,
        inventory: starterInventory,
        skills: typeof getSkillsForMercenary === 'function' ? getSkillsForMercenary(mercType, targetLevel) : [],
        activeBuffs: []
    };
    entities.push(newMerc);
    addMessage(`[용병 영입] ${mercName}을(를) 고용했습니다!`, '#5f5');
    
    if (typeof updateUI === 'function') updateUI();
    if ($('win-mercenary')) $('win-mercenary').style.display = 'none';
};

window.depositMercenary = async function() {
    let activeMercs = entities.filter(e => e.isSummon && e.owner === player && e.isMercenary && e.hp > 0);
    if (activeMercs.length === 0) {
        return showAlert("맡길 용병이 없습니다.");
    }

    if (!sharedWarehouse.mercenaries) sharedWarehouse.mercenaries = [];
    if (sharedWarehouse.mercenaries.length >= 3) {
        return showAlert("용병소 보관함이 가득 찼습니다. (최대 3명 보관 가능)");
    }

    if (activeMercs.length === 1) {
        await executeDepositMercenary(activeMercs[0]);
    } else {
        let btns = activeMercs.map(merc => ({
            text: `[맡기기] ${merc.name} (Lv.${merc.level || 1})`,
            callback: () => executeDepositMercenary(merc)
        }));
        btns.push({ text: "뒤로가기", color: "#555", callback: () => openMercenaryUI() });
        showCustomPrompt("맡길 용병을 선택하세요:", btns);
    }
};

async function executeDepositMercenary(merc) {
    let idx = entities.indexOf(merc);
    if (idx > -1) entities.splice(idx, 1);

    let cleanMercData = sanitizeMercenaryData(merc);

    if (!sharedWarehouse.mercenaries) sharedWarehouse.mercenaries = [];
    sharedWarehouse.mercenaries.push(cleanMercData);
    await saveWarehouse();

    addMessage(`[용병 보관] ${merc.name} 용병을 용병소에 맡겼습니다.`, '#5f5');
    if (typeof updateUI === 'function') updateUI();
    openMercenaryUI();
}

window.withdrawMercenary = async function() {
    await loadWarehouse();
    if (!sharedWarehouse.mercenaries || sharedWarehouse.mercenaries.length === 0) {
        return showAlert("맡겨둔 용병이 없습니다.");
    }

    let activeMercs = entities.filter(e => e.isSummon && e.owner === player && e.isMercenary && e.hp > 0);
    if (activeMercs.length >= 3) {
        return showAlert("더 이상 용병을 동행시킬 수 없습니다. (최대 3명)");
    }

    let btns = sharedWarehouse.mercenaries.map((merc, index) => ({
        text: `[찾기] ${merc.name} (Lv.${merc.level || 1})`,
        callback: async () => {
            let withdrawnMerc = sharedWarehouse.mercenaries.splice(index, 1)[0];
            withdrawnMerc.owner = player;
            withdrawnMerc.isSummon = true;
            withdrawnMerc.isMercenary = true;
            withdrawnMerc.x = player.x + (Math.random() * 40 - 20);
            withdrawnMerc.y = player.y + (Math.random() * 40 - 20);
            withdrawnMerc.map = currentMap;

            entities.push(withdrawnMerc);
            await saveWarehouse();

            addMessage(`[용병 복귀] ${withdrawnMerc.name} 용병과 다시 동행합니다.`, '#5f5');
            if (typeof updateUI === 'function') updateUI();
            openMercenaryUI();
        }
    }));

    btns.push({ text: "뒤로가기", color: "#555", callback: () => openMercenaryUI() });
    showCustomPrompt("찾아올 용병을 선택하세요:", btns);
};

// ==========================================
// [창 드래그 및 위치 이동 시스템]
// ==========================================

window.startDrag = function(e, id) { 
    dragEl = $(id); 
    if(!dragEl) return;

    if (typeof bringToFront === 'function') {
        bringToFront(id); // 클릭/터치 시 맨 앞으로 배치
    }

    if (dragEl.style.transform && dragEl.style.transform !== 'none') {
        let rect = dragEl.getBoundingClientRect();
        dragEl.style.setProperty('transform', 'none', 'important'); // 고정 해제
        dragEl.style.left = rect.left + 'px';
        dragEl.style.top = rect.top + 'px';
    }

    let rect = dragEl.getBoundingClientRect(); 
    let cx = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX; 
    let cy = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY; 
    dragOffsetX = cx - rect.left; 
    dragOffsetY = cy - rect.top; 

    document.addEventListener('mousemove', onDrag); 
    document.addEventListener('mouseup', stopDrag); 
    document.addEventListener('touchmove', onDrag, {passive: false}); 
    document.addEventListener('touchend', stopDrag); 
};

function onDrag(e) {
    if (!dragEl) return;
    let cx = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    let cy = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    dragEl.style.left = (cx - dragOffsetX) + 'px';
    dragEl.style.top = (cy - dragOffsetY) + 'px';
}

function stopDrag() {
    dragEl = null;
    document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag); document.removeEventListener('touchend', stopDrag);
}

window.autoCenterWindow = function(id, forceCenter = true) {
    const el = document.getElementById(id);
    if (!el) return;

    // 숨겨져 있던 창이면 일시적으로 표시하여 실제 크기 측정
    let wasHidden = el.style.display === 'none';
    if (wasHidden) { 
        el.style.visibility = 'hidden'; 
        el.style.display = 'flex'; 
    }

    // 💡 [핵심] 이전 기억(left, top)을 무조건 무시하고 현재 화면(window) 기준 정중앙 재계산
    let cx = Math.max(0, (window.innerWidth - el.offsetWidth) / 2);
    let cy = Math.max(0, (window.innerHeight - el.offsetHeight) / 2);
    
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.setProperty('transform', 'none', 'important');

    if (wasHidden) { 
        el.style.display = 'none'; 
        el.style.visibility = 'visible'; 
    }
}




initHotkeyUI();
bindPromptButtons();

const mercHudListEl = document.getElementById('mercenary-hud-list');
if (mercHudListEl) {
    mercHudListEl.addEventListener('dragover', (e) => e.preventDefault());
    mercHudListEl.addEventListener('drop', (e) => {
        e.preventDefault();
        if (typeof draggedItemIndex === 'undefined' || draggedItemIndex === null || !draggedItemData) return;

        let targetMerc = entities.find(ent => ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0) || currentSelectedPet;
        if (!targetMerc) {
            addMessage("전달할 활성화된 용병이 없습니다.", '#f55');
            return;
        }

        let qty = draggedItemData.count || 1;

        if (draggedItemData.type === 'potion' || draggedItemData.name.includes('물약')) {
            if (draggedItemData.name.includes('파란') || draggedItemData.name.includes('마나')) {
                targetMerc.mercMpPotionCount = (targetMerc.mercMpPotionCount || 0) + qty;
            } else {
                targetMerc.mercHpPotionCount = (targetMerc.mercHpPotionCount || 0) + qty;
            }
            player.inv.splice(draggedItemIndex, 1);
            playSound('drink');
            addMessage(`${targetMerc.name}에게 ${draggedItemData.name} ${qty}개를 전달했습니다.`, '#5f5');
        } else if (draggedItemData.type === 'weapon' || draggedItemData.type === 'armor') {
            if (!targetMerc.equip) targetMerc.equip = { weapon: null, armor: null };
            let temp = targetMerc.equip[draggedItemData.type];
            targetMerc.equip[draggedItemData.type] = draggedItemData;
            
            if (temp) player.inv.splice(draggedItemIndex, 1, temp);
            else player.inv.splice(draggedItemIndex, 1);
            
            playSound('click');
            addMessage(`${targetMerc.name}에게 ${draggedItemData.name}을(를) 장착시켰습니다.`, '#af5');
        }

        draggedItemIndex = null;
        draggedItemData = null;
        updateUI();
        renderInventory();
        if (typeof updatePetUI === 'function') updatePetUI();
        if (typeof renderMercenaryHUD === 'function') window.renderMercenaryHUD();
    });
}

if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', checkAndInitMainMenu); } 
else { checkAndInitMainMenu(); }

// ==========================================
// [채팅 입력, 엔터키 토글 & 모바일 전송 버튼 통합]
// ==========================================
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

function sendChatMessage() {
    if (!chatInput) return;
    const msg = chatInput.value.trim();
    if (msg !== '') {
        player.bubbleText = msg;
        player.bubbleTimer = Date.now() + 5000; 

        if (typeof addMessage === 'function') {
            addMessage(`[전체] ${player.name || '플레이어'}: ${msg}`, '#ffffff');
        }
        
        if (window.socket && currentUser) {
            window.socket.emit('chat_message', {
                senderId: currentUser.id,
                name: player.name,
                message: msg,
                map: currentMap
            });
        }
        
        chatInput.value = '';
    }
    chatInput.blur(); 
}

window.addEventListener('keydown', (e) => {
    if (!chatInput) return;

    if (e.key === 'Enter') {
        e.preventDefault(); 
        
        if (document.activeElement === chatInput) {
            sendChatMessage();
        } else {
            chatInput.focus(); 
        }
        return;
    }

    if (document.activeElement === chatInput) {
        e.stopPropagation();
    }
});

if (chatSendBtn) {
    chatSendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendChatMessage();
    });
    chatSendBtn.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    });
}

if (chatInput) {
    chatInput.addEventListener('touchstart', (e) => e.stopPropagation());
    chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
}

// ==========================================
// [14. 맵 이동 및 포탈 / 텔레포트 관리 함수]
// ==========================================
window.changeMap = function(newMap, nx, ny) { 
    if (typeof playSound === 'function') playSound('spell'); 
    
    currentMap = newMap; 
    player.map = newMap; 
    player.target = null;
    player.isMoving = false; 
    player.moveX = undefined; 
    player.moveY = undefined; 
    if (typeof clearPlayerAggro === 'function') clearPlayerAggro();
    if (nx === -1 || ny === -1) {
        nx = 400;
        ny = 400;
    }

    player.x = nx; 
    player.y = ny;
    camera.x = nx; 
    camera.y = ny;
    
    player.target = null; 
    player.isMoving = false; 
    player.moveX = undefined; 
    player.moveY = undefined; 
    
    if (typeof activeMercs !== 'undefined' && Array.isArray(activeMercs)) {
        activeMercs.forEach((merc, idx) => {
            if (merc) {
                merc.map = newMap;
                let angle = (idx * (Math.PI * 2 / Math.max(1, activeMercs.length)));
                merc.x = nx + Math.cos(angle) * 70;
                merc.y = ny + Math.sin(angle) * 70;
                merc.target = null; merc.isMoving = false; merc.isDead = false;
                merc.hp = merc.maxHp || merc.hp;
            }
        });
    }

    if (typeof entities !== 'undefined' && Array.isArray(entities)) {
        entities.forEach(e => {
            if (e && (e.isMercenary || e.isSummon) && e.owner === player) {
                e.map = newMap;
                e.x = nx + (Math.random() * 60 - 30);
                e.y = ny + (Math.random() * 60 - 30);
                e.target = null; e.isMoving = false; e.isDead = false;
            }
        });
    }

    if (typeof entities !== 'undefined' && Array.isArray(entities)) {
        for (let i = entities.length - 1; i >= 0; i--) {
            let e = entities[i];
            if (e && !e.isSummon && !e.isMercenary && e.map === newMap) {
                let dist = Math.hypot(e.x - nx, e.y - ny);
                if (dist < 300) {
                    entities.splice(i, 1);
                }
            }
        }
    }

    if (typeof applyBuff === 'function') {
        applyBuff('앱솔루트 배리어', 3000, '✨', 'invincible', 1, player);
        addMessage("텔레포트 착지 보호막이 3초간 적용됩니다.", "#5f5");
    }

    particles = []; 
    dmgTexts = [];
    
    if (typeof $ === 'function' && $('map-name') && maps[currentMap]) {
        $('map-name').innerText = maps[currentMap].name + ' [' + (maps[currentMap].recLv || 'N/A') + ']'; 
    }
    if (typeof updateUI === 'function') updateUI(); 
};

window.teleportPrompt = function() {
    let teleportListEl = document.getElementById('teleport-list');
    if (!teleportListEl) return;
    
    // 💡 맵 레벨 파싱 및 오름차순 정렬 로직 수정
    let mapKeys = Object.keys(maps);
    mapKeys.sort((a, b) => {
        let m1 = maps[a];
        let m2 = maps[b];
        
        let textA = m1.recLv || '';
        let textB = m2.recLv || '';

        // 1. 안전지대(마을)가 포함된 곳을 가장 최우선(상단)으로 배치
        let isSafeA = m1.safeZones && m1.safeZones.length > 0;
        let isSafeB = m2.safeZones && m2.safeZones.length > 0;
        if (isSafeA && !isSafeB) return -1;
        if (!isSafeA && isSafeB) return 1;

        // 2. 레벨 문자열에서 정확한 시작 레벨 숫자 추출 (예: "Lv.100+" -> 100, "Lv.1~15" -> 1)
        let getMinLevel = (str) => {
            if (str.includes('100+') || str.includes('105+')) return 100; // 고레벨 맵 강제 후순위 배치
            let match = str.match(/\d+/);
            return match ? parseInt(match[0]) : 999;
        };

        let lvA = getMinLevel(textA);
        let lvB = getMinLevel(textB);
        
        return lvA - lvB;
    });

    let html = '';
    mapKeys.forEach(key => {
        let m = maps[key];
        let hasSafeZone = m.safeZones && m.safeZones.length > 0;
        let safeBadge = hasSafeZone ? ` <span style="color:#5f5; font-size:11px;">[안전지대]</span>` : '';
        let recLvText = m.recLv ? ` [${m.recLv}]` : '';

        let targetX = hasSafeZone ? m.safeZones[0].x : -1;
        let targetY = hasSafeZone ? m.safeZones[0].y : -1;

        html += `<button class="confirm-btn bg-dark-green" style="margin:2px; display:flex; justify-content:space-between; align-items:center; padding:8px 12px;" onclick="changeMap('${key}', ${targetX}, ${targetY}); document.getElementById('teleport-modal').style.display='none';">
            <span>${m.name}${safeBadge}</span>
            <span style="font-size:11px; color:#fd0;">${recLvText}</span>
        </button>`;
    });
    
    teleportListEl.innerHTML = html;
    
    let modal = document.getElementById('teleport-modal');
    if (modal) {
        modal.style.display = 'flex';
        bringToFront('teleport-modal');
        setTimeout(() => autoCenterWindow('teleport-modal', true), 10);
    }
};

window.selectClass = async function(charClass) {
    playSound('click');
    let charName = window.pendingCharName || '모험가';
    const sb = getSupabaseClient();
    if (!sb || !currentUser) return showAlert("로그인 정보가 유효하지 않습니다.");

    let freshPlayer = getInitialPlayer();
    freshPlayer.name = charName;
    freshPlayer.charClass = charClass;

    // 아이템 생성 헬퍼 함수
    const addEq = (name, type, grade, stats) => {
        freshPlayer.inv.push({ id: type + '_' + Date.now() + Math.random(), name: name, type: type, grade: grade, ...stats });
    };
    const addPot = (name, count) => {
        freshPlayer.inv.push({ id: 'pot_' + Date.now() + Math.random(), name: name, type: 'potion', count: count });
    };

    // ==========================================
    // [클래스별 국민 풀셋 & 전용 물약 지급]
    // ==========================================
    if (charClass === 'knight' || charClass === 'royal') {
        addEq('+6 싸울아비 장검', 'weapon', 3, { atk: 16, enchantValue: 6 });
        addEq('+4 기사의 면갑', 'helmet', 2, { def: 3, enchantValue: 4 });
        addEq('+4 강철 판금 갑옷', 'armor', 2, { def: 8, enchantValue: 4 });
        addEq('+4 보호 망토', 'cloak', 1, { def: 1, enchantValue: 4 });
        addEq('+4 강철 장갑', 'gloves', 2, { def: 2, enchantValue: 4 });
        addEq('+4 강철 부츠', 'boots', 2, { def: 3, enchantValue: 4 });
        addEq('+4 붉은 기사의 방패', 'shield', 2, { def: 2, enchantValue: 4 });
        addEq('오우거의 벨트', 'belt', 3, { hpBonus: 30 });
        
        addPot('초록 물약', 500);
        if (charClass === 'knight') addPot('용기의 물약', 500);

    } else if (charClass === 'elf') {
        addEq('+6 화염의 활', 'weapon', 2, { atk: 14, isBow: true, enchantValue: 6 });
        addEq('+4 엘름의 축복', 'helmet', 2, { def: 3, dex: 1, enchantValue: 4 });
        addEq('+4 요정족 판금 갑옷', 'armor', 1, { def: 6, enchantValue: 4 });
        addEq('+4 보호 망토', 'cloak', 1, { def: 1, enchantValue: 4 });
        addEq('+4 강철 장갑', 'gloves', 2, { def: 2, enchantValue: 4 });
        addEq('+4 강철 부츠', 'boots', 2, { def: 3, enchantValue: 4 });
        addEq('신체의 벨트', 'belt', 2, { hpBonus: 50 });
        
        addPot('초록 물약', 500);
        addPot('엘븐 와퍼', 500);

    } else if (charClass === 'wizard') {
        addEq('+6 마나의 지팡이', 'weapon', 2, { atk: 3, mpDrain: 2, enchantValue: 6 });
        addEq('+4 신관의 투구', 'helmet', 3, { def: 2, mpRegen: 1, enchantValue: 4 });
        addEq('+4 신관의 로브', 'armor', 3, { def: 6, mpRegen: 5, hpBonus: 10, enchantValue: 4 });
        addEq('+4 마법 망토', 'cloak', 2, { def: 2, enchantValue: 4 });
        addEq('+4 강철 장갑', 'gloves', 2, { def: 2, enchantValue: 4 });
        addEq('+4 강철 부츠', 'boots', 2, { def: 3, enchantValue: 4 });
        addEq('빛나는 정신의 벨트', 'belt', 3, { mpBonus: 50, mpRegen: 2 });
        addEq('심연의 반지', 'ring', 3, { mpRegen: 1 });

        addPot('초록 물약', 500);
        addPot('파란 물약', 500);

        // ★ 마법사 기본 마법 3종 자동 습득
        freshPlayer.magic = ['에너지 볼트', '힐', '실드'];
        freshPlayer.magicLevels = { '에너지 볼트': 1, '힐': 1, '실드': 1 };
    }
    let saveData = {
        player: freshPlayer,
        hotkeys: new Array(8).fill(null),
        map: 'talking_island',
        options: gameOptions,
        last_sync_time: Date.now()
    };

    try {
        const { error } = await sb.from('characters').insert([
            {
                user_id: currentUser.id,
                slot_index: currentSlotIndex,
                name: charName,
                class_name: charClass === 'elf' ? '요정' : (charClass === 'wizard' ? '마법사' : (charClass === 'royal' ? '군주' : '기사')),
                data: saveData
            }
        ]);

        if (error) {
            if (error.code === '23505' || error.message.includes('unique') || error.message.includes('already exists')) {
                showAlert("이미 사용 중인 캐릭터 이름입니다. 다른 이름을 입력해주세요.");
            } else {
                showAlert("캐릭터 생성 실패: " + error.message);
            }
        } else {
            $('char-select-overlay').style.display = 'none';
            await fetchCharacterList();
            selectSlotAndStart(currentSlotIndex);
        }
    } catch(e) {
        showAlert("캐릭터 생성 중 예외 발생: " + e.message);
    }
};

window.hideCharSelect = function() {
    playSound('click');
    if($('char-select-overlay')) $('char-select-overlay').style.display = 'none';
    if($('slot-box')) $('slot-box').style.display = 'block';
};

window.renderMercenaryHUD = function() {
    const listEl = document.getElementById('mercenary-hud-list');
    if (!listEl) return;

    let activeMercs = entities.filter(ent => ent && ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0);

    if (activeMercs.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    let isMobile = window.innerWidth <= 768;
    let html = '';
    
    activeMercs.forEach((merc) => {
        let hpPct = Math.max(0, Math.min(100, (merc.hp / merc.maxHp) * 100));
        let mpPct = Math.max(0, Math.min(100, ((merc.mp || 0) / (merc.maxMp || 50)) * 100));
        let displayName = isMobile ? (merc.name.match(/\d+호/)?.[0] || merc.name) : `${merc.name} (Lv.${merc.level || 1})`;

        // 💡 슬림하고 컴팩트한 미니 카드 디자인 적용
        html += `
        <div class="merc-hud-card" style="
            pointer-events: auto !important; 
            cursor: pointer; 
            position: relative; 
            z-index: 99999;
            background: rgba(15, 15, 22, 0.85);
            border: 1px solid #445;
            border-radius: 3px;
            padding: 4px 6px;
            margin-bottom: 3px;
            width: 140px;
            box-sizing: border-box;
            box-shadow: 0 2px 4px rgba(0,0,0,0.6);
        " onclick="window.selectMercenary('${merc.id}')"
          oncontextmenu="event.preventDefault(); window.selectMercenary('${merc.id}'); return false;">
            <div style="font-size: 10px; font-weight: bold; color: #fd0; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</div>
            <div style="width: 100%; background: #111; height: 5px; border-radius: 2px; overflow: hidden; margin-bottom: 2px; border: 1px solid #222;">
                <div style="width: ${hpPct}%; background: #e33; height: 100%;"></div>
            </div>
            <div style="width: 100%; background: #111; height: 5px; border-radius: 2px; overflow: hidden; border: 1px solid #222;">
                <div style="width: ${mpPct}%; background: #36f; height: 100%;"></div>
            </div>
        </div>`;
    });

    listEl.innerHTML = html;
};
// 💡 용병 선택 전용 전역 함수 추가

window.selectMercenary = function(mercId) {
    let target = entities.find(e => e.id === mercId);
    if (target) {
        player.target = target;
        playSound('click');
        addMessage(`[용병 지정] ${target.name}`, '#5ff');
        if (typeof openPetUI === 'function') openPetUI(target);
    }
};

// 💡 [ui.js] 보조/버프 마법 시전 및 이펙트 연결 함수
window.castBuff = function(magicName) {
    let mData = magicDb[magicName];
    if (!mData) return;
    if (player.charClass !== 'wizard' && (!player.magic || !player.magic.includes(magicName))) {
        return;
    }
    
   if (window.socket && currentUser) {
        window.socket.emit('player_magic_action', {
            magicName: magicName,
            targetX: player.x,
            targetY: player.y,
            targetId: window.socket.id,
            casterX: player.x,
            casterY: player.y,
            casterId: window.socket.id,
            map: currentMap
        });
    }

    if (magicName !== '블러드 투 소울' && player.mp < mData.mp) {
        return addMessage("MP가 부족합니다.", '#f55');
    }    
    if (magicName !== '블러드 투 소울') {
        player.mp -= mData.mp;
    }
    playSound('spell');

    // ==========================================
    // 🌟 [모든 보조/버프 마법 그래픽 이펙트 완벽 매핑]
    // ==========================================
    if (typeof particles !== 'undefined') {
        if (mData.heal || magicName.includes('힐') || magicName === '네이쳐스 터치') {
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'classic_heal' });
        } else if (magicName.includes('실드') || magicName.includes('어스 스킨')) {
            particles.push({ x: player.x, y: player.y, life: 0.8, maxLife: 0.8, type: 'classic_shield' });
        } else if (magicName.includes('가속') || magicName.includes('초록') || magicName === '홀리 워크' || magicName === '윈드 워크') {
            // 💡 마법사 및 요정 헤이스트/가속 회오리 이펙트 고정 출력
            particles.push({ x: player.x, y: player.y, life: 1.2, maxLife: 1.2, type: 'haste_tornado', size: 45 });
        } else if (magicName === '스톰 샷' || magicName === '파이어 웨폰') {
            // 💡 요정 스톰샷 및 파이어웨폰 버프 이펙트
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'haste_tornado', size: 50 });
        } else if (magicName === '어드밴스 스피릿') {
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'advance_spirit' });
        } else if (magicName === '이뮨 투 함') {
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'immune_to_harm' });
        } else if (magicName === '앱솔루트 배리어') {
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'absolute_barrier' });
        } else if (magicName === '마제스티') {
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'majesty_shield' });
        } else if (magicName === '서먼 몬스터' || magicName === '매스 텔레포트') {
            particles.push({ x: player.x, y: player.y, life: 1.0, maxLife: 1.0, type: 'summon_effect' });
        } else if (magicName === '블러드 투 소울') {
            particles.push({ x: player.x, y: player.y, life: 0.8, maxLife: 0.8, type: 'drain' });
        } else {
            particles.push({ x: player.x, y: player.y, life: 0.8, maxLife: 0.8, type: 'buff_effect' });
        }
    }

    // --- 마법 효과(로직) 적용 ---
    if (mData.heal || magicName.includes('힐') || magicName === '네이쳐스 터치') {
        let healAmt = Math.floor((mData.heal || 40) * (1 + (player.int - 10) * 0.05));
        player.hp = Math.min(currentMaxHp, player.hp + healAmt);
        addMessage(`[${magicName}] HP ${healAmt} 회복`, '#5f5');
        if (typeof dmgTexts !== 'undefined') {
            dmgTexts.push({ x: player.x, y: player.y - 40, text: `+${healAmt} ✨`, life: 1.2, color: '#5f5' });
        }
    } else if (magicName === '블러드 투 소울') {
        if (player.hp > 40) {
            player.hp -= 40;
            player.mp = Math.min(currentMaxMp, player.mp + 15);
            addMessage(`[블러드 투 소울] HP를 40 소모하여 MP를 15 회복했습니다.`, '#55f');
            if (typeof dmgTexts !== 'undefined') dmgTexts.push({ x: player.x, y: player.y - 40, text: `+15 MP`, life: 1.2, color: '#55f' });
        } else {
            addMessage("체력이 부족하여 블러드 투 소울을 사용할 수 없습니다.", '#f55');
        }
    } else if (magicName === '스톰 샷') {
        applyBuff('스톰 샷', mData.duration || 300000, mData.icon || '🌪️', 'atk', 5);
    } else if (mData.buffType) {
        applyBuff(magicName, mData.duration || 300000, mData.icon, mData.buffType, mData.val || 0);
    }
    
    updateUI();
};

window.processAutoConsumablesAndBuffs = function() {
    if (!gameStarted || !player || player.hp <= 0 || player.isDead) return;
    let now = performance.now();

    // 💡 [1] 물약 ON 상태일 때: 체력/마나 및 버프 물약 자동 사용
    if (player.autoPotion) {
        // HP 물약 자동 복용 (50% 이하)
        if (player.hp < currentMaxHp * 0.50) { 
            let hpPot = player.inv.find(it => it && it.type === 'potion' && (it.heal || it.name.includes('주홍') || it.name.includes('맑은') || it.name.includes('빨간') || it.name.includes('고기')));
            if (hpPot) useItem(getStackKey(hpPot));
        }

        // MP 물약 자동 복용 (35% 이하)
        if (player.mp < currentMaxMp * 0.35) { 
            let mpPot = player.inv.find(it => it && it.type === 'potion' && it.name.includes('파란'));
            if (mpPot) useItem(getStackKey(mpPot));
        }

        // 💡 [버프 물약 상시 감지]: 버프가 아예 없거나(undefined 또는 만료됨) 3초 전일 때 즉시 복용
        const autoDrinkBuff = (potKeyword, buffKeyList) => {
            let b = null;
            if (player.buffs) {
                for (let k of buffKeyList) {
                    if (player.buffs[k] && player.buffs[k].expire > now) {
                        b = player.buffs[k];
                        break;
                    }
                }
            }

            // 버프가 없거나 잔여 시간이 3초 이하일 때
            if (!b || (b.expire - now <= 3000)) {
                let pot = player.inv.find(it => it && it.type === 'potion' && it.name.includes(potKeyword));
                if (pot) {
                    useItem(getStackKey(pot));
                }
            }
        };

        autoDrinkBuff('초록', ['가속(헤이스트)', '초록물약']);
        if (player.charClass === 'knight' || player.charClass === 'royal') {
            autoDrinkBuff('용기', ['용기물약']);
        }
        if (player.charClass === 'elf') {
            autoDrinkBuff('와퍼', ['엘븐와퍼']);
        }
    }

    // 💡 [2] 사냥(ON) 상태일 때: 퀵슬롯 버프/힐 마법 자동 시전
    if (!player.autoHunt) return;

    hotkeys.forEach((hk, idx) => {
        if (!hk || hk.type !== 'magic') return;
        
        let hasLearned = (player.magic && player.magic.includes(hk.id)) || 
                         (player.charClass === 'wizard' && ['에너지 볼트', '힐', '실드'].includes(hk.id));
        if (!hasLearned) return;
        
        let mData = typeof magicDb !== 'undefined' ? magicDb[hk.id] : null;
        if (!mData) return;

        // 힐 마법 자동 시전
        if (mData.heal || hk.id.includes('힐') || hk.id === '네이쳐스 터치') {
            if (player.hp < currentMaxHp * 0.70 && player.mp >= mData.mp) {
                player.lastAutoHealTime = player.lastAutoHealTime || 0;
                if (now - player.lastAutoHealTime > 1200) {
                    player.lastAutoHealTime = now;
                    castBuff(hk.id);
                }
            }
        } 
        // 버프 마법 자동 시전 (버프가 아예 없거나 만료 직전일 때)
        else if (mData.type === 'buff' || mData.buffType || hk.id.includes('실드') || hk.id.includes('스톰') || hk.id.includes('워크') || hk.id.includes('가속') || hk.id.includes('웨폰') || hk.id.includes('어스')) {
            let buffKey = hk.id;
            if (hk.id.includes('가속') || hk.id.includes('헤이스트') || hk.id.includes('초록')) buffKey = '가속(헤이스트)';
            
            let b = player.buffs ? player.buffs[buffKey] : null;
            if (!b || (b.expire - now <= 3000)) {
                if (player.mp >= mData.mp) {
                    player.lastAutoBuffTime = player.lastAutoBuffTime || {};
                    if (now - (player.lastAutoBuffTime[hk.id] || 0) > 1500) {
                        player.lastAutoBuffTime[hk.id] = now;
                        castBuff(hk.id);
                    }
                }
            }
        }
    });
};
document.addEventListener('DOMContentLoaded', () => {
    const enableMobileWindowDrag = () => {
        document.querySelectorAll('.win-header').forEach(header => {
            if (header.dataset.touchDraggable) return;
            header.dataset.touchDraggable = 'true';
            
            header.addEventListener('touchstart', (e) => {
                let winEl = header.closest('.window');
                if (winEl && winEl.id && typeof startDrag === 'function') {
                    startDrag(e, winEl.id);
                }
            }, { passive: false });
        });
    };

    enableMobileWindowDrag();
    setInterval(enableMobileWindowDrag, 1000);
});


window.renderMercenaryHUD = function() {
    const listEl = document.getElementById('mercenary-hud-list');
    if (!listEl) return;

    let activeMercs = entities.filter(ent => ent && ent.isSummon && ent.owner === player && ent.isMercenary && ent.hp > 0);

    if (activeMercs.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    let isMobile = window.innerWidth <= 768;
    let html = '';
    
    activeMercs.forEach((merc) => {
        let hpPct = Math.max(0, Math.min(100, (merc.hp / merc.maxHp) * 100));
        let mpPct = Math.max(0, Math.min(100, ((merc.mp || 0) / (merc.maxMp || 50)) * 100));
        let displayName = isMobile ? (merc.name.match(/\d+호/)?.[0] || merc.name) : `${merc.name} (Lv.${merc.level || 1})`;

        // 💡 원본 CSS 클래스 사용 + 클릭/터치 씹힘 방지 속성 적용
        html += `
        <div class="merc-hud-card" style="pointer-events: auto !important; cursor: pointer; position: relative; z-index: 99999;"
             onclick="window.selectMercenary('${merc.id}')"
             oncontextmenu="event.preventDefault(); window.selectMercenary('${merc.id}'); return false;">
            <div class="merc-name-row">${displayName}</div>
            <div class="merc-bar-wrap">
                <div class="merc-bar-fill hp" style="width: ${hpPct}%;"></div>
                ${isMobile ? '' : `<span class="merc-bar-text">HP ${Math.floor(merc.hp)}/${merc.maxHp}</span>`}
            </div>
            <div class="merc-bar-wrap">
                <div class="merc-bar-fill mp" style="width: ${mpPct}%;"></div>
                ${isMobile ? '' : `<span class="merc-bar-text">MP ${Math.floor(merc.mp || 0)}/${merc.maxMp || 50}</span>`}
            </div>
        </div>`;
    });

    listEl.innerHTML = html;
};

window.selectMercenary = function(mercId) {
    let target = entities.find(e => e.id === mercId);
    if (target) {
        player.target = target;
        playSound('click');
        addMessage(`[용병 지정] ${target.name}`, '#5ff');
        if (typeof openPetUI === 'function') openPetUI(target);
    }
};

// 💡 용병 선택 전용 전역 함수 (중복 제거 및 단일화)
window.selectMercenary = function(mercId) {
    let target = entities.find(e => e.id === mercId);
    if (target) {
        player.target = target;
        playSound('click');
        addMessage(`[용병 지정] ${target.name}`, '#5ff');
        if (typeof openPetUI === 'function') openPetUI(target);
    }
};

// ==========================================
// 💡 [모바일 하단 레이아웃 자동 보정 및 버프 아이콘 1줄 중앙 배치]
// ==========================================
function injectMobileBottomFix() {
    if (document.getElementById('mobile-bottom-fix')) {
        document.getElementById('mobile-bottom-fix').remove();
    }
    const style = document.createElement('style');
    style.id = 'mobile-bottom-fix';
    
    // 💡 미디어 쿼리로 모바일(768px 이하)에서만 UI를 덮어쓰도록 엄격히 분리
    style.innerHTML = `
        @media (max-width: 768px) {
            /* 하단 바 여백 완벽 제거 및 바닥 밀착 */
            #ui-bottom-bar {
                position: absolute !important;
                bottom: 0 !important;
                margin: 0 !important;
            }

            /* 버프 아이콘을 화면 정중앙 & 하단 체력바 바로 위로 배치 */
            #buff-list {
                position: absolute !important;
                top: auto !important;
                bottom: 130px !important; /* 모바일 하단바(125px) 바로 위 */
                left: 50% !important;     /* 화면 가로 중앙 */
                transform: translateX(-50%) !important; 
                display: flex !important;
                justify-content: center !important; 
                flex-wrap: wrap !important;
                width: 100% !important;
                pointer-events: none !important; 
            }
            
            #buff-list .buff-wrap {
                pointer-events: auto !important;
                width: 24px !important;  /* 모바일용 버프 크기 축소 */
                height: 24px !important; /* 모바일용 버프 크기 축소 */
                margin-right: 2px !important;
            }

            #buff-list .buff-wrap div {
                width: 20px !important;
                height: 20px !important;
                font-size: 12px !important;
            }
            
            /* 왼쪽 스탯창 글씨 간격 바짝 붙이기 */
            #ui-left {
                padding: 2px 2px !important;
                justify-content: space-evenly !important;
            }
            #ui-left .stat-row {
                line-height: 1.1 !important;
                margin: 0 !important;
            }
            
            /* HP/MP 바 두껍게 조절 */
          #ui-bars { padding: 3px 5px !important; gap: 2px !important; }
            .bar-wrap { height: 13px !important; } 
            .bar-text { 
                font-size: 8.5px !important; 
                line-height: 13px !important; 
                font-weight: bold !important;
                text-shadow: 1px 1px 1px #000, -1px -1px 1px #000 !important;
            }            
            /* 채팅창 불필요한 여백 제거 */
            #chat-messages {
                max-height: 35px !important; 
                padding: 1px 3px !important;
            }
            #chat-messages div {
                margin: 0 !important;
                padding: 0 !important;
                line-height: 1.2 !important; 
            }
        }
    `;
    document.head.appendChild(style);
}
injectMobileBottomFix();

// ==========================================
// 💡 [인챈트 모드 시 십자 커서 전역 유지 스타일 주입]
// ==========================================
function injectEnchantCursorStyle() {
    if (document.getElementById('enchant-cursor-style')) {
        document.getElementById('enchant-cursor-style').remove();
    }
    const style = document.createElement('style');
    style.id = 'enchant-cursor-style';
    style.innerHTML = `
        body.enchanting-mode, 
        body.enchanting-mode *, 
        body.enchanting-mode .inv-slot, 
        body.enchanting-mode .ce-slot,
        body.enchanting-mode .menu-btn,
        body.enchanting-mode .confirm-btn {
            cursor: crosshair !important;
        }
    `;
    document.head.appendChild(style);
}
injectEnchantCursorStyle();


