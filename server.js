// server.js (최종 통합 버전)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const data = require('./public/js/data.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const players = {};    
const parties = {};    
const mapsState = {};   
const raidRooms = {}; 

// 1. 맵 상태 및 보스 초기화
for (let mapId in data.maps) {
    mapsState[mapId] = { monsters: [], items: [], deadBosses: [] };
    let mData = data.maps[mapId];
    if (mData.b) {
        mData.b.forEach(b => {
            let bt = data.templates.bosses[b.id];
            if (bt) {
                mapsState[mapId].monsters.push({
                    ...bt, 
                    id: 'boss_' + b.id + '_' + Date.now(),
                    baseBossId: b.id, spawnX: b.x, spawnY: b.y, 
                    maxHp: bt.hp, hp: bt.hp, x: b.x, y: b.y, map: mapId,
                    isBoss: true, targetId: null, lastAttackTime: 0
                });
            }
        });
    }
}

// ==========================================
// [보스 전용 구간 판정 및 동적 승급 드롭 시스템]
// ==========================================
function rollBossItemGrade(monster) {
    let targetHp = monster.maxHp || 1000;
    
    if (monster.map === 'boss_raid' && data.templates && data.templates.bosses) {
        let bossList = Object.values(data.templates.bosses);
        if (bossList.length > 0) {
            let closestBoss = bossList.reduce((prev, curr) => {
                return Math.abs(curr.hp - targetHp) < Math.abs(prev.hp - targetHp) ? curr : prev;
            });
            targetHp = closestBoss.hp;
        }
    }

    let rates = { transcend: 0.5, legend1: 1.5, legend: 2.5 }; 

    if (monster.level >= 100 || targetHp >= 3400000 || (monster.map && ['fire_dragon_nest', 'lastebad', 'tower_of_dominance'].includes(monster.map))) {
        rates = { transcend: 10.0, legend1: 10.0, legend: 1.0 }; 
    } 
    else if (targetHp >= 1500000 || (monster.map && monster.map.includes('tower_of_insolence'))) {
        rates = { transcend: 2.5, legend1: 5.0, legend: 10.0 };  
    } 
    else if (targetHp >= 680000 || (monster.map && monster.map.includes('dragon_valley'))) {
        rates = { transcend: 1.5, legend1: 2.5, legend: 10.0 };  
    } 
    else if (targetHp >= 200000) {
        rates = { transcend: 1.5, legend1: 2.5, legend: 5.0 };   
    }

    let roll = Math.random() * 100;

    if (roll < rates.transcend) return { grade: 6, gradeName: '초월' };
    if (roll < rates.transcend + rates.legend1) return { grade: 5, gradeName: '전설 I' };
    if (roll < rates.transcend + rates.legend1 + rates.legend) return { grade: 4, gradeName: '전설' };

    let subRoll = Math.random() * 100;
    if (subRoll < 15) return { grade: 3, gradeName: '영웅' };
    if (subRoll < 45) return { grade: 2, gradeName: '희귀' };
    if (subRoll < 75) return { grade: 1, gradeName: '고급' };
    return { grade: 0, gradeName: '일반' };
}

function applyTranscendOptions(item) {
    item.magicOptions = item.magicOptions || [];
    let t = item.type;
    let n = item.name || '';

    if (t === 'weapon') {
        if (item.isBow || n.includes('활') || n.includes('크로스보우')) {
            item.magicOptions.push('[초월] 원거리 대미지 +35', '[초월] DEX +12', '공격 시 10% 트리플 애로우');
        } else if (n.includes('지팡이')) {
            item.magicOptions.push('[초월] SP (마법공격력) +20', '[초월] INT +12', '공격 시 8% 디스인티그레이트');
        } else if (n.includes('단검')) {
            item.magicOptions.push('[초월] 치명타 대미지 +50%', '[초월] STR +10', '타격 시 HP/MP 동시 흡수');
        } else {
            item.magicOptions.push('[초월] 근거리 대미지 +40', '[초월] STR +12', '공격 시 10% 쇼크 스턴');
        }
    } else if (['armor', 'helmet', 'cloak', 'shield', 'gloves', 'boots', 'tshirt'].includes(t)) {
        item.magicOptions.push('[초월] 대미지 감소 +20', '[초월] 추가 방어력 +25', '[초월] 최대 HP +500');
    } else if (['ring', 'belt'].includes(t)) {
        item.magicOptions.push('[초월] 모든 스탯 +8', '[초월] HP 회복률 +25', '[초월] MP 회복률 +15');
    }
    item.magicOptions = [...new Set(item.magicOptions)];
    return item;
}

function generateServerDropItem(baseItem) {
    if (!baseItem) return null;
    let item = JSON.parse(JSON.stringify(baseItem)); 
    item.id = (item.name || 'item') + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    let isFantasyScroll = item.type === 'scroll' && (item.name.includes('환상') || item.enchantType === '환상');
    if (!item.type || item.type === 'potion' || item.type === 'book' || (item.type === 'scroll' && !isFantasyScroll)) {
        return item;
    }

    if (isFantasyScroll) {
        let elements = ['화령', '수령', '풍령', '지령'];
        let randomElement = elements[Math.floor(Math.random() * elements.length)];
        item.enchantElement = randomElement;
        if (!item.name.startsWith('[')) item.name = `[${randomElement}] ${item.name}`;
        return item;
    }

    item.magicOptions = item.magicOptions || [];
    let grade = item.grade || 0;

    if (grade >= 4) {
        let optCount = Math.floor(Math.random() * 4) + 2; 
        let legendaryPool = [
            () => { let v = Math.floor(Math.random() * 21) + 15; item.magicOptions.push(`[전설] 추가 대미지 +${v}`); },
            () => { let v = Math.floor(Math.random() * 16) + 15; item.magicOptions.push(`[전설] 추가 방어력 +${v}`); },
            () => { let v = Math.floor(Math.random() * 10) + 1; item.magicOptions.push(`[스탯] STR +${v}`); },
            () => { let v = Math.floor(Math.random() * 10) + 1; item.magicOptions.push(`[스탯] INT +${v}`); },
            () => { let v = Math.floor(Math.random() * 10) + 1; item.magicOptions.push(`[스탯] DEX +${v}`); },
            () => { let v = (Math.floor(Math.random() * 5) + 2) * 100; item.magicOptions.push(`[생명] 최대 HP +${v}`); },
            () => { item.magicOptions.push(`[${['화령','수령','풍령','지령'][Math.floor(Math.random()*4)]}] 속성 대미지 +${Math.floor(Math.random()*15)+10}`); },
            () => { item.magicOptions.push("타격 시 HP 흡수"); },
            () => { item.magicOptions.push("타격 시 MP 흡수"); }
        ];

        for (let i = 0; i < optCount; i++) {
            let pick = legendaryPool[Math.floor(Math.random() * legendaryPool.length)];
            pick();
        }
    } else if (grade >= 1) {
        let optCount = Math.floor(Math.random() * grade) + 1;
        let normalPool = [
            () => { let v = Math.floor(Math.random() * (grade * 4)) + 1; item.magicOptions.push(`[강화] 추가 대미지 +${v}`); },
            () => { let v = Math.floor(Math.random() * (grade * 3)) + 1; item.magicOptions.push(`[강화] 추가 방어력 +${v}`); },
            () => { let v = Math.floor(Math.random() * 3) + 1; item.magicOptions.push(`[스탯] STR +${v}`); },
            () => { let v = Math.floor(Math.random() * 3) + 1; item.magicOptions.push(`[스탯] INT +${v}`); },
            () => { item.magicOptions.push(`[${['화령','수령','풍령','지령'][Math.floor(Math.random()*4)]}] 속성 대미지 +${grade * 2}`); }
        ];

        for (let i = 0; i < optCount; i++) {
            let pick = normalPool[Math.floor(Math.random() * normalPool.length)];
            pick();
        }
    }

    item.magicOptions = [...new Set(item.magicOptions)]; 
    return item;
}

// 2. 소켓 통신 처리
io.on('connection', (socket) => {
    console.log(`[+] 유저 연결됨: ${socket.id}`);

    socket.on('player_loot_item', (payload = {}) => {
        let p = players[socket.id];
        if (!p || !mapsState[p.map]) return;
        
        let itemsArr = mapsState[p.map].items;
        let itemIdx = itemsArr.findIndex(it => it.id === payload.itemId);
        
        if (itemIdx > -1) {
            let lootedItem = itemsArr.splice(itemIdx, 1)[0];
            socket.emit('item_looted_success', { item: lootedItem });
            io.to(p.map).emit('item_removed', { itemId: payload.itemId });
        }
    });

    socket.on('player_join', (payload = {}) => {
        const { id, name, charClass, x, y, map } = payload;
        if (players[socket.id] && players[socket.id].map) { 
            socket.leave(players[socket.id].map); 
        }
        let currentMap = map || 'talking_island';
        players[socket.id] = { 
            socketId: socket.id, 
            userId: id || 'guest_' + socket.id, 
            name: name || '모험가', 
            charClass: charClass || 'knight', 
            x: x || 2000, 
            y: y || 2000, 
            map: currentMap, 
            hp: 150, 
            maxHp: 150, 
            mp: 30, 
            maxMp: 30, 
            targetId: null, 
            partyId: null, 
            equip: {},
            mercs: [],
            isMoving: false,
            angle: 0
        };
        socket.join(currentMap);
        socket.emit('sync_map_state', { 
            monsters: mapsState[currentMap].monsters, 
            items: mapsState[currentMap].items 
        });
    });

    socket.on('request_join_raid', (payload = {}) => {
        let p = players[socket.id];
        if (!p) return;

        let targetRoomId = null;
        for (let rId in raidRooms) {
            let room = raidRooms[rId];
            if (room.status === 'WAITING' && room.map === 'boss_raid') {
                targetRoomId = rId;
                break;
            }
        }

        let userCombatPower = payload.combatPower || (p.level * 300);

        if (!targetRoomId) {
            targetRoomId = 'raid_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            raidRooms[targetRoomId] = {
                roomId: targetRoomId,
                map: 'boss_raid',
                status: 'WAITING', 
                members: [],
                totalCombatPower: 0,
                tierIndex: payload.tierIndex || 0,
                currentWave: 1,
                maxWave: 2,
                bossSpawned: false,
                createdAt: Date.now()
            };
        }

        let currentRoom = raidRooms[targetRoomId];
        if (!currentRoom.members.includes(socket.id)) {
            currentRoom.members.push(socket.id);
            currentRoom.totalCombatPower += userCombatPower;
        }
        p.currentRaidRoomId = targetRoomId;

        socket.emit('raid_room_joined', {
            roomId: targetRoomId,
            status: currentRoom.status,
            memberCount: currentRoom.members.length
        });

        if (currentRoom.status === 'WAITING' && currentRoom.members.length === 1) {
            startRaidCountdown(targetRoomId);
        }
    });

    socket.on('spawn_raid_boss', (payload = {}) => {
        let mapId = payload.map || 'boss_raid';
        if (!mapsState[mapId]) {
            mapsState[mapId] = { monsters: [], items: [], deadBosses: [] };
        }

        let existingBoss = mapsState[mapId].monsters.find(m => m.isBoss);
        if (existingBoss) return;

        let userRaidRoom = Object.values(raidRooms).find(room => room.members.includes(socket.id));
        let partyCombatPower = userRaidRoom ? userRaidRoom.totalCombatPower : (payload.combatPower || 15000);
        let playerCount = userRaidRoom ? Math.max(1, userRaidRoom.members.length) : 1;

        let baseBossHp = Math.floor(partyCombatPower * 10); 
        let baseBossDef = Math.floor(30 + (partyCombatPower / 300));
        let baseBossAtk = Math.floor(50 + (partyCombatPower / 200));

        let baseBosses = Object.values(data.templates.bosses).map(b => b.name);
        let selectedBoss = baseBosses[Math.floor(Math.random() * baseBosses.length)];
        let tierTitles = ["", "[정예]", "[악몽]", "[지옥]", "[불지옥]"];

        let raidBoss = {
            id: payload.id || ('raid_boss_' + Date.now()),
            name: `${tierTitles[payload.tierIndex || 0]} ${selectedBoss} (1/2)`,
            isBoss: true,
            x: 2000, 
            y: 800,
            map: mapId,
            size: 30 + ((payload.tierIndex || 0) * 3),
            hp: baseBossHp,
            maxHp: baseBossHp,
            atk: baseBossAtk,
            def: baseBossDef,
            exp: 30000 * playerCount,
            color: '#ff3333',
            targetId: null,
            angle: 0,
            isMoving: false,
            raidTier: payload.tierIndex || 0 
        };
        
        mapsState[mapId].monsters.push(raidBoss);
    });

    socket.on('player_drop_item', (droppedItemData = {}) => {
        let p = players[socket.id];
        let mapId = (p && p.map) ? p.map : (droppedItemData.map || 'talking_island');
        
        if (!mapsState[mapId]) {
            mapsState[mapId] = { monsters: [], items: [], deadBosses: [] };
        }

        let floorItem = {
            ...droppedItemData,
            id: droppedItemData.id || ('drop_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
            map: mapId,
            spawnTime: Date.now(),
            dropperId: socket.id
        };

        mapsState[mapId].items.push(floorItem);
        socket.to(mapId).emit('item_spawned', { item: floorItem });
    });

    socket.on('player_update', (payload = {}) => {
        let p = players[socket.id];
        let currentMap = payload.map || 'talking_island';
        
        if (!p) {
            players[socket.id] = { 
                socketId: socket.id, 
                userId: payload.userId || 'guest_' + socket.id, 
                name: payload.name || '모험가', 
                charClass: payload.charClass || 'knight', 
                x: payload.x || 2000, 
                y: payload.y || 2000, 
                map: currentMap, 
                hp: payload.hp || 150, 
                maxHp: payload.maxHp || 150, 
                atk: payload.atk || 20,
                def: payload.def || 0,
                str: payload.str || 18,
                dex: payload.dex || 14,
                int: payload.int || 8,
                level: payload.level || 1,
                targetId: null, 
                partyId: null, 
                equip: payload.equip || {},
                mercs: payload.mercs || [], 
                isMoving: payload.isMoving || false, 
                angle: payload.angle || 0
            };
            socket.join(currentMap);
            socket.emit('sync_map_state', { monsters: mapsState[currentMap].monsters, items: mapsState[currentMap].items });
            return;
        }

        if (p.map !== payload.map && payload.map) {
            let prevMap = p.map;
            socket.leave(prevMap); 
            socket.join(payload.map); 
            p.map = payload.map;

            if (prevMap === 'boss_raid') {
                let remainingPlayers = Object.values(players).filter(pl => pl.map === 'boss_raid' && pl.socketId !== socket.id);
                if (remainingPlayers.length === 0) {
                    mapsState['boss_raid'] = { monsters: [], items: [], deadBosses: [] };
                    for (let rId in raidRooms) {
                        if (raidRooms[rId].map === 'boss_raid') {
                            delete raidRooms[rId];
                        }
                    }
                    console.log("[🧹 레이드 초기화] 파티원 전원 퇴장으로 보스 맵 및 인스턴스 방이 초기화되었습니다.");
                }
            }

            socket.emit('sync_map_state', { monsters: mapsState[p.map].monsters, items: mapsState[p.map].items });
        }
        
        p.name = payload.name || p.name;
        p.charClass = payload.charClass || p.charClass;
        if (payload.x !== undefined) p.x = payload.x; 
        if (payload.y !== undefined) p.y = payload.y; 
        if (payload.hp !== undefined && payload.hp > p.hp) p.hp = payload.hp; 
        p.maxHp = payload.maxHp !== undefined ? payload.maxHp : p.maxHp;
        p.atk = payload.atk || p.atk || 20;
        p.def = payload.def || p.def || 0;
        p.str = payload.str || p.str || 18;
        p.dex = payload.dex || p.dex || 14;
        p.int = payload.int || p.int || 8;
        p.level = payload.level || p.level || 1;
        p.angle = payload.angle !== undefined ? payload.angle : (p.angle || 0);
        p.isMoving = payload.isMoving !== undefined ? payload.isMoving : (p.isMoving || false);
        p.equip = payload.equip || p.equip;
        
        if (payload.mercs && Array.isArray(payload.mercs) && payload.mercs.length > 0) {
            p.mercs = payload.mercs;
        }
    });

    socket.on('player_summon_monster', (payload = {}) => {
        let p = players[socket.id];
        if (!p) return;
        
        let pLevel = payload.level || p.level || 1;
        let maxSummons = Math.min(3, Math.max(1, Math.floor(pLevel / 15)));
        
        p.mercs = p.mercs || [];
        if (p.mercs.length >= maxSummons) {
            socket.emit('system_message', { 
                message: `[소환 실패] 현재 레벨(Lv.${pLevel})에서는 최대 ${maxSummons}마리까지만 소환할 수 있습니다.`, 
                color: '#f55' 
            });
            return;
        }

        let chosenType = p.charClass === 'wizard' ? 'wizard' : (p.charClass === 'elf' ? 'elf' : 'knight');

        let newSummon = {
            id: 'summon_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
            name: `소환된 정령(Lv.${pLevel})`,
            hp: 250 + (pLevel * 25),
            maxHp: 250 + (pLevel * 25),
            mp: 100 + (pLevel * 10),
            maxMp: 100 + (pLevel * 10),
            atk: 10 + Math.floor(pLevel * 1.5),
            def: 5 + Math.floor(pLevel * 0.8),
            level: pLevel,
            x: p.x + (Math.random() * 60 - 30),
            y: p.y + (Math.random() * 60 - 30),
            map: p.map,
            isMercenary: true,
            isSummon: true,
            mercType: chosenType,
            charClass: chosenType,
            ownerId: socket.id,
            ownerSocketId: socket.id,
            ownerName: p.name,
            isMoving: false,
            angle: 0,
            equip: { weapon: null, armor: null }
        };

        p.mercs.push(newSummon);

        socket.emit('system_message', { 
            message: `✨ [소환 성공] Lv.${pLevel} 정령을 소환했습니다. (소환수: ${p.mercs.length}/${maxSummons})`, 
            color: '#5ff' 
        });
    });

    socket.on('player_magic_action', (payload = {}) => {
        let p = players[socket.id];
        let mapId = (p && p.map) ? p.map : (payload.map || 'talking_island');
        
        io.to(mapId).emit('sync_player_magic', {
            casterId: payload.casterId || socket.id, 
            magicName: payload.magicName, 
            tier: payload.tier,
            fontSize: payload.fontSize,
            targetX: payload.targetX,
            targetY: payload.targetY,
            targetId: payload.targetId,
            casterX: payload.casterX !== undefined ? payload.casterX : (p ? p.x : 2000),
            casterY: payload.casterY !== undefined ? payload.casterY : (p ? p.y : 2000)
        });
    });

    socket.on('player_attack_action', (payload = {}) => {
        let p = players[socket.id];
        let mapId = (p && p.map) ? p.map : 'talking_island';
        socket.to(mapId).emit('sync_player_action', {
            socketId: payload.casterId || socket.id, 
            angle: payload.angle,
            targetId: payload.targetId,
            targetX: payload.targetX,
            targetY: payload.targetY,
            isBow: payload.isBow,
            actionType: payload.actionType 
        });
    });

    socket.on('player_target', (payload = {}) => {
        let p = players[socket.id];
        if (!p) return;

        if (p.targetId === payload.targetId) return;
        p.targetId = payload.targetId; 

        if (p.partyId && parties[p.partyId]) {
            let party = parties[p.partyId];
            if (party.leader === socket.id && party.mode === 'focus') {
                party.members.forEach(member => {
                    if (member.socketId !== socket.id) {
                        io.to(member.socketId).emit('party_target_shared', { targetId: payload.targetId });
                    }
                });
            }
        }
    });

    socket.on('player_use_potion', (payload = {}) => {
        let p = players[socket.id];
        if (p) {
            socket.to(p.map).emit('sync_player_potion', {
                socketId: socket.id,
                potionName: payload.potionName
            });
        }
    });

    // ==========================================
    // 💬 [채팅 라우팅 & 시스템/운영자 명령어 리스너]
    // ==========================================
    socket.on('chat_message', (payload = {}) => {
        let p = players[socket.id];
        let name = p ? p.name : (payload.name || '모험가');
        let chatType = payload.chatType || 'normal';

        if (chatType === 'party' && p && p.partyId && parties[p.partyId]) {
            parties[p.partyId].members.forEach(m => {
                io.to(m.socketId).emit('chat_broadcast', {
                    senderId: socket.id,
                    socketId: socket.id,
                    name: name,
                    message: payload.message,
                    chatType: 'party'
                });
            });
            return;
        }

        // 전체 유저에게 1회 전송 (클라이언트 로컬 출력 중복 제거 완료)
        io.emit('chat_broadcast', {
            senderId: socket.id,
            socketId: socket.id,
            name: name,
            message: payload.message,
            chatType: 'normal'
        });
    });
    socket.on('cmd_who', () => {
        let count = 0;
        let listText = "==== [현재 월드 접속자] ====\n";
        for (let sid in players) {
            let pl = players[sid];
            let cName = pl.charClass === 'knight' ? '기사' : (pl.charClass === 'wizard' ? '마법사' : '요정');
            let mData = data.maps[pl.map];
            let mapName = mData ? mData.name : pl.map;
            let isAi = pl.name.startsWith('모험가') ? '🤖' : '👤';

            listText += `${isAi} ${pl.name} [Lv.${pl.level || 1} ${cName}] - ${mapName}\n`;
            count++;
        }
        listText += `------------------------\n총 접속자 수: ${count}명`;
        socket.emit('system_message', { message: listText, color: '#38bdf8' });
    });

    socket.on('cmd_whisper', (payload = {}) => {
        let sender = players[socket.id];
        let senderName = sender ? sender.name : '모험가';
        let targetName = payload.targetName;
        let content = payload.content;

        let targetSocketId = Object.keys(players).find(sid => players[sid].name === targetName);

        if (targetSocketId) {
            io.to(targetSocketId).emit('chat_broadcast', {
                senderId: socket.id,
                socketId: socket.id,
                name: senderName,
                message: content,
                chatType: 'whisper',
                isWhisper: true
            });
        } else {
            socket.emit('system_message', {
                message: `[${targetName}]님은 현재 접속 중이지 않습니다.`,
                color: '#f87171'
            });
        }
    });

    socket.on('admin_notice', (payload = {}) => {
        io.emit('system_message', {
            message: `📢 [운영자 공지] ${payload.message}`,
            color: '#ef4444'
        });
    });

    socket.on('admin_spawn_mob', (payload = {}) => {
        let mapId = payload.map || 'talking_island';
        if (!mapsState[mapId]) return;

        let mobName = payload.mobName;
        let count = Math.min(20, Math.max(1, payload.count || 1));

        let template = Object.values(data.templates.bosses).find(b => b.name.includes(mobName)) ||
                       Object.values(data.templates.mobs).find(m => m.name.includes(mobName));

        if (!template) {
            socket.emit('system_message', { message: `[소환 실패] '${mobName}' 이름의 몬스터 템플릿이 없습니다.`, color: '#f55' });
            return;
        }

        for (let i = 0; i < count; i++) {
            let spawned = {
                ...template,
                id: 'admin_mob_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                x: payload.x + (Math.random() * 80 - 40),
                y: payload.y + (Math.random() * 80 - 40),
                maxHp: template.hp,
                hp: template.hp,
                map: mapId,
                targetId: null,
                lastAttackTime: 0,
                isBoss: Boolean(template.isBoss)
            };
            mapsState[mapId].monsters.push(spawned);
        }

        io.to(mapId).emit('system_message', {
            message: `⚠️ [운영자 소환] ${template.name} ${count}마리가 소환되었습니다!`,
            color: '#facc15'
        });
    });

    socket.on('admin_clear_floor', (payload = {}) => {
        let mapId = payload.map;
        if (mapsState[mapId]) {
            mapsState[mapId].items = [];
            io.to(mapId).emit('sync_map_state', {
                monsters: mapsState[mapId].monsters,
                items: []
            });
            socket.emit('system_message', { message: `[${mapId}] 맵 바닥의 모든 아이템을 청소했습니다.`, color: '#5f5' });
        }
    });

    const handlePlayerAttack = (payload = {}) => {
        let p = players[socket.id];
        if (!p || !mapsState[p.map]) return;
        
        let monster = mapsState[p.map].monsters.find(m => m.id === payload.targetId);
        if (!monster || monster.hp <= 0) return;

        let actualAttackerId = payload.attackerId || socket.id;

        io.to(p.map).emit('sync_player_action', {
            socketId: actualAttackerId, 
            angle: p.angle || 0,
            targetId: payload.targetId,
            targetX: monster.x,
            targetY: monster.y,
            actionType: 'slash'
        });

        let hitType = payload.attackType || 'physical';
        let spellName = payload.magicName;
        let finalDamage = 10;

        if (typeof payload.calculatedDmg === 'number' && payload.calculatedDmg > 0) {
            finalDamage = Math.max(1, payload.calculatedDmg - Math.floor((monster.def || 0) / 3));
        } else {
            let statAtk = Math.max(1, Math.floor((p.str - 10) * 3.2));
            let wpAtk = (p.equip && p.equip.weapon ? p.equip.weapon.atk || 0 : 0);
            finalDamage = Math.max(1, statAtk + wpAtk - Math.floor((monster.def || 0) / 3));
        }

        monster.hp -= finalDamage;
        
        if (spellName === '쇼크 스턴') {
            monster.stunnedUntil = Date.now() + 2500;
        }

        monster.damageMap = monster.damageMap || {};
        monster.damageMap[actualAttackerId] = (monster.damageMap[actualAttackerId] || 0) + finalDamage;

        let highestDmg = -1;
        let bestTargetId = monster.targetId;
        for (let targetKey in monster.damageMap) {
            if (monster.damageMap[targetKey] > highestDmg) {
                highestDmg = monster.damageMap[targetKey];
                bestTargetId = targetKey;
            }
        }
        monster.targetId = bestTargetId;

        io.to(p.map).emit('monster_hit', { 
            monsterId: monster.id, 
            damage: finalDamage, 
            hpRemaining: monster.hp, 
            hitType: hitType
        });

        if (monster.hp <= 0) {
            monster.hp = 0;
            io.to(p.map).emit('monster_dead', { monsterId: monster.id });
            
            let baseRewardExp = monster.isBoss ? (monster.exp || 50000) : (monster.exp || 100);
            let baseAdenaCount = monster.isBoss 
                ? Math.floor(Math.random() * 150000 + 50000)
                : Math.floor(Math.random() * 200 + 50);

            if (p.partyId && parties[p.partyId]) {
                let party = parties[p.partyId];
                let memberCount = party.members.length;
                
                let partyBonusMultiplier = 1 + (memberCount - 1) * 0.30; 
                let sharedExp = Math.floor((baseRewardExp * partyBonusMultiplier) / memberCount);
                let sharedAdena = Math.floor((baseAdenaCount * partyBonusMultiplier) / memberCount);

                party.members.forEach(m => {
                    let memberSocket = io.sockets.sockets.get(m.socketId);
                    if (memberSocket) {
                        let memberPlayer = players[m.socketId];
                        if (memberPlayer && memberPlayer.map === p.map) {
                            memberSocket.emit('player_exp_gain', { exp: sharedExp });
                            memberSocket.emit('item_looted_success', { 
                                item: { name: '아데나', type: 'currency', count: sharedAdena } 
                            });
                        }
                    }
                });
            } else {
                socket.emit('player_exp_gain', { exp: baseRewardExp });
                socket.emit('item_looted_success', { 
                    item: { name: '아데나', type: 'currency', count: baseAdenaCount } 
                });
            }

            let dropCount = monster.isBoss ? (Math.floor(Math.random() * 2) + 1) : (Math.random() < 0.25 ? 1 : 0);

            for (let i = 0; i < dropCount; i++) {
                let finalDropItem = null;

                if (monster.isBoss) {
                    let rolled = rollBossItemGrade(monster);
                    let isSignature = Math.random() < 0.20 && Array.isArray(monster.drops) && monster.drops.length > 0;
                    let baseChosen = null;

                    if (isSignature) {
                        let pick = monster.drops[Math.floor(Math.random() * monster.drops.length)];
                        baseChosen = data.itemDb.find(it => it.name === pick.name);
                    }

                    if (!baseChosen) {
                        let equipPool = data.itemDb.filter(it => 
                            ['weapon', 'armor', 'helmet', 'cloak', 'gloves', 'boots', 'shield', 'belt', 'ring'].includes(it.type)
                        );
                        baseChosen = equipPool[Math.floor(Math.random() * equipPool.length)];
                    }

                    if (baseChosen) {
                        let dynamicItem = JSON.parse(JSON.stringify(baseChosen));
                        dynamicItem.grade = rolled.grade;

                        if (rolled.grade >= 5 && !dynamicItem.name.startsWith('[')) {
                            dynamicItem.name = `[${rolled.gradeName}] ${dynamicItem.name}`;
                        }

                        finalDropItem = generateServerDropItem(dynamicItem);

                        if (rolled.grade === 6) {
                            finalDropItem = applyTranscendOptions(finalDropItem);
                        }
                    }
                } else {
                    let rand = Math.random() * 100;
                    let targetGrade = rand < 0.1 ? 4 : (rand < 2.0 ? 3 : (rand < 12.0 ? 2 : (Math.random() * 0.5 ? 1 : 0)));
                    let gradePool = data.itemDb.filter(it => (it.grade || 0) <= targetGrade);
                    if (gradePool.length > 0) {
                        let baseChosen = gradePool[Math.floor(Math.random() * gradePool.length)];
                        finalDropItem = generateServerDropItem(baseChosen);
                    }
                }

                if (finalDropItem) {
                    let spreadAngle = (Math.PI * 2 / Math.max(1, dropCount)) * i + (Math.random() * 0.4 - 0.2);
                    let spreadDist = Math.random() * 50 + 20;

                    let floorItem = {
                        ...finalDropItem,
                        x: Math.max(50, Math.min(3950, monster.x + Math.cos(spreadAngle) * spreadDist)),
                        y: Math.max(50, Math.min(3950, monster.y + Math.sin(spreadAngle) * spreadDist)),
                        map: p.map,
                        spawnTime: Date.now()
                    };

                    mapsState[p.map].items.push(floorItem);
                    io.to(p.map).emit('item_spawned', { item: floorItem });
                }
            }

            if (monster.isBoss && monster.baseBossId) {
                mapsState[p.map].deadBosses = mapsState[p.map].deadBosses || [];
                mapsState[p.map].deadBosses.push({
                    baseBossId: monster.baseBossId,
                    spawnX: monster.spawnX,
                    spawnY: monster.spawnY,
                    deadTime: Date.now()
                });
            }

            if (monster.isBoss && p.map === 'boss_raid') {
                let userRaidRoom = Object.values(raidRooms).find(room => room.members.includes(socket.id));
                
                if (userRaidRoom && userRaidRoom.currentWave < userRaidRoom.maxWave) {
                    userRaidRoom.currentWave++;
                    
                    io.to(p.map).emit('system_message', { 
                        message: `⚡ [웨이브 돌파] 잠시 후 [2차 최종 결전] 보스가 출현합니다! (5초 후)`, 
                        color: '#38bdf8' 
                    });

                    setTimeout(() => {
                        let baseBosses = Object.values(data.templates.bosses).map(b => b.name);
                        let selectedBoss = baseBosses[Math.floor(Math.random() * baseBosses.length)];
                        let fullBossHp = monster.maxHp; 

                        let nextBoss = {
                            id: 'raid_boss_w2_' + Date.now(),
                            name: `[2차 최종 웨이브] ${selectedBoss}`,
                            isBoss: true,
                            x: 2000, 
                            y: 800,
                            map: p.map,
                            size: 35,
                            hp: fullBossHp,
                            maxHp: fullBossHp,
                            atk: monster.atk + 20,
                            def: monster.def + 10,
                            exp: monster.exp,
                            color: '#ff3333',
                            targetId: null,
                            angle: 0,
                            isMoving: false
                        };
                        if (mapsState[p.map]) {
                            mapsState[p.map].monsters.push(nextBoss);
                            io.to(p.map).emit('system_message', { message: `🚨 ${nextBoss.name}이(가) 나타났습니다! (Full HP 100%)`, color: '#f55' });
                        }
                    }, 5000);
                } else if (userRaidRoom && userRaidRoom.currentWave >= userRaidRoom.maxWave) {
                    io.to(p.map).emit('system_message', { 
                        message: `🎉 [레이드 완수] 2차 보스를 모두 토벌했습니다! 자동사냥이 해제됩니다. 전리품을 챙긴 뒤 퇴장하세요.`, 
                        color: '#fd0' 
                    });

                    userRaidRoom.members.forEach(memberSockId => {
                        io.to(memberSockId).emit('raid_clear_disable_autohunt');
                    });

                    userRaidRoom.status = 'CLEARED';
                }
            }

            monster.isDead = true;
            monster.deadTime = Date.now();
            setTimeout(() => {
                if (mapsState[p.map]) {
                    mapsState[p.map].monsters = mapsState[p.map].monsters.filter(m => m.id !== monster.id);
                }
            }, 2000);
        }
    }; 

    socket.on('attack_monster', handlePlayerAttack);
    socket.on('player_attack_request', handlePlayerAttack);

    socket.on('party_invite', (payload = {}) => {
        let targetSocket = io.sockets.sockets.get(payload.targetSocketId);
        if (targetSocket) {
            targetSocket.emit('party_invite_received', {
                inviterSocketId: socket.id,
                inviterName: payload.inviterName || players[socket.id]?.name || '알 수 없음'
            });
        }
    });

    socket.on('party_accept', (payload = {}) => {
        let inviter = players[payload.inviterSocketId];
        let accepter = players[socket.id];
        if (!inviter || !accepter) return;

        let partyId = inviter.partyId || 'party_' + Date.now();
        inviter.partyId = partyId;
        accepter.partyId = partyId;

        if (!parties[partyId]) {
            parties[partyId] = {
                id: partyId,
                leader: inviter.socketId,
                mode: 'normal',
                members: [inviter, accepter]
            };
        } else {
            if (!parties[partyId].members.some(m => m.socketId === accepter.socketId)) {
                parties[partyId].members.push(accepter);
            }
        }

        parties[partyId].members.forEach(member => {
            io.to(member.socketId).emit('party_update', { party: parties[partyId] });
            io.to(member.socketId).emit('system_message', { message: `[파티] ${accepter.name}님이 파티에 참가했습니다.`, color: '#5cf' });
        });
    });

    socket.on('party_set_mode', (payload = {}) => {
        let p = players[socket.id];
        if (!p || !p.partyId || !parties[p.partyId]) return;
        let party = parties[p.partyId];

        party.mode = payload.mode || (party.mode === 'focus' ? 'normal' : 'focus');
        let modeLabel = party.mode === 'focus' ? '점사 ++ 따라가기' : '자유 사냥';

        party.members.forEach(member => {
            io.to(member.socketId).emit('party_update', { party });
            io.to(member.socketId).emit('system_message', { 
                message: `[파티 모드 변경] 모드가 [ ${modeLabel} ]로 전환되었습니다.`, 
                color: '#fd0' 
            });
        });
    });

    socket.on('party_mode_toggle', () => {
        let p = players[socket.id];
        if (!p || !p.partyId || !parties[p.partyId]) return;
        let party = parties[p.partyId];

        party.mode = party.mode === 'focus' ? 'normal' : 'focus';
        let modeLabel = party.mode === 'focus' ? '점사 ++ 따라가기' : '자유 사냥';

        party.members.forEach(member => {
            io.to(member.socketId).emit('party_update', { party });
            io.to(member.socketId).emit('system_message', { message: `[파티 모드 변경] 모드가 [ ${modeLabel} ]로 전환되었습니다.`, color: '#fd0' });
        });
    });

    socket.on('party_leave', () => {
        let p = players[socket.id];
        if (!p || !p.partyId || !parties[p.partyId]) return;
        let party = parties[p.partyId];

        party.members = party.members.filter(m => m.socketId !== socket.id);
        p.partyId = null;
        socket.emit('party_update', { party: null });
        socket.emit('system_message', { message: "파티를 탈퇴했습니다.", color: "#aaa" });

        if (party.members.length <= 1) {
            party.members.forEach(m => {
                if (players[m.socketId]) players[m.socketId].partyId = null;
                io.to(m.socketId).emit('party_update', { party: null });
                io.to(m.socketId).emit('system_message', { message: "파티원이 부족하여 파티가 해산되었습니다.", color: "#aaa" });
            });
            delete parties[party.id];
        } else {
            if (party.leader === socket.id) {
                party.leader = party.members[0].socketId;
            }
            party.members.forEach(m => {
                io.to(m.socketId).emit('party_update', { party });
                io.to(m.socketId).emit('system_message', { message: `[파티] ${p.name}님이 파티를 탈퇴했습니다.`, color: '#f55' });
            });
        }
    });

    socket.on('disconnect', () => {
        let p = players[socket.id];
        let userMap = p ? p.map : null;

        if (p && p.partyId && parties[p.partyId]) {
            let party = parties[p.partyId];
            party.members = party.members.filter(m => m.socketId !== socket.id);
            if (party.members.length <= 1) {
                party.members.forEach(m => {
                    if (players[m.socketId]) players[m.socketId].partyId = null;
                    io.to(m.socketId).emit('party_update', { party: null });
                });
                delete parties[p.partyId];
            } else {
                if (party.leader === socket.id) party.leader = party.members[0].socketId;
                party.members.forEach(m => {
                    io.to(m.socketId).emit('party_update', { party });
                });
            }
        }

        delete players[socket.id];

        if (userMap === 'boss_raid') {
            let remainingPlayers = Object.values(players).filter(pl => pl.map === 'boss_raid');
            if (remainingPlayers.length === 0) {
                mapsState['boss_raid'] = { monsters: [], items: [], deadBosses: [] };

                for (let rId in raidRooms) {
                    if (raidRooms[rId].map === 'boss_raid') {
                        delete raidRooms[rId];
                    }
                }
                console.log("[🧹 레이드 초기화] 모든 유저 접속 종료로 보스 레이드 방이 초기화되었습니다.");
            }
        }
    });
}); 

// 3. 서버 몬스터 AI & 보스 장판/타격 연산 (40ms)
function processMonsterAI() {
    let now = Date.now();
    
    if (Math.random() < 0.2) { 
        for (let pKey in parties) {
            let party = parties[pKey];
            let needsUpdate = false;
            if (party && party.members) {
                party.members.forEach(m => {
                    let livePlayer = players[m.socketId];
                    if (livePlayer && (m.hp !== livePlayer.hp || m.maxHp !== livePlayer.maxHp)) {
                        m.hp = livePlayer.hp;
                        m.maxHp = livePlayer.maxHp;
                        needsUpdate = true;
                    }
                });
                
                if (needsUpdate) {
                    party.members.forEach(m => {
                        io.to(m.socketId).emit('party_update', { party: party });
                    });
                }
            }
        }
    }

    for (let mapId in mapsState) {
        let state = mapsState[mapId];
        let playersInMap = Object.values(players).filter(p => p.map === mapId);
        if (playersInMap.length === 0) continue;

        let allEntitiesInMap = [...playersInMap];
        playersInMap.forEach(p => {
            if (p.mercs && Array.isArray(p.mercs)) {
                p.mercs.forEach(m => {
                    m.ownerSocketId = p.socketId;
                    m.id = m.id || ('merc_' + p.socketId);
                });
                allEntitiesInMap.push(...p.mercs);
            }
        });

        state.monsters.forEach(mob => {
            if (mob.hp <= 0) return;

            let highestDmg = -1;
            let aggroTargetId = null;
            if (mob.damageMap) {
                for (let entId in mob.damageMap) {
                    if (mob.damageMap[entId] > highestDmg) {
                        let entExists = allEntitiesInMap.find(e => (e.socketId === entId || e.id === entId) && e.hp > 0 && !data.isInSafeZone(mapId, e.x, e.y));
                        if (entExists) {
                            highestDmg = mob.damageMap[entId];
                            aggroTargetId = entId;
                        }
                    }
                }
            }

            if (aggroTargetId) {
                mob.targetId = aggroTargetId;
            }

            let target = allEntitiesInMap.find(e => (e.socketId || e.id) === mob.targetId);
            let isTooFar = target ? Math.hypot(target.x - mob.x, target.y - mob.y) > (mob.isBoss ? 900 : 700) : false;

            if (!target || target.hp <= 0 || data.isInSafeZone(mapId, target.x, target.y) || isTooFar) {
                mob.targetId = null;
                mob.damageMap = {};
                
                let minDist = mob.isBoss ? 650 : 400;
                allEntitiesInMap.forEach(e => {
                    if (e.hp > 0 && !data.isInSafeZone(mapId, e.x, e.y)) {
                        let d = Math.hypot(e.x - mob.x, e.y - mob.y);
                        if (d < minDist) {
                            minDist = d;
                            mob.targetId = e.socketId || e.id;
                            target = e;
                        }
                    }
                });
            }
            
            if (mob.targetId && target) {
    let dist = Math.hypot(target.x - mob.x, target.y - mob.y);
    let stopDist = (mob.size || 20) + 40;

    if (dist > stopDist) {
        let angle = Math.atan2(target.y - mob.y, target.x - mob.x);
        
        // 💡 [수정] 몬스터 속도 상한을 둬서 미끄러지지 않고 자연스럽게 걸어오도록 감속 (초당 65~85px)
        let baseMobSpeed = mob.isBoss ? 85 : Math.min(65, mob.speed || 55);
        let mSpeed = baseMobSpeed * (40 / 1000); // 40ms 틱 주기 반영
        
        mob.x = Math.max(150, Math.min(3850, mob.x + Math.cos(angle) * mSpeed));
        mob.y = Math.max(150, Math.min(3850, mob.y + Math.sin(angle) * mSpeed));
        mob.angle = angle;
                } else {
                    let atkDelay = mob.isBoss ? 1200 : 1400;
                    if (now - (mob.lastAttackTime || 0) >= atkDelay) {
                        mob.lastAttackTime = now;
                        let isMagicMob = mob.isBoss && (mob.isMagicBoss || Math.random() < 0.65);
                        let ownerSocketId = target.socketId || target.ownerSocketId;

                        if (isMagicMob) {
                            let hpPercent = mob.hp / mob.maxHp;
                            let magicPool = ['파이어볼', '콜 라이트닝', '이럽션'];
                            if (hpPercent <= 0.70) magicPool.push('라이트닝 스톰', '토네이도');
                            if (hpPercent <= 0.40) magicPool.push('블리자드', '저지먼트');
                            if (hpPercent <= 0.20) magicPool.push('미티어 스트라이크', '디스인티그레이트');

                            let magicName = magicPool[Math.floor(Math.random() * magicPool.length)];
                            
                            const SPELL_CONFIGS = {
                                '미티어 스트라이크': { delay: 1.2, radius: 160, dmg: 480 },
                                '디스인티그레이트': { delay: 1.0, radius: 140, dmg: 450 },
                                '저지먼트':         { delay: 1.2, radius: 170, dmg: 420 },
                                '블리자드':         { delay: 1.1, radius: 150, dmg: 380 },
                                '라이트닝 스톰':     { delay: 1.0, radius: 130, dmg: 300 },
                                '토네이도':         { delay: 1.0, radius: 130, dmg: 280 },
                                '이럽션':           { delay: 0.9, radius: 120, dmg: 220 },
                                '파이어볼':         { delay: 0.8, radius: 110, dmg: 160 },
                                '콜 라이트닝':       { delay: 0.7, radius: 100, dmg: 140 }
                            };

                            let cfg = SPELL_CONFIGS[magicName] || { delay: 1.0, radius: 120, dmg: 200 };
                            const castTargetX = target.x;
                            const castTargetY = target.y;

                            io.to(mapId).emit('monster_attack_action', {
                                monsterId: mob.id,
                                magicName: magicName,
                                targetX: castTargetX,
                                targetY: castTargetY,
                                delay: cfg.delay,
                                radius: cfg.radius,
                                hitType: 'magic'
                            });

                            setTimeout(() => {
                                let ownerP = players[ownerSocketId];
                                if (!ownerP || ownerP.map !== mapId) return;

                                let currentTarget = target.socketId ? ownerP : (ownerP.mercs && ownerP.mercs.find(m => m.id === target.id));
                                if (!currentTarget || currentTarget.hp <= 0) return;

                                let pDist = Math.hypot(currentTarget.x - castTargetX, currentTarget.y - castTargetY);

                                if (pDist <= cfg.radius + 45) {
                                    currentTarget.hp = Math.max(0, currentTarget.hp - cfg.dmg);
                                    io.to(ownerSocketId).emit('take_damage', { 
                                        damage: cfg.dmg, 
                                        hitType: 'magic', 
                                        hpRemaining: currentTarget.hp, 
                                        targetId: currentTarget.id || currentTarget.socketId 
                                    });
                                } else {
                                    io.to(ownerSocketId).emit('take_damage', { 
                                        isDodge: true, 
                                        targetId: currentTarget.id || currentTarget.socketId 
                                    });
                                }
                            }, cfg.delay * 1000);

                        } else {
                            let targetDef = target.def || 0;
                            let dmg = Math.max(1, (mob.atk || 15) - Math.floor(targetDef * 0.5));

                            target.hp = Math.max(0, target.hp - dmg);
                            if (ownerSocketId) {
                                io.to(ownerSocketId).emit('take_damage', { 
                                    damage: dmg, 
                                    hitType: 'physical', 
                                    hpRemaining: target.hp, 
                                    targetId: target.id || target.socketId 
                                });
                            }
                            io.to(mapId).emit('monster_attack_action', { monsterId: mob.id, hitType: 'physical', targetX: target.x, targetY: target.y });
                        }
                    }
                }
            }
        });

        let allMercsForSync = [];
        playersInMap.forEach(p => {
            if (p.mercs && Array.isArray(p.mercs)) {
                allMercsForSync.push(...p.mercs);
            }
        });

        io.to(mapId).emit('sync_entities', {
            players: playersInMap.map(p => ({ 
                socketId: p.socketId, 
                name: p.name, 
                charClass: p.charClass, 
                x: Math.round(p.x), 
                y: Math.round(p.y), 
                hp: Math.round(p.hp), 
                maxHp: p.maxHp, 
                angle: Number((p.angle || 0).toFixed(2)), 
                isMoving: Boolean(p.isMoving), 
                equip: p.equip, 
                partyId: p.partyId, 
                targetId: p.targetId 
            })),
            mercs: allMercsForSync.map(m => ({ 
                id: m.id, 
                name: m.name, 
                mercType: m.mercType, 
                charClass: m.charClass, 
                ownerId: m.ownerId, 
                ownerName: m.ownerName, 
                x: Math.round(m.x), 
                y: Math.round(m.y), 
                hp: Math.round(m.hp), 
                maxHp: m.maxHp, 
                equip: m.equip, 
                angle: Number((m.angle || 0).toFixed(2)), 
                isMoving: Boolean(m.isMoving) 
            })),
            monsters: state.monsters.filter(m => m.hp > 0).map(m => ({ 
                id: m.id, 
                name: m.name, 
                x: Math.round(m.x), 
                y: Math.round(m.y), 
                hp: Math.round(m.hp), 
                maxHp: m.maxHp, 
                isBoss: m.isBoss, 
                angle: Number((m.angle || 0).toFixed(2)), 
                color: m.color, 
                targetId: m.targetId 
            }))
        });
    }
}

// 몬스터 자동 리스폰
function processMonsterSpawning() {
    for (let mapId in data.maps) {
        let mData = data.maps[mapId];
        let state = mapsState[mapId];
        let normalMobs = state.monsters.filter(m => !m.isBoss).length;
        let targetMax = mData.maxMobs || 40;

        let deficit = targetMax - normalMobs;
        let spawnBatch = Math.min(deficit, 4);

        if (spawnBatch > 0 && mData.m?.length > 0) {
            for (let i = 0; i < spawnBatch; i++) {
                let mobId = mData.m[Math.floor(Math.random() * mData.m.length)];
                let t = data.templates.mobs[mobId];
                if (t) {
                    let rx = Math.random() * 3600 + 200, ry = Math.random() * 3600 + 200;
                    if (!data.isInSafeZone(mapId, rx, ry)) {
                        state.monsters.push({
                            ...t, 
                            id: 'mob_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                            x: rx, y: ry, maxHp: t.hp, hp: t.hp, map: mapId,
                            isBoss: false, targetId: null, lastAttackTime: 0
                        });
                    }
                }
            }
        }
    }
}

setInterval(() => {
    let now = Date.now();
    for (let mapId in mapsState) {
        let state = mapsState[mapId];
        if (!state) continue;

        if (state.monsters) {
            state.monsters = state.monsters.filter(m => {
                return !(m.hp <= 0 && m.deadTime && (now - m.deadTime > 3000));
            });
        }
        
        if (state.items) {
            state.items = state.items.filter(item => {
                return (now - item.spawnTime) < 60000;
            });
        }

        if (state.deadBosses) {
            state.deadBosses = state.deadBosses.filter(db => {
                if (now - db.deadTime > 300000) { 
                    let bt = data.templates.bosses[db.baseBossId];
                    if (bt) {
                        state.monsters.push({
                            ...bt, 
                            id: 'boss_' + db.baseBossId + '_' + Date.now(),
                            baseBossId: db.baseBossId, spawnX: db.spawnX, spawnY: db.spawnY, 
                            maxHp: bt.hp, hp: bt.hp, x: db.spawnX, y: db.spawnY, map: mapId,
                            isBoss: true, targetId: null, lastAttackTime: 0
                        });
                    }
                    return false; 
                }
                return true;
            });
        }
    }
}, 10000); 

setInterval(processMonsterSpawning, 1000);
setInterval(processMonsterAI, 40);

// ==========================================
// 🔥 [보스 레이드 멀티 인스턴스 방 객체 및 15초 카운트다운 루프]
// ==========================================
function startRaidCountdown(roomId) {
    let room = raidRooms[roomId];
    if (!room) return;

    let countdown = 15; 
    let timer = setInterval(() => {
        if (!raidRooms[roomId]) {
            clearInterval(timer);
            return;
        }

        countdown--;
        room.members.forEach(sockId => {
            io.to(sockId).emit('raid_countdown_tick', { countdown });
        });

        if (countdown <= 0) {
            clearInterval(timer);
            room.status = 'STARTED'; 

            let totalLv = 0;
            room.members.forEach(sockId => {
                let memberP = players[sockId];
                if (memberP) totalLv += (memberP.level || 1);
            });
            let finalAvgLv = Math.floor(totalLv / Math.max(1, room.members.length));
            let finalTier = Math.min(4, Math.floor(finalAvgLv / 20)); 

            room.members.forEach(sockId => {
                io.to(sockId).emit('raid_battle_start', { tierIndex: finalTier });
            });
        }
    }, 1000);
}

// 🧹 유령방 및 빈 방 자동 청소 코드
setInterval(() => {
    let now = Date.now();
    for (let rId in raidRooms) {
        let room = raidRooms[rId];
        let activeMembers = room.members.filter(sockId => players[socketId]);
        room.members = activeMembers;

        let isGhostRoom = (room.members.length === 0 && (now - room.createdAt > 30000));
        let isExpired = (now - room.createdAt > 7200000); 

        if (isGhostRoom || isExpired) {
            delete raidRooms[rId];
        }
    }
}, 10000);

// =======================================================
// 💡 매주 일요일 새벽 4시 서버 자동 재부팅 (KST 기준)
// =======================================================
let isWarningSent = false;
let isRebootTriggered = false;

setInterval(() => {
    const now = new Date();
    const kstTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 60 * 60 * 1000));

    if (kstTime.getDay() === 0 && kstTime.getHours() === 3 && kstTime.getMinutes() === 59) {
        if (!isWarningSent) {
            isWarningSent = true;
            io.emit('system_message', { 
                message: '⚠️ [서버 공지] 1분 뒤 정기 점검을 위해 서버가 재부팅됩니다. 데이터가 안전하게 자동 저장됩니다!', 
                color: '#ff2200' 
            });
            io.emit('force_client_save'); 
            console.log("[서버] 1분 후 자동 재부팅됩니다. (강제 저장 신호 발송 완료)");
        }
    }

    if (kstTime.getDay() === 0 && kstTime.getHours() === 4 && kstTime.getMinutes() === 0) {
        if (!isRebootTriggered) {
            isRebootTriggered = true;
            console.log("[서버] 정기 자동 재부팅을 실행합니다.");
            process.exit(0); 
        }
    }
    
    if (kstTime.getHours() === 5) {
        isWarningSent = false;
        isRebootTriggered = false;
    }
}, 1000);

process.on('uncaughtException', (err) => {
    console.error('[-] 치명적 오류 발생 (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[-] 처리되지 않은 프로미스 거부 (Unhandled Rejection):', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[✔] 서버 가동 완료: http://localhost:${PORT}`));