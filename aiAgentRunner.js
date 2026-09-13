// =========================================================================
// aiAgentRunner.js (100명 풀 중 10명 상주, 독립적 1~3시간 개별 로테이션 시스템)
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

let currentGroqModel = 'qwen/qwen3.8-27b';
let activeAgents = []; 
const MAX_CONCURRENT = 10; 

async function initGroqModel() {
    try {
        const modelList = await groq.models.list();
        const availableIds = modelList.data.map(m => m.id);
        const priorityPreferences = [
            'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 
            'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'
        ];
        let picked = priorityPreferences.find(mId => availableIds.includes(mId));
        if (picked) currentGroqModel = picked;
    } catch (e) {
        console.log("[-] Groq 모델 자동 선택 실패, 기본 모델 사용:", currentGroqModel);
    }
}

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
        this.sessionStart = Date.now();
        
        let randomMinutes = Math.floor(Math.random() * 121) + 60; 
        this.sessionDuration = randomMinutes * 60 * 1000;
        console.log(`[🤖 에이전트 입장] ${this.charData.name} (수명: ${randomMinutes}분)`);

        this.lastAiCallTime = 0;
        this.lastMapCheckTime = Date.now();
        this.nextMercCheckTime = Date.now() + (Math.random() * 10000);
        this.lastRegenTime = Date.now();
        
        this.worldPlayers = [];
        this.worldMonsters = [];
        this.worldItems = [];
        this.worldMercs = [];
        this.chatHistory = [];
        this.combatMemory = "사냥 중";
        this.partyData = null; 
        this.followTarget = null;
        this.followDist = 60;

        this.connect();
    }

    connect() {
        this.socket = io(SERVER_URL, { reconnection: true, timeout: 10000 });

        this.socket.on('connect', () => {
            this.socket.emit('player_join', {
                id: this.dbRow.id,
                name: this.charData.name,
                charClass: this.charData.charClass,
                x: this.charData.x || 2000,
                y: this.charData.y || 2000,
                map: this.charData.map || 'talking_island'
            });
            this.startLoop();
        });

        this.socket.on('sync_map_state', (payload = {}) => {
            this.worldMonsters = payload.monsters || [];
            this.worldItems = payload.items || [];
        });

        this.socket.on('sync_entities', (payload = {}) => {
            this.worldPlayers = payload.players || [];
            this.worldMonsters = payload.monsters || [];
            this.worldMercs = payload.mercs || [];
        });

        this.socket.on('disconnect', () => {
            this.stopLoop();
        });
    }

    startLoop() {
        if (this.loopTimer) clearInterval(this.loopTimer);

        this.loopTimer = setInterval(() => {
            if (Date.now() - this.sessionStart >= this.sessionDuration) {
                console.log(`[🤖 에이전트 퇴장] ${this.charData.name}님이 활동 시간을 채워 교체됩니다.`);
                this.gracefulLogout(); 
                return;
            }

            let now = Date.now();
            if (now - this.lastRegenTime >= 2000) {
                this.lastRegenTime = now;
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 5);
                this.charData.mp = Math.min(this.charData.maxMp, this.charData.mp + 3);
            }

            SharedAI.processRoutine(this.charData, {
                now: now,
                state: this.state,
                currentMap: this.charData.map || 'talking_island',
                entities: [...this.worldPlayers, ...this.worldMonsters, ...this.worldMercs],
                items: this.worldItems,
                mapSize: 4000,
                atkDelay: 900,
                damageEntity: (target, dmg, attacker, type) => {
                    if (target && target.id) {
                        this.socket.emit('attack_monster', { targetId: target.id, calculatedDmg: dmg, attackType: type });
                    }
                },
                lootItem: (item) => {
                    this.socket.emit('player_loot_item', { itemId: item.id });
                },
                isInSafeZone: (mapId, x, y) => false
            });

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

    stopLoop() {
        if (this.loopTimer) {
            clearInterval(this.loopTimer);
            this.loopTimer = null;
        }
    }

    gracefulLogout() {
        this.stopLoop();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

async function manageAgentRotation() {
    try {
        activeAgents = activeAgents.filter(agent => agent.socket && agent.socket.connected);

        if (activeAgents.length < MAX_CONCURRENT) {
            let needed = MAX_CONCURRENT - activeAgents.length;
            
            const { data: aiChars } = await supabase.from('characters').select('*').gte('slot_index', 100);
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
    setInterval(manageAgentRotation, 5000);
    manageAgentRotation();
    console.log('🚀 [외부 AI Agent Runner 가동 완료 - 독립 개별 로테이션 시스템]');
}

startRunner();
