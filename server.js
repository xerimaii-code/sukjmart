// server.js

require('dotenv').config();let targetGrade = 0;
const { exec, spawn } = require('child_process');
const SUPABASE_URL = process.env.SUPABASE_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const data = require('./public/js/data.js');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    perMessageDeflate: false
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
    } else if (['ring', 'belt', 'earring'].includes(t)) {
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

// ==========================================
// 🚀 [파티장 맵 이동 시 AI/플레이어 분기 처리 함수]
// ==========================================
function handlePartyMapTransition(partyId, leaderSocketId, targetMap, targetX, targetY) {
    const party = parties[partyId];
    if (!party || party.leader !== leaderSocketId) return;

    const townMaps = ['talking_island', 'silver_knight_town', 'giran', 'gludin', 'oren', 'aden'];
    
    if (townMaps.includes(targetMap)) {
        party.members.forEach(member => {
            if (member.socketId === leaderSocketId) return;
            const memberSocket = io.sockets.sockets.get(member.socketId);
            if (memberSocket) {
                memberSocket.emit('system_message', { 
                    message: `[파티] 파티장이 정비를 위해 마을로 이동했습니다. 현 위치에서 자유 사냥을 유지합니다.`, 
                    color: '#fd0' 
                });
            }
        });
        return; 
    }

    // 💡 2. 사냥터 및 차원의 틈새(보스 레이드) 이동 처리
    let isRaid = (targetMap === 'boss_raid');

    party.members.forEach(member => {
        if (member.socketId === leaderSocketId) return;

        const memberSocket = io.sockets.sockets.get(member.socketId);
        if (!memberSocket) return;

        if (memberSocket.isAI) {
            memberSocket.emit('party_leader_map_move', {
                map: targetMap,
                x: targetX,
                y: targetY,
                autoWarp: true
            });
        } else if (isRaid) {
            memberSocket.emit('raid_clear_return_town', { 
                map: targetMap, 
                x: targetX, 
                y: targetY 
            });
            memberSocket.emit('system_message', { 
                message: `🚨 파티장이 차원의 틈새를 개방하여 파티원 전원이 동반 입장합니다!`, 
                color: '#f55' 
            });
        } else {
            memberSocket.emit('party_warp_request', {
                leaderName: party.leaderName || (players[leaderSocketId] ? players[leaderSocketId].name : '파티장'),
                map: targetMap,
                mapName: data.maps[targetMap]?.name || targetMap,
                x: targetX,
                y: targetY
            });
        }
    });
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
        
        if (payload.isAI || (id && String(id).startsWith('ai_')) || (name && name.startsWith('AI_'))) {
            socket.isAI = true;
        }

        if (players[socket.id] && players[socket.id].map) { 
            socket.leave(players[socket.id].map); 
        }
        let currentMap = map || 'talking_island';

        if (!mapsState[currentMap]) {
            mapsState[currentMap] = { monsters: [], items: [], deadBosses: [] };
        }

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
            angle: 0,
            totalMr: payload.totalMr || 50,
            totalDmgReduction: payload.totalDmgReduction || 0,
            isAI: socket.isAI
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

        let baseBossHp = Math.floor(partyCombatPower * 1.5) + (playerCount * 10000);
        let baseBossDef = Math.min(50, Math.floor(30 + (partyCombatPower / 500)));
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
            if (!mapsState[currentMap]) mapsState[currentMap] = { monsters: [], items: [], deadBosses: [] };
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
                angle: payload.angle || 0,
                totalMr: payload.totalMr || 50,
                totalDmgReduction: payload.totalDmgReduction || 0,
                isAI: socket.isAI
            };
            socket.join(currentMap);
            socket.emit('sync_map_state', { monsters: mapsState[currentMap].monsters, items: mapsState[currentMap].items });
            return;
        }

        if (p.map !== payload.map && payload.map) {
            let prevMap = p.map;
            let targetMap = payload.map;
            let targetX = payload.x || 2000;
            let targetY = payload.y || 2000;

            if (mapsState[prevMap] && mapsState[prevMap].monsters) {
                mapsState[prevMap].monsters.forEach(mob => {
                    if (mob.damageMap && mob.damageMap[socket.id]) {
                        delete mob.damageMap[socket.id];
                    }
                    if (mob.targetId === socket.id) {
                        mob.targetId = null;
                    }
                });
            }

            if (p.partyId && parties[p.partyId]) {
                let party = parties[p.partyId];
                if (party.leader === socket.id) {
                    handlePartyMapTransition(p.partyId, socket.id, targetMap, targetX, targetY);
                }
            }

            socket.leave(prevMap); 
            socket.join(targetMap); 
            p.map = targetMap;
            p.targetId = null;
            p.damageMap = {};
            
            if (!mapsState[p.map]) {
                mapsState[p.map] = { monsters: [], items: [], deadBosses: [] };
            }
            if (prevMap === 'boss_raid') {
                if (p.currentRaidRoomId && raidRooms[p.currentRaidRoomId]) {
                    let room = raidRooms[p.currentRaidRoomId];
                    room.members = room.members.filter(sid => sid !== socket.id);
                    
                    let newCombatPower = 0;
                    room.members.forEach(memberId => {
                        let memberP = players[memberId];
                        if (memberP) newCombatPower += (memberP.level * 300);
                    });
                    room.totalCombatPower = newCombatPower;
                }
                p.currentRaidRoomId = null;

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

        if (payload.targetId !== undefined) {
            p.targetId = payload.targetId;
        }

        if (payload.hp !== undefined && payload.hp <= 0) {
            p.hp = 0;
            p.targetId = null;
            if (mapsState[p.map] && mapsState[p.map].monsters) {
                mapsState[p.map].monsters.forEach(m => {
                    if (m.damageMap) delete m.damageMap[socket.id];
                    if (m.targetId === socket.id) m.targetId = null;
                });
            }
        } else if (payload.hp !== undefined && payload.hp > p.hp) {
            p.hp = payload.hp;
        }
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
        
        p.totalMr = payload.totalMr !== undefined ? payload.totalMr : (p.totalMr || p.int * 2);
        p.totalDmgReduction = payload.totalDmgReduction !== undefined ? payload.totalDmgReduction : (p.totalDmgReduction || 0);

        if (payload.mercs && Array.isArray(payload.mercs)) {
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

        let chosenType = payload.mercType || (p.charClass === 'wizard' ? 'wizard' : (p.charClass === 'elf' ? 'elf' : 'knight'));

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
        
        if (payload.healAmt && payload.targetId) {
            let targetP = players[payload.targetId];
            if (targetP) {
                targetP.hp = Math.min(targetP.maxHp || Math.max(100, targetP.hp), targetP.hp + payload.healAmt);
                
                if (targetP.partyId && parties[targetP.partyId]) {
                    let pMember = parties[targetP.partyId].members.find(m => m.socketId === payload.targetId);
                    if (pMember) {
                        pMember.hp = targetP.hp;
                        parties[targetP.partyId].members.forEach(m => {
                            io.to(m.socketId).emit('party_update', { party: parties[targetP.partyId] });
                        });
                    }
                }
            }
        }
        
        let playersInMap = Object.values(players).filter(pl => pl.map === mapId);
        playersInMap.forEach(targetPl => {
            let casterX = payload.casterX !== undefined ? payload.casterX : (p ? p.x : 2000);
            let casterY = payload.casterY !== undefined ? payload.casterY : (p ? p.y : 2000);
            let dist = Math.hypot(targetPl.x - casterX, targetPl.y - casterY);
            
            if (dist <= 900) {
                io.to(targetPl.socketId).emit('sync_player_magic', {
                    casterId: payload.casterId || socket.id, 
                    magicName: payload.magicName, 
                    tier: payload.tier,
                    fontSize: payload.fontSize,
                    targetX: payload.targetX,
                    targetY: payload.targetY,
                    targetId: payload.targetId,
                    casterX: casterX,
                    casterY: casterY,
                    healAmt: payload.healAmt,
                    // 💡 [핵심] 버프를 완벽히 동기화하기 위한 페이로드 전달
                    isBuff: payload.isBuff,
                    buffName: payload.buffName,
                    buffDuration: payload.buffDuration,
                    buffIcon: payload.buffIcon,
                    buffType: payload.buffType,
                    buffVal: payload.buffVal
                });
            }
        });
    });

    socket.on('player_attack_action', (payload = {}) => {
        let p = players[socket.id];
        if (!p) return;
        let mapId = (p && p.map) ? p.map : 'talking_island';
        
        let playersInMap = Object.values(players).filter(pl => pl.map === mapId);
        playersInMap.forEach(targetPl => {
            let dist = Math.hypot(targetPl.x - p.x, targetPl.y - p.y);
            if (dist <= 900) {
                io.to(targetPl.socketId).emit('sync_player_action', {
                    socketId: payload.casterId || socket.id, 
                    angle: payload.angle,
                    targetId: payload.targetId,
                    targetX: payload.targetX,
                    targetY: payload.targetY,
                    isBow: payload.isBow,
                    actionType: payload.actionType,
                    color: payload.color
                });
            }
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

   socket.on('entity_use_potion', (payload = {}) => {
        let p = players[socket.id];
        if (p) {
            io.to(p.map).emit('sync_entity_potion', {
                entityId: payload.entityId || socket.id,
                potionName: payload.potionName
            });
        }
    });


    socket.on('player_use_potion', (payload = {}) => {
        let p = players[socket.id];
        if (p) {
            io.to(p.map).emit('sync_entity_potion', {
                entityId: socket.id,
                potionName: payload.potionName
            });
        }
    });

    socket.on('chat_message', (payload = {}) => {
        let p = players[socket.id];
        let name = p ? p.name : (payload.name || '모험가');
        let chatType = payload.chatType || 'normal';
        let isAI = p ? Boolean(p.isAI) : false;

        if (chatType === 'party' && p && p.partyId && parties[p.partyId]) {
            parties[p.partyId].members.forEach(m => {
                io.to(m.socketId).emit('chat_broadcast', {
                    senderId: socket.id,
                    socketId: socket.id,
                    name: name,
                    message: payload.message,
                    chatType: 'party',
                    isAI: isAI
                });
            });
            return;
        }

        io.emit('chat_broadcast', {
            senderId: socket.id,
            socketId: socket.id,
            name: name,
            message: payload.message,
            chatType: 'normal',
            isAI: isAI
        });
    });

    socket.on('cmd_who', () => {
        let requester = players[socket.id];
        if (!requester) return;

        let myPartyId = requester.partyId;
        let myMapId = requester.map || 'talking_island'; 
        let playerList = Object.values(players);

        const mapNames = {
            'talking_island': '말하는 섬', 'silver_knight_town': '은기사 마을', 'elven_forest': '요정의 숲',
            'ti_dungeon': '말섬 던전 1층', 'ti_dungeon2': '말섬 던전 2층', 'gludio_dungeon': '글루디오 던전(본던)',
            'gludin': '글루딘 영지(사막 포함)', 'ant_cave': '개미굴 (사막 동굴)', 'dragon_valley': '용의 계곡',
            'dv_dungeon': '용계 던전', 'tower_of_insolence_1': '오만의 탑 1층', 'tower_of_insolence_10': '오만의 탑 10층',
            'tower_of_insolence_30': '오만의 탑 30층', 'tower_of_insolence_50': '오만의 탑 50층', 'tower_of_insolence_70': '오만의 탑 70층',
            'tower_of_insolence_100': '오만의 탑 정상', 'fire_dragon_nest': '화룡의 둥지', 'oren': '오렌 영지 (설벽)',
            'heine': '하이네 (수중)', 'aden': '아덴 영지', 'forgotten_island': '잊혀진 섬', 'lastebad': '라스타바드',
            'tower_of_dominance': '지배의 탑 정상', 'ivory_tower': '상아탑', 'dream_island': '몽환의 섬',
            'giran_dungeon_1': '기란 감옥 1층', 'giran_dungeon_4': '기란 감옥 4층', 'eva_kingdom': '에바 왕국 던전 (수던 4층)',
            'dragon_valley_deep': '용의 계곡 심층', 'elven_forest_deep': '요정의 숲 깊은 곳', 'boss_raid': '🔥 [보스 레이드] 차원의 틈새'
        };

        let mapGroups = {};
        playerList.forEach(p => {
            let m = p.map || 'talking_island';
            if (!mapGroups[m]) mapGroups[m] = [];
            mapGroups[m].push(p);
        });

        let lines = [`🌐 <b style="color:#5cf;">[현재 월드 접속자: 총 ${playerList.length}명]</b>`];

        let sortedMapCodes = Object.keys(mapGroups).sort((a, b) => {
            if (a === myMapId) return 1;  
            if (b === myMapId) return -1; 
            return 0; 
        });

        for (let mapCode of sortedMapCodes) {
            let mapDispName = mapNames[mapCode] || mapCode;
            let usersInMap = mapGroups[mapCode];
            
            let isMyMap = (mapCode === myMapId);
            let mapHeaderColor = isMyMap ? '#38bdf8' : '#fd0';
            let mapFocusMark = isMyMap ? '📍 <span style="color:#38bdf8; font-size:11px;">[현재 맵]</span> ' : '📍 ';
            
            lines.push(`<br>${mapFocusMark}<span style="color:${mapHeaderColor}; font-weight:bold;">[${mapDispName}]</span> -${usersInMap.length}명`);
            
            let soloUsers = [];
            let partyGroups = {};

            usersInMap.forEach(p => {
                if (p.partyId) {
                    if (!partyGroups[p.partyId]) partyGroups[p.partyId] = [];
                    partyGroups[p.partyId].push(p);
                } else {
                    soloUsers.push(p);
                }
            });

            let pIndex = 1;
            for (let pid in partyGroups) {
                let pUsers = partyGroups[pid];
                let isMyP = (pid === myPartyId);
                let pTitleColor = isMyP ? '#4ade80' : '#e879f9';
                let pTitle = isMyP ? `[내 파티]` : `[파티 ${pIndex++}]`;
                
                let leaderId = parties[pid] ? parties[pid].leader : null;

                lines.push(`&nbsp;&nbsp;<span style="color:${pTitleColor}; font-weight:bold;">${pTitle}</span>`);
                
                pUsers.forEach(p => {
                    let isMe = (p.socketId === socket.id);
                    let isLeader = (p.socketId === leaderId);
                    
                    let prefix = '';
                    if (isLeader) prefix += `<span style="color:#facc15;">👑</span>`;
                    if (isMe) prefix += `<span style="color:#facc15; font-weight:bold;">[나]</span> `;
                    
                    let nameColor = isMyP ? '#86efac' : '#ddd';
                    let cClass = p.class_name || p.charClass || '기사';
                    lines.push(`&nbsp;&nbsp;&nbsp;&nbsp;ㄴ ${prefix}<span style="color:${nameColor};">${p.name}</span> <span style="font-size:11px; color:#888;">(Lv.${p.level}${cClass})</span>`);
                });
            }

            if (soloUsers.length > 0) {
                lines.push(`&nbsp;&nbsp;<span style="color:#aaa; font-weight:bold;">[일반 (솔로)]</span>`);
                soloUsers.forEach(p => {
                    let isMe = (p.socketId === socket.id);
                    let prefix = isMe ? `<span style="color:#facc15; font-weight:bold;">[나]</span> ` : ``;
                    let cClass = p.class_name || p.charClass || '기사';
                    lines.push(`&nbsp;&nbsp;&nbsp;&nbsp;ㄴ ${prefix}<span style="color:#ddd;">${p.name}</span> <span style="font-size:11px; color:#888;">(Lv.${p.level} ${cClass})</span>`);
                });
            }
        }

        socket.emit('system_message', { message: lines.join('<br>'), color: '#fff' });
    });

    socket.on('cmd_whisper', (payload = {}) => {
        let p = players[socket.id];
        let senderName = p ? p.name : '모험가';
        let targetName = payload.targetName;
        let content = payload.content;
        let isAI = p ? Boolean(p.isAI) : false;

        let targetSocketId = Object.keys(players).find(sid => players[sid].name === targetName);

        if (targetSocketId) {
            io.to(targetSocketId).emit('chat_broadcast', {
                senderId: socket.id,
                socketId: socket.id,
                name: senderName,
                message: content,
                chatType: 'whisper',
                isWhisper: true,
                isAI: isAI
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

    const handleAdminReboot = () => {
        console.log("⚡ [운영자 명령] server.js 및 aiAgentRunner.js 전체 재부팅을 시작합니다!");

        io.emit('system_message', {
            message: '⚠️ [서버 공지] 운영자 명령으로 3초 후 서버와 AI 시스템이 재부팅됩니다. 데이터가 안전하게 자동 저장됩니다.',
            color: '#ef4444'
        });
        io.emit('force_client_save');
        io.emit('server_shutdown_notice');

        setTimeout(() => {
            exec('pm2 restart all', (err) => {
                if (!err) {
                    console.log("✔ [PM2] 전체 프로세스 재시작 완료");
                    return;
                }

                console.log("ℹ [일반 Node 환경] server.js와 aiAgentRunner.js를 직접 재실행합니다.");

                const isWin = process.platform === 'win32';
                if (isWin) {
                    spawn('cmd.exe', ['/c', 'start', 'node', 'server.js'], { detached: true, stdio: 'ignore' }).unref();
                    spawn('cmd.exe', ['/c', 'start', 'node', 'aiAgentRunner.js'], { detached: true, stdio: 'ignore' }).unref();
                } else {
                    spawn('nohup', ['node', 'server.js'], { detached: true, stdio: 'ignore' }).unref();
                    spawn('nohup', ['node', 'aiAgentRunner.js'], { detached: true, stdio: 'ignore' }).unref();
                }

                setTimeout(() => process.exit(0), 500);
            });
        }, 3000);
    };

    socket.on('admin_reboot_all', handleAdminReboot);
    socket.on('admin_reboot_server', handleAdminReboot);

    const handlePlayerAttack = (payload = {}) => {
        let p = players[socket.id];
        if (!p || !mapsState[p.map]) return;
        
        let monster = mapsState[p.map].monsters.find(m => m.id === payload.targetId);
        if (!monster || monster.hp <= 0) return;

        let actualAttackerId = payload.attackerId || socket.id;
        if (monster.isUndead && p.equip && p.equip.weapon && p.equip.weapon.isUndeadWeapon) {
            if (typeof payload.calculatedDmg === 'number' && payload.calculatedDmg > 0) {
                payload.calculatedDmg = Math.floor(payload.calculatedDmg * 1.5);
            }
        }
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

        if (monster.invincibleUntil && Date.now() < monster.invincibleUntil) {
            finalDamage = 0;
        } else {
            let mDef = monster.def || 0;
            let mDefRatio = 100 / (100 + Math.max(0, mDef));

            if (typeof payload.calculatedDmg === 'number' && payload.calculatedDmg > 0) {
                finalDamage = Math.max(1, Math.floor(payload.calculatedDmg * mDefRatio));
            } else {
                let statAtk = Math.max(1, Math.floor((p.str - 10) * 3.2));
                let wpAtk = (p.equip && p.equip.weapon ? p.equip.weapon.atk || 0 : 0);
                let rawDmg = statAtk + wpAtk;
                finalDamage = Math.max(1, Math.floor(rawDmg * mDefRatio));
            }
        }

        monster.hp -= finalDamage;
        
        if (spellName === '쇼크 스턴') {
            monster.stunnedUntil = Date.now() + 3000;
        } else if (spellName === '어스 바인드') {
            monster.stunnedUntil = Date.now() + 5000;
            monster.invincibleUntil = Date.now() + 5000;
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

            if (monster.scalingBonus && monster.scalingBonus > 1.0) {
                baseAdenaCount = Math.floor(baseAdenaCount * monster.scalingBonus);
            }

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
                            ['weapon', 'armor', 'helmet', 'cloak', 'gloves', 'boots', 'shield', 'belt', 'ring', 'earring', 'tshirt'].includes(it.type)
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
                 
                    let targetGrade = rand < 0.1 ? 4 : (rand < 2.0 ? 3 : (rand < 12.0 ? 2 : (Math.random() < 0.5 ? 1 : 0)));

                    let maxAllowedGrade = 0;
                    if (monster.maxHp >= 4000) maxAllowedGrade = 4;     
                    else if (monster.maxHp >= 1500) maxAllowedGrade = 3; 
                    else if (monster.maxHp >= 500) maxAllowedGrade = 2; 
                    else maxAllowedGrade = 1;                           
                   
                    targetGrade = Math.min(targetGrade, maxAllowedGrade);

                    let gradePool = data.itemDb.filter(it => 
                        (it.grade || 0) === targetGrade && 
                        !it.name.includes('[신화]') && !it.name.includes('[초월]')
                    );

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
                

                if (!userRaidRoom && p.partyId && parties[p.partyId]) {
                    let leaderId = parties[p.partyId].leader;
                    userRaidRoom = Object.values(raidRooms).find(room => room.members.includes(leaderId));
                }
                
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

    socket.on('party_invite', (data) => {
        let targetSocket = io.sockets.sockets.get(data.targetSocketId);
        if (!targetSocket) return;

        let inviterPlayer = players[socket.id];
        let targetPlayer = players[data.targetSocketId];
        if (!inviterPlayer || !targetPlayer) return;

        let myPartyId = inviterPlayer.partyId;
        let targetPartyId = targetPlayer.partyId;
        
        let myParty = myPartyId ? parties[myPartyId] : null;
        let targetParty = targetPartyId ? parties[targetPartyId] : null;

        let myCount = myParty ? myParty.members.length : 1;
        let targetCount = targetParty ? targetParty.members.length : 1;

        if (myParty && targetParty && myParty.id !== targetParty.id) {
            if (inviterPlayer.isAI) return;
            if (myCount + targetCount > 10) {
                return socket.emit('system_message', { 
                    message: `합병 시 최대 인원(10명)을 초과할 수 없습니다. (현재: ${myCount}명 + 상대: ${targetCount}명)`, 
                    color: '#f55' 
                });
            }
        } else if (myParty && !targetParty) {
            if (myCount >= 5) {
                return socket.emit('system_message', { 
                    message: `일반 파티는 최대 5명까지만 구성할 수 있습니다.`, 
                    color: '#f55' 
                });
            }
        }

        targetSocket.emit('party_invite_received', {
            inviterSocketId: socket.id,
            inviterName: data.inviterName || inviterPlayer.name || '알 수 없음'
        });
    });

    socket.on('party_reject', (payload = {}) => {
        let inviterSocket = io.sockets.sockets.get(payload.inviterSocketId);
        if (inviterSocket) {
            inviterSocket.emit('party_reject', {
                rejectorSocketId: socket.id,
                rejectorName: payload.rejectorName || players[socket.id]?.name || '모험가',
                type: payload.type || 'soft'
            });
        }
    });

    socket.on('party_accept', (data) => {
        let inviterId = data.inviterSocketId;
        let inviteeId = socket.id;

        let inviterPlayer = players[inviterId];
        let inviteePlayer = players[inviteeId];
        if (!inviterPlayer || !inviteePlayer) return;

        let partyA = inviterPlayer.partyId ? parties[inviterPlayer.partyId] : null;
        let partyB = inviteePlayer.partyId ? parties[inviteePlayer.partyId] : null;

        let sizeA = partyA ? partyA.members.length : 1;
        let sizeB = partyB ? partyB.members.length : 1;

        if (partyA && partyB && partyA.id !== partyB.id) {
            if (sizeA + sizeB > 10) {
                socket.emit('system_message', { message: `파티 최대 인원(10명)을 초과하여 합칠 수 없습니다.`, color: '#f55' });
                io.to(inviterId).emit('system_message', { message: `파티 최대 인원(10명) 초과로 초대가 취소되었습니다.`, color: '#f55' });
                return;
            }
        } else if (partyA && !partyB) {
            if (sizeA >= 5) {
                socket.emit('system_message', { message: `파티 정원(5명)이 꽉 차서 가입할 수 없습니다.`, color: '#f55' });
                io.to(inviterId).emit('system_message', { message: `파티 정원(5명) 초과로 초대가 취소되었습니다.`, color: '#f55' });
                return;
            }
        }

        if (!partyA) {
            let newPartyId = 'party_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            partyA = { id: newPartyId, leader: inviterId, mode: 'normal', members: [inviterPlayer] };
            parties[newPartyId] = partyA;
            inviterPlayer.partyId = newPartyId;
        }

        if (partyB && partyB.leader === inviteeId) {
            partyB.members.forEach(member => {
                if (!partyA.members.some(m => m.socketId === member.socketId)) {
                    partyA.members.push(member);
                }
                if (players[member.socketId]) players[member.socketId].partyId = partyA.id;
                let memberSocket = io.sockets.sockets.get(member.socketId);
                if (memberSocket) {
                    memberSocket.leave(partyB.id);
                    memberSocket.join(partyA.id);
                }
            });
            delete parties[partyB.id];
            io.to(partyA.id).emit('system_message', { message: `👥 [${inviteePlayer.name}]님의 파티와 합병되었습니다!`, color: '#5cf' });
        } else {
            if (partyB) {
                partyB.members = partyB.members.filter(m => m.socketId !== inviteeId);
                let pSock = io.sockets.sockets.get(inviteeId);
                if(pSock) pSock.leave(partyB.id);
                io.to(partyB.id).emit('party_update', { party: partyB });
            }
            partyA.members.push(inviteePlayer);
            inviteePlayer.partyId = partyA.id;
            io.to(inviterId).emit('system_message', { message: `👥 ${inviteePlayer.name}님이 파티에 가입했습니다.`, color: '#5cf' });
            socket.emit('system_message', { message: `👥 ${inviterPlayer.name}님의 파티에 가입했습니다.`, color: '#5cf' });
        }

        let sSock = io.sockets.sockets.get(socket.id);
        if(sSock) sSock.join(partyA.id);
        let iSock = io.sockets.sockets.get(inviterId);
        if(iSock) iSock.join(partyA.id);

        io.to(partyA.id).emit('party_update', { party: partyA });
        io.emit('sync_entities', { players: Object.values(players) }); 
    });

    socket.on('party_join_request', (payload = {}) => {
        let targetSocket = io.sockets.sockets.get(payload.targetSocketId);
        let p = players[socket.id];
        if (targetSocket && p) {
            targetSocket.emit('party_join_request_received', {
                requesterSocketId: socket.id,
                requesterName: p.name
            });
        }
    });

    socket.on('party_join_accept', (payload = {}) => {
        let accepter = players[socket.id]; 
        let requester = players[payload.requesterSocketId]; 
        
        if (!accepter || !requester) return;
        if (requester.partyId) return;

        let partyId = accepter.partyId || 'party_' + Date.now();
        
        if (!parties[partyId]) {
            parties[partyId] = {
                id: partyId, leader: accepter.socketId, leaderName: accepter.name, mode: 'normal', members: [accepter, requester]
            };
            accepter.partyId = partyId;
            requester.partyId = partyId;
        } else {
            if (parties[partyId].members.length >= 5) {
                socket.emit('system_message', { message: "파티 정원(5명)이 꽉 차서 받을 수 없습니다.", color: '#f55' });
                return;
            }
            if (!parties[partyId].members.some(m => m.socketId === requester.socketId)) {
                parties[partyId].members.push(requester);
                requester.partyId = partyId;
            }
        }

        let rSock = io.sockets.sockets.get(requester.socketId);
        if (rSock) rSock.join(partyId);
        let aSock = io.sockets.sockets.get(accepter.socketId);
        if (aSock) aSock.join(partyId);

        parties[partyId].members.forEach(member => {
            io.to(member.socketId).emit('party_update', { party: parties[partyId] });
            io.to(member.socketId).emit('system_message', { message: `[파티] ${requester.name}님이 파티에 가입했습니다.`, color: '#5cf' });
        });
    });

    socket.on('party_leader_request', () => {
        let p = players[socket.id];
        if (!p || !p.partyId || !parties[p.partyId]) return;
        let party = parties[p.partyId];
        
        if (party.leader === socket.id) return;

        let leaderSocket = io.sockets.sockets.get(party.leader);
        if (leaderSocket) {
            leaderSocket.emit('party_leader_request_received', {
                requesterSocketId: socket.id,
                requesterName: p.name
            });
        }
    });

    socket.on('party_change_leader', (payload = {}) => {
        let p = players[socket.id];
        if (!p || !p.partyId || !parties[p.partyId]) return;
        let party = parties[p.partyId];
        
        if (party.leader !== socket.id) return;

        let newLeader = party.members.find(m => m.socketId === payload.newLeaderSocketId);
        if (newLeader) {
            party.leader = newLeader.socketId;
            party.leaderName = newLeader.name;
            
            party.members.forEach(member => {
                io.to(member.socketId).emit('party_update', { party });
                io.to(member.socketId).emit('system_message', { message: `[파티] 파티장이 ${newLeader.name}님으로 변경되었습니다.`, color: '#fd0' });
            });
        }
    });

    socket.on('party_kick', (payload = {}) => {
        let p = players[socket.id];
        if (!p || !p.partyId || !parties[p.partyId]) return;
        let party = parties[p.partyId];
        
        if (party.leader !== socket.id) return;

        party.members = party.members.filter(m => m.socketId !== payload.targetSocketId);
        
        let kickedSocket = io.sockets.sockets.get(payload.targetSocketId);
        if (kickedSocket) {
            if (players[payload.targetSocketId]) players[payload.targetSocketId].partyId = null;
            kickedSocket.emit('party_update', { party: null });
            kickedSocket.emit('system_message', { message: "파티에서 추방되었습니다.", color: "#f55" });
        }

        if (party.members.length <= 1) {
            party.members.forEach(m => {
                if (players[m.socketId]) players[m.socketId].partyId = null;
                io.to(m.socketId).emit('party_update', { party: null });
                io.to(m.socketId).emit('system_message', { message: "파티원이 부족하여 파티가 해산되었습니다.", color: "#aaa" });
            });
            delete parties[party.id];
        } else {
            party.members.forEach(m => { io.to(m.socketId).emit('party_update', { party }); });
        }
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
                party.leaderName = party.members[0].name;
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
                if (party.leader === socket.id) {
                    party.leader = party.members[0].socketId;
                    party.leaderName = party.members[0].name;
                }
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

// 3. 서버 몬스터 AI & 보스 장판/타격 연산
function processMonsterAI() {
    let now = Date.now();
    const getDistSq = (x1, y1, x2, y2) => (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    
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
        let playersInMap = Object.values(players).filter(p => p && p.map === mapId && typeof p.x === 'number' && typeof p.y === 'number');
        if (playersInMap.length === 0) continue;

        let allEntitiesInMap = [...playersInMap];
        playersInMap.forEach(p => {
            if (p.mercs && Array.isArray(p.mercs)) {
                p.mercs.forEach(m => {
                    if (m) {
                        m.ownerSocketId = p.socketId;
                        m.id = m.id || ('merc_' + p.socketId);
                    }
                });
                allEntitiesInMap.push(...p.mercs.filter(m => m && typeof m.x === 'number' && typeof m.y === 'number'));
            }
        });

        allEntitiesInMap = allEntitiesInMap.filter(e => e && typeof e.x === 'number' && typeof e.y === 'number');

        state.monsters.forEach(mob => {
            if (!mob || mob.hp <= 0) return;

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
            let isTooFar = target ? getDistSq(target.x, target.y, mob.x, mob.y) > (mob.isBoss ? 810000 : 490000) : false;

            if (!target || target.hp <= 0 || data.isInSafeZone(mapId, target.x, target.y) || isTooFar) {
                mob.targetId = null;
                mob.damageMap = {};
                
                let minDistSq = mob.isBoss ? 422500 : 160000;
                allEntitiesInMap.forEach(e => {
                    if (e.hp > 0 && !data.isInSafeZone(mapId, e.x, e.y)) {
                        let dSq = getDistSq(e.x, e.y, mob.x, mob.y);
                        if (dSq < minDistSq) {
                            minDistSq = dSq;
                            mob.targetId = e.socketId || e.id;
                            target = e;
                        }
                    }
                });
            }
            
            if (mob.targetId && target) {
                if (mob.stunnedUntil && now < mob.stunnedUntil) return;

                let dist = Math.sqrt(getDistSq(target.x, target.y, mob.x, mob.y));
                



                let mName = mob.name || '';
                let isBowMob = mName.includes('저격병') || mName.includes('궁수') || mob.isBow;

                // 💡 1. 리치, 서큐버스를 마법 몬스터 판정에 추가하여 원거리 딜러로 정상 작동하게 보정
                let isSpellMob = mName.includes('장로') || mName.includes('카스파') || mName.includes('세마') || 
                                 mName.includes('발터') || mName.includes('메르키오르') || mName.includes('네크로맨서') || 
                                 mName.includes('마법사') || mName.includes('리치') || mName.includes('서큐버스') || 
                                 mob.isMagicMob || mob.isMagicBoss; 

                let stopDist = (mob.size || 20) + 40;
                if (isBowMob) stopDist = 320;
                else if (isSpellMob) stopDist = 280;

                let atkDelay = mob.isBoss ? 800 : 1400; 
                let canAttack = now - (mob.lastAttackTime || 0) >= atkDelay;

                // 💡 2. [핵심 패치] 보스가 마법을 쏠 것인지를 이동 로직보다 '먼저' 판단합니다.
                let willCastMagic = false;
                let magicRange = 350; // 마법이 닿는 최대 사거리

                if (canAttack && mob.isBoss && dist <= magicRange) {
                    if (mob.isMagicBoss) {
                        willCastMagic = Math.random() < 0.35; // 마법 보스는 거리 상관없이 35%로 대마법 시전
                    } else {
                        // 💡 물리 보스인데, 유저가 근접 사거리 밖으로 계속 도망간다면?
                        if (dist > stopDist + 20) {
                            willCastMagic = Math.random() < 0.45; // 45% 확률로 쫓아가기를 포기하고 원거리 대마법 폭격!
                        } else {
                            willCastMagic = Math.random() < 0.15; // 근접했을 때는 15% 확률로만 마법(평타 위주)
                        }
                    }
                }

                // 💡 마법을 시전하기로 결정했거나, 사거리 안이면 이동을 멈춥니다.
                let shouldMove = (dist > stopDist) && !willCastMagic;

                if (shouldMove) {
                    let angle = Math.atan2(target.y - mob.y, target.x - mob.x);
                    let baseMobSpeed = mob.isBoss ? 85 : Math.min(65, mob.speed || 55);
                    let mSpeed = baseMobSpeed * (200 / 1000); 
                    
                    mob.x = Math.max(150, Math.min(3850, mob.x + Math.cos(angle) * mSpeed));
                    mob.y = Math.max(150, Math.min(3850, mob.y + Math.sin(angle) * mSpeed));
                    mob.angle = angle;
                } else if (canAttack && (dist <= stopDist || willCastMagic)) {
                    mob.lastAttackTime = now;
                    mob.angle = Math.atan2(target.y - mob.y, target.x - mob.x);
                    let ownerSocketId = target.socketId || target.ownerSocketId;

                    let isBossMagic = willCastMagic;

                    if (isBossMagic) {
                        let hpPercent = mob.hp / mob.maxHp;
                        let magicPool = ['파이어볼', '콜 라이트닝', '이럽션'];
                            if (hpPercent <= 0.70) magicPool.push('라이트닝 스톰', '토네이도');
                            if (hpPercent <= 0.40) magicPool.push('블리자드', '저지먼트');
                            if (hpPercent <= 0.20) magicPool.push('미티어 스트라이크', '디스인티그레이트');

                            let magicName = magicPool[Math.floor(Math.random() * magicPool.length)];
                            
                            const SPELL_CONFIGS = {
    '미티어 스트라이크': { delay: 1.35, radius: 150, dmg: 420 }, // 회피를 위해 delay 1.35로 보정
    '디스인티그레이트': { delay: 1.10, radius: 130, dmg: 390 },
    '저지먼트':         { delay: 1.35, radius: 160, dmg: 400 },
    '블리자드':         { delay: 1.20, radius: 140, dmg: 340 },
    '라이트닝 스톰':     { delay: 1.00, radius: 125, dmg: 280 },
    '토네이도':         { delay: 1.00, radius: 125, dmg: 260 },
    '이럽션':           { delay: 0.90, radius: 110, dmg: 200 },
    '파이어볼':         { delay: 0.85, radius: 100, dmg: 150 },
    '콜 라이트닝':       { delay: 0.75, radius: 90,  dmg: 130 }
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

    // 🌟 [핵심 개선] +45px 억까 판정 제거 -> +12px (캐릭터 충돌 반경 수준)로 타이트하게 조절
    if (pDist <= cfg.radius + 12) {
        let targetMr = currentTarget.totalMr || (currentTarget.int ? currentTarget.int * 2 : 50);
        let targetReduc = currentTarget.totalDmgReduction || 0;

        let targetDodge = currentTarget.dodge || 0;
        if (currentTarget.charClass === 'elf') targetDodge += 5; 
        if (Math.random() * 100 < targetDodge) {
            io.to(ownerSocketId).emit('take_damage', { isDodge: true, targetId: currentTarget.id || currentTarget.socketId });
            return;
        }

        let magicRatio = 100 / (100 + targetMr);
        let rawMagicDmg = Math.floor(cfg.dmg * magicRatio);
        let calculatedDmg = Math.max(1, rawMagicDmg - targetReduc);

        // 🌟 [원샷 캡 적용] 요정/법사 의문사 방지를 위해 최대 HP의 65% 초과 대미지는 상쇄
        let maxAllowedDmg = Math.floor((currentTarget.maxHp || 1000) * 0.65);
        let finalMagicDmg = Math.min(calculatedDmg, maxAllowedDmg);

        currentTarget.hp = Math.max(0, currentTarget.hp - finalMagicDmg);
        io.to(ownerSocketId).emit('take_damage', { 
            damage: finalMagicDmg, 
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

                        } else if (isBowMob || isSpellMob) {
                            let isMagic = isSpellMob;
                            let spellName = isMagic ? (mName.includes('카스파') || mName.includes('발터') ? '파이어볼' : '에너지 볼트') : null;
                            
                            // 💡 회피 판정 적용
                            let targetDodge = target.dodge || 0;
                            if (target.charClass === 'elf') targetDodge += 5; 
                            if (Math.random() * 100 < targetDodge) {
                                if (ownerSocketId) io.to(ownerSocketId).emit('take_damage', { isDodge: true, targetId: target.id || target.socketId });
                                return;
                            }

                            let targetDef = target.def || 0;
                            let targetMr = target.totalMr || (target.int ? target.int * 2 : 50);
                            let targetReduc = target.totalDmgReduction || 0;
                            
                            let ratio = isMagic ? (100 / (100 + targetMr)) : (100 / (100 + Math.max(0, targetDef)));
                            let basePower = (mob.atk || 20);
                            let calculatedDmg = Math.max(1, Math.floor(basePower * ratio) - targetReduc);

                            io.to(mapId).emit('monster_attack_action', {
                                monsterId: mob.id,
                                hitType: isMagic ? 'magic_proj' : 'bow',
                                magicName: spellName,
                                fromX: mob.x,
                                fromY: mob.y,
                                targetX: target.x,
                                targetY: target.y,
                                targetId: target.id || target.socketId,
                                angle: mob.angle
                            });

                            let flightTime = Math.max(200, Math.min(600, (dist / 400) * 1000));
                            setTimeout(() => {
                                target.hp = Math.max(0, target.hp - calculatedDmg);
                                if (ownerSocketId) {
                                    io.to(ownerSocketId).emit('take_damage', {
                                        damage: calculatedDmg,
                                        hitType: isMagic ? 'magic' : 'physical',
                                        hpRemaining: target.hp,
                                        targetId: target.id || target.socketId
                                    });
                                }
                            }, flightTime);

                        } else {
                            let targetDef = target.def || 0;
                            let targetReduc = target.totalDmgReduction || 0;
                            
                            // 💡 회피 판정 적용 (물리 공격)
                           let targetDodge = target.dodge || 0;
                            if (target.charClass === 'elf') targetDodge += 5; 
                            if (Math.random() * 100 < targetDodge) {
                                if (ownerSocketId) io.to(ownerSocketId).emit('take_damage', { isDodge: true, targetId: target.id || target.socketId });
                                return;
                            }

                            if (target.charClass === 'knight' || target.charClass === 'royal') {
                                targetDef += 15; 
                                targetReduc += 5 + Math.floor((target.level || 1) / 10); 
                                
                                // 💡 [추가] 보스 상대로 근거리 캐릭터(기사) 대미지 감소 대폭 인센티브 부여
                                if (mob.isBoss) {
                                    targetReduc += 20 + Math.floor((target.level || 1) / 5);
                                }
                            }
                            let defRatio = 100 / (100 + Math.max(0, targetDef));
                            
                            let mobAtkRoll = (mob.atk || 15) * (1.0 + Math.random() * 0.2); 
                            let rawDmg = Math.floor(mobAtkRoll * defRatio);
                            let dmg = Math.max(1, rawDmg - targetReduc);

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
            //}
        });

       let allMercsForSync = [];
        playersInMap.forEach(p => {
            if (p.mercs && Array.isArray(p.mercs)) allMercsForSync.push(...p.mercs);
        });

        let aliveMonsters = state.monsters.filter(m => m.hp > 0 || (m.deadTime && now - m.deadTime < 1500));

     
        const minifyEquip = (eq) => {
            if (!eq) return {};
            return {
                weapon: eq.weapon ? { name: eq.weapon.name, grade: eq.weapon.grade, isBow: eq.weapon.isBow, enchantValue: eq.weapon.enchantValue, sp: eq.weapon.sp } : null,
                armor: eq.armor ? { name: eq.armor.name, grade: eq.armor.grade, enchantValue: eq.armor.enchantValue } : null,
                helmet: eq.helmet ? { name: eq.helmet.name, grade: eq.helmet.grade } : null,
                cloak: eq.cloak ? { name: eq.cloak.name, grade: eq.cloak.grade } : null
            };
        };
      

        const prePlayers = playersInMap.map(p => ({
            id: p.socketId, socketId: p.socketId, name: p.name, level: p.level || 1, charClass: p.charClass || 'knight',
            x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), h: Math.round(p.hp), maxHp: p.maxHp, 
            angle: Number((p.angle || 0).toFixed(2)), a: Number((p.angle || 0).toFixed(2)), isMoving: Boolean(p.isMoving), m: p.isMoving ? 1 : 0, 
            equip: minifyEquip(p.equip), partyId: p.partyId, targetId: p.targetId, t: p.targetId, isPlayer: true
        }));

        const preMercs = allMercsForSync.map(m => ({
            id: m.id, name: m.name, mercType: m.mercType, charClass: m.charClass, ownerId: m.ownerId, ownerName: m.ownerName, 
            x: Math.round(m.x), y: Math.round(m.y), hp: Math.round(m.hp), h: Math.round(m.hp), maxHp: m.maxHp, 
            angle: Number((m.angle || 0).toFixed(2)), a: Number((m.angle || 0).toFixed(2)), isMoving: Boolean(m.isMoving), m: m.isMoving ? 1 : 0,
            equip: minifyEquip(m.equip), isSummon: true, isOtherMerc: true
        }));

        const preMonsters = aliveMonsters.map(m => ({
            id: m.id, name: m.name, x: Math.round(m.x), y: Math.round(m.y), size: m.size || 20, color: m.color,
            hp: Math.max(0, Math.round(m.hp)), h: Math.max(0, Math.round(m.hp)), maxHp: m.maxHp, 
            isBoss: Boolean(m.isBoss), isDead: Boolean(m.isDead || m.hp <= 0),
            angle: Number((m.angle || 0).toFixed(2)), a: Number((m.angle || 0).toFixed(2)), targetId: m.targetId, t: m.targetId
        }));

        const VIEW_RADIUS_SQ = 1440000; // 1200 * 1200

        playersInMap.forEach(receiver => {
            let rx = receiver.x, ry = receiver.y, rId = receiver.socketId;

            // 2. 안쪽 루프에서는 거리만 비교한 뒤, 미리 만들어둔 객체를 그대로 가져옵니다. (연산 비용 0에 수렴)
            let syncPlayers = prePlayers.map(p => {
                if (p.socketId === rId || ((p.x - rx) ** 2 + (p.y - ry) ** 2) <= VIEW_RADIUS_SQ) return p;
                return { id: p.id, socketId: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp, h: p.h, maxHp: p.maxHp, isPlayer: true, m: 0 };
            });

            let syncMercs = preMercs.map(m => {
                if (m.ownerId === rId || ((m.x - rx) ** 2 + (m.y - ry) ** 2) <= VIEW_RADIUS_SQ) return m;
                return { id: m.id, ownerId: m.ownerId, x: m.x, y: m.y, hp: m.hp, h: m.h, isSummon: true, isOtherMerc: true, m: 0 };
            });

            let syncMonsters = preMonsters.map(m => {
                if (m.isBoss || ((m.x - rx) ** 2 + (m.y - ry) ** 2) <= VIEW_RADIUS_SQ) return m;
                return { id: m.id, name: m.name, x: m.x, y: m.y, size: m.size, color: m.color, hp: m.hp, h: m.h, isBoss: m.isBoss };
            });

            io.to(rId).emit('sync_entities', { players: syncPlayers, mercs: syncMercs, monsters: syncMonsters });
        });
    }
}

function processMonsterSpawning() {
    for (let mapId in data.maps) {
        let mData = data.maps[mapId];
        let state = mapsState[mapId];
        let normalMobs = state.monsters.filter(m => !m.isBoss).length;
        let targetMax = mData.maxMobs || 40;

        let deficit = targetMax - normalMobs;
        let spawnBatch = Math.min(deficit, 4);

        if (spawnBatch > 0 && mData.m?.length > 0) {
            let mapScalingMultiplier = 1.0;
            let isEndgameMap = mData.recLv && (mData.recLv.includes('100+') || mData.recLv.includes('105+'));

            if (isEndgameMap) {
                let playersInMap = Object.values(players).filter(p => p && p.map === mapId);
                let maxLevelInMap = 105;
                playersInMap.forEach(p => { if (p.level > maxLevelInMap) maxLevelInMap = p.level; });

                if (maxLevelInMap > 105) {
                    let overLevel = maxLevelInMap - 105;
                    mapScalingMultiplier = 1.0 + (overLevel * 0.15); 
                }
            }

            for (let i = 0; i < spawnBatch; i++) {
                let mobId = mData.m[Math.floor(Math.random() * mData.m.length)];
                let t = data.templates.mobs[mobId];
                if (t) {
                    let rx = Math.random() * 3600 + 200, ry = Math.random() * 3600 + 200;
                    if (!data.isInSafeZone(mapId, rx, ry)) {
                        let finalHp = Math.floor(t.hp * mapScalingMultiplier);
                        let finalAtk = Math.floor(t.atk * mapScalingMultiplier);
                        let finalDef = Math.floor(t.def * mapScalingMultiplier) || t.def;
                        let finalExp = Math.floor(t.exp * mapScalingMultiplier);

                        state.monsters.push({
                            ...t, 
                            id: 'mob_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                            x: rx, y: ry, maxHp: finalHp, hp: finalHp, atk: finalAtk, def: finalDef, exp: finalExp,
                            map: mapId, scalingBonus: mapScalingMultiplier, isBoss: false, targetId: null, lastAttackTime: 0
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
            state.monsters = state.monsters.filter(m => !(m.hp <= 0 && m.deadTime && (now - m.deadTime > 3000)));
        }
        if (state.items) {
            state.items = state.items.filter(item => (now - item.spawnTime) < 60000);
        }
        if (state.deadBosses) {
            state.deadBosses = state.deadBosses.filter(db => {
                if (now - db.deadTime > 300000) { 
                    let bt = data.templates.bosses[db.baseBossId];
                    if (bt) {
                        state.monsters.push({
                            ...bt, id: 'boss_' + db.baseBossId + '_' + Date.now(),
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
setInterval(processMonsterAI, 200);

function startRaidCountdown(roomId) {
    let room = raidRooms[roomId];
    if (!room) return;
    let countdown = 15; 
    let timer = setInterval(() => {
        if (!raidRooms[roomId]) { clearInterval(timer); return; }
        countdown--;
        room.members.forEach(sockId => { io.to(sockId).emit('raid_countdown_tick', { countdown }); });
        if (countdown <= 0) {
            clearInterval(timer);
            room.status = 'STARTED'; 
            let totalLv = 0;
            room.members.forEach(sockId => { let memberP = players[sockId]; if (memberP) totalLv += (memberP.level || 1); });
            let finalAvgLv = Math.floor(totalLv / Math.max(1, room.members.length));
            let finalTier = Math.min(4, Math.floor(finalAvgLv / 20)); 
            room.members.forEach(sockId => { io.to(sockId).emit('raid_battle_start', { tierIndex: finalTier }); });
        }
    }, 1000);
}

setInterval(() => {
    let now = Date.now();
    for (let rId in raidRooms) {
        let room = raidRooms[rId];
        let activeMembers = room.members.filter(sockId => players[sockId]);
        room.members = activeMembers;
        let isGhostRoom = (room.members.length === 0 && (now - room.createdAt > 30000));
        let isExpired = (now - room.createdAt > 7200000); 
        if (isGhostRoom || isExpired) delete raidRooms[rId];
    }
}, 10000);

let isWarningSent = false;
let isRebootTriggered = false;

setInterval(() => {
    const now = new Date();
    const kstTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 60 * 60 * 1000));
    if (kstTime.getDay() === 0 && kstTime.getHours() === 3 && kstTime.getMinutes() === 59) {
        if (!isWarningSent) {
            isWarningSent = true;
            io.emit('system_message', { message: '⚠️ [서버 공지] 1분 뒤 정기 점검을 위해 서버가 재부팅됩니다. 데이터가 안전하게 자동 저장됩니다!', color: '#ff2200' });
            io.emit('force_client_save'); 
        }
    }
    if (kstTime.getDay() === 0 && kstTime.getHours() === 4 && kstTime.getMinutes() === 0) {
        if (!isRebootTriggered) { isRebootTriggered = true; process.exit(0); }
    }
    if (kstTime.getHours() === 5) { isWarningSent = false; isRebootTriggered = false; }
}, 1000);

process.on('uncaughtException', (err) => { console.error('[-] 치명적 오류 발생:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('[-] 처리되지 않은 프로미스 거부:', reason); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[✔] 서버 가동 완료: http://localhost:${PORT}`));