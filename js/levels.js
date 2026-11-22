// 15 个关卡：三张地图，一关比一关难
// 每关：地图 map、天空 sky（day 白天 / sunrise 清晨 / dusk 黄昏 / night 夜里）、出发点 start、
// 驻守的敌人 garrison（地图上的营地 area、人数、兵种），以及一步一步的任务 stages：
//   clear 消灭某个营地的敌人 · rescue 救出笼子里的队友 · demo 炸掉目标 · intel 拿到情报
//   survive 坚守一段时间 · boss 打败坏蛋司令 · goto 跑到某个地方 · extract 坐直升机撤离
(function () {
  'use strict';
  const LEVELS = [
    // ===================== 地图 1：松林山谷 =====================
    { name: '新兵上阵', icon: '🎯', map: 'valley', sky: 'day', start: [120, 370],
      brief: '欢迎加入雷霆特战队！坏蛋占领了湖东边的哨所。顺着土路往北走，躲在树和石头后面，把哨所夺回来。坏蛋没发现你之前不会开枪，可以悄悄靠近！',
      garrison: [{ area: 'outpost', n: 7, pool: [['grunt', 1]] }],
      stages: [{ t: 'clear', area: 'outpost', label: '夺回湖东哨所' }] },
    { name: '营救飞行员', icon: '🔓', map: 'valley', sky: 'day', start: [300, 120],
      brief: '我们的两名飞行员被关在东边伐木营的笼子里。站在笼子旁边几秒就能救出他们，救出来的人会跟着你一起战斗。然后在营地北边上直升机撤离！',
      garrison: [{ area: 'east', n: 9, pool: [['grunt', 3], ['runner', 1]] }, { area: 'outpost', n: 4, pool: [['grunt', 1]] }],
      stages: [{ t: 'rescue', cages: 'east', label: '救出飞行员' }, { t: 'extract', at: [430, 30] }] },
    { name: '清晨炸雷达', icon: '📡', map: 'valley', sky: 'sunrise', start: [250, -60],
      brief: '天刚亮，坏蛋的雷达站还在偷看我们。小心塔楼上的狙击手：看到一闪一闪的红光就快躲起来！站在目标旁边安放炸药，然后跑远一点。',
      garrison: [{ area: 'radar', n: 12, pool: [['grunt', 3], ['runner', 1], ['drone', 1]], snipers: 2 }],
      stages: [{ t: 'demo', targets: 'radar', label: '炸掉雷达站' }, { t: 'extract', at: [160, -330] }] },
    { name: '夺回林场', icon: '📁', map: 'valley', sky: 'day', start: [-250, 120],
      brief: '西边林场的木棚里藏着坏蛋的作战计划。把 3 份情报拿到手！林场里有重甲兵，用火箭筒或者手榴弹对付他。',
      garrison: [{ area: 'logging', n: 13, pool: [['grunt', 3], ['runner', 2], ['heavy', 1]], snipers: 1 }],
      stages: [{ t: 'intel', spots: 'logging', label: '拿到情报' }, { t: 'extract', at: [-250, -40] }] },
    { name: '黄昏守山口', icon: '🛡️', map: 'valley', sky: 'dusk', start: [70, -360],
      brief: '太阳快下山了。先夺下北边的山口，然后守住它 90 秒，坏蛋会从山那边一波一波冲过来。守住了，直升机就来接你！',
      garrison: [{ area: 'pass', n: 9, pool: [['grunt', 3], ['heavy', 1]], snipers: 1 }],
      stages: [{ t: 'clear', area: 'pass', label: '夺下山口' }, { t: 'survive', area: 'pass', time: 90, label: '守住山口', waves: { pool: [['grunt', 4], ['runner', 2], ['drone', 1], ['heavy', 1]], gap: 2.6, max: 9, from: [-60, -720] } }, { t: 'extract', at: [-60, -500] }] },

    // ===================== 地图 2：山间小镇 =====================
    { name: '进入小镇', icon: '🏘️', map: 'town', sky: 'day', start: [0, 150],
      brief: '坏蛋军团躲进了山间小镇。街道很窄，房子很多：每个路口都可能有坏蛋，慢慢推进，打掉 20 个坏蛋！',
      garrison: [{ area: 'town', n: 24, pool: [['grunt', 4], ['runner', 2], ['heavy', 1]] }],
      stages: [{ t: 'clear', area: 'town', need: 20, label: '清理小镇' }] },
    { name: '搜集情报', icon: '💼', map: 'town', sky: 'day', start: [-200, 60],
      brief: '小镇里散落着 4 份坏蛋的情报。地图（按 M 或点 🗺）上能看到情报的位置。拿到以后在广场上直升机撤离。',
      garrison: [{ area: 'town', n: 20, pool: [['grunt', 4], ['runner', 2], ['heavy', 1], ['drone', 1]] }],
      stages: [{ t: 'intel', spots: 'town', label: '拿到情报' }, { t: 'extract', at: [0, -40] }] },
    { name: '解救人质', icon: '🙋', map: 'town', sky: 'sunrise', start: [150, 120],
      brief: '3 名队友被关在小镇各处的笼子里。清晨的雾里坏蛋看不远，抓紧时间！救人的时候站着别动，让队友帮你掩护。',
      garrison: [{ area: 'town', n: 22, pool: [['grunt', 4], ['runner', 2], ['heavy', 1], ['drone', 1]] }, { area: 'farm', n: 6, pool: [['grunt', 1]] }],
      stages: [{ t: 'rescue', cages: 'town', label: '救出人质' }, { t: 'extract', at: [0, -40] }] },
    { name: '黄昏大突围', icon: '🔥', map: 'town', sky: 'dusk', start: [0, -40],
      brief: '我们被包围在小镇广场了！先坚守 100 秒，然后往北边的检查站突围，在那里坐直升机离开。',
      garrison: [{ area: 'check', n: 10, pool: [['grunt', 3], ['heavy', 1]], snipers: 1 }],
      stages: [{ t: 'survive', area: 'town', time: 100, label: '坚守广场', waves: { pool: [['grunt', 4], ['runner', 3], ['drone', 1], ['heavy', 1]], gap: 2.2, max: 11 } }, { t: 'clear', area: 'check', label: '突围到检查站' }, { t: 'extract', at: [0, -460] }] },
    { name: '炸掉军火库', icon: '💣', map: 'town', sky: 'day', start: [230, -60],
      brief: '东边采石场是坏蛋的军火库，4 堆弹药箱都要炸掉！那里有好几个狙击手和重甲兵，记得从侧面绕过去。',
      garrison: [{ area: 'quarry', n: 16, pool: [['grunt', 3], ['runner', 1], ['heavy', 2], ['drone', 1]], snipers: 2 }],
      stages: [{ t: 'demo', targets: 'quarry', label: '炸掉军火库' }, { t: 'extract', at: [330, -180] }] },

    // ===================== 地图 3：鹰巢要塞 =====================
    { name: '攀登鹰巢', icon: '⛰️', map: 'fort', sky: 'day', start: [20, 470],
      brief: '鹰巢要塞建在山顶上。顺着山路一路往上爬：先打下半山腰的哨卡，再清理要塞大门。有喷气背包的话可以直接飞上去！',
      garrison: [{ area: 'mid', n: 9, pool: [['grunt', 3], ['runner', 1]], snipers: 1 }, { area: 'gate', n: 7, pool: [['grunt', 2], ['heavy', 1]] }],
      stages: [{ t: 'clear', area: 'mid', label: '打下半山哨卡' }, { t: 'clear', area: 'gate', label: '清理要塞大门' }] },
    { name: '摧毁防空炮', icon: '🎯', map: 'fort', sky: 'sunrise', start: [-30, -10],
      brief: '要塞里的 4 门防空炮让我们的直升机飞不进来。冲进要塞把它们全部炸掉！城墙和角楼上都有狙击手。',
      garrison: [{ area: 'fort', n: 22, pool: [['grunt', 4], ['runner', 2], ['heavy', 1], ['drone', 1]], snipers: 3 }, { area: 'gate', n: 5, pool: [['grunt', 1]] }],
      stages: [{ t: 'demo', targets: 'fort', label: '炸掉防空炮' }, { t: 'extract', at: 'fort' }] },
    { name: '夺取密码', icon: '🗝️', map: 'fort', sky: 'dusk', start: [-30, -10],
      brief: '要塞主楼附近藏着 3 份密码本。拿到以后坏蛋会叫来增援，坚持到直升机降落！',
      garrison: [{ area: 'fort', n: 24, pool: [['grunt', 4], ['runner', 2], ['heavy', 2], ['drone', 1]], snipers: 3 }, { area: 'gate', n: 6, pool: [['grunt', 2], ['heavy', 1]] }],
      stages: [{ t: 'intel', spots: 'fort', label: '拿到密码本' }, { t: 'extract', at: 'fort', waves: { pool: [['grunt', 3], ['runner', 2], ['drone', 1]], gap: 3, max: 7 } }] },
    { name: '夜袭救人', icon: '🌙', map: 'fort', sky: 'night', start: [-30, -10],
      brief: '天黑了！枪上的手电会照亮前面。3 名队友被关在要塞里，悄悄摸进去把他们救出来，再坐直升机撤离。',
      garrison: [{ area: 'fort', n: 22, pool: [['grunt', 4], ['runner', 2], ['heavy', 2], ['drone', 1]], snipers: 3 }, { area: 'gate', n: 6, pool: [['grunt', 2], ['heavy', 1]] }],
      stages: [{ t: 'rescue', cages: 'fort', label: '救出队友' }, { t: 'extract', at: 'fort' }] },
    { name: '决战坏蛋司令', icon: '👑', map: 'fort', sky: 'dusk', start: [-30, -10],
      brief: '坏蛋司令就在要塞里！先打开大门，再冲进院子和他决战。他会放一圈子弹：跳起来躲开！打败他，所有地方就都安全了！',
      garrison: [{ area: 'gate', n: 8, pool: [['grunt', 2], ['heavy', 1]] }, { area: 'fort', n: 14, pool: [['grunt', 3], ['runner', 2], ['heavy', 1]], snipers: 3 }],
      stages: [{ t: 'clear', area: 'gate', label: '打开大门' }, { t: 'boss', area: 'fort', label: '打败坏蛋司令' }, { t: 'extract', at: 'fort' }] },
  ];
  window.TSLevels = LEVELS;
})();
