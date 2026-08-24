// ==========================================
// [1. 등급 및 기본 클래스 데이터]
// ==========================================
const gradeColors = ['#fff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#ff0055', '#ff00ff', '#00ffff'];
const gradeNames = ['일반', '고급', '희귀', '영웅', '전설', '전설 I', '전설 II', '전설 III'];
const classData = {
    'knight': { name: '기사', str: 18, dex: 14, int: 8, hp: 150, mp: 10, color: '#ccc' },
    'elf': { name: '요정', str: 11, dex: 18, int: 11, hp: 100, mp: 30, color: '#8f8' },
    'wizard': { name: '마법사', str: 8, dex: 14, int: 18, hp: 80, mp: 50, color: '#88f' }
};

const _map = (n, r, bg, m, b, l, sz) => ({ name: n, recLv: r, bg: bg, m: m, b: b, links: l, safeZones: sz });
const _mob = (n, h, a, s, e, ad, sz, c, x={}) => ({ name: n, hp: h, atk: a, speed: s, exp: e, adena: ad, size: sz, color: c, ...x });
const _wp = (n, a, g, x={}) => ({ name: n, type: "weapon", atk: a, grade: g, ...x });
const _am = (n, t, d, g, x={}) => ({ name: n, type: t, def: d, grade: g, ...x });
const _pt = (n, h, p, x={}) => ({ name: n, type: "potion", heal: h, price: p, ...x });

// ==========================================
// [2. 맵 정보 데이터] (몬스터 젠 수 대폭 상향 패치)
// ==========================================
const maps = {
    'talking_island': {
        ..._map('말하는 섬', 'Lv.1~15', 'grass', ['goblin', 'orc', 'werewolf', 'shelob', 'doberman', 'slime'], [{id:'giant_ungoliant', x:3500, y:3500}], [], [{x: 2000, y: 2000, r: 400}]),
        maxMobs: 65,
        zoneSpawns: [
            { id: 'elder_field', mobs: ['elder'], x: 2000, y: 500, r: 200, max: 2, cooldown: 300000, nextSpawn: 0 }, 
            { id: 'ungoliant_field', mobs: ['ungoliant'], x: 800, y: 800, r: 400, max: 5, cooldown: 300000, nextSpawn: 0 }
        ]
    },
    'silver_knight_town': {
        ..._map('은기사 마을', '마을(안전)', 'grass', ['goblin', 'orc', 'werewolf', 'doberman', 'slime'], [{id:'black_knight_chief', x:3500, y:3500}], [], [{x: 2000, y: 2000, r: 400}]),
        maxMobs: 50,
        zoneSpawns: [
            { id: 'black_knight_field', mobs: ['elite_black_knight', 'black_knight', 'black_knight', 'black_knight'], x: 1000, y: 1000, r: 300, max: 8, cooldown: 300000, nextSpawn: 0 },
            { id: 'dark_elf_field', mobs: ['dark_elf'], x: 3500, y: 2500, r: 400, max: 4, cooldown: 300000, nextSpawn: 0 }
        ]
    },
    'elven_forest': {
        ..._map('요정의 숲', 'Lv.1~20', 'grass', ['goblin', 'orc', 'werewolf', 'ent'], [{id:'corrupted_ent', x:3500, y:3500}], [], [{x: 2000, y: 2000, r: 400}]),
        maxMobs: 55
    },
    'ti_dungeon': { ..._map('말섬 던전 1층', 'Lv.10~25', 'dungeon', ['skeleton', 'ghoul', 'slime'], [], [], []), maxMobs: 75 },
    'ti_dungeon2': {
        ..._map('말섬 던전 2층', 'Lv.20~35', 'dungeon', ['skeleton', 'ghoul', 'bugbear'], [{id:'baphomet', x:3500, y:3500}], [], []), maxMobs: 80
    },
    'gludio_dungeon': { ..._map('글루디오 던전(본던)', 'Lv.30~45', 'dungeon', ['skeleton', 'ghoul', 'bugbear', 'slime'], [{id:'deathknight', x:3500, y:3500}], [], []), maxMobs: 90 },
    'gludin': { ..._map('글루딘 영지(사막 포함)', 'Lv.25~40', 'dirt', ['bugbear', 'scorpion', 'giant_ant', 'basilisk', 'slime'], [{id:'kurz', x:3500, y:3500}], [], []), maxMobs: 70 },
    'ant_cave': { ..._map('개미굴 (사막 동굴)', 'Lv.35~50', 'dungeon', ['giant_ant'], [{id:'ant_queen', x:3500, y:3500}], [], []), maxMobs: 85 },
    'dragon_valley': { ..._map('용의 계곡', 'Lv.55~70', 'stone', ['skeleton_guard', 'ogre', 'cockatrice', 'scorpion'], [{id:'black_elder', x:2000, y:3500}, {id:'drake', x:1500, y:1500}], [], []), maxMobs: 75 },
    'dv_dungeon': { ..._map('용계 던전', 'Lv.65~80', 'dungeon', ['murian', 'succubus', 'bone_dragon'], [{id:'antharas', x:3500, y:3500}], [], []), maxMobs: 90 },
    'tower_of_insolence_1': { ..._map('오만의 탑 1층', 'Lv.75~85', 'tower', ['succubus', 'medusa', 'chimera'], [{id:'zenith_queen', x:3500, y:3500}], [], []), maxMobs: 80 },
    'tower_of_insolence_10': { ..._map('오만의 탑 10층', 'Lv.75~85', 'tower', ['medusa', 'chimera', 'dire_wolf'], [{id:'zenith_queen', x:3500, y:3500}], [], []), maxMobs: 80 },
    'tower_of_insolence_30': { ..._map('오만의 탑 30층', 'Lv.80~90', 'tower', ['vampire', 'ifrit', 'lesser_demon'], [{id:'vampire_lord', x:3500, y:3500}], [], []), maxMobs: 85 },
    'tower_of_insolence_50': { ..._map('오만의 탑 50층', 'Lv.85~95', 'tower', ['bone_dragon', 'lesser_demon', 'lich'], [{id:'lich_boss', x:3500, y:3500}], [], []), maxMobs: 85 },
    'tower_of_insolence_70': { ..._map('오만의 탑 70층', 'Lv.85~95', 'tower', ['bone_dragon', 'succubus_queen', 'lich'], [{id:'iris', x:3500, y:3500}], [], []), maxMobs: 90 },
    'tower_of_insolence_100': { ..._map('오만의 탑 정상', 'Lv.95~100', 'tower', ['lesser_demon', 'balrog'], [{id:'grim_reaper', x:3500, y:3500}], [], []), maxMobs: 90 },
    'fire_dragon_nest': { ..._map('화룡의 둥지', 'Lv.100+', 'lava', ['fire_egg', 'lavagolem', 'ifrit', 'cerberus'], [{id:'valakas', x:3500, y:3500}], [], []), maxMobs: 75 },
    'oren': { ..._map('오렌 영지 (설벽)', 'Lv.60~75', 'stone', ['yeti', 'ice_golem'], [], [], []), maxMobs: 65 },
    'heine': { ..._map('하이네 (수중)', 'Lv.65~80', 'dungeon', ['crustacean', 'alligator', 'lizardman'], [], [], []), maxMobs: 75 },
    'aden': { ..._map('아덴 영지', 'Lv.75~90', 'grass', ['lizardman', 'gargoyle'], [], [], []), maxMobs: 65 },
    'forgotten_island': { ..._map('잊혀진 섬', 'Lv.85~99', 'dirt', ['minotaur', 'harpy', 'cockatrice'], [{id:'great_minotaur', x:3500, y:3500}], [], []), maxMobs: 80 },
    'lastebad': { ..._map('라스타바드', 'Lv.100~110', 'dungeon', ['dark_elf_guard', 'beast_master', 'dark_elf'], [{id:'dantes', x:3500, y:3500}], [], []), maxMobs: 85 },
    'tower_of_dominance': { ..._map('지배의 탑 정상', 'Lv.105+', 'tower', ['lesser_demon', 'lich', 'balrog'], [{id:'awakened_reaper', x:3500, y:3500}], [], []), maxMobs: 85 },
    'ivory_tower': { ..._map('상아탑', 'Lv.50~65', 'tower', ['paper_man', 'living_armor'], [{id:'demon', x:3500, y:3500}], [], []), maxMobs: 75 },
    'dream_island': { ..._map('몽환의 섬', 'Lv.60~75', 'grass', ['fire_egg', 'unicorn', 'succubus'], [{id:'great_spirit', x:3500, y:3500}], [], []), maxMobs: 60 },
    'giran_dungeon_1': { ..._map('기란 감옥 1층', 'Lv.45~60', 'dungeon', ['ghoul', 'bugbear', 'giran_guard', 'giran_prisoner'], [{id:'faust', x:3500, y:3500}], [], []), maxMobs: 90 },
    'giran_dungeon_4': { ..._map('기란 감옥 4층', 'Lv.55~70', 'dungeon', ['giran_guard', 'giran_prisoner', 'doppelganger'], [{id:'kline', x:3500, y:3500}], [], []), maxMobs: 90 },
    'eva_kingdom': { ..._map('에바 왕국 던전 (수던 4층)', 'Lv.60~75', 'dungeon', ['crustacean', 'alligator', 'mermaid', 'merman', 'bone_eel'], [{id:'zariandy', x:3500, y:3500}], [], []), maxMobs: 100 },
    'dragon_valley_deep': { ..._map('용의 계곡 심층', 'Lv.70~85', 'stone', ['giant_ogre', 'cockatrice', 'skeleton_marksman', 'drake'], [{id:'zeroth', x:3500, y:3500}], [], []), maxMobs: 80 },
    'elven_forest_deep': { ..._map('요정의 숲 깊은 곳', 'Lv.40~55', 'grass', ['ent', 'fairy', 'arachne', 'pan'], [], [], []), maxMobs: 70 }
};
// ==========================================
// [3. 몬스터 & 보스 데이터 (체력 대폭 상향)]
// ==========================================
const templates = {
    mobs: {
        'goblin': _mob('고블린', 120, 10, 80, 20, [15, 45], 15, '#4a2'),
        'orc': _mob('오크', 400, 20, 70, 100, [30, 90], 20, '#16a34a'),
        'skeleton': _mob('해골', 1200, 45, 90, 500, [100, 250], 20, '#ddd', {isUndead: true}),
        'ghoul': _mob('구울', 1600, 55, 70, 700, [150, 350], 22, '#84cc16', {isUndead: true}),
        'werewolf': _mob('늑대인간', 600, 30, 85, 150, [50, 120], 18, '#78350f'),
        'shelob': _mob('셀로브', 1000, 50, 120, 450, [80, 200], 25, '#991b1b'),
        'bugbear': _mob('버그베어', 2800, 75, 70, 1500, [300, 700], 28, '#b45309'),
        'scorpion': _mob('스콜피온', 2000, 65, 90, 1000, [200, 500], 22, '#d97706'),
        'giant_ant': _mob('거대 개미', 2200, 70, 80, 1200, [250, 600], 22, '#78350f'),
        'basilisk': _mob('바실리스크', 4500, 95, 50, 3000, [500, 1200], 35, '#15803d'),
        'cockatrice': _mob('코카트리스', 5500, 120, 100, 4500, [800, 1500], 28, '#b45309'),
        'skeleton_guard': _mob('해골 돌격병', 4000, 105, 100, 3000, [400, 1000], 22, '#e2e8f0', {isUndead: true}),
        'ogre': _mob('오우거', 9000, 160, 60, 8000, [1000, 3000], 40, '#92400e'),
        'murian': _mob('무리안', 7000, 140, 80, 6000, [800, 2000], 25, '#312e81'),
        'succubus': _mob('서큐버스', 8000, 190, 110, 8500, [1000, 2500], 22, '#be123c'),
        'bone_dragon': _mob('뼈 드래곤', 18000, 320, 80, 20000, [3000, 8000], 50, '#e2e8f0', {isUndead: true}),
        'medusa': _mob('메두사', 12000, 230, 90, 12000, [1500, 4000], 25, '#166534'),
        'chimera': _mob('키메라', 22000, 290, 100, 28000, [4000, 10000], 35, '#b45309'),
        'lesser_demon': _mob('레서 데몬', 35000, 420, 105, 40000, [6000, 15000], 30, '#b91c1c'),
        'lich': _mob('리치', 45000, 550, 70, 70000, [10000, 25000], 28, '#1e1b4b', {isUndead: true}),
        'balrog': _mob('발록', 70000, 800, 90, 120000, [20000, 50000], 45, '#7f1d1d'),
        'fire_egg': _mob('파이어 에그', 25000, 450, 60, 35000, [5000, 15000], 20, '#ea580c'),
        'lavagolem': _mob('라바 골렘', 70000, 700, 50, 100000, [15000, 40000], 40, '#c2410c'),
        'ifrit': _mob('이프리트', 110000, 1200, 100, 200000, [30000, 80000], 35, '#dc2626'),
        'yeti': _mob('예티', 5500, 120, 80, 4000, [600, 1500], 28, '#e2e8f0'),
        'ice_golem': _mob('얼음 골렘', 8000, 150, 60, 6000, [800, 2000], 35, '#bae6fd'),
        'crustacean': _mob('크러스테시안', 7000, 140, 70, 5000, [700, 1800], 25, '#f87171'),
        'alligator': _mob('악어', 9000, 170, 85, 7500, [1000, 2500], 30, '#15803d'),
        'lizardman': _mob('리자드맨', 10000, 190, 95, 8500, [1200, 2800], 22, '#4ade80'),
        'gargoyle': _mob('가고일', 12000, 210, 90, 11000, [1500, 3500], 28, '#94a3b8'),
        'minotaur': _mob('미노타우르스', 16000, 260, 80, 18000, [2500, 6000], 35, '#78350f'),
        'harpy': _mob('하피', 13000, 230, 110, 15000, [2000, 5000], 25, '#fde047'),
        'dark_elf_guard': _mob('다크엘프 근위병', 22000, 360, 100, 30000, [4000, 10000], 22, '#1e293b'),
        'beast_master': _mob('비스트 마스터', 28000, 410, 95, 40000, [5000, 12000], 28, '#7c2d12'),
        'paper_man': _mob('종이 맨', 3500, 80, 80, 2000, [100, 300], 20, '#ddd'),
        'living_armor': _mob('리빙 아머', 5500, 110, 60, 3500, [400, 800], 25, '#777'),
        'unicorn': _mob('유니콘', 7000, 130, 110, 5000, [500, 1500], 30, '#fff'),
        'giran_guard': _mob('기란 간수', 3500, 85, 80, 2000, [300, 700], 22, '#475569'),
        'giran_prisoner': _mob('굶주린 죄수', 3000, 95, 90, 1800, [100, 300], 20, '#78350f', {isUndead: true}),
        'mermaid': _mob('머메이드', 5000, 110, 85, 3500, [500, 1200], 22, '#0ea5e9'),
        'merman': _mob('머맨', 6000, 130, 80, 4000, [600, 1500], 25, '#0369a1'),
        'bone_eel': _mob('본 일', 7000, 150, 95, 5000, [800, 1800], 30, '#e2e8f0', {isUndead: true}),
        'giant_ogre': _mob('거대 오우거', 18000, 270, 60, 15000, [2000, 5000], 45, '#92400e'),
        'skeleton_marksman': _mob('해골 저격병', 3500, 160, 90, 3000, [300, 800], 20, '#cbd5e1', {isUndead: true}),
        'dire_wolf': _mob('다이어 울프', 4000, 120, 110, 2500, [200, 600], 22, '#1e293b'),
        'vampire': _mob('뱀파이어', 10000, 190, 120, 8000, [1000, 2500], 22, '#9f1239', {isUndead: true}),
        'succubus_queen': _mob('서큐버스 퀸', 14000, 260, 110, 15000, [2000, 5000], 25, '#be123c'),
        'arachne': _mob('아라크네', 2800, 70, 80, 1500, [200, 500], 25, '#4ade80'),
        'pan': _mob('판', 4000, 90, 90, 2500, [300, 800], 22, '#a3e635'),
        'fairy': _mob('페어리', 1800, 50, 120, 1000, [100, 300], 15, '#fde047'), 
        'slime': _mob('슬라임', 250, 20, 60, 50, [10, 30], 15, '#3b82f6'),
        'ungoliant': _mob('웅골리언트', 1500, 60, 80, 800, [150, 400], 25, '#7f1d1d'),
        'cerberus': _mob('켈베로스', 3500, 90, 110, 2000, [300, 800], 25, '#b91c1c'),
        
        'black_knight': _mob('흑기사', 1000, 45, 95, 400, [50, 150], 20, '#1a1a24', {isFamily: true}),
        'elite_black_knight': _mob('정예 흑기사', 1800, 70, 100, 800, [100, 300], 22, '#000', {isFamily: true}),
        'elder': _mob('장로', 1200, 65, 80, 750, [200, 500], 20, '#4b0082'),
        'dark_elf': _mob('다크엘프', 1200, 60, 110, 600, [100, 250], 20, '#1e293b'),
        'spartoi': _mob('스파토이', 1500, 55, 80, 600, [150, 300], 20, '#cbd5e1', {isUndead: true, isUnderground: true, desc: '접근 전엔 땅에 숨어있습니다.'}),
        'necromancer': _mob('네크로맨서', 10000, 210, 90, 8000, [1000, 3000], 22, '#4b0082'),
        'elmore_soldier': _mob('엘모어 병사', 4500, 100, 95, 2500, [300, 700], 20, '#e2e8f0', {isUndead: true, isFamily: true}),
        'elmore_mage': _mob('엘모어 마법사', 3800, 120, 85, 2800, [400, 900], 20, '#94a3b8', {isUndead: true, isFamily: true}),
        'mambo_rabbit': _mob('맘보토끼', 2500, 20, 150, 5000, [1000, 5000], 15, '#fbcfe8', {isFleeing: true}),
        'doppelganger': _mob('도플갱어', 4800, 90, 90, 3000, [500, 1000], 20, '#94a3b8'),
        'ent': _mob('엔트', 3500, 70, 50, 1000, [100, 300], 35, '#15803d', {desc: '요정의 숲 수호자'}),
        
        // 💡 카스파 일당을 초보~중급 보스로 승격 (잡으면 보스 전리품 및 환상 주문서 드롭)
        'caspa': _mob('카스파', 8000, 150, 90, 5000, [1500, 3000], 22, '#1e3a8a', {isBoss: true, matk: 100, isGroup: 'caspa_family', desc: '본던의 지배자'}),
        'balthazar': _mob('발터', 7500, 140, 90, 4500, [1500, 3000], 22, '#1e3a8a', {isBoss: true, matk: 90, isGroup: 'caspa_family'}),
        'melchior': _mob('메르키오르', 7500, 140, 90, 4500, [1500, 3000], 22, '#1e3a8a', {isBoss: true, matk: 90, isGroup: 'caspa_family'}),
        'sema': _mob('세마', 7500, 140, 90, 4500, [1500, 3000], 22, '#1e3a8a', {isBoss: true, matk: 90, isGroup: 'caspa_family'})
    },

    bosses: {
        // 💡 [초보존 이벤트 보스 3종] HP 2800~4000 / 공격력 55~65 (초보 유저 + 용병 파티로 1분 컷 가능)
        'black_knight_chief': _mob('흑기사 대장', 3500, 65, 100, 5000, [2000, 5000], 30, '#1a1a24', {matk: 45, isBoss: true, desc: '은기사 마을 외곽을 위협하는 초보존 이벤트 보스'}),
        'giant_ungoliant': _mob('거대 웅골리언트', 2800, 55, 90, 4000, [1500, 4000], 40, '#7f1d1d', {matk: 40, isBoss: true, desc: '말하는 섬 생태계의 파괴자 (초보존 보스)'}),
        'corrupted_ent': _mob('타락한 엔트', 4000, 60, 80, 4500, [1000, 3000], 45, '#15803d', {matk: 50, isBoss: true, desc: '요정의 숲 오염의 근원 (초보존 보스)'}),

        'demon': _mob('데몬', 150000, 180, 120, 500000, [50000, 150000], 50, '#f22', {matk: 200, isMagicBoss: true, desc: '화염 마법 구사'}),
        'great_spirit': _mob('대정령', 180000, 140, 100, 300000, [40000, 100000], 40, '#8ff', {matk: 130, isMagicBoss: true}),
        'baphomet': _mob('바포메트', 75000, 110, 110, 150000, [5000, 15000], 30, '#7f1d1d', {matk: 130, isUndead: true, isMagicBoss: true, drops: [{name: '바포메트의 지팡이', chance: 0.03}, {name: '마법서 (이럽션)', chance: 0.10}, {name: '무기 마법 주문서', chance: 0.3}, {name: '갑옷 마법 주문서', chance: 0.5}, {name: '맑은 물약', count: 5, chance: 1.0}]}),
        'deathknight': _mob('데스나이트', 80000, 140, 120, 180000, [20000, 50000], 30, '#f87171', {matk: 110, isUndead: true, desc: '체력 하락 시 헬파이어 사용', drops: [{name: '데스나이트의 불검', chance: 0.02}, {name: '데스나이트의 갑옷', chance: 0.03}, {name: '기술서 (카운터 바리어)', chance: 0.05}, {name: '무기 마법 주문서', chance: 0.4}]}),
        'kurz': _mob('커츠', 300000, 180, 110, 700000, [80000, 250000], 30, '#1e1b4b', {drops: [{name: '커츠의 검', chance: 0.03}, {name: '갑옷 마법 주문서', chance: 0.5}]}),
        'ant_queen': _mob('여왕 개미', 70000, 100, 90, 120000, [10000, 25000], 60, '#78350f', {matk: 90, drops: [{name: '거대 개미 여왕의 금빛 날개', chance: 0.05}]}),
        'black_elder': _mob('흑장로', 150000, 160, 90, 350000, [50000, 120000], 28, '#0f172a', {matk: 180, isMagicBoss: true, drops: [{name: '흑장로의 지팡이', chance: 0.04}, {name: '흑장로의 로브', chance: 0.05}]}),
        'drake': _mob('드레이크', 250000, 160, 130, 600000, [80000, 200000], 45, '#1d4ed8', {matk: 140, drops: [{name: '무기 마법 주문서', chance: 0.6}]}),
        'antharas': _mob('안타라스(지룡)', 260000, 240, 100, 900000, [100000, 250000], 80, '#166534', {matk: 280, desc: '지진과 광역 석화 마법', drops: [{name: '안타라스의 예지', chance: 0.01}, {name: '무기 마법 주문서', chance: 0.8}]}),
        'zenith_queen': _mob('제니스 퀸', 400000, 250, 130, 900000, [100000, 250000], 40, '#701a75', {matk: 160, isMagicBoss: true}),
        'lich_boss': _mob('리치(보스)', 600000, 280, 110, 1500000, [200000, 500000], 35, '#312e81', {matk: 180, isUndead: true, isMagicBoss: true, drops: [{name: '리치의 로브', chance: 0.03}]}),
        'grim_reaper': _mob('그림 리퍼', 220000, 200, 140, 700000, [50000, 150000], 60, '#000', {matk: 250, isMagicBoss: true, desc: '광역 디스인티그레이트', drops: [{name: '그림 리퍼의 투구', chance: 0.02}]}),
        'valakas': _mob('발라카스(화룡)', 300000, 280, 120, 1200000, [200000, 400000], 100, '#dc2626', {matk: 320, desc: '메테오 스트라이크 시전', drops: [{name: '발라카스의 완력', chance: 0.01}]}),
        'great_minotaur': _mob('대미노타우르스', 500000, 280, 100, 1200000, [300000, 800000], 50, '#451a03'),
        'dantes': _mob('명황 단테스', 1800000, 380, 130, 5000000, [1000000, 2500000], 35, '#0f172a', {matk: 190}),
        'awakened_reaper': _mob('각성한 사신', 4000000, 450, 150, 15000000, [3000000, 8000000], 70, '#581c87', {matk: 280, isMagicBoss: true, drops: [{name: '사신의 검', chance: 0.01}]})
    }
};

// ==========================================
// [4. 원본 그대로 유지 (NPC, Item, Magic, Shop, Util)]
// ==========================================
const npcs = [
    { id: 'pandora_ti', name: '판도라 (잡화)', x: 1800, y: 1900, map: 'talking_island', color: '#f7d' },
    { id: 'gerard_ti', name: '게라드 (마법)', x: 2200, y: 1900, map: 'talking_island', color: '#7bf' },
    { id: 'dayzel_ti', name: '데이젤 (강화)', x: 2000, y: 1800, map: 'talking_island', color: '#ff5' },
    { id: 'warehouse_ti', name: '창고지기', x: 1850, y: 2100, map: 'talking_island', color: '#ffb' },
    { id: 'petkeeper_ti', name: '펫 관리인', x: 2150, y: 2100, map: 'talking_island', color: '#a52' },
    { id: 'mercenary_ti', name: '⚔️ 용병 단장', x: 2000, y: 1950, map: 'talking_island', color: '#ff00aa' },
    { id: 'pandora_skt', name: '상인 (은기사)', x: 1850, y: 2050, map: 'silver_knight_town', color: '#f7d' },
    { id: 'gerard_skt', name: '마법 (은기사)', x: 2150, y: 2050, map: 'silver_knight_town', color: '#7bf' },
    { id: 'mercenary_skt', name: '⚔️ 용병 단장', x: 2000, y: 1950, map: 'silver_knight_town', color: '#ff00aa' },
    { id: 'pandora_giran', name: '상인 (기란)', x: 1850, y: 1950, map: 'giran', color: '#f7d' },
    { id: 'dayzel_giran', name: '강화 (기란)', x: 2150, y: 1950, map: 'giran', color: '#ff5' }
];

const itemDb = [
    _wp("수련자의 검", 2, 0), _wp("단검", 4, 0), _wp("오크족 단검", 3, 0), _wp("수련자의 지팡이", 2, 0),
    _am("마법사의 옷", "armor", 2, 0), _pt("파란 물약", 0, 300), _pt("맑은 물약", 120, 200),
    _pt("주홍 물약", 60, 72), _pt("초록 물약", 0, 108), _pt("용기의 물약", 0, 180), _pt("엘븐 와퍼", 0, 500, {isWafer: true}),
    { name: "귀환 주문서", type: "scroll", price: 108 },
    _wp("미스릴 단검", 8, 2, {isUndeadWeapon: true}), _wp("일본도", 10, 1), _wp("양손검", 12, 1), 
    _wp("레이피어", 11, 2, {isUndeadWeapon: true}), _wp("다마스커스 검", 15, 2), _wp("싸울아비 장검", 16, 3), 
    _wp("붉은 기사의 대검", 18, 3), _wp("커츠의 검", 22, 4), _wp("데스나이트의 불검", 25, 4, {skill: '파이어볼'}), 
    _wp("진명황의 집행검", 35, 4, {isUndeadWeapon: true}), 
    _wp("활", 5, 0, {isBow: true}), _wp("요정족 활", 9, 1, {isBow: true}), _wp("크로스보우", 12, 1, {isBow: true}), 
    _wp("장궁", 14, 2, {isBow: true}), _wp("흑빛의 활", 18, 3, {isBow: true}), _wp("파괴의 장궁", 20, 3, {isBow: true}), 
    _wp("사이하의 활", 25, 4, {isBow: true}), 
    _wp("마나의 지팡이", 3, 2, {mpDrain: 2}), _wp("수정 지팡이", 8, 2, {mpDrain: 1}), 
    _wp("바포메트의 지팡이", 15, 4, {skill: '이럽션'}), _wp("얼음 여왕의 지팡이", 18, 4, {skill: '블리자드'}),
    _wp("마력의 단검", 6, 2, { sp: 1, mpDrain: 1, desc: '타격 시 MP를 흡수하고 SP를 증가시킨다.' }),
    _wp("흑왕도", 20, 4, { str: 2, desc: '다크엘프 최고위 암살자의 검' }),
    _wp("흑장로의 지팡이", 12, 3, { sp: 2, mpRegen: 5 }),
    _wp("얼음여왕의 지팡이", 14, 4, { sp: 3, int: 2, skill: '블리자드' }),
    _wp("제로스의 지팡이", 18, 4, { sp: 5, int: 3, skill: '크리티컬 매직', desc: '궁극의 마법 지팡이' }),
    _wp("살천의 활", 16, 3, { isBow: true, dex: 2, skill: '엘븐 애로우' }),
    _wp("악몽의 장궁", 22, 4, { isBow: true, dex: 3, hitBonus: 5, desc: '적을 관통하는 악몽의 활' }),
    _wp("포르세의 검", 26, 4, { str: 2, skill: '이럽션' }),
    _wp("블러드서커", 18, 3, { vampiric: true, desc: '타격 시 일정 확률로 체력 흡수' }), 
    _am("가죽 갑옷", "armor", 3, 0), _am("사슬 갑옷", "armor", 5, 1), _am("요정족 판금 갑옷", "armor", 6, 1), 
    _am("강철 판금 갑옷", "armor", 8, 2), _am("흑장로의 로브", "armor", 5, 3, {mpRegen: 5}), 
    _am("파푸리온의 완력", "armor", 10, 4, {hpRegen: 5}), _am("안타라스의 인내", "armor", 12, 4, {hpRegen: 8}), 
    _am("데스나이트의 갑옷", "armor", 12, 4), 
    _am("수련자의 투구", "helmet", 1, 0), _am("투구", "helmet", 2, 0), _am("기사의 면갑", "helmet", 3, 2), 
    _am("마법 방어 투구", "helmet", 2, 2), _am("그림 리퍼의 투구", "helmet", 5, 4), 
    _am("보호 망토", "cloak", 1, 1), _am("마법 망토", "cloak", 2, 2), _am("투명 망토", "cloak", 2, 3), 
    _am("거대 개미 여왕의 금빛 날개", "cloak", 4, 4), 
    _am("가죽 장갑", "gloves", 1, 0), _am("장갑", "gloves", 1, 0), _am("강철 장갑", "gloves", 2, 2), 
    _am("파워 글로브", "gloves", 3, 3, {hpBonus: 20}), _am("암령의 장갑", "gloves", 4, 4, {atk: 2}), 
    _am("가죽 부츠", "boots", 1, 0), _am("강철 부츠", "boots", 3, 2), _am("흑장로의 샌달", "boots", 2, 3, {mpBonus: 20}), 
    _am("수련자의 반지", "ring", 0, 0), _am("멸마의 반지", "ring", 2, 2), _am("순간이동 조종 반지", "ring", 0, 3), 
    _am("오우거의 반지", "ring", 1, 3, {hpBonus: 50}), 
    _am("오우거의 벨트", "belt", 1, 3, {hpBonus: 30}),
    _am("멸마의 판금 갑옷", "armor", 9, 3, { mr: 15, desc: '강력한 마법 저항력을 지닌 판금' }),
    _am("고대의 가죽 갑옷", "armor", 8, 4, { hpRegen: 10, dex: 1, mr: 5 }),
    _am("파푸리온의 마력", "armor", 11, 4, { sp: 2, mr: 10, mpRegen: 10, desc: '수룡의 마력이 깃든 로브' }),
    _am("안타라스의 예지", "armor", 12, 4, { hpBonus: 100, hpRegen: 15, mr: 10, desc: '지룡의 예지가 깃든 갑옷' }),
    _am("발라카스의 완력", "armor", 13, 4, { str: 2, hpBonus: 150, def: 5, mr: 10, desc: '화룡의 힘이 깃든 궁극의 갑옷' }),
    _am("린드비오르의 인내", "armor", 11, 4, { dex: 2, dodge: 5, mr: 15, desc: '풍룡의 가속이 깃든 갑옷' }),
    _wp("나이트발드의 양손검", 28, 4),
    _wp("포르세의 검", 26, 4, {skill: '이럽션'}),
    _wp("사신의 검", 45, 4, {isUndeadWeapon: true, skill: '디스인티그레이트', desc: '지배의 탑 정상에서 드롭되는 신화의 무기'}),
    _wp("가이아의 격노", 35, 4, {isBow: true, desc: '대자연의 분노가 담긴 최강의 활'}),
    _am("반역자의 방패", "shield", 10, 4, {hpBonus: 100, desc: '확률적으로 대미지를 반사한다.'}),
    _am("리치의 로브", "armor", 15, 4, {mpRegen: 15, mpBonus: 100}),
    _am("지배자의 권능", "cloak", 8, 4, {hpRegen: 10, atk: 5}),
    _wp("무관의 양손검", 19, 3, {hpRegen: 2}), _wp("신관의 지팡이", 9, 3, {mpRegen: 3}),
    _am("엘름의 축복", "helmet", 3, 2, {dex: 1}), _am("신관의 투구", "helmet", 2, 3, {mpRegen: 1}),
    _am("요정족 티셔츠", "tshirt", 1, 1), _am("신관의 로브", "armor", 6, 3, {mpRegen: 5, hpBonus: 10}),
    _am("무관의 갑옷", "armor", 7, 3, {hpRegen: 5, hpBonus: 20}),
    _am("붉은 기사의 방패", "shield", 2, 2),
    _am("신체의 벨트", "belt", 0, 2, {hpBonus: 50}), _am("심연의 반지", "ring", 0, 3, {mpRegen: 1}),
    _am("빛나는 신체의 벨트", "belt", 0, 3, { hpBonus: 100, hpRegen: 2 }),
    _am("빛나는 정신의 벨트", "belt", 0, 3, { mpBonus: 50, mpRegen: 2 }),
    _am("빛나는 영혼의 벨트", "belt", 0, 4, { hpBonus: 50, mpBonus: 50, hpRegen: 2, mpRegen: 2 }),
    _am("수호의 반지", "ring", 0, 2, { hpRegen: 2, def: 1 }),
    _am("스냅퍼의 용사 반지", "ring", 0, 4, { str: 1, hpBonus: 30, atk: 2 }),
    _am("스냅퍼의 지혜 반지", "ring", 0, 4, { int: 1, mpBonus: 30, sp: 1 }),
    _am("룸티스의 푸른빛 귀걸이", "helmet", 0, 4, { hpBonus: 50, potionEffect: 10, desc: '물약 회복량 10% 증가 (투구 슬롯 착용)' }),
    _am("룸티스의 검은빛 귀걸이", "helmet", 0, 4, { def: 3, mr: 5, dmgReduct: 2 }),
    _am("룸티스의 붉은빛 귀걸이", "helmet", 0, 4, { hpBonus: 100, dmgReduct: 3 }),
    { name: "마법서 (데스 힐)", type: "book", magicName: "데스 힐", grade: 4, price: 5000000 },
    { name: "마법서 (마제스티)", type: "book", magicName: "마제스티", grade: 4, price: 10000000 },
    { name: "마법서 (저지먼트)", type: "book", magicName: "저지먼트", grade: 4, price: 20000000 }, 
    { name: "마법서 (콜 라이트닝)", type: "book", magicName: "콜 라이트닝", grade: 1 }, 
    { name: "마법서 (이럽션)", type: "book", magicName: "이럽션", grade: 2 }, 
    { name: "마법서 (라이트닝 스톰)", type: "book", magicName: "라이트닝 스톰", grade: 3 }, 
    { name: "마법서 (블리자드)", type: "book", magicName: "블리자드", grade: 4 }, 
    { name: "마법서 (서먼 몬스터)", type: "book", magicName: "서먼 몬스터", grade: 3 },
    { name: "마법서 (그레이트 힐)", type: "book", magicName: "그레이트 힐", grade: 2, price: 3500 },
    { name: "마법서 (실드)", type: "book", magicName: "실드", grade: 1, price: 1000 },
    { name: "마법서 (파이어볼)", type: "book", magicName: "파이어볼", grade: 1, price: 2000 }, 
    { name: "마법서 (뱀파이어릭 터치)", type: "book", magicName: "뱀파이어릭 터치", grade: 2, price: 5000 }, 
    { name: "마법서 (선버스트)", type: "book", magicName: "선버스트", grade: 3, price: 30000 }, 
    { name: "마법서 (어드밴스 스피릿)", type: "book", magicName: "어드밴스 스피릿", grade: 3, price: 50000 }, 
    { name: "마법서 (미티어 스트라이크)", type: "book", magicName: "미티어 스트라이크", grade: 4, price: 500000 }, 
    { name: "마법서 (디스인티그레이트)", type: "book", magicName: "디스인티그레이트", grade: 4, price: 1000000 }, 
    { name: "마법서 (캔슬레이션)", type: "book", magicName: "캔슬레이션", grade: 3, price: 100000 },
    { name: "마법서 (아이스 스파이크)", type: "book", magicName: "아이스 스파이크", grade: 3, price: 80000 },
    { name: "마법서 (헤일 스톰)", type: "book", magicName: "헤일 스톰", grade: 4, price: 800000 },
    { name: "마법서 (이뮨 투 함)", type: "book", magicName: "이뮨 투 함", grade: 4, price: 2000000 },
    { name: "마법서 (앱솔루트 배리어)", type: "book", magicName: "앱솔루트 배리어", grade: 4, price: 5000000 },
    { name: "마법서 (토네이도)", type: "book", magicName: "토네이도", grade: 4, price: 1500000 },
    { name: "마법서 (포그 오브 슬리핑)", type: "book", magicName: "포그 오브 슬리핑", grade: 3, price: 150000 },
    { name: "마법서 (매스 텔레포트)", type: "book", magicName: "매스 텔레포트", grade: 4, price: 1000000 },
    { name: "마법서 (홀리 워크)", type: "book", magicName: "홀리 워크", grade: 2, price: 80000 },
    { name: "정령의 수정 (네이쳐스 터치)", type: "book", magicName: "네이쳐스 터치", grade: 2, price: 10000 },
    { name: "정령의 수정 (윈드 워크)", type: "book", magicName: "윈드 워크", grade: 2, price: 50000 },
    { name: "정령의 수정 (스톰 샷)", type: "book", magicName: "스톰 샷", grade: 3, price: 200000 },
    { name: "정령의 수정 (트리플 애로우)", type: "book", magicName: "트리플 애로우", grade: 4, price: 1000000 },
    { name: "정령의 수정 (블러드 투 소울)", type: "book", magicName: "블러드 투 소울", grade: 2, price: 80000 },
    { name: "정령의 수정 (어스 스킨)", type: "book", magicName: "어스 스킨", grade: 2, price: 50000 },
    { name: "정령의 수정 (파이어 웨폰)", type: "book", magicName: "파이어 웨폰", grade: 2, price: 50000 },
    { name: "정령의 수정 (워터 라이프)", type: "book", magicName: "워터 라이프", grade: 3, price: 150000 },
    { name: "정령의 수정 (소울 오브 프레임)", type: "book", magicName: "소울 오브 프레임", grade: 4, price: 3000000 },
    { name: "정령의 수정 (스트라이커 게일)", type: "book", magicName: "스트라이커 게일", grade: 4, price: 2000000 },
    { name: "정령의 수정 (어스 바인드)", type: "book", magicName: "어스 바인드", grade: 4, price: 3000000 },
    { name: "정령의 수정 (폴루트 워터)", type: "book", magicName: "폴루트 워터", grade: 3, price: 800000 },
    { name: "기술서 (쇼크 스턴)", type: "book", magicName: "쇼크 스턴", grade: 3, price: 500000 },
    { name: "기술서 (리덕션 아머)", type: "book", magicName: "리덕션 아머", grade: 4, price: 2000000 },
    { name: "기술서 (카운터 바리어)", type: "book", magicName: "카운터 바리어", grade: 4, price: 10000000 }, 
    { name: "기술서 (바운스 어택)", type: "book", magicName: "바운스 어택", grade: 3, price: 1200000 },
    { name: "기술서 (솔리드 캐리지)", type: "book", magicName: "솔리드 캐리지", grade: 2, price: 500000 },
    { name: "기술서 (블로우 어택)", type: "book", magicName: "블로우 어택", grade: 4, price: 4000000 },

    // =========================================================================
    // 🌟 [전설 I (Grade 5)] - 초월 무기 & 성스러운 방어구
    // =========================================================================
    // [무기]
    _wp("[초월] 진명황의 집행검", 48, 5, { str: 3, isUndeadWeapon: true, skill: '쇼크 스턴', desc: '고대 명황의 진정한 힘이 깨어난 초월의 대검 (타격 시 쇼크 스턴 발동)' }),
    _wp("[초월] 가이아의 격노", 45, 5, { isBow: true, dex: 3, skill: '트리플 애로우', desc: '대자연의 분노가 서린 신화급 장궁 (타격 시 트리플 애로우 발동)' }),
    _wp("[초월] 제로스의 지팡이", 28, 5, { sp: 8, int: 4, mpRegen: 8, skill: '디스인티그레이트', desc: '파멸의 마력을 응축시킨 초월 지팡이 (타격 시 디스인티그레이트 발동)' }),
    _wp("[초월] 흑왕도", 38, 5, { str: 3, dex: 2, vampiric: true, desc: '암살의 정점에 도달한 전설의 이도류' }),

    // [방어구 & 장신구]
    _am("아인하사드의 신성 갑옷", "armor", 16, 5, { hpBonus: 200, hpRegen: 15, mr: 20, desc: '빛의 가호가 깃든 성스러운 판금 갑옷' }),
    _am("에바의 축복 투구", "helmet", 8, 5, { hpBonus: 100, mpBonus: 60, def: 8, mr: 10, desc: '물의 여신 에바의 기운이 깃든 투구' }),
    _am("신화 지배자의 벨트", "belt", 3, 5, { hpBonus: 150, mpBonus: 100, hpRegen: 5, mpRegen: 5, desc: '생명력과 마력을 동시에 대폭 증폭시키는 벨트' }),
    _am("태고의 전설 반지", "ring", 2, 5, { str: 2, dex: 2, int: 2, atk: 5, sp: 3, desc: '모든 잠재력을 일깨우는 태고의 반지' }),


    // =========================================================================
    // 🔥 [전설 II (Grade 6)] - 이계의 지배자 & 드래곤 장비
    // =========================================================================
    // [무기]
    _wp("기르타스의 진홍빛 검", 62, 6, { str: 5, isUndeadWeapon: true, skill: '블로우 어택', desc: '이계의 지배자 기르타스의 피가 흐르는 파괴의 검 (타격 시 블로우 어택 발동)' }),
    _wp("실프의 심판 활", 58, 6, { isBow: true, dex: 5, hitBonus: 8, skill: '스톰 샷', desc: '바람의 정령왕 실프의 칼바람을 쏘아보내는 활 (타격 시 스톰 샷 발동)' }),
    _wp("발록의 파멸 지팡이", 36, 6, { sp: 12, int: 6, mpRegen: 12, skill: '미티어 스트라이크', desc: '화염과 암흑 마력이 휘몰아치는 보주 지팡이 (타격 시 미티어 스트라이크 발동)' }),

    // [방어구 & 장신구]
    _am("기르타스의 흉갑", "armor", 22, 6, { hpBonus: 350, def: 22, mr: 25, dmgReduct: 8, desc: '적의 어떤 공격도 무력화시키는 이계의 흉갑' }),
    _am("영원의 불사 망토", "cloak", 12, 6, { hpRegen: 20, mpRegen: 12, atk: 8, def: 12, desc: '착용자의 생명력을 끊임없이 회복시키는 신비의 망토' }),
    _am("드래곤 슬레이어 장갑", "gloves", 9, 6, { str: 3, dex: 3, atk: 6, def: 9, desc: '용을 베어넘긴 영웅의 힘이 담긴 장갑' }),
    _am("발라카스의 심장 반지", "ring", 3, 6, { str: 4, hpBonus: 200, atk: 8, desc: '화룡 발라카스의 뜨거운 심장이 박힌 반지' }),


    // =========================================================================
    // 👑 [전설 III (Grade 7)] - 창세와 절대신의 궁극 신화 장비
    // =========================================================================
    // [무기]
    _wp("[신화] 그랑카인의 파멸검", 82, 7, { str: 8, isUndeadWeapon: true, skill: '저지먼트', desc: '파괴신 그랑카인의 권능이 깃든 절대의 대검 (타격 시 화면 전체에 저지먼트 심판 발동)' }),
    _wp("[신화] 아인하사드의 빛살", 78, 7, { isBow: true, dex: 8, skill: '저지먼트', desc: '빛의 여신 아인하사드가 하사한 궁극의 신화 활 (타격 시 저지먼트 심판 발동)' }),
    _wp("[신화] 창세신의 권능 지팡이", 48, 7, { sp: 20, int: 10, mpRegen: 20, skill: '저지먼트', desc: '모든 마법 법칙을 왜곡하고 지배하는 태초의 지팡이 (타격 시 저지먼트 발동)' }),

    // [방어구 & 장신구]
    _am("[신화] 태초의 창세 갑옷", "armor", 30, 7, { hpBonus: 600, mpBonus: 300, def: 30, mr: 35, dmgReduct: 15, desc: '물리와 마법 대미지를 압도적으로 상쇄하는 궁극의 신화 갑옷' }),
    _am("[신화] 신들의 제왕 투구", "helmet", 15, 7, { str: 4, dex: 4, int: 4, def: 15, mr: 20, potionEffect: 25, desc: '모든 능력치와 물약 회복량을 극대화하는 신화의 투구' }),
    _am("[신화] 불멸의 지배자 방패", "shield", 20, 7, { hpBonus: 300, def: 20, dmgReduct: 10, desc: '모든 재앙을 막아내는 절대적인 불멸의 방패' }),
    _am("[신화] 영겁의 시공 부츠", "boots", 12, 7, { speed: 30, def: 12, dodge: 15, desc: '시간과 공간을 가르는 궁극의 이동 속도와 회피율을 부여하는 신화 부츠' }),
    _am("[신화] 전지전능의 고대 반지", "ring", 6, 7, { str: 6, dex: 6, int: 6, sp: 8, atk: 12, hpBonus: 300, mpBonus: 200, desc: '신에 필적하는 힘을 부여하는 궁극의 반지' }),

   _pt("고기", 10, 50, {isMeat: true})
];

const magicDb = {
    '에너지 볼트': { mp: 1, range: 300, dmg: 15, type: 'attack', projSpeed: 300, homing: true, icon: '⚡', cd: 500, desc: '[단일 공격] 기초적인 마법 에너지를 발사합니다.' }, 
    '실드': { mp: 8, type: 'buff', icon: '🛡️', cd: 0, buffType: 'def', val: 2, duration: 300000, desc: '[보조] 방어력(AC)을 -2만큼 낮춰줍니다.' },
    '힐': { mp: 1, heal: 40, type: 'buff', icon: '💚', cd: 0, desc: '[회복] 소량의 체력을 회복합니다.' }, 
    '가속': { mp: 5, duration: 300000, type: 'buff', icon: '💨', cd: 0, buffType: 'speed', val: 60, desc: '[보조] 5분간 이동 및 공격 속도가 증가합니다.' }, 
    '파이어볼': { mp: 3, range: 300, dmg: 50, type: 'attack', projSpeed: 650, homing: false, icon: '🔥', aoe: 150, cd: 0, desc: '[광역 공격] 화염구를 발사하여 반경 150 내의 적들을 공격합니다.' }, 
    '콜 라이트닝': { mp: 2, range: 350, dmg: 35, type: 'attack', icon: '🌩️', cd: 0, desc: '[단일 공격] 번개를 떨어뜨려 공격합니다.' }, 
    '그레이트 힐': { mp: 5, heal: 150, type: 'buff', icon: '💖', cd: 0, desc: '[회복] 다량의 체력을 회복합니다.' },
    '이럽션': { mp: 3, range: 250, dmg: 45, type: 'attack', icon: '🌋', cd: 0, desc: '[단일 공격] 땅에서 용암을 분출시켜 공격합니다.' },
    '뱀파이어릭 터치': { mp: 12, range: 300, dmg: 40, type: 'attack', icon: '🦇', cd: 0, vampiric: true, desc: '[단일 공격/흡혈] 적에게 데미지를 주고 절반을 HP로 흡수합니다.' },
    '커스 파라다이스': { mp: 15, range: 300, dmg: 10, type: 'attack', icon: '🌀', cd: 0, desc: '[디버프] 대상의 이동을 방해합니다.' },
    '홀리 워크': { mp: 15, type: 'buff', icon: '✨', cd: 0, buffType: 'speed', val: 80, duration: 60000, desc: '[보조] 1분간 이동 속도를 비약적으로 상승시킵니다.' },
    '라이트닝 스톰': { mp: 10, range: 350, dmg: 80, aoe: 250, type: 'attack', icon: '⛈️', cd: 0, desc: '[광역 공격] 넓은 범위에 강력한 번개 폭풍을 일으킵니다.' }, 
    '선버스트': { mp: 20, range: 350, dmg: 110, aoe: 200, type: 'attack', icon: '☀️', cd: 0, desc: '[광역 공격] 빛의 에너지를 폭발시킵니다.' },
    '어드밴스 스피릿': { mp: 20, type: 'buff', icon: '💫', cd: 0, buffType: 'maxHpMp', val: 50, duration: 300000, desc: '[보조] 최대 HP와 MP를 50 증가시킵니다.' },
    '서먼 몬스터': { mp: 20, type: 'summon', icon: '🐺', cd: 0, desc: '[소환] 플레이어의 레벨에 맞는 몬스터를 소환합니다.' },
    '캔슬레이션': { mp: 20, range: 400, type: 'attack', dmg: 1, icon: '🚫', cd: 0, desc: '[상태 이상] 대상의 모든 이로운 마법을 해제합니다.' },
    '아이스 스파이크': { mp: 18, range: 350, dmg: 100, type: 'attack', icon: '🧊', cd: 0, desc: '[단일 공격] 날카로운 얼음 기둥을 솟구치게 합니다.' },
    '포그 오브 슬리핑': { mp: 30, range: 400, aoe: 250, type: 'attack', dmg: 10, icon: '🌫️', cd: 0, desc: '[디버프] 광역으로 적들의 이동과 공격을 멈춥니다.' }, 
    '블리자드': { mp: 15, range: 300, dmg: 150, aoe: 350, type: 'attack', icon: '❄️', cd: 0, desc: '[광역 공격] 거대한 얼음 폭풍으로 화면 전체를 공격합니다.' }, 
    '미티어 스트라이크': { mp: 30, range: 400, dmg: 250, aoe: 400, type: 'attack', icon: '☄️', cd: 0, desc: '[대형 광역] 거대한 운석을 소환하여 초토화시킵니다.' },
    '디스인티그레이트': { mp: 40, range: 400, dmg: 400, type: 'attack', projSpeed: 15, homing: true, icon: '💥', cd: 0, desc: '[단일 극딜] 목표물을 완전히 분해하는 궁극의 창조 마법.' },
    '헤일 스톰': { mp: 40, range: 350, dmg: 180, aoe: 300, type: 'attack', icon: '🌨️', cd: 0, desc: '[광역 공격] 강력한 우박 폭풍을 시전합니다.' },
    '이뮨 투 함': { mp: 30, type: 'buff', icon: '🛡️', cd: 0, buffType: 'dmgReduct', val: 10, duration: 60000, desc: '[생존/보조] 1분간 받는 모든 데미지를 크게 감소시킵니다.' },
    '앱솔루트 배리어': { mp: 50, type: 'buff', icon: '✨', cd: 0, buffType: 'invincible', val: 1, duration: 15000, desc: '[무적] 15초간 모든 공격과 마법으로부터 무적이 됩니다.' },
    '토네이도': { mp: 25, range: 350, dmg: 140, aoe: 250, type: 'attack', icon: '🌪️', cd: 0, desc: '[광역 공격] 거대한 회오리를 소환해 적을 찢어버립니다.' },
    '데스 힐': { mp: 30, type: 'attack', range: 400, dmg: 100, icon: '💀', cd: 0, desc: '[저주] 대상의 체력 회복 효과를 치명적인 대미지로 역전시킵니다.' },
    '마제스티': { mp: 40, type: 'buff', icon: '👑', cd: 0, buffType: 'def', val: 15, duration: 120000, desc: '[보조] 2분간 방어력이 극대화(AC -15) 됩니다.' },
    '저지먼트': { mp: 60, range: 450, dmg: 600, aoe: 500, type: 'attack', icon: '⚔️', cd: 0, desc: '[신화/광역] 거대한 심판의 검을 떨어뜨려 화면 내 모든 적을 섬멸합니다.' },
    '매스 텔레포트': { mp: 40, type: 'buff', icon: '🌀', cd: 5000, desc: '[유틸] 파티원 전체를 이끌고 지정된 장소로 텔레포트합니다.' },
    '네이쳐스 터치': { mp: 15, heal: 80, type: 'buff', icon: '🌿', cd: 0, desc: '[회복/요정] 자연의 힘으로 체력을 크게 회복합니다.' },
    '어스 바인드': { mp: 30, range: 350, type: 'attack', dmg: 1, icon: '🪨', cd: 0, desc: '[디버프/요정] 적을 돌로 만들어 무적 상태가 되지만 행동 불가로 만듭니다.' },
    '윈드 워크': { mp: 15, type: 'buff', icon: '💨', cd: 0, buffType: 'speed', val: 60, duration: 300000, desc: '[보조/요정] 바람의 힘으로 이동/공속을 올립니다.' },
    '스톰 샷': { mp: 20, type: 'buff', icon: '🌪️', cd: 0, buffType: 'atk', val: 5, duration: 300000, desc: '[보조/요정] 5분간 원거리 대미지가 크게 상승합니다.' },
    '트리플 애로우': { mp: 15, range: 400, dmg: 40, type: 'attack', icon: '🏹', cd: 0, isTriple: true, desc: '[단일 공격/요정] 화살 3발을 동시에 발사합니다.' },
    '블러드 투 소울': { mp: 0, hpCost: 40, healMp: 15, type: 'buff', icon: '🩸', cd: 0, desc: '[회복/요정] HP 40을 소모하여 MP 15를 회복합니다.' },
    '어스 스킨': { mp: 15, type: 'buff', icon: '🛡️', cd: 0, buffType: 'def', val: 4, duration: 300000, desc: '[보조/요정] 5분간 방어력(AC) -4 효과를 얻습니다.' },
    '파이어 웨폰': { mp: 15, type: 'buff', icon: '🔥', cd: 0, buffType: 'atk', val: 4, duration: 300000, desc: '[보조/요정] 5분간 근거리 타격치 +4 효과를 얻습니다.' },
    '워터 라이프': { mp: 20, type: 'buff', icon: '💧', cd: 0, buffType: 'hpRegen', val: 10, duration: 300000, desc: '[회복/요정] 5분간 HP 회복률이 크게 상승합니다.' },
    '아쿠아 프로텍트': { mp: 30, type: 'buff', icon: '🌊', cd: 0, buffType: 'dodge', val: 5, duration: 300000, desc: '[방어/요정] 원거리 회피율이 상승합니다.' },
    '스트라이커 게일': { mp: 30, range: 400, dmg: 10, type: 'attack', icon: '🎯', cd: 0, desc: '[디버프/요정] 적의 원거리 방어력을 크게 낮춥니다.' },
    '소울 오브 프레임': { mp: 30, type: 'buff', icon: '🌋', cd: 0, buffType: 'atk', val: 8, duration: 120000, desc: '[궁극/요정] 2분간 무기의 최대 대미지가 고정 적용됩니다.' },
    '폴루트 워터': { mp: 30, range: 400, dmg: 20, type: 'attack', icon: '☠️', cd: 0, desc: '[디버프/요정] 대상의 치유 효과를 반감시킵니다.' },
    '쇼크 스턴': { mp: 15, range: 120, type: 'attack', dmg: 20, icon: '🛡️', cd: 5000, desc: '[기사 스킬] 적을 강하게 가격하여 행동을 제어합니다.' },
    '리덕션 아머': { mp: 30, type: 'buff', icon: '🛡️', cd: 0, buffType: 'dmgReduct', val: 5, duration: 60000, desc: '[기사 스킬] 받는 피해를 고정 수치만큼 감소시킵니다.' },
    '카운터 바리어': { mp: 40, type: 'buff', icon: '⚔️', cd: 0, buffType: 'counter', val: 1, duration: 30000, desc: '[기사 스킬] 근접 공격을 회피하고 강력하게 반격합니다.' },
    '바운스 어택': { mp: 20, type: 'buff', icon: '⚔️', cd: 0, buffType: 'hitBonus', val: 6, duration: 120000, desc: '[기사 스킬] 2분간 근거리 명중률이 대폭 상승합니다.' },
    '솔리드 캐리지': { mp: 20, type: 'buff', icon: '🛡️', cd: 0, buffType: 'dodge', val: 15, duration: 120000, desc: '[기사 스킬] 2분간 원거리 회피율(ER)이 상승합니다.' },
'에어 블래스트': {
    name: '에어 블래스트',
    type: 'attack',
    dmg: 160,          // 기본 마법 대미지
    mp: 25,            // 소모 MP
    range: 220,        // 시전 사거리
    aoe: 180,          // 광역 폭발 반경
    icon: '🌪️',        // 마법 아이콘
    desc: '전방에 거대한 바람의 충격파를 일으켜 주변 적들에게 광역 대미지를 입히고 뒤로 밀쳐냅니다.'
},
    '블로우 어택': { mp: 30, type: 'buff', icon: '💥', cd: 0, buffType: 'atk', val: 10, duration: 60000, desc: '[기사 스킬] 1분간 무기 타격치가 1.5배로 터질 확률이 생깁니다.' }
};

const shopWares = { 
    'pandora': [ 
        { name: "수련자의 검", type: "weapon", atk: 2, grade: 0, price: 100 }, 
        { name: "단검", type: "weapon", atk: 4, grade: 0, price: 200 }, 
        { name: "일본도", type: "weapon", atk: 10, grade: 1, price: 5000 },
        { name: "싸울아비 장검", type: "weapon", atk: 16, grade: 3, price: 45000 },
        { name: "활", type: "weapon", atk: 5, grade: 0, isBow: true, price: 300 }, 
        { name: "크로스보우", type: "weapon", atk: 12, grade: 1, isBow: true, price: 12000 },
        { name: "장궁", type: "weapon", atk: 14, grade: 2, isBow: true, price: 35000 },
        { name: "수련자의 지팡이", type: "weapon", atk: 2, grade: 0, price: 100 },
        { name: "마나의 지팡이", type: "weapon", atk: 3, grade: 2, mpDrain: 2, price: 25000 },
        { name: "가죽 갑옷", type: "armor", def: 3, grade: 0, price: 500 }, 
        { name: "사슬 갑옷", type: "armor", def: 5, grade: 1, price: 2000 }, 
        { name: "강철 판금 갑옷", type: "armor", def: 8, grade: 2, price: 15000 },
        { name: "요정족 판금 갑옷", type: "armor", def: 6, grade: 1, price: 8000 },
        { name: "엘름의 축복", type: "helmet", def: 3, grade: 2, dex: 1, price: 20000 },
        { name: "흑장로의 로브", type: "armor", def: 5, grade: 3, mpRegen: 5, price: 50000 },
        { name: "강철 부츠", type: "boots", def: 3, grade: 2, price: 6000 },
        { name: "주홍 물약", type: "potion", heal: 60, price: 72, isBundle: true, bundleQty: 10, dispName: "주홍 물약 10개", dispPrice: 720 }, 
        { name: "맑은 물약", type: "potion", heal: 120, price: 200, isBundle: true, bundleQty: 5, dispName: "맑은 물약 5개", dispPrice: 1000 }, 
        { name: "파란 물약", type: "potion", heal: 0, price: 300, isBundle: true, bundleQty: 5, dispName: "파란 물약 5개", dispPrice: 1500 }, 
        { name: "용기의 물약", type: "potion", heal: 0, price: 180, isBundle: true, bundleQty: 5, dispName: "용기의 물약 5개", dispPrice: 900 }, 
        { name: "초록 물약", type: "potion", heal: 0, price: 108, isBundle: true, bundleQty: 5, dispName: "초록 물약 5개", dispPrice: 540 }, 
        { name: "고기", type: "potion", heal: 10, price: 50, isMeat: true, isBundle: true, bundleQty: 5, dispName: "고기(테이밍용) 5개", dispPrice: 250 },
        { name: "엘븐 와퍼", type: "potion", heal: 0, price: 500, isBundle: true, bundleQty: 5, dispName: "엘븐 와퍼 5개", dispPrice: 2500 },
        { name: "귀환 주문서", type: "scroll", price: 108 } 
    ], 
    'gerard': [ 
        // --- 마법사 마법 ---
        { name: "마법서 (에너지 볼트)", type: "book", magicName: "에너지 볼트", price: 360 }, 
        { name: "마법서 (실드)", type: "book", magicName: "실드", price: 1000 }, 
        { name: "마법서 (힐)", type: "book", magicName: "힐", price: 720 }, 
        { name: "마법서 (파이어볼)", type: "book", magicName: "파이어볼", price: 2000 }, 
        { name: "마법서 (콜 라이트닝)", type: "book", magicName: "콜 라이트닝", price: 2500 },
        { name: "마법서 (뱀파이어릭 터치)", type: "book", magicName: "뱀파이어릭 터치", price: 5000 }, 
        { name: "마법서 (가속)", type: "book", magicName: "가속", price: 1800 }, 
        { name: "마법서 (그레이트 힐)", type: "book", magicName: "그레이트 힐", price: 3500 }, 
        { name: "마법서 (이럽션)", type: "book", magicName: "이럽션", price: 4500 },
        { name: "마법서 (서먼 몬스터)", type: "book", magicName: "서먼 몬스터", price: 15000 },
        { name: "마법서 (선버스트)", type: "book", magicName: "선버스트", price: 30000 },
        { name: "마법서 (어드밴스 스피릿)", type: "book", magicName: "어드밴스 스피릿", price: 50000 },
        { name: "마법서 (아이스 스파이크)", type: "book", magicName: "아이스 스파이크", price: 80000 },
        { name: "마법서 (홀리 워크)", type: "book", magicName: "홀리 워크", price: 80000 },
        { name: "마법서 (캔슬레이션)", type: "book", magicName: "캔슬레이션", price: 100000 },
        { name: "마법서 (포그 오브 슬리핑)", type: "book", magicName: "포그 오브 슬리핑", price: 150000 },
        { name: "마법서 (미티어 스트라이크)", type: "book", magicName: "미티어 스트라이크", price: 500000 },
        { name: "마법서 (헤일 스톰)", type: "book", magicName: "헤일 스톰", price: 800000 },
        { name: "마법서 (매스 텔레포트)", type: "book", magicName: "매스 텔레포트", price: 1000000 },
        { name: "마법서 (디스인티그레이트)", type: "book", magicName: "디스인티그레이트", price: 1000000 },
        { name: "마법서 (토네이도)", type: "book", magicName: "토네이도", price: 1500000 },
        { name: "마법서 (이뮨 투 함)", type: "book", magicName: "이뮨 투 함", price: 2000000 },
        { name: "마법서 (데스 힐)", type: "book", magicName: "데스 힐", price: 5000000 },
        { name: "마법서 (앱솔루트 배리어)", type: "book", magicName: "앱솔루트 배리어", price: 5000000 },
        { name: "마법서 (마제스티)", type: "book", magicName: "마제스티", price: 10000000 },
        { name: "마법서 (저지먼트)", type: "book", magicName: "저지먼트", price: 20000000 },

        // --- 정령의 수정 (요정) ---
        { name: "정령의 수정 (네이쳐스 터치)", type: "book", magicName: "네이쳐스 터치", price: 10000 },
        { name: "정령의 수정 (어스 스킨)", type: "book", magicName: "어스 스킨", price: 50000 },
        { name: "정령의 수정 (파이어 웨폰)", type: "book", magicName: "파이어 웨폰", price: 50000 },
        { name: "정령의 수정 (윈드 워크)", type: "book", magicName: "윈드 워크", price: 50000 },
        { name: "정령의 수정 (블러드 투 소울)", type: "book", magicName: "블러드 투 소울", price: 80000 },
        { name: "정령의 수정 (워터 라이프)", type: "book", magicName: "워터 라이프", price: 150000 },
        { name: "정령의 수정 (스톰 샷)", type: "book", magicName: "스톰 샷", price: 200000 },
        { name: "정령의 수정 (폴루트 워터)", type: "book", magicName: "폴루트 워터", price: 800000 },
        { name: "정령의 수정 (트리플 애로우)", type: "book", magicName: "트리플 애로우", price: 1000000 },
        { name: "정령의 수정 (스트라이커 게일)", type: "book", magicName: "스트라이커 게일", price: 2000000 },
        { name: "정령의 수정 (어스 바인드)", type: "book", magicName: "어스 바인드", price: 3000000 },
        { name: "정령의 수정 (소울 오브 프레임)", type: "book", magicName: "소울 오브 프레임", price: 3000000 },

        // --- 기술서 (기사) ---
        { name: "기술서 (쇼크 스턴)", type: "book", magicName: "쇼크 스턴", price: 100000 },
        { name: "기술서 (솔리드 캐리지)", type: "book", magicName: "솔리드 캐리지", price: 500000 },
        { name: "기술서 (바운스 어택)", type: "book", magicName: "바운스 어택", price: 1200000 },
        { name: "기술서 (리덕션 아머)", type: "book", magicName: "리덕션 아머", price: 2000000 },
        { name: "기술서 (블로우 어택)", type: "book", magicName: "블로우 어택", price: 4000000 },
        { name: "기술서 (카운터 바리어)", type: "book", magicName: "카운터 바리어", price: 10000000 }
    ],
    'dayzel': [ 
        { name: "무기 마법 주문서", type: "scroll", price: 12600 }, 
        { name: "갑옷 마법 주문서", type: "scroll", price: 5400 } 
    ] 
};

function isInSafeZone(mapId, x, y) { let zones = maps[mapId] && maps[mapId].safeZones; if (zones) { for(let sz of zones) { if (Math.hypot(x - sz.x, y - sz.y) <= sz.r) return true; } } return false; }
function isNearPortal(mapId, x, y) { return false; }
function getExtraDesc(name) { 
    const descs = { '맑은 물약': '체력을 크게 회복.', '파란 물약': '마나를 약 30 회복.', '주홍 물약': '체력을 약 60 회복.', '초록 물약': '공속 상승.', '용기의 물약': '기사 전용.', '귀환 주문서': '마을로 귀환.', '마나의 지팡이': '타격 시 MP 2 흡수.', '수정 지팡이': '타격 시 MP 1 흡수.', '레이피어': '언데드 추가 타격.', '미스릴 단검': '언데드 추가 타격.', '진명황의 집행검': '전설의 무기.', '데스나이트의 불검': '10% 확률 파이어볼.', '얼음 여왕의 지팡이': '10% 확률 블리자드.', '바포메트의 지팡이': '10% 확률 이럽션.', '고기': '도베르만 테이밍.' }; 
    return descs[name] || ''; 
}
const potionMap = { '빨간': { c: '#d00', g: '#f00' }, '주홍': { c: '#f80', g: '#fa0' }, '맑은': { c: '#fff', g: '#ddd' }, '파란': { c: '#00f', g: '#55f' }, '초록': { c: '#0c0', g: '#0f0' }, '용기': { c: '#da0', g: '#fd0' }, '와퍼': { c: '#8f8', g: '#afa' }, '고기': { c: '#a42', g: '#f66' } };
function getPotionColorInfo(name) { if (!name || typeof name !== 'string') return { c: '#fff', g: '#fff' }; for(let key in potionMap) if(name.includes(key)) return potionMap[key]; return { c: '#fff', g: '#fff' }; }
function getPotionIcon(type) { if(type === '고기') return `🍖`; let info = getPotionColorInfo(type); return `<div style="display:inline-block; width:16px; height:20px; background:radial-gradient(circle at 30% 30%, #fff 5%, ${info.c} 60%); border-radius: 5px 5px 2px 2px; border:1px solid #333; box-shadow: 0 0 5px ${info.g}; position:relative; overflow:hidden;"><div style="position:absolute; top:-2px; left:3px; width:8px; height:4px; background:#cca; border-radius:2px;"></div></div>`; }
function getItemIcon(it) { if (!it || !it.name) return '🎒'; let name = it.name; if(it.type === 'potion') return getPotionIcon(name); if(it.type === 'scroll') return '📜'; if(it.type === 'book') return '📘'; if(it.type === 'weapon') { if(it.isBow || (typeof name === 'string' && (name.includes('활') || name.includes('크로스보우') || name.includes('장궁')))) return '🏹'; if(typeof name === 'string' && name.includes('지팡이')) return '🦯'; return '🗡️'; } if(it.type === 'armor') return '🦺'; if(it.type === 'helmet') return '🪖'; if(it.type === 'shield') return '🛡️'; if(it.type === 'cloak') return '🧥'; if(it.type === 'gloves') return '🧤'; if(it.type === 'boots') return '👢'; if(it.type === 'belt') return '🎗️'; if(it.type === 'ring1' || it.type === 'ring2' || it.type === 'ring') return '💍'; return '🎒'; }
function getStackKey(it) { if (it.isEnchantScroll) return `enchant_${it.enchantType}_${it.enchantValue}`; if (['potion', 'scroll', 'book', 'gold'].includes(it.type)) return it.name; if (['weapon', 'armor', 'helmet', 'shield', 'cloak', 'gloves', 'boots', 'belt', 'ring1', 'ring2', 'ring'].includes(it.type)) { let enchant = it.enchantValue || 0; let encType = it.enchantType || 'none'; let opts = (it.magicOptions || []).sort().join(','); return `eq_${it.name}_${enchant}_${encType}_${opts}`; } if (!it.id) it.id = 'eq_' + Math.random().toString(36).substr(2, 9); return it.id; }
if (typeof module !== 'undefined' && module.exports) { module.exports = { gradeColors, gradeNames, classData, maps, templates, npcs, itemDb, magicDb, shopWares, isInSafeZone, isNearPortal, getExtraDesc, getPotionColorInfo, getPotionIcon, getItemIcon, getStackKey }; }
