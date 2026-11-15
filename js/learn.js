// 学习模式：背单词 + 答题。打开时，过关、升级、复活前都要答对英语单词。
window.Learn = (function () {
  const WORDS = window.WORDS;
  const KEY = 'tri_words_v1';
  let stats = {};      // { en: { seen: 1, right: n, wrong: n } }
  let enabled = true;
  let sessionRight = 0;

  try {
    stats = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    enabled = localStorage.getItem('tri_learn') !== 'off';
  } catch (e) { stats = {}; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) {}
  }
  function st(w) { return stats[w[0]] || (stats[w[0]] = { seen: 0, right: 0, wrong: 0 }); }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function seenWords() { return WORDS.filter(w => stats[w[0]] && stats[w[0]].seen); }
  function mastered(w) { const s = stats[w[0]]; return s && s.right >= 3 && s.right > s.wrong; }

  // ---------- 朗读 ----------
  let voice = null;
  function pickVoice() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /en[-_]US/i.test(v.lang) && /Google|Samantha|Microsoft/i.test(v.name)) ||
            vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  const canSpeak = !!window.speechSynthesis;
  function speak(text) {
    if (!canSpeak) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.8; u.pitch = 1.05;
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- 界面 ----------
  const root = document.getElementById('quiz');
  const elTitle = root.querySelector('.q-title');
  const elSub = root.querySelector('.q-sub');
  const elBody = root.querySelector('.q-body');
  const elProg = root.querySelector('.q-progress');
  const elCancel = root.querySelector('.q-cancel');
  let cancelHandler = null;
  elCancel.addEventListener('click', () => { if (cancelHandler) cancelHandler(); });

  function show(title, sub, cancelText) {
    elTitle.textContent = title;
    elSub.textContent = sub || '';
    root.classList.remove('hidden');
    elCancel.classList.toggle('hidden', !cancelText);
    elCancel.textContent = cancelText || '';
  }
  function hide() { root.classList.add('hidden'); cancelHandler = null; }
  function setProgress(done, total) {
    let h = '';
    for (let i = 0; i < total; i++) h += `<span class="${i < done ? 'on' : ''}">★</span>`;
    elProg.innerHTML = h;
  }

  // 单词卡：先背
  function flashcard(w, label) {
    return new Promise(res => {
      st(w).seen = 1; save();
      elBody.innerHTML = `
        <div class="card pop">
          <div class="card-tag">${label || '新单词'}</div>
          <div class="card-emoji">${w[2]}</div>
          <div class="card-en">${w[0]}</div>
          <div class="card-zh">${w[1]}</div>
          <div class="card-spell">${w[0].split('').map(c => c === ' ' ? '&nbsp;' : `<b>${c}</b>`).join('')}</div>
          ${canSpeak ? '<button class="btn small speak">🔊 再听一遍</button>' : ''}
        </div>
        <button class="btn big go">我记住了！ ➜</button>`;
      const sp = elBody.querySelector('.speak');
      if (sp) sp.onclick = () => speak(w[0]);
      setTimeout(() => speak(w[0]), 250);
      const go = elBody.querySelector('.go');
      go.disabled = true;
      setTimeout(() => { go.disabled = false; }, 900); // 防止连点跳过
      go.onclick = () => { if (window.Sfx) Sfx.pickup(); res(); };
    });
  }

  function distractors(w, n, field) {
    const pool = shuffle(WORDS.filter(x => x[0] !== w[0] && x[field] !== w[field]));
    // 优先用已见过的单词做干扰项，避免全是陌生词
    pool.sort((a, b) => (stats[b[0]] && stats[b[0]].seen ? 1 : 0) - (stats[a[0]] && stats[a[0]].seen ? 1 : 0));
    const res = [];
    for (const x of pool) { if (res.length >= n) break; if (!res.some(r => r[field] === x[field])) res.push(x); }
    return res;
  }

  // 一道题，返回 Promise<boolean>
  function question(w) {
    return new Promise(res => {
      const types = ['pick-en', 'pick-zh', 'pick-en'];
      const single = w[0].replace(/ /g, '');
      if (single.length >= 3) types.push('spell');
      if (canSpeak) types.push('listen');
      const type = types[Math.floor(Math.random() * types.length)];
      let prompt = '', options = [], answer = '';

      if (type === 'pick-en' || type === 'listen') {
        const opts = shuffle([w].concat(distractors(w, 3, 0)));
        options = opts.map(o => o[0]); answer = w[0];
        prompt = type === 'pick-en'
          ? `<div class="q-emoji">${w[2]}</div><div class="q-zh">${w[1]}</div><div class="q-ask">用英语怎么说？</div>`
          : `<button class="btn listen-big">🔊</button><div class="q-ask">听一听，是哪个单词？</div>`;
      } else if (type === 'pick-zh') {
        const opts = shuffle([w].concat(distractors(w, 3, 1)));
        options = opts.map(o => o[1]); answer = w[1];
        prompt = `<div class="q-en">${w[0]}</div><div class="q-ask">是什么意思？</div>`;
      } else {
        // 拼写：挖掉一个字母
        const idxs = [];
        for (let i = 0; i < w[0].length; i++) if (w[0][i] !== ' ') idxs.push(i);
        const k = idxs[Math.floor(Math.random() * idxs.length)];
        answer = w[0][k];
        const letters = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(c => c !== answer);
        options = shuffle([answer].concat(shuffle(letters).slice(0, 3)));
        const shown = w[0].split('').map((c, i) => i === k ? '<i>?</i>' : (c === ' ' ? '&nbsp;' : c)).join('');
        prompt = `<div class="q-emoji">${w[2]}</div><div class="q-zh">${w[1]}</div><div class="q-spell">${shown}</div><div class="q-ask">缺了哪个字母？</div>`;
      }

      elBody.innerHTML = `<div class="q-prompt pop">${prompt}</div>
        <div class="q-options ${type === 'spell' ? 'letters' : ''}">${options.map((o, i) =>
          `<button class="btn opt" data-i="${i}"><span class="k">${i + 1}</span>${o}</button>`).join('')}</div>
        <div class="q-feedback"></div>`;
      const lb = elBody.querySelector('.listen-big');
      if (lb) { lb.onclick = () => speak(w[0]); }
      if (type === 'listen' || type === 'pick-zh') setTimeout(() => speak(w[0]), 250);

      let done = false;
      const btns = [...elBody.querySelectorAll('.opt')];
      function choose(i) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        const ok = options[i] === answer;
        const fb = elBody.querySelector('.q-feedback');
        btns.forEach((b, j) => {
          if (options[j] === answer) b.classList.add('right');
          else if (j === i) b.classList.add('wrong');
          b.disabled = true;
        });
        const s = st(w);
        if (ok) {
          s.right++; sessionRight++;
          fb.innerHTML = `<span class="good">${['太棒了！', '答对啦！', '真厉害！', '完美！', '超级棒！'][Math.floor(Math.random() * 5)]} ✨</span>
            <span class="ans">${w[2]} ${w[0]} = ${w[1]}</span>`;
          if (window.Sfx) Sfx.correct();
          speak(w[0]);
        } else {
          s.wrong++;
          fb.innerHTML = `<span class="bad">再记一下哦 💪</span><span class="ans">${w[2]} ${w[0]} = ${w[1]}</span>`;
          if (window.Sfx) Sfx.wrong();
          setTimeout(() => speak(w[0]), 300);
        }
        save();
        setTimeout(() => res(ok), ok ? 1100 : 2300);
      }
      btns.forEach((b, i) => b.onclick = () => choose(i));
      function onKey(e) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= options.length) choose(n - 1);
      }
      document.addEventListener('keydown', onKey);
    });
  }

  // 挑选复习的单词：答错多的、答对少的优先
  function pickReview(exclude) {
    let pool = seenWords().filter(w => !exclude.includes(w[0]));
    if (pool.length < 3) {
      // 见过的太少：从下一个没学过的单词里拿
      const fresh = WORDS.find(w => !(stats[w[0]] && stats[w[0]].seen) && !exclude.includes(w[0]));
      if (fresh) return fresh;
      pool = WORDS.filter(w => !exclude.includes(w[0]));
    }
    pool.sort((a, b) => {
      const sa = st(a), sb = st(b);
      return (sa.right - sa.wrong * 2) - (sb.right - sb.wrong * 2) + (Math.random() - 0.5) * 3;
    });
    return pool[Math.floor(Math.random() * Math.min(5, pool.length))];
  }

  return {
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = v;
      try { localStorage.setItem('tri_learn', v ? 'on' : 'off'); } catch (e) {}
    },
    get sessionRight() { return sessionRight; },
    resetSession() { sessionRight = 0; },
    speak,
    seenCount() { return seenWords().length; },
    masteredCount() { return WORDS.filter(mastered).length; },
    total: WORDS.length,

    // 背新单词：先看卡片，再每个都答对一次才能继续
    async learnNew(n, title) {
      let fresh = WORDS.filter(w => !(stats[w[0]] && stats[w[0]].seen)).slice(0, n);
      if (fresh.length < n) {
        // 全部学过了：挑最需要练习的
        const extra = shuffle(WORDS.filter(w => !mastered(w) && !fresh.includes(w)));
        fresh = fresh.concat(extra.slice(0, n - fresh.length));
        if (fresh.length < n) fresh = fresh.concat(shuffle(WORDS.filter(w => !fresh.includes(w))).slice(0, n - fresh.length));
      }
      show(title || '📚 背单词时间', '记住这些单词，答对才能出发！');
      for (let i = 0; i < fresh.length; i++) {
        setProgress(0, fresh.length);
        elSub.textContent = `第 ${i + 1} / ${fresh.length} 个新单词，大声读出来！`;
        await flashcard(fresh[i]);
      }
      const queue = shuffle(fresh.slice());
      let done = 0;
      while (queue.length) {
        setProgress(done, fresh.length);
        elSub.textContent = `小测验：答对 ${fresh.length} 题就能出发！`;
        const w = queue.shift();
        const ok = await question(w);
        if (ok) done++;
        else queue.push(w); // 答错的单词稍后再考
      }
      setProgress(done, fresh.length);
      hide();
    },

    // 复习：答对 need 题。cancelText 存在时可以放弃（返回 false）
    review(need, title, sub, cancelText) {
      return new Promise(async resolve => {
        let finished = false;
        show(title, sub, cancelText);
        if (cancelText) cancelHandler = () => { finished = true; hide(); resolve(false); };
        let right = 0;
        const recent = [];
        while (right < need && !finished) {
          setProgress(right, need);
          const w = pickReview(recent);
          recent.push(w[0]); if (recent.length > 4) recent.shift();
          if (!(stats[w[0]] && stats[w[0]].seen)) {
            await flashcard(w, '先记住这个');
            if (finished) return;
          }
          const ok = await question(w);
          if (finished) return;
          if (ok) right++;
          else {
            // 答错了：重新背一下
            await flashcard(w, '再背一次');
            if (finished) return;
          }
        }
        if (finished) return;
        setProgress(right, need);
        hide();
        resolve(true);
      });
    },

    // 单词本
    bookHTML() {
      return WORDS.map(w => {
        const s = stats[w[0]];
        const cls = !s || !s.seen ? 'locked' : (mastered(w) ? 'master' : 'seen');
        return `<div class="word ${cls}" data-en="${w[0]}">
          <div class="we">${cls === 'locked' ? '❓' : w[2]}</div>
          <div class="wn">${cls === 'locked' ? '???' : w[0]}</div>
          <div class="wz">${cls === 'locked' ? '' : w[1]}</div>
          ${cls === 'master' ? '<div class="wm">⭐</div>' : ''}
        </div>`;
      }).join('');
    },
  };
})();
