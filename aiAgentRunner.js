// aiAgentRunner.js
const io = require('socket.io-client');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SUPABASE_URL = 'https://vnagjrhnvtngsomxwair.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fo-6ibZ51qwEpX7XYsLyRw_BprsNvR5';
const GEMINI_API_KEY = 'AIzaSyBmjCuUpWfsJ8cwpKjFwkisirox5LpmlPc';
const SERVER_URL = 'http://localhost:3000';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

let activeAgents = []; 
const MAX_CONCURRENT = 4;

const MAP_KEYWORD_MAP = {
    '본던': 'gludio_dungeon_1f', '글루디오': 'gludio_dungeon_1f', '글던': 'gludio_dungeon_1f',
    '말섬': 'talking_island', '말하는섬': 'talking_island',
    '용계': 'dragon_valley', '용의계곡': 'dragon_valley',
    '기란': 'giran_dungeon_1f', '기던': 'giran_dungeon_1f',
    '오렌': 'oren_snow_mountain', '화둥': 'fire_dragon_nest', '사막': 'windawood_desert', '은기사': 'silver_knight_town'
};

class AIAgentClient {
    constructor(dbRow) {
        this.dbRow = dbRow;
        this.charData = dbRow.data.player || dbRow.data;
        this.socket = null;
        this.state = 'HUNTING'; 
        this.sessionStart = Date.now();
        this.sessionDuration = (Math.floor(Math.random() * 120) + 60) * 60 * 1000; // 1~3시간
        
        this.lastAiCallTime = 0;
        this.lastAttackTime = 0;
        this.lastPotionTime = 0;
        this.lastPartyCheckTime = 0;
        this.lastLootTime = 0;
        this.lastBuffTime = 0;

        this.followTargetName = null;
        this.currentParty = null;
        this.worldPlayers = [];
        this.worldMonsters = [];
        this.worldItems = [];
        this.isLoggingOut = false;

        this.connect();
    }

    connect() {
        this.socket = io(SERVER_URL, { transports: ['websocket'], upgrade: false });
        this.socket.on('connect', () => {
            console.log(`[🤖 AI 접속] ${this.charData.name} (Lv.${this.charData.level} ${this.charData.charClass})`);
            this.socket.emit('player_join', {
                id: this.dbRow.id, name: this.charData.name, charClass: this.charData.charClass,
                x: this.charData.x || 2000, y: this.charData.y || 2000, map: this.charData.map || 'talking_island'
            });
            this.setupListeners();
            this.startLoop();
        });
    }

    setupListeners() {
        this.socket.on('sync_map_state', (data) => {
            this.worldMonsters = data.monsters || [];
            this.worldItems = data.items || [];
        });

        this.socket.on('sync_entities', (data) => {
            this.worldPlayers = data.players || [];
            if (data.monsters) this.worldMonsters = data.monsters;
        });

        this.socket.on('item_spawned', (data) => this.worldItems.push(data.item));
        this.socket.on('item_removed', (data) => {
            this.worldItems = this.worldItems.filter(it => it.id !== data.itemId);
        });

        this.socket.on('take_damage', (data) => {
            this.charData.hp = Math.max(0, this.charData.hp - (data.damage || 10));
            this.checkDrinkPotion();
        });

        this.socket.on('item_looted_success', (data) => {
            let item = data.item;
            if (item.type === 'currency' && item.name === '아데나') {
                this.charData.adena = (this.charData.adena || 0) + item.count;
            } else {
                this.charData.inv.push(item);
            }
        });

        this.socket.on('party_invite_received', (data) => {
            setTimeout(() => {
                if (!this.charData.partyId) {
                    this.socket.emit('party_accept', { inviterSocketId: data.inviterSocketId });
                    this.state = 'FOLLOWING_LEADER';
                    this.followTargetName = data.inviterName;
                    this.socket.emit('chat_message', { message: `${data.inviterName}님 파티 감사합니다! 제가 뒤따라갈게요~`, chatType: 'party' });
                }
            }, 1500);
        });

        this.socket.on('party_update', (data) => {
            this.charData.partyId = data.party ? data.party.id : null;
            this.currentParty = data.party;
            if (!this.currentParty) this.state = 'HUNTING';
        });

        this.socket.on('party_target_shared', (data) => {
            if (data.targetId && this.worldMonsters) {
                let mob = this.worldMonsters.find(m => m.id === data.targetId);
                if (mob) this.attackTarget(mob);
            }
        });

        this.socket.on('chat_broadcast', async (data) => {
            if (data.socketId === this.socket.id || data.senderId === this.socket.id) return;
            let msg = data.message || '';
            let isTargetMe = msg.includes(this.charData.name) || data.isWhisper;
            
            if (!isTargetMe && msg.includes('파티 하실분') && !this.charData.partyId && Math.random() < 0.4) {
                isTargetMe = true; 
            }

            if (isTargetMe) {
                await this.handleChatMessage(data.name, msg, data.isWhisper, data.socketId);
            }
        });
    }

    startLoop() {
        this.loopTimer = setInterval(() => {
            let elapsed = Date.now() - this.sessionStart;
            if (elapsed >= this.sessionDuration && !this.isLoggingOut) {
                this.handleGracefulLogout();
                return;
            }

            if (this.state === 'HUNTING') this.routineHunting();
            else if (this.state === 'FOLLOWING_LEADER') this.routineFollowLeader();
            else if (this.state === 'SHOPPING') this.routineShopping();

            this.checkDrinkPotion();
            this.checkAutoEquip();
            this.checkAutoBuffs(); 
            this.checkAIPartyNetworking();

            this.socket.emit('player_update', {
                name: this.charData.name, charClass: this.charData.charClass,
                x: Math.round(this.charData.x), y: Math.round(this.charData.y),
                hp: this.charData.hp, maxHp: this.charData.maxHp,
                atk: this.charData.atk, def: this.charData.def,
                level: this.charData.level, map: this.charData.map,
                equip: this.charData.equip, isMoving: true
            });
        }, 500); 
    }

    // 🛡️ 직업별 고유 스킬 및 자가 버프 사용 (4초 쿨타임)
    checkAutoBuffs() {
        let now = Date.now();
        if (now - this.lastBuffTime < 4000) return;
        if (!this.charData.magic || this.charData.magic.length === 0) return;

        let cClass = this.charData.charClass;
        let hpRatio = this.charData.hp / this.charData.maxHp;
        let mpRatio = (this.charData.mp || 0) / (this.charData.maxMp || 50);
        let usedSkill = null;

        if (cClass === 'elf') {
            if (this.charData.magic.includes('블러드 투 소울') && mpRatio < 0.4 && hpRatio > 0.6) {
                usedSkill = '블러드 투 소울';
                this.charData.hp -= 40;
                this.charData.mp = Math.min(this.charData.maxMp, (this.charData.mp || 0) + 15);
            } else if (this.charData.magic.includes('네이쳐스 터치') && hpRatio < 0.5 && this.charData.mp >= 30) {
                usedSkill = '네이쳐스 터치';
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 80);
                this.charData.mp -= 30;
            } else if (this.charData.magic.includes('스톰 샷') && Math.random() < 0.1) {
                usedSkill = '스톰 샷';
            }
        } 
        else if (cClass === 'knight' || cClass === 'royal') {
            if (this.charData.magic.includes('카운터 바리어') && hpRatio < 0.6 && Math.random() < 0.3) {
                usedSkill = '카운터 바리어';
            } else if (this.charData.magic.includes('리덕션 아머') && hpRatio < 0.8 && Math.random() < 0.2) {
                usedSkill = '리덕션 아머';
            }
        }

        if (usedSkill) {
            this.lastBuffTime = now;
            this.socket.emit('player_magic_action', { 
                magicName: usedSkill, casterId: this.socket.id, targetId: this.socket.id, 
                casterX: this.charData.x, casterY: this.charData.y
            });
        }
    }

    // 📖 레벨업 시 상위 마법 자율 학습
    checkAutoLearnMagic() {
        this.charData.magic = this.charData.magic || [];
        let lv = this.charData.level || 1;
        let cClass = this.charData.charClass;
        let newSpells = [];

        if (cClass === 'wizard') {
            if (lv >= 15) newSpells.push('이럽션', '선버스트');
            if (lv >= 30) newSpells.push('그레이트 힐', '토네이도');
            if (lv >= 45) newSpells.push('블리자드', '미티어 스트라이크');
            if (lv >= 50) newSpells.push('디스인티그레이트', '앱솔루트 배리어');
        } else if (cClass === 'elf') {
            if (lv >= 15) newSpells.push('블러드 투 소울');
            if (lv >= 30) newSpells.push('트리플 애로우', '네이쳐스 터치');
            if (lv >= 45) newSpells.push('스톰 샷', '워터 라이프');
        } else if (cClass === 'knight' || cClass === 'royal') {
            if (lv >= 30) newSpells.push('쇼크 스턴');
            if (lv >= 45) newSpells.push('리덕션 아머', '바운스 어택');
            if (lv >= 50) newSpells.push('카운터 바리어');
        }

        newSpells.forEach(spell => {
            if (!this.charData.magic.includes(spell)) {
                this.charData.magic.push(spell);
                this.socket.emit('chat_message', { message: `드디어 ${spell} 배웠다! 테스트 하러 가야지~`, chatType: 'normal' });
                console.log(`[🤖 ${this.charData.name}] 상위 스킬 습득: ${spell}`);
            }
        });
    }

    attackTarget(mob) {
        let now = Date.now();
        let atkDelay = this.charData.charClass === 'knight' ? 700 : 900;
        if (now - this.lastAttackTime < atkDelay) return;
        this.lastAttackTime = now;

        let dist = Math.hypot(mob.x - this.charData.x, mob.y - this.charData.y);
        let isRanged = this.charData.charClass === 'wizard' || this.charData.charClass === 'elf';
        let maxRange = isRanged ? 280 : 65;

        // 카이팅 (원거리 무빙)
        if (dist > maxRange) {
            let angle = Math.atan2(mob.y - this.charData.y, mob.x - this.charData.x);
            this.charData.x += Math.cos(angle) * 45;
            this.charData.y += Math.sin(angle) * 45;
            return;
        } else if (isRanged && dist < 120 && !mob.isBoss) {
            let fleeAngle = Math.atan2(this.charData.y - mob.y, this.charData.x - mob.x);
            this.charData.x += Math.cos(fleeAngle) * 50;
            this.charData.y += Math.sin(fleeAngle) * 50;
        }

        // 직업별 공격 스킬 및 데미지 산정
        let attackType = 'physical';
        let spellName = null;
        let finalDmg = this.charData.atk || 25;

        if (this.charData.charClass === 'wizard') {
            attackType = 'magic';
            let mpRatio = (this.charData.mp || 50) / (this.charData.maxMp || 50);
            
            if (this.charData.hp < this.charData.maxHp * 0.4 && mpRatio > 0.2) {
                spellName = '그레이트 힐';
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + 120);
            } else if (mob.isBoss) {
                spellName = this.charData.magic.includes('디스인티그레이트') ? '디스인티그레이트' : '이럽션'; 
                finalDmg = spellName === '디스인티그레이트' ? 350 : 150;
            } else {
                let nearby = this.worldMonsters.filter(m => Math.hypot(m.x - mob.x, m.y - mob.y) < 150).length;
                if (nearby >= 3 && this.charData.magic.includes('파이어볼')) { spellName = '파이어볼'; finalDmg = 120; }
                else { spellName = '에너지 볼트'; finalDmg = 80; }
            }
        } else if (this.charData.charClass === 'elf') {
            if (this.charData.magic.includes('트리플 애로우') && Math.random() < 0.2) { spellName = '트리플 애로우'; finalDmg *= 2.5; }
        } else if (this.charData.charClass === 'knight') {
            if (this.charData.magic.includes('쇼크 스턴') && mob.maxHp > 200 && Math.random() < 0.15) { spellName = '쇼크 스턴'; finalDmg *= 1.5; }
        }

        this.socket.emit('player_attack_request', {
            targetId: mob.id, attackerId: this.socket.id,
            attackType: attackType, calculatedDmg: Math.floor(finalDmg), magicName: spellName
        });
    }

    routineHunting() {
        let now = Date.now();
        if (now - this.lastLootTime > 500 && this.worldItems && this.worldItems.length > 0) {
            let nearbyItem = this.worldItems.find(it => Math.hypot(it.x - this.charData.x, it.y - this.charData.y) < 250);
            if (nearbyItem) {
                if (Math.hypot(nearbyItem.x - this.charData.x, nearbyItem.y - this.charData.y) <= 35) {
                    this.lastLootTime = now;
                    this.socket.emit('player_loot_item', { itemId: nearbyItem.id });
                } else {
                    let angle = Math.atan2(nearbyItem.y - this.charData.y, nearbyItem.x - this.charData.x);
                    this.charData.x += Math.cos(angle) * 40;
                    this.charData.y += Math.sin(angle) * 40;
                }
                return;
            }
        }

        let potCount = this.getPotionCount();
        if (potCount < 5 || this.charData.hp < this.charData.maxHp * 0.2) {
            this.state = 'SHOPPING';
            this.teleport('silver_knight_town', 2000, 2000);
            return;
        }

        if (this.worldMonsters && this.worldMonsters.length > 0) {
            let nearestMob = this.worldMonsters.filter(m => m.hp > 0).sort((a, b) => 
                Math.hypot(a.x - this.charData.x, a.y - this.charData.y) - Math.hypot(b.x - this.charData.x, b.y - this.charData.y)
            )[0];

            if (nearestMob) {
                this.attackTarget(nearestMob);
                return;
            }
        }

        this.charData.x += (Math.random() - 0.5) * 50;
        this.charData.y += (Math.random() - 0.5) * 50;
        this.charData.x = Math.max(200, Math.min(3800, this.charData.x));
    }

    routineFollowLeader() {
        if (!this.worldPlayers) return;
        let leader = this.worldPlayers.find(p => p.name === this.followTargetName);

        if (leader) {
            if (leader.map && leader.map !== this.charData.map) {
                this.teleport(leader.map, leader.x, leader.y);
                return;
            }

            let dist = Math.hypot(leader.x - this.charData.x, leader.y - this.charData.y);
            if (dist > 90) {
                let angle = Math.atan2(leader.y - this.charData.y, leader.x - this.charData.x);
                this.charData.x += Math.cos(angle) * 45;
                this.charData.y += Math.sin(angle) * 45;
            }

            if (leader.targetId && this.worldMonsters) {
                let mob = this.worldMonsters.find(m => m.id === leader.targetId);
                if (mob && mob.hp > 0) this.attackTarget(mob);
            }
        } else {
            this.state = 'HUNTING';
        }
    }

    routineShopping() {
        let sellEarned = 0;
        for (let i = this.charData.inv.length - 1; i >= 0; i--) {
            let it = this.charData.inv[i];
            if (it.type !== 'potion' && it.type !== 'scroll') {
                let price = it.price || ((it.grade || 1) * 250);
                sellEarned += price;
                this.charData.inv.splice(i, 1);
            }
        }
        if (sellEarned > 0) this.charData.adena += sellEarned;

        if (this.charData.adena >= 10000) {
            this.charData.adena -= 7200;
            let potion = this.charData.inv.find(i => i.name === '주홍 물약');
            if (potion) potion.count = (potion.count || 0) + 150;
            else this.charData.inv.push({ name: '주홍 물약', type: 'potion', count: 150, heal: 60 });
        }

        // 💡 자율 스킬 학습
        this.checkAutoLearnMagic();

        setTimeout(() => {
            this.charData.hp = this.charData.maxHp;
            this.state = 'HUNTING';
            let maps = ['talking_island', 'gludio_dungeon_1f', 'dragon_valley'];
            this.teleport(maps[Math.floor(Math.random() * maps.length)], 2000, 2000);
        }, 4000);
    }

    async handleChatMessage(senderName, userMessage, isWhisper, senderSocketId) {
        let now = Date.now();
        if (now - this.lastAiCallTime < 3000) return;
        this.lastAiCallTime = now;

        try {
            const prompt = `당신은 MMORPG 리니지를 즐기는 유저 '${this.charData.name}'(Lv.${this.charData.level} ${this.charData.charClass})입니다.
상대 '${senderName}'님이 "${userMessage}"라고 말했습니다. 친근한 게임 말투로 답장하고, 게임에서 취할 행동을 아래 JSON 형식으로만 답하세요.

JSON 형식:
{
  "reply": "친근한 1문장 대답",
  "targetMap": "본던" | "말섬" | "기란" | "용계" | "사막" | "NONE",
  "action": "FOLLOW" | "PARTY_INVITE" | "SHOPPING" | "NONE"
}`;

            const result = await aiModel.generateContent(prompt);
            let parsed = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());

            setTimeout(() => {
                if (isWhisper) this.socket.emit('cmd_whisper', { targetName: senderName, content: parsed.reply });
                else this.socket.emit('chat_message', { message: parsed.reply, chatType: 'normal' });
            }, 1200);

            if (parsed.action === 'PARTY_INVITE') {
                this.socket.emit('party_invite', { targetSocketId: senderSocketId, targetName: senderName });
            } else if (parsed.action === 'FOLLOW') {
                this.state = 'FOLLOWING_LEADER';
                this.followTargetName = senderName;
            } else if (parsed.action === 'SHOPPING') {
                this.state = 'SHOPPING';
            }

            let mapCode = MAP_KEYWORD_MAP[parsed.targetMap];
            if (mapCode) {
                this.state = 'FOLLOWING_LEADER';
                this.followTargetName = senderName;
                this.teleport(mapCode, 2000, 2000);
            }
        } catch (e) { console.error('[-] AI 파싱 오류:', e.message); }
    }

    checkAIPartyNetworking() {
        let now = Date.now();
        if (now - this.lastPartyCheckTime < 60000) return;
        this.lastPartyCheckTime = now;

        if (!this.charData.partyId && Math.random() < 0.2 && this.worldPlayers) {
            let nearbyUser = this.worldPlayers.find(p => Math.hypot(p.x - this.charData.x, p.y - this.charData.y) < 300 && p.name !== this.charData.name);
            if (nearbyUser) {
                this.socket.emit('chat_message', { message: `${nearbyUser.name}님 같이 사냥해요! 파티 팟팟!`, chatType: 'normal' });
                this.socket.emit('party_invite', { targetSocketId: nearbyUser.socketId, targetName: nearbyUser.name });
            }
        }
    }

    checkDrinkPotion() {
        if (this.charData.hp < this.charData.maxHp * 0.75) {
            let pot = this.charData.inv.find(i => i.type === 'potion');
            if (pot && pot.count > 0) {
                pot.count--;
                this.charData.hp = Math.min(this.charData.maxHp, this.charData.hp + (pot.heal || 60));
                this.socket.emit('player_use_potion', { potionName: pot.name });
            }
        }
    }

    checkAutoEquip() {
        if (!this.charData.inv || this.charData.inv.length === 0) return;
        this.charData.equip = this.charData.equip || {};
        let curWp = this.charData.equip.weapon;
        let curAtk = curWp ? ((curWp.atk || 0) + (curWp.enchantValue || 0)) : 0;
        let betterWpIdx = this.charData.inv.findIndex(it => it.type === 'weapon' && ((it.atk || 0) + (it.enchantValue || 0)) > curAtk);

        if (betterWpIdx > -1) {
            let newWp = this.charData.inv.splice(betterWpIdx, 1)[0];
            if (curWp) this.charData.inv.push(curWp);
            this.charData.equip.weapon = newWp;
        }
    }

    getPotionCount() {
        let pot = this.charData.inv.find(i => i.type === 'potion');
        return pot ? pot.count || 0 : 0;
    }

    teleport(mapCode, x = 2000, y = 2000) {
        this.charData.map = mapCode;
        this.charData.x = x; this.charData.y = y;
        this.socket.emit('player_update', { map: mapCode, x: x, y: y });
    }

    async handleGracefulLogout() {
        this.isLoggingOut = true;
        if (this.charData.partyId) {
            let msgs = ["저 밥먹으러 가봐야 해서 여기까지 할게요! 수고하셨습니다~", "내일 출근이라 먼저 가볼게요! 득템하세요~"];
            this.socket.emit('chat_message', { message: msgs[Math.floor(Math.random()*msgs.length)], chatType: 'party' });
            setTimeout(() => {
                this.socket.emit('party_leave');
                this.teleport('silver_knight_town', 2000, 2000);
                this.logout();
            }, 3000);
        } else {
            this.logout();
        }
    }

    async logout() {
        clearInterval(this.loopTimer);
        await supabase.from('characters').update({ data: { player: this.charData, last_sync_time: Date.now() } }).eq('id', this.dbRow.id);
        this.socket.disconnect();
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

setInterval(manageAgentRotation, 15000);
manageAgentRotation();
console.log('🚀 [초지능형 AI Agent Runner 가동 완료 - 완벽한 인간형 플레이어]');