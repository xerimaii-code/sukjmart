// sharedAI.js - 플레이어, 용병, 에이전트 공통 AI 엔진 (전투/이동/기술기 완벽 통합)
(function(global) {
    const SharedAI = {
        processRoutine: function(entity, env) {
            let isManualMoving = env.now < (entity.manualOverrideUntil || 0);
            let skipSearch = false;

            // 1. [아이템 루팅 탐색]
            if (!entity.target && !isManualMoving && env.items && env.items.length > 0) {
                let closestItem = null;
                let minItemDist = Infinity;
                env.items.forEach(it => {
                    if (it && (it.map === env.currentMap || !it.map)) {
                        let itemGrade = it.grade || 0;
                        let isAlwaysLoot = ['scroll', 'book', 'potion', 'currency'].includes(it.type);
                        if ((isAlwaysLoot || itemGrade >= env.minLootGrade)) {
                            let d = Math.hypot(it.x - entity.x, it.y - entity.y);
                            if (d < minItemDist) { minItemDist = d; closestItem = it; }
                        }
                    }
                });

                if (closestItem && minItemDist < 350) {
                    entity.targetItem = closestItem;
                    entity.moveX = closestItem.x;
                    entity.moveY = closestItem.y;
                    entity.isMoving = true;
                    if (minItemDist <= 35) {
                        env.lootItem(closestItem);
                        entity.targetItem = null;
                        entity.isMoving = false;
                    }
                    skipSearch = true;
                }
            }

            // 2. [타겟 탐색 루프]
            if (!skipSearch && !isManualMoving) {
                if (!entity.target || entity.target.hp <= 0 || entity.target.isDead) {
                    let closestMob = null; 
                    let minMobDist = Infinity;

                    env.entities.forEach(e => {
                        if (e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && !e.isOtherMerc && e.hp > 0 && !e.isDead) {
                            if (env.isInSafeZone && env.isInSafeZone(env.currentMap, e.x, e.y)) return;

                            let d = Math.hypot(e.x - entity.x, e.y - entity.y);
                            if (d < minMobDist) { 
                                minMobDist = d; 
                                closestMob = e; 
                            }
                        }
                    });

                    if (closestMob && minMobDist <= 700) {
                        entity.target = closestMob;
                        if (typeof env.shareTarget === 'function') env.shareTarget(closestMob.id);
                    } else {
                        if (!entity.isMoving || (entity.moveX && Math.hypot(entity.moveX - entity.x, entity.moveY - entity.y) < 25)) {
                            let rx = entity.x + (Math.random() * 800 - 400); 
                            let ry = entity.y + (Math.random() * 800 - 400);
                            let maxMap = env.mapSize || 4000;
                            if (rx > 100 && rx < maxMap - 100 && ry > 100 && ry < maxMap - 100) {
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

            // 3. [전투 및 공격/마법 시전 실행]
            let target = entity.target;
            if (target && typeof target.x === 'number' && target.hp > 0 && !target.isDead) {
                let dist = Math.hypot(target.x - entity.x, target.y - entity.y);
                let isBow = Boolean(entity.equip && entity.equip.weapon && (entity.equip.weapon.isBow || (entity.equip.weapon.name && entity.equip.weapon.name.includes('활'))));
                let isWizard = entity.charClass === 'wizard';
                
                // 💡 [요청 반영] 칼든 요정 및 근접 무기를 장착한 엘프/캐릭터는 원거리 카이팅 대상에서 제외
                let weaponName = (entity.equip && entity.equip.weapon && entity.equip.weapon.name) || '';
                let isMeleeWeapon = weaponName.includes('검') || weaponName.includes('도') || weaponName.includes('단검') || weaponName.includes('창') || weaponName.includes('대검');
                let isRangedAttacker = (isBow || isWizard) && !isMeleeWeapon;
                
                let atkRange = isRangedAttacker ? 320 : ((target.size || 20) + 55);

                if (!isManualMoving) {
                    let maxMap = env.mapSize || 4000;
                    let margin = 150; // 코너 및 벽 가장자리에 갇히지 않도록 유지할 최소 여백

                    if (isRangedAttacker) {
                        let closeThreshold = 200; // 몬스터가 이 거리 안으로 접근하면 긴급 카이팅 및 회피 발동
                        let idealRange = 260;    // 사거리 내에서 유지할 최적의 거리

                        // 💡 [요청 반영] 아군(플레이어/용병/소환수) 중심점 계산 (아군이 있는 곳을 중심으로 협동 전투 및 원형 궤도 회피)
                        let allySumX = entity.x, allySumY = entity.y, allyCount = 1;
                        if (env.entities) {
                            env.entities.forEach(e => {
                                if (e && e.map === env.currentMap && (e.isPlayer || e.isSummon || e.isOtherMerc) && e.hp > 0) {
                                    allySumX += e.x;
                                    allySumY += e.y;
                                    allyCount++;
                                }
                            });
                        }
                        let allyCenterX = allySumX / allyCount;
                        let allyCenterY = allySumY / allyCount;

                        if (dist < closeThreshold || dist > atkRange + 40) {
                            // 몬스터가 너무 가까우거나 사거리 밖일 때: 몬스터 반대 방향 + 큰 원형 궤도(Orbit) + 아군 중심점 조합
                            let angleToMob = Math.atan2(target.y - entity.y, target.x - entity.x);
                            
                            // 시간에 따라 시계/반시계 방향을 교대로 전환하며 큰 원을 그리며 회피하도록 탄젠트 요소 부여
                            let orbitSign = (Math.floor(env.now / 3500) % 2 === 0) ? 1 : -1;
                            let evadeAngle = angleToMob + Math.PI + (1.4 * orbitSign);

                            let targetX = target.x + Math.cos(evadeAngle) * idealRange;
                            let targetY = target.y + Math.sin(evadeAngle) * idealRange;

                            // 아군 진형 중심 쪽으로 밸런스를 잡아주어 아군 공격 사거리 내에 머물도록 유도
                            targetX = targetX * 0.6 + allyCenterX * 0.4;
                            targetY = targetY * 0.6 + allyCenterY * 0.4;

                            // 💡 [요청 반영] 맵 가장자리나 코너에 박히지 않도록 경계선 안쪽으로 강제 클램프(Clamp) 처리
                            targetX = Math.max(margin, Math.min(maxMap - margin, targetX));
                            targetY = Math.max(margin, Math.min(maxMap - margin, targetY));

                            entity.moveX = targetX;
                            entity.moveY = targetY;
                            entity.isMoving = true;
                        } else {
                            // 적당한 사거리 내에서 안정적으로 자리를 잡고 공격할 때
                            entity.isMoving = false;
                            entity.moveX = undefined;
                            entity.moveY = undefined;
                        }
                    } else {
                        // 근접 클래스 및 칼든 요정 이동 로직
                        if (dist > atkRange) {
                            let charAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                            entity.moveX = target.x - Math.cos(charAngle) * 30;
                            entity.moveY = target.y - Math.sin(charAngle) * 30;
                            entity.isMoving = true;
                        } else {
                            entity.isMoving = false; 
                            entity.moveX = undefined; 
                            entity.moveY = undefined;
                        }
                    }
                }

                // 💥 공격 딜레이 체크 및 즉각 타격
                let timeSinceLastAtk = env.now - (entity.lastAttack || 0);
                if (dist <= atkRange + 30 && timeSinceLastAtk >= (env.atkDelay || 800)) {
                    entity.lastAttack = env.now;
                    entity.angle = Math.atan2(target.y - entity.y, target.x - entity.x);
                    let baseAtk = entity.atk || 20;

                    let chosenSpell = (typeof env.getSmartAutoCombatSpell === 'function') ? env.getSmartAutoCombatSpell(target) : null;

                    if (chosenSpell && typeof env.castAttackSpell === 'function') {
                        env.castAttackSpell(target, chosenSpell, entity);
                    } else if (entity.charClass === 'wizard' && (entity.mp || 30) >= 2 && typeof env.castAttackSpell === 'function') {
                        env.castAttackSpell(target, '에너지 볼트', entity, true);
                    } else {
                        if (isRangedAttacker) {
                            if (typeof env.playSound === 'function') env.playSound('bow');
                            if (typeof env.spawnArrow === 'function') env.spawnArrow(entity, target, baseAtk, '#ffffff');
                            else if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                        } else {
                            if (typeof env.playSound === 'function') env.playSound('playSound') || env.playSound('swing');
                            if (typeof env.damageEntity === 'function') env.damageEntity(target, baseAtk, entity, 'physical');
                        }
                    }
                }
            }
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = SharedAI;
    else global.SharedAI = SharedAI;
})(this);
