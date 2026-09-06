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
                        // 💡 [버그 해결] 이제 aiAgentRunner가 map과 플래그를 정상 주입하므로 정확히 몬스터만 찾습니다.
                        if (e && e.map === env.currentMap && !e.isPlayer && !e.isSummon && !e.isOtherMerc && e.hp > 0 && !e.isDead) {
                            // 몬스터가 안전지대에 있으면 무시
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
                        // 💡 [치명적 버그 해결] 주변에 몬스터가 없으면 넓게 무작위 정찰 이동 (안전지대 탈출)
                        if (!entity.isMoving || (entity.moveX && Math.hypot(entity.moveX - entity.x, entity.moveY - entity.y) < 25)) {
                            let rx = entity.x + (Math.random() * 800 - 400); 
                            let ry = entity.y + (Math.random() * 800 - 400);
                            let maxMap = env.mapSize || 4000;
                            if (rx > 100 && rx < maxMap - 100 && ry > 100 && ry < maxMap - 100) {
                                // 기존에는 여기서 return해버려서 함수 전체가 멈췄음. 이제는 무시하고 다음 틱을 기다리게 수정.
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
                let isRangedAttacker = isBow || isWizard;
                let atkRange = isRangedAttacker ? 320 : ((target.size || 20) + 55);

                if (!isManualMoving) {
                    if (dist > atkRange) {
                        let charAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
                        entity.moveX = target.x - Math.cos(charAngle) * (isRangedAttacker ? 200 : 30);
                        entity.moveY = target.y - Math.sin(charAngle) * (isRangedAttacker ? 200 : 30);
                        entity.isMoving = true;
                    } else {
                        entity.isMoving = false; 
                        entity.moveX = undefined; 
                        entity.moveY = undefined;
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
                            if (typeof env.playSound === 'function') env.playSound('swing');
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