/* 냈지 NADGE 랜딩 페이지 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 주소 뒤에 ?debug 를 붙이면 개발자 도구에서 물리 세계를 만질 수 있어요.
  const DEBUG = new URLSearchParams(window.location.search).has('debug');
  const worlds = []; // 첫 화면과 마무리의 물리 세계 (폰 기울이기에 같이 반응해요)

  // 화면 아래에 잠깐 뜨는 안내 메시지
  let toastTimer;
  function showToast(msg) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2600);
  }
  const isNarrow = () => window.innerWidth < 768;
  const rand = (a, b) => a + Math.random() * (b - a);
  const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // 글꼴이 늦게 와도 1.5초 뒤에는 그냥 진행해요.
  const fontsReady = () => Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 1500)),
  ]);

  /* =========================================================
     물리 세계: DOM 요소를 Matter.js 몸체와 묶어서 움직여요.
     ========================================================= */
  function createWorld(container, { obstacles = () => [] } = {}) {
    const M = window.Matter;
    if (!M) return null;
    const { Engine, Bodies, Body, Composite, Constraint, Events } = M;

    const engine = Engine.create();
    engine.gravity.y = 1;
    const world = engine.world;
    const items = new Map();
    const STEP = 1000 / 60;
    const MAX_SPEED = 36;
    const solid = { isStatic: true, friction: 0.5, restitution: 0.2 };

    let statics = [];
    let W = 0;
    let H = 0;
    let running = false;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let drag = null;

    // 바닥, 양옆 벽, 글자 같은 "단단한" 요소를 다시 만들어요.
    function rebuild() {
      const cr = container.getBoundingClientRect();
      W = cr.width;
      H = cr.height;
      if (statics.length) Composite.remove(world, statics);
      const t = 400;
      statics = [
        Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, solid),
        Bodies.rectangle(-t / 2, -H + t / 2, t, H * 4 + t, solid),
        Bodies.rectangle(W + t / 2, -H + t / 2, t, H * 4 + t, solid),
      ];
      obstacles().forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const cx = r.left - cr.left + r.width / 2;
        const cy = r.top - cr.top + r.height / 2;
        statics.push('round' in el.dataset
          ? Bodies.circle(cx, cy, r.width / 2, solid)
          : Bodies.rectangle(cx, cy, r.width, r.height, { ...solid, chamfer: { radius: Math.max(1, Math.min(18, r.height / 2 - 1)) } }));
      });
      Composite.add(world, statics);

      // 화면 크기가 바뀌어 밖으로 나간 카드는 안으로 데려와요.
      items.forEach(({ body, w, h }) => {
        const x = Math.min(Math.max(body.position.x, w / 2), Math.max(w / 2, W - w / 2));
        const y = Math.min(body.position.y, H - h / 2);
        if (x !== body.position.x || y !== body.position.y) Body.setPosition(body, { x, y });
      });
    }

    function draw(it) {
      const { x, y } = it.body.position;
      it.el.style.transform = `translate3d(${x - it.w / 2}px, ${y - it.h / 2}px, 0) rotate(${it.body.angle}rad)`;
    }

    function add(el, o = {}) {
      container.appendChild(el);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const x = typeof o.x === 'function' ? o.x(w, h) : (o.x ?? W / 2);
      const y = o.y ?? -h;
      const body = o.round
        ? Bodies.circle(x, y, w / 2, { restitution: 0.4, friction: 0.25, frictionAir: 0.01, density: 0.0016 })
        : Bodies.rectangle(x, y, w, h, {
          chamfer: { radius: Math.min(12, h / 2 - 1) },
          restitution: 0.2,
          friction: 0.5,
          frictionAir: 0.012,
          density: 0.002,
        });
      Body.setAngle(body, o.angle || 0);
      Body.setVelocity(body, { x: o.vx || 0, y: o.vy || 0 });
      Body.setAngularVelocity(body, o.va || 0);
      Composite.add(world, body);
      const it = { el, body, w, h };
      items.set(el, it);
      el.setAttribute('data-body', '');
      draw(it);
      return it;
    }

    function endDrag() {
      if (!drag) return;
      Composite.remove(world, drag.c);
      drag.el.classList.remove('is-grab');
      drag = null;
    }

    function remove(el) {
      const it = items.get(el);
      if (!it) return;
      if (drag && drag.el === el) endDrag();
      Composite.remove(world, it.body);
      items.delete(el);
      el.remove();
    }

    // 너무 세게 던지면 벽을 뚫고 나가서 속도를 제한해요.
    Events.on(engine, 'beforeUpdate', () => {
      items.forEach(({ body }) => {
        const { x, y } = body.velocity;
        const s = Math.hypot(x, y);
        if (s > MAX_SPEED) Body.setVelocity(body, { x: (x / s) * MAX_SPEED, y: (y / s) * MAX_SPEED });
      });
    });

    function frame(t) {
      raf = requestAnimationFrame(frame);
      acc += last ? Math.min(t - last, 100) : STEP;
      last = t;
      let n = 0;
      while (acc >= STEP && n < 4) {
        Engine.update(engine, STEP);
        acc -= STEP;
        n++;
      }
      if (n === 4) acc = 0;
      items.forEach(draw);
    }

    function start() {
      if (running) return;
      running = true;
      last = 0;
      acc = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    // 잡아서 던지기
    const local = (e) => {
      const r = container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    container.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-body]');
      const it = el && items.get(el);
      if (!it || drag) return;
      e.preventDefault();
      const p = local(e);
      const c = Constraint.create({
        pointA: p,
        bodyB: it.body,
        pointB: { x: p.x - it.body.position.x, y: p.y - it.body.position.y },
        stiffness: 0.2,
        damping: 0.1,
        length: 0,
      });
      Composite.add(world, c);
      drag = { c, el, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
      el.classList.add('is-grab');
      start();
    });
    container.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.id) drag.c.pointA = local(e);
    });
    const up = (e) => { if (drag && e.pointerId === drag.id) endDrag(); };
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);
    container.addEventListener('lostpointercapture', up);

    return {
      add,
      remove,
      clear: () => Array.from(items.keys()).forEach(remove),
      start,
      stop,
      rebuild,
      setGravity(x, y) {
        engine.gravity.x = x;
        engine.gravity.y = y;
      },
      // 한 번 흔들어서 쌓인 카드를 띄워요.
      shake() {
        items.forEach(({ body }) => {
          Body.setVelocity(body, { x: (Math.random() - 0.5) * 10, y: -4 - Math.random() * 8 });
          Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);
        });
      },
      settle(steps) {
        for (let i = 0; i < steps; i++) Engine.update(engine, STEP);
        items.forEach(draw);
      },
      items,
      get width() { return W; },
      get height() { return H; },
    };
  }

  /* =========================================================
     1. 첫 화면: 마감 카드가 쏟아져요
     ========================================================= */
  // core: 전환 구간에서 다시 나와 정리되는 카드예요. 첫 화면에 항상 나와요.
  const HERO_CARDS = [
    { name: '슬로건 공모전', tag: 'D-1', color: 'yellow', hot: true, core: true },
    { name: '숏폼 영상 공모전', tag: '오늘 마감', color: 'orange', hot: true, core: true },
    { name: '겨울 사진 공모전', tag: 'D-4', color: 'green', core: true },
    { name: '로고 디자인 공모전', tag: 'D-6', color: 'pink', core: true },
    { name: '창업 경진대회', tag: '서류 D-2', color: 'blue', hot: true, core: true },
    { name: 'UX 기획 공모전', tag: '발표?', color: 'purple', core: true },
    { name: '에세이 공모전', tag: 'D-3', color: 'yellow' },
    { name: '웹툰 공모전', tag: 'D-9', color: 'blue' },
    { name: '굿즈 디자인 공모전', tag: 'D-5', color: 'orange' },
    { name: '레시피 공모전', tag: 'D-12', color: 'green' },
    { name: '표어 공모전', tag: 'D-2', color: 'pink' },
    { name: '앱 기획 공모전', tag: 'D-7', color: 'purple' },
    { name: '최종_진짜최종.pdf', tag: 'PDF', color: 'white', kind: 'file' },
    { name: '발표일이 언제였지?', tag: '?', color: 'yellow', kind: 'note' },
    { name: '일러스트 공모전', tag: 'D-8', color: 'blue' },
    { name: '독후감 공모전', tag: 'D-10', color: 'orange' },
    { name: '브이로그 공모전', tag: 'D-3', color: 'pink' },
    { name: '캘리그라피 공모전', tag: 'D-11', color: 'green' },
    { name: '제출용(2).hwp', tag: 'HWP', color: 'white', kind: 'file' },
    { name: '포스터 공모전', tag: '오늘 마감', color: 'purple', hot: true },
    { name: '포트폴리오 공모전', tag: 'D-5', color: 'yellow' },
    { name: '3개가 같은 날 마감', tag: '!!', color: 'orange', kind: 'note', hot: true },
  ];

  function makeCard(d) {
    const el = document.createElement('div');
    el.className = `dcard${d.kind ? ` is-${d.kind}` : ''}${d.hot ? ' is-hot' : ''}`;
    el.style.setProperty('--c', `var(--${d.color})`);
    const tag = document.createElement('b');
    tag.className = 'dcard-tag';
    tag.textContent = d.tag;
    const name = document.createElement('span');
    name.className = 'dcard-name';
    name.textContent = d.name;
    el.append(tag, name);
    return el;
  }

  function initHero() {
    const hero = $('#top');
    // 휴대폰에서는 글자가 화면을 거의 다 차지해서, 카드가 글자 뒤로 떨어져 바닥에 쌓이게 해요.
    const world = createWorld($('#heroWorld'), { obstacles: () => (isNarrow() ? [] : $$('[data-solid]', hero)) });
    if (!world) return;
    let timers = [];

    function drop() {
      timers.forEach(clearTimeout);
      timers = [];
      world.clear();
      world.rebuild();
      // 화면이 넓을수록 카드가 많이 떨어져요 (10~18장).
      const n = Math.max(10, Math.min(18, Math.round((world.width * world.height) / 40000)));
      const core = HERO_CARDS.filter((d) => d.core);
      const rest = shuffle(HERO_CARDS.filter((d) => !d.core)).slice(0, n - core.length);
      shuffle([...core, ...rest]).forEach((d, i) => {
        const spawn = () => world.add(makeCard(d), {
          x: (w) => rand(w / 2, Math.max(w / 2, world.width - w / 2)),
          y: reduceMotion ? -80 - i * 70 : rand(-160, -60),
          angle: rand(-0.5, 0.5),
          vx: rand(-2, 2),
          va: rand(-0.05, 0.05),
        });
        if (reduceMotion) spawn();
        else timers.push(setTimeout(spawn, 200 + i * 120));
      });
      if (reduceMotion) world.settle(900);
    }

    new IntersectionObserver(([en]) => (en.isIntersecting ? world.start() : world.stop())).observe(hero);
    worlds.push(world);
    if (DEBUG) window.__nadge.hero = world;
    fontsReady().then(drop);
    $('#reDrop').addEventListener('click', drop);
    window.addEventListener('resize', debounce(() => world.rebuild(), 150));
  }

  /* =========================================================
     2~3. 스크롤 애니메이션 (GSAP)
     ========================================================= */
  function initScroll() {
    if (!window.gsap || !window.ScrollTrigger) {
      document.documentElement.classList.add('no-gsap');
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    // 공감 문장: 스크롤에 맞춰 진해지고 밑줄이 그어져요.
    if (!reduceMotion) {
      $$('.pain-item').forEach((item) => {
        gsap.fromTo(item, { opacity: 0.12 }, {
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: item, start: 'top 85%', end: 'top 55%', scrub: true },
        });
        const em = $('em', item);
        if (em) {
          gsap.fromTo(em, { backgroundSize: '0% 100%' }, {
            backgroundSize: '100% 100%',
            ease: 'none',
            scrollTrigger: { trigger: item, start: 'top 65%', end: 'top 45%', scrub: true },
          });
        }
      });
    }

    initSort();
    fontsReady().then(() => ScrollTrigger.refresh());
  }

  // 흩어진 카드가 휴대폰 속 목록으로 정리돼요.
  function initSort() {
    const layer = $('#sortCards');
    const cards = $$('.scard', layer);
    const slots = $$('#phone .slot');
    const nudge = $('#nudge');
    const nudgeSlot = $('#nudgeSlot');
    // [가로 위치 비율, 세로 위치 비율, 기울기]
    const WIDE = [[0.02, 0.12, -14], [0.30, 0.04, 9], [0.06, 0.74, 11], [0.36, 0.82, -9], [0.58, 0.20, 16], [0.70, 0.74, -12]];
    const NARROW = [[0.02, 0.34, -12], [0.55, 0.40, 10], [0.10, 0.55, 13], [0.50, 0.62, -9], [0.00, 0.78, 7], [0.42, 0.86, -14]];
    const geo = [];

    function layout() {
      const lr = layer.getBoundingClientRect();
      const sc = isNarrow() ? NARROW : WIDE;
      cards.forEach((c, i) => {
        const r = slots[i].getBoundingClientRect();
        c.style.width = `${r.width}px`;
        c.style.height = `${r.height}px`;
        geo[i] = {
          ex: r.left - lr.left,
          ey: r.top - lr.top,
          sx: sc[i][0] * Math.max(0, lr.width - r.width),
          // 상단 바(약 70px)에 가리지 않게 너무 위로는 안 보내요.
          sy: Math.max(80, Math.min(sc[i][1] * lr.height, lr.height - r.height - 8)),
          rot: sc[i][2],
        };
      });
      const nr = nudgeSlot.getBoundingClientRect();
      nudge.style.width = `${nr.width}px`;
      geo.nx = nr.left - lr.left;
      geo.ny = nr.top - lr.top;
    }
    layout();
    ScrollTrigger.addEventListener('refreshInit', layout);

    const bars = $$('.scard-bar', layer);
    const ddays = $$('.scard-dday', layer);
    const barColor = (i, el) => el.closest('.scard').style.getPropertyValue('--bar');

    if (reduceMotion) {
      const settle = () => {
        layout();
        cards.forEach((c, i) => gsap.set(c, { x: geo[i].ex, y: geo[i].ey, rotation: 0, backgroundColor: '#fff' }));
        gsap.set(bars, { opacity: 1 });
        gsap.set(ddays, { backgroundColor: barColor });
        gsap.set(nudge, { x: geo.nx, y: geo.ny, opacity: 1 });
        gsap.set('#sortHint', { opacity: 0 });
      };
      settle();
      fontsReady().then(settle);
      window.addEventListener('resize', debounce(settle, 150));
      return;
    }

    // 첫 화면에서 던지던 카드들이 위에서 다시 떨어져 들어와요.
    gsap.fromTo(cards,
      { yPercent: (i, el) => (-100 * (layer.offsetHeight + el.offsetHeight)) / Math.max(1, el.offsetHeight) },
      {
        yPercent: 0,
        ease: 'bounce.out',
        stagger: 0.08,
        scrollTrigger: { trigger: '#sort', start: 'top 80%', end: 'top 8%', scrub: 0.6, invalidateOnRefresh: true },
      });

    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: {
        trigger: '#sort',
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * (isNarrow() ? 1.6 : 2.1))}`,
        pin: true,
        scrub: 0.8,
        invalidateOnRefresh: true,
        anticipatePin: 1,
      },
    });
    cards.forEach((c, i) => {
      tl.fromTo(c,
        { x: () => geo[i].sx, y: () => geo[i].sy, rotation: () => geo[i].rot, scale: 1.05, backgroundColor: c.dataset.c },
        { x: () => geo[i].ex, y: () => geo[i].ey, rotation: 0, scale: 1, duration: 1 },
        i * 0.07);
    });
    tl.to('#sortHint', { opacity: 0, duration: 0.2, ease: 'none' }, 0.05)
      .to(cards, { backgroundColor: '#ffffff', duration: 0.3, stagger: 0.04, ease: 'none' }, 0.8)
      .to(bars, { opacity: 1, duration: 0.25, stagger: 0.02, ease: 'none' }, 1.0)
      .to(ddays, { backgroundColor: barColor, duration: 0.25, stagger: 0.02, ease: 'none' }, 1.0)
      .fromTo(nudge,
        { x: () => geo.nx, y: () => geo.ny - 24, opacity: 0 },
        { x: () => geo.nx, y: () => geo.ny, opacity: 1, duration: 0.35, ease: 'back.out(1.8)' },
        1.45)
      .to({}, { duration: 0.4 });
  }

  // 어두운 구간 위에서는 상단 바도 어둡게 바꿔요.
  function initNav() {
    const nav = $('#nav');
    const sort = $('#sort');
    const update = () => {
      const r = sort.getBoundingClientRect();
      const y = nav.offsetHeight / 2;
      nav.classList.toggle('nav--dark', r.top <= y && r.bottom >= y);
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    $$('a[data-scroll]').forEach((a) => a.addEventListener('click', (e) => {
      const target = $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }));
  }

  function initReveal() {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    }), { threshold: 0.15 });
    $$('.reveal, .feature').forEach((el) => io.observe(el));
  }

  /* =========================================================
     4. 기능: 발표일 달력 (2026년 12월은 화요일에 시작해요)
     ========================================================= */
  function initCalendar() {
    const grid = $('#calGrid');
    if (!grid) return;
    const frag = document.createDocumentFragment();
    '일월화수목금토'.split('').forEach((d) => {
      const s = document.createElement('span');
      s.className = 'dow';
      s.textContent = d;
      frag.append(s);
    });
    for (let i = 0; i < 2; i++) frag.append(document.createElement('span'));
    for (let d = 1; d <= 31; d++) {
      const s = document.createElement('span');
      if (d === 18) {
        s.className = 'target';
        s.innerHTML = '18<svg class="cal-ring" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14"/></svg><em class="cal-tag">결과 발표</em>';
      } else {
        s.textContent = d;
      }
      frag.append(s);
    }
    grid.append(frag);
  }

  /* =========================================================
     5. 미리 써보기
     ========================================================= */
  function initTry() {
    const form = $('#tryForm');
    const nameInput = $('#tryName');
    const dateInput = $('#tryDate');
    const list = $('#tryList');
    const DAY = 86400000;
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fmt = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
    const today = startOfDay(new Date());

    dateInput.min = iso(today);
    dateInput.value = iso(addDays(today, 3));

    let seq = 0;
    const items = [
      { id: ++seq, name: '겨울 사진 공모전', date: addDays(today, 4), done: false },
      { id: ++seq, name: '슬로건 공모전', date: addDays(today, 1), done: false },
    ];

    function row(it) {
      const d = Math.round((it.date - today) / DAY);
      const li = document.createElement('li');
      li.className = `titem${it.done ? ' done' : d <= 1 ? ' hot' : d <= 3 ? ' warm' : ''}`;
      li.dataset.id = it.id;

      const badge = document.createElement('span');
      badge.className = 'titem-dday';
      badge.textContent = it.done ? '냈음' : d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : '지남';

      const text = document.createElement('span');
      text.className = 'titem-text';
      const name = document.createElement('b');
      name.className = 'titem-name';
      name.textContent = it.name;
      const date = document.createElement('span');
      date.className = 'titem-date';
      date.textContent = `${fmt(it.date)} 마감`;
      text.append(name, date);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'titem-btn';
      btn.textContent = it.done ? '냈지!' : '냈어요';
      btn.setAttribute('aria-label', it.done ? `${it.name} 제출 취소` : `${it.name} 제출 완료로 표시`);
      btn.addEventListener('click', () => {
        it.done = !it.done;
        render(it.done ? it.id : null, true);
      });

      li.append(badge, text, btn);
      return li;
    }

    function render(focusId = null, stamped = false) {
      const sorted = [...items].sort((a, b) => (a.done - b.done) || (a.date - b.date));
      list.replaceChildren(...sorted.map(row));
      if (!focusId || !window.gsap || reduceMotion) return;
      const li = list.querySelector(`[data-id="${focusId}"]`);
      if (!li) return;
      if (stamped) {
        gsap.fromTo($('.titem-btn', li),
          { scale: 2.2, rotation: -40, opacity: 0 },
          { scale: 1, rotation: -12, opacity: 1, duration: 0.45, ease: 'back.out(2.2)' });
      } else {
        gsap.from(li, { y: -14, opacity: 0, scale: 0.97, duration: 0.5, ease: 'back.out(1.6)' });
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name || !dateInput.value) return;
      const [y, m, d] = dateInput.value.split('-').map(Number);
      const it = { id: ++seq, name, date: new Date(y, m - 1, d), done: false };
      items.push(it);
      if (items.length > 8) items.shift();
      render(it.id);
      nameInput.value = '';
    });

    render();
  }

  /* =========================================================
     6. 마무리: 냈지 도장이 떨어져요
     ========================================================= */
  function initFinale() {
    const section = $('#finale');
    const btn = $('#stampBtn');
    const world = createWorld($('#finaleWorld'), { obstacles: () => $$('[data-solid]', section) });
    if (!world) return;
    const MAX = isNarrow() ? 26 : 44;
    const queue = [];
    let started = false;

    function stamp(n = 1) {
      for (let i = 0; i < n; i++) {
        const el = document.createElement('div');
        el.className = 'stamp';
        el.innerHTML = '<span>냈지</span><i>✓</i>';
        world.add(el, {
          round: true,
          x: (w) => rand(w / 2, Math.max(w / 2, world.width - w / 2)),
          y: rand(-140, -50) - i * 60,
          vx: rand(-3, 3),
          va: rand(-0.15, 0.15),
        });
        queue.push(el);
        if (queue.length > MAX) world.remove(queue.shift());
      }
    }

    new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) { world.stop(); return; }
      world.start();
      if (!started && en.intersectionRatio >= 0.35) {
        started = true;
        world.rebuild();
        stamp(isNarrow() ? 5 : 8);
      }
    }, { threshold: [0, 0.35] }).observe(section);

    btn.addEventListener('click', () => {
      if (!started) { started = true; world.rebuild(); }
      stamp(3);
      world.start();
      if (window.gsap && !reduceMotion) {
        gsap.fromTo(btn, { scale: 0.86 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.4)' });
      }
    });
    worlds.push(world);
    if (DEBUG) window.__nadge.finale = world;
    fontsReady().then(() => world.rebuild());
    window.addEventListener('resize', debounce(() => world.rebuild(), 150));
  }

  /* =========================================================
     폰 기울이기: 기울인 방향으로 중력이 바뀌어요 (휴대폰에서만).
     ========================================================= */
  function initTilt() {
    const btn = $('#tiltBtn');
    const canTilt = 'DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches;
    if (!btn || !canTilt || reduceMotion || !worlds.length) return;
    btn.hidden = false;
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    let on = false;
    let gx = 0;
    let gy = 1;

    function onOrient(e) {
      if (e.beta == null || e.gamma == null) return;
      const angle = (window.screen.orientation && window.screen.orientation.angle) || 0;
      // 조금만 기울여도 확실히 쏠리게 옆 방향(x)은 30도, 아래 방향(y)은 45도 기준이에요.
      let side = e.gamma;
      let down = e.beta;
      if (angle === 90) [side, down] = [e.beta, -e.gamma];
      else if (angle === 270) [side, down] = [-e.beta, e.gamma];
      else if (angle === 180) down = -down;
      gx += (clamp(side / 30, 1.5) - gx) * 0.3;
      gy += (clamp(down / 45, 1) - gy) * 0.3;
      worlds.forEach((w) => w.setGravity(gx, gy));
    }

    function setOn(next) {
      on = next;
      btn.textContent = on ? '기울이기 끄기' : '폰 기울이기';
      btn.setAttribute('aria-pressed', String(on));
      if (on) {
        window.addEventListener('deviceorientation', onOrient);
      } else {
        window.removeEventListener('deviceorientation', onOrient);
        gx = 0;
        gy = 1;
        worlds.forEach((w) => w.setGravity(0, 1));
      }
    }

    btn.addEventListener('click', async () => {
      if (on) { setOn(false); return; }
      // 아이폰은 기울기 센서를 쓰기 전에 허락을 받아야 해요.
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        let state = 'denied';
        try { state = await DeviceOrientationEvent.requestPermission(); } catch (_) { /* 거절과 같아요 */ }
        if (state !== 'granted') {
          showToast('기울기 센서를 쓸 수 없어요. 설정에서 동작 권한을 허용해 주세요.');
          return;
        }
      }
      setOn(true);
      worlds.forEach((w) => w.shake());
      showToast('폰을 기울여보세요. 카드가 쏠려요!');
    });
  }

  /* =========================================================
     공유: 친구한테 "냈지?" 물어보기
     ========================================================= */
  function initShare() {
    const btn = $('#shareBtn');
    if (!btn) return;
    const url = window.location.origin + window.location.pathname;
    const data = { title: '냈지 NADGE', text: '공모전 마감, 냈지? 마감 챙겨주는 앱이 곧 나온대요.', url };

    function legacyCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }

    btn.addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share(data); } catch (_) { /* 공유 창을 닫았어요 */ }
        return;
      }
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (_) {
        copied = legacyCopy(url);
      }
      showToast(copied ? '링크를 복사했어요. 친구한테 보내보세요!' : url);
    });
  }

  /* ========================================================= */
  if (DEBUG) window.__nadge = {};
  initNav();
  initReveal();
  initCalendar();
  initHero();
  initScroll();
  initTry();
  initFinale();
  initTilt();
  initShare();
})();
