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
  function createWorld(container, { obstacles = () => [], onTap = null } = {}) {
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
        // 모서리 둥글기는 짧은 변의 절반을 넘으면 안 돼요 (얇은 칸막이 같은 경우).
        const rad = Math.min(18, r.height / 2 - 1, r.width / 2 - 1);
        // data-slick: 미끄러운 벽 (기록 그래프 칸막이에 도장이 걸려 떠 있지 않게)
        const opts = 'slick' in el.dataset ? { ...solid, friction: 0, frictionStatic: 0 } : solid;
        statics.push('round' in el.dataset
          ? Bodies.circle(cx, cy, r.width / 2, opts)
          : Bodies.rectangle(cx, cy, r.width, r.height, rad > 1 ? { ...opts, chamfer: { radius: rad } } : opts));
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
      it.el.style.transform = `translate3d(${x - it.w / 2}px, ${y - it.h / 2}px, 0)${it.upright ? '' : ` rotate(${it.body.angle}rad)`}`;
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
      // upright: 물리는 그대로 굴러가고, 화면에는 글자가 똑바로 서 있게 그려요 (원은 돌아도 모양이 같아서요).
      const it = { el, body, w, h, upright: !!o.upright };
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
      // 짧게 톡 누른 건지(탭), 끌어서 던진 건지 나중에 구분하려고 시작 위치와 시각을 기억해요.
      drag = { c, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
      el.classList.add('is-grab');
      start();
    });
    container.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.c.pointA = local(e);
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.moved = true;
    });
    container.addEventListener('pointerup', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const tapped = !drag.moved && performance.now() - drag.t0 < 350;
      const { el } = drag;
      endDrag();
      if (tapped && onTap) onTap(el, items.get(el));
    });
    const cancel = (e) => { if (drag && e.pointerId === drag.id) endDrag(); };
    container.addEventListener('pointercancel', cancel);
    container.addEventListener('lostpointercapture', cancel);

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
      // 충격파: (x, y)에서 radius 안의 물체를 바깥쪽과 위쪽으로 밀어내요. 가까울수록 세게요.
      impulse(x, y, radius, power, skipEl = null) {
        items.forEach((it) => {
          if (it.el === skipEl) return;
          const dx = it.body.position.x - x;
          const dy = it.body.position.y - y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > radius) return;
          const f = power * (1 - d / radius);
          Body.setVelocity(it.body, {
            x: it.body.velocity.x + (dx / d) * f,
            y: it.body.velocity.y + (dy / d) * f - f * 0.55,
          });
          Body.setAngularVelocity(it.body, it.body.angularVelocity + (Math.random() - 0.5) * 0.3 * (f / power));
        });
      },
      push(el, vx, vy) {
        const it = items.get(el);
        if (it) Body.setVelocity(it.body, { x: vx, y: vy });
      },
      itemOf: (el) => items.get(el),
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
    const worldEl = $('#heroWorld');
    const l1 = $('#heroL1');
    const word = $('.l2-word', hero);
    const mark = $('#heroMark');
    const hint = $('#heroHint');
    const HINT = hint.textContent;
    const L1 = l1.textContent;
    const anim = !!window.gsap && !reduceMotion;
    let total = 0;
    let doneCount = 0;
    let finished = false;
    let qBody = null;

    // 휴대폰에서는 글자가 화면을 거의 다 차지해서, 카드가 글자 뒤로 떨어져 바닥에 쌓이게 해요.
    const world = createWorld(worldEl, {
      obstacles: () => (isNarrow() ? [] : $$('[data-solid]', hero)),
      onTap: (el) => { if (el.classList.contains('dcard')) stampCard(el); },
    });
    if (!world) return;
    let timers = [];

    // 휴대폰처럼 좁은 화면에서는 충격파를 약하게 해서 카드가 글자를 덮지 않게 해요.
    const kick = () => (isNarrow() ? 0.6 : 1);
    const center = (el) => {
      const cr = worldEl.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
    };

    // 찍힌 자리에서 화면이 살짝 흔들리고 초록 잉크가 튀어요.
    function impactFx(x, y) {
      if (!anim) return;
      gsap.fromTo(hero, { x: 0, y: 0 }, {
        keyframes: [{ x: -6, y: 3 }, { x: 5, y: -2 }, { x: -3, y: 1 }, { x: 0, y: 0 }],
        duration: 0.28,
        ease: 'none',
        clearProps: 'transform',
      });
      for (let i = 0; i < 9; i++) {
        const dot = document.createElement('i');
        dot.className = 'ink';
        worldEl.appendChild(dot);
        const a = rand(0, Math.PI * 2);
        const dist = rand(40, 110);
        gsap.fromTo(dot, { x, y, scale: rand(0.6, 1.4), opacity: 1 }, {
          x: x + Math.cos(a) * dist,
          y: y + Math.sin(a) * dist,
          scale: 0,
          opacity: 0,
          duration: rand(0.45, 0.7),
          ease: 'power2.out',
          onComplete: () => dot.remove(),
        });
      }
    }

    function updateHint() {
      hint.replaceChildren();
      if (finished) {
        hint.textContent = '모두 냈어요! 이제 냈지가 챙길게요 ↓';
        return;
      }
      const span = document.createElement('span');
      span.className = 'hero-progress';
      const b = document.createElement('b');
      b.textContent = String(doneCount);
      span.append('냈다 ', b, ` / ${total}`);
      hint.append(span);
    }

    // 카드를 톡 누르면: 위에서 도장이 내려찍히고 → 충격파 → 초록 "냈지!" 카드로 바뀌어요.
    function stampCard(el) {
      if (el.classList.contains('is-done') || el.dataset.stamping) return;
      el.dataset.stamping = '1';
      const it = world.itemOf(el);

      const finish = () => {
        delete el.dataset.stamping;
        if (!el.isConnected) return;
        el.classList.add('is-done');
        const s = document.createElement('i');
        s.className = 'dcard-stamp';
        s.textContent = '냈지!';
        el.appendChild(s);
        const p = it.body.position;
        if (anim) {
          world.push(el, it.body.velocity.x * 0.2, 6);
          world.impulse(p.x, p.y, 300 * kick(), 15 * kick(), el);
          impactFx(p.x, p.y);
        }
        doneCount++;
        if (doneCount >= total) completeAll();
        else updateHint();
      };

      if (!anim) { finish(); return; }
      const slam = document.createElement('div');
      slam.className = 'slam';
      slam.textContent = '냈지!';
      worldEl.appendChild(slam);
      const follow = () => gsap.set(slam, { x: it.body.position.x, y: it.body.position.y });
      gsap.timeline({ onComplete: () => slam.remove() })
        .fromTo(slam, { scale: 2.6, rotation: -30, opacity: 0 }, {
          scale: 1, rotation: -12, opacity: 1, duration: 0.24, ease: 'power4.in', onStart: follow, onUpdate: follow, onComplete: finish,
        })
        .to(slam, { opacity: 0, scale: 1.08, duration: 0.3, delay: 0.18, onUpdate: follow });
    }

    // 다 찍으면: 제목의 "?"가 물체가 되어 떨어지고, 그 자리에 "!"가 쾅 찍혀요.
    function completeAll() {
      finished = true;
      updateHint();
      if (!anim) {
        mark.textContent = '!';
        mark.classList.add('is-done');
        l1.textContent = '마감이 쏟아져도,';
        word.style.color = 'var(--done)';
        world.rebuild();
        return;
      }
      // "다시 쏟기"를 누르면 취소되도록 timers에 넣어둬요.
      timers.push(setTimeout(() => {
        const c = center(mark);
        const cs = getComputedStyle(mark);
        qBody = document.createElement('div');
        qBody.className = 'q-body';
        qBody.textContent = '?';
        qBody.style.fontSize = cs.fontSize;
        mark.style.visibility = 'hidden';
        mark.removeAttribute('data-solid');
        world.rebuild();
        world.add(qBody, { x: c.x, y: c.y, vx: rand(3, 6), vy: -12, va: 0.16 });
        world.impulse(c.x, c.y, 260, 8, qBody);
      }, 450));

      timers.push(setTimeout(() => {
        mark.textContent = '!';
        mark.classList.add('is-done');
        mark.style.visibility = 'visible';
        gsap.to(word, { color: '#2BB673', duration: 0.4 });
        gsap.to(l1, {
          opacity: 0, y: -8, duration: 0.18,
          onComplete: () => {
            l1.textContent = '마감이 쏟아져도,';
            gsap.to(l1, { opacity: 1, y: 0, duration: 0.3, onComplete: () => world.rebuild() });
          },
        });
        gsap.fromTo(mark, { scale: 3.4, rotation: -18, opacity: 0 }, {
          scale: 1, rotation: 0, opacity: 1, duration: 0.3, ease: 'power4.in',
          onComplete: () => {
            mark.setAttribute('data-solid', '');
            world.rebuild();
            const c = center(mark);
            world.impulse(c.x, c.y, 420 * kick(), 20 * kick());
            impactFx(c.x, c.y);
          },
        });
      }, 1500));
    }

    function resetTitle() {
      finished = false;
      doneCount = 0;
      qBody = null;
      if (window.gsap) gsap.killTweensOf([mark, word, l1]);
      mark.textContent = '?';
      mark.classList.remove('is-done');
      mark.removeAttribute('style');
      mark.setAttribute('data-solid', '');
      word.removeAttribute('style');
      l1.removeAttribute('style');
      l1.textContent = L1;
      hint.textContent = HINT;
    }

    function drop() {
      timers.forEach(clearTimeout);
      timers = [];
      world.clear();
      resetTitle();
      world.rebuild();
      // 화면이 넓을수록 카드가 많이 떨어져요 (10~14장).
      const n = Math.max(10, Math.min(14, Math.round((world.width * world.height) / 50000)));
      const core = HERO_CARDS.filter((d) => d.core);
      const rest = shuffle(HERO_CARDS.filter((d) => !d.core)).slice(0, n - core.length);
      total = core.length + rest.length;
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

    // 공감 문장: 마감 카드처럼 위에서 툭 떨어져 바닥에 튕기고, 떨어진 뒤 밑줄이 그어져요.
    if (!reduceMotion) {
      $$('.pain-item').forEach((item, i) => {
        gsap.fromTo(item,
          { y: -150, rotation: i % 2 ? 5 : -6, opacity: 0 },
          {
            y: 0,
            rotation: 0,
            opacity: 1,
            ease: 'bounce.out',
            scrollTrigger: { trigger: item, start: 'top 98%', end: 'top 62%', scrub: 0.5 },
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
    const blank = { done: false, result: null, asking: false, announced: false, outcome: null };
    // 예시 3개: 마감 임박 2개 + 오늘 결과가 나온 1개 (처음부터 "붙었어요"를 눌러볼 수 있어요)
    const sent = addDays(today, -12);
    const items = [
      { id: ++seq, name: '겨울 사진 공모전', date: addDays(today, 4), ...blank },
      { id: ++seq, name: '슬로건 공모전', date: addDays(today, 1), ...blank },
      { id: ++seq, name: 'UX 기획 공모전', date: sent, ...blank, done: true, result: today, announced: true },
    ];

    const days = (d) => Math.round((d - today) / DAY);
    const ddayText = (n) => (n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : '지남');
    // 맨 아래 "한 해 기록" 그래프에 알려줘요: submit(냈어요) / unsubmit(취소) / win(붙었어요)
    // month: 도장이 쌓일 달 (지금 낸 건 이번 달, 예전에 낸 예시는 그 마감 달)
    const emit = (type, it, month) => window.dispatchEvent(new CustomEvent(`nadge:${type}`, {
      detail: { id: it.id, name: it.name, month },
    }));

    // 한 줄 = 공모전 하나. 마감 → 냈어요(도장) → 결과 발표일 → 발표 날 결과 확인 → 수상 기록까지 이어져요.
    function row(it) {
      const d = days(it.date);
      const li = document.createElement('li');
      const state = it.outcome === 'win' ? ' win' : it.outcome === 'lose' ? ' lose' : it.result ? ' has-result' : '';
      li.className = `titem${it.done ? ' done' : d <= 1 ? ' hot' : d <= 3 ? ' warm' : ''}${state}`;
      li.dataset.id = it.id;

      const badge = document.createElement('span');
      badge.className = 'titem-dday';
      if (!it.done) badge.textContent = ddayText(d);
      else if (it.outcome === 'win') badge.textContent = '수상';
      else if (it.outcome === 'lose') badge.textContent = '다음 기회';
      else if (it.announced) badge.textContent = '발표!';
      else if (it.result) badge.textContent = `발표 ${ddayText(days(it.result))}`;
      else badge.textContent = '냈음';

      const text = document.createElement('span');
      text.className = 'titem-text';
      const name = document.createElement('b');
      name.className = 'titem-name';
      name.textContent = it.name;
      const date = document.createElement('span');
      date.className = 'titem-date';
      if (it.outcome === 'win') date.textContent = '냈음 · 붙었어요! 축하해요 🎉';
      else if (it.outcome === 'lose') date.textContent = '냈음 · 이번엔 아쉬워요, 다음 기회에!';
      else if (it.done && it.result) date.textContent = `냈음 · ${days(it.result) === 0 ? '오늘' : fmt(it.result)} 결과 발표`;
      else date.textContent = `${fmt(it.date)} 마감${it.done ? ' · 냈음' : ''}`;
      text.append(name, date);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'titem-btn';
      btn.textContent = it.done ? (it.outcome === 'win' ? '수상!' : '냈지!') : '냈어요';
      btn.setAttribute('aria-label', it.done ? `${it.name} 제출 취소` : `${it.name} 제출 완료로 표시`);
      btn.addEventListener('click', () => {
        it.done = !it.done;
        if (it.done) {
          it.asking = true;
          emit('submit', it, today.getMonth());
          showToast('냈지! 맨 아래 한 해 기록에도 도장이 하나 쌓였어요 ↓');
        } else {
          Object.assign(it, { asking: false, result: null, announced: false, outcome: null });
          emit('unsubmit', it);
        }
        render(it.done ? it.id : null, it.done ? 'stamp' : null);
      });

      li.append(badge, text, btn);
      if (it.asking) li.append(askRow(it));
      else if (it.done && it.result && !it.announced && !it.outcome) li.append(simRow(it));
      else if (it.announced && !it.outcome) li.append(resultRow(it));
      return li;
    }

    // 발표 날까지 기다릴 수 없으니, 그날이 됐다고 치고 미리 보기
    function simRow(it) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'titem-sim';
      b.textContent = '발표 날이 됐다고 쳐볼까요? ▶';
      b.addEventListener('click', () => { it.announced = true; render(it.id, 'announce'); });
      return b;
    }

    // 발표 당일: "결과 나왔어요, 확인했지?" → 버튼 한 번으로 기록
    function resultRow(it) {
      const box = document.createElement('div');
      box.className = 'titem-ask is-result';
      const q = document.createElement('p');
      q.textContent = `🔔 ${it.name} 결과 나왔어요. 확인했지?`;
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      };
      box.append(q,
        mk('붙었어요 🎉', 'ask-win', () => {
          it.outcome = 'win';
          emit('win', it);
          render(it.id, 'win');
          showToast('축하해요! 맨 아래 한 해 기록에 수상 도장이 찍혔어요 ↓');
        }),
        mk('다음 기회에', 'ask-no', () => {
          it.outcome = 'lose';
          render(it.id, 'result');
          showToast('괜찮아요. 낸 것만으로도 기록에 남아요.');
        }),
        mk('아직 안 나왔어요', 'ask-no', () => {
          it.announced = false;
          render();
          showToast('며칠 뒤에 다시 물어볼게요.');
        }));
      return box;
    }

    // 냈어요 다음 단계: "결과 발표일도 등록할까요?"
    function askRow(it) {
      const box = document.createElement('div');
      box.className = 'titem-ask';
      const q = document.createElement('p');
      const em = document.createElement('span');
      em.textContent = '결과 발표일';
      q.append('냈어요! ', em, '도 등록할까요? 그날 아침에 결과 확인을 챙겨드릴게요.');
      const input = document.createElement('input');
      input.type = 'date';
      input.min = iso(it.date);
      input.value = iso(addDays(it.date, 14));
      input.setAttribute('aria-label', `${it.name} 결과 발표일`);
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'ask-yes';
      yes.textContent = '등록';
      yes.addEventListener('click', () => {
        if (!input.value) return;
        const [y, m, d] = input.value.split('-').map(Number);
        it.result = new Date(y, m - 1, d);
        it.asking = false;
        render(it.id, 'result');
        showToast(`${fmt(it.result)} 아침에 "결과 나왔어요, 확인했지?" 하고 알려드릴게요.`);
      });
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'ask-no';
      no.textContent = '나중에';
      no.addEventListener('click', () => { it.asking = false; render(); });
      box.append(q, input, yes, no);
      return box;
    }

    function render(focusId = null, effect = null) {
      const key = (it) => (it.done ? (it.result || it.date) : it.date);
      // 순서: 결과 확인할 것 → 아직 안 낸 것(마감 가까운 순) → 낸 것
      const rank = (it) => (it.announced && !it.outcome ? 0 : it.done ? 2 : 1);
      const sorted = [...items].sort((a, b) => (rank(a) - rank(b)) || (key(a) - key(b)));
      list.replaceChildren(...sorted.map(row));
      const li = focusId && list.querySelector(`[data-id="${focusId}"]`);
      // 냈어요를 누르면 그 줄이 아래로 내려가요. 다음 질문이 화면 밖이면 보이는 곳까지 살짝 내려줘요.
      if (li && effect) {
        setTimeout(() => {
          if (!li.isConnected) return;
          const r = li.getBoundingClientRect();
          if (r.bottom > window.innerHeight - 12 || r.top < 70) {
            li.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
          }
        }, reduceMotion ? 0 : 480);
      }
      if (!li || !window.gsap || reduceMotion) return;
      if (effect === 'stamp') {
        gsap.fromTo($('.titem-btn', li),
          { scale: 2.2, rotation: -40, opacity: 0 },
          { scale: 1, rotation: -12, opacity: 1, duration: 0.45, ease: 'back.out(2.2)' });
        const ask = $('.titem-ask', li);
        if (ask) gsap.from(ask, { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0, duration: 0.4, delay: 0.25, ease: 'power2.out', clearProps: 'all' });
      } else if (effect === 'result') {
        gsap.fromTo($('.titem-dday', li), { scale: 1.6 }, { scale: 1, duration: 0.5, ease: 'back.out(2.5)' });
      } else if (effect === 'announce') {
        gsap.fromTo($('.titem-dday', li), { scale: 1.6 }, { scale: 1, duration: 0.5, ease: 'back.out(2.5)' });
        const box = $('.titem-ask', li);
        if (box) gsap.from(box, { y: -10, opacity: 0, duration: 0.4, ease: 'back.out(1.8)', clearProps: 'all' });
      } else if (effect === 'win') {
        gsap.fromTo($('.titem-dday', li), { scale: 1.8, rotation: -8 }, { scale: 1, rotation: 0, duration: 0.55, ease: 'back.out(2.6)' });
        gsap.fromTo($('.titem-btn', li), { scale: 2.2, rotation: -40, opacity: 0 }, { scale: 1, rotation: -12, opacity: 1, duration: 0.45, ease: 'back.out(2.2)' });
      } else {
        gsap.from(li, { y: -14, opacity: 0, scale: 0.97, duration: 0.5, ease: 'back.out(1.6)' });
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name || !dateInput.value) return;
      const [y, m, d] = dateInput.value.split('-').map(Number);
      const it = { id: ++seq, name, date: new Date(y, m - 1, d), ...blank };
      items.push(it);
      if (items.length > 8) {
        const old = items.shift();
        if (old.done) emit('unsubmit', old);
      }
      render(it.id);
      nameInput.value = '';
    });

    // 예전에 낸 예시는 한 해 기록에 그 마감 달로 들어가요 (해가 바뀌었으면 이번 달로).
    items.filter((it) => it.done).forEach((it) => {
      emit('submit', it, it.date.getFullYear() === today.getFullYear() ? it.date.getMonth() : today.getMonth());
    });
    render();
  }

  /* =========================================================
     6. 마무리: 냈지 도장이 떨어져요
     ========================================================= */
  function initFinale() {
    const record = $('#record');
    const worldEl = $('#finaleWorld');
    const replayBtn = $('#recReplay');
    const totalEl = $('#recTotal');
    const winEl = $('#recWin');
    const monthsEl = $('#recMonths');
    const world = createWorld(worldEl, {
      obstacles: () => $$('.bin-wall', worldEl),
      onTap: (el) => showTip(el),
    });
    if (!world) return;

    const now = new Date();
    $('#recYear').textContent = String(now.getFullYear());
    // 예시 기록: 1~12월에 낸 공모전 (가상의 이름이에요, 실제 사용자 기록이 아니에요)
    const RECORD = [
      ['신년 표어 공모전'],
      ['에세이 공모전', '캘리그라피 공모전'],
      ['앱 기획 공모전'],
      ['레시피 공모전', '일러스트 공모전', '표어 공모전'],
      ['웹툰 공모전', '독후감 공모전'],
      ['브이로그 공모전'],
      ['굿즈 디자인 공모전', '여름 사진 공모전'],
      ['포스터 공모전', '캐릭터 공모전', '광고 영상 공모전'],
      ['포트폴리오 공모전', '단편 소설 공모전'],
      ['웹 디자인 공모전', '브랜드 네이밍 공모전', '아이디어 공모전'],
      ['광고 카피 공모전', '캠페인 기획 공모전'],
      [],
    ];
    const WINS = new Set([3, 7, 9, 10]); // 이 달의 마지막 공모전은 붙었어요
    let mode = null;
    let bins = [];
    let total = 0;
    let wins = 0;
    let started = false;
    let timers = [];

    // 컴퓨터는 달별 12칸, 휴대폰은 분기별 4칸으로 나눠요.
    function buildBins() {
      mode = isNarrow() ? 'q' : 'm';
      const n = mode === 'q' ? 4 : 12;
      bins = Array.from({ length: n }, () => []);
      RECORD.forEach((names, m) => names.forEach((name, k) => {
        bins[binOf(m)].push({ name, month: m, win: WINS.has(m) && k === names.length - 1 });
      }));
      $$('.bin-wall', worldEl).forEach((w) => w.remove());
      for (let i = 1; i < n; i++) {
        const w = document.createElement('i');
        w.className = 'bin-wall';
        w.dataset.slick = '';
        w.style.left = `${(i / n) * 100}%`;
        worldEl.appendChild(w);
      }
      const cur = current();
      monthsEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
      monthsEl.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const s = document.createElement('span');
        s.textContent = mode === 'q' ? `${i * 3 + 1}~${i * 3 + 3}월` : `${i + 1}월`;
        if (i === cur) s.className = 'now';
        return s;
      }));
    }
    const binOf = (month) => (mode === 'q' ? Math.floor(month / 3) : month);
    const current = () => binOf(now.getMonth());
    // 도장 크기: 칸 폭에 맞춰요 (칸막이 두께만큼 여유를 둬요).
    const size = () => Math.max(18, Math.min(mode === 'q' ? 32 : 48, Math.floor(world.width / bins.length - 16)));

    function makeStamp(win, d) {
      const el = document.createElement('div');
      el.className = `stamp${win ? ' is-win' : ''}`;
      el.style.setProperty('--stamp', `${d}px`);
      if (d >= 34) {
        el.textContent = win ? '수상' : '냈지';
        el.style.fontSize = `${Math.round(d * 0.3)}px`;
      } else {
        el.textContent = win ? '★' : '✓';
        el.style.fontSize = `${Math.round(d * 0.5)}px`;
      }
      return el;
    }

    const showCounts = () => {
      totalEl.textContent = String(total);
      winEl.textContent = String(wins);
    };

    // s = { name, month, win }: 도장 하나 = 낸 공모전 하나
    function spawn(s) {
      const d = size();
      const bw = world.width / bins.length;
      const el = makeStamp(s.win, d);
      el.dataset.name = s.name;
      el.dataset.month = String(s.month);
      world.add(el, { round: true, upright: true, x: bw * (binOf(s.month) + 0.5) + rand(-3, 3), y: -d - 30, va: rand(-0.05, 0.05) });
      total++;
      if (s.win) wins++;
      showCounts();
      return el;
    }

    // 도장을 톡 누르면 무슨 공모전이었는지 말풍선으로 보여줘요.
    let tip = null;
    let tipTimer;
    function showTip(el) {
      const it = world.itemOf(el);
      if (!it) return;
      if (!tip) {
        tip = document.createElement('span');
        tip.className = 'stamp-tip';
        worldEl.appendChild(tip);
      }
      const win = el.classList.contains('is-win');
      tip.textContent = `${Number(el.dataset.month) + 1}월 · ${el.dataset.name} · ${win ? '수상 🎉' : '냈어요'}`;
      tip.classList.toggle('is-win', win);
      const { x, y } = it.body.position;
      const half = tip.offsetWidth / 2 + 4;
      tip.style.left = `${Math.min(Math.max(x, half), world.width - half)}px`;
      tip.style.top = `${y - it.h / 2 - 8}px`;
      tip.classList.add('is-on');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => tip.classList.remove('is-on'), 2400);
      world.push(el, rand(-0.6, 0.6), -5);
    }
    const hideTip = () => { clearTimeout(tipTimer); if (tip) tip.classList.remove('is-on'); };

    // 미리 써보기에서 온 기록: 냈어요 → 그 달 칸에 도장, 붙었어요 → 그 도장이 "수상"으로 바뀌어요.
    // 위에서 누르지 않은 건 여기에 생기지 않아요.
    const extra = new Map(); // 미리 써보기 공모전 id → { name, month, win, el }
    window.addEventListener('nadge:submit', (e) => {
      const { id, name, month = now.getMonth() } = e.detail;
      if (extra.has(id)) return;
      const rec = { name, month, win: false, el: null };
      extra.set(id, rec);
      if (started) { rec.el = spawn(rec); world.start(); }
    });
    window.addEventListener('nadge:unsubmit', (e) => {
      const rec = extra.get(e.detail.id);
      if (!rec) return;
      extra.delete(e.detail.id);
      if (!rec.el) return;
      world.remove(rec.el);
      hideTip();
      total--;
      if (rec.win) wins--;
      showCounts();
    });
    window.addEventListener('nadge:win', (e) => {
      const rec = extra.get(e.detail.id);
      if (!rec || rec.win) return;
      rec.win = true;
      if (!rec.el) return;
      const d = parseFloat(rec.el.style.getPropertyValue('--stamp')) || 40;
      rec.el.classList.add('is-win');
      rec.el.textContent = d >= 34 ? '수상' : '★';
      world.push(rec.el, rand(-1, 1), -9);
      wins++;
      showCounts();
    });

    // 1월 칸부터 차례로 도장이 떨어져 쌓여요.
    function dropAll() {
      timers.forEach(clearTimeout);
      timers = [];
      hideTip();
      world.clear();
      world.rebuild();
      total = 0;
      wins = 0;
      totalEl.textContent = '0';
      winEl.textContent = '0';
      // 예시 기록과 미리 써보기에서 낸 것을 달 순서대로 섞어서 1월부터 쌓아요.
      extra.forEach((rec) => { rec.el = null; });
      const queue = [];
      bins.forEach((list) => list.forEach((s) => queue.push({ s })));
      extra.forEach((rec) => queue.push({ s: rec, rec }));
      queue.sort((a, b) => binOf(a.s.month) - binOf(b.s.month));
      queue.forEach(({ s, rec }, k) => {
        const go = () => { const el = spawn(s); if (rec) rec.el = el; };
        if (reduceMotion) go();
        else timers.push(setTimeout(go, 150 + k * 90));
      });
      if (reduceMotion) world.settle(700);
    }

    function begin() {
      if (started) return;
      started = true;
      buildBins();
      dropAll();
      world.start();
    }

    new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) { world.stop(); return; }
      world.start();
      if (en.intersectionRatio >= 0.4) begin();
    }, { threshold: [0, 0.4] }).observe(record);

    // 다시 쌓기: 1월부터 처음부터 다시 떨어뜨려요.
    replayBtn.addEventListener('click', () => {
      if (!started) { begin(); return; }
      dropAll();
      world.start();
    });

    worlds.push(world);
    if (DEBUG) window.__nadge.finale = world;
    fontsReady().then(() => { if (!started) buildBins(); world.rebuild(); });
    window.addEventListener('resize', debounce(() => {
      // 컴퓨터 ↔ 휴대폰 크기가 바뀌면 칸 수가 달라져서 처음부터 다시 쌓아요.
      if (started && (isNarrow() ? 'q' : 'm') !== mode) { buildBins(); dropAll(); } else world.rebuild();
    }, 150));
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
  initFinale(); // 미리 써보기보다 먼저: 미리 써보기의 예시 기록을 받아야 해요
  initTry();
  initTilt();
  initShare();
})();
