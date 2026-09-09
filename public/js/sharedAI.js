// sharedAI.js - 플레이어, 용병, 에이전트 공통 AI 엔진 (쿨타임 데드존, 마나 관리, 스마트 카이팅, 고유 패시브 통합 적용)
(function(global) {
    const SharedAI = {
        processRoutine: function(entity, env) {
            if (!entity || entity.hp <= 0 || entity.isDead || env.state === 'SHOPPING') return;

            if (!env.now) env.now = performance.now();
            let now = env.now; // 💡 변수 참조 에러 완벽 차단

            let isManualMoving = now < (entity.manualOverrideUntil || 0);
            let skipSearch = false;
            let pClass = entity.charClass || entity.mercType || 'knight';
            
            let isMerc = Boolean(entity.isMercenary || entity.isOtherMerc || entity.isSummon);
            let myLeader = isMerc ? (env.entities.find(e => e && (e.id === entity.ownerId || e.socketId === entity.ownerId || e.socketId === entity.ownerSocketId))) : null;

            // ========================================================
            // 0. [용병 거리 이탈 시 워프 및 타겟 초기화 로직]
            // ========================================================
            if (isMerc && myLeader) {
                let distToLeader = Math.hypot(myLeader.x - entity.x, myLeader.y - entity.y);
                if (distToLeader > 700) {
                    let angle = Math.random() * Math.PI * 2;
                    entity.x = myLeader.x + Math.cos(angle) * 40;
                    entity.y = myLeader.y + Math.sin(angle) * 40;
                    entity.target = myLeader.target ? env.entities.find(e => e.id === myLeader.target.id) : null;
                    entity.isMoving = false;
                    entity.moveX = undefined;
                    entity.moveY = undefined;
                }
            }

            // ========================================================
            // 1. [아이템 루팅 탐색] (본체 전용)
            // ========================================================
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
                                let d = Math.hypot(it.x - entity.x, it.y - entity.y);
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
                    }
                    skipSearch = true;
                }
            }

            // ========================================================
            // 2. [스마트 타겟 탐색 및 교전 룰]
            // ========================================================
            if (!skipSearch && !isManualMoving) {
                
                if (isMerc && myLeader && myLeader.target && (!entity.target || entity.target.hp <= 0 || entity.target.isDead)) {
                    let leaderTarget = env.entities.find(e => e && e.id === myLeader.target.id && e.hp > 0 && !e.isDead);
                    if (leaderTarget) {
                        entity.target = leaderTarget;
                    }
                }

                let isFocusMode = env.party && env.party.isFocusMode;
                let leaderSocketId = env.party ? env.party.leaderId : null;
                let amIFollower = env.party && isFocusMode && leaderSocketId !== entity.socketId && leaderSocketId !== entity.id;
                
                if (amIFollower) {
                    let leaderEnt = env.party.leaderEnt || env.entities.find(e => e && e.isPlayer && (e.id === leaderSocketId || e.socketId === leaderSocketId));
                    let leaderTargetMob = null;
                    if (leaderEnt) {
                        let ltId = leaderEnt.targetId || (leaderEnt.target ? leaderEnt.target.id : null);
                        if (ltId) {
                            leaderTargetMob = env.entities.find(e => e && e.id === ltId && e.hp > 0 && !e.isDead && e.map === env.currentMap);
                        }
                    }

                    let attackerMob = env.entities.find(e => 
                        e && !e.isPlayer && !e.isSummon && !e.isOtherMerc && e.map === env.currentMap && e.hp > 0 && !e.isDead &&
                        (e.targetId === entity.socketId || e.targetId === entity.id || e.target === entity) &&
                        Math.hypot(e.x - entity.x, e.y - entity.y) <= 400
                    );

                    if (attackerMob && attackerMob.id !== (leaderTargetMob ? leaderTargetMob.id : null)) {
                        if (!entity.target || entity.target.id !== attackerMob.id) {
                            entity.target = attackerMob;
                            entity.isMoving = false;
                        }
                        skipSearch = true;
                    } else if (leaderTargetMob) {
                        if (!entity.target || entity.target.id !== leaderTargetMob.id) {
                            entity.target = leaderTargetMob;
                            entity.isMoving = false;
                        }
                        skipSearch = true;
                    } else if (leaderEnt) {
                        if (entity.target) entity.target = null;
                        let distToLeader = Math.hypot(leaderEnt.x - entity.x, leaderEnt.y - entity.y);
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
                    let liveTarget = env.entities.find(e => e && e.id === entity.target.id && e.hp > 0 && !e.isDead);
                    if (!liveTarget || liveTarget.map !== env.currentMap || (env.isInSafeZone && env.isInSafeZone(env.currentMap, liveTarget.x, liveTarget.y))) {
                        entity.target = null;
                        entity.isMoving = false;
                        if (typeof env.shareTarget === 'function') env.shareTarget(null);
                    } else {
                        entity.target = liveTarget;
                    }
                }

                let target = entity.target;

                if (target) {
                    let distToTarget = Math.hypot(target.x - entity.x, target.y - entity.y);
                    let attackers = env.entities.filter(e => e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && e.hp > 0 && !e.isDead && (e.targetId === entity.id || e.targetId === entity.socketId));
                    let bossAttacker = attackers.find(e => e.isBoss);
                    
                    let nearbyDangerMob = env.entities.find(m => 
                        m && !m.isSummon && !m.isPlayer && m.hp > 0 && !m.isDead && m.map === env.currentMap && !m.isBoss &&
                        Math.hypot(m.x - entity.x, m.y - entity.y) < 140
                    );

                    if (target.isBoss && nearbyDangerMob) {
                        entity.target = nearbyDangerMob;
                    } else if (!target.isBoss) {
                        if (bossAttacker) {
                            entity.target = bossAttacker;
                            if (typeof env.shareTarget === 'function') env.shareTarget(bossAttacker.id);
                        } 
                        else if (distToTarget > 250 && entity.isMoving) {
                            let closerMob = env.entities.find(e => 
                                e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && e.hp > 0 && !e.isDead && !e.isBoss && 
                                Math.hypot(e.x - entity.x, e.y - entity.y) < distToTarget - 100
                            );
                            if (closerMob) {
                                entity.target = closerMob;
                                if (typeof env.shareTarget === 'function') env.shareTarget(closerMob.id);
                            }
                        } 
                        else if (entity.hp < (entity.maxHp || 100) * 0.4 && attackers.length > 0) {
                            let closestAttacker = attackers.sort((a, b) => Math.hypot(a.x - entity.x, a.y - entity.y) - Math.hypot(b.x - entity.x, b.y - entity.y))[0];
                            if (closestAttacker && closestAttacker.id !== target.id) {
                                entity.target = closestAttacker;
                                if (typeof env.shareTarget === 'function') env.shareTarget(closestAttacker.id);
                            }
                        }
                    }
                }

                if (!entity.target || entity.target.hp <= 0 || entity.target.isDead) {
                    let bestTarget = null;
                    let bestScore = Infinity;
                    let fallbackTarget = null;
                    let fallbackDist = Infinity;
                    let isIgnoredActive = now < (entity.ignoredUntil || 0);

                    if (env.entities) {
                        env.entities.forEach(e => {
                            if (e && typeof e.y === 'number' && e.map === env.currentMap && !e.isSummon && !e.isPlayer && !e.isOtherMerc && e.hp > 0 && !e.isDead) {
                                if (env.isInSafeZone && env.isInSafeZone(env.currentMap, e.x, e.y)) return;
                                if (isIgnoredActive && e.id === entity.ignoredTargetId) return;

                                let rawDist = Math.hypot(e.x - entity.x, e.y - entity.y);
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
                            }
                        });
                    }

                    if (bestTarget) {
                        entity.target = bestTarget;
                        if (typeof env.shareTarget === 'function') env.shareTarget(bestTarget.id);
                    } else if (fallbackTarget) {
                        let approachAngle = Math.atan2(fallbackTarget.y - entity.y, fallbackTarget.x - entity.x);
                        let maxMap = env.mapSize || 4000;
                        entity.moveX = Math.max(150, Math.min(maxMap - 150, entity.x + Math.cos(approachAngle) * 350));
                        entity.moveY = Math.max(150, Math.min(maxMap - 150, entity.y + Math.sin(approachAngle) * 350));
                        entity.isMoving = true;
                    } else {
                        if (!entity.isMoving || (entity.moveX && Math.hypot(entity.moveX - entity.x, entity.moveY - entity.y) < 20)) {
                            let maxMap = env.mapSize || 4000;
                            let rx = entity.x + (Math.random() * 600 - 300); 
                            let ry = entity.y + (Math.random() * 600 - 300);
                            if (rx > 150 && rx < maxMap - 150 && ry > 150 && ry < maxMap - 150) {
                                if (!(env.isInSafeZone && env.isInSafeZone(env.currentMap, rx, ry))) {
                                    entity.moveX = rx; entity.moveY = ry; 
                                    entity.isMoving = true;
                                }
                            }
                        }
                    }
                }
            }

            // ========================================================
            // 3. [전투, 마나 부족 대응, 잡몹 회피 및 고유 패시브 실행]
            // ========================================================
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
                    // 💡 [버그 픽스] 에이전트 용병도 레벨에 맞는 스킬을 강제로 장착시킵니다.
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
                    } else if (typeof window.selectOptimalSpell === 'function') {
                        let nearbyCount = env.entities ? env.entities.filter(e => e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && Math.hypot(e.x - target.x, e.y - target.y) <= 180).length : 0;
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
                let rushDist = Math.hypot(target.x - entity.x, target.y - entity.y);
                if (rushDist > 55 && rushDist <= 350 && (now - (entity.lastRushTime || 0) > 2000)) {
                    entity.lastRushTime = now;
                    let rushAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                    entity.angle = rushAngle;
                    entity.x = target.x - Math.cos(rushAngle) * 30;
                    entity.y = target.y - Math.sin(rushAngle) * 30;

                    if (typeof env.spawnParticle === 'function') env.spawnParticle(entity.x, entity.y, 'haste_tornado');
                    if (typeof env.playSound === 'function') {
                        env.playSound('spell');
                    } else if (typeof playSound === 'function') {
                        playSound('spell');
                    }
                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast("⚡ RUSH!", target.x, target.y, target.id, 'high', entity, 16);
                }
            }

            let dodgeX = 0, dodgeY = 0;
            if (target && target.isBoss && env.entities) {
                env.entities.forEach(other => {
                    if (other && !other.isPlayer && !other.isSummon && !other.isOtherMerc && other.hp > 0 && !other.isDead && other.id !== target.id) {
                        let d = Math.hypot(entity.x - other.x, entity.y - other.y);
                        if (d < 120 && d > 10) {
                            let repelForce = (120 - d) / 120;
                            dodgeX += ((entity.x - other.x) / d) * repelForce * 35;
                            dodgeY += ((entity.y - other.y) / d) * repelForce * 35;
                        }
                    }
                });
            }

            if (target && typeof target.x === 'number' && target.hp > 0 && !target.isDead) {
                let dist = Math.hypot(target.x - entity.x, target.y - entity.y);
                let timeSinceLastAtk = now - (entity.lastAttack || 0);
                let currentAtkDelay = env.atkDelay || 900;
                let isWaitingCd = timeSinceLastAtk < currentAtkDelay; 
                let isTargetingUs = (target.targetId === entity.id || target.targetId === entity.socketId);

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
                                // 💡 [완성된 강강술래 대형 오르빗 (Dragging) 로직]
                                let escapeAngle;
                                let retreatDist = isWizardWithoutMp ? 250 : 200; 
                                let fleeAngle = Math.atan2(entity.y - target.y, entity.x - target.x);
                                
                                let allySumX = 0, allySumY = 0, allyCount = 0;
                                if (env.entities) {
                                    env.entities.forEach(e => {
                                        if (e && e.map === env.currentMap && (e.isPlayer || e.isSummon || e.isOtherMerc) && e.hp > 0 && !e.isDead && e.id !== entity.id) {
                                            if (Math.hypot(e.x - entity.x, e.y - entity.y) < 600) {
                                                allySumX += e.x; allySumY += e.y; allyCount++;
                                            }
                                        }
                                    });
                                }

                                if (allyCount > 0) {
                                    let allyCenterX = allySumX / allyCount;
                                    let allyCenterY = allySumY / allyCount;
                                    
                                    // 아군(파티원/용병) 무리의 중심점을 향한 각도
                                    let angleFromAlly = Math.atan2(entity.y - allyCenterY, entity.x - allyCenterX);
                                    // 아군을 중심으로 크게 휘어 도는 접선 각도 (강강술래 궤도)
                                    let tangentAngle = angleFromAlly + 1.25; 

                                    // 보스가 너무 가까우면 뒤로 튀는 비율(fleeWeight)을 높이고, 거리가 있으면 크게 돎
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
                        if (dist > atkRange - 10 || dodgeX !== 0 || dodgeY !== 0) {
                            let charAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                            entity.moveX = target.x - Math.cos(charAngle) * 40 + dodgeX; 
                            entity.moveY = target.y - Math.sin(charAngle) * 40 + dodgeY; 
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

                if (!entity.isMoving && dist <= atkRange + 30 && !isWaitingCd && !actionTaken) { 
                    entity.lastAttack = now;
                    entity.angle = Math.atan2(target.y - entity.y, target.x - entity.x);
                    let baseAtk = entity.atk || 20;

                    if (pClass === 'knight' || pClass === 'royal') {
                        let isCoolingDown = now < (entity.furyCooldownUntil || 0);
                        let isFury = now < (entity.furyUntil || 0);
                        if (!isFury && !isCoolingDown) {
                            let attackersNear = env.entities ? env.entities.filter(e => e && e.hp > 0 && !e.isDead && e.map === env.currentMap && !e.isPlayer && !e.isSummon && Math.hypot(e.x - entity.x, e.y - entity.y) < 150 && (e.targetId === entity.id || e.targetId === entity.socketId)) : [];
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
                        // No physical attack
                    } 
                    else {
                        if (pClass === 'knight' || pClass === 'royal') {
                            let isFury = now < (entity.furyUntil || 0);
                            let finalDamage = isFury ? Math.floor(baseAtk * 2.0) : baseAtk;
                            
                            if (typeof env.playSound === 'function') {
                                env.playSound('swing');
                            } else if (typeof playSound === 'function') {
                                playSound('swing');
                            }

                            if (typeof env.damageEntity === 'function') env.damageEntity(target, finalDamage, entity, 'physical');

                            if (isFury) {
                                let splashTargets = env.entities ? env.entities.filter(e => 
                                    e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && !e.isOtherMerc &&
                                    e.hp > 0 && !e.isDead && Math.hypot(e.x - target.x, e.y - target.y) <= 95 && e.id !== target.id
                                ) : [];
                                
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
                            
                            if (typeof env.playSound === 'function') {
                                env.playSound('bow');
                            } else if (typeof playSound === 'function') {
                                playSound('bow');
                            }

                            if (isFury) {
                                let splashTargets = env.entities ? env.entities.filter(e => 
                                    e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && !e.isOtherMerc &&
                                    e.hp > 0 && !e.isDead && Math.hypot(e.x - target.x, e.y - target.y) <= 200
                                ) : [];
                                
                                let furyAtk = Math.floor(baseAtk * 1.4);
                                let totalFuryDamage = 0;

                                splashTargets.forEach(st => {
                                    if (typeof env.damageEntity === 'function') env.damageEntity(st, furyAtk, entity, 'physical', '실프의 폭풍');
                                    totalFuryDamage += furyAtk;
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
                                    if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, target, baseAtk, '#ffffff');
                                    else if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                                }
                            }
                        }
                        else {
                            if (isRangedAttacker) {
                                if (typeof env.playSound === 'function') {
                                    env.playSound('bow');
                                } else if (typeof playSound === 'function') {
                                    playSound('bow');
                                }
                                if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, target, baseAtk, '#ffffff');
                                else if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                            } else {
                                if (typeof env.playSound === 'function') {
                                    env.playSound('swing');
                                } else if (typeof playSound === 'function') {
                                    playSound('swing');
                                }
                                if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                            }
                        }
                    }
                }
            } else if (isMerc && myLeader && !entity.target && !isManualMoving) {
                let distToLeader = Math.hypot(myLeader.x - entity.x, myLeader.y - entity.y);
                if (distToLeader > 75) {
                    let angle = Math.atan2(myLeader.y - entity.y, myLeader.x - entity.x);
                    entity.moveX = myLeader.x - Math.cos(angle) * 45;
                    entity.moveY = myLeader.y - Math.sin(angle) * 45;
                    entity.isMoving = true;
                } else {
                    entity.isMoving = false;
                }
            }
        }
    };

    // 💡 [에러 원인 해결] 함수가 아닌 객체 자체를 반환해야 충돌이 나지 않습니다.
    if (typeof module !== 'undefined' && module.exports) module.exports = SharedAI;
    else global.SharedAI = SharedAI;
})(this);