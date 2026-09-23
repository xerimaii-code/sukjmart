// sharedAI.js - 플레이어, 용병, 에이전트 공통 AI 엔진 (정지 현상 완벽 차단 및 최적화)
(function(global) {
    const fastHypot = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

    const SharedAI = {
        processRoutine: function(entity, env) {
            if (!entity || entity.hp <= 0 || entity.isDead || env.state === 'SHOPPING') return;

            if (!env.now) env.now = performance.now();
            let now = env.now;

            let pClass = entity.charClass || entity.mercType || 'knight';
            let isMerc = Boolean(entity.isMercenary || entity.isOtherMerc || entity.isSummon);
            let myLeader = isMerc ? (env.entities.find(e => e && (e.id === entity.ownerId || e.socketId === entity.ownerId || e.socketId === entity.ownerSocketId))) : null;
            let isAgent = Boolean(entity.isAI || (entity.isPlayer && env.entities.find(e => e.id === entity.id && e.socketId !== undefined)));

            if (!entity._ignoredItems || typeof entity._ignoredItems.has !== 'function') {
                entity._ignoredItems = new Set();
            }

            if (isMerc && entity.inv) {
                let isLowHp = (entity.hp / (entity.maxHp || 100)) <= 0.5;
                if (isLowHp && (now - (entity.lastHpPotTime || 0) > 1000)) {
                    let hpPot = entity.inv.find(i => i.name.includes('맑은') || i.name.includes('주홍') || i.name.includes('빨간'));
                    if (hpPot && hpPot.count > 0) {
                        hpPot.count--;
                        if (hpPot.count <= 0) entity.inv = entity.inv.filter(i => i.count > 0);
                        let healAmt = hpPot.name.includes('맑은') ? 120 : (hpPot.name.includes('주홍') ? 60 : 30);
                        entity.hp = Math.min(entity.maxHp, entity.hp + healAmt);
                        entity.lastHpPotTime = now;
                        if (typeof env.useEntityPotion === 'function') env.useEntityPotion(entity.id, hpPot.name);
                        entity.requirePotion = false;
                        entity.waitingForAdena = false;
                    } else {
                        entity.requirePotion = true;
                        entity.requirePotionName = (entity.level >= 45) ? '맑은 물약' : '주홍 물약';
                    }
                }

                let needHaste = !(entity.buffs && entity.buffs['haste'] && entity.buffs['haste'] > now);
                if (needHaste && entity.target && !entity.requireBuffPotion) {
                    let hName = (entity.mercType === 'knight') ? '용기의 물약' : (entity.mercType === 'elf' ? '엘븐 와퍼' : '초록 물약');
                    let hPot = entity.inv.find(i => i.name === hName || i.name === '초록 물약');
                    if (hPot && hPot.count > 0) {
                        hPot.count--;
                        if (hPot.count <= 0) entity.inv = entity.inv.filter(i => i.count > 0);
                        entity.buffs = entity.buffs || {};
                        entity.buffs['haste'] = now + 300000;
                        if (typeof env.useEntityPotion === 'function') env.useEntityPotion(entity.id, hPot.name);
                    } else {
                        entity.requireBuffPotion = true;
                        entity.requireBuffName = hName;
                    }
                }
            }

            if (entity.isMoving) {
                if (!entity._stuckTimer) entity._stuckTimer = now;
                if (!entity._lastX) { entity._lastX = entity.x; entity._lastY = entity.y; }

                if (now - entity._stuckTimer > 1500) {
                    let movedDist = fastHypot(entity.x - entity._lastX, entity.y - entity._lastY);
                    if (movedDist < 15) { 
                        entity.isMoving = false;
                        if (entity.targetItem && entity.targetItem.id) {
                            entity._ignoredItems.add(entity.targetItem.id);
                        }
                        entity.target = null; entity.targetId = null; entity.targetItem = null;
                        entity.moveX = undefined; entity.moveY = undefined; entity.lastWander = 0; 
                        
                        let maxMap = env.mapSize || 4000;
                        entity.x = Math.max(150, Math.min(maxMap - 150, entity.x + (Math.random() * 200 - 100)));
                        entity.y = Math.max(150, Math.min(maxMap - 150, entity.y + (Math.random() * 200 - 100)));
                    }
                    entity._lastX = entity.x;
                    entity._lastY = entity.y;
                    entity._stuckTimer = now;
                }
            } else {
                entity._stuckTimer = now;
                entity._lastX = entity.x;
                entity._lastY = entity.y;
            }

            let isManualMoving = now < (entity.manualOverrideUntil || 0);
            let skipSearch = false;

            if (isMerc && myLeader) {
                let distToLeader = fastHypot(myLeader.x - entity.x, myLeader.y - entity.y);
                if (distToLeader > 700) {
                    let angle = Math.random() * Math.PI * 2;
                    entity.x = myLeader.x + Math.cos(angle) * 40;
                    entity.y = myLeader.y + Math.sin(angle) * 40;
                    entity.target = myLeader.target ? env.entities.find(e => e && e.id === myLeader.target.id) : null;
                    entity.targetId = entity.target ? entity.target.id : null;
                    entity.isMoving = false; entity.moveX = undefined; entity.moveY = undefined;
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
                            if (entity._ignoredItems && typeof entity._ignoredItems.has === 'function') {
                                if (entity._ignoredItems.has(it.id)) return;
                            }

                            if (!(env.isInSafeZone && env.isInSafeZone(env.currentMap, it.x, it.y))) {
                                let d = fastHypot(it.x - entity.x, it.y - entity.y);
                                if (d < minItemDist) { minItemDist = d; closestItem = it; }
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
                        if (entity._ignoredItems && typeof entity._ignoredItems.add === 'function') {
                            entity._ignoredItems.add(closestItem.id);
                            setTimeout(() => {
                                if (entity._ignoredItems && typeof entity._ignoredItems.delete === 'function') {
                                    entity._ignoredItems.delete(closestItem.id);
                                }
                            }, 10000);
                        }
                        entity.targetItem = null; entity.isMoving = false;
                        entity.moveX = undefined; entity.moveY = undefined;
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
                let amIFollower = env.party && leaderSocketId !== entity.socketId && leaderSocketId !== entity.id;
                let leaderTargetMob = null;
                let leaderEnt = null;

                if (amIFollower) {
                    leaderEnt = env.party.leaderEnt || env.entities.find(e => e && e.isPlayer && (e.id === leaderSocketId || e.socketId === leaderSocketId));
                    if (leaderEnt) {
                        let distToLeader = fastHypot(leaderEnt.x - entity.x, leaderEnt.y - entity.y);
                        let forceFollowLeader = false;

                        if (isFocusMode) {
                            let leaderTargetId = env.party.leaderTargetId;
                            if (leaderTargetId) leaderTargetMob = env.entities.find(e => e && e.id === leaderTargetId && (e.hp ?? e.h ?? 0) > 0 && !e.isDead && e.map === env.currentMap);

                            if (leaderTargetMob) {
                                if (!entity.target || entity.target.id !== leaderTargetMob.id) {
                                    entity.target = leaderTargetMob;
                                    entity.targetId = leaderTargetMob.id;
                                }
                                skipSearch = true; 
                            } else {
                                if (distToLeader > 450) forceFollowLeader = true;
                                else skipSearch = false;
                            }
                        } else {
                            if (distToLeader > 700) forceFollowLeader = true;
                            else skipSearch = false;
                        }

                        if (forceFollowLeader) {
                            let hpRatio = entity.hp / (entity.maxHp || 100);
                            let attackers = env.entities.filter(e => e && (e.hp ?? e.h ?? 0) > 0 && !e.isDead && (e.targetId === entity.id || e.targetId === entity.socketId || e.t === entity.id));
                            let bossAttacker = attackers.find(e => e.isBoss);

                            if (hpRatio < 0.4 || bossAttacker) {
                                skipSearch = false; 
                            } else {
                                entity.target = null; entity.targetId = null;
                                let angle = Math.atan2(leaderEnt.y - entity.y, leaderEnt.x - entity.x);
                                entity.moveX = leaderEnt.x - Math.cos(angle) * 150;
                                entity.moveY = leaderEnt.y - Math.sin(angle) * 150;
                                entity.isMoving = true; skipSearch = true;
                            }
                        }
                    } else skipSearch = false;
                }

                if (entity.target) {
                    let liveTarget = env.entities.find(e => {
                        if (!e || e.id !== entity.target.id || e.isDead) return false;
                        let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                        return curHp > 0;
                    });

                    if (!liveTarget || liveTarget.map !== env.currentMap || (env.isInSafeZone && env.isInSafeZone(env.currentMap, liveTarget.x, liveTarget.y))) {
                        entity.target = null; entity.targetId = null; entity.isMoving = false;
                        entity.moveX = undefined; entity.moveY = undefined;
                        if (typeof env.shareTarget === 'function') env.shareTarget(null);
                    } else {
                        entity.target = liveTarget; entity.targetId = liveTarget.id;
                    }
                }

                let currentTarget = entity.target; 
                let isFocusLocked = amIFollower && leaderTargetMob;

                if (currentTarget && !isFocusLocked) {
                    let distToTarget = fastHypot(currentTarget.x - entity.x, currentTarget.y - entity.y);
                    let attackers = env.entities.filter(e => {
                        if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isDead) return false;
                        let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                        return curHp > 0 && (e.targetId === entity.id || e.targetId === entity.socketId || e.t === entity.id);
                    });
                    let bossAttacker = attackers.find(e => e.isBoss);
                    
                    if (!currentTarget.isBoss) {
                        if (bossAttacker && fastHypot(bossAttacker.x - entity.x, bossAttacker.y - entity.y) < 350) {
                            entity.target = bossAttacker; entity.targetId = bossAttacker.id;
                            if (typeof env.shareTarget === 'function') env.shareTarget(bossAttacker.id);
                        } 
                        else if (distToTarget > 250 && entity.isMoving) {
                            let closerMob = env.entities.find(e => {
                                if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isDead || e.isBoss) return false;
                                let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                return curHp > 0 && fastHypot(e.x - entity.x, e.y - entity.y) < distToTarget - 100;
                            });
                            if (closerMob) {
                                entity.target = closerMob; entity.targetId = closerMob.id;
                                if (typeof env.shareTarget === 'function') env.shareTarget(closerMob.id);
                            }
                        } 
                        else if (entity.hp < (entity.maxHp || 100) * 0.4 && attackers.length > 0) {
                            let closestAttacker = attackers.sort((a, b) => fastHypot(a.x - entity.x, a.y - entity.y) - fastHypot(b.x - entity.x, b.y - entity.y))[0];
                            if (closestAttacker && closestAttacker.id !== currentTarget.id) {
                                entity.target = closestAttacker; entity.targetId = closestAttacker.id;
                                if (typeof env.shareTarget === 'function') env.shareTarget(closestAttacker.id);
                            }
                        }
                    }
                }

                if (!skipSearch && (!entity.target || (entity.target.hp ?? entity.target.h ?? 0) <= 0 || entity.target.isDead)) {
                    let bestTarget = null;
                    let bestScore = Infinity;
                    let isIgnoredActive = now < (entity.ignoredUntil || 0);

                    if (env.entities && env.entities.length > 0) {
                        let validMobs = env.entities.filter(e => {
                            if (!e || typeof e.x !== 'number' || typeof e.y !== 'number' || e.map !== env.currentMap) return false;
                            if (e.isSummon || e.isPlayer || e.isOtherMerc || e.isDead) return false;
                            let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : (e.maxHp || 100));
                            if (typeof curHp === 'number' && curHp <= 0) return false;
                            if (env.isInSafeZone && env.isInSafeZone(env.currentMap, e.x, e.y)) return false;
                            if (isIgnoredActive && e.id === entity.ignoredTargetId) return false;
                            
                            if (amIFollower && leaderEnt && !leaderTargetMob) {
                                let isAttackingMe = (e.targetId === entity.id || e.targetId === entity.socketId || e.t === entity.id);
                                let distMobToLeader = fastHypot(e.x - leaderEnt.x, e.y - leaderEnt.y);
                                if (!isAttackingMe && distMobToLeader > 800) return false;
                            }
                            return true;
                        });

                        let searchRadius = isAgent ? 2500 : 800;
                        let nearMobs = validMobs.filter(e => fastHypot(e.x - entity.x, e.y - entity.y) <= searchRadius);
                        let candidatePool = nearMobs.length > 0 ? nearMobs : validMobs;

                        candidatePool.forEach(e => {
                            let dist = fastHypot(e.x - entity.x, e.y - entity.y);
                            let score = dist;
                            if (e.isBoss) score -= 500; 
                            if (score < bestScore) {
                                bestScore = score;
                                bestTarget = e;
                            }
                        });
                    }

                    if (bestTarget) {
                        entity.target = bestTarget;
                        entity.targetId = bestTarget.id;
                        entity.moveX = bestTarget.x;
                        entity.moveY = bestTarget.y;
                        entity.isMoving = true; 
                        if (typeof env.shareTarget === 'function') env.shareTarget(bestTarget.id);
                    } else {
                        entity.target = null;
                        if (amIFollower && leaderEnt) {
                            let orbitAngle = (now / 1000) + (entity.id ? entity.id.length : 0); 
                            entity.moveX = leaderEnt.x + Math.cos(orbitAngle) * 200;
                            entity.moveY = leaderEnt.y + Math.sin(orbitAngle) * 200;
                            entity.isMoving = true;
                        } else {
                            let notMoving = !entity.isMoving || (entity.moveX && fastHypot(entity.moveX - entity.x, entity.moveY - entity.y) < 30);
                            let wanderDelay = isAgent ? 800 : 1500;

                            if (notMoving && (!entity.lastWander || now - (entity.lastWander || 0) > wanderDelay)) {
                                entity.lastWander = now;
                                let maxMap = env.mapSize || 4000;
                                let wanderAngle = Math.random() * Math.PI * 2;
                                let wanderDist = isAgent ? (400 + Math.random() * 400) : (200 + Math.random() * 200);
                                let rx = Math.max(150, Math.min(maxMap - 150, entity.x + Math.cos(wanderAngle) * wanderDist));
                                let ry = Math.max(150, Math.min(maxMap - 150, entity.y + Math.sin(wanderAngle) * wanderDist));

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

            let finalTarget = entity.target; 
            let isBow = Boolean(entity.equip && entity.equip.weapon && (entity.equip.weapon.isBow || (entity.equip.weapon.name && entity.equip.weapon.name.includes('활'))));
            let isWizard = pClass === 'wizard';
            
            let weaponName = (entity.equip && entity.equip.weapon && entity.equip.weapon.name) || '';
            let isMeleeWeapon = weaponName.includes('검') || weaponName.includes('도') || weaponName.includes('단검') || weaponName.includes('창') || weaponName.includes('대검');
            let isRangedAttacker = (isBow || isWizard) && !isMeleeWeapon;
            
            let atkRange = isRangedAttacker ? 280 : ((finalTarget ? finalTarget.size || 20 : 20) + 55);
            let currentMp = entity.mp || 0;
            let chosenSpell = null;

            if (finalTarget) {
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
                        } else { entity.skills = ['쇼크 스턴']; }
                    }

                    if (finalTarget.isBoss) {
                        let bossSpells = ['디스인티그레이트', '저지먼트', '블리자드', '선버스트', '이럽션', '파이어볼', '에너지 볼트'];
                        let validSpell = bossSpells.find(s => dbRef[s] && entity.mp >= (dbRef[s].mp || 0) && entity.skills.includes(s));
                        chosenSpell = validSpell || '에너지 볼트';
                    } else if (typeof window !== 'undefined' && typeof window.selectOptimalSpell === 'function') {
                        let nearbyCount = env.entities ? env.entities.filter(e => e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && fastHypot(e.x - finalTarget.x, e.y - finalTarget.y) <= 180).length : 0;
                        chosenSpell = window.selectOptimalSpell(entity, nearbyCount, finalTarget);
                    }
                } else {
                    if (finalTarget.isBoss && entity.magic) {
                        let bossSpells = ['디스인티그레이트', '저지먼트', '블리자드', '선버스트', '이럽션', '파이어볼', '에너지 볼트'];
                        chosenSpell = bossSpells.find(s => entity.magic.includes(s) && entity.mp >= (dbRef[s]?.mp || 0)) || null;
                    } else if (typeof env.getSmartAutoCombatSpell === 'function') {
                        chosenSpell = env.getSmartAutoCombatSpell(finalTarget);
                    }
                }
            }
            
            let isWizardWithoutMp = isWizard && !isMeleeWeapon && !chosenSpell; 
            let actionTaken = false;

            if (isWizard) {
                let allies = [];
                if (env.entities) {
                    allies = env.entities.filter(e => e && e.map === env.currentMap && (e.isPlayer || e.isSummon || e.isOtherMerc) && e.hp > 0 && !e.isDead && (e.hp / (e.maxHp || 100)) <= 0.45);
                }
                if (allies.length > 0 && currentMp >= 15 && (now - (entity.lastHealTime || 0) > 3000)) {
                    if (!env.globalHealLock || now - env.globalHealLock > 2000) {
                        env.globalHealLock = now; entity.lastHealTime = now; actionTaken = true;
                        allies.sort((a, b) => (a.hp / (a.maxHp || 100)) - (b.hp / (b.maxHp || 100)));
                        if (typeof env.castAttackSpell === 'function') env.castAttackSpell(allies[0], '힐', entity);
                    }
                }
            }

            if ((pClass === 'knight' || pClass === 'royal') && finalTarget && !isManualMoving) {
                let rushDist = fastHypot(finalTarget.x - entity.x, finalTarget.y - entity.y);
                if (rushDist > 55 && rushDist <= 350 && (now - (entity.lastRushTime || 0) > 2000)) {
                    entity.lastRushTime = now;
                    let rushAngle = Math.atan2(finalTarget.y - entity.y, finalTarget.x - entity.x);
                    entity.angle = rushAngle;
                    entity.x = finalTarget.x - Math.cos(rushAngle) * 30;
                    entity.y = finalTarget.y - Math.sin(rushAngle) * 30;
                    entity.isMoving = false; entity.moveX = undefined; entity.moveY = undefined;
                    if (typeof env.spawnParticle === 'function') env.spawnParticle(entity.x, entity.y, 'haste_tornado');
                    if (typeof env.playSound === 'function') env.playSound('spell');
                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('🌪️ SYLPH TEMPEST! (실프의 폭풍)', finalTarget.x, finalTarget.y, finalTarget.id, 'ultimate', entity);
                }
            }

            let dodgeX = 0, dodgeY = 0;
            if (finalTarget && finalTarget.isBoss && env.entities) {
                env.entities.forEach(other => {
                    if (other && !other.isPlayer && !other.isSummon && !other.isOtherMerc && other.hp > 0 && !other.isDead && other.id !== finalTarget.id) {
                        let d = fastHypot(entity.x - other.x, entity.y - other.y);
                        if (d < 120 && d > 10) {
                            let repelForce = (120 - d) / 120;
                            dodgeX += ((entity.x - other.x) / d) * repelForce * 35;
                            dodgeY += ((entity.y - other.y) / d) * repelForce * 35;
                        }
                    }
                });
            }

            if (finalTarget && typeof finalTarget.x === 'number' && typeof finalTarget.y === 'number' && (finalTarget.hp ?? finalTarget.h ?? 0) > 0 && !finalTarget.isDead) {
                let dist = fastHypot(finalTarget.x - entity.x, finalTarget.y - entity.y);
                let timeSinceLastAtk = now - (entity.lastAttack || 0);
                let currentAtkDelay = env.atkDelay || 900;
                let isWaitingCd = timeSinceLastAtk < currentAtkDelay; 
                let isTargetingUs = (finalTarget.targetId === entity.id || finalTarget.targetId === entity.socketId || finalTarget.t === entity.id);

                if (!isManualMoving) {
                    let maxMap = env.mapSize || 4000;
                    let margin = 150; 

                    if (isRangedAttacker) {
                        let closeThreshold = isWizardWithoutMp ? 250 : 180; 
                        let idealRange = isWizardWithoutMp ? 300 : 230;     

                        if (isWizardWithoutMp && !isTargetingUs && dist > closeThreshold && dodgeX === 0 && dodgeY === 0) {
                            entity.isMoving = false; entity.moveX = undefined; entity.moveY = undefined;
                        }
                        else if (isWaitingCd && dist >= closeThreshold + 20 && dist <= atkRange && dodgeX === 0 && dodgeY === 0) {
                            entity.isMoving = false; entity.moveX = undefined; entity.moveY = undefined;
                        } 
                        else if (dist < closeThreshold || dist > atkRange - 10 || dodgeX !== 0 || dodgeY !== 0) {
                            let targetX, targetY;
                            if (dist < closeThreshold) { 
                                let escapeAngle;
                                let retreatDist = isWizardWithoutMp ? 250 : 200; 
                                let fleeAngle = Math.atan2(entity.y - finalTarget.y, entity.x - finalTarget.x);
                                let allySumX = 0, allySumY = 0, allyCount = 0;
                                if (env.entities) {
                                    env.entities.forEach(e => {
                                        if (e && e.map === env.currentMap && (e.isPlayer || e.isSummon || e.isOtherMerc) && e.hp > 0 && !e.isDead && e.id !== entity.id) {
                                            if (fastHypot(e.x - entity.x, e.y - entity.y) < 600) { allySumX += e.x; allySumY += e.y; allyCount++; }
                                        }
                                    });
                                }

                                if (allyCount > 0) {
                                    let allyCenterX = allySumX / allyCount; let allyCenterY = allySumY / allyCount;
                                    let angleFromAlly = Math.atan2(entity.y - allyCenterY, entity.x - allyCenterX);
                                    let tangentAngle = angleFromAlly + 1.25; 
                                    let fleeWeight = (dist < 100) ? 0.7 : 0.3; let orbitWeight = 1.0 - fleeWeight;
                                    let cx = Math.cos(tangentAngle) * orbitWeight + Math.cos(fleeAngle) * fleeWeight;
                                    let cy = Math.sin(tangentAngle) * orbitWeight + Math.sin(fleeAngle) * fleeWeight;
                                    escapeAngle = Math.atan2(cy, cx);
                                } else { escapeAngle = fleeAngle; }

                                let isNearWallX = entity.x < margin + 50 || entity.x > maxMap - margin - 50;
                                let isNearWallY = entity.y < margin + 50 || entity.y > maxMap - margin - 50;
                                if (isNearWallX || isNearWallY) {
                                    let centerAngle = Math.atan2(maxMap/2 - entity.y, maxMap/2 - entity.x);
                                    let cx = Math.cos(escapeAngle) * 0.3 + Math.cos(centerAngle) * 0.7;
                                    let cy = Math.sin(escapeAngle) * 0.3 + Math.sin(centerAngle) * 0.7;
                                    escapeAngle = Math.atan2(cy, cx); retreatDist = 250;
                                }

                                targetX = entity.x + Math.cos(escapeAngle) * retreatDist + dodgeX;
                                targetY = entity.y + Math.sin(escapeAngle) * retreatDist + dodgeY;
                            } else {
                                let approachAngle = Math.atan2(finalTarget.y - entity.y, finalTarget.x - entity.x);
                                targetX = finalTarget.x - Math.cos(approachAngle) * idealRange + dodgeX;
                                targetY = finalTarget.y - Math.sin(approachAngle) * idealRange + dodgeY;
                            }

                            let currentDestDist = fastHypot(targetX - (entity.moveX || entity.x), targetY - (entity.moveY || entity.y));
                            if (currentDestDist > 20 || !entity.isMoving) {
                                entity.moveX = Math.max(margin, Math.min(maxMap - margin, targetX));
                                entity.moveY = Math.max(margin, Math.min(maxMap - margin, targetY));
                                entity.isMoving = true;
                            }
                        } else {
                            entity.isMoving = false; entity.moveX = undefined; entity.moveY = undefined;
                        }
                    } else {
                        let closeRange = Math.max(30, atkRange - 5);
                        let stopRange = atkRange + 25;
                        if (dist > stopRange || dodgeX !== 0 || dodgeY !== 0) {
                            let charAngle = Math.atan2(finalTarget.y - entity.y, finalTarget.x - entity.x);
                            let tX = finalTarget.x - Math.cos(charAngle) * closeRange + dodgeX;
                            let tY = finalTarget.y - Math.sin(charAngle) * closeRange + dodgeY;
                            
                            let currentDestDist = fastHypot(tX - (entity.moveX || entity.x), tY - (entity.moveY || entity.y));
                            if (currentDestDist > 10 || !entity.isMoving) {
                                entity.moveX = Math.max(100, Math.min(maxMap - 100, tX)); 
                                entity.moveY = Math.max(100, Math.min(maxMap - 100, tY)); 
                                entity.isMoving = true;
                            }
                        } else {
                            entity.isMoving = false; entity.moveX = undefined; entity.moveY = undefined;
                        }
                    }
                }

                if (dist <= atkRange + 30 && !isWaitingCd && !actionTaken) {
                    entity.isMoving = false; 
                    entity.moveX = undefined; 
                    entity.moveY = undefined;
                    entity.lastAttack = now; 
                    entity.angle = Math.atan2(finalTarget.y - entity.y, finalTarget.x - entity.x);
                    
                    let baseAtk = entity.atk || 20;

                    let isDeathForm = Boolean(entity.equip && entity.equip.armor && entity.equip.armor.name.includes('데스'));
                    let arrowColor = isDeathForm ? '#ff2200' : '#ffffff';

                    let processWeaponHit = (attacker, targetObj, dmgVal) => {
                        let wp = attacker.equip && attacker.equip.weapon;
                        if (!wp) return;
                        
                        let dbRef = typeof magicDb !== 'undefined' ? magicDb : (typeof data !== 'undefined' ? data.magicDb : {});
                        
                        let triggerSkill = null;
                        if (wp.skill && Math.random() < 0.10) triggerSkill = wp.skill; 
                        
                        if (wp.magicOptions) {
                            wp.magicOptions.forEach(opt => {
                                let match = opt.match(/공격 시 (\d+)% (.+)/);
                                if (match && Math.random() < (parseInt(match[1]) / 100)) {
                                    triggerSkill = match[2].trim();
                                }
                            });
                        }
                        
                        if (triggerSkill && typeof env.damageEntity === 'function') {
                            let mData = dbRef[triggerSkill];
                            if (mData) {
                                let magicDmg = (mData.dmg || 20) + (attacker.sp || 0) * 3;
                                env.damageEntity(targetObj, magicDmg, attacker, 'magic', triggerSkill);
                                if (typeof env.triggerPassiveBroadcast === 'function') {
                                    env.triggerPassiveBroadcast(triggerSkill, targetObj.x, targetObj.y, targetObj.id, 'high', attacker, 15);
                                }
                            }
                        }
                        
                        if (wp.mpDrain) attacker.mp = Math.min(attacker.maxMp || 100, (attacker.mp || 0) + wp.mpDrain);
                        
                        let hasVamp = wp.vampiric;
                        if (wp.magicOptions && wp.magicOptions.some(o => o.includes('HP 흡수'))) hasVamp = true;
                        if (hasVamp) {
                            let heal = Math.floor(dmgVal * 0.15) || 1;
                            attacker.hp = Math.min(attacker.maxHp || 100, (attacker.hp || 0) + heal);
                        }
                        
                        if (wp.magicOptions && wp.magicOptions.some(o => o.includes('MP 흡수'))) {
                            let mpHeal = Math.floor(dmgVal * 0.05) || 1;
                            attacker.mp = Math.min(attacker.maxMp || 100, (attacker.mp || 0) + mpHeal);
                        }
                    };

                    if (pClass === 'knight' || pClass === 'royal') {
                        let isCoolingDown = now < (entity.furyCooldownUntil || 0);
                        let isFury = now < (entity.furyUntil || 0);
                        if (!isFury && !isCoolingDown) {
                            let attackersNear = env.entities ? env.entities.filter(e => {
                                if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isDead) return false;
                                let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                return curHp > 0 && fastHypot(e.x - entity.x, e.y - entity.y) < 150 && (e.targetId === entity.id || e.targetId === entity.socketId || e.t === entity.id);
                            }) : [];
                            if (attackersNear.length >= 3 || (entity.hp / (entity.maxHp || 100)) < 0.4) {
                                entity.furyUntil = now + 4000; 
                                entity.furyCooldownUntil = now + 6000; 
                                entity.furyCleavedThisCycle = false;
                                if (typeof env.triggerPassiveBroadcast === 'function') {
                                    env.triggerPassiveBroadcast("🔥 BERSERK FURY! (광폭화)", entity.x, entity.y, null, 'ultimate', entity, 20);
                                }
                            }
                        }
                    }

                    if (chosenSpell) {
                        if (typeof env.castAttackSpell === 'function') {
                            env.castAttackSpell(finalTarget, chosenSpell, entity);
                            if (chosenSpell === '트리플 애로우' && pClass === 'elf') {
                                if (!(now < (entity.elfFuryUntil || 0)) && !(now < (entity.elfFuryCooldownUntil || 0))) {
                                    entity.elfHitCount = (entity.elfHitCount || 0) + 3; // 트리플 애로우 +3스택
                                    if (entity.elfHitCount >= 5) { // 🌟 5타로 완화
                                        entity.elfHitCount = 0;
                                        entity.elfFuryUntil = now + 4000;
                                        entity.elfFuryCooldownUntil = now + 7000;
                                        entity.elfFuryTextShown = false;
                                    }
                                }
                            }
                        }
                    } 
                    else if (isWizardWithoutMp) {
                        if (typeof env.playSound === 'function') env.playSound('swing');
                        if (typeof env.damageEntity === 'function') env.damageEntity(finalTarget, Math.max(1, baseAtk - (finalTarget.def || 0)), entity, 'physical');
                        processWeaponHit(entity, finalTarget, baseAtk);
                    } 
                    else {
                        if (pClass === 'knight' || pClass === 'royal') {
                            let isFury = now < (entity.furyUntil || 0);
                            let finalDamage = isFury ? Math.floor(baseAtk * 2.0) : baseAtk;
                            if (typeof env.playSound === 'function') env.playSound('swing');
                            if (typeof env.damageEntity === 'function') env.damageEntity(finalTarget, finalDamage, entity, 'physical');
                            processWeaponHit(entity, finalTarget, finalDamage);

                            if (isFury) {
                                let splashTargets = env.entities ? env.entities.filter(e => {
                                    if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isOtherMerc || e.isDead || e.id === finalTarget.id) return false;
                                    let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                    return curHp > 0 && fastHypot(e.x - finalTarget.x, e.y - finalTarget.y) <= 95;
                                }) : [];
                                
                                let totalCleaveDmg = 0; 
                                splashTargets.forEach(st => {
                                    let sDmg = Math.floor(finalDamage * 0.6); totalCleaveDmg += sDmg;
                                    if (typeof env.damageEntity === 'function') env.damageEntity(st, sDmg, entity, 'physical');
                                });
                                
                                let healAmount = Math.floor((finalDamage + totalCleaveDmg) * 0.25);
                                entity.hp = Math.min(entity.maxHp || 100, entity.hp + healAmount);
                                if (healAmount > 0 && typeof env.spawnText === 'function') env.spawnText(entity.x, entity.y - 30, `+${healAmount} 흡혈`, '#e879f9', 13);
                                
                                if (!entity.furyCleavedThisCycle) {
                                    entity.furyCleavedThisCycle = true;
                                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('광폭화 클리브', finalTarget.x, finalTarget.y, finalTarget.id, 'ultimate', entity);
                                }
                            } else { 
                                entity.furyCleavedThisCycle = false; 
                            }
                        }
                        else if (pClass === 'elf') {
                            if (!(now < (entity.elfFuryUntil || 0)) && !(now < (entity.elfFuryCooldownUntil || 0))) {
                                entity.elfHitCount = (entity.elfHitCount || 0) + 1; // 평타 +1스택
                                if (entity.elfHitCount >= 5) { // 🌟 5타 발동
                                    entity.elfHitCount = 0;
                                    entity.elfFuryUntil = now + 4000;
                                    entity.elfFuryCooldownUntil = now + 7000;
                                    entity.elfFuryTextShown = false;
                                }
                            }

                            if (typeof env.playSound === 'function') env.playSound('bow');

                            if (now < (entity.elfFuryUntil || 0)) {
                                let splashTargets = env.entities ? env.entities.filter(e => {
                                    if (!e || e.map !== env.currentMap || e.isPlayer || e.isSummon || e.isOtherMerc || e.isDead) return false;
                                    let curHp = (e.hp !== undefined) ? e.hp : (e.h !== undefined ? e.h : 0);
                                    return curHp > 0 && fastHypot(e.x - finalTarget.x, e.y - finalTarget.y) <= 200;
                                }) : [];
                                
                                let bowEnchant = (entity.equip && entity.equip.weapon && entity.equip.weapon.enchantValue) ? entity.equip.weapon.enchantValue : 0;
                                
                                // 🌟 딜 배율 1.4배로 통일
                                let furyMultiplier = 1.4 + (bowEnchant * 0.1); 
                                let furyAtk = Math.floor(baseAtk * furyMultiplier);
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
                                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('실프의 폭풍', finalTarget.x, finalTarget.y, finalTarget.id, 'ultimate', entity);
                                }
                            } else {
                                entity.elfFuryTextShown = false;
                                if (Math.random() < 0.25) {
                                    let trueDmg = Math.floor(baseAtk * 1.3);
                                    entity.mp = Math.min(entity.maxMp || 100, entity.mp + 4);
                                    if (typeof env.damageEntity === 'function') env.damageEntity(finalTarget, trueDmg, entity, 'magic', '에코 오브 실프');
                                    if (typeof env.triggerPassiveBroadcast === 'function') env.triggerPassiveBroadcast('에코 오브 실프', finalTarget.x, finalTarget.y, finalTarget.id, 'normal', entity);
                                } else {
                                    if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, finalTarget, baseAtk, arrowColor);
                                    else if (typeof env.damageEntity === 'function') env.damageEntity(finalTarget, baseAtk, entity, 'physical');
                                    processWeaponHit(entity, finalTarget, baseAtk);
                                }
                            }
                        }
                        else {
                            if (isRangedAttacker) {
                                if (typeof env.playSound === 'function') env.playSound('bow');
                                if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, finalTarget, baseAtk, arrowColor);
                                else if (typeof env.damageEntity === 'function') env.damageEntity(finalTarget, baseAtk, entity, 'physical');
                                processWeaponHit(entity, finalTarget, baseAtk);
                            } else {
                                if (typeof env.playSound === 'function') env.playSound('swing');
                                if (typeof env.damageEntity === 'function') env.damageEntity(finalTarget, baseAtk, entity, 'physical');
                                processWeaponHit(entity, finalTarget, baseAtk);
                            }
                        }
                    }
                }

            } else if (isMerc && myLeader && !entity.target && !isManualMoving) {
                let distToLeader = fastHypot(myLeader.x - entity.x, myLeader.y - entity.y);
                if (distToLeader > 120) { 
                    let angle = Math.atan2(myLeader.y - entity.y, myLeader.x - entity.x);
                    entity.moveX = myLeader.x - Math.cos(angle) * 60;
                    entity.moveY = myLeader.y - Math.sin(angle) * 60;
                    entity.isMoving = true;
                } else if (distToLeader < 60) { 
                    entity.isMoving = false;
                    entity.moveX = undefined;
                    entity.moveY = undefined;
                } else {
                    if (entity.isMoving && entity.moveX !== undefined) {
                        let destDist = fastHypot(entity.moveX - entity.x, entity.moveY - entity.y);
                        if (destDist < 10) {
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        }
                    }
                }
            }
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SharedAI;
    else global.SharedAI = SharedAI;
})(this);