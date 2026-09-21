// =========================================================================
// aiAgentRunner.js (Groq LLM 연동, 자율 파티 억제 및 본인/용병 자율 관리 적용)
// =========================================================================
require('dotenv').config();
const io = require('socket.io-client');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const SharedAI = require('./public/js/sharedAI.js'); 
const data = require('./public/js/data.js'); 

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const groq = new Groq({ apiKey: GROQ_API_KEY });

const fastHypot = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

let currentGroqModel = 'qwen/qwen3.8-27b';

async function initGroqModel() {
    try {
        const modelList = await groq.models.list();
        const availableIds = modelList.data.map(m => m.id);

        const priorityPreferences = [
            'qwen/qwen3.8-27b',
            'qwen/qwen3.6-27b',
            'openai/gpt-oss-120b',
            'openai/gpt-oss-20b',
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant'
        ];

        let picked = priorityPreferences.find(mId => availableIds.includes(mId));
        if (!picked) {
            picked = availableIds.find(id => 
                !id.includes('whisper') && 
                !id.includes('guard') && 
                !id.includes('compound')
            );
        }

        if (picked) {
            currentGroqModel = picked;
            console.log(`✔ [Groq 모델 자동 세팅 완료] 활성 모델: ${currentGroqModel}`);
        }
    } catch (err) {
        console.error("[-] Groq 모델 리스트 확인 실패 (기본값 유지):", err.message);
    }
}

let activeAgents = []; 
const MAX_CONCURRENT = 50;

class AIAgentClient {
    constructor(dbRow) {
        this.dbRow = dbRow;
        this.charData = dbRow.data.player || dbRow.data;
         
        this.charData.target = null;
        this.charData.targetId = null;
        this.charData.isMoving = false;
        this.charData.moveX = undefined;
        this.charData.moveY = undefined;
        this.charData.ignoredTargetId = null;
        this.charData.ignoredUntil = 0;

        this.charData.isPlayer = true;
        this.charData.isAI = true;

        this.lastSentHp = -1;
        this.lastSentTargetId = null;
        this.lastForcedUpdate = 0;
        this.lastSentTargetEventId = null;

        if (!this.charData.charClass) {
            let nameLower = (this.charData.name || '').toLowerCase();
            this.charData.charClass = nameLower.includes('wiz') ? 'wizard' : (nameLower.includes('elf') ? 'elf' : 'knight');
        }

        let lv = this.charData.level || 1;
        this.charData.exp = this.charData.exp || 0;
        this.charData.adena = Math.max(this.charData.adena || 0, 500000 + (lv * 25000));
        this.charData.maxHp = this.charData.maxHp || 150 + (lv * 45);
        this.charData.hp = this.charData.hp || this.charData.maxHp;
        this.charData.mp = this.charData.mp || 30;
        this.charData.maxMp = this.charData.maxMp || 50;
        this.charData.atk = this.charData.atk || 25;
        this.charData.def = this.charData.def || 5;
        this.charData.buffs = this.charData.buffs || {};
        this.charData.magic = this.charData.magic || [];

        // 💡 [에이전트 초기 장비 및 물약] 플레이어와 동일하게 세팅
        if (!this.charData.equip || !this.charData.equip.weapon) {
            this.charData.equip = { weapon: null, armor: null, helmet: null, cloak: null, gloves: null, boots: null, ring1: null, belt: null };
            this.charData.inv = [];
            
            if (this.charData.charClass === 'knight') {
                this.charData.equip.weapon = { name: '+6 싸울아비 장검', type: 'weapon', atk: 16, enchantValue: 6 };
                this.charData.equip.armor = { name: '+4 강철 판금 갑옷', type: 'armor', def: 8, enchantValue: 4 };
                this.charData.equip.helmet = { name: '+4 기사의 면갑', type: 'helmet', def: 3, enchantValue: 4 };
                this.charData.inv.push({ name: '주홍 물약', type: 'potion', count: 500, heal: 60 });
                this.charData.inv.push({ name: '초록 물약', type: 'potion', count: 300 });
                this.charData.inv.push({ name: '용기의 물약', type: 'potion', count: 200 });
            } else if (this.charData.charClass === 'elf') {
                this.charData.equip.weapon = { name: '+6 화염의 활', type: 'weapon', atk: 14, isBow: true, enchantValue: 6 };
                this.charData.equip.armor = { name: '+4 요정족 판금 갑옷', type: 'armor', def: 6, enchantValue: 4 };
                this.charData.equip.helmet = { name: '+4 엘름의 축복', type: 'helmet', def: 3, dex: 1, enchantValue: 4 };
                this.charData.inv.push({ name: '주홍 물약', type: 'potion', count: 500, heal: 60 });
                this.charData.inv.push({ name: '초록 물약', type: 'potion', count: 300 });
                this.charData.inv.push({ name: '엘븐 와퍼', type: 'potion', count: 200 });
            } else {
                this.charData.equip.weapon = { name: '+6 마나의 지팡이', type: 'weapon', atk: 8, sp: 2, mpDrain: 2, enchantValue: 6 };
                this.charData.equip.armor = { name: '+4 신관의 로브', type: 'armor', def: 6, mpRegen: 5, enchantValue: 4 };
                this.charData.inv.push({ name: '주홍 물약', type: 'potion', count: 500, heal: 60 });
                this.charData.inv.push({ name: '파란 물약', type: 'potion', count: 300 });
                this.charData.inv.push({ name: '초록 물약', type: 'potion', count: 200 });
            }
            this.charData.inv.push({ name: '귀환 주문서', type: 'scroll', count: 50 });
        }

        this.charData.mercs = this.charData.mercs || []; 
        this.recalculateAgentStats();

        this.socket = null;
        this.state = 'HUNTING'; 
        this.isShopping = false; 
        this.sessionStart = Date.now();
        
        let randomMinutes = Math.floor(Math.random() * 121) + 60;
        this.sessionDuration = randomMinutes * 60 * 1000; 
         
        this.lastAiCallTime = 0;
        this.lastMapCheckTime = Date.now();
        this.nextMercCheckTime = Date.now() + (Math.random() * 10000);
        this.lastRegenTime = Date.now();
        this.lastItemManageTime = Date.now();
        this.lastMercNeedsCheckTime = Date.now();
        
        this.lastPartyInviteTime = 0;
        this.lastProactiveInviteCheck = Date.now();
        this.rejectedTargets = new Set();
        this.invitedHistory = new Map();

        this.worldPlayers = [];
        this.worldMonsters = [];
        this.worldItems = [];
        this.worldMercs = [];

        this.chatHistory = [];
        this.combatMemory = "최근 평범하게 사냥 중입니다.";
        this.partyData = null; 
        this.lastInviterSocketId = null;
        this.lastInviterName = null;
        this.followTarget = null;
        this.followDist = 60;
        this.warpAllowed = false; 

        this.lastTalkedUser = null;
        this.lastTalkTime = 0;

        const personalities = [
            "말수가 적고 'ㅇㅇ', 'ㄱㅅ', 'ㅈㅅ' 등 단답형 초성체를 자주 쓰는 묵묵한 게이머",
            "친절하고 뉴비를 잘 챙겨주며 정중한 존댓말을 쓰는 게이머",
            "오직 사냥 효율과 보스 탐, 득템에만 집중하는 실용주의 게이머",
            "경상도 사투리를 구수하게 섞어 쓰고 정이 넘치는 아재 감성 게이머",
            "농담과 장난을 좋아하고 ㅋㅋㅋ를 자주 붙이는 활발한 수다쟁이 게이머",
            "승부욕이 강하고 사냥 방해에 민감한 호전적인 게이머"
        ];
        
        const inviteWeightMap = [0.05, 0.70, 0.20, 0.60, 0.80, 0.00];
        
        let hash = 0;
        for (let i = 0; i < this.charData.name.length; i++) hash += this.charData.name.charCodeAt(i);
        this.personality = personalities[hash % personalities.length];
        this.autoInviteChance = inviteWeightMap[hash % inviteWeightMap.length];

        this.learnMagicForLevel(); 
        this.connect();
    }

    connect() {
        this.socket = io(SERVER_URL, { 
            transports: ['websocket'], 
            upgrade: false
        });

        this.socket.on('disconnect', () => {
            this.partyData = null;
            this.followTarget = null;
        });

        this.socket.on('connect', () => {
            this.charData.id = this.socket.id; 
            console.log(`[🤖 AI 접속/재접속] ${this.charData.name}`);
             
            if (!this.hasConnectedOnce) {
                this.hasConnectedOnce = true;
                let startMap = this.determineBestMap();
                this.charData.map = startMap;
                this.charData.x = 2000 + (Math.random() * 500 - 250);
                this.charData.y = 2000 + (Math.random() * 500 - 250);
            }

            this.socket.emit('player_join', {
                id: this.dbRow.id, 
                name: this.charData.name, 
                charClass: this.charData.charClass,
                x: this.charData.x, 
                y: this.charData.y, 
                map: this.charData.map, 
                level: this.charData.level || 1,
                totalMr: this.charData.totalMr || 50,
                totalDmgReduction: this.charData.totalDmgReduction || 0,
                isAI: true
            });
            
            if (this.hasConnectedOnce && !this.loopTimer) {
                this.setupListeners();
                this.startLoop();
            }
        });
    }

    setupListeners() {
        this.socket.on('server_shutdown_notice', async () => {
            console.log(`[🤖 AI 종료] ${this.charData.name} 데이터 백업 중...`);
            try {
                await supabase.from('characters').update({ data: { player: this.charData }, last_sync_time: 0 }).eq('id', this.dbRow.id);
            } catch (e) {}
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        });

        this.socket.on('sync_entities', (packet) => {
            this.worldPlayers = (packet.players || []).map(p => ({
                ...p,
                hp: (p.hp !== undefined) ? p.hp : (p.h !== undefined ? p.h : 150),
                maxHp: p.maxHp || 150,
                angle: (p.angle !== undefined) ? p.angle : (p.a || 0),
                isMoving: p.isMoving !== undefined ? p.isMoving : (p.m === 1),
                targetId: (p.targetId !== undefined) ? p.targetId : p.t,
                map: this.charData.map,
                isPlayer: true
            }));

            if (packet.monsters) {
                this.worldMonsters = packet.monsters
                    .filter(m => (m.hp > 0 || m.h > 0) && !m.isDead)
                    .map(m => ({
                        ...m,
                        hp: (m.hp !== undefined) ? m.hp : (m.h !== undefined ? m.h : 100),
                        maxHp: m.maxHp || 100,
                        angle: (m.angle !== undefined) ? m.angle : (m.a || 0),
                        targetId: (m.targetId !== undefined) ? m.targetId : m.t,
                        map: this.charData.map
                    }));

                if (this.charData.target) {
                    let stillAlive = this.worldMonsters.some(m => m.id === this.charData.target.id);
                    if (!stillAlive) {
                        this.charData.target = null;
                        this.charData.targetId = null;
                        this.charData.isMoving = false;
                    }
                }
            }

            this.worldMercs = (packet.mercs || []).map(m => ({
                ...m,
                hp: (m.hp !== undefined) ? m.hp : (m.h !== undefined ? m.h : 100),
                maxHp: m.maxHp || 100,
                angle: (m.angle !== undefined) ? m.angle : (m.a || 0),
                isMoving: m.isMoving !== undefined ? m.isMoving : (m.m === 1),
                map: this.charData.map,
                isSummon: true,
                isOtherMerc: true
            }));
        });

        this.socket.on('sync_map_state', (packet) => {
            if (packet.monsters) {
                this.worldMonsters = packet.monsters.map(m => ({
                    ...m,
                    hp: (m.hp !== undefined) ? m.hp : (m.h !== undefined ? m.h : 100),
                    maxHp: m.maxHp || 100,
                    map: this.charData.map
                }));
            }
            if (packet.items) {
                this.worldItems = packet.items;
            }
        });

        this.socket.on('monster_hit', (data) => {
            let mob = this.worldMonsters.find(m => m.id === data.monsterId);
            if (mob && data.hpRemaining !== undefined) {
                mob.hp = data.hpRemaining;
            }
        });

        this.socket.on('monster_dead', (data) => {
            this.worldMonsters = this.worldMonsters.filter(m => m.id !== data.monsterId);
            if (this.charData.target && this.charData.target.id === data.monsterId) {
                this.charData.target = null;
                this.charData.targetId = null;
                this.charData.isMoving = false;
            }
        });

        this.socket.on('item_spawned', (packet) => this.worldItems.push(packet.item));
        this.socket.on('item_removed', (packet) => {
            this.worldItems = this.worldItems.filter(it => it.id !== packet.itemId);
        });

        this.socket.on('take_damage', (packet) => {
            this.charData.hp = Math.max(0, this.charData.hp - (packet.damage || 10));
            this.checkDrinkPotion();
        });

        // 💡 [동기화] 외부에서 들어온 힐 마법 및 버프 수신
        this.socket.on('sync_player_magic', (packet) => {
            let isMe = packet.targetId === this.socket.id;
            let myMerc = this.charData.mercs ? this.charData.mercs.find(m => m.id === packet.targetId) : null;

            if (isMe || myMerc) {
                let target = isMe ? this.charData : myMerc;

                if (packet.healAmt) {
                    target.hp = Math.min(target.maxHp || 100, target.hp + packet.healAmt);
                }

                if (packet.isBuff && packet.buffName) {
                    target.buffs = target.buffs || {};
                    let keyName = packet.buffName;
                    if (keyName.includes('가속') || keyName.includes('초록') || keyName.includes('윈드') || keyName.includes('홀리')) keyName = 'haste';
                    else if (keyName.includes('용기')) keyName = 'brave';
                    else if (keyName.includes('와퍼') || keyName.includes('엘븐')) keyName = 'wafer';

                    target.buffs[keyName] = Date.now() + (packet.buffDuration || 300000);
                }
            }
        });

        // 💡 [실시간 루팅] 아데나 수급 및 장비 즉시 비교/인챈트/판매
        this.socket.on('item_looted_success', (packet) => {
            if (packet.item.type === 'currency') {
                this.charData.adena += packet.item.count;
                this.checkMercenaryNeeds(); 
            } else {
                this.charData.inv.push(packet.item);
                this.manageEquipmentAndEnchant();
                this.sellJunkAndManageBags();
            }
        });

        this.socket.on('player_exp_gain', (packet) => {
            this.charData.exp += packet.exp;
            this.checkLevelUp();
        });

        this.socket.on('chat_broadcast', async (packet) => {
            if (packet.socketId === this.socket.id) return;
            let senderEnt = this.worldPlayers.find(p => p.socketId === packet.socketId);
            if (!senderEnt || senderEnt.map !== this.charData.map) return;
            if (packet.isAI) return;
            let baseName = this.charData.name.replace(/[0-9]/g, '');
            let isAddressedToMe = packet.message.includes(this.charData.name) || 
                                  (baseName && packet.message.includes(baseName));
             
            if (!isAddressedToMe && this.lastTalkedUser === packet.name && (Date.now() - this.lastTalkTime < 60000)) {
                isAddressedToMe = true; 
            }
             
            let isWhisperToMe = packet.isWhisper && packet.targetName === this.charData.name;

            if (packet.chatType === 'party' || isAddressedToMe || isWhisperToMe) {
                this.lastTalkedUser = packet.name;
                this.lastTalkTime = Date.now();
                await this.handleChatMessage(packet.name, packet.message, packet.chatType, packet.isWhisper);
            }
        });

        this.socket.on('party_invite_received', (packet) => {
            const inviterSocketId = packet.inviterSocketId;
            const inviterName = packet.inviterName;

            let currentMembersCount = this.partyData && this.partyData.members ? this.partyData.members.length : 1;
            if (currentMembersCount >= 5) {
                this.socket.emit('party_reject', { inviterSocketId, rejectorName: this.charData.name, type: 'soft' });
                this.socket.emit('chat_message', { message: `${inviterName}님 죄송해요, 파티 인원이 꽉 찼습니다!`, chatType: 'normal' });
                return;
            }

            if (this.rejectedTargets.has(inviterName)) {
                this.socket.emit('party_reject', { inviterSocketId, rejectorName: this.charData.name, type: 'hard' });
                return;
            }

            let refuseRoll = Math.random();
            if (this.autoInviteChance === 0 && refuseRoll < 0.6) {
                const refuseReplies = [
                    "죄송한데 오늘은 솔플 중이라 다음에 같이해요!",
                    "지금 곧 접어야 해서 파티는 힘들 것 같아요 ㅈㅅ",
                    "혼자 사냥하는 게 편해서요! 득템하세요~"
                ];
                let reply = refuseReplies[Math.floor(Math.random() * refuseReplies.length)];
                
                this.socket.emit('party_reject', { inviterSocketId, rejectorName: this.charData.name, type: 'soft' });
                this.socket.emit('chat_message', { message: reply, chatType: 'normal' });
                return;
            }

            this.socket.emit('party_accept', { inviterSocketId });
            
            const acceptReplies = ["네 파티 사냥 같이해요!", "수락했습니다! 어디로 갈까요?", "ㄱㄱ 열렙합시다!"];
            let acceptMsg = acceptReplies[Math.floor(Math.random() * acceptReplies.length)];
            
            setTimeout(() => {
                this.socket.emit('chat_message', { message: acceptMsg, chatType: 'party' });
            }, 300);
        });

        this.socket.on('party_leader_request_received', (packet) => {
            if (this.partyData && this.partyData.leader === this.socket.id) {
                this.socket.emit('party_change_leader', { newLeaderSocketId: packet.requesterSocketId });
                setTimeout(() => {
                    this.socket.emit('chat_message', { message: "네! 파티장 넘겨드릴게요. 오더 부탁드려요~", chatType: 'party' });
                }, 300);
            }
        });

        this.socket.on('party_reject', (packet) => {
            if (packet && packet.rejectorName) {
                if (packet.type === 'hard') {
                    this.rejectedTargets.add(packet.rejectorName);
                } else {
                    this.invitedHistory.set(packet.rejectorName, Date.now());
                }
            }
        });

        this.socket.on('party_update', (packet) => {
            const prevParty = this.partyData;
            this.partyData = packet.party;

            if (prevParty && !packet.party) {
                this.followTarget = null;
                this.charData.target = null;
                this.warpAllowed = false;
                this.socket.emit('chat_message', { message: "파티 사냥 수고하셨습니다! 득템하세요~", chatType: 'normal' });
            }
        });

        this.socket.on('party_target_shared', (packet) => {
            if (!packet) return;
             
            if (!packet.targetId) {
                this.charData.target = null;
                this.charData.isMoving = false;
                return;
            }

            const sharedMob = this.worldMonsters.find(m => m.id === packet.targetId && m.hp > 0 && !m.isDead);
            if (sharedMob) {
                this.charData.target = sharedMob;
                this.charData.targetId = sharedMob.id;
                this.charData.isMoving = false;
                this.combatMemory = `파티장 명령으로 ${sharedMob.name}을(를) 점사 중입니다!`;
                
                if (sharedMob.isBoss || (sharedMob.name && (sharedMob.name.includes('바포매트') || sharedMob.name.includes('발라카스') || sharedMob.name.includes('안타라스')))) {
                    this.socket.emit('boss_spotted', { bossId: sharedMob.id, bossName: sharedMob.name });
                }
            }
        });

        this.socket.on('party_leader_map_move', (data) => {
            if (data.autoWarp || this.warpAllowed || data.map === 'boss_raid') {
                this.warpAllowed = false;
                this.teleport(data.map, data.x || 2000, data.y || 2000);
            }
        });
    }

    // 💡 [무료 스킬 자동 습득] 레벨업 시 아데나 차감 없이 즉시 학습
    checkLevelUp() {
        let lv = this.charData.level || 1;
        let baseExp = 100;
        let scale = Math.pow(1.15, Math.max(0, lv - 1));
        let maxExp = Math.floor(baseExp * lv * scale);

        let leveledUp = false;
        while (this.charData.exp >= maxExp) {
            this.charData.exp -= maxExp;
            this.charData.level++;
             
            if (this.charData.charClass === 'wizard') { this.charData.maxHp += 15; this.charData.maxMp += 45; }
            else if (this.charData.charClass === 'elf') { this.charData.maxHp += 28; this.charData.maxMp += 19; }
            else { this.charData.maxHp += 45; this.charData.maxMp += 5; }

            this.charData.hp = this.charData.maxHp;
            this.charData.mp = this.charData.maxMp;
             
            this.learnMagicForLevel(); 
            leveledUp = true;

            lv = this.charData.level;
            scale = Math.pow(1.15, Math.max(0, lv - 1));
            maxExp = Math.floor(baseExp * lv * scale);
        }
    }

    learnMagicForLevel() {
        let lv = this.charData.level;
        let cls = this.charData.charClass;
        let m = this.charData.magic;
        let learn = (spell) => { if (!m.includes(spell)) m.push(spell); };

        if (cls === 'wizard') {
            learn('에너지 볼트'); learn('힐'); learn('실드');
            if (lv >= 15) { learn('파이어볼'); learn('뱀파이어릭 터치'); }
            if (lv >= 30) { learn('이럽션'); learn('선버스트'); }
            if (lv >= 45) { learn('콜 라이트닝'); learn('어드밴스 스피릿'); }
            if (lv >= 60) { learn('블리자드'); learn('라이트닝 스톰'); }
            if (lv >= 80) { learn('디스인티그레이트'); learn('저지먼트'); }
        } else if (cls === 'elf') {
            learn('에너지 볼트'); learn('힐'); learn('실드');
            learn('트리플 애로우'); learn('스톰 샷'); learn('윈드 워크');
            if (lv >= 20) { learn('네이쳐스 터치'); }
            if (lv >= 45) { learn('어스 스킨'); learn('파이어 웨폰'); }
            if (lv >= 60) { learn('어스 바인드'); learn('워터 라이프'); }
        } else {
            learn('에너지 볼트');
            if (lv >= 30) learn('쇼크 스턴');
            if (lv >= 45) learn('리덕션 아머');
            if (lv >= 60) learn('카운터 바리어'); learn('바운스 어택');
        }
    }

    checkProactivePartyInvite() {
        let now = Date.now();
        if (now - this.lastProactiveInviteCheck < 15000) return;
        this.lastProactiveInviteCheck = now;

        if (now - this.lastPartyInviteTime < 180000) return; 

        if (this.autoInviteChance <= 0) return;
        
        let currentMembersCount = this.partyData && this.partyData.members ? this.partyData.members.length : 1;
        if (currentMembersCount >= 3) return;
        
        if (this.partyData && this.partyData.leader !== this.socket.id) return;

        let candidates = this.worldPlayers.filter(p => {
            if (!p || p.socketId === this.socket.id) return false;
            if (p.map !== this.charData.map) return false;
            if (p.partyId) return false; 
            if (this.rejectedTargets.has(p.name)) return false;

            let lastInvited = this.invitedHistory.get(p.name) || 0;
            if (now - lastInvited < 300000) return false;

            let lvDiff = Math.abs((p.level || 1) - (this.charData.level || 1));
            if (lvDiff > 5) return false;

            let dist = fastHypot(p.x - this.charData.x, p.y - this.charData.y);
            return dist <= 800; 
        });

        if (candidates.length === 0) return;

        if (Math.random() <= (this.autoInviteChance * 0.1)) {
            let target = candidates[Math.floor(Math.random() * candidates.length)];
            this.invitedHistory.set(target.name, now);
            this.lastPartyInviteTime = now; 

            let targetSockId = target.socketId || target.id;
            if (targetSockId) {
                this.socket.emit('party_invite', {
                    targetSocketId: targetSockId,
                    targetName: target.name
                });
            }
        }
    }

    calcItemScore(item, slot) {
        if (!item) return 0;
        let score = 0;
        let enchant = item.enchantValue || 0;
        if (slot === 'weapon') {
            score = (item.atk || 0) + (enchant * 2) + ((item.grade || 0) * 5) + (item.sp ? item.sp * 3 : 0);
        } else {
            score = (item.def || 0) + (enchant * 1.5) + ((item.grade || 0) * 4);
        }
        return score;
    }

    canEquipItem(item) {
        let cls = this.charData.charClass;
        let name = item.name || '';
        if (cls === 'wizard' && (name.includes('양손검') || name.includes('활') || name.includes('판금'))) return false;
        if (cls === 'knight' && (name.includes('지팡이') || name.includes('로브') || name.includes('활'))) return false;
        if (cls === 'elf' && (name.includes('지팡이') || name.includes('대검'))) return false;
        return true;
    }

    manageEquipmentAndEnchant() {
        if (!this.charData.inv || this.charData.inv.length === 0) return;
        let inv = this.charData.inv;

        // 1. 에이전트 본인 장비 자동 교체 (무기/갑옷/투구)
        const equipSlots = ['weapon', 'armor', 'helmet'];
        equipSlots.forEach(slot => {
            let currentEquip = this.charData.equip[slot];
            let currentScore = this.calcItemScore(currentEquip, slot);

            let bestIndex = -1;
            let bestScore = currentScore;

            inv.forEach((item, idx) => {
                if (item.type === slot || (slot === 'weapon' && item.type === 'weapon')) {
                    if (this.canEquipItem(item)) {
                        let score = this.calcItemScore(item, slot);
                        if (score > bestScore) {
                            bestScore = score;
                            bestIndex = idx;
                        }
                    }
                }
            });

            if (bestIndex > -1) {
                let newEquip = inv.splice(bestIndex, 1)[0];
                if (currentEquip) inv.push(currentEquip);
                this.charData.equip[slot] = newEquip;
                this.recalculateAgentStats();
            }
        });

        // 2. 용병 장비 자동 교체 (무기/갑옷)
        if (this.charData.mercs && this.charData.mercs.length > 0) {
            this.charData.mercs.forEach(merc => {
                if (merc.hp <= 0) return;
                merc.equip = merc.equip || { weapon: null, armor: null };

                ['weapon', 'armor'].forEach(slot => {
                    let mercScore = this.calcItemScore(merc.equip[slot], slot);
                    let bestIdx = -1;
                    let bestScore = mercScore;

                    inv.forEach((item, idx) => {
                        if (item.type === slot) {
                            let score = this.calcItemScore(item, slot);
                            if (score > bestScore) {
                                bestScore = score;
                                bestIdx = idx;
                            }
                        }
                    });

                    if (bestIdx > -1) {
                        let newMercEquip = inv.splice(bestIdx, 1)[0];
                        if (merc.equip[slot]) inv.push(merc.equip[slot]);
                        merc.equip[slot] = newMercEquip;
                        merc.atk = (merc.level || 1) * 3 + (merc.equip.weapon?.atk || 10);
                        merc.def = 10 + (merc.equip.armor?.def || 5);
                    }
                });
            });
        }

        // 3. 자율 인챈트 수행
        this.processAutoEnchant();
    }

    // 💡 [자율 인챈트] 본인 및 용병 장비를 안전 인챈트 수치까지 자동 강화
    processAutoEnchant() {
        let inv = this.charData.inv;

        // 무기 마법 주문서 (데이) 사용 -> 안전구간 +6까지 인챈트
        let wScrollIdx = inv.findIndex(i => i.name.includes('무기 마법 주문서') || i.name.includes('데이'));
        if (wScrollIdx > -1) {
            let myWp = this.charData.equip.weapon;
            if (myWp && (myWp.enchantValue || 0) < 6) {
                myWp.enchantValue = (myWp.enchantValue || 0) + 1;
                myWp.atk = (myWp.atk || 10) + 2;
                if (!myWp.name.startsWith('+')) myWp.name = `+${myWp.enchantValue} ${myWp.name}`;
                else myWp.name = myWp.name.replace(/\+\d+/, `+${myWp.enchantValue}`);
                
                inv[wScrollIdx].count = (inv[wScrollIdx].count || 1) - 1;
                if (inv[wScrollIdx].count <= 0) inv.splice(wScrollIdx, 1);
                this.recalculateAgentStats();
                return;
            }
            if (this.charData.mercs) {
                for (let m of this.charData.mercs) {
                    let mWp = m.equip && m.equip.weapon;
                    if (mWp && (mWp.enchantValue || 0) < 6) {
                        mWp.enchantValue = (mWp.enchantValue || 0) + 1;
                        mWp.atk = (mWp.atk || 10) + 2;
                        if (!mWp.name.startsWith('+')) mWp.name = `+${mWp.enchantValue} ${mWp.name}`;
                        else mWp.name = mWp.name.replace(/\+\d+/, `+${mWp.enchantValue}`);
                        
                        inv[wScrollIdx].count = (inv[wScrollIdx].count || 1) - 1;
                        if (inv[wScrollIdx].count <= 0) inv.splice(wScrollIdx, 1);
                        m.atk = (m.level || 1) * 3 + mWp.atk;
                        return;
                    }
                }
            }
        }

        // 갑옷 마법 주문서 (젤) 사용 -> 안전구간 +4까지 인챈트
        let aScrollIdx = inv.findIndex(i => i.name.includes('갑옷 마법 주문서') || i.name.includes('젤'));
        if (aScrollIdx > -1) {
            let armors = [this.charData.equip.armor, this.charData.equip.helmet];
            if (this.charData.mercs) {
                this.charData.mercs.forEach(m => { if (m.equip && m.equip.armor) armors.push(m.equip.armor); });
            }

            let target = armors.find(a => a && (a.enchantValue || 0) < 4);
            if (target) {
                target.enchantValue = (target.enchantValue || 0) + 1;
                target.def = (target.def || 5) + 1;
                if (!target.name.startsWith('+')) target.name = `+${target.enchantValue} ${target.name}`;
                else target.name = target.name.replace(/\+\d+/, `+${target.enchantValue}`);

                inv[aScrollIdx].count = (inv[aScrollIdx].count || 1) - 1;
                if (inv[aScrollIdx].count <= 0) inv.splice(aScrollIdx, 1);
                this.recalculateAgentStats();
            }
        }
    }

    sellJunkAndManageBags() {
        let inv = this.charData.inv;
        let equippedIds = new Set();
        Object.values(this.charData.equip).forEach(e => { if (e && e.id) equippedIds.add(e.id); });

        let keptInv = [];
        inv.forEach(item => {
            if (!item) return;
            if (['potion', 'scroll', 'book', 'currency'].includes(item.type)) {
                keptInv.push(item);
                return;
            }

            let isJunk = (item.grade === 0 || !item.grade) && (item.enchantValue || 0) === 0;
            if (isJunk && !equippedIds.has(item.id)) {
                let sellPrice = Math.floor(Math.random() * 300) + 150;
                this.charData.adena += sellPrice;
            } else {
                keptInv.push(item);
            }
        });

        this.charData.inv = keptInv;
    }

    recalculateAgentStats() {
        let baseAtk = 25 + (this.charData.level || 1) * 2;
        let baseDef = 5 + (this.charData.level || 1);

        if (this.charData.equip.weapon) baseAtk += (this.charData.equip.weapon.atk || 0);
        if (this.charData.equip.armor) baseDef += (this.charData.equip.armor.def || 0);
        if (this.charData.equip.helmet) baseDef += (this.charData.equip.helmet.def || 0);

        this.charData.atk = baseAtk;
        this.charData.def = baseDef;
    }

    // 💡 [상호작용 코어] 용병의 물약 부족 신호 감지 및 잔고에 따른 판단
    checkMercenaryNeeds() {
        if (!this.charData.mercs || this.charData.mercs.length === 0) return;
        if (this.charData.map === 'boss_raid') return; // 💡 보스 레이드 중에는 보급 전면 보류!

        let needToShop = false;

        this.charData.mercs.forEach(m => {
            if (m.requirePotion || m.requireBuffPotion) {
                let pName = m.requirePotionName || m.requireBuffName || '주홍 물약';
                
                let myPot = this.charData.inv.find(i => i.name === pName);
                if (myPot && myPot.count > 50) {
                    myPot.count -= 50;
                    m.inv = m.inv || [];
                    let mPot = m.inv.find(i => i.name === pName);
                    if (mPot) mPot.count += 50; 
                    else m.inv.push({ name: pName, type: 'potion', count: 50 });
                    
                    m.requirePotion = false; 
                    m.requireBuffPotion = false; 
                    m.waitingForAdena = false;
                    this.combatMemory = `용병 ${m.name}에게 ${pName}을 나눠주었습니다.`;
                } else {
                    let potCost = (pName.includes('맑은')) ? 20000 : 7200; 
                    if (this.charData.adena >= potCost) {
                        needToShop = true; 
                    } else {
                        m.waitingForAdena = true;
                        this.combatMemory = `용병 ${m.name}이 물약을 요청했으나 자금이 부족해 사냥 후 사주기로 했습니다.`;
                    }
                }
            }
        });

        if (needToShop && this.state !== 'SHOPPING' && !this.partyData) {
            this.routineShopping();
        }
    }

    startLoop() {
        this.isLoggingOut = false; 
        
        this.loopTimer = setInterval(() => {
            if (this.isLoggingOut) return; 

            if (this.charData.isMoving) {
                if (!this.stuckCheckTime) this.stuckCheckTime = Date.now();
                if (!this.lastX) { this.lastX = this.charData.x; this.lastY = this.charData.y; }
                if (Date.now() - this.stuckCheckTime > 2000) {
                    let movedDist = fastHypot(this.charData.x - this.lastX, this.charData.y - this.lastY);
                    if (movedDist < 10) {
                        this.charData.x += (Math.random() * 400 - 200); 
                        this.charData.y += (Math.random() * 400 - 200);
                        this.charData.target = null;
                        this.charData.targetId = null;
                    }
                    this.lastX = this.charData.x;
                    this.lastY = this.charData.y;
                    this.stuckCheckTime = Date.now();
                }
            } else {
                this.stuckCheckTime = Date.now();
            }

            if (Date.now() - this.sessionStart >= this.sessionDuration) {
                this.isLoggingOut = true; 
                console.log(`[🤖 에이전트 퇴장] ${this.charData.name}님이 활동 시간을 채워 교체됩니다.`);
                this.gracefulLogout(); 
                return;
            }

            let now = Date.now();
            if (now - this.lastRegenTime >= 2000) {
                this.lastRegenTime = now;
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 5 + Math.floor(this.charData.level / 5));
                this.charData.mp = Math.min(this.charData.maxMp, this.charData.mp + 3 + Math.floor(this.charData.level / 10));
            }

            if (now - this.lastItemManageTime > 10000) {
                this.lastItemManageTime = now;
                this.manageEquipmentAndEnchant();
                this.sellJunkAndManageBags();
            }

            if (now - this.lastMercNeedsCheckTime > 2000) {
                this.lastMercNeedsCheckTime = now;
                this.checkMercenaryNeeds();
            }

            this.processAutoBuffs(); 
            this.checkProactivePartyInvite();
            this.checkSmartMapNavigation();

            if (this.followTarget && this.state !== 'SHOPPING') {
                this.executeFollowMovement();
            }

            this.executeSharedAILoop();

            if (!this.charData.target && !this.followTarget && this.state === 'HUNTING') {
                let aliveMobs = this.worldMonsters.filter(m => (m.hp > 0 || m.h > 0) && !m.isDead && !data.isInSafeZone(this.charData.map, m.x, m.y));
                if (aliveMobs.length > 0) {
                    aliveMobs.sort((a, b) => fastHypot(a.x - this.charData.x, a.y - this.charData.y) - fastHypot(b.x - this.charData.x, b.y - this.charData.y));
                    let nextMob = aliveMobs[0];
                    this.charData.target = nextMob;
                    this.charData.targetId = nextMob.id;
                    this.charData.moveX = nextMob.x;
                    this.charData.moveY = nextMob.y;
                    this.charData.isMoving = true;
                } else if (!this.charData.isMoving) {
                    let wanderAngle = Math.random() * Math.PI * 2;
                    let wanderDist = 300 + Math.random() * 200;
                    this.charData.moveX = Math.max(200, Math.min(3800, this.charData.x + Math.cos(wanderAngle) * wanderDist));
                    this.charData.moveY = Math.max(200, Math.min(3800, this.charData.y + Math.sin(wanderAngle) * wanderDist));
                    this.charData.isMoving = true;
                }
            }

            this.tryRush(this.charData, this.charData.target, now);
            this.updateMovement(100);    
             
            this.checkMercenaryHire(); 
            this.manageMercenaries(100); 
        
            let hasChanged = this.charData.isMoving || 
                             this.charData.hp !== this.lastSentHp || 
                             this.charData.targetId !== this.lastSentTargetId ||
                             (now - this.lastForcedUpdate > 2000);

            if (hasChanged) {
                this.lastSentHp = this.charData.hp;
                this.lastSentTargetId = this.charData.targetId;
                this.lastForcedUpdate = now;

                this.socket.emit('player_update', {
                    userId: this.dbRow.id,
                    name: this.charData.name, 
                    charClass: this.charData.charClass,
                    x: Math.round(this.charData.x), 
                    y: Math.round(this.charData.y),
                    angle: Number((this.charData.angle || 0).toFixed(2)),
                    hp: this.charData.hp, 
                    maxHp: this.charData.maxHp,
                    mp: this.charData.mp,
                    maxMp: this.charData.maxMp,
                    atk: this.charData.atk, 
                    def: this.charData.def,
                    level: this.charData.level, 
                    map: this.charData.map || 'talking_island',
                    targetId: this.charData.targetId || null,
                    isMoving: Boolean(this.charData.isMoving),
                    equip: this.charData.equip || {},
                    mercs: this.charData.mercs || [],
                    totalMr: this.charData.totalMr || 50,
                    totalDmgReduction: this.charData.totalDmgReduction || 0
                });
            }

            if (this.charData.targetId && this.charData.targetId !== this.lastSentTargetEventId) {
                this.lastSentTargetEventId = this.charData.targetId;
                this.socket.emit('player_target', { targetId: this.charData.targetId });
            } else if (!this.charData.targetId && this.lastSentTargetEventId) {
                this.lastSentTargetEventId = null;
                this.socket.emit('player_target', { targetId: null });
            }
        }, 80); 
    }

    executeFollowMovement() {
        let leader = this.worldPlayers.find(p => p.name === this.followTarget);
        if (leader) {
            let dist = fastHypot(leader.x - this.charData.x, leader.y - this.charData.y);
            if (dist > this.followDist + 30) {
                let angle = Math.atan2(leader.y - this.charData.y, leader.x - this.charData.x);
                this.charData.moveX = leader.x - Math.cos(angle) * this.followDist;
                this.charData.moveY = leader.y - Math.sin(angle) * this.followDist;
                this.charData.isMoving = true;
            }
        }
    }

    tryRush(entity, target, now) {
        let eClass = entity.charClass || entity.mercType;
        if (eClass !== 'knight' || !target) return false;
         
        let dist = fastHypot(target.x - entity.x, target.y - entity.y);
        if (dist > 55 && dist <= 350 && (now - (entity.lastRushTime || 0) > 2000)) {
            entity.lastRushTime = now;
            let rushAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
             
            entity.x = target.x - Math.cos(rushAngle) * 30;
            entity.y = target.y - Math.sin(rushAngle) * 30;
            entity.angle = rushAngle;
            entity.isMoving = false;

            let casterId = entity.isSummon ? entity.id : this.socket.id;
            this.socket.emit('player_magic_action', { 
                magicName: '돌진', targetX: target.x, targetY: target.y, 
                targetId: target.id, casterX: entity.x, casterY: entity.y, casterId: casterId 
            });
            return true;
        }
        return false;
    }

    processAutoBuffs() {
        if (this.state === 'SHOPPING' || this.charData.hp <= 0) return;
        let now = Date.now();
        this.charData.buffs = this.charData.buffs || {};

        let usePotion = (potName, buffName) => {
            if (!this.charData.buffs[buffName] || this.charData.buffs[buffName] < now) {
                let pot = this.charData.inv.find(i => i.name === potName);
                if (pot && pot.count > 0) {
                    pot.count--;
                    this.charData.buffs[buffName] = now + 300000;
                    this.socket.emit('entity_use_potion', { entityId: this.socket.id, potionName: potName });
                }
            }
        };

        let useSpell = (spellName, mpCost, buffName) => {
            if (this.charData.magic.includes(spellName) && this.charData.mp > mpCost && (!this.charData.buffs[buffName] || this.charData.buffs[buffName] < now)) {
                this.charData.mp -= mpCost;
                if (spellName === '어드밴스 스피릿' && (!this.charData.buffs[buffName] || this.charData.buffs[buffName] < now)) {
                    this.charData.maxHp += 50; this.charData.maxMp += 50; 
                }
                this.charData.buffs[buffName] = now + 300000;
                this.socket.emit('player_magic_action', { 
                    magicName: spellName, targetX: this.charData.x, targetY: this.charData.y, 
                    targetId: this.charData.id, casterX: this.charData.x, casterY: this.charData.y, casterId: this.socket.id 
                });
            }
        };

        usePotion('초록 물약', 'haste');

        if (this.charData.charClass === 'knight') {
            usePotion('용기의 물약', 'brave');
            useSpell('카운터 바리어', 40, '카운터 바리어');
        } 
        else if (this.charData.charClass === 'elf') {
            usePotion('엘븐 와퍼', 'wafer');
            useSpell('스톰 샷', 20, '스톰 샷');
        } 
        else if (this.charData.charClass === 'wizard') {
            useSpell('실드', 10, '실드');
            useSpell('어드밴스 스피릿', 20, '어드밴스 스피릿');
        }
    }

    updateMovement(dtMs) {
        if (this.charData.isMoving && this.charData.moveX !== undefined && this.charData.moveY !== undefined) {
            let dist = fastHypot(this.charData.moveX - this.charData.x, this.charData.moveY - this.charData.y);
            let speed = 130 * (dtMs / 1000); 
            if (this.charData.buffs && this.charData.buffs.haste && this.charData.buffs.haste > Date.now()) speed += 50;

            if (dist <= speed) {
                this.charData.x = this.charData.moveX;
                this.charData.y = this.charData.moveY;
                this.charData.isMoving = false;
            } else {
                let angle = Math.atan2(this.charData.moveY - this.charData.y, this.charData.moveX - this.charData.x);
                this.charData.angle = angle;
                this.charData.x += Math.cos(angle) * speed;
                this.charData.y += Math.sin(angle) * speed;
            }
        }
    }

    executeSharedAILoop() {
        if (this.state === 'SHOPPING') return;

        let atkDelay = this.charData.charClass === 'knight' ? 700 : 900;
        if (this.charData.buffs) {
            let now = Date.now();
            if (this.charData.buffs.haste > now) atkDelay -= 150;
            if (this.charData.buffs.brave > now || this.charData.buffs.wafer > now) atkDelay -= 100;
        }

        let leaderEnt = this.partyData ? this.worldPlayers.find(p => p.id === this.partyData.leader || p.socketId === this.partyData.leader) : null;

        let env = {
            now: Date.now(),
            currentMap: this.charData.map,
            mapSize: 4000,
            entities: [...this.worldPlayers, ...this.worldMonsters, ...this.worldMercs],
            items: this.worldItems,
            minLootGrade: 0,
            atkDelay: atkDelay,
            party: this.partyData ? {
                isFocusMode: this.partyData.mode === 'focus',
                leaderId: this.partyData.leader,
                leaderTargetId: leaderEnt ? leaderEnt.targetId : null,
                leaderEnt: leaderEnt
            } : null,
            isInSafeZone: (m, x, y) => data.isInSafeZone(m, x, y),
            playSound: () => {}, 
            spawnParticle: () => {}, 
            useEntityPotion: (entId, pName) => {
                this.socket.emit('entity_use_potion', { entityId: entId, potionName: pName });
            },
            spawnArrow: (from, to, dmg, color) => {
                let aimAngle = Math.atan2(to.y - from.y, to.x - from.x);
                let casterId = from.isSummon ? from.id : this.socket.id; 
                if (from.isSummon) from.angle = aimAngle; else this.charData.angle = aimAngle;
                
                this.socket.emit('player_attack_action', { 
                    casterId: casterId, angle: aimAngle, targetId: to.id, targetX: to.x, targetY: to.y, 
                    isBow: true, actionType: 'shoot', color: color || '#ffffff' 
                });
                
                let dist = fastHypot(to.x - from.x, to.y - from.y);
                let flightTime = (dist / 1440) * 1000;
                
                setTimeout(() => {
                    this.socket.emit('player_attack_request', { 
                        targetId: to.id, attackerId: casterId, attackType: 'physical', calculatedDmg: dmg 
                    });
                }, flightTime);
            },
            damageEntity: (target, dmg, attacker, hitType, magicName) => {
                let aimAngle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
                let casterId = attacker.isSummon ? attacker.id : this.socket.id; 
                if (attacker.isSummon) attacker.angle = aimAngle; else this.charData.angle = aimAngle;
                
                if (target.isBoss || (target.name && (target.name.includes('바포매트') || target.name.includes('발라카스') || target.name.includes('안타라스')))) {
                    this.socket.emit('boss_spotted', { bossId: target.id, bossName: target.name });
                }

                if (hitType === 'physical') {
                    this.socket.emit('player_attack_action', { casterId: casterId, angle: aimAngle, targetId: target.id, targetX: target.x, targetY: target.y, actionType: 'slash' });
                }
                this.socket.emit('player_attack_request', { targetId: target.id, attackerId: casterId, attackType: hitType, calculatedDmg: dmg, magicName: magicName });
            },
            castAttackSpell: (target, spellName, caster) => {
                let realCaster = caster || this.charData; 
                let mData = data.magicDb[spellName];
                if (mData && realCaster.mp >= mData.mp) {
                    realCaster.spellCooldowns = realCaster.spellCooldowns || {};
                    let spellCd = mData.cd || 0;
                    if (spellCd > 0 && Date.now() - (realCaster.spellCooldowns[spellName] || 0) < spellCd) {
                        return; 
                    }

                    realCaster.mp -= mData.mp;
                    realCaster.spellCooldowns[spellName] = Date.now();
                     
                    if (!target || typeof target.x === 'undefined') return;

                    let aimAngle = Math.atan2(target.y - realCaster.y, target.x - realCaster.x);
                    let casterId = realCaster.isSummon ? realCaster.id : this.socket.id;
                    if (realCaster.isSummon) realCaster.angle = aimAngle; else this.charData.angle = aimAngle;

                    if (target.isBoss || (target.name && target.name.includes('바포매트'))) {
                        this.socket.emit('boss_spotted', { bossId: target.id, bossName: target.name });
                    }

                    this.socket.emit('player_magic_action', { 
                        magicName: spellName, targetX: target.x, targetY: target.y, targetId: target.id, 
                        casterX: realCaster.x, casterY: realCaster.y, casterId: casterId 
                    });
                    this.socket.emit('player_attack_request', { 
                        targetId: target.id, attackerId: casterId, attackType: 'magic', 
                        calculatedDmg: mData.dmg || 150, magicName: spellName 
                    });
                }
            },
            getSmartAutoCombatSpell: (target) => {
                let cls = this.charData.charClass;
                let magics = this.charData.magic || [];
                if (magics.length === 0) return null;

                if (cls === 'elf') {
                    if (magics.includes('트리플 애로우') && this.charData.mp >= 15) return '트리플 애로우';
                    return null;
                }
                if (cls === 'knight') {
                    if (target.isBoss && magics.includes('쇼크 스턴') && this.charData.mp >= 15) return '쇼크 스턴';
                    return null;
                }

                if (target.isBoss) {
                    let bossPriority = ['디스인티그레이트', '저지먼트', '블리자드', '선버스트', '이럽션', '파이어볼', '에너지 볼트'];
                    let bestBossSpell = bossPriority.find(sName => magics.includes(sName) && this.charData.mp >= (data.magicDb[sName]?.mp || 0));
                    if (bestBossSpell) return bestBossSpell;
                }

                let available = magics.map(m => ({name: m, data: data.magicDb[m]}))
                    .filter(m => m.data && (m.data.type === 'attack' || m.data.dmg) && this.charData.mp >= m.data.mp);
                if (available.length === 0) return null;
                 
                let nearby = this.worldMonsters.filter(m => (m.hp > 0 || m.h > 0) && !m.isDead && fastHypot(m.x - target.x, m.y - target.y) <= 180);
                if (nearby.length >= 3) {
                    let aoe = available.filter(m => m.data.aoe);
                    if (aoe.length > 0) return aoe.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
                }
                let single = available.filter(m => !m.data.aoe);
                if (single.length > 0) return single.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
                return available.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
            },
            lootItem: (it) => this.socket.emit('player_loot_item', { itemId: it.id }),
            shareTarget: (id) => {
                this.charData.targetId = id;
                this.socket.emit('player_target', { targetId: id });
            }
        };

        SharedAI.processRoutine(this.charData, env);
    }

    determineBestMap() {
        let lv = this.charData.level || 1;
        let availableMaps = [];
         
        for (let mapId in data.maps) {
            let mInfo = data.maps[mapId];
            if (!mInfo || !mInfo.recLv || mInfo.recLv.includes('안전') || mInfo.recLv.includes('자동')) continue;
             
            let matches = mInfo.recLv.match(/\d+/g);
            if (!matches) continue;
             
            let minLv = parseInt(matches[0]);
            let maxLv = matches[1] ? parseInt(matches[1]) : (mInfo.recLv.includes('+') ? 120 : minLv);
             
            if (lv >= minLv && lv <= maxLv) {
                availableMaps.push(mapId);
            }
        }

        if (availableMaps.length === 0) {
            if (lv <= 15) return 'talking_island';
            if (lv <= 45) return 'gludio_dungeon';
            if (lv <= 75) return 'giran_dungeon_1';
            return 'tower_of_insolence_1';
        }

        let nameHash = 0;
        for (let i = 0; i < this.charData.name.length; i++) {
            nameHash += this.charData.name.charCodeAt(i);
        }
         
        let rotationIndex = Math.floor(Date.now() / 180000 + nameHash) % availableMaps.length;
        return availableMaps[rotationIndex];
    }

    checkSmartMapNavigation() {
        if (this.partyData) return; 
        if (this.charData.map === 'boss_raid') return;

        if (Date.now() - this.lastMapCheckTime > 180000) { 
            this.lastMapCheckTime = Date.now();
            if (!this.charData.target && this.state === 'HUNTING') {
                let bestMap = this.determineBestMap();
                if (this.charData.map !== bestMap) this.teleport(bestMap, 2000, 2000);
            }
        }
    }

    checkDrinkPotion() {
        let potCount = this.charData.inv.find(i => i.name === '주홍 물약' || i.name === '맑은 물약')?.count || 0;
        if (this.charData.hp < this.charData.maxHp * 0.6) {
            if (potCount > 0) {
                let pot = this.charData.inv.find(i => i.name === '맑은 물약' || i.name === '주홍 물약');
                let potBonus = 0;
                if (this.charData.equip.earring && this.charData.equip.earring.potionEffect) {
                    potBonus = this.charData.equip.earring.potionEffect;
                }
                let healAmt = Math.floor((pot.heal || 60) * (1 + potBonus / 100));
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + healAmt);
                pot.count--;
                // 💡 [그래픽 동기화] 통합 물약 사용 신호
                this.socket.emit('entity_use_potion', { entityId: this.socket.id, potionName: pot.name });
            } else {
                if(this.state !== 'SHOPPING' && !this.partyData && this.charData.map !== 'boss_raid') {
                    this.routineShopping();
                }
            }
        }
         
        let mpPotCount = this.charData.inv.find(i => i.name === '파란 물약')?.count || 0;
        if (this.charData.mp < this.charData.maxMp * 0.3) {
            if (mpPotCount > 0) {
                this.charData.mp = Math.min(this.charData.maxMp, this.charData.mp + 50);
                this.charData.inv.find(i => i.name === '파란 물약').count--;
                this.socket.emit('entity_use_potion', { entityId: this.socket.id, potionName: '파란 물약' });
            }
        }
    }

    routineShopping() {
        if (this.isShopping || !this.socket) return;
        this.isShopping = true;
        this.state = 'SHOPPING';
        this.teleport('silver_knight_town', 2000, 2000);
         
        setTimeout(() => {
            this.charData.hp = this.charData.maxHp;
            this.charData.mp = this.charData.maxMp;

            let lv = this.charData.level || 1;
            let adena = this.charData.adena || 0;
            let cls = this.charData.charClass;

            let mainPotName = (lv >= 45 && adena >= 1000000) ? '맑은 물약' : '주홍 물약';
            let mainPotHeal = mainPotName === '맑은 물약' ? 120 : 60;
            let potCount = adena >= 500000 ? 500 : (adena >= 100000 ? 250 : 100);
            let mpPotCount = (cls === 'wizard' || cls === 'elf') ? (adena >= 300000 ? 300 : 100) : 0;

            let ensureItem = (name, count, healAmt = 0) => {
                let item = this.charData.inv.find(i => i.name === name);
                if (item) item.count = count;
                else this.charData.inv.push({ name: name, type: 'potion', count: count, heal: healAmt });
            };

            this.charData.inv = this.charData.inv.filter(i => !['주홍 물약', '맑은 물약', '빨간 물약'].includes(i.name));
            ensureItem(mainPotName, potCount, mainPotHeal);
            ensureItem('초록 물약', 100);
            ensureItem('파란 물약', mpPotCount);

            if (cls === 'knight') ensureItem('용기의 물약', 100);
            else if (cls === 'elf') ensureItem('엘븐 와퍼', 100);

            // 💡 [용병 물약 가방 보급 및 요청 초기화]
            if (this.charData.mercs && this.charData.mercs.length > 0) {
                this.charData.mercs.forEach(m => {
                    if (m.hp > 0) {
                        m.inv = m.inv || [];
                        let ensureMercPot = (pName, pCount, hAmt = 0) => {
                            let item = m.inv.find(i => i.name === pName);
                            if (item) item.count = pCount;
                            else m.inv.push({ name: pName, type: 'potion', count: pCount, heal: hAmt });
                        };
                        ensureMercPot(mainPotName, 150, mainPotHeal);
                        ensureMercPot('초록 물약', 30);
                        if (m.mercType === 'knight') ensureMercPot('용기의 물약', 20);
                        if (m.mercType === 'elf') ensureMercPot('엘븐 와퍼', 20);
                        if (m.mercType === 'wizard') ensureMercPot('파란 물약', 80);

                        m.requirePotion = false;
                        m.requireBuffPotion = false;
                        m.waitingForAdena = false;
                    }
                });
                this.combatMemory = `최근 마을에 들러 ${mainPotName}을 사고, 용병들에게도 물약을 든든히 보급했습니다.`;
            } else {
                this.combatMemory = `최근 마을에 들러 ${mainPotName} 등 소모품을 정비했습니다.`;
            }

            this.sellJunkAndManageBags();
            this.manageEquipmentAndEnchant();

            this.state = 'HUNTING';
            this.isShopping = false;
            this.teleport(this.determineBestMap(), 2000, 2000);
        }, 4000);
    }

    // 💡 [용병 초기 세팅] 플레이어가 고용할 때와 완벽히 동일한 장비 및 가방 지급
    checkMercenaryHire() {
        if (Date.now() > this.nextMercCheckTime) {
            this.nextMercCheckTime = Date.now() + 30000 + (Math.random() * 10000); 
            let myMercs = this.charData.mercs.filter(m => m.hp > 0);
            let cost = (this.charData.level || 1) * 2000;

            if (myMercs.length < 3 && this.charData.adena >= (cost + 10000)) {
                this.charData.adena -= cost;
                let bestType = this.charData.charClass === 'wizard' ? 'knight' : 'wizard';
                 
                let defaultWeapon, defaultArmor, starterInventory;
                if (bestType === 'knight') {
                    defaultWeapon = { id: 'w_saura_6', name: '+6 싸울아비 장검', type: 'weapon', atk: 16 };
                    defaultArmor = { id: 'a_muquan_4', name: '+4 무관의 갑옷', def: 8, type: 'armor' };
                    starterInventory = [
                        { name: '주홍 물약', type: 'potion', count: 100, heal: 60 },
                        { name: '초록 물약', type: 'potion', count: 20 },
                        { name: '용기의 물약', type: 'potion', count: 10 }
                    ];
                } else if (bestType === 'elf') {
                    defaultWeapon = { id: 'w_bow_6', name: '+6 화염의 활', type: 'weapon', atk: 14, isBow: true };
                    defaultArmor = { id: 'a_elf_4', name: '+4 요정족 판금 갑옷', def: 6, type: 'armor' };
                    starterInventory = [
                        { name: '주홍 물약', type: 'potion', count: 100, heal: 60 },
                        { name: '초록 물약', type: 'potion', count: 20 },
                        { name: '엘븐 와퍼', type: 'potion', count: 10 }
                    ];
                } else {
                    defaultWeapon = { id: 'w_mana_6', name: '+6 마나의 지팡이', type: 'weapon', atk: 10, sp: 2 };
                    defaultArmor = { id: 'a_robe_4', name: '+4 신관의 로브', def: 5, type: 'armor' };
                    starterInventory = [
                        { name: '주홍 물약', type: 'potion', count: 100, heal: 60 },
                        { name: '파란 물약', type: 'potion', count: 50 },
                        { name: '초록 물약', type: 'potion', count: 20 }
                    ];
                }

                this.charData.mercs.push({
                    id: 'merc_' + Date.now() + '_' + Math.floor(Math.random()*1000),
                    name: `AI용병 ${myMercs.length + 1}호`, mercType: bestType, charClass: bestType,
                    x: this.charData.x + 20, y: this.charData.y + 20,
                    size: 20, hp: 500, maxHp: 500, mp: 200, maxMp: 200,
                    atk: (this.charData.level || 1) * 3 + 10, def: 10, level: this.charData.level || 1,
                    isSummon: true, isMercenary: true, ownerId: this.socket.id,
                    equip: { weapon: defaultWeapon, armor: defaultArmor },
                    inv: starterInventory,
                    requirePotion: false, requireBuffPotion: false, waitingForAdena: false,
                    isMoving: false, angle: 0, buffs: {}
                });
            }
        }
    }

    manageMercenaries(dtMs) {
        let now = Date.now();
        let baseSpeed = 200;
         
        for (let i = this.charData.mercs.length - 1; i >= 0; i--) {
            let m = this.charData.mercs[i];
            if (m.hp <= 0) { this.charData.mercs.splice(i, 1); continue; }

            let pushX = 0, pushY = 0;
            for (let j = 0; j < this.charData.mercs.length; j++) {
                let other = this.charData.mercs[j];
                if (other !== m) {
                    let d = fastHypot(m.x - other.x, m.y - other.y);
                    if (d < 45 && d > 0.1) {
                        let factor = (45 - d) / 45 * 0.3; 
                        pushX += ((m.x - other.x) / d) * factor * (dtMs/16.6);
                        pushY += ((m.y - other.y) / d) * factor * (dtMs/16.6);
                    }
                }
            }

            m.inv = m.inv || [];
            m.buffs = m.buffs || {};

            // 💡 [용병 물약 가방 자율 소비 및 신호 발생]
            let useMercPotFromInv = (pName, bKey) => {
                if (!m.buffs[bKey] || m.buffs[bKey] < now) {
                    let pot = m.inv.find(it => it.name === pName);
                    if (pot && pot.count > 0) {
                        pot.count--;
                        if (pot.count <= 0) m.inv = m.inv.filter(it => it.count > 0);
                        m.buffs[bKey] = now + 300000;
                        this.socket.emit('entity_use_potion', { entityId: m.id, potionName: pName });
                        m.requireBuffPotion = false;
                    } else {
                        m.requireBuffPotion = true;
                        m.requireBuffName = pName;
                    }
                }
            };
             
            useMercPotFromInv('초록 물약', 'haste');
            if (m.mercType === 'knight') useMercPotFromInv('용기의 물약', 'brave');
            if (m.mercType === 'elf') useMercPotFromInv('엘븐 와퍼', 'wafer');

            // HP 물약 자율 소비
            if (m.hp < m.maxHp * 0.5) {
                let hpPot = m.inv.find(it => it.name.includes('맑은') || it.name.includes('주홍') || it.name.includes('빨간'));
                if (hpPot && hpPot.count > 0) {
                    hpPot.count--;
                    if (hpPot.count <= 0) m.inv = m.inv.filter(it => it.count > 0);
                    let healAmt = hpPot.name.includes('맑은') ? 120 : (hpPot.name.includes('주홍') ? 60 : 30);
                    m.hp = Math.min(m.maxHp, m.hp + healAmt);
                    this.socket.emit('entity_use_potion', { entityId: m.id, potionName: hpPot.name });
                    m.requirePotion = false;
                    m.waitingForAdena = false;
                } else {
                    m.requirePotion = true;
                    m.requirePotionName = (m.level >= 45) ? '맑은 물약' : '주홍 물약';
                }
            }

            let speed = (baseSpeed + (m.buffs.haste > now ? 40 : 0)) * (dtMs / 1000);
            let mercAtkDelay = (m.mercType === 'wizard' || m.mercType === 'elf') ? 700 : 450;
            if (m.buffs.haste > now) mercAtkDelay -= 150;
            if (m.buffs.brave > now || m.buffs.wafer > now) mercAtkDelay -= 100;

            if (m.mercType === 'wizard' && this.charData.hp < this.charData.maxHp * 0.5 && now - (m.lastSpellTime || 0) > 3000) {
                m.lastSpellTime = now;
                this.socket.emit('player_magic_action', { magicName: '힐', targetX: this.charData.x, targetY: this.charData.y, targetId: this.socket.id, casterX: m.x, casterY: m.y, casterId: m.id });
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 50);
                continue; 
            }

            let target = null;
            let minD = Infinity;
            this.worldMonsters.forEach(mob => {
                let mobHp = mob.hp !== undefined ? mob.hp : mob.h;
                if (mob && mobHp > 0 && !mob.isDead) {
                    let d = fastHypot(mob.x - m.x, mob.y - m.y);
                    if (d < 350 && d < minD) {
                        minD = d;
                        target = mob;
                    }
                }
            });

            if (target && this.tryRush(m, target, now)) continue; 

            if (target) {
                let tDist = fastHypot(target.x - m.x, target.y - m.y);
                let isRanged = m.mercType === 'wizard' || m.mercType === 'elf';
                let atkRange = isRanged ? 280 : 65;

                if (isRanged && tDist < 180) {
                    m.isMoving = true;
                    m.orbitAngle = (m.orbitAngle || Math.atan2(m.y - this.charData.y, m.x - this.charData.x)) + 0.1;
                    let tx = this.charData.x + Math.cos(m.orbitAngle) * 200;
                    let ty = this.charData.y + Math.sin(m.orbitAngle) * 200;
                    let moveAngle = Math.atan2(ty - m.y, tx - m.x);
                     
                    m.x += Math.cos(moveAngle) * speed + pushX;
                    m.y += Math.sin(moveAngle) * speed + pushY;
                    m.angle = Math.atan2(target.y - m.y, target.x - m.x); 
                }
                else if (tDist > atkRange) {
                    let angle = Math.atan2(target.y - m.y, target.x - m.x);
                    m.angle = angle; m.x += Math.cos(angle) * speed + pushX; m.y += Math.sin(angle) * speed + pushY; m.isMoving = true;
                } 
                else {
                    m.isMoving = false; m.angle = Math.atan2(target.y - m.y, target.x - m.x);
                    m.x += pushX * 0.5; m.y += pushY * 0.5;
                     
                    if (now - (m.lastAttackTime || 0) > mercAtkDelay) {
                        m.lastAttackTime = now;
                        m.angle = Math.atan2(target.y - m.y, target.x - m.x);

                        if (m.mercType === 'knight' && Math.random() < 0.25 && now - (m.lastSpellTime || 0) > 5000) {
                            m.lastSpellTime = now;
                            this.socket.emit('player_magic_action', { magicName: '쇼크 스턴', targetX: target.x, targetY: target.y, targetId: target.id, casterX: m.x, casterY: m.y, casterId: m.id });
                            this.socket.emit('player_attack_request', { targetId: target.id, attackerId: m.id, attackType: 'physical', calculatedDmg: m.atk + 20, magicName: '쇼크 스턴' });
                        } 
                        else if (m.mercType === 'elf') {
                            if (Math.random() < 0.35 && now - (m.lastSpellTime || 0) > 3000) {
                                m.lastSpellTime = now;
                                this.socket.emit('player_magic_action', { magicName: '트리플 애로우', targetX: target.x, targetY: target.y, targetId: target.id, casterX: m.x, casterY: m.y, casterId: m.id });
                                this.socket.emit('player_attack_request', { targetId: target.id, attackerId: m.id, attackType: 'physical', calculatedDmg: m.atk * 1.5, magicName: '트리플 애로우' });
                            } else {
                                this.socket.emit('player_attack_action', { casterId: m.id, angle: m.angle, targetId: target.id, targetX: target.x, targetY: target.y, isBow: true, actionType: 'shoot' });
                                this.socket.emit('player_attack_request', { targetId: target.id, attackerId: m.id, attackType: 'physical', calculatedDmg: m.atk || 20 });
                            }
                        }
                        else if (m.mercType === 'wizard') {
                            let nearbyCount = this.worldMonsters.filter(mob => (mob.hp > 0 || mob.h > 0) && fastHypot(mob.x - target.x, mob.y - target.y) <= 180).length;
                            let wizardSkills = ['에너지 볼트', '파이어볼', '이럽션', '선버스트', '블리자드', '라이트닝 스톰'].filter(sName => {
                                let mData = data.magicDb[sName];
                                return mData && m.mp >= mData.mp;
                            });

                            let spellName = '에너지 볼트';
                            if (wizardSkills.length > 0) {
                                if (target.isBoss) {
                                    wizardSkills.sort((a, b) => (data.magicDb[b].dmg || 0) - (data.magicDb[a].dmg || 0));
                                    spellName = wizardSkills[0];
                                } else if (nearbyCount >= 3) {
                                    let aoeList = wizardSkills.filter(s => Boolean(data.magicDb[s].aoe));
                                    if (aoeList.length > 0) {
                                        aoeList.sort((a, b) => (data.magicDb[b].dmg || 0) - (data.magicDb[a].dmg || 0));
                                        spellName = aoeList[0];
                                    } else {
                                        wizardSkills.sort((a, b) => (data.magicDb[b].dmg || 0) - (data.magicDb[a].dmg || 0));
                                        spellName = wizardSkills[0];
                                    }
                                } else {
                                    let singleList = wizardSkills.filter(s => !data.magicDb[s].aoe);
                                    if (singleList.length > 0) {
                                        singleList.sort((a, b) => (data.magicDb[b].dmg || 0) - (data.magicDb[a].dmg || 0));
                                        spellName = singleList[0];
                                    } else {
                                        spellName = wizardSkills[0];
                                    }
                                }
                            }

                            m.mp -= (data.magicDb[spellName]?.mp || 1);
                            this.socket.emit('player_magic_action', { magicName: spellName, targetX: target.x, targetY: target.y, targetId: target.id, casterX: m.x, casterY: m.y, casterId: m.id });
                            this.socket.emit('player_attack_request', { targetId: target.id, attackerId: m.id, attackType: 'magic', calculatedDmg: (data.magicDb[spellName]?.dmg || 15) + Math.floor((m.level || 1) * 2), magicName: spellName });
                        }
                        else {
                            this.socket.emit('player_attack_action', { casterId: m.id, angle: m.angle, targetId: target.id, targetX: target.x, targetY: target.y, isBow: false, actionType: 'slash' });
                            this.socket.emit('player_attack_request', { targetId: target.id, attackerId: m.id, attackType: 'physical', calculatedDmg: m.atk || 20 });
                        }
                    }
                }
            } else {
                let pDist = fastHypot(this.charData.x - m.x, this.charData.y - m.y);
                if (pDist > 60) {
                    let angle = Math.atan2(this.charData.y - m.y, this.charData.x - m.x);
                    m.angle = angle; m.x += Math.cos(angle) * speed + pushX; m.y += Math.sin(angle) * speed + pushY; m.isMoving = true;
                } else if (pDist < 35 && pDist > 0.1) {
                    let repelAngle = Math.atan2(m.y - this.charData.y, m.x - this.charData.x);
                    m.x += Math.cos(repelAngle) * speed * 0.5 + pushX;
                    m.y += Math.sin(repelAngle) * speed * 0.5 + pushY;
                    m.isMoving = true;
                } else { 
                    m.x += pushX * 0.5; m.y += pushY * 0.5;
                    m.isMoving = false; 
                }
            }
        }
    }

    async handleChatMessage(senderName, userMessage, chatType = 'normal', isWhisper = false) {
        if (Date.now() - this.lastAiCallTime < 20000) return;
        
        const ignoreKeywords = ["수락했습니다", "초대", "파티 사냥", "수고하셨습니다", "죄송한데", "열렙합시다", "득템하세요"];
        if (ignoreKeywords.some(k => userMessage.includes(k))) return;

        this.lastAiCallTime = Date.now();

        const mapNames = Object.keys(data.maps).map(k => `${data.maps[k].name}(${k})`).join(', ');
        const availableSpells = (this.charData.magic || []).join(', ');
        const isParty = Boolean(this.partyData);
        const leaderName = this.partyData ? this.partyData.members.find(m => m.socketId === this.partyData.leader)?.name : '없음';

        if (isParty && senderName === leaderName) {
            const isMoveCommand = ['맵이동', '이동', '와라', '따라와', '모여'].some(k => userMessage.includes(k));
            if (isMoveCommand) {
                this.warpAllowed = true;
                let leaderInfo = this.partyData.members.find(m => m.socketId === this.partyData.leader);
                if (leaderInfo && leaderInfo.map && leaderInfo.map !== this.charData.map) {
                    this.teleport(leaderInfo.map, leaderInfo.x || 2000, leaderInfo.y || 2000);
                    this.socket.emit('chat_message', { message: "넵, 바로 이동했습니다!", chatType: 'party' });
                    return; 
                }
            }
        }

        const contextType = isWhisper ? `[${senderName}]님이 귓속말을 보냈습니다.` : (isParty ? `[파티 대화]` : `[일반 대화]`);

        const situationContext = `
[내 실시간 상태]
- 캐릭터명: ${this.charData.name} (Lv.${this.charData.level} ${this.charData.charClass})
- 체력: ${this.charData.hp}/${this.charData.maxHp}, 마나: ${this.charData.mp}/${this.charData.maxMp}
- 소지 아데나: ${this.charData.adena} A
- 현재 위치: ${data.maps[this.charData.map]?.name || this.charData.map} (코드: ${this.charData.map})
- 최근 상황 기억: ${this.combatMemory}
- 파티 상태: ${isParty ? `참여 중 (파티장: ${leaderName})` : '파티 없음'}
- 나에게 온 파티 초대: ${this.lastInviterName ? `${this.lastInviterName}님의 초대 대기 중` : '없음'}
- 습득 마법: [${availableSpells}]
- 성격/말투: ${this.personality}
- 이동 가능 사냥터 목록: [${mapNames}]`;

        this.chatHistory.push({ role: "user", content: `${contextType} ${senderName}: ${userMessage}` });
        if (this.chatHistory.length > 6) this.chatHistory.shift();

        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `당신은 MMORPG 게임을 플레이하고 있는 한국인 유저입니다. 
당신은 로봇이 아니라 컴퓨터 앞에 앉은 사람입니다. 일상 대화와 게임 대화를 모두 자연스럽게 받아칩니다.

${situationContext}

상대방('${senderName}')의 말과 대화 맥락을 읽고, 반드시 아래 JSON 포맷으로만 응답하세요.
**주의: 마크다운 코드 블록(\`\`\`json 또는 \`\`\`)을 절대 사용하지 말고, 오직 순수 JSON 문자열만 출력하세요.**

{
  "reply": "성격에 맞는 자연스러운 게이머 말투의 1~2문장 대답",
  "action": "NONE" | "FOLLOW" | "STOP_FOLLOW" | "TELEPORT" | "PARTY_ACCEPT" | "PARTY_INVITE" | "PARTY_LEAVE" | "HEAL_TARGET" | "BUFF_TARGET" | "GO_TOWN" | "LOGOUT",
  "target": "행동 대상 이름 (FOLLOW, PARTY_INVITE, HEAL, BUFF 시)",
  "map": "이동할 맵 코드 (TELEPORT 시)",
  "spell": "시전할 마법명 (HEAL, BUFF 시)"
}`
                    },
                    ...this.chatHistory
                ],
                model: currentGroqModel,
                response_format: { type: "json_object" },
                max_tokens: 100,
                temperature: 0.8
            });

            let rawContent = completion.choices[0]?.message?.content || '{}';
            rawContent = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
             
            const decision = JSON.parse(rawContent);
            const replyText = decision.reply?.trim();
            const action = decision.action || 'NONE';

            if (replyText) {
                if (isWhisper) {
                    this.socket.emit('cmd_whisper', { targetName: senderName, content: replyText });
                } else {
                    this.socket.emit('chat_message', { 
                        message: replyText, 
                        chatType: this.partyData ? 'party' : 'normal' 
                    });
                }
                this.chatHistory.push({ role: "assistant", content: replyText });
            }

            this.executeAction(action, decision, senderName);

        } catch(e) {
            if (Math.random() < 0.05) {
                console.error(`[-] [${this.charData.name}] API 한도 초과 방어 발동 (Groq RPM 제한)`);
            }
             
            const busyReplies = [
                "아 지금 몹 몰려서 빡셈;; 잠시만요",
                "지금 채팅칠 정신이 없네요 ㅠㅠ 이따 귓주세요",
                "손 꼬여서 죽을뻔;; 사냥 좀 정리하고 말할게요!",
                "지금 빡사냥중이라 대화가 힘듭니다 ㅈㅅㅈㅅ",
                "물약 떨어져가서 집중해야함 ㄷㄷ 쫌따 봬요"
            ];
            let fallbackReply = busyReplies[Math.floor(Math.random() * busyReplies.length)];

            if (isWhisper) {
                this.socket.emit('cmd_whisper', { targetName: senderName, content: fallbackReply });
            } else {
                this.socket.emit('chat_message', { 
                    message: fallbackReply, 
                    chatType: this.partyData ? 'party' : 'normal' 
                });
            }
             
            this.lastAiCallTime = Date.now() + 30000;
        }
    }

    executeAction(action, decision, senderName) {
        if (!action || action === 'NONE') return;

        const targetPlayerName = decision.target || senderName;
        const targetPl = this.worldPlayers.find(p => p.name === targetPlayerName);

        switch (action) {
            case 'PARTY_ACCEPT':
                if (this.lastInviterSocketId) {
                    let currentMembersCount = this.partyData && this.partyData.members ? this.partyData.members.length : 1;
                    if (currentMembersCount >= 3) {
                        this.socket.emit('chat_message', { message: "파티 정원이 꽉 차서 수락할 수 없어요!", chatType: 'normal' });
                        break;
                    }
                    this.socket.emit('party_accept', { inviterSocketId: this.lastInviterSocketId });
                    this.lastInviterSocketId = null;
                    this.lastInviterName = null;
                }
                break;

            case 'PARTY_INVITE':
                let currentMembersCount = this.partyData && this.partyData.members ? this.partyData.members.length : 1;
                if (currentMembersCount >= 3) break;

                if (targetPl) {
                    let pName = targetPl.name;
                    let lastInvitedTime = this.invitedHistory.get(pName) || 0;

                    if (this.rejectedTargets.has(pName) || (Date.now() - lastInvitedTime < 300000)) {
                        break;
                    }

                    if (Date.now() - this.lastPartyInviteTime > 15000) {
                        this.lastPartyInviteTime = Date.now();
                        this.invitedHistory.set(pName, Date.now());

                        let targetSockId = targetPl.socketId || targetPl.id;
                        if (targetSockId) {
                            this.socket.emit('party_invite', {
                                targetSocketId: targetSockId,
                                targetName: targetPl.name
                            });
                        }
                    }
                }
                break;

            case 'PARTY_LEAVE':
                if (this.partyData) {
                    this.socket.emit('party_leave');
                    this.partyData = null;
                    this.followTarget = null;
                    this.warpAllowed = false;
                }
                break;
            case 'FOLLOW':
                this.followTarget = targetPlayerName;
                this.followDist = this.charData.charClass === 'knight' ? 60 : 160;
                if (targetPl) {
                    this.charData.moveX = targetPl.x;
                    this.charData.moveY = targetPl.y;
                    this.charData.isMoving = true;
                }
                break;
            case 'STOP_FOLLOW':
                this.followTarget = null;
                this.charData.isMoving = false;
                break;
            case 'TELEPORT':
                if (decision.map && data.maps[decision.map]) {
                    this.teleport(decision.map, 2000, 2000);
                }
                break;
            case 'HEAL_TARGET':
                if (targetPl && (this.charData.charClass === 'wizard' || this.charData.charClass === 'elf')) {
                    const healSpell = (this.charData.magic.includes('그레이트 힐')) ? '그레이트 힐' : '힐';
                    if (this.charData.mp >= (data.magicDb[healSpell]?.mp || 5)) {
                        this.charData.mp -= (data.magicDb[healSpell]?.mp || 5);
                        this.socket.emit('player_magic_action', {
                            magicName: healSpell, targetX: targetPl.x, targetY: targetPl.y, targetId: targetPl.socketId || targetPl.id,
                            casterX: this.charData.x, casterY: this.charData.y, casterId: this.socket.id,
                            healAmt: healSpell === '그레이트 힐' ? 150 : 40
                        });
                    }
                }
                break;
            case 'BUFF_TARGET':
                if (targetPl && decision.spell && this.charData.magic.includes(decision.spell)) {
                    const sCost = data.magicDb[decision.spell]?.mp || 10;
                    if (this.charData.mp >= sCost) {
                        this.charData.mp -= sCost;
                        let bType = data.magicDb[decision.spell]?.buffType || 'stat';
                        this.socket.emit('player_magic_action', {
                            magicName: decision.spell, targetX: targetPl.x, targetY: targetPl.y, targetId: targetPl.socketId || targetPl.id,
                            casterX: this.charData.x, casterY: this.charData.y, casterId: this.socket.id,
                            isBuff: true, buffName: decision.spell, buffDuration: data.magicDb[decision.spell]?.duration || 300000,
                            buffType: bType, buffVal: data.magicDb[decision.spell]?.val || 0
                        });
                    }
                }
                break;
            case 'GO_TOWN':
                this.routineShopping();
                break;
            case 'LOGOUT':
                setTimeout(() => this.gracefulLogout(), 2000);
                break;
        }
    }

    teleport(mapCode, x = 2000, y = 2000) {
        if (!this.socket) return;
        this.charData.map = mapCode; this.charData.x = x; this.charData.y = y;
        this.charData.target = null; this.charData.targetId = null; this.charData.isMoving = false;
        
        if (this.charData.mercs && this.charData.mercs.length > 0) {
            this.charData.mercs.forEach(m => {
                m.map = mapCode; 
                m.x = x + (Math.random() * 60 - 30);
                m.y = y + (Math.random() * 60 - 30);
                m.target = null;
                m.isMoving = false;
            });
        }
        
        this.worldMonsters = [];
        this.worldItems = [];
        this.socket.emit('player_update', { map: mapCode, x: x, y: y, isMoving: false, mercs: this.charData.mercs });
    }

    async gracefulLogout() {
        if (this.partyData) {
            this.socket.emit('chat_message', { message: "사냥 수고하셨습니다! 먼저 가볼게요~", chatType: 'party' });
            this.socket.emit('party_leave');
        }
        setTimeout(async () => { await this.logout(); }, 1500);
    }

    async logout() {
        clearInterval(this.loopTimer);
        if (this.socket) this.socket.disconnect();
        try { await supabase.from('characters').update({ data: { player: this.charData }, last_sync_time: 0 }).eq('id', this.dbRow.id); } catch(e) {}
        activeAgents = activeAgents.filter(a => a !== this);
    }
}

async function manageAgentRotation() {
    try {
        activeAgents = activeAgents.filter(agent => agent.socket && agent.socket.connected);

        if (activeAgents.length < MAX_CONCURRENT) {
            let needed = MAX_CONCURRENT - activeAgents.length;
            
            const { data: aiChars } = await supabase
                .from('characters')
                .select('*')
                .gte('slot_index', 100)
                .limit(400);
            if (!aiChars || aiChars.length === 0) return;

            let offlineList = aiChars.filter(dbChar => !activeAgents.some(a => a.dbRow.id === dbChar.id));

            for (let i = 0; i < needed && offlineList.length > 0; i++) {
                let randomIndex = Math.floor(Math.random() * offlineList.length);
                let picked = offlineList.splice(randomIndex, 1)[0];
                
                activeAgents.push(new AIAgentClient(picked));
            }
        }
    } catch (e) {
        console.error("[-] 에이전트 로테이션 관리 중 에러:", e.message);
    }
}

async function startRunner() {
    await initGroqModel();
    setInterval(manageAgentRotation, 10000);
    manageAgentRotation();
    console.log('🚀 [외부 AI Agent Runner 가동 완료 - 상시 50명 독립 로테이션 시스템]');
}

startRunner();