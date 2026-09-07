// aiAgentRunner.js (Groq LLM 두뇌 연동, 자율 판단 액션 디스패처, 파티/점사/추적/치유 및 대화 메모리 완벽 통합본)
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
const MAX_CONCURRENT = 4;

class AIAgentClient {
    constructor(dbRow) {
        this.dbRow = dbRow;
        this.charData = dbRow.data.player || dbRow.data;
        
        if (!this.charData.charClass) {
            let nameLower = (this.charData.name || '').toLowerCase();
            this.charData.charClass = nameLower.includes('wiz') ? 'wizard' : (nameLower.includes('elf') ? 'elf' : 'knight');
        }

        this.charData.mercs = this.charData.mercs || []; 
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

        this.charData.equip = this.charData.equip || { weapon: null, armor: null, helmet: null };
        this.charData.inv = this.charData.inv || [];
        
        let pot = this.charData.inv.find(i => i.name === '주홍 물약');
        if (pot) pot.count = 500; else this.charData.inv.push({ name: '주홍 물약', type: 'potion', count: 500, heal: 60 });

        this.socket = null;
        this.state = 'HUNTING'; 
        this.isShopping = false; 
        this.sessionStart = Date.now();
        this.sessionDuration = (Math.floor(Math.random() * 120) + 60) * 60 * 1000; 
        
        this.lastAiCallTime = 0;
        this.lastMapCheckTime = Date.now();
        this.nextMercCheckTime = Date.now() + (Math.random() * 10000);
        this.lastRegenTime = Date.now();

        this.worldPlayers = [];
        this.worldMonsters = [];
        this.worldItems = [];
        this.worldMercs = [];

        // 🧠 [에이전트 인지 및 상호작용 메모리]
        this.chatHistory = [];             // 세션 종료까지 유지되는 대화 기억 버퍼
        this.partyData = null;             // 소속된 파티 실시간 데이터
        this.lastInviterSocketId = null;   // 파티 초대자 소켓 ID
        this.lastInviterName = null;       // 파티 초대자 이름
        this.followTarget = null;          // 현재 따라다니는 유저 이름
        this.followDist = 60;              // 추적 유지 간격

        // 💡 [연속 대화 기억 메모리]
        this.lastTalkedUser = null;
        this.lastTalkTime = 0;

        // 고유 성격(페르소나) 할당
        const personalities = [
            "말수가 적고 'ㅇㅇ', 'ㄱㅅ', 'ㅈㅅ' 등 단답형 초성체를 자주 쓰는 묵묵한 게이머",
            "친절하고 뉴비를 잘 챙겨주며 정중한 존댓말을 쓰는 게이머",
            "오직 사냥 효율과 보스 탐, 득템에만 집중하는 실용주의 게이머",
            "경상도 사투리를 구수하게 섞어 쓰고 정이 넘치는 아재 감성 게이머",
            "농담과 장난을 좋아하고 ㅋㅋㅋ를 자주 붙이는 활발한 수다쟁이 게이머",
            "승부욕이 강하고 사냥 방해에 민감한 호전적인 게이머"
        ];
        let hash = 0;
        for (let i = 0; i < this.charData.name.length; i++) hash += this.charData.name.charCodeAt(i);
        this.personality = personalities[hash % personalities.length];

        this.learnMagicForLevel(); 
        this.connect();
    }

    connect() {
        this.socket = io(SERVER_URL, { transports: ['websocket'], upgrade: false });
        this.socket.on('connect', () => {
            this.charData.id = this.socket.id; 
            console.log(`[🤖 AI 접속] ${this.charData.name} (Lv.${this.charData.level} ${this.charData.charClass}) - 성격: ${this.personality.slice(0, 15)}...`);
            
            let startMap = this.determineBestMap();
            this.charData.map = startMap;
            
            this.charData.x = 2000 + (Math.random() * 500 - 250);
            this.charData.y = 2000 + (Math.random() * 500 - 250);

            this.socket.emit('player_join', {
                id: this.dbRow.id, name: this.charData.name, charClass: this.charData.charClass,
                x: this.charData.x, y: this.charData.y, map: startMap, level: this.charData.level || 1
            });
            this.setupListeners();
            this.startLoop();
        });
    }

    setupListeners() {
        this.socket.on('sync_map_state', (packet) => {
            this.worldMonsters = (packet.monsters || []).map(m => ({ ...m, map: this.charData.map }));
            this.worldItems = (packet.items || []).map(i => ({ ...i, map: this.charData.map }));
        });

        this.socket.on('sync_entities', (packet) => {
            this.worldPlayers = (packet.players || []).map(p => ({ ...p, map: this.charData.map, isPlayer: true }));
            if (packet.monsters) {
                this.worldMonsters = packet.monsters.map(m => ({ ...m, map: this.charData.map }));
            }
            this.worldMercs = (packet.mercs || []).map(m => ({ ...m, map: this.charData.map, isSummon: true, isOtherMerc: true }));
        });

        this.socket.on('item_spawned', (packet) => this.worldItems.push(packet.item));
        this.socket.on('item_removed', (packet) => {
            this.worldItems = this.worldItems.filter(it => it.id !== packet.itemId);
        });

        this.socket.on('take_damage', (packet) => {
            this.charData.hp = Math.max(0, this.charData.hp - (packet.damage || 10));
            this.checkDrinkPotion();
        });

        this.socket.on('item_looted_success', (packet) => {
            if (packet.item.type === 'currency') this.charData.adena += packet.item.count;
            else this.charData.inv.push(packet.item);
        });

        this.socket.on('player_exp_gain', (packet) => {
            this.charData.exp += packet.exp;
            this.checkLevelUp();
        });

        // 💬 [핵심 수정] 귓속말, 파티 채팅, 일반 대화 모두 감지 및 60초 연속 메모리 반응
        this.socket.on('chat_broadcast', async (packet) => {
            if (packet.socketId === this.socket.id) return;
            
            let baseName = this.charData.name.replace(/[0-9]/g, '');
            let isAddressedToMe = packet.message.includes(this.charData.name) || 
                                 (baseName && packet.message.includes(baseName));
            
            // 이름 생략 연속 대화 허용 (마지막 대화 후 60초 이내)
            if (!isAddressedToMe && this.lastTalkedUser === packet.name && (Date.now() - this.lastTalkTime < 60000)) {
                isAddressedToMe = true; 
            }
            
            let isWhisperToMe = packet.isWhisper && packet.targetName === this.charData.name;

            // 파티 채팅이거나 나를 지목한 일반 대화, 또는 나에게 온 귓말일 때 두뇌 처리
            if (packet.chatType === 'party' || isAddressedToMe || isWhisperToMe) {
                this.lastTalkedUser = packet.name; // 최근 대화자 기억
                this.lastTalkTime = Date.now();
                await this.handleChatMessage(packet.name, packet.message, packet.chatType, packet.isWhisper);
            }
        });

        // 👥 [파티 시스템 리스너]
        this.socket.on('party_invite_received', (packet) => {
            this.lastInviterSocketId = packet.inviterSocketId;
            this.lastInviterName = packet.inviterName;
        });

        this.socket.on('party_update', (packet) => {
            const prevParty = this.partyData;
            this.partyData = packet.party;

            // 파티가 해산되었거나 추방당했을 때
            if (prevParty && !packet.party) {
                this.followTarget = null;
                this.charData.target = null;
                this.socket.emit('chat_message', { 
                    message: "파티 사냥 수고하셨습니다! 득템하세요~", 
                    chatType: 'normal' 
                });
            }
        });

        // 🎯 파티장이 몬스터를 점사 지정하면 즉시 타겟 동기화
        this.socket.on('party_target_shared', (packet) => {
            if (!packet || !packet.targetId) return;
            const sharedMob = this.worldMonsters.find(m => m.id === packet.targetId && m.hp > 0 && !m.isDead);
            if (sharedMob) {
                this.charData.target = sharedMob;
                this.charData.isMoving = false;
            }
        });
    }

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
        if (leveledUp) console.log(`[🎉 에이전트 레벨업] ${this.charData.name} -> Lv.${this.charData.level}`);
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

    startLoop() {
        this.loopTimer = setInterval(() => {
            // 접속 시간 종료 시 정중한 파티 탈퇴 및 작별 인사 후 로그아웃
            if (Date.now() - this.sessionStart >= this.sessionDuration) {
                this.gracefulLogout(); 
                return;
            }

            let now = Date.now();
            if (now - this.lastRegenTime >= 2000) {
                this.lastRegenTime = now;
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 5 + Math.floor(this.charData.level / 5));
                this.charData.mp = Math.min(this.charData.maxMp, this.charData.mp + 3 + Math.floor(this.charData.level / 10));
            }

            this.processAutoBuffs(); 

            // 💡 추적(FOLLOW) 대상이 있으면 해당 유저에게 보폭 맞추기
            if (this.followTarget && this.state !== 'SHOPPING') {
                this.executeFollowMovement();
            }

            this.executeSharedAILoop();
            this.tryRush(this.charData, this.charData.target, now);
            this.updateMovement(100); 
            
            this.checkMercenaryHire(); 
            this.manageMercenaries(100); 
            
            this.checkSmartMapNavigation();

            this.socket.emit('player_update', {
                name: this.charData.name, charClass: this.charData.charClass,
                x: Math.round(this.charData.x), y: Math.round(this.charData.y),
                angle: Number((this.charData.angle || 0).toFixed(2)),
                hp: this.charData.hp, maxHp: this.charData.maxHp,
                atk: this.charData.atk, def: this.charData.def,
                level: this.charData.level, map: this.charData.map,
                equip: this.charData.equip || {}, isMoving: this.charData.isMoving || false,
                mercs: this.charData.mercs || [] 
            });
        }, 100); 
    }

    // 유저 따라가기 위치 보정
    executeFollowMovement() {
        let leader = this.worldPlayers.find(p => p.name === this.followTarget);
        if (leader) {
            let dist = Math.hypot(leader.x - this.charData.x, leader.y - this.charData.y);
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
        
        let dist = Math.hypot(target.x - entity.x, target.y - entity.y);
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
                    this.socket.emit('player_use_potion', { potionName: potName });
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
            let dist = Math.hypot(this.charData.moveX - this.charData.x, this.charData.moveY - this.charData.y);
            let speed = 180 * (dtMs / 1000); 
            if (this.charData.buffs && this.charData.buffs.haste && this.charData.buffs.haste > Date.now()) speed += 100;

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

        if (this.charData.target) {
            let liveTarget = this.worldMonsters.find(m => m.id === this.charData.target.id && m.hp > 0 && !m.isDead);
            if (!liveTarget || Math.hypot(liveTarget.x - this.charData.x, liveTarget.y - this.charData.y) > 700) {
                this.charData.target = null;
                this.charData.isMoving = false;
            } else {
                this.charData.target = liveTarget;
            }
        }

        let atkDelay = this.charData.charClass === 'knight' ? 700 : 900;
        if (this.charData.buffs) {
            let now = Date.now();
            if (this.charData.buffs.haste > now) atkDelay -= 150;
            if (this.charData.buffs.brave > now || this.charData.buffs.wafer > now) atkDelay -= 100;
        }

        let env = {
            now: Date.now(),
            currentMap: this.charData.map,
            mapSize: 4000,
            entities: [...this.worldPlayers, ...this.worldMonsters, ...this.worldMercs],
            items: this.worldItems,
            minLootGrade: 0,
            atkDelay: atkDelay,
            isInSafeZone: (m, x, y) => data.isInSafeZone(m, x, y),
            playSound: () => {}, 
            spawnParticle: () => {}, 
            spawnArrow: (from, to, dmg) => {
                let aimAngle = Math.atan2(to.y - from.y, to.x - from.x);
                this.charData.angle = aimAngle; 
                this.socket.emit('player_attack_action', { casterId: this.socket.id, angle: aimAngle, targetId: to.id, targetX: to.x, targetY: to.y, isBow: true, actionType: 'shoot' });
                this.socket.emit('player_attack_request', { targetId: to.id, attackerId: this.socket.id, attackType: 'physical', calculatedDmg: dmg });
            },
            damageEntity: (target, dmg, attacker, hitType, magicName) => {
                let aimAngle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
                this.charData.angle = aimAngle; 
                if (hitType === 'physical') {
                    this.socket.emit('player_attack_action', { casterId: this.socket.id, angle: aimAngle, targetId: target.id, targetX: target.x, targetY: target.y, actionType: 'slash' });
                }
                this.socket.emit('player_attack_request', { targetId: target.id, attackerId: this.socket.id, attackType: hitType, calculatedDmg: dmg, magicName: magicName });
            },
            castAttackSpell: (target, spellName) => {
                let mData = data.magicDb[spellName];
                if (mData && this.charData.mp >= mData.mp) {
                    this.charData.mp -= mData.mp;
                    
                    if (!target || typeof target.x === 'undefined') return;

                    let aimAngle = Math.atan2(target.y - this.charData.y, target.x - this.charData.x);
                    this.charData.angle = aimAngle; 

                    this.socket.emit('player_magic_action', { 
                        magicName: spellName, targetX: target.x, targetY: target.y, targetId: target.id, 
                        casterX: this.charData.x, casterY: this.charData.y, casterId: this.socket.id 
                    });
                    this.socket.emit('player_attack_request', { 
                        targetId: target.id, attackerId: this.socket.id, attackType: 'magic', 
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

                let available = magics.map(m => ({name: m, data: data.magicDb[m]}))
                    .filter(m => m.data && (m.data.type === 'attack' || m.data.dmg) && this.charData.mp >= m.data.mp);
                if (available.length === 0) return null;
                
                if (target.isBoss) return available.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
                
                let nearby = this.worldMonsters.filter(m => m.hp > 0 && !m.isDead && Math.hypot(m.x - target.x, m.y - target.y) <= 180);
                if (nearby.length >= 3) {
                    let aoe = available.filter(m => m.data.aoe);
                    if (aoe.length > 0) return aoe.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
                }
                let single = available.filter(m => !m.data.aoe);
                if (single.length > 0) return single.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
                return available.sort((a,b) => (b.data.dmg||0) - (a.data.dmg||0))[0].name;
            },
            lootItem: (it) => this.socket.emit('player_loot_item', { itemId: it.id }),
            shareTarget: (id) => this.socket.emit('player_target', { targetId: id })
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
        // 추적 중이거나 파티 중일 때는 맵 강제 이동 방지
        if (this.followTarget || this.partyData) return;

        if (Date.now() - this.lastMapCheckTime > 180000) { 
            this.lastMapCheckTime = Date.now();
            if (!this.charData.target && this.state === 'HUNTING') {
                let bestMap = this.determineBestMap();
                if (this.charData.map !== bestMap) this.teleport(bestMap, 2000, 2000);
            }
        }
    }

    checkDrinkPotion() {
        let potCount = this.charData.inv.find(i => i.name === '주홍 물약')?.count || 0;
        if (this.charData.hp < this.charData.maxHp * 0.6) {
            if (potCount > 0) {
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 60);
                this.charData.inv.find(i => i.name === '주홍 물약').count--;
                this.socket.emit('player_use_potion', { potionName: '주홍 물약' });
            } else {
                if(this.state !== 'SHOPPING') this.routineShopping();
            }
        }
        
        let mpPotCount = this.charData.inv.find(i => i.name === '파란 물약')?.count || 0;
        if (this.charData.mp < this.charData.maxMp * 0.3) {
            if (mpPotCount > 0) {
                this.charData.mp = Math.min(this.charData.maxMp, this.charData.mp + 50);
                this.charData.inv.find(i => i.name === '파란 물약').count--;
                this.socket.emit('player_use_potion', { potionName: '파란 물약' });
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

            let ensureItem = (name, count) => {
                let item = this.charData.inv.find(i => i.name === name);
                if (item) item.count = count;
                else this.charData.inv.push({ name: name, type: 'potion', count: count, heal: name.includes('주홍') ? 60 : 0 });
            };

            ensureItem('주홍 물약', 500);
            ensureItem('초록 물약', 100);
            ensureItem('파란 물약', 200);

            if (this.charData.charClass === 'knight') ensureItem('용기의 물약', 100);
            else if (this.charData.charClass === 'elf') ensureItem('엘븐 와퍼', 100);

            this.state = 'HUNTING';
            this.isShopping = false;
            this.teleport(this.determineBestMap(), 2000, 2000);
        }, 4000);
    }

    checkMercenaryHire() {
        if (Date.now() > this.nextMercCheckTime) {
            this.nextMercCheckTime = Date.now() + 30000 + (Math.random() * 10000); 
            let myMercs = this.charData.mercs.filter(m => m.hp > 0);
            let cost = (this.charData.level || 1) * 2000;

            if (myMercs.length < 3 && this.charData.adena >= (cost + 10000)) {
                this.charData.adena -= cost;
                let bestType = this.charData.charClass === 'wizard' ? 'knight' : 'wizard';
                
                let defaultWeapon, defaultArmor;
                if (bestType === 'knight') {
                    defaultWeapon = { name: '+6 싸울아비 장검', type: 'weapon', atk: 16 };
                    defaultArmor = { name: '+4 갑옷', def: 6, type: 'armor' };
                } else if (bestType === 'elf') {
                    defaultWeapon = { name: '+6 화염의 활', type: 'weapon', atk: 14, isBow: true };
                    defaultArmor = { name: '+4 요정족 판금 갑옷', def: 6, type: 'armor' };
                } else {
                    defaultWeapon = { name: '+6 마나의 지팡이', type: 'weapon', atk: 8, sp: 2 };
                    defaultArmor = { name: '+4 신관의 로브', def: 5, type: 'armor' };
                }

                this.charData.mercs.push({
                    id: 'merc_' + Date.now() + '_' + Math.floor(Math.random()*1000),
                    name: `AI용병 ${myMercs.length + 1}호`, mercType: bestType, charClass: bestType,
                    x: this.charData.x + 20, y: this.charData.y + 20,
                    size: 20, hp: 500, maxHp: 500, mp: 200, maxMp: 200,
                    atk: (this.charData.level || 1) * 3 + 10, def: 10, level: this.charData.level || 1,
                    isSummon: true, isMercenary: true, ownerId: this.socket.id,
                    equip: { weapon: defaultWeapon, armor: defaultArmor },
                    isMoving: false, angle: 0, buffs: {}
                });
            }
        }
    }

    manageMercenaries(dtMs) {
        let now = Date.now();
        let baseSpeed = 150;
        
        for (let i = this.charData.mercs.length - 1; i >= 0; i--) {
            let m = this.charData.mercs[i];
            if (m.hp <= 0) { this.charData.mercs.splice(i, 1); continue; }

            let pushX = 0, pushY = 0;
            for (let j = 0; j < this.charData.mercs.length; j++) {
                let other = this.charData.mercs[j];
                if (other !== m) {
                    let d = Math.hypot(m.x - other.x, m.y - other.y);
                    if (d < 45 && d > 0.1) {
                        let factor = (45 - d) / 45 * 2.5; 
                        pushX += ((m.x - other.x) / d) * factor * (dtMs/16.6);
                        pushY += ((m.y - other.y) / d) * factor * (dtMs/16.6);
                    }
                }
            }

            m.buffs = m.buffs || {};
            let useMercPot = (pName, bKey) => {
                if (!m.buffs[bKey] || m.buffs[bKey] < now) {
                    m.buffs[bKey] = now + 300000;
                    this.socket.emit('player_use_potion', { potionName: pName });
                }
            };
            
            useMercPot('초록 물약', 'haste');
            if (m.mercType === 'knight') useMercPot('용기의 물약', 'brave');
            if (m.mercType === 'elf') useMercPot('엘븐 와퍼', 'wafer');

            let speed = (baseSpeed + (m.buffs.haste > now ? 100 : 0)) * (dtMs / 1000);
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
                if (mob && mob.hp > 0 && !mob.isDead) {
                    let d = Math.hypot(mob.x - m.x, mob.y - m.y);
                    if (d < 350 && d < minD) {
                        minD = d;
                        target = mob;
                    }
                }
            });

            if (target && this.tryRush(m, target, now)) continue; 

            if (target) {
                let tDist = Math.hypot(target.x - m.x, target.y - m.y);
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
                            let nearbyCount = this.worldMonsters.filter(mob => mob.hp > 0 && Math.hypot(mob.x - target.x, mob.y - target.y) <= 180).length;
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
                let pDist = Math.hypot(this.charData.x - m.x, this.charData.y - m.y);
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

    // =========================================================================
    // 🧠 [LLM 지능형 대화 & 인게임 실시간 자율 행동 디스패처]
    // =========================================================================
    async handleChatMessage(senderName, userMessage, chatType = 'normal', isWhisper = false) {
        if (Date.now() - this.lastAiCallTime < 2500) return;
        this.lastAiCallTime = Date.now();

        try {
            const mapNames = Object.keys(data.maps).map(k => `${data.maps[k].name}(${k})`).join(', ');
            const availableSpells = (this.charData.magic || []).join(', ');
            const isParty = Boolean(this.partyData);
            const leaderName = this.partyData ? this.partyData.members.find(m => m.socketId === this.partyData.leader)?.name : '없음';
            const contextType = isWhisper ? `[${senderName}]님이 귓속말을 보냈습니다.` : (isParty ? `[파티 대화]` : `[일반 대화]`);

            const situationContext = `
[내 실시간 상태]
- 캐릭터명: ${this.charData.name} (Lv.${this.charData.level} ${this.charData.charClass})
- 체력: ${this.charData.hp}/${this.charData.maxHp}, 마나: ${this.charData.mp}/${this.charData.maxMp}
- 현재 위치: ${data.maps[this.charData.map]?.name || this.charData.map} (코드: ${this.charData.map})
- 파티 상태: ${isParty ? `참여 중 (파티장: ${leaderName})` : '파티 없음'}
- 나에게 온 파티 초대: ${this.lastInviterName ? `${this.lastInviterName}님의 초대 대기 중` : '없음'}
- 습득 마법: [${availableSpells}]
- 성격/말투: ${this.personality}
- 이동 가능 사냥터 목록: [${mapNames}]`;

            this.chatHistory.push({ role: "user", content: `${contextType} ${senderName}: ${userMessage}` });
            if (this.chatHistory.length > 6) this.chatHistory.shift();

            const completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `당신은 MMORPG 게임을 플레이하고 있는 한국인 유저입니다. 
당신은 로봇이 아니라 컴퓨터 앞에 앉은 사람입니다. 일상 대화와 게임 대화를 모두 자연스럽게 받아칩니다.

${situationContext}

상대방('${senderName}')의 말과 대화 맥락을 읽고, 반드시 아래 JSON 포맷으로 응답하세요:
{
  "reply": "성격에 맞는 자연스러운 게이머 말투의 1~2문장 대답",
  "action": "NONE" | "FOLLOW" | "STOP_FOLLOW" | "TELEPORT" | "PARTY_ACCEPT" | "PARTY_LEAVE" | "HEAL_TARGET" | "BUFF_TARGET" | "GO_TOWN" | "LOGOUT",
  "target": "행동 대상 이름 (FOLLOW, HEAL, BUFF 시)",
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

            const decision = JSON.parse(completion.choices[0]?.message?.content || '{}');
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
            console.error(`[-] [${this.charData.name}] 대화 오류:`, e.message);
        }
    }

    executeAction(action, decision, senderName) {
        if (!action || action === 'NONE') return;

        const targetPlayerName = decision.target || senderName;
        const targetPl = this.worldPlayers.find(p => p.name === targetPlayerName);

        switch (action) {
            case 'PARTY_ACCEPT':
                if (this.lastInviterSocketId) {
                    this.socket.emit('party_accept', { inviterSocketId: this.lastInviterSocketId });
                    this.lastInviterSocketId = null;
                    this.lastInviterName = null;
                }
                break;
            case 'PARTY_LEAVE':
                if (this.partyData) {
                    this.socket.emit('party_leave');
                    this.partyData = null;
                    this.followTarget = null;
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
                            casterX: this.charData.x, casterY: this.charData.y, casterId: this.socket.id
                        });
                    }
                }
                break;
            case 'BUFF_TARGET':
                if (targetPl && decision.spell && this.charData.magic.includes(decision.spell)) {
                    const sCost = data.magicDb[decision.spell]?.mp || 10;
                    if (this.charData.mp >= sCost) {
                        this.charData.mp -= sCost;
                        this.socket.emit('player_magic_action', {
                            magicName: decision.spell, targetX: targetPl.x, targetY: targetPl.y, targetId: targetPl.socketId || targetPl.id,
                            casterX: this.charData.x, casterY: this.charData.y, casterId: this.socket.id
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
        this.charData.target = null; this.charData.isMoving = false;
        this.socket.emit('player_update', { map: mapCode, x: x, y: y, isMoving: false });
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
        try { await supabase.from('characters').update({ data: { player: this.charData } }).eq('id', this.dbRow.id); } catch(e) {}
        activeAgents = activeAgents.filter(a => a !== this);
    }
}

async function manageAgentRotation() {
    if (activeAgents.length < MAX_CONCURRENT) {
        let needed = MAX_CONCURRENT - activeAgents.length;
        const { data: aiChars } = await supabase.from('characters').select('*').gte('slot_index', 100).limit(42);
        if (!aiChars) return;
        let offlineList = aiChars.filter(dbChar => !activeAgents.some(a => a.charData.name === dbChar.name));
        for (let i = 0; i < needed && offlineList.length > 0; i++) {
            let picked = offlineList.splice(Math.floor(Math.random() * offlineList.length), 1)[0];
            activeAgents.push(new AIAgentClient(picked));
        }
    }
}

async function startRunner() {
    await initGroqModel();
    setInterval(manageAgentRotation, 15000);
    manageAgentRotation();
    console.log('🚀 [외부 AI Agent Runner 가동 완료 - 서버 독립형 사냥 봇]');
}
startRunner();