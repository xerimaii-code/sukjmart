//v1
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

// [서버용] 아이템 드롭 및 무작위 옵션/강화/속성 부여 헬퍼 함수
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

    // 🔥 [1] 전설 이상 (Grade 4+): 최대 수치 +100까지 무작위 극옵 부여
    if (grade >= 4) {
        let optCount = Math.floor(Math.random() * 4) + 2; // 2 ~ 5개 옵션
        let legendaryPool = [
            () => { let v = Math.floor(Math.random() * 80) + 21; item.magicOptions.push(`[전설] 추가 대미지 +${v}`); },
            () => { let v = Math.floor(Math.random() * 90) + 11; item.magicOptions.push(`[전설] 추가 방어력 +${v}`); },
            () => { let v = Math.floor(Math.random() * 50) + 10; item.magicOptions.push(`[스탯] STR +${v}`); },
            () => { let v = Math.floor(Math.random() * 50) + 10; item.magicOptions.push(`[스탯] INT +${v}`); },
            () => { let v = Math.floor(Math.random() * 50) + 10; item.magicOptions.push(`[스탯] DEX +${v}`); },
            () => { let v = (Math.floor(Math.random() * 8) + 2) * 100; item.magicOptions.push(`[생명] 최대 HP +${v}`); },
            () => { item.magicOptions.push(`[${['화령','수령','풍령','지령'][Math.floor(Math.random()*4)]}] 속성 대미지 +${Math.floor(Math.random()*30)+10}`); },
            () => { item.magicOptions.push("타격 시 HP 흡수"); },
            () => { item.magicOptions.push("타격 시 MP 흡수"); }
        ];

        for (let i = 0; i < optCount; i++) {
            let pick = legendaryPool[Math.floor(Math.random() * legendaryPool.length)];
            pick();
        }
    }
    // ⚔️ [2] 일반/희귀 (Grade 1~3): 정해진 룰에 따라 무작위 옵션 부여
    else if (grade >= 1) {
        let optCount = Math.floor(Math.random() * grade) + 1; // 1 ~ grade개
        let normalPool = [
            () => { let v = Math.floor(Math.random() * (grade * 5)) + 1; item.magicOptions.push(`[강화] 추가 대미지 +${v}`); },
            () => { let v = Math.floor(Math.random() * (grade * 4)) + 1; item.magicOptions.push(`[강화] 추가 방어력 +${v}`); },
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

    socket.on('player_join', (payload) => {
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

    socket.on('player_update', (payload) => {
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

        if (p.map !== payload.map) {
            socket.leave(p.map); 
            socket.join(payload.map); 
            p.map = payload.map;
            socket.emit('sync_map_state', { monsters: mapsState[p.map].monsters, items: mapsState[p.map].items });
        }
        
        p.name = payload.name || p.name;
        p.charClass = payload.charClass || p.charClass;
        p.x = payload.x; 
        p.y = payload.y; 
        
        if (payload.hp !== undefined) {
            if (payload.hp > p.hp) {
                p.hp = payload.hp; 
            }
        }
        
        p.maxHp = payload.maxHp !== undefined ? payload.maxHp : p.maxHp;
        p.angle = payload.angle || 0;
        p.isMoving = payload.isMoving || false;
        p.equip = payload.equip || p.equip;
        p.mercs = payload.mercs || [];
    });

    socket.on('player_summon_monster', (payload) => {
        let p = players[socket.id];
        if (!p) return;
        
        let pLevel = payload.level || 1;
        let maxSummons = Math.min(3, Math.max(1, Math.floor(pLevel / 15)));
        
        p.mercs = p.mercs || [];
        if (p.mercs.length >= maxSummons) {
            socket.emit('system_message', { 
                message: `[소환 실패] 현재 레벨(Lv.${pLevel})에서는 최대 ${maxSummons}마리까지만 소환할 수 있습니다.`, 
                color: '#f55' 
            });
            return;
        }

        let summonTypes = ['knight', 'elf', 'wizard'];
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

    socket.on('player_magic_action', (payload) => {
        let p = players[socket.id];
        let mapId = (p && p.map) ? p.map : (payload.map || 'talking_island');
        socket.to(mapId).emit('sync_player_magic', {
            casterId: payload.casterId || socket.id, 
            magicName: payload.magicName,
            targetX: payload.targetX,
            targetY: payload.targetY,
            targetId: payload.targetId,
            casterX: payload.casterX !== undefined ? payload.casterX : (p ? p.x : 2000),
            casterY: payload.casterY !== undefined ? payload.casterY : (p ? p.y : 2000),
            x: payload.targetX,
            y: payload.targetY
        });
    });

    socket.on('player_attack_action', (payload) => {
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

    socket.on('player_target', (payload) => {
        let p = players[socket.id];
        if (!p) return;
        p.targetId = payload.targetId;

        if (p.partyId && parties[p.partyId]) {
            let party = parties[p.partyId];
            if (party.leader === socket.id && party.mode === 'focus' && payload.targetId) {
                party.members.forEach(member => {
                    if (member.socketId !== socket.id) {
                        io.to(member.socketId).emit('party_target_shared', { targetId: payload.targetId });
                    }
                });
            }
        }
    });

    socket.on('player_use_potion', (payload) => {
        let p = players[socket.id];
        if (p) {
            socket.to(p.map).emit('sync_player_potion', {
                socketId: socket.id,
                potionName: payload.potionName
            });
        }
    });

    socket.on('chat_message', (payload) => {
        let p = players[socket.id];
        let name = p ? p.name : '모험가';
        io.emit('chat_broadcast', {
            senderId: socket.id,
            socketId: socket.id,
            name: name,
            message: payload.message
        });
    });

    // ⚔️ [서버 권위형] 몬스터 타격 수신 및 데미지/흡혈 단독 연산
    const handlePlayerAttack = (payload) => {
        let p = players[socket.id];
        if (!p || !mapsState[p.map]) return;
        
        let monster = mapsState[p.map].monsters.find(m => m.id === payload.targetId);
        if (!monster || monster.hp <= 0) return;

        let hitType = payload.attackType || 'physical';
        let isMagic = hitType === 'magic';
        let spellName = payload.magicName;
        let finalDamage = 10;

        if (typeof payload.calculatedDmg === 'number' && payload.calculatedDmg > 0) {
            finalDamage = Math.max(1, payload.calculatedDmg - Math.floor((monster.def || 0) / 3));
        } else {
            let pStr = p.str || 18;
            let statAtk = Math.max(1, Math.floor((pStr - 10) * 3.2));
            let wpAtk = (p.equip && p.equip.weapon ? p.equip.weapon.atk || 0 : 0);
            finalDamage = Math.max(1, statAtk + wpAtk - Math.floor((monster.def || 0) / 3));
        }

        monster.hp -= finalDamage;
        
        if (spellName === '쇼크 스턴') {
            monster.stunnedUntil = Date.now() + 2500;
        }

        monster.damageMap = monster.damageMap || {};
        let actualAttackerId = payload.attackerId || socket.id;
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

        // 몬스터 사망 판정
        if (monster.hp <= 0) {
            monster.hp = 0;
            io.to(p.map).emit('monster_dead', { monsterId: monster.id });
            
            // 경험치 지급
            let rewardExp = monster.isBoss ? (monster.exp || 50000) : (monster.exp || 100);
            socket.emit('player_exp_gain', { exp: rewardExp });

            // 💰 아데나 지급 (보스는 50,000 ~ 200,000 아데나 폭발)
            let adenaCount = monster.isBoss 
                ? Math.floor(Math.random() * 150000 + 50000)
                : Math.floor(Math.random() * 200 + 50);

            socket.emit('item_looted_success', { 
                item: { name: '아데나', type: 'currency', count: adenaCount } 
            });

            // 👑 [보스 드롭] 3 ~ 6개 대량 아이템 폭발 드롭
            let dropCount = monster.isBoss ? (Math.floor(Math.random() * 4) + 3) : (Math.random() < 0.25 ? 1 : 0);

            for (let i = 0; i < dropCount; i++) {
                let targetGrade = 0;
                let rand = Math.random() * 100;
                let mHp = monster.maxHp || 1000;

                if (monster.isBoss) {
                    if (mHp >= 1000000) targetGrade = rand < 8.0 ? 7 : (rand < 28.0 ? 6 : (rand < 68.0 ? 5 : 4));
                    else if (mHp >= 300000) targetGrade = rand < 3.0 ? 7 : (rand < 12.0 ? 6 : (rand < 45.0 ? 5 : 4));
                    else if (mHp >= 50000) targetGrade = rand < 1.5 ? 6 : (rand < 15.0 ? 5 : (rand < 55.0 ? 4 : 3));
                    else targetGrade = rand < 3.0 ? 5 : (rand < 25.0 ? 4 : (rand < 65.0 ? 3 : 2));
                } else {
                    targetGrade = rand < 0.1 ? 4 : (rand < 2.0 ? 3 : (rand < 12.0 ? 2 : (Math.random() < 0.5 ? 1 : 0)));
                }

                let gradePool = data.itemDb.filter(it => (it.grade || 0) === targetGrade);
                if (gradePool.length === 0) gradePool = data.itemDb.filter(it => (it.grade || 0) <= targetGrade);

                if (gradePool.length > 0) {
                    let baseChosen = gradePool[Math.floor(Math.random() * gradePool.length)];
                    let finalDropItem = generateServerDropItem(baseChosen);

                    // 보스 주변 사방으로 흩뿌려지도록 분산 좌표 설정
                    let spreadAngle = (Math.PI * 2 / Math.max(1, dropCount)) * i + (Math.random() * 0.4 - 0.2);
                    let spreadDist = Math.random() * 60 + 20;

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

            if (monster.isBoss) {
                mapsState[p.map].deadBosses.push({ baseBossId: monster.baseBossId, spawnX: monster.spawnX, spawnY: monster.spawnY, deadTime: Date.now() });
                io.to(p.map).emit('system_message', { 
                    message: `👑 [보스 토벌] ${p.name} 님께서 [${monster.name}]을(를) 쓰러뜨렸습니다!`, 
                    color: '#ffdd00' 
                });
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

    socket.on('party_invite', (payload) => {
        let targetSocket = io.sockets.sockets.get(payload.targetSocketId);
        if (targetSocket) {
            targetSocket.emit('party_invite_received', {
                inviterSocketId: socket.id,
                inviterName: payload.inviterName || players[socket.id]?.name || '알 수 없음'
            });
        }
    });

    socket.on('party_accept', (payload) => {
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
    });
});

// 3. 서버 몬스터 AI & 보스 장판/타격 연산 (100ms)
function processMonsterAI() {
    let now = Date.now();
    
    // 💡 [최적화 및 분리] 파티원 체력 동기화는 0.5초 주기로 가볍게 처리하여 렉 원인 제거
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
                    let mSpeed = (mob.isBoss ? 140 : (mob.speed || 90)) * (100 / 1000);
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
                            let dmg = Math.max(1, (mob.atk || 15) - Math.floor((target.def || 0) / 3));
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
                x: p.x, 
                y: p.y, 
                hp: p.hp, 
                maxHp: p.maxHp, 
                angle: p.angle, 
                isMoving: p.isMoving,
                equip: p.equip,
                partyId: p.partyId,
                targetId: p.targetId
            })),
            mercs: allMercsForSync,
            monsters: state.monsters.map(m => ({ 
                id: m.id, 
                name: m.name, 
                x: m.x, 
                y: m.y, 
                hp: m.hp, 
                maxHp: m.maxHp, 
                isBoss: m.isBoss, 
                angle: m.angle, 
                color: m.color 
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

setInterval(processMonsterSpawning, 1000);
setInterval(processMonsterAI, 100);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[✔] 서버 가동 완료: http://localhost:${PORT}`));