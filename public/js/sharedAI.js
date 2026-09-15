// sharedAI.js - 플레이어, 용병, 에이전트 공통 AI 엔진 (🚀 fastHypot 수학 최적화 및 용병/타겟팅 좌표 정밀 연동본)
(function(global) {
    const fastHypot = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

    const SharedAI = {
        processRoutine: function(entity, env) {
            if (!entity || entity.hp <= 0 || entity.isDead || env.state === 'SHOPPING') return;

            if (!env.now) env.now = performance.now();
            let now = env.now;

            let isManualMoving = now < (entity.manualOverrideUntil || 0);
            let skipSearch = false;
            let pClass = entity.charClass || entity.mercType || 'knight';
            
            let isMerc = Boolean(entity.isMercenary || entity.isOtherMerc || entity.isSummon);
            let myLeader = isMerc ? (env.entities.find(e => e && (e.id === entity.ownerId || e.socketId === entity.ownerId || e.socketId === entity.ownerSocketId))) : null;

            if (isMerc && myLeader) {
                let distToLeader = fastHypot(myLeader.x - entity.x, myLeader.y - entity.y);
                if (distToLeader > 700) {
                    let angle = Math.random() * Math.PI * 2;
                    entity.x = myLeader.x + Math.cos(angle) * 40;
                    entity.y = myLeader.y + Math.sin(angle) * 40;
                    entity.target = myLeader.target ? env.entities.find(e => e && e.id === myLeader.target.id) : null;
                    entity.targetId = entity.target ? entity.target.id : null;
                    entity.isMoving = false;
                    entity.moveX = undefined;
                    entity.moveY = undefined;
                }
            }

            if (!isMerc && !entity.target && !isManualMoving && env.items && env.items.length > 0) {
                let closestItem = null;
                let minItemDist = Infinity;
                
                env.items.forEach(it => {
                    if (it && (it.map === env.currentMap || !it.map)) {
                        let itemGrade = it.grade || 0;
                        let isAlwaysLoot = ['scroll', 'book', 'potion', 'currency'].includes(it.type);
                        let minGrade = env.minLootGrade || 0;
                        
                        if ((isAlwaysLoot || itemGrade >= minGrade)) {
                            if (!(env.isInSafeZone && env.isInSafeZone(env.currentMap, it.x, it.y))) {
                                let d = fastHypot(it.x - entity.x, it.y - entity.y);
                                if (d < minItemDist) { 
                                    minItemDist = d; 
                                    closestItem = it; 
                                }
                            }
                        }
                    }
                });

                if (closestItem && minItemDist < 300) {
                    entity.targetItem = closestItem;
                    entity.moveX = closestItem.x;
                    entity.moveY = closestItem.y;
                    entity.isMoving = true;
                    if (minItemDist <= 35 && typeof env.lootItem === 'function') {
                        env.lootItem(closestItem);
                        entity.targetItem = null;
                        entity.isMoving = false;
                        entity.moveX = undefined;
                        entity.moveY = undefined;
                    }
                    skipSearch = true;
                }
            }

            if (!skipSearch && !isManualMoving) {
                if (isMerc && myLeader && myLeader.target && (!entity.target || (entity.target.hp ?? entity.target.h ?? 0) <= 0 || entity.target.isDead)) {
                    let leaderTarget = env.entities.find(e => e && e.id === myLeader.target.id && (e.hp ?? e.h ?? 0) > 0 && !e.isDead);
                    if (leaderTarget) {
                        entity.target = leaderTarget;
                        entity.targetId = leaderTarget.id;
                    }
                }

                let isFocusMode = env.party && env.party.isFocusMode;
                let leaderSocketId = env.party ? env.party.leaderId : null;
                let amIFollower = env.party && isFocusMode && leaderSocketId !== entity.socketId && leaderSocketId !== entity.id;
                let leaderTargetMob = null;
                
                if (amIFollower) {
                    let leaderTargetId = env.party.leaderTargetId;

                    if (leaderTargetId) {
                        leaderTargetMob = env.entities.find(e => e && e.id === leaderTargetId && (e.hp ?? e.h ?? 0) > 0 && !e.isDead && e.map === env.currentMap);
                    }
                    
                    let leaderEnt = env.party.leaderEnt || env.entities.find(e => e && e.isPlayer && (e.id === leaderSocketId || e.socketId === leaderSocketId));
                    let distToLeader = leaderEnt ? fastHypot(leaderEnt.x - entity.x, leaderEnt.y - entity.y) : 0;
                    
                    if ((!entity.target || (entity.target.hp ?? entity.target.h ?? 0) <= 0) && leaderEnt && distToLeader > 700) {
                        entity.target = null;
                        entity.targetId = null;
                        let angle = Math.atan2(leaderEnt.y - entity.y, leaderEnt.x - entity.x);
                        entity.moveX = leaderEnt.x - Math.cos(angle) * 100;
                        entity.moveY = leaderEnt.y - Math.sin(angle) * 100;
                        entity.isMoving = true;
                        skipSearch = true;
                    } else if (leaderTargetMob) {
                        if (!entity.target || entity.target.id !== leaderTargetMob.id) {
                            entity.target = leaderTargetMob;
                            entity.targetId = leaderTargetMob.id;
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        }
                        skipSearch = true;
                    } else if (leaderEnt) {
                        if (entity.target) {
                            entity.target = null;
                            entity.targetId = null;
                        }
                        if (distToLeader > 90) {
                            let angle = Math.atan2(leaderEnt.y - entity.y, leaderEnt.x - entity.x);
                            entity.moveX = leaderEnt.x - Math.cos(angle) * 60;
                            entity.moveY = leaderEnt.y - Math.sin(angle) * 60;
                            entity.isMoving = true;
                        } else {
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        }
                        skipSearch = true;
                    }
                }

                if (entity.target) {
                    let liveTarget = env.entities.find(e => {
                        if (!e || e.id !== entity.target.id || e.isDead) return false;
                        let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                        return curHp > 0;
                    });

                    if (!liveTarget || liveTarget.map !== env.currentMap || (env.isInSafeZone && env.isInSafeZone(env.currentMap, liveTarget.x, liveTarget.y))) {
                        entity.target = null;
                        entity.targetId = null;
                        entity.isMoving = false;
                        entity.moveX = undefined;
                        entity.moveY = undefined;
                        if (typeof env.shareTarget === 'function') env.shareTarget(null);
                    } else {
                        entity.target = liveTarget;
                        entity.targetId = liveTarget.id;
                    }
                }

                let target = entity.target;
                let isFocusLocked = amIFollower && leaderTargetMob;

                if (target && !isFocusLocked) {
                    let distToTarget = fastHypot(target.x - entity.x, target.y - entity.y);
                    let attackers = env.entities.filter(e => {
                        if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isDead) return false;
                        let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                        return curHp > 0 && (e.targetId === entity.id || e.targetId === entity.socketId || e.t === entity.id);
                    });
                    let bossAttacker = attackers.find(e => e.isBoss);
                    
                    let nearbyDangerMob = env.entities.find(m => {
                        if (!m || m.isSummon || m.isPlayer || m.isDead || m.map !== env.currentMap || m.isBoss) return false;
                        let curHp = (m.hp !== undefined) ? m.hp : (m.h !== undefined ? m.h : 0);
                        return curHp > 0 && fastHypot(m.x - entity.x, m.y - entity.y) < 140;
                    });

                    if (target.isBoss && nearbyDangerMob) {
                        entity.target = nearbyDangerMob;
                        entity.targetId = nearbyDangerMob.id;
                    } else if (!target.isBoss) {
                        if (bossAttacker) {
                            entity.target = bossAttacker;
                            entity.targetId = bossAttacker.id;
                            if (typeof env.shareTarget === 'function') env.shareTarget(bossAttacker.id);
                        } 
                        else if (distToTarget > 250 && entity.isMoving) {
                            let closerMob = env.entities.find(e => {
                                if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isDead || e.isBoss) return false;
                                let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                return curHp > 0 && fastHypot(e.x - entity.x, e.y - entity.y) < distToTarget - 100;
                            });
                            if (closerMob) {
                                entity.target = closerMob;
                                entity.targetId = closerMob.id;
                                if (typeof env.shareTarget === 'function') env.shareTarget(closerMob.id);
                            }
                        } 
                        else if (entity.hp < (entity.maxHp || 100) * 0.4 && attackers.length > 0) {
                            let closestAttacker = attackers.sort((a, b) => fastHypot(a.x - entity.x, a.y - entity.y) - fastHypot(b.x - entity.x, b.y - entity.y))[0];
                            if (closestAttacker && closestAttacker.id !== target.id) {
                                entity.target = closestAttacker;
                                entity.targetId = closestAttacker.id;
                                if (typeof env.shareTarget === 'function') env.shareTarget(closestAttacker.id);
                            }
                        }
                    }
                }

                if (!entity.target || (entity.target.hp ?? entity.target.h ?? 0) <= 0 || entity.target.isDead) {
                    let bestTarget = null;
                    let bestScore = Infinity;
                    let fallbackTarget = null;
                    let fallbackDist = Infinity;
                    let isIgnoredActive = now < (entity.ignoredUntil || 0);

                    if (env.entities) {
                        env.entities.forEach(e => {
                            if (!e || typeof e.x !== 'number' || typeof e.y !== 'number' || e.map !== env.currentMap) return;
                            if (e.isSummon || e.isPlayer || e.isOtherMerc || e.isDead) return;

                            let eHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : (e.maxHp || 100));
                            if (typeof eHp === 'number' && eHp <= 0) return;

                            if (env.isInSafeZone && env.isInSafeZone(env.currentMap, e.x, e.y)) return;
                            if (isIgnoredActive && e.id === entity.ignoredTargetId) return;

                            let rawDist = fastHypot(e.x - entity.x, e.y - entity.y);
                            let edgeDist = Math.max(0, rawDist - (e.size || 20));
                            
                            if (edgeDist <= 900) {
                                let score = edgeDist;
                                if (e.isBoss) score -= 5000; 
                                if (score < bestScore) {
                                    bestScore = score;
                                    bestTarget = e;
                                }
                            } else {
                                if (edgeDist < fallbackDist) {
                                    fallbackDist = edgeDist;
                                    fallbackTarget = e;
                                }
                            }
                        });
                    }

                    if (bestTarget) {
                        entity.target = bestTarget;
                        entity.targetId = bestTarget.id;
                        if (typeof env.shareTarget === 'function') env.shareTarget(bestTarget.id);
                    } else if (fallbackTarget) {
                        let approachAngle = Math.atan2(fallbackTarget.y - entity.y, fallbackTarget.x - entity.x);
                        let maxMap = env.mapSize || 4000;
                        entity.moveX = Math.max(150, Math.min(maxMap - 150, entity.x + Math.cos(approachAngle) * 350));
                        entity.moveY = Math.max(150, Math.min(maxMap - 150, entity.y + Math.sin(approachAngle) * 350));
                        entity.isMoving = true;
                    } else {
                        if (!entity.isMoving || (entity.moveX && fastHypot(entity.moveX - entity.x, entity.moveY - entity.y) < 20)) {
                            let maxMap = env.mapSize || 4000;
                            let rx = entity.x + (Math.random() * 600 - 300); 
                            let ry = entity.y + (Math.random() * 600 - 300);
                            if (rx > 150 && rx < maxMap - 150 && ry > 150 && ry < maxMap - 150) {
                                if (!(env.isInSafeZone && env.isInSafeZone(env.currentMap, rx, ry))) {
                                    entity.moveX = rx; 
                                    entity.moveY = ry; 
                                    entity.isMoving = true;
                                }
                            }
                        }
                    }
                }
            }

            let target = entity.target;
            let isBow = Boolean(entity.equip && entity.equip.weapon && (entity.equip.weapon.isBow || (entity.equip.weapon.name && entity.equip.weapon.name.includes('활'))));
            let isWizard = pClass === 'wizard';
            
            let weaponName = (entity.equip && entity.equip.weapon && entity.equip.weapon.name) || '';
            let isMeleeWeapon = weaponName.includes('검') || weaponName.includes('도') || weaponName.includes('단검') || weaponName.includes('창') || weaponName.includes('대검');
            let isRangedAttacker = (isBow || isWizard) && !isMeleeWeapon;
            
            let atkRange = isRangedAttacker ? 280 : ((target ? target.size || 20 : 20) + 55);

            let currentMp = entity.mp || 0;
            let maxMp = entity.maxMp || 100;
            let chosenSpell = null;

            if (target) {
                let dbRef = typeof magicDb !== 'undefined' ? magicDb : (typeof data !== 'undefined' ? data.magicDb : {});

                if (isMerc) {
                    if (!entity.skills || entity.skills.length === 0) {
                        let lv = entity.level || 1;
                        if (pClass === 'wizard') {
                            entity.skills = ['에너지 볼트'];
                            if (lv >= 10) entity.skills.push('파이어볼');
                            if (lv >= 20) entity.skills.push('아이스 스파이크');
                            if (lv >= 30) entity.skills.push('이럽션', '선버스트');
                            if (lv >= 40) entity.skills.push('블리자드', '디스인티그레이트', '저지먼트');
                        } else if (pClass === 'elf') {
                            entity.skills = ['네이쳐스 터치'];
                            if (lv >= 10) entity.skills.push('스톰 샷');
                            if (lv >= 20) entity.skills.push('트리플 애로우');
                        } else {
                            entity.skills = ['쇼크 스턴'];
                        }
                    }

                    if (target.isBoss) {
                        let bossSpells = ['디스인티그레이트', '저지먼트', '블리자드', '선버스트', '이럽션', '파이어볼', '에너지 볼트'];
                        let validSpell = bossSpells.find(s => dbRef[s] && entity.mp >= (dbRef[s].mp || 0) && entity.skills.includes(s));
                        chosenSpell = validSpell || '에너지 볼트';
                    } else if (typeof window !== 'undefined' && typeof window.selectOptimalSpell === 'function') {
                        let nearbyCount = env.entities ? env.entities.filter(e => e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && fastHypot(e.x - target.x, e.y - target.y) <= 180).length : 0;
                        chosenSpell = window.selectOptimalSpell(entity, nearbyCount, target);
                    }
                } else {
                    if (target.isBoss && entity.magic) {
                        let bossSpells = ['디스인티그레이트', '저지먼트', '블리자드', '선버스트', '이럽션', '파이어볼', '에너지 볼트'];
                        chosenSpell = bossSpells.find(s => entity.magic.includes(s) && entity.mp >= (dbRef[s]?.mp || 0)) || null;
                    } else if (typeof env.getSmartAutoCombatSpell === 'function') {
                        chosenSpell = env.getSmartAutoCombatSpell(target);
                    }
                }
            }
            let isWizardWithoutMp = isWizard && !isMeleeWeapon && !chosenSpell; 
            let actionTaken = false;

            if (isWizard) {
                let allies = [];
                if (env.entities) {
                    allies = env.entities.filter(e => 
                        e && e.map === env.currentMap && (e.isPlayer || e.isSummon || e.isOtherMerc) && e.hp > 0 && !e.isDead &&
                        (e.hp / (e.maxHp || 100)) <= 0.45
                    );
                }

                if (allies.length > 0 && currentMp >= 15 && (now - (entity.lastHealTime || 0) > 3000)) {
                    if (!env.globalHealLock || now - env.globalHealLock > 2000) {
                        env.globalHealLock = now;
                        entity.lastHealTime = now;
                        actionTaken = true;
                        
                        allies.sort((a, b) => (a.hp / (a.maxHp || 100)) - (b.hp / (b.maxHp || 100)));
                        let healTarget = allies[0];
                        
                        if (typeof env.castAttackSpell === 'function') {
                            env.castAttackSpell(healTarget, '힐', entity);
                        }
                    }
                }
            }

            if ((pClass === 'knight' || pClass === 'royal') && target && !isManualMoving) {
                let rushDist = fastHypot(target.x - entity.x, target.y - entity.y);
                if (rushDist > 55 && rushDist <= 350 && (now - (entity.lastRushTime || 0) > 2000)) {
                    entity.lastRushTime = now;
                    let rushAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                    entity.angle = rushAngle;
                    entity.x = target.x - Math.cos(rushAngle) * 30;
                    entity.y = target.y - Math.sin(rushAngle) * 30;
                    entity.isMoving = false;
                    entity.moveX = undefined;
                    entity.moveY = undefined;

                    if (typeof env.spawnParticle === 'function') env.spawnParticle(entity.x, entity.y, 'haste_tornado');
                    if (typeof env.playSound === 'function') env.playSound('spell');
                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast("⚡ RUSH!", target.x, target.y, target.id, 'high', entity, 16);
                }
            }

            let dodgeX = 0, dodgeY = 0;
            if (target && target.isBoss && env.entities) {
                env.entities.forEach(other => {
                    if (other && !other.isPlayer && !other.isSummon && !other.isOtherMerc && other.hp > 0 && !other.isDead && other.id !== target.id) {
                        let d = fastHypot(entity.x - other.x, entity.y - other.y);
                        if (d < 120 && d > 10) {
                            let repelForce = (120 - d) / 120;
                            dodgeX += ((entity.x - other.x) / d) * repelForce * 35;
                            dodgeY += ((entity.y - other.y) / d) * repelForce * 35;
                        }
                    }
                });
            }

            if (target && typeof target.x === 'number' && typeof target.y === 'number' && (target.hp ?? target.h ?? 0) > 0 && !target.isDead) {
                let dist = fastHypot(target.x - entity.x, target.y - entity.y);
                let timeSinceLastAtk = now - (entity.lastAttack || 0);
                let currentAtkDelay = env.atkDelay || 900;
                let isWaitingCd = timeSinceLastAtk < currentAtkDelay; 
                let isTargetingUs = (target.targetId === entity.id || target.targetId === entity.socketId || target.t === entity.id);

                if (!isManualMoving) {
                    let maxMap = env.mapSize || 4000;
                    let margin = 150; 

                    if (isRangedAttacker) {
                        let closeThreshold = isWizardWithoutMp ? 250 : 180; 
                        let idealRange = isWizardWithoutMp ? 300 : 230;     

                        if (isWizardWithoutMp && !isTargetingUs && dist > closeThreshold && dodgeX === 0 && dodgeY === 0) {
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        }
                        else if (isWaitingCd && dist >= closeThreshold + 20 && dist <= atkRange && dodgeX === 0 && dodgeY === 0) {
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        } 
                        else if (dist < closeThreshold || dist > atkRange - 10 || dodgeX !== 0 || dodgeY !== 0) {
                            let targetX, targetY;

                            if (dist < closeThreshold) { 
                                let escapeAngle;
                                let retreatDist = isWizardWithoutMp ? 250 : 200; 
                                let fleeAngle = Math.atan2(entity.y - target.y, entity.x - target.x);
                                
                                let allySumX = 0, allySumY = 0, allyCount = 0;
                                if (env.entities) {
                                    env.entities.forEach(e => {
                                        if (e && e.map === env.currentMap && (e.isPlayer || e.isSummon || e.isOtherMerc) && e.hp > 0 && !e.isDead && e.id !== entity.id) {
                                            if (fastHypot(e.x - entity.x, e.y - entity.y) < 600) {
                                                allySumX += e.x; allySumY += e.y; allyCount++;
                                            }
                                        }
                                    });
                                }

                                if (allyCount > 0) {
                                    let allyCenterX = allySumX / allyCount;
                                    let allyCenterY = allySumY / allyCount;
                                    
                                    let angleFromAlly = Math.atan2(entity.y - allyCenterY, entity.x - allyCenterX);
                                    let tangentAngle = angleFromAlly + 1.25; 

                                    let fleeWeight = (dist < 100) ? 0.7 : 0.3;
                                    let orbitWeight = 1.0 - fleeWeight;

                                    let cx = Math.cos(tangentAngle) * orbitWeight + Math.cos(fleeAngle) * fleeWeight;
                                    let cy = Math.sin(tangentAngle) * orbitWeight + Math.sin(fleeAngle) * fleeWeight;
                                    escapeAngle = Math.atan2(cy, cx);
                                } else {
                                    escapeAngle = fleeAngle;
                                }

                                let isNearWallX = entity.x < margin + 50 || entity.x > maxMap - margin - 50;
                                let isNearWallY = entity.y < margin + 50 || entity.y > maxMap - margin - 50;
                                
                                if (isNearWallX || isNearWallY) {
                                    let centerAngle = Math.atan2(maxMap/2 - entity.y, maxMap/2 - entity.x);
                                    let cx = Math.cos(escapeAngle) * 0.3 + Math.cos(centerAngle) * 0.7;
                                    let cy = Math.sin(escapeAngle) * 0.3 + Math.sin(centerAngle) * 0.7;
                                    escapeAngle = Math.atan2(cy, cx);
                                    retreatDist = 250;
                                }

                                targetX = entity.x + Math.cos(escapeAngle) * retreatDist + dodgeX;
                                targetY = entity.y + Math.sin(escapeAngle) * retreatDist + dodgeY;
                            } else {
                                let approachAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                                targetX = target.x - Math.cos(approachAngle) * idealRange + dodgeX;
                                targetY = target.y - Math.sin(approachAngle) * idealRange + dodgeY;
                            }

                            let clampedX = Math.max(margin, Math.min(maxMap - margin, targetX));
                            let clampedY = Math.max(margin, Math.min(maxMap - margin, targetY));
                            
                            entity.moveX = clampedX;
                            entity.moveY = clampedY;
                            entity.isMoving = true;
                        } else {
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        }
                    } else {
                        let closeRange = Math.max(30, atkRange - 5);
                        let stopRange = atkRange + 25;

                        if (dist > stopRange || dodgeX !== 0 || dodgeY !== 0) {
                            let charAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                            entity.moveX = target.x - Math.cos(charAngle) * closeRange + dodgeX; 
                            entity.moveY = target.y - Math.sin(charAngle) * closeRange + dodgeY; 
                            entity.moveX = Math.max(100, Math.min(maxMap - 100, entity.moveX));
                            entity.moveY = Math.max(100, Math.min(maxMap - 100, entity.moveY));
                            entity.isMoving = true;
                        } else {
                            entity.isMoving = false; 
                            entity.moveX = undefined; 
                            entity.moveY = undefined;
                        }
                    }
                }

                if (dist <= atkRange + 30 && !isWaitingCd && !actionTaken) {
                    entity.isMoving = false;
                    entity.moveX = undefined;
                    entity.moveY = undefined;
                    entity.lastAttack = now;
                    entity.angle = Math.atan2(target.y - entity.y, target.x - entity.x);
                    let baseAtk = entity.atk || 20;

                    if (pClass === 'knight' || pClass === 'royal') {
                        let isCoolingDown = now < (entity.furyCooldownUntil || 0);
                        let isFury = now < (entity.furyUntil || 0);
                        if (!isFury && !isCoolingDown) {
                            let attackersNear = env.entities ? env.entities.filter(e => {
                                if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isDead) return false;
                                let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                return curHp > 0 && fastHypot(e.x - entity.x, e.y - entity.y) < 150 && (e.targetId === entity.id || e.targetId === entity.socketId || e.t === entity.id);
                            }) : [];
                            let hpRatio = entity.hp / (entity.maxHp || 100);
                            if (attackersNear.length >= 3 || hpRatio < 0.4) {
                                entity.furyUntil = now + 4000;
                                entity.furyCooldownUntil = now + 6000;
                                entity.furyCleavedThisCycle = false;
                                if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast("🔥 BERSERK FURY! (광폭화)", entity.x, entity.y, null, 'ultimate', entity, 20);
                            }
                        }
                    }

                    if (chosenSpell) {
                        if (typeof env.castAttackSpell === 'function') {
                            env.castAttackSpell(target, chosenSpell, entity);
                            
                            if (chosenSpell === '트리플 애로우' && pClass === 'elf') {
                                let isCoolingDown = now < (entity.elfFuryCooldownUntil || 0);
                                if (!(now < (entity.elfFuryUntil || 0)) && !isCoolingDown) {
                                    entity.elfHitCount = (entity.elfHitCount || 0) + 3;
                                    if (entity.elfHitCount >= 5) {
                                        entity.elfHitCount = 0;
                                        entity.elfFuryUntil = now + 4000;
                                        entity.elfFuryCooldownUntil = now + 6000;
                                        entity.elfFuryTextShown = false;
                                        if (typeof env.spawnText === 'function') env.spawnText(entity.x, entity.y - 50, "🌪️ SYLPH TEMPEST! (실프의 폭풍)", '#34d399', 20);
                                    }
                                }
                            }
                        }
                    } 
                    else if (isWizardWithoutMp) {
                        // MP 부족 시 물리 타격 생략
                    } 
                    else {
                        if (pClass === 'knight' || pClass === 'royal') {
                            let isFury = now < (entity.furyUntil || 0);
                            let finalDamage = isFury ? Math.floor(baseAtk * 2.0) : baseAtk;
                            
                            if (typeof env.playSound === 'function') env.playSound('swing');

                            if (typeof env.damageEntity === 'function') env.damageEntity(target, finalDamage, entity, 'physical');

                            if (isFury) {
                                let splashTargets = env.entities ? env.entities.filter(e => {
                                    if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isOtherMerc || e.isDead || e.id === target.id) return false;
                                    let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                    return curHp > 0 && fastHypot(e.x - target.x, e.y - target.y) <= 95;
                                }) : [];
                                
                                let totalCleaveDmg = 0; 
                                splashTargets.forEach(st => {
                                    let sDmg = Math.floor(finalDamage * 0.6);
                                    totalCleaveDmg += sDmg;
                                    if (typeof env.damageEntity === 'function') env.damageEntity(st, sDmg, entity, 'physical');
                                });
                                
                                let healAmount = Math.floor((finalDamage + totalCleaveDmg) * 0.25);
                                entity.hp = Math.min(entity.maxHp || 100, entity.hp + healAmount);
                                
                                if (healAmount > 0 && typeof env.spawnText === 'function') env.spawnText(entity.x, entity.y - 30, `+${healAmount} 흡혈`, '#e879f9', 13);
                                
                                if (!entity.furyCleavedThisCycle) {
                                    entity.furyCleavedThisCycle = true;
                                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('광폭화 클리브', target.x, target.y, target.id, 'ultimate', entity);
                                }
                            } else {
                                entity.furyCleavedThisCycle = false;
                            }
                        }
                        else if (pClass === 'elf') {
                            let isCoolingDown = now < (entity.elfFuryCooldownUntil || 0);
                            if (!(now < (entity.elfFuryUntil || 0)) && !isCoolingDown) {
                                entity.elfHitCount = (entity.elfHitCount || 0) + 1;
                                if (entity.elfHitCount >= 5) {
                                    entity.elfHitCount = 0;
                                    entity.elfFuryUntil = now + 4000;
                                    entity.elfFuryCooldownUntil = now + 6000;
                                    entity.elfFuryTextShown = false;
                                    if (typeof env.spawnText === 'function') env.spawnText(entity.x, entity.y - 50, "🌪️ SYLPH TEMPEST! (실프의 폭풍)", '#34d399', 20);
                                }
                            }

                            let isFury = now < (entity.elfFuryUntil || 0);
                            if (typeof env.playSound === 'function') env.playSound('bow');

                            if (isFury) {
                                let splashTargets = env.entities ? env.entities.filter(e => {
                                    if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isOtherMerc || e.isDead) return false;
                                    let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                    return curHp > 0 && fastHypot(e.x - target.x, e.y - target.y) <= 200;
                                }) : [];
                                
                                let bowEnchant = (entity.equip && entity.equip.weapon && entity.equip.weapon.enchantValue) ? entity.equip.weapon.enchantValue : 0;
                                let furyMultiplier = 1.4 + (bowEnchant * 0.1);
                                let furyAtk = Math.floor(baseAtk * furyMultiplier);
                                let totalFuryDamage = 0;

                                splashTargets.forEach(st => {
                                    if (typeof env.damageEntity === 'function') env.damageEntity(st, furyAtk, entity, 'physical', '실프의 폭풍');
                                    totalFuryDamage += furyAtk;
                                    // 💡 [수정] 용병이 화살을 쏠 때 시전자 좌표(entity)가 정확히 반영되도록 수정
                                    if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, st, furyAtk, '#34d399');
                                });

                                let hpHeal = Math.max(1, Math.floor(totalFuryDamage * 0.02));
                                let mpGain = Math.max(1, Math.floor(totalFuryDamage * 0.05));
                                entity.hp = Math.min(entity.maxHp || 100, entity.hp + hpHeal);
                                entity.mp = Math.min(entity.maxMp || 100, entity.mp + mpGain);

                                if (typeof env.spawnText === 'function') env.spawnText(entity.x, entity.y - 35, `+${hpHeal} HP / +${mpGain} MP`, '#6ee7b7', 13);

                                if (!entity.elfFuryTextShown) {
                                    entity.elfFuryTextShown = true;
                                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('실프의 폭풍', target.x, target.y, target.id, 'ultimate', entity);
                                }
                            } else {
                                entity.elfFuryTextShown = false;
                                let isEcho = Math.random() < 0.25;
                                if (isEcho) {
                                    let trueDmg = Math.floor(baseAtk * 1.3);
                                    entity.mp = Math.min(entity.maxMp || 100, entity.mp + 4);
                                    if (typeof env.damageEntity === 'function') env.damageEntity(target, trueDmg, entity, 'magic', '에코 오브 실프');
                                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('에코 오브 실프', target.x, target.y, target.id, 'normal', entity);
                                } else {
                                    // 💡 [수정] 일반 활 발사 시에도 시전자(entity) 전달
                                    if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, target, baseAtk, '#ffffff');
                                    else if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                                }
                            }
                        }
                        else {
                            if (isRangedAttacker) {
                                if (typeof env.playSound === 'function') env.playSound('bow');
                                if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, target, baseAtk, '#ffffff');
                                else if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                            } else {
                                if (typeof env.playSound === 'function') env.playSound('swing');
                                if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                            }
                        }
                    }
                }
            } else if (isMerc && myLeader && !entity.target && !isManualMoving) {
                let distToLeader = fastHypot(myLeader.x - entity.x, myLeader.y - entity.y);
                if (distToLeader > 75) {
                    let angle = Math.atan2(myLeader.y - entity.y, myLeader.x - entity.x);
                    entity.moveX = myLeader.x - Math.cos(angle) * 45;
                    entity.moveY = myLeader.y - Math.sin(angle) * 45;
                    entity.isMoving = true;
                } else {
                    entity.isMoving = false;
                    entity.moveX = undefined;
                    entity.moveY = undefined;
                }
            }
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SharedAI;
    else global.SharedAI = SharedAI;
})(this);