// aiAgentRunner.js
const io = require('socket.io-client');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 프로젝트 공용 Supabase 정보 및 발급받은 Gemini 키 설정
const SUPABASE_URL = 'https://vnagjrhnvtngsomxwair.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fo-6ibZ51qwEpX7XYsLyRw_BprsNvR5';
const GEMINI_API_KEY = 'AIzaSyBmjCuUpWfsJ8cwpKjFwkisirox5LpmlPc'; // 발급받은 Gemini 키 입력
const SERVER_URL = 'http://localhost:3000';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

let activeAgents = []; 
const MAX_CONCURRENT = 3;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

class AIAgentClient {
    constructor(dbRow) {
        this.dbRow = dbRow;
        this.charData = dbRow.data.player;
        this.socket = null;
        this.state = 'HUNTING';
        this.sessionStart = Date.now();
        this.lastAiCallTime = 0;
        this.connect();
    }

    connect() {
        this.socket = io(SERVER_URL, {
            transports: ['websocket'],
            upgrade: false
        });

        this.socket.on('connect', () => {
            console.log(`[🤖 AI 로그인] ${this.charData.name} (Lv.${this.charData.level} ${this.charData.charClass}) 접속 성공`);
            
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

        this.socket.on('chat_broadcast', async (data) => {
            let isTargetMe = data.message.includes(this.charData.name) || data.isWhisper;
            if (isTargetMe && data.senderId !== this.socket.id) {
                await this.handleChatMessage(data.name, data.message, data.isWhisper);
            }
        });
    }

    startLoop() {
        this.loopTimer = setInterval(() => {
            if (Date.now() - this.sessionStart >= THREE_HOURS_MS) {
                this.logout();
                return;
            }

            if (this.state === 'HUNTING') this.routineHunting();
            else if (this.state === 'SHOPPING') this.routineShopping();

            this.socket.emit('player_update', {
                name: this.charData.name,
                charClass: this.charData.charClass,
                x: this.charData.x,
                y: this.charData.y,
                hp: this.charData.hp,
                maxHp: this.charData.maxHp,
                atk: this.charData.atk,
                def: this.charData.def,
                level: this.charData.level,
                map: this.charData.map,
                equip: this.charData.equip,
                isMoving: true
            });
        }, 1000);
    }

    routineHunting() {
        let potionCount = this.getPotionCount();
        if (potionCount < 5 || this.charData.hp < this.charData.maxHp * 0.25) {
            this.state = 'SHOPPING';
            this.charData.map = 'silver_knight_town';
            this.charData.x = 2000;
            this.charData.y = 2000;
            return;
        }

        this.charData.x += (Math.random() - 0.5) * 60;
        this.charData.y += (Math.random() - 0.5) * 60;
        this.charData.x = Math.max(200, Math.min(3800, this.charData.x));
        this.charData.y = Math.max(200, Math.min(3800, this.charData.y));

        this.checkAutoEquip();
    }

    routineShopping() {
        if (this.charData.adena >= 10000) {
            this.charData.adena -= 7200;
            let potion = this.charData.inv.find(i => i.name === '주홍 물약');
            if (potion) potion.count = (potion.count || 0) + 100;
            else this.charData.inv.push({ name: '주홍 물약', type: 'potion', count: 100, heal: 60 });
        }

        this.checkAutoEnchant();

        setTimeout(() => {
            this.charData.map = 'talking_island';
            this.charData.x = 2000;
            this.charData.y = 2000;
            this.charData.hp = this.charData.maxHp;
            this.state = 'HUNTING';
        }, 5000);
    }

    getPotionCount() {
        let pot = this.charData.inv.find(i => i.type === 'potion');
        return pot ? pot.count || 0 : 0;
    }

    checkAutoEquip() {
        let curWeapon = this.charData.equip.weapon;
        let curAtk = curWeapon ? curWeapon.atk || 0 : 0;
        let betterWeaponIdx = this.charData.inv.findIndex(i => i.type === 'weapon' && (i.atk || 0) > curAtk);
        if (betterWeaponIdx > -1) {
            let newWp = this.charData.inv.splice(betterWeaponIdx, 1)[0];
            if (curWeapon) this.charData.inv.push(curWeapon);
            this.charData.equip.weapon = newWp;
        }
    }

    checkAutoEnchant() {
        let wp = this.charData.equip.weapon;
        if (wp && (wp.enchantValue || 0) < 6 && this.charData.adena >= 50000) {
            this.charData.adena -= 12600;
            wp.enchantValue = (wp.enchantValue || 0) + 1;
        }
    }

    async handleChatMessage(senderName, userMessage, isWhisper) {
        let now = Date.now();
        if (now - this.lastAiCallTime < 5000) return;
        this.lastAiCallTime = now;

        try {
            const prompt = `당신은 리니지 게임을 즐기는 유저 '${this.charData.name}'입니다. 직업: ${this.charData.charClass}, 레벨: ${this.charData.level}. ${senderName}님이 당신에게 "${userMessage}"라고 말했습니다. 게임 유저처럼 친근하게 1문장으로 대답하세요.`;
            const result = await aiModel.generateContent(prompt);
            let replyText = result.response.text().trim();

            if (isWhisper) {
                this.socket.emit('cmd_whisper', { targetName: senderName, content: replyText });
            } else {
                this.socket.emit('chat_message', { message: replyText, chatType: 'normal' });
            }
        } catch (e) {
            console.error('[-] Gemini 대화 생성 오류:', e.message);
        }
    }

    async logout() {
        clearInterval(this.loopTimer);
        await supabase.from('characters').update({
            data: { player: this.charData, last_sync_time: Date.now() }
        }).eq('id', this.dbRow.id);

        this.socket.disconnect();
        activeAgents = activeAgents.filter(a => a !== this);
    }
}

async function manageAgentRotation() {
    if (activeAgents.length < MAX_CONCURRENT) {
        let needed = MAX_CONCURRENT - activeAgents.length;
        const { data: aiChars, error } = await supabase
            .from('characters')
            .select('*')
            .like('name', '모험가%')
            .limit(42);

        if (error || !aiChars) return;

        let offlineList = aiChars.filter(dbChar => !activeAgents.some(a => a.charData.name === dbChar.name));
        for (let i = 0; i < needed && offlineList.length > 0; i++) {
            let picked = offlineList.splice(Math.floor(Math.random() * offlineList.length), 1)[0];
            activeAgents.push(new AIAgentClient(picked));
        }
    }
}

setInterval(manageAgentRotation, 30000);
manageAgentRotation();
console.log('🚀 [AI Agent Runner 데몬 가동 완료]');