// ==========================================
// [1. 최상단 DOM 헬퍼 & 전역 상태 변수 및 멀티플레이 소켓 준비]
// ==========================================
window.getStackKey = function(it) {
    if (!it) return '';
    if (['potion', 'scroll', 'book', 'currency', 'etc'].includes(it.type)) {
        return it.name;
    }
    return it.id || (it.name + '_' + (it.enchantValue || 0) + '_' + (it.magicOptions ? it.magicOptions.join(',') : ''));
};

window.$ = (id) => document.getElementById(id);

// 💡 [최상단 배치] 어디서든 안전하게 호출할 수 있도록 맨 위로 이동
window.closeAllWindows = function() { 
    ['win-inv', 'win-magic', 'win-option', 'win-shop', 'win-pet', 'win-mercenary', 'save-modal', 'confirm-modal', 'item-action-modal', 'teleport-modal', 'win-party', 'win-transfer'].forEach(id => { 
        let el = document.getElementById(id);
        if (el) el.style.display = 'none'; 
    }); 
    if (typeof hideTooltip === 'function') hideTooltip(); 
};


// 서버 주도형 멀티플레이를 위한 Socket.io 객체 준비 (추후 server.js와 연동)
// 💡 [LTE 환경 패킷 지연 차단] WebSocket 단독 연결로 통신 지연 제거
window.socket = typeof io !== 'undefined' ? io({
    transports: ['websocket'],
    upgrade: false,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
}) : null;




if (window.socket) {
    window.socket.on('connect', () => {
        // 첫 접속이 아닌, 서버 재시작으로 인한 재접속일 때만 새로고침 실행
        if (window._hasConnectedOnce) {
            window.location.reload();
        }
        window._hasConnectedOnce = true;
    });
}

if (window.socket) {
    window.socket.on('admin_notice', (payload = {}) => {
        // 로컬 스토리지에 공지사항 영구 저장
        localStorage.setItem('server_global_notice', payload.message);
        
        // 시스템 탭 메시지 출력 및 팝업창 띄우기
        if (typeof addMessage === 'function') {
            addMessage(`📢 [업데이트/공지] ${payload.message}`, '#fd0', 'system');
        }
        if (typeof renderChatMessages === 'function') renderChatMessages();
        
        // 공지가 오면 강제로 시스템 탭을 열고 팝업창 전개
        if (typeof switchChatTab === 'function') switchChatTab('system');
        if (!window.isChatPopupOpen && typeof toggleChatPopup === 'function') toggleChatPopup();
    });
}



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


window.handleSignOut = async function() {
    window.closeAllWindows(); // 💡 window. 추가됨
    const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    
    let emailInput = $('auth-email');
    let rememberChk = $('auth-remember-id');
    if (rememberChk && rememberChk.checked && emailInput && emailInput.value.trim()) {
        localStorage.setItem('lineage_saved_id', emailInput.value.trim());
    }

    if (gameStarted && currentUser) {
        try {
            let saveData = typeof getCompleteSavePayload === 'function' ? getCompleteSavePayload(null, 0) : null; 
            if (sb && saveData) {
                await sb.from('characters').update({
                    name: saveData.player.name, 
                    class_name: (typeof classData !== 'undefined' && classData[saveData.player.charClass]) ? classData[saveData.player.charClass].name : '기사', 
                    data: saveData, 
                    updated_at: new Date()
                }).eq('user_id', currentUser.id).eq('slot_index', currentSlotIndex);
            }
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

window.logout = window.handleSignOut;

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
        if (typeof saveGameToLocal === 'function') saveGameToLocal(true);
        if (typeof autoSaveToSupabase === 'function') await autoSaveToSupabase(true);
    }
    window.closeAllWindows(); // 💡 window. 추가됨
    gameStarted = false;
    
    if($('main-ui')) $('main-ui').style.display = 'none';
    if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'flex';
    if($('auth-box')) $('auth-box').style.display = 'none';
    if($('slot-box')) $('slot-box').style.display = 'block';
    
    if (typeof fetchCharacterList === 'function') await fetchCharacterList(); 
    if (typeof addMessage === 'function') addMessage("캐릭터 선택 화면으로 이동했습니다.", "#fd0");
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
    // 1단계: 먼저 기존 확인 팝업창을 띄우거나, 혹은 텍스트 입력 프롬프트를 띄웁니다.
    showPrompt(`정말 [${charName}] 캐릭터를 영구 삭제하시겠습니까?\n\n확인을 위해 아래 칸에 정확히 <span style="color:#f55; font-weight:bold;">"삭제"</span> 라고 입력해주세요:`, "", 10, (userInput) => {
        // 2단계: 사용자가 입력한 글자가 "삭제"와 일치하는지 검사
        if (userInput !== "삭제") {
            return showAlert("입력한 글자가 일치하지 않습니다. 캐릭터 삭제가 취소되었습니다.");
        }

        // 3단계: 일치할 경우 실제 DB 삭제 실행
        executeCharacterDeletion(slotIndex, charName);
    }, true); // 마지막 인자 true는 텍스트 입력 모드 활성화
};

// 실제 DB 삭제 처리 함수
async function executeCharacterDeletion(slotIndex, charName) {
    const sb = getSupabaseClient();
    if (!sb || !currentUser) return;

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
}

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
const gameOptions = { volume: 0.025, bgmVolume: 0.2, showDamage: true, showNames: true, minLootGrade: 0, isSystemHidden: false, currentChatTab: 'all' };
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

// 💡 [복구 완료] 날아갔던 캐릭터 및 게임 핵심 상태 변수
const getInitialPlayer = () => ({
    name: '리니지 마스터', 
    charClass: 'knight', 
    x: 2000, y: 2000, size: 20, angle: 0, 
    hp: 150, maxHp: 150, mp: 10, maxMp: 10, atk: 3, def: 0, level: 1, exp: 0, maxExp: 100, 
    adena: 500000,
    alignment: 0, str: 18, dex: 14, int: 8, 
    knightHitStack: 0,
    furyUntil: 0,
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


// ==========================================
// 🔊 [오디오 에셋 사전 로드 및 31종 맵/보스 통합 BGM 매니저]
// ==========================================
let bgmAudio = new Audio();
bgmAudio.loop = true;
bgmAudio.volume = 0; 
let fadeInterval = null; 

// 💡 실제 /sound 폴더 내 파일명과 1:1 완벽 매핑 (신규 추가된 8개 파일 포함)
const mapBgmList = {
    // 🌟 1. 주요 마을 및 필드 맵
    'talking_island': '/sound/talking_island.mp3',
    'silver_knight_town': '/sound/silver_knight_town.mp3',
    'elven_forest': '/sound/elven_forest.mp3',
    'gludin': '/sound/gludin.mp3',
    'dragon_valley': '/sound/dragon dungeon.mp3',
    'fire_dragon_nest': '/sound/fire_dragon_nest.mp3',
    'forgotten_island': '/sound/forgotten_island.mp3',
    'heine': '/sound/heine.mp3',
    'oren': '/sound/oren.mp3',
    'aden': '/sound/aden.mp3',
    
    // 🕯️ 2. 던전 및 동굴 구역
    'ti_dungeon': '/sound/ti_dungeon.mp3',
    'ti_dungeon2': '/sound/ti_dungeon2.mp3',
    'gludio_dungeon': '/sound/gludio_dungeon.mp3',
    'ant_cave': '/sound/ant_cave.mp3',
    'dv_dungeon': '/sound/When_the_Lanterns_Go_Out.mp3',
    'giran_dungeon_1': '/sound/When_the_Lanterns_Go_Out.mp3',
    'giran_dungeon_4': '/sound/When_the_Lanterns_Go_Out.mp3',
    'eva_kingdom': '/sound/Beneath_The_Heavy_Stone.mp3',
    'dragon_valley_deep': '/sound/Beneath_The_Heavy_Stone.mp3',
    'lastebad': '/sound/Beneath_the_Iron_Gate.mp3',
    'ivory_tower': '/sound/Beneath_the_Iron_Gate.mp3',

    // 🗼 3. 오만의 탑 시리즈
    'tower_of_insolence_1': '/sound/tower_of_insolence_1.mp3',
    'tower_of_insolence_10': '/sound/tower_of_insolence_10.mp3',
    'tower_of_insolence_30': '/sound/Beneath_the_Iron_Gate.mp3',
    'tower_of_insolence_50': '/sound/tower_of_insolence_50.mp3',
    'tower_of_insolence_70': '/sound/tower_of_insolence_70.mp3',
    'tower_of_insolence_100': '/sound/tower_of_insolence_100.mp3',

    // 🌲 4. 야외/마을 잔여 구역
    'elven_forest_deep': '/sound/Beyond_the_Village_Gate.mp3',
    'dream_island': '/sound/Sunlight_on_the_Cobblestones.mp3',
    'giran': '/sound/A_Hearth_for_the_Wanderer.mp3',

    // 🔥 5. 보스 전용 테마 및 레이드 맵
    'valakas': '/sound/boss_valakas.mp3',
    'antharas': '/sound/boss_antharas.mp3',
    'baphomet': '/sound/boss_baphomet.mp3',
    'deathknight': '/sound/boss_deathknight.mp3',
    'grim_reaper': '/sound/boss_grim_reaper.mp3',
    'awakened_reaper': '/sound/boss_awakened_reaper.mp3',
    'black_knight_chief': '/sound/boss_black_knight_chief.mp3',
    'dantes': '/sound/boss_dantes.mp3',
    'drake': '/sound/boss_drake.mp3',
    'giant_ungoliant': '/sound/boss_giant_ungoliant.mp3',
    'lich_boss': '/sound/boss_lich_boss.mp3',
    'ant_queen': '/sound/boss_antharas.mp3',
    'boss_raid': '/sound/Terra_Tremit.mp3',
    'tower_of_dominance': '/sound/Terra_Tremit.mp3'
};

function fadeInBgm(targetVolume) {
    if (fadeInterval) clearInterval(fadeInterval);
    if (!bgmAudio.src) return;

    bgmAudio.volume = 0;
    let playPromise = bgmAudio.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {});
    }

    let vol = 0;
    let step = Math.max(0.01, targetVolume / 15); 

    fadeInterval = setInterval(() => {
        vol += step;
        if (vol >= targetVolume) {
            bgmAudio.volume = targetVolume;
            clearInterval(fadeInterval);
            fadeInterval = null;
        } else {
            bgmAudio.volume = vol;
        }
    }, 80);
}

// 💡 맵 이동 및 보스전 자동 전환 통합 BGM 교체 함수
window.changeBGM = function(keyOrMapId) {
    if (!bgmAudio) return;

    // 보스 키이거나 보스 레이드 맵인 경우 보스 전용 테마 우선 재생
    let isBossKey = mapBgmList[keyOrMapId] && keyOrMapId.match(/valakas|antharas|baphomet|deathknight|reaper|dantes|drake|lich|chief|ungoliant/);
    let newSrc = mapBgmList[keyOrMapId];

    if (!newSrc) {
        newSrc = isBossKey ? '/sound/boss_valakas.mp3' : '/sound/Where_the_Path_Divides.mp3';
    }

    let currentFileName = bgmAudio.src ? decodeURI(bgmAudio.src.split('/').pop()) : '';
    let targetFileName = decodeURI(newSrc.split('/').pop());

    if (currentFileName === targetFileName && !bgmAudio.paused) {
        return; 
    }

    if (fadeInterval) {
        clearInterval(fadeInterval);
        fadeInterval = null;
    }

    bgmAudio.pause();
    bgmAudio.src = newSrc;
    bgmAudio.load();

    if (gameOptions.bgmVolume > 0 && gameStarted) {
        fadeInBgm(gameOptions.bgmVolume);
    }
};

// 보스 몬스터 조우 시 외부에서 호출하는 전역 헬퍼 함수
window.playBossThemeByEntity = function(targetEntity) {
    if (!targetEntity || !targetEntity.isBoss) return;
    
    let matchedKey = 'valakas'; 
    for (let key in mapBgmList) {
        if (targetEntity.id.includes(key) || (targetEntity.name && targetEntity.name.includes(key))) {
            matchedKey = key;
            break;
        }
    }
    window.changeBGM(matchedKey);
};

const customAudio = {
    swing: [new Audio('/sound/sword-miss3.ogg'), new Audio('/sound/fishing-cast.ogg')],
    hit_flesh: [new Audio('/sound/sword-flesh3.ogg'), new Audio('/sound/sword-flesh4.ogg')],
    hit_stone: [new Audio('/sound/sword-stone.ogg')],
    hit_armor: [new Audio('/sound/sword-leather.ogg')],
    player_hit: [new Audio('/sound/player-hurt-male.ogg')],
    player_dead: [new Audio('/sound/player-death-male.ogg')],
    drink: [new Audio('/sound/fishing-plop.ogg')],
    buy: [new Audio('/sound/coin-spill.ogg')],
    chest: [new Audio('/sound/chest-open.ogg')],
    break: [new Audio('/sound/crate-break.ogg'), new Audio('/sound/fishing-snap.ogg')],
    boss_roar: [new Audio('/sound/dungeon-roar.ogg')],
    death_slime: [new Audio('/sound/fishing-reel.ogg')],
    death_boss_demon: [new Audio('/sound/ogre-boss-death.ogg')], 
    death_boss_human: [new Audio('/sound/orc-boss-death.ogg')],
    death_dragon: [new Audio('/sound/cyclop-death.ogg')],
    death_female: [new Audio('/sound/orc-female-death.ogg')],
    death_creepy: [new Audio('/sound/scp939-death.ogg')],
    death_reptile: [new Audio('/sound/lizardfolk-death.ogg')],
    death_kobold: [new Audio('/sound/kobold-death.ogg')],
    death_troll: [new Audio('/sound/troll-death.ogg')],
    death_ogre: [new Audio('/sound/ogre-death.ogg')],
    death_orc: [new Audio('/sound/orc-death.ogg')],
    death_golem: [new Audio('/sound/stone-golem-death.ogg')],
    death_beast: [new Audio('/sound/gnoll-death.ogg')],
    death_common: [new Audio('/sound/hobgoblin-death.ogg'), new Audio('/sound/goblin-death.ogg')]
};

const soundMultipliers = {
    swing: 0.2, hit_flesh: 0.3, hit_stone: 0.3, hit_armor: 0.3,
    player_hit: 0.4, player_dead: 0.8,
    drink: 0.4, buy: 0.5, chest: 0.5, break: 0.5, boss_roar: 0.8,
    death_boss_demon: 0.6, death_boss_human: 0.6, death_dragon: 0.6,
    death_female: 0.2, death_creepy: 0.2, death_reptile: 0.2,
    death_kobold: 0.2, death_troll: 0.25, death_ogre: 0.25, 
    death_orc: 0.2, death_golem: 0.25, death_beast: 0.2,
    death_common: 0.2, death_slime: 0.15, death_bugbear: 0.25
};

const soundCooldowns = {
    player_hit: 450, hit_flesh: 120, hit_stone: 150, hit_armor: 150,
    swing: 100, drink: 300, 
    death_female: 150, death_creepy: 150, death_reptile: 150,
    death_kobold: 150, death_beast: 150, death_common: 120, death_orc: 120
};

let audioCtx = null;
const lastSoundPlayTime = {};

function initAudio() { 
    if(!audioCtx) { 
        const AudioContext = window.AudioContext || window.webkitAudioContext; 
        if(AudioContext) audioCtx = new AudioContext(); 
    } 
    if (bgmAudio.paused && gameOptions.bgmVolume > 0) {
        fadeInBgm(gameOptions.bgmVolume);
    }
}

function playSound(type, targetEntity = null) {
    try {
        if (!gameStarted || !audioCtx || gameOptions.volume <= 0) return;
        let baseVol = gameOptions.volume * 20; 

        if (targetEntity && targetEntity !== player) {
            if (typeof isEntityOnScreen === 'function' && !isEntityOnScreen(targetEntity)) {
                return; 
            }
        }

        let now = audioCtx.currentTime;

        if (type === 'bow') {
            const osc = audioCtx.createOscillator(); 
            let gain = audioCtx.createGain(); 
            gain.connect(audioCtx.destination);
            osc.connect(gain); 
            osc.type = 'sine'; 
            osc.frequency.setValueAtTime(800, now); 
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.08); 
            gain.gain.setValueAtTime(baseVol * 0.04, now); 
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08); 
            osc.start(now); osc.stop(now + 0.08); 
            return;
        }

        let soundCategory = null;
        if (type === 'swing') soundCategory = 'swing';
        else if (type === 'drink') soundCategory = 'drink';
        else if (type === 'buy' || type === 'loot') soundCategory = 'buy';
        else if (type === 'chest') soundCategory = 'chest';
        else if (type === 'break') soundCategory = 'break';
        else if (type === 'player_hit') soundCategory = 'player_hit';
        else if (type === 'player_dead') soundCategory = 'player_dead';
        else if (type === 'boss_roar') soundCategory = 'boss_roar';
        else if (type === 'monster_hit') {
            if (targetEntity) {
                let n = targetEntity.name || '';
                if (n.includes('골렘') || n.includes('돌') || n.includes('가고일')) soundCategory = 'hit_stone';
                else if (n.includes('해골') || n.includes('기사') || n.includes('데스나이트') || n.includes('단테스') || n.includes('아머')) soundCategory = 'hit_armor';
                else soundCategory = 'hit_flesh';
            } else {
                soundCategory = 'hit_flesh';
            }
        }
        else if (type === 'monster_dead') {
            if (targetEntity) {
                let n = targetEntity.name || '';
                if (targetEntity.isBoss) {
                    if (n.includes('드래곤') || n.includes('드레이크') || n.includes('안타라스') || n.includes('발라카스')) soundCategory = 'death_dragon';
                    else if (n.includes('여왕') || n.includes('퀸') || n.includes('아이리스') || n.includes('제니스')) soundCategory = 'death_female';
                    else if (n.includes('대장') || n.includes('커츠') || n.includes('단테스')) soundCategory = 'death_boss_human';
                    else if (n.includes('웅골리언트')) soundCategory = 'death_creepy';
                    else soundCategory = 'death_boss_demon'; 
                } else {
                    if (n.includes('서큐버스') || n.includes('머메이드') || n.includes('기란 간수') || 
                        n.includes('메두사') || n.includes('하피') || n.includes('페어리') ||
                        n.includes('리자드맨') || n.includes('악어') || n.includes('크러스테시안') || 
                        n.includes('머맨') || n.includes('본 일') || n.includes('실라칸스')) {
                        soundCategory = 'death_reptile';
                    }
                    else if (n.includes('버그베어') || n.includes('오우거')) soundCategory = 'death_ogre';
                    else if (n.includes('슬라임') || n.includes('괴물 눈') || n.includes('브롭') || n.includes('해파리')) soundCategory = 'death_slime';
                    else if (n.includes('오크')) soundCategory = 'death_orc';
                    else if (n.includes('셀로브') || n.includes('스콜피온') || n.includes('개미') || n.includes('아라크네') || n.includes('크로')) soundCategory = 'death_creepy';
                    else if (n.includes('해골') || n.includes('스파토이') || n.includes('코볼트') || n.includes('임프') || n.includes('병사') || n.includes('구울') || n.includes('좀비')) soundCategory = 'death_kobold';
                    else if (n.includes('가고일') || n.includes('키메라') || n.includes('리빙 아머')) soundCategory = 'death_troll';
                    else if (n.includes('골렘')) soundCategory = 'death_golem';
                    else if (n.includes('늑대') || n.includes('켈베로스') || n.includes('도베르만') || n.includes('셰퍼드') || n.includes('멧돼지') || n.includes('유니콘') || n.includes('야수')) soundCategory = 'death_beast';
                    else soundCategory = 'death_common'; 
                }
            } else {
                soundCategory = 'death_common';
            }
        }

        if (soundCategory && customAudio[soundCategory]) {
            let cooldown = soundCooldowns[soundCategory] || 0;
            if (cooldown > 0) {
                let lastTime = lastSoundPlayTime[soundCategory] || 0;
                if (performance.now() - lastTime < cooldown) return;
                lastSoundPlayTime[soundCategory] = performance.now();
            }
            let arr = customAudio[soundCategory];
            let audioNode = arr[Math.floor(Math.random() * arr.length)].cloneNode();
            
            let multiplier = soundMultipliers[soundCategory] || 0.6;
            audioNode.volume = Math.min(1.0, baseVol * multiplier);
            audioNode.play().catch(() => {});
            return; 
        }

        let vol = gameOptions.volume;
        let gain = audioCtx.createGain(); gain.connect(audioCtx.destination);

        if (type === 'fireball') { 
            let bufferSize = audioCtx.sampleRate * 0.4; 
            let buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate); 
            let data = buffer.getChannelData(0); 
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1; 
            let noise = audioCtx.createBufferSource(); noise.buffer = buffer; 
            let filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; 
            filter.frequency.setValueAtTime(400, now); 
            filter.frequency.exponentialRampToValueAtTime(100, now + 0.4); 
            noise.connect(filter).connect(gain); 
            gain.gain.setValueAtTime(vol * 0.3, now); 
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4); 
            noise.start(now); 
        }
        else if (type === 'lightning') { 
            const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='sawtooth'; 
            osc.frequency.setValueAtTime(400,now); osc.frequency.exponentialRampToValueAtTime(50,now+0.2); 
            gain.gain.setValueAtTime(vol * 0.2, now); 
            gain.gain.exponentialRampToValueAtTime(0.001,now+0.2); 
            osc.start(now); osc.stop(now+0.2); 
        }
        else if (type === 'heal') { 
            const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='sine'; 
            osc.frequency.setValueAtTime(400,now); osc.frequency.linearRampToValueAtTime(800,now+0.3); 
            gain.gain.setValueAtTime(vol * 0.2, now); 
            gain.gain.linearRampToValueAtTime(0.001,now+0.4); 
            osc.start(now); osc.stop(now+0.4); 
        }
        else if (type === 'spell') { 
            const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='sine';
            osc.frequency.setValueAtTime(300,now); osc.frequency.exponentialRampToValueAtTime(100,now+0.25); 
            gain.gain.setValueAtTime(vol * 0.15, now); 
            gain.gain.exponentialRampToValueAtTime(0.001,now+0.25); 
            osc.start(now); osc.stop(now+0.25); 
        }
        else if (type === 'energy_bolt') { 
            const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='triangle'; 
            osc.frequency.setValueAtTime(500, now); osc.frequency.exponentialRampToValueAtTime(200, now+0.15); 
            gain.gain.setValueAtTime(vol * 0.1, now); 
            gain.gain.exponentialRampToValueAtTime(0.001, now+0.15); 
            osc.start(now); osc.stop(now+0.15); 
        }
        else if (type === 'click') { 
            const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type='triangle'; 
            osc.frequency.setValueAtTime(800,now); 
            gain.gain.setValueAtTime(vol * 0.1, now); 
            gain.gain.exponentialRampToValueAtTime(0.001,now+0.05); 
            osc.start(now); osc.stop(now+0.05); 
        }
        else if (type === 'disintegrate') { 
            const osc = audioCtx.createOscillator(); osc.connect(gain); osc.type = 'sine'; 
            osc.frequency.setValueAtTime(1800, now); osc.frequency.exponentialRampToValueAtTime(200, now + 1.0); 
            gain.gain.setValueAtTime(vol * 0.5, now); 
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0); 
            osc.start(now); osc.stop(now + 1.0); 
        }
    } catch(e) {}
}

window.playSound = playSound;

window.updateOptions = function() { 
    if ($('opt-vol')) {
        let vol = $('opt-vol').value; 
        gameOptions.volume = (vol / 100) * 0.05; 
    }
    
    if ($('opt-bgm-vol')) {
        let bgmVol = $('opt-bgm-vol').value;
        gameOptions.bgmVolume = (bgmVol / 100) * 0.5; 
        
        if (gameOptions.bgmVolume === 0) {
            if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
            bgmAudio.pause(); 
            bgmAudio.volume = 0;
        } else {
            if (!fadeInterval) {
                bgmAudio.volume = gameOptions.bgmVolume;
            }
            if (bgmAudio.paused && gameStarted) fadeInBgm(gameOptions.bgmVolume);
        }
    }

    gameOptions.showDamage = $('opt-dmg') ? $('opt-dmg').checked : true; 
    gameOptions.showNames = $('opt-names') ? $('opt-names').checked : true; 
    gameOptions.minLootGrade = parseInt($('opt-loot-grade')?.value) || 0; 
    
    if (gameOptions.volume > 0 && gameStarted) playSound('click');
};

window.addEventListener('click', initAudio, {once:true});
window.addEventListener('touchstart', initAudio, {once:true});

// [게임 진입 로직 연동 (데이터 세팅)]
async function executeLogin(slotIndex, charObj, loadedData) {
    try {
        window.closeAllWindows(); // 💡 window. 추가됨
        currentSlotIndex = slotIndex;
        window.mySessionToken = Date.now().toString() + Math.random().toString(36).substring(2);
        loadedData.session_token = window.mySessionToken;
        loadedData.last_sync_time = Date.now();

        const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (sb) {
            await sb.from('characters').update({ data: loadedData }).eq('id', charObj.id);
        }

        let freshPlayer = typeof getInitialPlayer === 'function' ? getInitialPlayer() : { name: '모험가' };
        if (loadedData.player) {
            if (typeof deepMerge === 'function') deepMerge(freshPlayer, loadedData.player);
        }
        for(let k in player) delete player[k];
        Object.assign(player, freshPlayer);

        if (loadedData.options) {
            Object.assign(gameOptions, loadedData.options);
            if ($('opt-vol')) $('opt-vol').value = Math.floor((gameOptions.volume / 0.05) * 100);
            if ($('opt-dmg')) $('opt-dmg').checked = gameOptions.showDamage;
            if ($('opt-bgm-vol')) $('opt-bgm-vol').value = Math.floor((gameOptions.bgmVolume / 0.5) * 100);
            if ($('opt-dmg')) $('opt-dmg').checked = gameOptions.showDamage;
            if ($('opt-names')) $('opt-names').checked = gameOptions.showNames;
            if ($('opt-loot-grade')) $('opt-loot-grade').value = gameOptions.minLootGrade || 0;
            if (gameOptions.isSystemHidden !== undefined) {
              window.isSystemHidden = gameOptions.isSystemHidden;
               let chk1 = document.getElementById('hide-system-chk');
              let chk2 = document.getElementById('pop-hide-system-chk');
              if (chk1) chk1.checked = window.isSystemHidden;
            if (chk2) chk2.checked = window.isSystemHidden;
           }
            if (gameOptions.currentChatTab) {
            switchChatTab(gameOptions.currentChatTab);
             }
        }

        window.hotkeys = loadedData.hotkeys || new Array(8).fill(null); 
        hotkeys = window.hotkeys;
        if (typeof applyStatsPostLoad === 'function') applyStatsPostLoad();

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

        if (typeof changeMap === 'function') changeMap(targetMap, targetX, targetY);
        if($('main-menu-overlay')) $('main-menu-overlay').style.display = 'none'; 
        if($('main-ui')) $('main-ui').style.display = 'block';

        gameStarted = true; 
        if (typeof updateOptions === 'function') updateOptions(); 

        if (typeof update === 'function') {
            requestAnimationFrame(update);
        } else if (typeof window.update === 'function') {
            requestAnimationFrame(window.update);
        }

        if (typeof addMessage === 'function') addMessage(`[${player.name}] 캐릭터로 접속했습니다.`, "#5f5");
        if (typeof startSessionCheckTimer === 'function') startSessionCheckTimer();
        if (!sessionStorage.getItem('first_login_notice_shown')) {
            sessionStorage.setItem('first_login_notice_shown', 'true');
            setTimeout(() => {
                if (typeof window.showClassPassiveInfo === 'function') {
                    window.showClassPassiveInfo();
                }
            }, 1000);
        }


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
        if (typeof showAlert === 'function') showAlert("게임 진입 중 오류가 발생했습니다: " + err.message);
        loadedData.last_sync_time = 0;
        const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (sb) {
            await sb.from('characters').update({ data: loadedData }).eq('id', charObj.id);
        }
    }
}


// ==========================================
// [4. UI 메시지, 스탯 계산, 버프]
// ==========================================

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
            if (eq.dmgReduct) totalDmgReduction += eq.dmgReduct;
            if (eq.speed) bonusSpeed += eq.speed;
            if (eq.potionEffect) totalPotionEffect += eq.potionEffect;

            if (eq.magicOptions && Array.isArray(eq.magicOptions)) {
                eq.magicOptions.forEach(opt => {
                    let match = opt.match(/\+(\d+)/);
                    let val = match ? parseInt(match[1]) : 0;

                    if (opt.includes('STR')) player.str += val;
                    if (opt.includes('DEX')) player.dex += val;
                    if (opt.includes('INT')) player.int += val;

                    if (opt.includes('추가 대미지') || opt.includes('근거리 대미지') || opt.includes('속성')) meleeBonus += val;
                    if (opt.includes('원거리 대미지') || opt.includes('속성')) rangedBonus += val;
                    if (opt.includes('SP') || opt.includes('마법 공격력')) totalSp += val;
                    if (opt.includes('추가 방어력') || opt.includes('[보호]')) totalDef += val;
                    if (opt.includes('MR') || opt.includes('마법 방어력')) totalMr += val;
                    if (opt.includes('대미지 감소')) totalDmgReduction += val;
                });
            }

            if (k !== 'weapon') {
                totalDef += (eq.def || 0) + (eq.enchantValue || 0);
                if (eq.mr || eq.name.includes('마법') || eq.name.includes('면갑') || eq.name.includes('반지') || eq.name.includes('망토')) {
                    totalMr += (eq.enchantValue || 0);
                }
            }
        }
    }

    player.sp = totalSp;
    player.totalMr = totalMr;
    player.totalDmgReduction = totalDmgReduction;
    player.totalPotionEffect = totalPotionEffect;
    player.currentSpeed = 180 + bonusSpeed;
    
    let wp = player.equip.weapon; 
    let wpAtk = wp ? (wp.atk || 0) + (wp.enchantValue || 0) : 0;
    let enchantBonus = wp ? Math.floor((wp.enchantValue || 0) * 2.0) : 0;
    
    // 💡 [요정 클래스 계산식 완벽 밸런싱] 요정의 원거리 기본 계수를 3.8로 대폭 상향
    if (wp && wp.isBow) {
        player.atk = Math.max(1, Math.floor((player.dex - 10) * 3.8)) + Math.floor(lv / 3) + wpAtk + enchantBonus + rangedBonus;
    } else {
        player.atk = Math.max(1, Math.floor((player.str - 10) * 3.5)) + Math.floor(lv / 3) + wpAtk + enchantBonus + meleeBonus;
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
    target.buffs = target.buffs || {};
    
    let keyName = name;
    if (name.includes('가속') || name.includes('초록') || name.includes('윈드') || name.includes('홀리')) keyName = '가속(헤이스트)';
    else if (name.includes('용기')) keyName = '용기물약';
    else if (name.includes('와퍼') || name.includes('엘븐')) keyName = '엘븐와퍼';
    
    if (target.buffs[keyName]) { 
        target.buffs[keyName].expire = now + duration;
        target.buffs[keyName].maxDuration = duration; 
        if (typeof addMessage === 'function') addMessage(`[${target.name} - ${keyName}] 지속시간 갱신`, '#5f5'); 
    } else { 
        target.buffs[keyName] = { expire: now + duration, maxDuration: duration, icon: icon, type: type, val: val }; 
        if (typeof addMessage === 'function') addMessage(`[${target.name} - ${keyName}] 버프 적용됨`, '#5f5'); 
    } 
    if (typeof updateUI === 'function') updateUI(); 
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

    if (typeof playSound === 'function') playSound('player_dead'); // 💡 남성 사망 소리
    addMessage("💀 사망하셨습니다... 3초 후 안전지대에서 부활합니다.", "#f55");
    setTimeout(() => {
        window.respawnPlayer();
    }, 3000);
};

function updateUI() {
    if (player && player.hp <= 0 && !player.isDead && gameStarted) {
        handlePlayerDeath();
        return;
    }
    
    recalculateStats();

    let totalDef = player.def; 
    let totalAtk = player.atk; 
    let totalMr = player.totalMr || (player.int * 2); 

    let totalHpBonus = 0; 
    let totalMpBonus = 0; 
    let totalHpRegen = 0; 
    let totalMpRegen = 0; 
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
    player.totalHpRegen = totalHpRegen; 
    player.totalMpRegen = totalMpRegen; 
    player.totalDmgReduction = totalDmgReduction;
    player.totalMr = totalMr; 
    if (player.buffs['실드']) totalDef += (player.buffs['실드'].val || 2);
    if (player.buffs['어드밴스 스피릿']) { totalHpBonus += 50; totalMpBonus += 50; }
    if (player.buffs['이뮨 투 함']) player.totalDmgReduction += (player.buffs['이뮨 투 함'].val || 10);

    // 💡 [핵심] window 전역 및 player 객체에 총 최대 HP/MP 직접 동기화하여 루프 멈춤 방지
    window.currentMaxHp = player.maxHp + totalHpBonus; 
    window.currentMaxMp = player.maxMp + totalMpBonus; 
    currentMaxHp = window.currentMaxHp;
    currentMaxMp = window.currentMaxMp;

    if(player.hp > currentMaxHp) player.hp = currentMaxHp; 
    if(player.mp > currentMaxMp) player.mp = currentMaxMp;

    if($('st-lv')) $('st-lv').innerText = player.level; 
    if($('st-class')) {
    let cName = classData[player.charClass] ? classData[player.charClass].name : '기사';
    // 💡 클래스명 자체에 깔끔한 클릭 가능 테두리와 초미니 [?] 뱃지 부여
    $('st-class').innerHTML = `<span style="cursor:pointer; border:1px solid #38bdf8; padding:1px 5px; border-radius:3px; background:rgba(56,189,248,0.15); color:#fff; display:inline-flex; align-items:center; gap:2px;" onclick="window.showClassPassiveInfo()">${cName}<span style="color:#38bdf8; font-size:9px; font-weight:bold;">?</span></span>`;
}
    if($('st-stats')) $('st-stats').innerText = `S:${player.str} D:${player.dex} I:${player.int}`;
    if($('st-ac')) $('st-ac').innerText = `-${totalDef} / ${totalMr}`; 
    if($('st-atk')) { $('st-atk').innerText = `${totalAtk} / ${player.sp || 0}`; $('st-atk').style.color = '#aaf'; }
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


let windowZIndex = 100000;

window.bringToFront = function(id) {
    let el = document.getElementById(id);
    if (el) { 
        windowZIndex += 20; 
        el.style.setProperty('z-index', windowZIndex, 'important'); 
    }
};

window.autoCenterWindow = function(id, forceCenter = true) {
    const el = document.getElementById(id);
    if (!el) return;

    let wasHidden = el.style.display === 'none';
    if (wasHidden) { 
        el.style.visibility = 'hidden'; 
        el.style.display = 'flex'; 
    }

    // 화면 크기 초과 방지 (X 닫기 버튼이 화면 밖으로 나가지 않도록 안전 여백 10px 확보)
    let maxW = window.innerWidth - 16;
    let maxH = window.innerHeight - 16;
    if (el.offsetWidth > maxW) el.style.width = maxW + 'px';
    if (el.offsetHeight > maxH) el.style.maxHeight = maxH + 'px';

    let cx = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, (window.innerWidth - el.offsetWidth) / 2));
    let cy = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, (window.innerHeight - el.offsetHeight) / 2));
    
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.setProperty('transform', 'none', 'important');

    if (wasHidden) { 
        el.style.display = 'none'; 
        el.style.visibility = 'visible'; 
    }
};
window.toggleWindow = function(id) { 
    playSound('click'); 
    const el = $(id); 
    if (!el) return;
    
    hideTooltip(); // 창을 열고 닫을 때 잔여 툴팁 즉시 제거

    if (el.style.display === 'flex' || el.style.display === 'block') { 
        el.style.display = 'none'; 
    } else { 
        el.style.display = 'flex'; 
        if(id === 'win-inv') { switchInvTab('bag'); renderInventory(); }
        if(id === 'win-magic') renderMagicBook(); 
        autoCenterWindow(id, true);
        bringToFront(id);
    } 
};



function initWindowDragHelper(e) {
    let winEl = e.target.closest('.window, .modal-window, [id^="win-"], [id$="-modal"]');
    if (winEl && !e.target.closest('button') && !e.target.closest('input')) {
        let rect = winEl.getBoundingClientRect();
        let clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        // 💡 [핵심] 창의 상단 45px (제목 바 영역)만 드래그 가능하도록 제한하여 내부 리스트 스크롤 보장
        if (clientY - rect.top <= 45) {
            let winId = winEl.id;
            if (winId && typeof window.startDrag === 'function') window.startDrag(e, winId);
        }
    }
}
document.addEventListener('mousedown', initWindowDragHelper);
document.addEventListener('touchstart', initWindowDragHelper, { passive: true });


window.toggleAutoHunt = function() {
    if (typeof playSound === 'function') playSound('click');
    if (!player.autoHunt && typeof isInSafeZone === 'function' && isInSafeZone(currentMap, player.x, player.y)) {
        if (typeof addMessage === 'function') addMessage("안전지대에서는 자동사냥을 켤 수 없습니다.", '#f55');
        return;
    }
    
    player.autoHunt = !player.autoHunt;
    
    if (player.autoHunt) {
        if (typeof addMessage === 'function') addMessage("자동 사냥 모드가 활성화되었습니다.", '#5f5');
    } else {
        player.isMoving = false;
        player.moveX = undefined;
        player.moveY = undefined;
        player.selectedManualSpell = null;
        if (typeof addMessage === 'function') addMessage("수동 조작 모드로 전환되었습니다.", '#aaa');
    }
    if (typeof updateUI === 'function') updateUI();
};

window.toggleAutoPotion = function() {
    if (typeof playSound === 'function') playSound('click');
    player.autoPotion = !player.autoPotion;
    
    if (player.autoPotion) {
        if (typeof addMessage === 'function') addMessage("자동 물약 복용이 켜졌습니다 (HP 70% / MP 20%).", '#5f5');
    } else {
        if (typeof addMessage === 'function') addMessage("자동 물약 복용이 꺼졌습니다.", '#aaa');
    }
    if (typeof updateUI === 'function') updateUI();
};

window.respawnPlayer = function() {
    // 💡 만약 현재 맵이 보스 레이드('boss_raid')라면 마을로 보내지 않고 그 자리(안전 좌표)에서 즉시 부활!
    if (currentMap === 'boss_raid') {
        player.hp = currentMaxHp;
        player.mp = currentMaxMp;
        player.isDead = false;
        player.autoHunt = true; // 레이드 중이므로 사냥 유지 가능
        player.target = null;
        player.isMoving = false;

        // 보스 방 입장 초기 좌표로 부활
        player.x = 2000;
        player.y = 3500;

        if (typeof addMessage === 'function') {
            addMessage("💀 사망하였으나 차원의 틈새 안에서 부활했습니다! 전투를 계속합니다.", "#f55");
        }
    } else {
        // 일반 필드인 경우 기존처럼 마을로 부활
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
        player.autoHunt = false;
        player.autoPotion = false;
        player.target = null;
        player.isMoving = false;
        
        changeMap(targetMap, targetX, targetY);
        addMessage("마을 안전지대에서 부활하였습니다.", "#f55");
    }

    if (window.socket && currentUser) {
        window.socket.emit('player_update', {
            name: player.name, charClass: player.charClass,
            x: player.x, y: player.y, hp: player.hp, maxHp: currentMaxHp, map: currentMap,
            equip: player.equip
        });
    }

    updateUI();
};

// ==========================================
// [5. 툴팁 & 단축키]
// ==========================================
function getBookColor(name) {
    if(!name) return '#ffffff';
    if(name.includes('기술서')) return '#f87171'; // 기사 빨간색
    if(name.includes('정령의 수정')) return '#4ade80'; // 요정 초록색
    if(name.includes('마법서')) return '#60a5fa'; // 마법사 파란색
    return '#ffffff';
}

function getItemDetailsHTML(it, isEq) {
    let dName = it.isEnchantScroll ? `[${it.enchantType}] ${it.name}` : (it.enchantValue && isEq ? `+${it.enchantValue} ${it.name}` : it.name);
    let gIdx = it.grade || 0; 
    let titleColor = it.type === 'book' ? getBookColor(it.name) : gradeColors[gIdx] || '#fff';
    
    let html = `<b class="tooltip-title" style="color:${titleColor}">${dName}</b><span style="font-size:12px; color:#aaa; margin-left:5px;">[${gradeNames[gIdx]}]</span><br>`; 
    
   if (it.type === 'book') {
    let mName = it.magicName || it.name.replace(/.*\(|\).*/g, '').trim();
    let tier = (typeof getMagicLevelTier === 'function') ? getMagicLevelTier(mName) : 1;
    let reqLv = tier === 4 ? 45 : (tier === 3 ? 30 : (tier === 2 ? 15 : 1));
    html += `<span style="color:#fd0; font-weight:bold;">요구 레벨: Lv.${reqLv} 이상</span><br>`;
}

    if(it.atk) html += `공격력: ${it.atk}<br>`; 
    if(it.def) html += `방어력: ${it.def}<br>`;
    
    if(it.str) html += `<div style="color:#fff;">STR +${it.str}</div>`;
    if(it.dex) html += `<div style="color:#fff;">DEX +${it.dex}</div>`;
    if(it.int) html += `<div style="color:#fff;">INT +${it.int}</div>`;
    if(it.hpBonus) html += `<div style="color:#f55;">최대 HP +${it.hpBonus}</div>`;
    if(it.mpBonus) html += `<div style="color:#55f;">최대 MP +${it.mpBonus}</div>`;
    if(it.hpRegen) html += `<div style="color:#f88;">HP 회복률 +${it.hpRegen}</div>`;
    if(it.mpRegen) html += `<div style="color:#88f;">MP 회복률 +${it.mpRegen}</div>`;
    if(it.sp) html += `<div style="color:#a855f7;">SP (마법공격력) +${it.sp}</div>`;
    if(it.mr) html += `<div style="color:#5cf;">MR (마법방어력) +${it.mr}</div>`;
    if(it.dmgReduct) html += `<div style="color:#fd0;">대미지 감소 +${it.dmgReduct}</div>`;

    let mrBonus = (it.type !== 'weapon' && (it.enchantValue || 0) > 0) ? `<br><span style="color:#5cf;">마법 방어력(MR): +${it.enchantValue} (강화 보너스)</span>` : '';
    if (mrBonus) html += mrBonus;

    if(it.skill) html += `<div class="tooltip-magic">발동: ${it.skill}</div>`; 
    if(it.desc) html += `<div class="tooltip-desc" style="color:#ccc; margin-top:4px;">${it.desc}</div>`;

    if(it.magicOptions && it.magicOptions.length > 0) { 
        html += `<div style="margin-top:5px; border-top:1px dashed #555; padding-top:5px;">`; 
        it.magicOptions.forEach((opt) => { 
            html += `<div class="tooltip-bonus" style="display:flex; justify-content:space-between; align-items:center; margin:2px 0;">
                        <span>✨ ${opt}</span>
                     </div>`; 
        }); 
        html += `</div>`; 
    }
    let extra = typeof getExtraDesc === 'function' ? getExtraDesc(it.name) : ''; 
    if(extra) html += `<div class="tooltip-desc" style="color:#ada; margin-top:4px;">${extra}</div>`;
    
    // 💡 마법서 툴팁 하단에 쿨타임 초 단위 표시 추가
    if (it.type === 'book' && it.magicName && typeof magicDb !== 'undefined' && magicDb[it.magicName]) { 
        let mData = magicDb[it.magicName];
        let cdSec = mData.cd ? (mData.cd / 1000).toFixed(1) : 0;
        html += `<div class="tooltip-desc" style="color:#aaf; margin-top:6px; border-top:1px dashed #555; padding-top:5px;">
                    ${mData.desc || ''}<br>
                    <span style="color:#facc15; font-weight:bold; margin-top:3px; display:inline-block;">⏱️ 쿨타임: ${cdSec}초</span>
                 </div>`; 
    }
    return html;
}
window.showTooltip = function(e, dataStr, isEq) { let it = JSON.parse(decodeURIComponent(dataStr)); let t = $('tooltip'); t.innerHTML = getItemDetailsHTML(it, isEq); t.style.display = 'block'; positionTooltip(e, t); };
window.showHotkeyTooltip = function(e, idx) { if (window.innerWidth < 768 || (e.type && e.type.includes('touch'))) return; const hk = hotkeys[idx]; if(!hk) return; let t = $('tooltip'); let html = ''; if(hk.type === 'item') { html = `<b class="tooltip-title" style="margin:0; font-size:13px;">${hk.id} <span style="font-size:11px; color:#aaa;">[F${idx+5}]</span></b>`; } else if (hk.type === 'magic') { html = `<b class="tooltip-title" style="color:#aaf; margin:0; font-size:13px;">${hk.id} <span style="font-size:11px; color:#aaa;">[F${idx+5}]</span></b>`; } t.innerHTML = html; t.style.display = 'block'; positionTooltip(e, t); };
function positionTooltip(e, t) { let x = (e.clientX || (e.touches && e.touches[0].clientX)) + 15; let y = (e.clientY || (e.touches && e.touches[0].clientY)) + 15; if(x + t.offsetWidth > window.innerWidth) x = window.innerWidth - t.offsetWidth - 10; if(y + t.offsetHeight > window.innerHeight) y = window.innerHeight - t.offsetHeight - 10; t.style.left = x + 'px'; t.style.top = y + 'px'; }
window.hideTooltip = function() { if($('tooltip')) $('tooltip').style.display = 'none'; };

function initHotkeyUI() {
    const hotkeysContainer = $('hotkeys'); if(!hotkeysContainer) return; let html = '';
    for(let i = 0; i < 8; i++) {
        // 💡 우클릭 시 단축키 해제 (oncontextmenu) 추가
        html += `<div class="hotkey-slot" id="hk-${i}" onclick="useHotkey(${i})" ondragover="allowDrop(event)" ondrop="dropHotkey(event, ${i})" onmouseenter="showHotkeyTooltip(event, ${i})" onmouseleave="hideTooltip()" oncontextmenu="clearHotkey(event, ${i})"><span class="hk-label">F${i + 5}</span><div class="hk-icon" id="hk-ic-${i}"></div><span class="hk-count" id="hk-cnt-${i}"></span><div class="cooldown-overlay" id="hk-cd-${i}" style="height:0%;"></div></div>`;
    }
    hotkeysContainer.innerHTML = html;
}

// 💡 우클릭으로 단축키를 완전히 비우는 함수 추가
window.clearHotkey = function(e, idx) {
    e.preventDefault();
    if (hotkeys[idx]) {
        hotkeys[idx] = null;
        // 자동사냥으로 등록된(빨간테두리) 내역도 함께 지움
        if (player && player.activeSpellSlots) {
            let activeIdx = player.activeSpellSlots.indexOf(idx);
            if (activeIdx > -1) player.activeSpellSlots.splice(activeIdx, 1);
        }
        window.hotkeys = hotkeys;
        if (typeof playSound === 'function') playSound('click');
        if (typeof addMessage === 'function') addMessage(`[F${idx+5}] 단축키가 해제되었습니다.`, '#aaa');
        if (typeof updateUI === 'function') updateUI();
    }
};

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
                // 💡 아이콘 매핑이 없으면 기본 이모지 '🪨' 또는 '✨' 출력
                let mIcon = (typeof magicDb !== 'undefined' && magicDb[hk.id]) ? magicDb[hk.id].icon : '✨';
                if (hk.id === '어스 바인드') mIcon = '🪨';
                icon.innerHTML = mIcon; 
                cnt.innerText = ''; 
                
                let mData = typeof magicDb !== 'undefined' ? magicDb[hk.id] : null;
                let lastCast = (player && player.spellCooldowns && player.spellCooldowns[hk.id]) || 0;
                if (mData && mData.cd && lastCast > 0 && now - lastCast < mData.cd) { 
                    cdOverlay.style.height = `${100 - ((now - lastCast) / mData.cd) * 100}%`; 
                } else { 
                    cdOverlay.style.height = '0%'; 
                }
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
    // 전역과 로컬 hotkeys 일치화
    if (!window.hotkeys) window.hotkeys = hotkeys;
    const hk = window.hotkeys[idx] || hotkeys[idx]; 
    if(!hk) return; 

    let now = performance.now(); 
    let isDoubleClick = lastHotkeyClickTime[idx] && (now - lastHotkeyClickTime[idx] < 350); 
    lastHotkeyClickTime[idx] = now;

    if(hk.type === 'item') { 
        if(hk.id === '순간이동 조종 반지' || hk.name === '순간이동 조종 반지') { 
            if (typeof teleportPrompt === 'function') teleportPrompt(); 
        } else { 
            useItemByName(hk.id); 
        } 
    } 
    else if(hk.type === 'magic') { 
        let mData = magicDb[hk.id]; 
        if (!mData) return;
        
        if (isDoubleClick) {
            player.activeSpellSlots = player.activeSpellSlots || []; 
            let existingPos = player.activeSpellSlots.indexOf(Number(idx));
            
            if(existingPos > -1) { 
                player.activeSpellSlots.splice(existingPos, 1); 
                addMessage(`[${hk.id}] 자동사냥 마법 세팅 해제`, '#aaa'); 
            } else { 
                player.activeSpellSlots.push(Number(idx)); 
                addMessage(`[${hk.id}] 자동사냥 마법 세팅 완료`, '#5f5'); 
            }
            player.selectedManualSpell = null;
            // 💡 [핵심] UI와 게임 엔진 간 단축키 배열 강제 복제
            window.hotkeys = [...hotkeys];
        } else {
            if (mData.type === 'buff' || mData.heal) {
                castBuff(hk.id); 
                player.selectedManualSpell = null;
            } else {
                if (player.selectedManualSpell === hk.id) { 
                    player.selectedManualSpell = null; 
                    addMessage(`[${hk.id}] 수동 마법 선택 취소`, '#aaa'); 
                } else { 
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


// ==========================================
// 🌟 [1] 인벤토리 메인 렌더링 & 탭 전환
// ==========================================
window.currentInvTab = 'bag';

window.switchInvTab = function(tabName) {
    if (typeof playSound === 'function') playSound('click');
    window.currentInvTab = tabName;
    
    let tabBag = $('tab-btn-bag');
    let tabEquip = $('tab-btn-equip');
    let contentBag = $('inv-tab-bag');
    let contentEquip = $('inv-tab-equip');

    if (tabBag) tabBag.className = tabName === 'bag' ? 'inv-tab active' : 'inv-tab';
    if (tabEquip) tabEquip.className = tabName === 'equip' ? 'inv-tab active' : 'inv-tab';
    if (contentBag) contentBag.style.display = tabName === 'bag' ? 'block' : 'none';
    if (contentEquip) contentEquip.style.display = tabName === 'equip' ? 'block' : 'none';
    
    if (typeof window.renderInventory === 'function') window.renderInventory();
};


   
window.renderInventory = function() {
    if (!player || !player.inv) return;

    // 💡 [인벤토리 들썩거림 방지] 아이템 변동이 없으면 DOM을 새로 그리지 않음
    let currentInvHash = window.currentInvTab + '_' + player.inv.map(it => (it.id || it.name) + '_' + (it.count || 1) + '_' + (it.enchantValue || 0)).join('|');
    if (window._lastInvRenderHash === currentInvHash && !window.isInventorySelectMode) {
        return; 
    }
    window._lastInvRenderHash = currentInvHash;

 if ($('inv-title')) $('inv-title').innerText = `인벤토리 (${player.inv.length}/100)`;

    // [장비창 렌더링]
    if (window.currentInvTab === 'equip') {
        const equipTabEl = $('inv-tab-equip');
        if (!equipTabEl) return;
        
        let equipHtml = `<div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; padding:12px; width:100%; box-sizing:border-box; align-content:start;">`;
        const slotNames = { helmet:'투구', tshirt:'티셔츠', armor:'갑옷', cloak:'망토', weapon:'무기', shield:'방패', gloves:'장갑', boots:'부츠', belt:'벨트', ring1:'반지(좌)', ring2:'반지(우)' };
        
        for (let slotKey in slotNames) {
            let it = player.equip[slotKey];
            let slotTitle = slotNames[slotKey];
            
            if (it) {
                let dStr = encodeURIComponent(JSON.stringify(it)).replace(/'/g, "%27");
                equipHtml += `
                <div class="inv-slot grade-${it.grade || 0}" style="border: 2px solid #5cf; position: relative; display:flex; justify-content:center; align-items:center; aspect-ratio:1;" 
                     onclick="window.handleEquipSlotClick(event, '${slotKey}', '${dStr}')" 
                     onmouseenter="showTooltip(event, '${dStr}', true)" onmouseleave="hideTooltip()"
                     oncontextmenu="event.preventDefault(); window.unequip('${slotKey}');">
                    <div style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); background:#111; font-size:10px; color:#aaa; padding:1px 4px; border-radius:3px; white-space:nowrap; z-index:2;">${slotTitle}</div>
                    <div class="e-mark" style="background:#1d4ed8; z-index:2;">E</div>
                    <div class="inv-icon" style="font-size:24px;">${getItemIcon(it)}</div>
                </div>`;
            } else {
                equipHtml += `
                <div style="background:#1a1a24; border:1px dashed #445; border-radius:4px; aspect-ratio:1; display:flex; flex-direction:column; justify-content:center; align-items:center; color:#555; position:relative;">
                    <div style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); background:#111; font-size:10px; color:#555; padding:1px 4px; border-radius:3px; white-space:nowrap;">${slotTitle}</div>
                    <div style="font-size:18px;">+</div>
                </div>`;
            }
        }
        equipHtml += `</div>`;
        equipTabEl.innerHTML = equipHtml;
        return;
    }

    // [일괄 다중 선택 모드 적용된 일반 가방 렌더링]
    const displayList = player.inv.map((it, idx) => ({ ...it, isEquipped: false, originalIndex: idx }));

    displayList.sort((a, b) => {
        let getCategoryWeight = (it) => {
            if (it.type === 'potion') return 1;
            if (['weapon', 'armor', 'helmet', 'shield', 'tshirt', 'cloak', 'gloves', 'boots', 'belt', 'ring'].includes(it.type)) return 2;
            if (it.type === 'book') return 3;
            if (it.type === 'scroll') return 4;
            return 5;
        };
        let weightA = getCategoryWeight(a), weightB = getCategoryWeight(b);
        if (weightA !== weightB) return weightA - weightB;
        return (b.grade || 0) - (a.grade || 0);
    });

    const counts = new Map();
    displayList.forEach((it) => {
        const key = getStackKey(it);
        if (!counts.has(key)) {
            counts.set(key, { item: it, count: 0, rawKey: key, isEquipped: false });
        }
        counts.get(key).count += (it.count || 1);
    });

    const invListEl = $('inv-list');
    if (invListEl) {
        invListEl.innerHTML = '';

        let selectBtn = document.getElementById('btn-inv-select');
        if (selectBtn) {
            selectBtn.style.background = window.isInventorySelectMode ? '#1e3a8a' : '#444';
            selectBtn.style.color = window.isInventorySelectMode ? '#fd0' : '#fff';
            selectBtn.style.border = window.isInventorySelectMode ? '1px solid #3b82f6' : '1px outset #556';
        }

        if (counts.size === 0) {
            invListEl.innerHTML = '<div style="color:#666;text-align:center;padding:10px; grid-column: 1 / -1;">가방이 비었습니다.</div>';
        } else {
            const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

            counts.forEach((c) => {
                const dStr = encodeURIComponent(JSON.stringify(c.item)).replace(/'/g, "%27");
                const itemElement = document.createElement('div');
                itemElement.className = `inv-slot grade-${c.item.grade || 0}`;

                if (window.selectedInventoryKeys && window.selectedInventoryKeys.has(c.rawKey)) {
                    itemElement.style.border = '2px solid #fd0';
                    itemElement.style.boxShadow = '0 0 10px rgba(255, 221, 0, 0.4) inset';
                }

                let clickTimer = null; let clickCount = 0;

                itemElement.addEventListener('mouseenter', (e) => { if (!isTouchDevice && !window.activeEnchantScrollKey) showTooltip(e, dStr, false); });
                itemElement.addEventListener('mouseleave', hideTooltip);
                itemElement.addEventListener('contextmenu', (e) => {
                    e.preventDefault(); e.stopPropagation(); hideTooltip();
                    openItemActionModal(e, c.rawKey, c.item.name, c.count, dStr);
                });

                itemElement.addEventListener('click', (e) => {
                    e.stopPropagation(); hideTooltip();
                    if (window.activeEnchantScrollKey) {
                        let targetIt = player.inv.find(it => getStackKey(it) === c.rawKey);
                        if (targetIt) window.attemptEnchant(window.activeEnchantScrollKey, targetIt);
                        return;
                    }

                    if (window.isInventorySelectMode) {
                        if (!window.selectedInventoryKeys) window.selectedInventoryKeys = new Set();
                        if (window.selectedInventoryKeys.has(c.rawKey)) {
                            window.selectedInventoryKeys.delete(c.rawKey);
                        } else {
                            window.selectedInventoryKeys.add(c.rawKey);
                        }
                        window.renderInventory();
                        return;
                    }

                    clickCount++;
                    if (clickCount === 1) {
                        clickTimer = setTimeout(() => {
                            clickCount = 0;
                            openItemActionModal(e, c.rawKey, c.item.name, c.count, dStr);
                        }, 250);
                    } else if (clickCount === 2) {
                        clearTimeout(clickTimer); clickCount = 0; window.useItem(c.rawKey);
                    }
                });

                const qtyHtml = c.count > 1 ? `<span class="inv-qty">${c.count}</span>` : '';
                itemElement.innerHTML = `<div class="inv-icon">${getItemIcon(c.item)}</div>${qtyHtml}`;
                invListEl.appendChild(itemElement);
            });
        }
    }
};

let equipSlotClickCount = {};
let equipSlotClickTimer = {};

window.handleEquipSlotClick = function(e, slotKey, dataStr) {
    e.stopPropagation();
    hideTooltip();

    if (window.activeEnchantScrollKey) {
        if (player.equip && player.equip[slotKey]) {
            window.attemptEnchant(window.activeEnchantScrollKey, player.equip[slotKey]);
        }
        return;
    }

    equipSlotClickCount[slotKey] = (equipSlotClickCount[slotKey] || 0) + 1;

    if (equipSlotClickCount[slotKey] === 1) {
        equipSlotClickTimer[slotKey] = setTimeout(() => {
            equipSlotClickCount[slotKey] = 0;
            let it = player.equip[slotKey];
            if (it) {
                openItemActionModal(e, getStackKey(it), it.name, 1, dataStr);
                bringToFront('item-action-modal');
                autoCenterWindow('item-action-modal', true);
            }
        }, 250);
    } else if (equipSlotClickCount[slotKey] === 2) {
        clearTimeout(equipSlotClickTimer[slotKey]);
        equipSlotClickCount[slotKey] = 0;
        window.unequip(slotKey);
    }
};


// ==========================================
// 🌟 [2] 인벤토리 다중 선택 & 일괄 판매/삭제 시스템
// ==========================================
window.selectedInventoryKeys = new Set();
window.isInventorySelectMode = false;

window.toggleInventorySelectMode = function() {
    if (typeof playSound === 'function') playSound('click');
    window.isInventorySelectMode = !window.isInventorySelectMode;
    if (!window.isInventorySelectMode) {
        window.selectedInventoryKeys.clear(); 
    }
    if (typeof updateUI === 'function') updateUI();
    if (typeof window.renderInventory === 'function') window.renderInventory();
};

window.sortPlayerInventory = function() {
    if (typeof playSound === 'function') playSound('click');
    if (!player || !player.inv) return;
    
    player.inv.sort((a, b) => {
        const pRegex = /주홍|맑은|빨간|파란|물약|초록|용기|와퍼|마나|체력/;
        const isA = a.type === 'potion' || pRegex.test(a.name);
        const isB = b.type === 'potion' || pRegex.test(b.name);
        if (isA && !isB) return -1;
        if (!isA && isB) return 1;
        
        let gA = a.grade || 0, gB = b.grade || 0;
        if (gA !== gB) return gB - gA;
        
        let tA = a.type || '', tB = b.type || '';
        if (tA !== tB) return tA.localeCompare(tB);
        return a.name.localeCompare(b.name);
    });
    
    window.selectedInventoryKeys.clear();
    if (typeof window.renderInventory === 'function') window.renderInventory();
};

window.confirmSellSelectedItems = function() {
    if (!window.selectedInventoryKeys || window.selectedInventoryKeys.size === 0) {
        if (typeof addMessage === 'function') addMessage("판매할 아이템을 선택해주세요.", "#f55");
        return;
    }
    
    // 💡 브라우저 기본 confirm 대신 커스텀 showConfirm 사용
    showConfirm(`선택한 ${window.selectedInventoryKeys.size}종류의 아이템을 전부 판매하시겠습니까?`, () => {
        let totalEarned = 0;
        
        for (let i = player.inv.length - 1; i >= 0; i--) {
            let it = player.inv[i];
            if (it && it.type !== 'currency' && window.selectedInventoryKeys.has(getStackKey(it))) {
                let price = it.price || (it.grade ? (it.grade + 1) * 100 : 50);
                let count = it.count || 1;
                totalEarned += price * count;
                player.inv.splice(i, 1);
            }
        }
        
        player.adena = (player.adena || 0) + totalEarned;
        window.selectedInventoryKeys.clear();
        window.isInventorySelectMode = false; 
        
        if (typeof addMessage === 'function') addMessage(`일괄 판매로 ${totalEarned.toLocaleString()} 아데나를 획득했습니다.`, "#fd0");
       // if (typeof playSound === 'function') playSound('buy');
        if (typeof updateUI === 'function') updateUI();
        if (typeof window.renderInventory === 'function') window.renderInventory();
    });
};

window.confirmDeleteSelectedItems = function() {
    if (!window.selectedInventoryKeys || window.selectedInventoryKeys.size === 0) {
        if (typeof addMessage === 'function') addMessage("삭제할 아이템을 선택해주세요.", "#f55");
        return;
    }
    
    // 💡 브라우저 기본 confirm 대신 커스텀 showConfirm 사용
    showConfirm(`⚠️ 경고: 선택한 아이템을 영구 삭제하시겠습니까?\n이 작업은 복구할 수 없습니다!`, () => {
        for (let i = player.inv.length - 1; i >= 0; i--) {
            let it = player.inv[i];
            if (it && it.type !== 'currency' && window.selectedInventoryKeys.has(getStackKey(it))) {
                player.inv.splice(i, 1);
            }
        }
        
        window.selectedInventoryKeys.clear();
        window.isInventorySelectMode = false;
        
        if (typeof addMessage === 'function') addMessage("선택한 아이템이 영구 삭제되었습니다.", "#aaa");
        if (typeof updateUI === 'function') updateUI();
        if (typeof window.renderInventory === 'function') window.renderInventory();
    });
};


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

    let winMagic = $('win-magic');
    if (winMagic) {
        winMagic.style.width = '340px';
        winMagic.style.maxWidth = '95vw';
    }

    // 💡 [수정1] 부모 껍데기 박스가 자식 때문에 늘어나지 않도록 구조 강제 고정
    listEl.style.overflow = 'hidden';
    listEl.style.display = 'flex';
    listEl.style.flexDirection = 'column';

    player.magic = player.magic || [];
    player.magicLevels = player.magicLevels || {};
    let html = '';

    html += `
    <div style="display:flex; flex-direction:row; gap:3px; margin-bottom:8px; background:#111116; padding:3px; border-radius:4px; border:1px solid #33333d; width:100%; box-sizing:border-box; flex-shrink: 0;">
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab==='all'?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab('all')">전체</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===1?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(1)">1단</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===2?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(2)">2단</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===3?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(3)">3단</button>
        <button type="button" class="menu-btn" style="flex:1; height:24px; min-height:24px; padding:0; font-size:11px; ${window.currentMagicTab===4?'background:#334;color:#fd0;border-color:#fd0;':''}" onclick="setMagicTab(4)">4단</button>
    </div>
    
    <!-- 💡 [핵심 수정2] 이 영역에 고정 높이(height: 260px)를 박아버려서 절대 박스 아래로 뚫고 나가지 못하게 완벽 차단 -->
    <div style="display:flex; flex-direction:column; gap:4px; padding-right:4px; height: 260px; overflow-y: auto !important; overflow-x: hidden; box-sizing: border-box;">`;

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
                // flex-shrink: 0 을 주어 타이틀이 찌그러지지 않게 방어
                html += `<div style="color:#fd0; font-size:11px; font-weight:bold; margin:6px 0 2px 2px; border-bottom:1px dashed #444; padding-bottom:2px; flex-shrink:0;">[ ${currentTier} 서클 ]</div>`;
            }

            // flex-shrink: 0 을 주어 아이템 행이 찌그러지지 않게 방어
            html += `
            <div draggable="true" ondragstart="startDragMagic(event, '${m}')" style="flex-shrink:0; padding:4px 8px; border:1px solid #333344; border-radius:4px; background:linear-gradient(to right, #181824, #0f0f16); color:#ddd; display:flex; flex-direction:row; align-items:center; justify-content:space-between; box-sizing:border-box; width:100%; cursor:grab; height:34px;" oncontextmenu="openMagicActionModal('${m}'); return false;">
                <div style="display:flex; gap:6px; align-items:center; min-width:0; overflow:hidden;">
                    <span style="font-size:16px; flex-shrink:0;">${mData.icon || '✨'}</span>
                    <span style="font-weight:bold; color:#fff; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m}</span>
                    <span style="color:#fd0; font-size:10px; flex-shrink:0;">[Lv.${lv}]</span>
                    <span style="color:#88aaff; font-size:10.5px; flex-shrink:0;">MP ${mData.mp}</span>
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
let confirmCancelCallback = null;

window.showConfirm = function(msg, callback, cancelCallback = null) {
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
    modal.style.setProperty('z-index', '99999999', 'important'); 
    
    bindPromptButtons();
    confirmCallback = callback;
    confirmCancelCallback = cancelCallback; // 💡 취소 콜백 등록
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
    let btnYes = $('btn-yes');
    let btnNo = $('btn-no');
    let modal = $('confirm-modal');
    
    if(btnYes) {
        btnYes.onclick = () => { 
            if(modal) modal.style.display = 'none'; 
            if(btnNo && btnNo.style.display === 'none') btnNo.style.display = 'inline-block'; 
            if(confirmCallback) { let cb = confirmCallback; confirmCallback = null; cb(); } 
            confirmCancelCallback = null;
        };
    }
    if(btnNo) {
        btnNo.onclick = () => { 
            if(modal) modal.style.display = 'none'; 
            confirmCallback = null; 
            // 💡 취소/거절 시 등록된 취소 콜백(party_reject 발송) 실행
            if(confirmCancelCallback) { 
                let ccb = confirmCancelCallback; 
                confirmCancelCallback = null; 
                ccb(); 
            }
        };
    }
}

// ==========================================
// [8. 아이템 사용, 액션 모달 & 강화]
// ==========================================
window.openItemActionModal = function(e, stackKey, itemName, count, dataStr) { 
    if (e && e.stopPropagation) e.stopPropagation(); 
    if (typeof hideTooltip === 'function') hideTooltip(); 
    
    let it = JSON.parse(decodeURIComponent(dataStr)); 
    let hasMagic = (it.magicOptions && it.magicOptions.length > 0); 
    selectedItemForAction = { isMagic: false, stackKey, itemName, count, itemType: it.type, hasMagic: hasMagic, magicOptions: it.magicOptions }; 
    
    if ($('action-modal-title')) $('action-modal-title').innerText = `아이템 관리 (${count}개)`; 
    
    let dName = it.isEnchantScroll ? `[${it.enchantType}] ${it.name}` : (it.enchantValue ? `+${it.enchantValue} ${it.name}` : it.name);
    let gIdx = it.grade || 0; 

    function getBookColor(name) {
        if(!name) return '#ffffff';
        if(name.includes('기술서')) return '#f87171';
        if(name.includes('정령의 수정')) return '#4ade80';
        if(name.includes('마법서')) return '#60a5fa';
        return '#ffffff';
    }

    let titleColor = it.type === 'book' ? getBookColor(it.name) : (typeof gradeColors !== 'undefined' ? gradeColors[gIdx] : '#fff');
    let gradeName = typeof gradeNames !== 'undefined' ? gradeNames[gIdx] : '';

    let html = `<b class="tooltip-title" style="color:${titleColor}">${dName}</b><span style="font-size:12px; color:#aaa; margin-left:5px;">[${gradeName}]</span><br>`; 
    
    if (it.type === 'book') {
        let reqLv = (it.grade || 0) * 15 + 1;
        html += `<span style="color:#fd0; font-weight:bold;">요구 레벨: Lv.${reqLv} 이상</span><br>`;
    }

    if(it.atk) html += `공격력: ${it.atk}<br>`; 
    if(it.def) html += `방어력: ${it.def}<br>`;
    
    if(it.str) html += `<div style="color:#fff;">STR +${it.str}</div>`;
    if(it.dex) html += `<div style="color:#fff;">DEX +${it.dex}</div>`;
    if(it.int) html += `<div style="color:#fff;">INT +${it.int}</div>`;
    if(it.hpBonus) html += `<div style="color:#f55;">최대 HP +${it.hpBonus}</div>`;
    if(it.mpBonus) html += `<div style="color:#55f;">최대 MP +${it.mpBonus}</div>`;
    if(it.hpRegen) html += `<div style="color:#f88;">HP 회복률 +${it.hpRegen}</div>`;
    if(it.mpRegen) html += `<div style="color:#88f;">MP 회복률 +${it.mpRegen}</div>`;
    if(it.sp) html += `<div style="color:#a855f7;">SP (마법공격력) +${it.sp}</div>`;
    if(it.mr) html += `<div style="color:#5cf;">MR (마법방어력) +${it.mr}</div>`;
    if(it.dmgReduct) html += `<div style="color:#fd0;">대미지 감소 +${it.dmgReduct}</div>`;

    let mrBonus = (it.type !== 'weapon' && (it.enchantValue || 0) > 0) ? `<br><span style="color:#5cf;">마법 방어력(MR): +${it.enchantValue} (강화 보너스)</span>` : '';
    if (mrBonus) html += mrBonus;

    if(it.skill) html += `<div class="tooltip-magic">발동: ${it.skill}</div>`; 
    if(it.desc) html += `<div class="tooltip-desc" style="color:#ccc; margin-top:4px;">${it.desc}</div>`;

  if(hasMagic) { 
        html += `<div style="margin-top:5px; border-top:1px dashed #555; padding-top:5px;">`; 
        it.magicOptions.forEach((opt) => { 
            html += `<div class="tooltip-bonus" style="display:flex; justify-content:space-between; align-items:center; margin:2px 0;">
                        <span>✨ ${opt}</span>
                     </div>`; 
        }); 
        html += `</div>`; 
    }
    let extra = typeof getExtraDesc === 'function' ? getExtraDesc(it.name) : ''; 
    if(extra) html += `<div class="tooltip-desc" style="color:#ada; margin-top:4px;">${extra}</div>`;
    
    if (it.type === 'book' && it.magicName && typeof magicDb !== 'undefined' && magicDb[it.magicName] && magicDb[it.magicName].desc) { 
        html += `<div class="tooltip-desc" style="color:#aaf; margin-top:6px; border-top:1px dashed #555; padding-top:5px;">${magicDb[it.magicName].desc}</div>`; 
    }

    let modal = $('item-action-modal');
    if (modal) {
        if ($('action-modal-desc')) $('action-modal-desc').innerHTML = html; 
        if ($('btn-purge-magic')) $('btn-purge-magic').style.display = hasMagic ? 'block' : 'none'; 
        if ($('action-modal-item-mgmt')) $('action-modal-item-mgmt').style.display = 'flex'; 
        
        modal.style.display = 'flex';
        bringToFront('item-action-modal'); // 💡 가방보다 무조건 위에 오도록 최상단 z-index 부여
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
    if (!selectedItemForAction) return; 
    
    if (selectedItemForAction.isMagic) { 
        let mKey = selectedItemForAction.itemName;
        hotkeys[idx] = { type: 'magic', id: mKey }; 
        if (typeof addMessage === 'function') addMessage(`[F${idx+5}] 슬롯에 [${mKey}] 마법 등록 완료`, '#5f5'); 
    } else { 
        let { itemName, itemType } = selectedItemForAction; 
        hotkeys[idx] = { type: 'item', id: itemName, itemType: itemType }; 
        if (typeof addMessage === 'function') addMessage(`[F${idx+5}] 슬롯에 [${itemName}] 등록 완료`, '#5f5'); 
    } 
    
    if (typeof playSound === 'function') playSound('click'); 
    window.hotkeys = hotkeys; 
    if (typeof updateUI === 'function') updateUI(); 
    if (typeof hideItemActionModal === 'function') window.hideItemActionModal(); 
};


window.execItemAction = function(action) { 
    hideItemActionModal(); 
    if (!selectedItemForAction || selectedItemForAction.isMagic || action === 'cancel') return; 
    
    let { stackKey, itemName, count } = selectedItemForAction; 
    
    if (action === 'use') { 
        window.useItem(stackKey); 
    } 
    else if (action === 'drop') { 
        let totalCount = count || 1;
        if (totalCount > 1) { 
            showPrompt(`${itemName} 몇 개를 버리시겠습니까?\n(보유: ${totalCount}개)`, totalCount, totalCount, (qty) => { 
                handleItemRemoval(stackKey, qty, action); 
            }); 
        } else { 
            handleItemRemoval(stackKey, 1, action); 
        } 
    } 
    else if (action === 'delete') { 
        let totalCount = count || 1;
        let countText = totalCount > 1 ? `${totalCount}개` : '';
        
        // 💡 [수정 완료] 템플릿 리터럴 문법 오류(Missing })가 없도록 수정한 영구 삭제 확인 팝업
        showConfirm(`정말 [${itemName}] ${countText}를 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`, () => {
            if (totalCount > 1) { 
                showPrompt(`${itemName} 몇 개를 삭제하시겠습니까?\n(보유: ${totalCount}개)`, totalCount, totalCount, (qty) => { 
                    handleItemRemoval(stackKey, qty, action); 
                }); 
            } else { 
                handleItemRemoval(stackKey, 1, action); 
            }
        });
    } 
    else if (action === 'purge') { 
        showConfirm("마법 속성을 모두 초기화(삭제) 하시겠습니까?", () => { 
            let target = player.inv.find(it => getStackKey(it) === stackKey); 
            if (target) { 
                target.magicOptions = []; 
                addMessage(`${target.name}의 속성이 완전히 초기화되었습니다.`, '#aaf'); 
                playSound('spell'); 
                updateUI(); 
            } 
        }); 
    } 
};



function handleItemRemoval(stackKey, qty, action) { 
    let remainingToRemove = parseInt(qty) || 1; 
    let removedItemTemplate = null;
    let actualRemovedCount = 0;

    // 인벤토리 뒤에서부터 검색하여 수량 차감 및 제거
    for (let i = player.inv.length - 1; i >= 0; i--) { 
        let it = player.inv[i];
        if (getStackKey(it) === stackKey || it.id === stackKey || it.name === stackKey) { 
            if (!removedItemTemplate) {
                removedItemTemplate = JSON.parse(JSON.stringify(it));
            }
            
            let stackCount = it.count || 1;
            
            if (stackCount > remainingToRemove) { 
                it.count -= remainingToRemove; 
                actualRemovedCount += remainingToRemove;
                remainingToRemove = 0; 
                break; 
            } else { 
                actualRemovedCount += stackCount;
                remainingToRemove -= stackCount; 
                player.inv.splice(i, 1); 
            }

            if (remainingToRemove <= 0) break; 
        } 
    } 

    if (actualRemovedCount > 0 && removedItemTemplate) { 
        if (action === 'drop') { 
            let dropX = Math.max(100, Math.min(mapSize - 100, player.x + (Math.random() * 80 - 40)));
            let dropY = Math.max(100, Math.min(mapSize - 100, player.y + (Math.random() * 80 - 40)));
            
            let droppedFloorItem = { 
                ...removedItemTemplate, 
                id: (removedItemTemplate.name || 'item') + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                count: actualRemovedCount, 
                x: dropX, 
                y: dropY, 
                map: currentMap, 
                spawnTime: Date.now(), 
                droppedTime: Date.now(), // 내가 방금 버린 시간 기록 (즉시 재루팅 방지)
                dropperId: window.socket ? window.socket.id : 'me' 
            };

            items.push(droppedFloorItem);

            // 다른 유저에게 바닥 아이템 생성 브로드캐스트 전송
            if (window.socket && currentUser) {
                window.socket.emit('player_drop_item', droppedFloorItem);
            }

            addMessage(`[버리기] ${removedItemTemplate.name} ${actualRemovedCount}개를 바닥에 버렸습니다.`, '#aaa'); 
        } else { 
            addMessage(`[파괴] ${removedItemTemplate.name} ${actualRemovedCount}개를 삭제했습니다.`, '#f55'); 
        } 

        if (typeof playSound === 'function') playSound('click'); 
        updateUI(); 
        if (typeof renderInventory === 'function') renderInventory();
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
window.cancelEnchantMode = function() {
    window.activeEnchantScrollKey = null;
    document.body.classList.remove('enchanting-mode');
    document.body.style.cursor = 'default';
};

window.unequip = function(slotKey) { 
    if (window.activeEnchantScrollKey) { 
        if (player.equip && player.equip[slotKey]) { 
            window.attemptEnchant(window.activeEnchantScrollKey, player.equip[slotKey]); 
        } 
        return; 
    }
    
    if (player.equip && player.equip[slotKey]) { 
        let unequippedItem = player.equip[slotKey];
        if (typeof playSound === 'function') playSound('click'); 
        player.inv.push(unequippedItem); 
        player.equip[slotKey] = null; 
        
        if (Array.isArray(window.hotkeys)) {
            for (let i = 0; i < window.hotkeys.length; i++) {
                if (window.hotkeys[i] && window.hotkeys[i].id === unequippedItem.name) {
                    window.hotkeys[i] = null;
                }
            }
        }
        if (typeof addMessage === 'function') addMessage(`[${unequippedItem.name}] 장착 해제`, "#aaa");
        if (typeof updateUI === 'function') updateUI(); 
        if (typeof hideTooltip === 'function') hideTooltip(); 
        if (typeof renderInventory === 'function') renderInventory();
    } 
};



// 3. 인벤토리 아이템 사용 및 인챈트 트리거
window.useItem = function(stackKey) {
    if (!stackKey) return;
    if (window.activeEnchantScrollKey) {
        let targetIdx = player.inv.findIndex(it => (typeof getStackKey === 'function' ? getStackKey(it) : it.name) === stackKey || it.id === stackKey || it.name === stackKey);
        if (targetIdx > -1) window.attemptEnchant(window.activeEnchantScrollKey, player.inv[targetIdx]);
        return;
    }

    let idx = player.inv.findIndex(it => (typeof getStackKey === 'function' ? getStackKey(it) : it.name) === stackKey || it.id === stackKey || it.name === stackKey); 
    if (idx === -1) return; 
    let it = player.inv[idx]; 
    if (typeof hideTooltip === 'function') hideTooltip();

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
        else if (it.name.includes('초록 물약')) { 
            playSound('drink'); 
            applyBuff('초록물약', 300000, '🍾', 'speed', 60); 
        } 
        else if (it.name.includes('용기')) { 
            if (player.charClass !== 'knight' && player.charClass !== 'royal') { 
                addMessage("기사/군주 전용 아이템입니다.", '#f55'); 
                return; 
            }
            playSound('drink'); 
            applyBuff('용기물약', 300000, '🏺', 'atkSpeed', -300); 
        } 
        else if (it.name.includes('와퍼')) { 
            if (player.charClass !== 'elf') { 
                addMessage("요정 전용 아이템입니다.", '#f55'); 
                return; 
            }
            playSound('drink'); 
            applyBuff('엘븐와퍼', 300000, '🍃', 'atkSpeed', -300); 
        }
        else if (it.name.includes('파란')) { 
            playSound('drink'); 
            let mpHealAmt = 50; // 💡 마나 50 즉시 회복
            player.mp = Math.min(currentMaxMp, player.mp + mpHealAmt); 
            addMessage(`${it.name} 복용 (+${mpHealAmt} MP)`, '#55f'); 
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
        // 1. 클래스 제한 검증
        if (it.name.includes('정령의 수정') && player.charClass !== 'elf') {
            return showAlert("요정 클래스만 학습할 수 있는 정령의 수정입니다.");
        }
        if (it.name.includes('기술서') && player.charClass !== 'knight' && player.charClass !== 'royal') {
            return showAlert("기사/군주 클래스만 학습할 수 있는 기술서입니다.");
        }
        if (it.name.includes('마법서') && player.charClass !== 'wizard') {
            return showAlert("마법사 클래스만 학습할 수 있는 마법서입니다.");
        }

        // 2. 마법 이름 및 서클 티어(1~4서클) 산출
        let mName = it.magicName || it.name.replace(/.*\(|\).*/g, '').trim();
        let tier = (typeof getMagicLevelTier === 'function') ? getMagicLevelTier(mName) : (it.grade || 1);
        
        // 3. 서클별 요구 레벨 적용 (1서클: 1, 2서클: 15, 3서클: 30, 4서클: 45)
        let requiredLv = tier === 4 ? 45 : (tier === 3 ? 30 : (tier === 2 ? 15 : 1));

        if ((player.level || 1) < requiredLv) {
            return showAlert(`레벨이 부족하여 학습할 수 없습니다. (요구 레벨: Lv.${requiredLv} 이상)`);
        }

        // 4. 중복 습득 검증
        player.magic = player.magic || [];
        player.magicLevels = player.magicLevels || {}; 
        if (player.magic.includes(mName)) {
            return showAlert("이미 습득한 마법입니다.");
        }

        // 5. 마법 습득 처리
        playSound('spell');
        player.magic.push(mName);
        player.magicLevels[mName] = 1; 
        addMessage(`[${mName}] 마법을 습득했습니다!`, '#af5');
        
        if (it.count > 1) it.count--; 
        else player.inv.splice(idx, 1);
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
    let listEl = $('shop-list');
    if(!listEl) return;

    let baseType = npcId.split('_')[0]; 
    let wares = (typeof shopWares !== 'undefined' && shopWares[baseType]) ? shopWares[baseType] : [];
    let html = ''; 

    if(tab === 'buy') { 
        wares.forEach(w => { 
            let dStr = encodeURIComponent(JSON.stringify(w)).replace(/'/g, "%27"); 
            let iconHtml = typeof getItemIcon === 'function' ? getItemIcon(w) : '📦'; 
            let sPrice = w.dispPrice || w.price || 0; 
            
            // 배운 마법 여부 검사
            let isLearned = false;
            let mName = w.magicName || w.name.replace(/.*\(|\).*/g, '').trim();
            if (w.type === 'book' && player.magic && (player.magic.includes(mName) || player.magic.includes(w.name))) {
                isLearned = true;
            }
            
            let nameColor = w.type === 'book' ? (typeof getBookColor === 'function' ? getBookColor(w.name) : '#60a5fa') : '#ffffff';
            let sName = w.dispName || w.name;
            
            // 💡 [✓] 체크 뱃지
            let learnedBadge = isLearned 
                ? `<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; font-size:11px; font-weight:bold; color:#fff; background:#16a34a; border:1px solid #4ade80; border-radius:3px; margin-left:4px; flex-shrink:0;">✓</span>` 
                : '';

            html += `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#181824; border:1px solid #333345; border-radius:4px; padding:6px 8px; margin-bottom:4px; box-sizing:border-box;">
                <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; cursor:pointer;" onclick="showTooltip(event, '${dStr}', false)">
                    <span style="font-size:16px; flex-shrink:0;">${iconHtml}</span>
                    <span style="font-weight:bold; font-size:12px; color:${nameColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${sName}
                    </span>
                    ${learnedBadge}
                    <span style="color:#facc15; font-size:11px; flex-shrink:0; margin-left:4px;">
                        (${sPrice.toLocaleString()} A)
                    </span>
                </div>
                <div style="display:flex; gap:3px; flex-shrink:0; margin-left:6px;">
                    <button type="button" class="confirm-btn bg-dark-green" style="padding:3px 7px; font-size:11px; height:24px; min-height:24px;" onclick="buyItemFast('${baseType}', '${w.name}')">구매</button>
                    <button type="button" class="confirm-btn bg-gray" style="padding:3px 7px; font-size:11px; height:24px; min-height:24px;" onclick="buyItemPrompt('${baseType}', '${w.name}')">수량</button>
                </div>
            </div>`; 
        });
    } else { 
        let counts = {}; 
        player.inv.forEach(it => { 
            let key = typeof getStackKey === 'function' ? getStackKey(it) : it.name; 
            if(!counts[key]) counts[key] = {item: it, count:0, rawKey: key}; 
            counts[key].count += (it.count || 1); 
        }); 
        
        for(let k in counts) { 
            let c = counts[k]; 
            let sellPrice = Math.floor((c.item.price || 50) * 0.3); 
            let dStr = encodeURIComponent(JSON.stringify(c.item)).replace(/'/g, "%27"); 
            let iconHtml = typeof getItemIcon === 'function' ? getItemIcon(c.item) : '📦'; 
            
            html += `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#181824; border:1px solid #333345; border-radius:4px; padding:6px 8px; margin-bottom:4px; box-sizing:border-box;">
                <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; cursor:pointer;" onclick="showTooltip(event, '${dStr}', false)">
                    <span style="font-size:16px; flex-shrink:0;">${iconHtml}</span>
                    <span style="font-weight:bold; font-size:12px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${c.item.name}
                    </span>
                    <span style="color:#aaa; font-size:11px; flex-shrink:0;">(${c.count}개)</span>
                    <span style="color:#4ade80; font-size:11px; flex-shrink:0; margin-left:4px;">+${sellPrice.toLocaleString()} A</span>
                </div>
                <div style="display:flex; gap:3px; flex-shrink:0; margin-left:6px;">
                    <button type="button" class="confirm-btn bg-dark-red" style="padding:3px 8px; font-size:11px; height:24px; min-height:24px; color:#f88;" onclick="sellItemGroup('${c.rawKey}', ${sellPrice}, ${c.count}, '${c.item.name}')">판매</button>
                </div>
            </div>`; 
        } 
    }
    listEl.innerHTML = html || '<div style="color:#666;text-align:center;padding:15px;font-size:12px;">목록이 비어있습니다.</div>';
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

    
    // 💡 [핵심 보완] 로드 직후 모든 이전 타겟, 이동 좌표, 락(Lock)을 강제로 원점 초기화
    player.isDrinking = false; 
   player.isDrinking = false; 
    player.target = null;         
    player.targetItem = null;     
    player.isMoving = false; 
    player.moveX = undefined; 
    player.moveY = undefined; 
    player.lastAttack = 0; 
    player.manualOverrideUntil = 0; 
    player.lastRegen = performance.now(); 
    player.buffs = {}; 
    player.spellCooldowns = {}; // 💡 이 줄 추가: 과거의 쿨타임 잔재 즉시 소각
    player.vx = 0; player.vy = 0; player.isKitingActive = false;
    
    // 💡 [핵심] 서버 측에도 내 캐릭터의 타겟이 완전히 비었음을 즉시 통보하여 잔재 동기화 차단
if (window.socket && currentUser) {
        window.socket.emit('player_target', { targetId: null });
        window.socket.emit('player_update', {
            name: player.name,
            charClass: player.charClass,
            x: player.x,
            y: player.y,
            map: currentMap,
            targetId: null,
            isMoving: false
        });
    }

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
    if (typeof showConfirm === 'function') {
        showConfirm("현재 캐릭터 진행 상황을 자동 저장하고 새 캐릭터를 생성하시겠습니까?", () => {
            if (typeof saveGameToLocal === 'function') saveGameToLocal(true); 
            window.closeAllWindows(); // 💡 window. 추가됨
            if (typeof showCharSelect === 'function') showCharSelect();
        });
    }
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
    if (typeof playSound === 'function') playSound('chest'); // 💡 궤짝 열기
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
// 1. window 객체에 hireMercenary 함수 명시적 등록
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
    let correctMaxExp = typeof getExpRequiredForLevel === 'function' ? getExpRequiredForLevel(targetLevel) : 100;

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



// 2. 고용 메뉴 표시 함수 수정
window.showMercenaryHireMenu = function() {
    let cost = player.level * 2000;
    let activeMercs = entities.filter(e => e.isSummon && e.owner === player && e.isMercenary && e.hp > 0);

    let contentEl = $('mercenary-content');
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="font-weight:bold; color:#fd0; margin-bottom:10px;">⚔️ 용병 단장 영입소</div>
            <p style="font-size:13px; color:#ccc;">전투를 보조할 강력한 용병을 고용합니다.<br>(현재 동행: <span style="color:#5f5; font-weight:bold;">${activeMercs.length}명</span> / 최대 3명)</p>
            <button id="btn-hire-knight" class="confirm-btn bg-dark-green w-full mb-3" style="cursor:pointer;">기사 용병 고용 (${cost.toLocaleString()} A)</button>
            <button id="btn-hire-elf" class="confirm-btn bg-dark-green w-full mb-3" style="cursor:pointer;">요정 용병 고용 (${cost.toLocaleString()} A)</button>
            <button id="btn-hire-wiz" class="confirm-btn bg-dark-green w-full mb-3" style="cursor:pointer;">마법사 용병 고용 (${cost.toLocaleString()} A)</button>
        `;
        
        // 💡 인라인 onclick 대신 안전하게 엘리먼트 쿼리로 이벤트 리스너 부착
        setTimeout(() => {
            let kBtn = document.getElementById('btn-hire-knight');
            let eBtn = document.getElementById('btn-hire-elf');
            let wBtn = document.getElementById('btn-hire-wiz');

            if (kBtn) kBtn.onclick = () => window.hireMercenary('knight', cost);
            if (eBtn) eBtn.onclick = () => window.hireMercenary('elf', cost);
            if (wBtn) wBtn.onclick = () => window.hireMercenary('wizard', cost);
        }, 50);
    }
    
    if ($('win-mercenary')) $('win-mercenary').style.display = 'flex';
    bringToFront('win-mercenary');
    setTimeout(() => autoCenterWindow('win-mercenary', true), 10);
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
// 💡 [모바일 창 드래그 완벽 패치] 터치 시 화면이 내려가는 현상 방지
let dragEl = null, dragOffsetX = 0, dragOffsetY = 0;

window.startDrag = function(e, id) { 
    dragEl = document.getElementById(id); 
    if (!dragEl) return;

    if (typeof bringToFront === 'function') {
        bringToFront(id);
    }

    if (dragEl.style.transform && dragEl.style.transform !== 'none') {
        let rect = dragEl.getBoundingClientRect();
        dragEl.style.setProperty('transform', 'none', 'important');
        dragEl.style.left = rect.left + 'px';
        dragEl.style.top = rect.top + 'px';
    }

    let rect = dragEl.getBoundingClientRect(); 
    let cx = e.type.includes('mouse') ? e.clientX : (e.touches ? e.touches[0].clientX : 0); 
    let cy = e.type.includes('mouse') ? e.clientY : (e.touches ? e.touches[0].clientY : 0); 
    dragOffsetX = cx - rect.left; 
    dragOffsetY = cy - rect.top; 

    document.addEventListener('mousemove', onDrag); 
    document.addEventListener('mouseup', stopDrag); 
    document.addEventListener('touchmove', onDrag, { passive: false }); 
    document.addEventListener('touchend', stopDrag); 
};

function onDrag(e) {
    if (!dragEl) return;
    if (e.cancelable) e.preventDefault(); // 모바일 터치 스크롤 간섭 차단
    
    let cx = e.type.includes('mouse') ? e.clientX : (e.touches ? e.touches[0].clientX : 0);
    let cy = e.type.includes('mouse') ? e.clientY : (e.touches ? e.touches[0].clientY : 0);
    
    // X 버튼이 화면 밖으로 탈출하지 않도록 clamp
    let newLeft = Math.max(0, Math.min(window.innerWidth - dragEl.offsetWidth, cx - dragOffsetX));
    let newTop = Math.max(0, Math.min(window.innerHeight - dragEl.offsetHeight, cy - dragOffsetY));
    
    dragEl.style.left = newLeft + 'px';
    dragEl.style.top = newTop + 'px';
}

function stopDrag() {
    dragEl = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', stopDrag);
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
// [채팅 엔진, 탭 필터링 및 독립 확장창 연동]
// ==========================================
window.isSystemHidden = false;

window.toggleHideSystem = function() {
    let chk1 = document.getElementById('hide-system-chk');
    let chk2 = document.getElementById('pop-hide-system-chk');
    
    // 💡 변경된 체크박스의 상태를 정확하게 추적하여 양쪽 동기화
    let isChecked = window.isSystemHidden;
    if (chk1 && chk1.checked !== window.isSystemHidden) isChecked = chk1.checked;
    else if (chk2 && chk2.checked !== window.isSystemHidden) isChecked = chk2.checked;

    if (chk1) chk1.checked = isChecked;
    if (chk2) chk2.checked = isChecked;
    window.isSystemHidden = isChecked;

    if (typeof playSound === 'function') playSound('click');
    renderChatMessages();
    gameOptions.isSystemHidden = window.isSystemHidden;   
};


window.chatHistory = [];
window.currentChatTab = 'all';
window.isAdminAuth = false;
window.isChatPopupOpen = false;

// 1. 탭 전환 (하단바 + 확장 팝업창 동시 동기화)
// 1. 탭 전환 로직 (공지 탭 연동)
window.switchChatTab = function(tabName) {
    if (typeof playSound === 'function') playSound('click');
    window.currentChatTab = tabName;

    document.querySelectorAll('#chat-tabs .chat-tab').forEach(el => {
        let labelMap = { 'all': '전체', 'chat': '💬대화', 'party': '파티', 'notice': '📢공지' };
        el.className = el.innerText === labelMap[tabName] ? 'chat-tab active' : 'chat-tab';
    });

    const tabIndexMap = { 'all': 0, 'chat': 1, 'party': 2, 'notice': 3 };
    const popTabs = document.querySelectorAll('#popup-chat-tabs .popup-tab');
    popTabs.forEach((btn, idx) => {
        if (idx === tabIndexMap[tabName]) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const chatInput = document.getElementById('chat-input');
    const popInput = document.getElementById('popup-chat-input');
    
    let tipText = "대화 입력 (명령어 도움말: /?)";
    if (tabName === 'notice') {
        tipText = "공지 및 게시판 탭입니다.";
    } else if (tabName === 'party') {
        tipText = "파티원에게 대화 전송...";
    }

    if (chatInput) chatInput.placeholder = tipText;
    if (popInput) popInput.placeholder = tipText;

    renderChatMessages();
    gameOptions.currentChatTab = window.currentChatTab;
}; 

// 2. 독립형 확장 대화창 팝업 열기/닫기 토글
window.toggleChatPopup = function() {
    if (typeof playSound === 'function') playSound('click');
    const pop = document.getElementById('win-chat-popup');
    const expandBtn = document.getElementById('chat-expand-btn');
    if (!pop) return;

    window.isChatPopupOpen = (pop.style.display !== 'flex');

    if (window.isChatPopupOpen) {
        pop.style.display = 'flex';
        if (typeof bringToFront === 'function') bringToFront('win-chat-popup');
        
        if (typeof autoCenterWindow === 'function') {
            autoCenterWindow('win-chat-popup', true);
        }

        if (expandBtn) expandBtn.innerText = '🔽 접기';
        
        setTimeout(() => {
            const pInput = document.getElementById('popup-chat-input');
            if (pInput) pInput.focus();
        }, 50);
    } else {
        pop.style.display = 'none';
        if (expandBtn) expandBtn.innerText = '🔼 펼치기';
    }

    renderChatMessages();
};
window.toggleChatExpand = window.toggleChatPopup;

// 3. 메시지 추가 및 렌더링
window.addMessage = function(msg, color = '#ddd', type = 'system') {
    window.chatHistory.push({ msg, color, type });
    if (window.chatHistory.length > 100) window.chatHistory.shift();
    renderChatMessages();
};

// ==========================================
// 📢 [공지 게시판 데이터 파싱 및 관리 헬퍼]
// ==========================================
window.selectedNoticeIds = new Set(); // 다중 삭제를 위한 선택된 게시글 ID 저장소

window.getNotices = function() {
    let raw = localStorage.getItem('server_global_notice');
    
    // 💡 [핵심] 초보자 가이드와 명령어 모음을 기본 '게시글' 데이터로 세팅
    let defaultGuides = [
        {
            id: Date.now() + 2,
            title: "⚙️ [필독] 게임 내 사용 가능 명령어 모음",
            content: "• /누구 또는 /who : 현재 월드 접속자 목록 확인\n• /파티초대 [이름] : 주변 유저에게 파티 초대 전송\n• /파티모드 : 파티 점사 모드 ⇄ 자유 사냥 모드 전환\n• /파티탈퇴 : 현재 소속된 파티에서 탈퇴\n• /귓말 [이름] [할말] : 1:1 귓속말 전송\n• /r [할말] : 마지막 귓말 상대에게 빠른 답장\n• /운영자 [계정/비번] : 운영자 권한 획득",
            pinned: true
        },
        {
            id: Date.now() + 1,
            title: "📖 [필독] 초보자 필수 게임 가이드 및 조작법",
            content: "• 상단 HP/MP/EXP 바: 생명력, 마력, 경험치를 실시간으로 표시합니다. (사망 시 3초 후 마을 부활)\n• 미니맵: 현재 위치, 안전지대(초록 원), 주요 NPC 위치 표시\n• 조작: 터치/클릭으로 이동, 몬스터 선택 시 전투 시작\n• 하단 토글: 자동 물약(70% 미만) 및 자동 사냥 켜기/끄기\n• 퀵슬롯 (F5~F12): 마법, 물약, 주문서 등을 등록하여 빠르게 사용\n• 마을 NPC: '용병 단장'에게 동료 고용, '창고지기'를 통해 부캐릭터와 아이템/아데나 공유 가능",
            pinned: true
        }
    ];

    // 저장된 데이터가 전혀 없으면 기본 가이드를 등록
    if (!raw || raw.trim() === '') {
        localStorage.setItem('server_global_notice', JSON.stringify(defaultGuides));
        return defaultGuides;
    }
    
    try {
        let parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : defaultGuides;
    } catch(e) {
        // 구버전(단순 텍스트) 공지가 남아있을 경우: 기존 공지 + 기본 가이드를 배열로 묶어서 마이그레이션
        let migrated = [
            { id: Date.now() + 3, title: "기존 시스템 공지", content: raw, pinned: false },
            ...defaultGuides
        ];
        localStorage.setItem('server_global_notice', JSON.stringify(migrated));
        return migrated;
    }
};

window.saveAndBroadcastNotices = function(noticesArray) {
    let jsonStr = JSON.stringify(noticesArray);
    localStorage.setItem('server_global_notice', jsonStr);
    if (window.socket) window.socket.emit('admin_notice', { message: jsonStr });
    renderChatMessages();
};

// ==========================================
// 📢 [사용자 뷰 & 운영자 게시글 에디터]
// ==========================================
window.showFullNotice = function(id) {
    if (typeof playSound === 'function') playSound('click');
    let notices = getNotices();
    let notice = notices.find(n => n.id === id);
    if (!notice) return;
    
    let bodyHTML = '';
    let btns = [];

    if (window.isAdminAuth) {
        // 👑 [운영자] 제목/내용 텍스트 에디터
        bodyHTML = `
        <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="color:#aaa; font-size:11px; text-align:left; font-weight:bold;">제목:</div>
            <input type="text" id="edit-notice-title" class="modal-input" value="${notice.title}" placeholder="새로운 공지 제목" autocomplete="off" style="margin:0; text-align:left; font-size:13px; color:#fd0; background:#111;">
            <div style="color:#aaa; font-size:11px; text-align:left; margin-top:4px; font-weight:bold;">본문 내용:</div>
            <textarea id="edit-notice-content" class="modal-input" placeholder="여기에 내용을 입력하세요..." style="height:150px; text-align:left; font-size:13px; resize:none; margin:0; background:#111;">${notice.content}</textarea>
        </div>`;
        
        btns.push({
            text: '💾 수정 / 저장',
            color: '#166534',
            callback: () => {
                let newTitle = document.getElementById('edit-notice-title').value.trim();
                let newContent = document.getElementById('edit-notice-content').value.trim();

                if (!newTitle && !newContent) return; // 제목과 내용 모두 없으면 무시

                let nIdx = notices.findIndex(n => n.id === id);
                if (nIdx > -1) {
                    notices[nIdx].title = newTitle || "제목 없음";
                    notices[nIdx].content = newContent || "내용 없음";
                    saveAndBroadcastNotices(notices);
                    addMessage("📢 게시글이 성공적으로 수정되었습니다.", '#5f5', 'system');
                }
            }
        });
    } else {
        // 👤 [일반 유저] 텍스트 뷰어
        bodyHTML = `
        <div style="text-align:left; font-size:13.5px; line-height:1.6; color:#eee; max-height:45vh; overflow-y:auto; padding:12px; background:rgba(0,0,0,0.6); border-radius:4px; border:1px inset #555; white-space:pre-line;">
            ${notice.content}
        </div>`;
    }

    btns.push({ text: '닫기', color: '#444', callback: () => {} });

    showCustomPrompt(bodyHTML, btns);
    if ($('confirm-win-title')) $('confirm-win-title').innerText = window.isAdminAuth ? "게시글 수정" : `📢 ${notice.title}`;
};

// ==========================================
// 👑 [운영자: 리스트 관리 로직]
// ==========================================
window.adminWriteNotice = function() {
    let defaultText = "새로운 공지 제목\n여기에 내용을 입력하세요...";
    showPrompt("👑 [운영자] 새 게시글 작성\n(첫 줄은 '제목', 두 번째 줄부터 '내용'이 됩니다)", defaultText, 2000, (inputText) => {
        if (!inputText || inputText.trim() === '') return;
        
        let lines = inputText.trim().split('\n');
        let title = lines[0] || "제목 없음";
        let content = lines.slice(1).join('\n').trim() || "내용 없음";

        let notices = getNotices();
        notices.unshift({ id: Date.now(), title: title, content: content, pinned: false });
        saveAndBroadcastNotices(notices);
        addMessage("📢 새 게시글이 등록되었습니다.", '#fd0', 'system');
    }, true);
};

window.toggleNoticeSelection = function(e, id) {
    e.stopPropagation(); 
    if (window.selectedNoticeIds.has(id)) {
        window.selectedNoticeIds.delete(id);
    } else {
        window.selectedNoticeIds.add(id);
    }
    renderChatMessages();
};

window.adminDeleteSelectedNotices = function() {
    if (window.selectedNoticeIds.size === 0) return showAlert("삭제할 게시글을 먼저 체크해주세요.");
    
    showConfirm(`체크박스로 선택한 ${window.selectedNoticeIds.size}개의 게시글을 전부 삭제하시겠습니까?`, () => {
        let notices = getNotices().filter(n => !window.selectedNoticeIds.has(n.id));
        window.selectedNoticeIds.clear();
        saveAndBroadcastNotices(notices);
        addMessage("📢 선택한 게시글이 일괄 삭제되었습니다.", '#aaa', 'system');
    });
};

window.adminTogglePin = function(e, id) {
    e.stopPropagation();
    let notices = getNotices();
    let idx = notices.findIndex(n => n.id === id);
    if (idx > -1) {
        notices[idx].pinned = !notices[idx].pinned;
        saveAndBroadcastNotices(notices);
    }
};

window.adminMoveNotice = function(e, id, direction) {
    e.stopPropagation();
    let notices = getNotices();
    let idx = notices.findIndex(n => n.id === id);
    if (idx < 0) return;
    
    // 고정된 글과 안 고정된 글은 섞이지 않도록 정렬 전 위치 이동
    if (direction === 'up' && idx > 0) {
        [notices[idx - 1], notices[idx]] = [notices[idx], notices[idx - 1]];
    } else if (direction === 'down' && idx < notices.length - 1) {
        [notices[idx + 1], notices[idx]] = [notices[idx], notices[idx + 1]];
    }
    saveAndBroadcastNotices(notices);
};

// ==========================================
// [채팅 & 게시판 렌더링 코어]
// ==========================================
function renderChatMessages() {
    const chat = document.getElementById('chat-messages');
    const popChat = document.getElementById('popup-chat-messages');

    let filtered = window.chatHistory.filter(c => {
        if (window.isSystemHidden && c.type === 'system') return false;
        if (window.currentChatTab === 'chat' && c.type !== 'normal') return false;
        if (window.currentChatTab === 'party' && c.type !== 'party') return false;
        if (window.currentChatTab === 'notice') return false;
        return true;
    });

    let noticeBoxHTML = '';
    if (window.currentChatTab === 'notice') {
        let notices = typeof getNotices === 'function' ? getNotices() : [];
        notices.sort((a, b) => (b.pinned === a.pinned) ? 0 : a.pinned ? -1 : 1);

        let listHTML = '';
        if (notices.length === 0) {
            listHTML = `<div style="color:#888; text-align:center; padding:15px 0; font-size:11px;">등록된 게시글이 없습니다.</div>`;
        } else {
            notices.forEach(n => {
                let pinBadge = n.pinned ? `<span style="color:#ef4444; font-weight:bold; margin-right:4px;">[📌고정]</span>` : '';
                let titleStr = n.title || "제목 없음";
                let isSelected = window.selectedNoticeIds && window.selectedNoticeIds.has(n.id);
                
                let adminTools = window.isAdminAuth ? `
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <div style="display:flex; gap:2px;">
                            <button class="confirm-btn bg-dark-gray" style="padding:1px 4px; font-size:9px;" onclick="window.adminMoveNotice(event, ${n.id}, 'up')">▲</button>
                            <button class="confirm-btn bg-dark-gray" style="padding:1px 4px; font-size:9px;" onclick="window.adminMoveNotice(event, ${n.id}, 'down')">▼</button>
                            <button class="confirm-btn ${n.pinned ? 'bg-dark-red' : 'bg-gray'}" style="padding:1px 4px; font-size:9px;" onclick="window.adminTogglePin(event, ${n.id})">📌</button>
                        </div>
                        <input type="checkbox" style="width:16px; height:16px; cursor:pointer; margin:0;" ${isSelected ? 'checked' : ''} onclick="window.toggleNoticeSelection(event, ${n.id})">
                    </div>
                ` : '';

                listHTML += `
                <div style="margin-bottom:4px; padding:6px 8px; background:rgba(0,0,0,0.6); border:1px solid ${isSelected ? '#3b82f6' : '#444'}; border-radius:4px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.1s;" 
                     onmouseover="this.style.borderColor='#fd0'" onmouseout="this.style.borderColor='${isSelected ? '#3b82f6' : '#444'}'"
                     onclick="window.showFullNotice(${n.id})">
                    <div style="color:${isSelected ? '#3b82f6' : '#fd0'}; font-size:13px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; margin-right:6px;">
                        ${pinBadge} ${titleStr}
                    </div>
                    ${adminTools}
                </div>`;
            });
        }

        let adminWriteBtn = window.isAdminAuth ? `
            <div style="display:flex; gap:4px; margin-left:auto;">
                <button class="confirm-btn bg-dark-red" style="padding:4px 8px; font-size:11px;" onclick="window.adminDeleteSelectedNotices()">🗑️ 선택 삭제</button>
                <button class="confirm-btn bg-dark-green" style="padding:4px 8px; font-size:11px;" onclick="window.adminWriteNotice()">📝 새 글 작성</button>
            </div>
        ` : '';

        noticeBoxHTML = `
        <div style="background:rgba(20,20,25,0.8); border:1px solid #444; border-radius:4px; padding:8px; margin-bottom:8px; display:flex; flex-direction:column; min-height: 200px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #555; padding-bottom:6px; margin-bottom:8px;">
                <b style="color:#fd0; font-size:13px;">📢 [게시판]</b>
                ${adminWriteBtn}
            </div>
            
            <div style="max-height:220px; overflow-y:auto; padding-right:4px;">
                ${listHTML}
            </div>
        </div>`;
    }

    let msgHTML = '';
    filtered.forEach(c => {
        // 💡 [수정] 메시지 안의 줄바꿈(\n)을 HTML 태그(<br>)로 변환하여 세로로 깔끔하게 정렬
        let formattedMsg = c.msg.replace(/\n/g, '<br>');
        msgHTML += `<div style="color:${c.color}; margin-bottom:4px; line-height: 1.4;">${formattedMsg}</div>`;
    });

    if (popChat && window.isChatPopupOpen) {
        popChat.innerHTML = noticeBoxHTML + msgHTML;
        popChat.scrollTop = popChat.scrollHeight;
    }

    if (chat) {
        chat.innerHTML = noticeBoxHTML + msgHTML;
        if (!window.isChatPopupOpen) chat.scrollTop = chat.scrollHeight;
    }
}



// ==========================================
// [채팅 엔진, 탭 필터링 및 운영자 명령어 통합]
// ==========================================

// 4. 슬래시(/) 명령어 판별기 및 운영자 전용 툴킷
window.lastWhisperTarget = null;

function processChatCommand(cmdStr) {
    let args = cmdStr.trim().split(/\s+/);
    let cmd = args[0];

    if (cmd === '/?' || cmd === '/help') {
        addMessage("==== [명령어 목록] ====", '#fd0', 'system');
        addMessage("/누구 또는 /who : 접속자 목록 확인", '#fff', 'system');
        addMessage("/귓말 [이름] [할말] : 1:1 귓속말", '#fff', 'system');
        addMessage("/r [할말] : 마지막 귓속말 대상에게 빠른 답장", '#5cf', 'system');
        addMessage("/귓말종료 : 귓속말 고정(답장) 대상 해제", '#aaa', 'system');
        addMessage("/파티초대 [이름], /파티탈퇴, /파티모드", '#5cf', 'system');
        
        if (window.isAdminAuth) {
            addMessage("---- [👑 운영자 명령어 목록] ----", '#ef4444', 'system');
            addMessage("• /서버리부팅 : 서버 및 AI 봇 3초 후 동시 재부팅", '#fd0', 'system');
            addMessage("• /모험가생성 : 기존 AI 삭제 후 고유 닉네임 100명 생성", '#fd0', 'system');
            addMessage("• /공지 [내용] : 전체 유저 긴급 공지 전파", '#fd0', 'system');
            addMessage("• /소환 [몬스터명] [수량] : 현재 위치 몬스터 소환", '#fd0', 'system');
            addMessage("• /아데나 [수량], /레벨 [레벨] : 스펙 조정", '#fd0', 'system');
            addMessage("• /이동 [맵코드], /청소 : 맵 이동 및 바닥 청소", '#fd0', 'system');
            addMessage("• /플레이어삭제 [캐릭터명] : DB 영구 삭제", '#fd0', 'system');
            addMessage("• /운영자종료 : 운영자 권한 해제", '#aaa', 'system');
        } else {
            addMessage("/운영자 [계정/비번] : 운영자 권한 획득", '#888', 'system');
        }
    }

    else if (cmd === '/파티초대') {
        if (args.length < 2) return addMessage("사용법: /파티초대 [캐릭터명]", '#f55', 'system');
        let targetName = args[1];
        let targetPlayer = entities.find(e => e.isPlayer && e.name === targetName);
        if (targetPlayer) {
            if (window.socket) window.socket.emit('party_invite', { targetSocketId: targetPlayer.id || targetPlayer.socketId, targetName: targetName });
            addMessage(`[파티] ${targetName}님에게 초대를 보냈습니다. (상대가 수락하면 파티 HUD가 뜹니다)`, '#5cf', 'system');
        } else {
            addMessage(`[파티] 화면 주변에 '${targetName}'님이 없습니다.`, '#f55', 'system');
        }
    }
    else if (cmd === '/파티탈퇴') {
        if (window.socket) window.socket.emit('party_leave');
    }
    else if (cmd === '/파티모드') {
        if (window.socket) window.socket.emit('party_mode_toggle');
    }   
    else if (cmd === '/누구' || cmd === '/who') {
        if (window.socket) window.socket.emit('cmd_who');
    } 
    else if (cmd === '/r' || cmd === '/ㄱ') {
        if (!window.lastWhisperTarget) return addMessage("최근에 대화한 대상이 없습니다.", '#f55', 'system');
        let content = args.slice(1).join(' ');
        if (!content) return addMessage("사용법: /r [할말]", '#f55', 'system');
        if (window.socket) window.socket.emit('cmd_whisper', { targetName: window.lastWhisperTarget, content });
        addMessage(`[귓말 ➔ ${window.lastWhisperTarget}]: ${content}`, '#e879f9', 'whisper');
    }
    else if (cmd === '/귓말') {
        if (args.length < 3) return addMessage("사용법: /귓말 [이름] [할말]", '#f55', 'system');
        let targetName = args[1];
        let content = args.slice(2).join(' ');
        window.lastWhisperTarget = targetName; 
        if (window.socket) window.socket.emit('cmd_whisper', { targetName, content });
        addMessage(`[귓말 ➔ ${targetName}]: ${content}`, '#e879f9', 'whisper');
    } 
    else if (cmd === '/귓말종료' || cmd === '/귓말해제') {
        window.lastWhisperTarget = null;
        addMessage("귓속말 답장 대상이 성공적으로 해제되었습니다.", '#aaa', 'system');
    }
    else if (cmd === '/운영자') {
        let authStr = args[1];
        if (authStr === 'xerimaii@gmail.com/90051254') {
            window.isAdminAuth = true;
            addMessage("👑 [운영자 권한 승인] 콘솔 명령어가 활성화되었습니다. (/? 확인)", '#fd0', 'system');
        } else {
            addMessage("인증 실패: 계정 또는 비밀번호 오류", '#f55', 'system');
        }
    } 
    else if (cmd === '/운영자해제' || cmd === '/운영자종료') {
        window.isAdminAuth = false;
        addMessage("운영자 권한이 안전하게 해제되었습니다.", '#aaa', 'system');
    }
    else if (window.isAdminAuth) {
        if (cmd === '/공지') {
            let noticeText = args.slice(1).join(' ');
            if (noticeText) {
                if (window.socket) window.socket.emit('admin_notice', { message: noticeText });
                addMessage("[시스템] 공지사항이 성공적으로 등록 및 전파되었습니다.", '#5f5', 'system');
            } else {
                addMessage("사용법: /공지 [등록할 공지 내용 및 업데이트 사항]", '#f55', 'system');
            }
        }
        // 💡 100명 생성 명령어 (기존 에이전트 자동 삭제 포함)
        else if (cmd === '/모험가생성' || cmd === '/ai생성' || cmd === '/100명생성') {
            generateAIAgents();
        }
        // 💡 server.js + aiAgentRunner.js 원클릭 동시 재부팅 명령어
        else if (cmd === '/서버리부팅' || cmd === '/전체리부팅' || cmd === '/리부팅') {
            showConfirm("⚠️ [경고] 서버(server.js)와 AI 봇(aiAgentRunner.js)을 재부팅하시겠습니까?\n접속자 데이터 안전 저장 후 즉시 재시작됩니다.", () => {
                if (window.socket) {
                    window.socket.emit('admin_reboot_all');
                    addMessage("🔄 서버 및 AI 에이전트 리부팅 신호를 전송했습니다.", '#fd0', 'system');
                }
            });
        }
        else if (cmd === '/공지창' || cmd === '/게시판관리') {
            if (typeof window.openAdminNoticeManager === 'function') {
                window.openAdminNoticeManager();
            } else {
                window.openAdminNoticeManager = function() {
                    let currentNotice = localStorage.getItem('server_global_notice') || "";
                    showPrompt("👑 [운영자 전용] 시스템 탭 공지 및 업데이트 내용을 수정하세요:", currentNotice, 1000, (newText) => {
                        if (newText !== null && window.socket) {
                            window.socket.emit('admin_notice', { message: newText });
                        }
                    }, true);
                };
                window.openAdminNoticeManager();
            }
        }
        else if (cmd === '/플레이어삭제') {
            if (args[1]) deletePlayerByAdmin(args[1]);
        }
        else if (cmd === '/소환') {
            if (window.socket && args[1]) window.socket.emit('admin_spawn_mob', { mobName: args[1], count: parseInt(args[2]) || 1, x: player.x, y: player.y, map: currentMap });
        }
        else if (cmd === '/아데나') {
            player.adena = (player.adena || 0) + (parseInt(args[1]) || 0);
            updateUI();
            addMessage(`[치트] 아데나 지급 완료.`, '#5f5', 'system');
        }
        else if (cmd === '/레벨') {
            player.level = parseInt(args[1]) || player.level;
            player.exp = 0;
            updateUI();
            addMessage(`[치트] 레벨 변경 완료.`, '#5f5', 'system');
        }
        else if (cmd === '/이동') {
            if (args[1] && maps[args[1]]) changeMap(args[1], 2000, 2000);
        }
        else if (cmd === '/청소') {
            if (window.socket) window.socket.emit('admin_clear_floor', { map: currentMap });
        }
        else {
            addMessage(`알 수 없는 운영자 명령어입니다: ${cmd}`, '#f55', 'system');
        }
    }
}

// 5. 전송 함수
function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    const msg = chatInput.value.trim();
    
    if (msg !== '') {
        if (msg.startsWith('/')) {
            processChatCommand(msg);
        } else {
            player.bubbleText = msg;
            player.bubbleTimer = Date.now() + 5000; 
            
            let isPartyMsg = window.currentChatTab === 'party';
            let chatType = isPartyMsg ? 'party' : 'normal';
            
            if (window.socket && currentUser) {
                window.socket.emit('chat_message', {
                    senderId: currentUser.id,
                    name: player.name,
                    message: msg,
                    map: currentMap,
                    chatType: chatType
                });
            }
        }
        chatInput.value = '';
    }
    chatInput.blur(); 
}

window.sendPopupChatMessage = function() {
    const input = document.getElementById('popup-chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (msg !== '') {
        if (msg.startsWith('/')) {
            processChatCommand(msg);
        } else {
            player.bubbleText = msg;
            player.bubbleTimer = Date.now() + 5000;
            let isPartyMsg = window.currentChatTab === 'party';
            let chatType = isPartyMsg ? 'party' : 'normal';

            if (window.socket && currentUser) {
                window.socket.emit('chat_message', {
                    senderId: currentUser.id,
                    name: player.name,
                    message: msg,
                    map: currentMap,
                    chatType: chatType
                });
            }
        }
        input.value = '';
    }
};

document.addEventListener('keydown', (e) => {
    const popInput = document.getElementById('popup-chat-input');
    if (popInput && document.activeElement === popInput && e.key === 'Enter') {
        e.preventDefault();
        sendPopupChatMessage();
    }
});

const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

window.addEventListener('keydown', (e) => {
    const popInput = document.getElementById('popup-chat-input');
    const isPopOpen = window.isChatPopupOpen && popInput;

    if (chatInput && document.activeElement === chatInput) {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage();
        }
        return;
    }

    if (popInput && document.activeElement === popInput) {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            sendPopupChatMessage();
        }
        return;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        if (isPopOpen) {
            popInput.focus();
        } else if (chatInput) {
            chatInput.focus();
        }
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

async function deletePlayerByAdmin(charName) {
    const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    if (!sb) return;
    const { error } = await sb.from('characters').delete().eq('name', charName);
    if (error) addMessage(`삭제 실패: ${error.message}`, '#f55', 'system');
    else addMessage(`[${charName}] 캐릭터가 DB에서 삭제되었습니다.`, '#fd0', 'system');
}

async function generateAIAgents() {
    const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    if (!sb || !currentUser) return addMessage("로그인 정보 또는 DB 연결이 유효하지 않습니다.", '#f55', 'system');
    
    addMessage("🔄 [1/2] 기존 AI 모험가 데이터를 Supabase에서 삭제 중입니다...", '#fd0', 'system');
    
    // 1. 기존 AI 에이전트(slot_index >= 100) 전체 삭제
    const { error: delError } = await sb.from('characters').delete().gte('slot_index', 100);
    if (delError) {
        return addMessage(`기존 AI 데이터 삭제 실패: ${delError.message}`, '#f55', 'system');
    }

    addMessage("✨ [2/2] 고유 닉네임 100명 완벽 생성을 시작합니다...", '#5cf', 'system');

    // 2. 넉넉한 120개 순수 한글 고유 닉네임 풀 (숫자 없음)
    const pureNamePool = [
        '바다', '하늘', '구름', '별빛', '달빛', '바람', '노을', '파도', '햇살', '이슬',
        '안개', '번개', '태양', '은하', '서리', '새벽', '황혼', '설원', '단풍', '초원',
        '산울림', '물안개', '달그림자', '미르', '가람', '나래', '라온', '마루', '아라', '다솜',
        '늘봄', '온새미로', '하랑', '한결', '보람', '찬란', '아련', '적막', '여명', '월광',
        '칠흑', '심연', '침묵', '고독', '비상', '선율', '잔향', '질풍', '무법자', '사신',
        '암살자', '백작', '영웅', '전설', '타이탄', '바이퍼', '카이로', '흑기사', '성기사', '용기사',
        '그림자', '발키리', '버서커', '슬레이어', '소드마스터', '마도사', '정령왕', '궁수', '스나이퍼', '팬텀',
        '불패', '패왕', '제왕', '절대자', '천존', '군림', '혈왕', '광풍', '폭풍', '천둥',
        '염화', '빙결', '뇌제', '패도', '혈풍', '일격', '극의', '무신', '투신', '검선',
        '패황', '구문룡', '포세이돈', '집행자', '붉은사자', '하얀늑대', '사이하', '그랑카인', '아인하사드', '단테스',
        '커츠', '바포메트', '데스나이트', '오만', '화룡', '수룡', '풍룡', '지룡', '혜성', '은하수',
        '푸른달', '붉은달', '칼날', '방패', '수호자', '추적자', '심판관', '방랑자', '선봉장', '결사대'
    ];

    // 무작위 셔플
    let candidateNames = pureNamePool.sort(() => 0.5 - Math.random());

    const classes = ['knight', 'wizard', 'elf'];
    const alignments = [30000, 0, -30000];
    let successCount = 0;
    let slotOffset = 1;

    // 💡 100명이 완전히 채워질 때까지 풀에서 꺼내어 생성 (중복 시 다음 닉네임 자동 사용)
    while (successCount < 100 && candidateNames.length > 0) {
        let uniqueName = candidateNames.pop();
        let cClass = classes[Math.floor(Math.random() * classes.length)];
        let align = alignments[Math.floor(Math.random() * alignments.length)];
        
        let lv = Math.floor(Math.random() * 46) + 15; // Lv.15 ~ 60
        let startAdena = 500000 + (lv * 40000);

        let pData = typeof getInitialPlayer === 'function' ? getInitialPlayer() : { hp: 150, maxHp: 150, mp: 30, maxMp: 30, inv: [] };
        pData.name = uniqueName;
        pData.charClass = cClass;
        pData.alignment = align;
        pData.level = lv;
        pData.adena = startAdena;
        pData.inv = [];
        pData.equip = {};

        let enchantWp = lv >= 50 ? 8 : (lv >= 40 ? 7 : 6);
        let enchantAm = lv >= 50 ? 6 : (lv >= 40 ? 5 : 4);

        if (cClass === 'knight') {
            pData.equip.weapon = { name: `+${enchantWp} 싸울아비 장검`, type: 'weapon', atk: 16, enchantValue: enchantWp };
            pData.equip.armor = { name: `+${enchantAm} 강철 판금 갑옷`, type: 'armor', def: 8, enchantValue: enchantAm };
            pData.equip.helmet = { name: `+${enchantAm} 기사의 면갑`, type: 'helmet', def: 3, enchantValue: enchantAm };
            pData.equip.shield = { name: `+${enchantAm} 붉은 기사의 방패`, type: 'shield', def: 2, enchantValue: enchantAm };
            pData.equip.cloak = { name: `+${enchantAm} 보호 망토`, type: 'cloak', def: 1, enchantValue: enchantAm };
            pData.equip.belt = { name: '오우거의 벨트', type: 'belt', hpBonus: 30 };
            pData.inv.push({ name: '초록 물약', count: 300, type: 'potion' });
            pData.inv.push({ name: '용기의 물약', count: 200, type: 'potion' });
        } else if (cClass === 'elf') {
            pData.equip.weapon = { name: `+${enchantWp} 화염의 활`, type: 'weapon', atk: 14, isBow: true, enchantValue: enchantWp };
            pData.equip.armor = { name: `+${enchantAm} 요정족 판금 갑옷`, type: 'armor', def: 6, enchantValue: enchantAm };
            pData.equip.helmet = { name: `+${enchantAm} 엘름의 축복`, type: 'helmet', def: 3, dex: 1, enchantValue: enchantAm };
            pData.equip.cloak = { name: `+${enchantAm} 보호 망토`, type: 'cloak', def: 1, enchantValue: enchantAm };
            pData.equip.belt = { name: '신체의 벨트', type: 'belt', hpBonus: 50 };
            pData.inv.push({ name: '초록 물약', count: 300, type: 'potion' });
            pData.inv.push({ name: '엘븐 와퍼', count: 200, type: 'potion' });
        } else if (cClass === 'wizard') {
            pData.equip.weapon = { name: `+${enchantWp} 마나의 지팡이`, type: 'weapon', atk: 8, mpDrain: 2, enchantValue: enchantWp };
            pData.equip.armor = { name: `+${enchantAm} 신관의 로브`, type: 'armor', def: 6, mpRegen: 5, enchantValue: enchantAm };
            pData.equip.helmet = { name: `+${enchantAm} 신관의 투구`, type: 'helmet', def: 2, mpRegen: 1, enchantValue: enchantAm };
            pData.equip.cloak = { name: `+${enchantAm} 마법 망토`, type: 'cloak', def: 2, enchantValue: enchantAm };
            pData.equip.belt = { name: '빛나는 정신의 벨트', type: 'belt', mpBonus: 50, mpRegen: 2 };
            pData.inv.push({ name: '초록 물약', count: 300, type: 'potion' });
            pData.inv.push({ name: '파란 물약', count: 200, type: 'potion' });
            pData.magic = ['에너지 볼트', '힐', '실드', '파이어볼', '콜 라이트닝'];
        }

        pData.inv.push({ name: '주홍 물약', count: 500, type: 'potion', heal: 60 });
        pData.inv.push({ name: '귀환 주문서', count: 50, type: 'scroll' });

        const { error } = await sb.from('characters').insert([{
            user_id: currentUser.id,
            slot_index: 100 + slotOffset,
            name: pData.name,
            class_name: cClass,
            data: { player: pData, last_sync_time: 0 }
        }]);

        if (!error) {
            successCount++;
            slotOffset++;
        }
    }

    addMessage(`🎉 고유 닉네임 가상 모험가 ${successCount}명 생성 완료!`, '#5f5', 'system');
}


// ==========================================
// [14. 맵 이동 및 포탈 / 텔레포트 관리 함수]
// ==========================================
window.changeMap = function(newMap, nx, ny) { 
    if (typeof playSound === 'function') playSound('spell'); 

    // 💡 이 부분이 반드시 있어야 맵 이동 시 음악이 바뀝니다!
    if (typeof changeBGM === 'function') changeBGM(newMap);

    currentMap = newMap; 
    player.map = newMap;
    
    // 💡 1. 맵 이동 시 이전 타겟, 아이템 타겟, 이동 상태 완벽 초기화
    player.target = null;
    player.targetItem = null;
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
    
    // 💡 2. 파티클과 데미지 텍스트는 배열을 덮어쓰지 않고 내부를 비워 참조 끊김 방지
    particles.length = 0; 
    dmgTexts.length = 0;

    // 💡 3. 서버에 즉각적으로 타겟 null 상태와 바뀐 맵 좌표 전송
    if (window.socket && currentUser) {
        window.socket.emit('player_target', { targetId: null });
        window.socket.emit('player_update', {
            map: currentMap,
            x: nx,
            y: ny,
            targetId: null,
            isMoving: false
        });
    }

    // 내 용병들도 새 맵으로 안전하게 이동
    if (typeof entities !== 'undefined' && Array.isArray(entities)) {
        entities.forEach(e => {
            // 💡 수정됨: hp > 0 && !e.isDead 조건 추가
            if (e && (e.isMercenary || e.isSummon) && e.owner === player && e.hp > 0 && !e.isDead) {
                e.map = newMap;
                e.x = nx + (Math.random() * 60 - 30);
                e.y = ny + (Math.random() * 60 - 30);
                e.target = null; e.isMoving = false;
            }
        });
    }

    if (typeof applyBuff === 'function') {
        applyBuff('앱솔루트 배리어', 3000, '✨', 'invincible', 1, player);
        if (typeof addMessage === 'function') addMessage("텔레포트 착지 보호막이 3초간 적용됩니다.", "#5f5");
    }

    if (typeof $ === 'function' && $('map-name') && maps[currentMap]) {
        $('map-name').innerText = maps[currentMap].name + ' [' + (maps[currentMap].recLv || 'N/A') + ']'; 
    }
    if (typeof updateUI === 'function') updateUI(); 
};







window.teleportPrompt = function() {
    let teleportListEl = document.getElementById('teleport-list');
    if (!teleportListEl) return;
    
    let mapKeys = Object.keys(maps);
    mapKeys.sort((a, b) => {
        if (a === 'boss_raid') return 1;
        if (b === 'boss_raid') return -1;

        let m1 = maps[a]; let m2 = maps[b];
        let isSafeA = m1.safeZones && m1.safeZones.length > 0;
        let isSafeB = m2.safeZones && m2.safeZones.length > 0;
        if (isSafeA && !isSafeB) return -1;
        if (!isSafeA && isSafeB) return 1;

        let getMinLevel = (str) => {
            if (!str) return 999;
            if (str.includes('100+') || str.includes('105+')) return 100;
            let match = str.match(/\d+/);
            return match ? parseInt(match[0]) : 999;
        };
        return getMinLevel(m1.recLv) - getMinLevel(m2.recLv);
    });

    let html = '';
    mapKeys.forEach(key => {
        let m = maps[key];
        let isRaid = key === 'boss_raid';
        let hasSafeZone = m.safeZones && m.safeZones.length > 0;
        let safeBadge = hasSafeZone ? ` <span style="color:#5f5; font-size:11px;">[안전지대]</span>` : '';
        let recLvText = m.recLv ? ` [${m.recLv}]` : '';

        let targetX = hasSafeZone ? m.safeZones[0].x : -1;
        let targetY = hasSafeZone ? m.safeZones[0].y : -1;

        let onClickAction = isRaid 
            ? `window.enterBossRaid(); document.getElementById('teleport-modal').style.display='none';` 
            : `changeMap('${key}', ${targetX}, ${targetY}); document.getElementById('teleport-modal').style.display='none';`;

        let btnBg = isRaid ? 'background: linear-gradient(to right, #7f1d1d, #450a0a); border-color:#dc2626;' : '';

        html += `<button class="confirm-btn bg-dark-green" style="margin:2px; display:flex; justify-content:space-between; align-items:center; padding:8px 12px; ${btnBg}" onclick="${onClickAction}">
            <span style="${isRaid ? 'color:#facc15; font-weight:bold;' : ''}">${m.name}${safeBadge}</span>
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

    const addEq = (name, type, grade, stats) => {
        freshPlayer.inv.push({ id: type + '_' + Date.now() + Math.random(), name: name, type: type, grade: grade, ...stats });
    };
    const addPot = (name, count) => {
        freshPlayer.inv.push({ id: 'pot_' + Date.now() + Math.random(), name: name, type: 'potion', count: count });
    };

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

window.selectedAllyId = null;

window.selectAlly = function(id, name) {
    if (typeof playSound === 'function') playSound('click');
    let targetEnt = entities.find(e => e.id === id || e.socketId === id || e.id === 'merc_' + id);
    
    if (window.selectedAllyId === id) {
        window.selectedAllyId = null;
        player.friendlyTarget = null;
        if (typeof addMessage === 'function') addMessage(`[선택 해제] 아군 선택이 취소되었습니다.`, '#aaa');
    } else {
        window.selectedAllyId = id;
        player.friendlyTarget = targetEnt || null;
        if (typeof addMessage === 'function') addMessage(`[아군 선택] ${name}님에게 힐/버프 조준 완료!`, '#5f5');
    }
    
    if (typeof renderMercenaryHUD === 'function') renderMercenaryHUD();
    if (typeof renderPartyHUD === 'function') renderPartyHUD();
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

        let isSelected = (window.selectedAllyId === merc.id);
        let borderStyle = isSelected ? 'border: 2px solid #4ade80; box-shadow: 0 0 8px rgba(74,222,128,0.6);' : 'border: 1px solid #444455;';

        html += `
        <div class="merc-hud-card" style="pointer-events: auto !important; cursor: pointer; position: relative; z-index: 99999; transition: 0.2s; ${borderStyle}"
             onclick="window.selectAlly('${merc.id}', '${merc.name}')"
             oncontextmenu="event.preventDefault(); window.openPetUI(entities.find(e=>e.id==='${merc.id}')); return false;">
            <div class="merc-name-row">${displayName}</div>
            <div class="merc-bar-wrap">
                <div class="merc-bar-fill hp" style="width: ${hpPct}%;"></div>
            </div>
            <div class="merc-bar-wrap">
                <div class="merc-bar-fill mp" style="width: ${mpPct}%;"></div>
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

function injectMobileBottomFix() {

    if (document.getElementById('mobile-bottom-fix')) {

        document.getElementById('mobile-bottom-fix').remove();

    }

    const style = document.createElement('style');

    style.id = 'mobile-bottom-fix';

    

    style.innerHTML = `

        .window, .modal-window, [id^="win-"], [id$="-modal"] {

            max-width: 95vw !important;

            box-sizing: border-box !important;

        }



        #shop-list, #inv-list, #inv-tab-equip, #teleport-list {
            max-height: 55vh !important;
            overflow-y: scroll !important;
            scrollbar-gutter: stable;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
            padding-right: 4px !important;
        }



        #shop-list > div, #inv-list > div, #magic-list > div {

            max-width: 100% !important;

            box-sizing: border-box !important;

        }



        #map-name {

            font-size: 18px !important;

            font-weight: bold !important;

            letter-spacing: 0px !important;

            text-shadow: 1px 1px 2px #000, -1px -1px 2px #000 !important;

            max-width: calc(100vw - 180px) !important;

            white-space: nowrap !important;

            overflow: hidden !important;

            text-overflow: ellipsis !important;

            display: inline-block !important;

        }



        #zone-indicator {

            font-size: 15px !important;

            font-weight: bold !important;

        }



        @media (max-width: 768px) {

            #popup-chat-messages {

                flex-grow: 1 !important;

                overflow-y: auto !important;

            }

            #map-name {

                font-size: 13.5px !important;

                max-width: calc(100vw - 120px) !important;

            }

            #zone-indicator {

                font-size: 10.5px !important;

            }



            /* 💡 하단 바 고정 및 채팅창이 하단 바와 겹치지 않도록 위로 밀어냄 */

            #ui-bottom-bar {

                position: fixed !important;

                bottom: 0 !important;

                left: 0 !important;

                width: 100vw !important;

                margin: 0 !important;

                z-index: 999999 !important;

                box-sizing: border-box !important;

            }



            #chat-container, .chat-box-wrapper {

                bottom: 145px !important;

            }



            #buff-list {

                position: absolute !important;

                top: auto !important;

                bottom: 130px !important;

                left: 50% !important;

                transform: translateX(-50%) !important;

                display: flex !important;

                justify-content: center !important;

                flex-wrap: wrap !important;

                width: 100% !important;

                pointer-events: none !important;

                z-index: 99998 !important;

            }

            #buff-list .buff-wrap {

                pointer-events: auto !important;

                width: 24px !important;

                height: 24px !important;

                margin-right: 2px !important;

            }

            #buff-list .buff-wrap div {

                width: 20px !important;

                height: 20px !important;

                font-size: 12px !important;

            }

            #ui-left {

                padding: 2px 2px !important;

                justify-content: space-evenly !important;

            }

            #ui-left .stat-row {

                line-height: 1.1 !important;

                margin: 0 !important;

            }

            #ui-bars { padding: 3px 5px !important; gap: 2px !important; }

            .bar-wrap { height: 13px !important; } 

            .bar-text { 

                font-size: 8.5px !important; 

                line-height: 13px !important; 

                font-weight: bold !important;

                text-shadow: 1px 1px 1px #000, -1px -1px 1px #000 !important;

            }            

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



    if (!document.getElementById('dim-overlay')) {

        const dim = document.createElement('div');

        dim.id = 'dim-overlay';

        dim.style.cssText = `

            position: fixed;

            top: 0; left: 0; width: 100vw; height: 100vh;

            background: #000;

            opacity: 0;

            pointer-events: none;

            transition: opacity 1.2s ease;

            z-index: 999998;

        `;

        document.body.appendChild(dim);

    }

}

injectMobileBottomFix();

function initMobileChatResizer() {
    const pop = document.getElementById('win-chat-popup');
    if(!pop) return;
    
    let resizer = document.createElement('div');
    resizer.style.cssText = 'position:absolute; right:0; bottom:0; width:35px; height:35px; cursor:se-resize; z-index:10; background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%); border-bottom-right-radius: 6px;';
    pop.appendChild(resizer);

    let isResizing = false, startX, startY, startW, startH;
    
    const startResize = (e) => {
        e.preventDefault(); e.stopPropagation();
        isResizing = true;
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startW = pop.offsetWidth;
        startH = pop.offsetHeight;
        document.addEventListener('touchmove', doResize, {passive:false});
        document.addEventListener('touchend', stopResize);
    };
    
    const doResize = (e) => {
        if(!isResizing) return;
        e.preventDefault();
        let cx = e.touches ? e.touches[0].clientX : e.clientX;
        let cy = e.touches ? e.touches[0].clientY : e.clientY;
        
        pop.style.width = Math.max(280, startW + (cx - startX)) + 'px';
        pop.style.height = Math.max(200, startH + (cy - startY)) + 'px';
    };
    
    const stopResize = () => {
        isResizing = false;
        document.removeEventListener('touchmove', doResize);
        document.removeEventListener('touchend', stopResize);
    };
    
    resizer.addEventListener('touchstart', startResize, {passive:false});
}

document.addEventListener('DOMContentLoaded', () => {
    initMobileChatResizer();
});

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

window.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.shop-item-info') && !e.target.closest('.inv-slot') && !e.target.closest('.ce-slot') && !e.target.closest('#tooltip')) {
        if (typeof hideTooltip === 'function') hideTooltip();
    }
    
    if (window.activeEnchantScrollKey && !e.target.closest('.inv-slot') && !e.target.closest('.ce-slot')) {
        if (typeof cancelEnchantMode === 'function') window.cancelEnchantMode();
        if (typeof addMessage === 'function') addMessage("주문서 사용이 취소되었습니다.", '#aaa');
    }
});

window.showPartyMenu = function(targetPlayer) {
    if (!targetPlayer) return;
    
    let partyData = window.currentPartyData?.party;
    let mySockId = window.socket?.id;
    let targetSockId = targetPlayer.socketId || targetPlayer.id;

    let amIInParty = Boolean(partyData && partyData.members.some(m => m.socketId === mySockId));
    let amIPartyLeader = Boolean(partyData && partyData.leader === mySockId);
    let isTargetInMyParty = Boolean(partyData && partyData.members.some(m => m.socketId === targetSockId));

    let btns = [];

    if (amIInParty && isTargetInMyParty) {
        let currentMode = partyData.mode || 'free';
        let isFocus = currentMode === 'focus';

        btns.push({
            text: isFocus ? '⚔️ [자유 사냥 모드]로 전환' : '🎯 [파티 점사 모드]로 전환',
            color: isFocus ? '#1e3a8a' : '#991b1b',
            callback: () => {
                if (window.socket) {
                    let nextMode = isFocus ? 'free' : 'focus';
                    window.socket.emit('party_set_mode', { mode: nextMode });
                    if (typeof addMessage === 'function') {
                        addMessage(`[파티] 파티 전투 모드를 [${nextMode === 'focus' ? '점사' : '자유'}] 모드로 변경했습니다.`, '#fd0');
                    }
                }
            }
        });

        if (amIPartyLeader && targetSockId !== mySockId) {
            btns.push({
                text: `👑 [${targetPlayer.name}]에게 파티장 위임`,
                color: '#7c3aed',
                callback: () => {
                    if (window.socket) {
                        window.socket.emit('party_change_leader', { newLeaderSocketId: targetSockId });
                    }
                }
            });

            btns.push({
                text: `🚫 [${targetPlayer.name}] 파티 추방`,
                color: '#991b1b',
                callback: () => {
                    if (window.socket) {
                        window.socket.emit('party_kick', { targetSocketId: targetSockId });
                    }
                }
            });
        }

        btns.push({
            text: '🚪 파티 탈퇴하기',
            color: '#475569',
            callback: () => {
                if (window.socket) {
                    window.socket.emit('party_leave');
                    if (typeof addMessage === 'function') addMessage('[파티] 파티에서 탈퇴했습니다.', '#aaa');
                }
            }
        });
    } else {
        btns.push({
            text: `👥 [${targetPlayer.name}] 파티 초대`,
            color: '#1d4ed8',
            callback: () => {
                if (window.socket) {
                    window.socket.emit('party_invite', {
                        targetSocketId: targetSockId,
                        targetName: targetPlayer.name
                    });
                    if (typeof addMessage === 'function') addMessage(`[파티] ${targetPlayer.name}님에게 초대를 보냈습니다.`, '#5cf');
                }
            }
        });
    }

    btns.push({ text: '닫기', color: '#333', callback: () => {} });

    let statusText = (amIInParty && isTargetInMyParty) 
        ? `\n파티 상태: ${partyData.mode === 'focus' ? '🎯 점사 모드' : '⚔️ 자유 모드'}` 
        : '';

    showCustomPrompt(`[플레이어 / 파티 메뉴]\n이름: ${targetPlayer.name}\n클래스: ${targetPlayer.charClass || '기사'}${statusText}`, btns);
};

window.showClassPassiveInfo = function() {
    let pClass = player.charClass || 'knight';
    let title = '';
    let classSpecificHtml = '';

    if (pClass === 'knight' || pClass === 'royal') {
        title = "⚔️ 기사/군주 클래스 완벽 가이드 & 패시브";
        classSpecificHtml = `
            <div style="background:rgba(56,189,248,0.1); border-left:3px solid #38bdf8; padding:8px; margin-bottom:8px;">
                <b style="color:#38bdf8; font-size:14px;">[고유 패시브 1] 돌진 (Rush)</b><br>
                • 대상과의 거리가 사거리(55~350px) 밖에 있으면 쿨타임(2초)마다 적의 코앞으로 순식간에 파고들어 즉시 전투를 시작합니다.
            </div>
            <div style="background:rgba(239,68,68,0.1); border-left:3px solid #ef4444; padding:8px; margin-bottom:12px;">
                <b style="color:#ef4444; font-size:14px;">[고유 패시브 2] 광폭화 & 클리브 (Fury & Cleave)</b><br>
                • 강한 대미지를 입거나 다수의 적(4명 이상)에게 포위당하면 3.5초간 광폭화 상태에 돌입합니다.<br>
                • 광폭화 중에는 <b>공격력이 2배로 폭발</b>하며, 평타 공격 시 주변 95px 내 적들을 함께 베어버리는 광역 참격(클리브)이 발동합니다.<br>
                • 이때 적에게 입힌 총 피해량의 25%가 <b>즉시 체력(HP)으로 흡혈</b>되어 위기를 극복합니다.
            </div>`;
    } else if (pClass === 'elf') {
        title = "🏹 요정 클래스 완벽 가이드 & 패시브";
        classSpecificHtml = `
            <div style="background:rgba(74,222,128,0.1); border-left:3px solid #4ade80; padding:8px; margin-bottom:8px;">
                <b style="color:#4ade80; font-size:14px;">[고유 패시브 1] 에코 오브 실프 (Echo of Sylph)</b><br>
                • 평타 사격 시 25% 확률로 정령의 바람이 실려 추가 마법 피해를 입히고 MP를 4~5 즉시 회복합니다.
            </div>
            <div style="background:rgba(250,204,21,0.1); border-left:3px solid #facc15; padding:8px; margin-bottom:8px;">
                <b style="color:#facc15; font-size:14px;">[고유 패시브 2] 실프의 폭풍 (Sylph Tempest)</b><br>
                • 평타 타격이 5회 누적되면 4초간 에메랄드 바람 오라와 함께 광폭화 상태가 됩니다.<br>
                • 주변 200px 적들에게 광역 화살 세례를 퍼붓고 대미지의 일부를 HP/MP로 흡수합니다.
            </div>
            <div style="background:rgba(56,189,248,0.1); border-left:3px solid #38bdf8; padding:8px; margin-bottom:12px;">
                <b style="color:#38bdf8; font-size:14px;">[전투 AI] 스마트 카이팅</b><br>
                • 적이 150px 이내로 너무 가까이 접근하면 자동으로 뒤로 물러나며 원거리 무빙샷을 구사합니다.
            </div>`;
    } else if (pClass === 'wizard') {
        title = "🔮 마법사 클래스 완벽 가이드 & 패시브";
        classSpecificHtml = `
            <div style="background:rgba(192,132,252,0.1); border-left:3px solid #c084fc; padding:8px; margin-bottom:8px;">
                <b style="color:#c084fc; font-size:14px;">[고유 패시브 1] 스마트 마력 순환</b><br>
                • 적의 수(3마리 이상 광역/단일)와 보스 여부에 따라 가방/슬롯에 등록된 마법 중 가장 효율적이고 강력한 마법을 자동으로 선별하여 난사합니다.
            </div>
            <div style="background:rgba(56,189,248,0.1); border-left:3px solid #38bdf8; padding:8px; margin-bottom:12px;">
                <b style="color:#38bdf8; font-size:14px;">[전투 AI] 원형 오르빗 카이팅</b><br>
                • 적이 접근하면 안전 거리를 유지하며 플레이어를 중심축으로 원을 그리며 회전하며 마법을 퍼붓습니다.
            </div>`;
    }

    let body = `
    <div style="text-align:left; font-size:13.5px; line-height:1.6; color:#ddd; max-height:60vh; height:500px; overflow-y:auto; padding-right:8px; box-sizing:border-box;">
        <div style="font-size:14px; font-weight:bold; color:#fd0; margin-bottom:6px; border-bottom:1px solid #444; padding-bottom:3px;">
            1. 내 캐릭터 종족(클래스) 특성 및 패시브 스킬
        </div>
        ${classSpecificHtml}
        <div style="font-size:14px; font-weight:bold; color:#fd0; margin:14px 0 6px 0; border-bottom:1px solid #444; padding-bottom:3px;">
            2. 화면 인터페이스(UI) 구조 및 모바일/PC 조작법
        </div>
        <div style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px; margin-bottom:8px;">
            • <b>상단 HP / MP / EXP 바:</b> 생명력, 마력, 경험치를 실시간으로 표시합니다. HP가 0이 되면 사망하며 3초 후 안전지대 마을에서 부활합니다.<br>
            • <b>미니맵 (minimap):</b> 현재 캐릭터의 위치, 주변 지형, 안전지대(초록색 원), 포탈 및 주요 NPC 위치를 보여줍니다.<br>
            • <b>이동 및 타겟팅 조작:</b><br>
              - <b>PC:</b> 마우스 좌클릭으로 이동 및 빈 땅 클릭, 몬스터를 클릭하면 타겟 고정 및 자동/수동 전투가 시작됩니다.<br>
              - <b>모바일:</b> 화면을 터치하여 이동하고, 몬스터나 NPC를 직접 터치하여 상호작용 및 전투를 진행합니다.<br>
            • <b>하단 토글 버튼 (물약 / 사냥):</b><br>
              - <b>물약 ON:</b> 설정한 조건에 맞춰 가방 속 회복 물약을 자동으로 마십니다.<br>
              - <b>사냥 ON:</b> 주변 몬스터를 자동 탐색해 사냥하고 바닥에 떨어진 아이템을 등급 필터에 맞춰 자동 줍기(루팅)합니다.<br>
            • <b>퀵슬롯 (F5 ~ F12):</b> 인벤토리 아이템이나 마법책 스킬을 끌어다 등록합니다.<br>
              - <b>마법 더블클릭:</b> 자동사냥 전용으로 지정되어 사냥 시 자동으로 난사됩니다.<br>
              - <b>마법 단일클릭:</b> 수동 타겟팅 모드가 켜져 원하는 적을 직접 지정해 공격할 수 있습니다.
        </div>
        <div style="font-size:14px; font-weight:bold; color:#fd0; margin:14px 0 6px 0; border-bottom:1px solid #444; padding-bottom:3px;">
            3. 상세한 게임 진행 방식 및 초보자 성장 가이드
        </div>
        <div style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px; margin-bottom:8px;">
            • <b>1단계:</b> 마을의 '판도라(잡화상인)'에게 들러 주홍 물약과 초록 물약 등을 구매하세요.<br>
            • <b>2단계:</b> 안전지대 마을 밖 초원 지역(Lv.1~15)에서 몬스터를 잡으며 아데나와 경험치를 모읍니다.<br>
            • <b>3단계:</b> 상인(게라드)에게 마법서, 기술서를 구매해 인벤토리에서 더블클릭하면 새로운 스킬을 배웁니다.<br>
            • <b>4단계:</b> '데이젤' 상인에게서 '무기/갑옷 마법 주문서'를 구매해 장비를 강화하세요 (무기 +6, 방어구 +4 안전강화).
        </div>
        <div style="font-size:14px; font-weight:bold; color:#fd0; margin:14px 0 6px 0; border-bottom:1px solid #444; padding-bottom:3px;">
            4. 핵심 콘텐츠 - 용병, 펫, 창고 시스템 활용 가이드
        </div>
        <div style="background:rgba(255,255,255,0.03); padding:8px; border-radius:4px;">
            • <b>⚔️ 용병 시스템:</b> 마을 '용병 단장'을 통해 최대 3명까지 고용할 수 있으며 가방 속 장비와 물약을 보급해 줄 수 있습니다.<br>
            • <b>🐾 펫 테이밍:</b> 잡화상인에게 '고기'를 사서 '도베르만' 근처에서 사용하면 일정 확률로 펫으로 길들일 수 있습니다.<br>
            • <b>📦 계정 공용 창고:</b> 마을 '창고지기'를 통해 계정 내 캐릭터 간 아데나와 아이템을 공유할 수 있습니다.
        </div>
    </div>`;

    showCustomPrompt(body, [{ text: '확인', color: '#166534', callback: () => {} }]);
    if ($('confirm-win-title')) $('confirm-win-title').innerText = title;
};

window.hideItemActionModal = function() {
    let modal = document.getElementById('item-action-modal');
    if (modal) modal.style.display = 'none';
    if (typeof hideTooltip === 'function') hideTooltip();
};

window.openMagicActionModal = function(magicName) {
    if (typeof hideTooltip === 'function') hideTooltip();
    let mData = typeof magicDb !== 'undefined' ? magicDb[magicName] : null;
    if (!mData) return;

    // 💡 마법 고유 플래그 확정
    selectedItemForAction = { 
        isMagic: true, 
        itemName: magicName,
        itemType: 'magic'
    };

    if ($('action-modal-title')) $('action-modal-title').innerText = `마법 설정 (${magicName})`;

    let html = `<b class="tooltip-title" style="color:#60a5fa">${magicName}</b><br>`;
    html += `<span style="color:#88aaff; font-size:12px;">소모 MP: ${mData.mp}</span>`;
    if (mData.cd) html += ` <span style="color:#facc15; font-size:12px; margin-left:8px;">쿨타임: ${(mData.cd / 1000).toFixed(1)}초</span>`;
    html += `<br>`;
    if (mData.dmg) html += `위력/피해량: ${mData.dmg}<br>`;
    if (mData.heal) html += `회복량: ${mData.heal}<br>`;
    if (mData.desc) html += `<div style="color:#ccc; margin-top:6px;">${mData.desc}</div>`;

    let modal = $('item-action-modal');
    if (modal) {
        if ($('action-modal-desc')) $('action-modal-desc').innerHTML = html;
        
        let mgmtEl = $('action-modal-item-mgmt');
        if (mgmtEl) mgmtEl.style.display = 'none';

        let purgeBtn = $('btn-purge-magic');
        if (purgeBtn) purgeBtn.style.display = 'none';

        modal.style.display = 'flex';
        if (typeof bringToFront === 'function') bringToFront('item-action-modal');
        if (typeof autoCenterWindow === 'function') autoCenterWindow('item-action-modal', true);
    }
};
document.addEventListener('dragstart', (e) => {
    let targetEl = e.target.closest('[oncontextmenu*="openMagicActionModal"]');
    if (targetEl) {
        let match = targetEl.getAttribute('oncontextmenu').match(/openMagicActionModal\('(.*?)'\)/);
        if (match && match[1]) {
            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'magic', id: match[1] }));
        }
    }
});



// ==========================================
// 💬 [채팅 히스토리 / 직전 대화 재입력 엔진]
// ==========================================
window.sentChatHistory = [];
window.chatHistoryCursor = -1;

// 1. 메시지 전송 시 기록 저장
function recordSentChat(text) {
    if (!text || text.trim() === '') return;
    window.sentChatHistory.unshift(text);
    if (window.sentChatHistory.length > 30) window.sentChatHistory.pop();
    window.chatHistoryCursor = -1;
}

// 2. PC 키보드 화살표 (↑ 이전 대화 / ↓ 다음 대화) 탐색
function setupInputKeyHistory(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            if (window.sentChatHistory.length === 0) return;
            e.preventDefault();
            if (window.chatHistoryCursor < window.sentChatHistory.length - 1) {
                window.chatHistoryCursor++;
                inputEl.value = window.sentChatHistory[window.chatHistoryCursor];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (window.chatHistoryCursor > 0) {
                window.chatHistoryCursor--;
                inputEl.value = window.sentChatHistory[window.chatHistoryCursor];
            } else if (window.chatHistoryCursor === 0) {
                window.chatHistoryCursor = -1;
                inputEl.value = '';
            }
        }
    });
}

// 3. 모바일 터치용 최근 대화 불러오기 버튼 주입
function injectMobileChatHistoryBtn() {
    ['chat-input-container', 'win-chat-popup'].forEach(containerId => {
        let parent = document.getElementById(containerId);
        if (!parent) return;

        let input = parent.querySelector('input[type="text"]');
        if (!input) return;

        setupInputKeyHistory(input);

        // 모바일 전용 히스토리 복원 버튼 생성 (중복 방지)
        let btnId = containerId + '-history-btn';
        if (!document.getElementById(btnId)) {
            let histBtn = document.createElement('button');
            histBtn.id = btnId;
            histBtn.type = 'button';
            histBtn.innerHTML = '↺';
            histBtn.title = '이전 대화 불러오기';
            histBtn.style.cssText = `
                background: #2a2a38;
                color: #fd0;
                border: 1px solid #556;
                border-radius: 3px;
                padding: 0 8px;
                font-size: 13px;
                cursor: pointer;
                height: ${input.offsetHeight || 24}px;
                margin-right: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            histBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.sentChatHistory.length > 0) {
                    window.chatHistoryCursor = (window.chatHistoryCursor + 1) % window.sentChatHistory.length;
                    input.value = window.sentChatHistory[window.chatHistoryCursor];
                    input.focus();
                }
            });

            input.parentNode.insertBefore(histBtn, input);
        }
    });
}

// 4. 전송 함수에 기록 후킹
const origSendChatMessage = window.sendChatMessage;
window.sendChatMessage = function() {
    let input = document.getElementById('chat-input');
    if (input && input.value.trim()) {
        recordSentChat(input.value.trim());
    }
    if (typeof origSendChatMessage === 'function') origSendChatMessage();
};

const origSendPopupChatMessage = window.sendPopupChatMessage;
window.sendPopupChatMessage = function() {
    let input = document.getElementById('popup-chat-input');
    if (input && input.value.trim()) {
        recordSentChat(input.value.trim());
    }
    if (typeof origSendPopupChatMessage === 'function') origSendPopupChatMessage();
};

document.addEventListener('DOMContentLoaded', () => {
    injectMobileChatHistoryBtn();
});


// ==========================================
// 🎵 [보스 어그로 및 BGM 자동 전환 상시 감지 타이머]
// ==========================================
setInterval(() => {
    if (typeof gameStarted === 'undefined' || !gameStarted || !player) return;

    // 플레이어의 타겟이 보스이고, 거리가 450px 이내로 교전 중일 때
    let hasBossAggro = player.target && player.target.isBoss && Math.hypot(player.target.x - player.x, player.target.y - player.y) <= 450;

    if (hasBossAggro && !window._isFightingBoss) {
        window._isFightingBoss = true;
        if (typeof playBossThemeByEntity === 'function') {
            playBossThemeByEntity(player.target);
        }
    } 
    else if (!hasBossAggro && window._isFightingBoss) {
        // 보스를 처치했거나 멀어져서 어그로가 해제된 경우 원래 맵 BGM으로 복구
        window._isFightingBoss = false;
        if (typeof changeBGM === 'function') {
            changeBGM(currentMap);
        }
    }
}, 200);
