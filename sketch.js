// ─── CONFIG ───────────────────────────────────────────────────────────────────
// window.location 기반 절대경로 — 로컬(Live Server)과 Netlify 배포 모두 동작
const modelURL        = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, "/") + "model/";
const CONFIDENCE_THRESHOLD_BAD  = 0.65; // 잘못된 주차
const CONFIDENCE_THRESHOLD_GOOD = 0.88; // 올바른 주차
const HOLD_DURATION      = 3000;
const GOOD_HOLD_DURATION = 5000; // State3 Good_Parking 유지 시간
const CANVAS_W           = 360;
const CANVAS_H           = 800;
const CLASSIFY_INTERVAL  = 500; // ms

// ─── COLORS ───────────────────────────────────────────────────────────────────
const COL = {
  // 배경
  bgDark:      '#1a0a2e',   // 매우 어두운 보라 (카메라 오버레이)
  bgPanel:     '#f8f4ff',   // 패널 흰 배경

  // 아웃라인 & 그림자
  outline:     '#1a0032',   // 픽셀 아트 검정 테두리
  shadow:      '#2d0050',   // 버튼 그림자

  // 버튼 — 보라 (메인 액션)
  btnPurple:   '#7b2fff',
  btnPurpleHi: '#a96dff',
  btnPurpleLo: '#4a00b8',

  // 버튼 — 핑크 (경고/잘못된 주차)
  btnPink:     '#ff3d8a',
  btnPinkHi:   '#ff7ab5',
  btnPinkLo:   '#b3005e',

  // 버튼 — 초록 (올바른 주차)
  btnGreen:    '#1ec900',
  btnGreenHi:  '#6fff56',
  btnGreenLo:  '#0a7a00',

  // 버튼 — 노랑 (도감/저장)
  btnYellow:   '#ffcc00',
  btnYellowHi: '#ffe566',
  btnYellowLo: '#997a00',

  // 텍스트
  txtDark:     '#1a0032',
  txtLight:    '#ffffff',
  txtYellow:   '#ffe566',
  txtGreen:    '#6fff56',

  // UI 요소
  panelBorder: '#1a0032',
  scanLine:    '#ff3d8a',
  progressBad: '#ff3d8a',
  progressGood:'#1ec900',
  progressBg:  '#3d1a5e',
  starGold:    '#ffcc00',
};

// ─── 정령 데이터 ──────────────────────────────────────────────────────────────
// rarity: 1=흔함 / 2=희귀 / 3=전설
//
// 확률 설계 (총합 120):
//   흔함 6종: 각 weight=12 → 합계 72 → 60% (종당 10%)
//   희귀 4종: 각 weight=9  → 합계 36 → 30% (종당 7.5%)
//   전설 2종: 각 weight=6  → 합계 12 → 10% (종당 5%)
const SPIRITS = [
  // 흔함 6종
  { id:0,  name:'여우정령',   rarity:1, weight:12, color:'#4fc3f7', hi:'#b3e5fc' },
  { id:1,  name:'고양이정령', rarity:1, weight:12, color:'#ce93d8', hi:'#f3e5f5' },
  { id:2,  name:'토끼정령',   rarity:1, weight:12, color:'#80cbc4', hi:'#e0f2f1' },
  { id:3,  name:'슬라임',     rarity:1, weight:12, color:'#fff176', hi:'#fffde7' },
  { id:4,  name:'고블린',     rarity:1, weight:12, color:'#a5d6a7', hi:'#e8f5e9' },
  { id:5,  name:'빨간버섯',   rarity:1, weight:12, color:'#81d4fa', hi:'#e1f5fe' },
  // 희귀 4종
  { id:6,  name:'나무정령',   rarity:2, weight:9,  color:'#ffb74d', hi:'#fff3e0' },
  { id:7,  name:'요정',       rarity:2, weight:9,  color:'#f06292', hi:'#fce4ec' },
  { id:8,  name:'호랑이정령', rarity:2, weight:9,  color:'#ff7043', hi:'#fbe9e7' },
  { id:9,  name:'곰정령',     rarity:2, weight:9,  color:'#80deea', hi:'#e0f7fa' },
  // 전설 2종
  { id:10, name:'용',         rarity:3, weight:6,  color:'#ffd700', hi:'#fffde7' },
  { id:11, name:'봉황',       rarity:3, weight:6,  color:'#ff6b35', hi:'#fff3e0' },
];

const RARITY_LABEL = { 1:'★ 흔함', 2:'★★ 희귀', 3:'★★★ 전설' };
const RARITY_COLOR = { 1:COL.txtLight, 2:'#ffb74d', 3:'#ffd700' };

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentState       = 1;
let currentLabel       = '';
let confidence         = 0;
let detectionStartTime = null;
let badProgress        = 0;
let goodProgress       = 0;
let collectedIds       = [];   // 수집한 정령 id 배열
let currentSpirit      = null; // 현재 등장 중인 정령 객체
let giveUpStartTime    = null; // 포기하기 페이드아웃 시작 시각 (null=비활성)
let dexPage            = 0;    // 도감 페이지 (0=1페이지, 1=2페이지)
let currentSpiritImgVariant = 0; // State2에서 선택한 sad 이미지 버전 (0 또는 1)
let appearTime         = null;   // 등장 이펙트 시작 시각
let collectTime        = null;   // 수집 성공 시각 (글로우 링 3초)
let modelReady         = false;
let modelError         = false;
let isClassifying      = false;

let canvasScale   = 1;
let canvasOffsetX = 0;
let canvasOffsetY = 0;

let capture;
let pInst = null; // p5 인스턴스 — handleTap 등 전역에서 millis() 접근용
let classifier;

// ── 핵심: video → 일반 2D 캔버스로 복사해서 TF에 넘길 오프스크린 캔버스 ──
let offscreen;    // HTMLCanvasElement
let offCtx;       // CanvasRenderingContext2D

// ─── P5 SKETCH ────────────────────────────────────────────────────────────────
// ─── 폰트 헬퍼 ────────────────────────────────────────────────────────────────
// p5의 textStyle+textSize 조합이 브라우저마다 불안정해서
// drawingContext.font 를 직접 설정하는 방식으로 통일.
// weight: 'normal' | 'bold' | '900'
function setFont(p, size, weight) {
  p.drawingContext.font = (weight||'bold') + ' ' + size + 'px "Galmuri11"';
  p.textSize(size);
}

// 정령 이미지 배열 — preload에서 채워짐
let spiritImgs     = [];              // 도감용 기본 이미지 spirit_N.png
let spiritSadImgs  = [[], []];        // 잘못된 주차 표현 [0]=sad_0, [1]=sad_1
let spiritHappyImgs = [];             // 올바른 주차 완료 기쁨 이미지
let bgDotImg  = null;
let cardBgImg = null; // 도감 칸 배경 이미지 (images/card_bg.png)

const sketch = (p) => {

  // ── preload: 정령 이미지 6장 로드 ──────────────────────────────────────────
  // images/spirit_0.png ~ spirit_5.png 가 있으면 자동으로 사용됨
  // 파일이 없으면 기존 색상 오브로 표시됨 (에러 없음)
  p.preload = function () {
    // 도감용 기본 이미지: images/spirit_N.png
    for (let i = 0; i < SPIRITS.length; i++) {
      (function(idx) {
        let img = new window.Image();
        img.onload  = function() { spiritImgs[idx] = img; };
        img.onerror = function() { spiritImgs[idx] = null; };
        img.src = 'images/spirit_' + idx + '.png';
      })(i);
    }
    // 잘못된 주차 표현 A: images/spirit_N_sad_1.png
    // 잘못된 주차 표현 B: images/spirit_N_sad_2.png
    // 올바른 주차 기쁨:  images/spirit_N_happy.png
    for (let i = 0; i < SPIRITS.length; i++) {
      (function(idx) {
        [1, 2].forEach(function(v) {
          let img = new window.Image();
          img.onload  = function() { spiritSadImgs[v-1][idx] = img; }; // 배열은 0,1로 저장
          img.onerror = function() { spiritSadImgs[v-1][idx] = null; };
          img.src = 'images/spirit_' + idx + '_sad_' + v + '.png';
        });
        let hImg = new window.Image();
        hImg.onload  = function() { spiritHappyImgs[idx] = hImg; };
        hImg.onerror = function() { spiritHappyImgs[idx] = null; };
        hImg.src = 'images/spirit_' + idx + '_happy.png';
      })(i);
    }
    // 도트 배경 이미지
    let bgd = new window.Image();
    bgd.onload  = function() { bgDotImg = bgd; };
    bgd.onerror = function() { bgDotImg = null; };
    bgd.src = 'images/bg_dot.png';
    // 도감 칸 배경 이미지
    let cbd = new window.Image();
    cbd.onload  = function() { cardBgImg = cbd; };
    cbd.onerror = function() { cardBgImg = null; };
    cbd.src = 'images/card_bg.png';
  };

  p.setup = function () {
    pInst = p;
    let cnv = p.createCanvas(CANVAS_W, CANVAS_H);
    cnv.elt.style.display = 'block';
    p.textFont('monospace');  // 폰트 로드 전 폴백
    p.textStyle(p.BOLD);
    collectedIds = loadSpiritData();
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    offscreen = document.createElement('canvas');
    offscreen.width  = 224;
    offscreen.height = 224;
    offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    // 갈무리11 로드 완료 후 Canvas에 적용
    document.fonts.ready.then(function() {
      p.drawingContext.font = 'bold 16px "Galmuri11"';
      p.textFont('Galmuri11');
    });

    startCamera(p);
  };

  p.draw = function () {
    p.background(COL.bgDark);
    if (!modelReady && !modelError) { drawLoading(p); return; }
    if (modelError)                 { drawError(p);   return; }

    if      (currentState === 1) drawState1(p);
    else if (currentState === 2) drawState2(p);
    else if (currentState === 3) drawState3(p);
    else if (currentState === 4) drawState4(p);
    else if (currentState === 5) drawState5(p);
  };

  p.mousePressed = function () {
    handleTap(p.mouseX * canvasScale + canvasOffsetX,
              p.mouseY * canvasScale + canvasOffsetY);
  };

  p.touchStarted = function () {
    if (p.touches.length > 0)
      handleTap(p.touches[0].x * canvasScale + canvasOffsetX,
                p.touches[0].y * canvasScale + canvasOffsetY);
    return false;
  };
};

// ─── CAMERA ───────────────────────────────────────────────────────────────────
function startCamera(p) {
  capture = p.createCapture(
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    () => { capture.hide(); initClassifier(); }
  );
  // 콜백 미발생 대비 4초 폴백
  setTimeout(() => { if (!classifier) initClassifier(); }, 4000);
}

// ─── ML5 INIT ─────────────────────────────────────────────────────────────────
function initClassifier() {
  if (classifier) return; // 중복 방지
  try {
    // 모델 URL에 callback만 넘김 — options 없이
    classifier = ml5.imageClassifier(modelURL, onModelReady);
  } catch (e) {
    modelError = true;
    console.error('ml5 init error:', e);
  }
}

function onModelReady() {
  modelReady = true;
  console.log('✅ Model ready');
  setInterval(runClassify, CLASSIFY_INTERVAL);
}

// ── 핵심 수정: video 대신 오프스크린 2D 캔버스를 TF에 전달 ──────────────────
function runClassify() {
  if (isClassifying) return;
  if (!capture || capture.elt.readyState < 2) return;

  // video → 224×224 일반 2D 캔버스로 복사
  // (WebGPU ExternalTexture 경로를 완전히 우회)
  try {
    offCtx.drawImage(capture.elt, 0, 0, 224, 224);
  } catch (e) {
    return; // 아직 video 준비 안 됨
  }

  isClassifying = true;
  classifier.classify(offscreen, (results, err) => {
    isClassifying = false;
    if (err || !results || !results[0]) return;
    currentLabel = results[0].label;
    confidence   = results[0].confidence;
    console.log(currentLabel, (confidence * 100).toFixed(1) + '%');
  });
}

// ─── RESPONSIVE ───────────────────────────────────────────────────────────────
function fitCanvas() {
  let sw = window.innerWidth, sh = window.innerHeight;
  let probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:0;width:0;height:0;pointer-events:none;';
  document.body.appendChild(probe);
  let safeTop = parseFloat(getComputedStyle(probe).top) || 0;
  document.body.removeChild(probe);

  let usableH   = sh - safeTop;
  canvasScale   = Math.min(sw / CANVAS_W, usableH / CANVAS_H);
  let dw = CANVAS_W * canvasScale, dh = CANVAS_H * canvasScale;
  canvasOffsetX = (sw - dw) / 2;
  canvasOffsetY = safeTop + (usableH - dh) / 2;

  let el = document.querySelector('canvas');
  if (el) Object.assign(el.style, {
    position:'fixed', left:canvasOffsetX+'px', top:canvasOffsetY+'px',
    width:dw+'px', height:dh+'px', margin:'0'
  });
}

// ─── TAP ──────────────────────────────────────────────────────────────────────
function handleTap(sx, sy) {
  let mx = (sx - canvasOffsetX) / canvasScale;
  let my = (sy - canvasOffsetY) / canvasScale;
  if (mx < 0 || mx > CANVAS_W || my < 0 || my > CANVAS_H) return;

  if (currentState === 1 && hit(mx,my,256,8,90,34)) {
    currentState=5;
  }
  else if (currentState === 2 && hit(mx,my,14,715,240,55)) {
    // 수집하러 가기
    giveUpStartTime=null;
    currentState=3; detectionStartTime=null; goodProgress=0;
  }
  else if (currentState === 2 && hit(mx,my,262,715,84,55)) {
    // 포기하기 — 페이드아웃 시작
    if (!giveUpStartTime) giveUpStartTime = pInst.millis();
  }
  else if (currentState === 4 && hit(mx,my,60,715,240,55)) {
    if(currentSpirit) { collectedIds.push(currentSpirit.id); saveSpiritData(); }
    currentState=5;
  }
  else if (currentState === 5 && hit(mx,my,14,700,158,36)) {
    dexPage=0; // 1페이지
  }
  else if (currentState === 5 && hit(mx,my,180,700,166,36)) {
    dexPage=1; // 2페이지
  }
  else if (currentState === 5 && hit(mx,my,60,742,240,48)) {
    currentState=1; resetDetect(); dexPage=0;
  }
}
function hit(mx,my,x,y,w,h){ return mx>x&&mx<x+w&&my>y&&my<y+h; }
function resetDetect() {
  detectionStartTime=null; badProgress=0; goodProgress=0;
  giveUpStartTime=null; appearTime=null; collectTime=null;
}

// ─── 정령 추첨 ───────────────────────────────────────────────────────────────
// Bad_Parking 이벤트에서만 호출 — any(흔함) + bad(희귀/전설) 모두 포함
function rollSpirit() {
  let totalW = SPIRITS.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * totalW;
  let acc = 0;
  for (let sp of SPIRITS) {
    acc += sp.weight;
    if (r < acc) return sp;
  }
  return SPIRITS[SPIRITS.length - 1];
}

// ── 등장 이펙트 헬퍼 ─────────────────────────────────────────────────────────

// 픽셀 파티클 이펙트 — 등장 후 0.8초 재생
// t: 0~1 (이펙트 진행도)
function drawAppearParticles(p, cx, cy, t, rarity) {
  let cols = rarity === 3 ? ['#ffd700','#ff6b35','#fff176','#ff8ab8'] :
             rarity === 2 ? ['#ffb74d','#f06292','#80deea','#ffffff'] :
                            ['#b3e5fc','#f3e5f5','#e0f2f1','#ffffff'];

  let count   = rarity === 3 ? 24 : rarity === 2 ? 16 : 12;
  let minDist = 80;  // 정령 바깥에서 시작
  let maxDist = rarity === 3 ? 180 : 140;

  for (let i = 0; i < count; i++) {
    let seed  = i * 137.508;
    let angle = (seed % 360) * Math.PI / 180;
    let speed = 0.5 + (i % 4) * 0.15;

    // t=0: minDist 위치에서 시작 → t=1: maxDist까지 이동
    let dist  = minDist + (maxDist - minDist) * speed * t;
    // alpha: t=0에서 밝고 t=1에서 완전 투명
    let alpha = 255 * (1 - t) * (1 - t); // 제곱으로 부드럽게 페이드
    // size: t=0에서 크고 t=1에서 작아짐
    let size  = Math.max(1.5, 8 * (1 - t));

    let px = cx + Math.cos(angle) * dist;
    let py = cy + Math.sin(angle) * dist;

    let col = p.color(cols[i % cols.length]);
    p.fill(p.red(col), p.green(col), p.blue(col), alpha);
    p.noStroke();
    p.rect(px - size/2, py - size/2, size, size);
  }
}

// 전설 등급 페이드인+스케일업
// t: 0~1, 반환값: 현재 scale (0→1, 살짝 오버슈트)
function getLegendScale(t) {
  function lerp(a, b, t) { return a + (b-a)*t; }
  if (t < 0.6) return lerp(0,    1.12, t/0.6);
  if (t < 0.8) return lerp(1.12, 0.95, (t-0.6)/0.2);
  return             lerp(0.95, 1.0,  (t-0.8)/0.2);
}
function drawLoading(p) {
  p.background(COL.bgDark);
  let t = p.millis()/1000;
  let pulse = p.sin(t*3)*10;
  p.fill(COL.outline); p.noStroke(); p.ellipse(CANVAS_W/2, CANVAS_H/2-20+pulse, 74, 74);
  p.fill(COL.btnPurple); p.noStroke(); p.ellipse(CANVAS_W/2, CANVAS_H/2-20+pulse, 70, 70);
  p.fill(COL.btnPurpleHi); p.noStroke(); p.ellipse(CANVAS_W/2, CANVAS_H/2-20+pulse, 54, 54);
  p.fill(255,255,255,180); p.noStroke(); p.ellipse(CANVAS_W/2-10, CANVAS_H/2-32+pulse, 18, 12);
  // MD bold(11px) 로딩 텍스트
  let dots = '.'.repeat(Math.floor(p.millis()/400)%4);
  setFont(p, 11, 'bold'); p.textAlign(p.CENTER,p.CENTER); p.noStroke();
  p.fill(COL.txtLight); p.text('모델 로딩중'+dots, CANVAS_W/2, CANVAS_H/2+40);
}
function drawError(p) {
  p.background(COL.bgDark);
  // LG bold(14px) 에러 타이틀
  setFont(p, 14, 'bold'); p.textAlign(p.CENTER,p.CENTER); p.noStroke();
  p.fill(COL.btnPink); p.text('모델 로드 실패', CANVAS_W/2, CANVAS_H/2-20);
  // SM normal(9px) 보조 설명
  setFont(p, 9, 'normal');
  p.fill(255,255,255,180); p.text('model/ 폴더와 Live Server를 확인하세요', CANVAS_W/2, CANVAS_H/2+12);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE 1 — 실시간 탐색 모드
// ═══════════════════════════════════════════════════════════════════════════════
function drawState1(p) {
  drawCamera(p);
  drawTopBar(p, '정령 수집');
  drawPixelButton(p, 256, 8, 90, 34, '도감', 'yellow');

  // 스캔영역: 가로 중앙(x=70, w=220)
  drawScanArea(p, 70, 200, 220, 220);

  // 설명 박스: 하단 어두운 박스로 통일
  drawDialogBox(p, 20, 620, 320, 70, '킥보드 정령을 찾아보세요!');

  drawBottomPanel(p, badProgress, false);

  if (currentLabel==='Bad_Parking' && confidence>=CONFIDENCE_THRESHOLD_BAD) {
    if (!detectionStartTime) detectionStartTime = p.millis();
    let e = p.millis()-detectionStartTime;
    badProgress = Math.min(e/HOLD_DURATION, 1);
    if (e >= HOLD_DURATION) {
      currentSpirit = rollSpirit();
      currentSpiritImgVariant = Math.floor(Math.random() * 2);
      detectionStartTime=null; badProgress=0;
      appearTime = p.millis(); // 등장 이펙트 시작
      currentState=2;
    }
  } else {
    detectionStartTime=null; badProgress=0;
  }
}

// 연기 이펙트 — 포기 시 정령 위에서 고급진 연기가 올라오며 사라짐
// giveUpStartTime 기준 t=0~1 (1초)
function drawSmokeEffect(p, cx, cy) {
  if (giveUpStartTime === null) return;
  let t   = Math.min((p.millis() - giveUpStartTime) / 1000, 1); // 포기 진행도 0~1
  let now = p.millis() / 1000;

  // ── 파티클 정의 (seed 고정으로 떨림 없음) ─────────────────────────────────
  // [위상오프셋, x흔들림 진폭, x흔들림 주파수, 상승 속도, 시작 x오프셋, 크기 배율]
  let particles = [
    [0.00,  22, 1.1,  1.0,  -8, 1.0],
    [0.08,  -18, 0.9, 1.3,   4, 1.2],
    [0.16,  28, 1.3,  0.85, -2, 0.85],
    [0.22,  -24, 1.0, 1.15,  10, 1.1],
    [0.31,  16, 0.8,  1.4,  -12, 0.9],
    [0.38,  -12, 1.2, 0.95,   6, 1.3],
    [0.47,  20, 1.0,  1.2,   2, 0.95],
    [0.55,  -26, 0.9, 0.9,  -6, 1.15],
    [0.63,  14, 1.4,  1.35, 14, 1.0],
    [0.71,  -20, 1.1, 1.05, -4, 0.88],
    [0.80,  30, 0.85, 0.8,   8, 1.2],
    [0.88,  -10, 1.3, 1.5,  -10, 1.05],
  ];

  // 포기 진행에 따라 연기 강도 증가 (처음엔 소량 → 나중엔 많이)
  let intensity = 0.4 + t * 0.6;

  for (let i = 0; i < particles.length; i++) {
    let [phaseOff, ampX, freqX, speed, startX, sizeMul] = particles[i];
    let phase = (now * speed + phaseOff) % 1.0; // 0~1 순환

    // 상승 거리: 아래에서 올라올수록 멀리
    let riseY = phase * 180;

    // x 위치: 사인파 경로로 자연스러운 흔들림
    let wx = ampX * Math.sin(freqX * Math.PI * 2 * phase + phaseOff * 10);
    let px = cx + startX + wx;
    let py = cy - 50 - riseY;

    // 크기: 아래에서 작게 시작해 올라갈수록 크게 퍼짐
    let baseSize = 12 + phase * 50;
    let size = baseSize * sizeMul;

    // alpha: 아래 진하고 → 위 투명 (easing)
    let fadeOut = (1 - phase) * (1 - phase); // 제곱으로 빠르게 사라짐
    let alpha = 180 * fadeOut * intensity;

    // 높이에 따른 색상: 아래는 진한 회색(연기 시작), 위는 흰색(퍼진 연기)
    let gray = Math.floor(100 + phase * 140);

    // ── 레이어 1: 외곽 부드러운 헤일로 (더 크고 투명)
    p.fill(gray, gray, gray, alpha * 0.35);
    p.noStroke();
    p.ellipse(px, py, size * 1.6, size * 1.3);

    // ── 레이어 2: 중간 레이어
    p.fill(gray, gray, gray, alpha * 0.55);
    p.noStroke();
    p.ellipse(px, py, size * 1.1, size * 0.95);

    // ── 레이어 3: 핵심 연기 (가장 진함, 가장 작음)
    p.fill(gray - 20, gray - 20, gray - 20, alpha * 0.8);
    p.noStroke();
    p.ellipse(px, py, size * 0.65, size * 0.6);
  }
}
function drawState2(p) {
  let sp = currentSpirit;
  let name = sp ? sp.name : '???';
  let rlbl = sp ? RARITY_LABEL[sp.rarity] : '';

  // ── 페이드아웃 진행도 계산 ────────────────────────────────────────────────
  let fadeAlpha = 255; // 기본: 완전 불투명
  let isFading  = false;
  if (giveUpStartTime !== null) {
    let elapsed = p.millis() - giveUpStartTime;
    let progress = Math.min(elapsed / 1000, 1); // 0~1 (1초)
    fadeAlpha = Math.floor(255 * (1 - progress));
    isFading  = true;
    // 1초 완료 → State1 복귀
    if (progress >= 1) {
      giveUpStartTime = null;
      currentSpirit   = null;
      currentState    = 1;
      resetDetect();
      return;
    }
  }

  // ── 배경/탑바/정보박스 ─────────────────────────────────────────────────────
  drawSpiritBg(p);
  drawTopBar(p, '정령 발견!');
  drawInfoBox(p, name, rlbl);

  // ── 등장 이펙트 계산 ───────────────────────────────────────────────────────
  let effectDur = 1200; // 이펙트 지속 시간 (ms)
  let effectT   = 1.0; // 기본: 이펙트 완료
  let isAppearing = false;
  if (appearTime !== null && !isFading) {
    let elapsed = p.millis() - appearTime;
    if (elapsed < effectDur) {
      effectT = elapsed / effectDur; // 0~1
      isAppearing = true;
    }
  }

  let fadeA = fadeAlpha / 255;

  // ── 전설 등급 스케일업 + 페이드인 ─────────────────────────────────────────
  if (sp && sp.rarity === 3 && isAppearing) {
    let scale = getLegendScale(effectT);
    let alpha = Math.min(effectT * 2, 1.0) * fadeA; // 앞 절반에서 페이드인
    p.push();
    p.translate(180, 450);
    p.scale(scale);
    p.translate(-180, -450);
    drawMonsterPlaceholder(p, 180, 450, 240, sp, alpha, 'sad');
    p.pop();
  } else {
    drawMonsterPlaceholder(p, 180, 450, 240, sp, fadeA, 'sad');
  }

  // ── 파티클 이펙트 (전체 등급, 등장 중에만) ────────────────────────────────
  if (isAppearing) {
    drawAppearParticles(p, 180, 450, effectT, sp ? sp.rarity : 1);
  }

  // ── 연기 이펙트 (포기 중에만) ─────────────────────────────────────────────
  if (isFading) {
    drawSmokeEffect(p, 180, 450);
  }

  // ── 다이얼로그 + 버튼 (페이드 중엔 숨김) ─────────────────────────────────
  if (!isFading) {
    drawDialogBox(p, 20, 630, 320, 70, '올바른 주차로 정령을 구해주세요!');
    // 수집하러 가기 (3/4) + 포기하기 (1/4)
    drawPixelButton(p, 14,  715, 240, 55, '수집하러 가기', 'pink');
    drawPixelButton(p, 262, 715, 84,  55, '포기',          'purple');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE 3 — 올바른 주차 유도 (이전 화면의 currentSpirit 그대로 사용)
// ═══════════════════════════════════════════════════════════════════════════════
function drawState3(p) {
  drawCamera(p);
  drawTopBar(p, '정령 수집');

  // 스캔영역: 가로 중앙(x=70, w=220)
  drawScanArea(p, 70, 120, 220, 200);

  // 정령 미니 — 스캔 아래 중앙
  let sp = currentSpirit;
  if (sp) {
    drawMonsterPlaceholder(p, 180, 450, 240, sp, 1.0, 'sad');
  }

  // 하단 다이얼로그 박스
  drawDialogBox(p, 20, 620, 320, 70, '올바른 주차위치에 주차해주세요!');

  drawBottomPanel(p, goodProgress, true);

  if (currentLabel==='Good_Parking' && confidence>=CONFIDENCE_THRESHOLD_GOOD) {
    if (!detectionStartTime) detectionStartTime = p.millis();
    let e = p.millis()-detectionStartTime;
    goodProgress = Math.min(e/HOLD_DURATION, 1);
    if (e >= HOLD_DURATION) { detectionStartTime=null; goodProgress=0; collectTime=p.millis(); currentState=4; }
  } else {
    detectionStartTime=null;
    goodProgress = Math.max(0, goodProgress-0.01);
  }
}

// 글로우 링 이펙트 — 수집 성공 화면에서 지속 재생
function drawGlowRings(p, cx, cy, rarity) {
  // 등급별 색상
  let ringCols = rarity === 3 ? ['#ffd700', '#ffaa00', '#ff6b35'] :  // 전설: 금·주황
                 rarity === 2 ? ['#ff6eb4', '#ff3d8a', '#ffb74d'] :  // 희귀: 핑크·주황
                                ['#4fc3f7', '#81d4fa', '#b3e5fc'];   // 흔함: 하늘색

  let ringCount = 3;
  let now = p.millis() / 1000; // 초 단위
  let period = 1.8; // 링 하나의 주기(초)

  for (let i = 0; i < ringCount; i++) {
    // 각 링은 위상차를 두고 순차적으로 퍼져나감
    let phase = (now + i * (period / ringCount)) % period;
    let t = phase / period; // 0~1

    // 반지름: 정령 크기(120) 바깥에서 시작해 퍼져나감
    let minR = 115;
    let maxR = rarity === 3 ? 200 : 165;
    let r = minR + (maxR - minR) * t;

    // alpha: 처음엔 밝고 퍼지면서 사라짐
    let alpha = 220 * (1 - t) * (1 - t);

    // 링 두께: 처음엔 두껍고 얇아짐
    let thick = Math.max(1, 10 * (1 - t));

    let col = p.color(ringCols[i]);
    p.noFill();
    p.stroke(p.red(col), p.green(col), p.blue(col), alpha);
    p.strokeWeight(thick);
    p.ellipse(cx, cy, r * 2, r * 2);
  }
  p.noStroke();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE 4 — 수집 성공 (올바른 주차 완료)
// ═══════════════════════════════════════════════════════════════════════════════
function drawState4(p) {
  let sp = currentSpirit;
  let name = sp ? sp.name : '???';
  let rlbl = sp ? RARITY_LABEL[sp.rarity] : '';
  drawSpiritBg(p);
  drawTopBar(p, '수집 성공!');
  drawInfoBox(p, name, rlbl);
  // 글로우 링 — 수집 후 3초 동안만 표시
  if (collectTime !== null && p.millis() - collectTime < 3000) {
    drawGlowRings(p, 180, 450, sp ? sp.rarity : 1);
  }
  drawMonsterPlaceholder(p, 180, 450, 240, sp, 1.0, 'happy');
  drawDialogBox(p, 20, 630, 320, 70, name+' 수집 완료! '+rlbl);
  drawPixelButton(p, 60, 715, 240, 55, '도감에 저장하기', 'yellow');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE 5 — 도감 (2페이지, 페이지당 6칸)
// ═══════════════════════════════════════════════════════════════════════════════
function drawState5(p) {
  p.background(COL.bgDark);
  p.fill(255,255,255,30); p.noStroke();
  for(let i=0;i<12;i++){
    let sx=((i*97+13)%320)+20, sy=((i*61+30)%700)+60;
    p.rect(sx,sy,3,3); p.rect(sx+4,sy,3,3); p.rect(sx+2,sy-2,3,7);
  }
  drawTopBar(p, '정령 도감');

  // 수집 현황
  let uniqueCnt = new Set(collectedIds).size;
  let cntMsg = '수집 ' + uniqueCnt + '/' + SPIRITS.length + '종 완료!';
  drawPixelFrame(p, 30, 60, 300, 55, COL.bgPanel);
  setFont(p, 15, 'bold'); p.fill(COL.txtDark); p.noStroke();
  p.textAlign(p.CENTER, p.CENTER);
  p.text(cntMsg, 30 + 300/2, 60 + 55/2);

  // 그리드 — 현재 페이지의 정령 6마리
  let cols=2, rows=3, cW=161, cH=170, gapX=10, gapY=10;
  let sx=14, sy=130;
  let start = dexPage * 6; // 0페이지→0~5, 1페이지→6~11
  for(let i=0; i<6; i++){
    let idx = start + i;
    if(idx >= SPIRITS.length) break;
    let r=Math.floor(i/cols), c=i%cols;
    let sp=SPIRITS[idx];
    drawGridCell(p, sx+c*(cW+gapX), sy+r*(cH+gapY), cW, cH, sp, collectedIds.includes(sp.id));
  }

  // 페이지 탭 버튼 (1페이지 / 2페이지)
  let tab1Theme = dexPage===0 ? 'yellow' : 'purple';
  let tab2Theme = dexPage===1 ? 'yellow' : 'purple';
  drawPixelButton(p, 14,  700, 158, 36, '1페이지', tab1Theme);
  drawPixelButton(p, 180, 700, 166, 36, '2페이지', tab2Theme);

  // 돌아가기 버튼
  drawPixelButton(p, 60, 742, 240, 48, '돌아가기', 'purple');
}

// 정령 등장 화면 배경 — 전체 화면에 bg_dot 이미지를 꽉 채움
function drawSpiritBg(p) {
  // 배경이미지를 y=50(탑바 아래) ~ y=630(다이얼로그 위)까지 꽉 채움
  let bgTop = 50, bgBottom = 630;
  if (bgDotImg) {
    p.push();
    p.drawingContext.globalAlpha = 1.0;
    p.drawingContext.globalCompositeOperation = 'source-over';
    // 가로는 360 고정, 세로는 bgTop~bgBottom에 맞게 늘림
    p.drawingContext.drawImage(bgDotImg, 0, bgTop, CANVAS_W, bgBottom - bgTop);
    p.pop();
  } else {
    p.fill(COL.bgDark); p.noStroke();
    p.rect(0, bgTop, CANVAS_W, bgBottom - bgTop);
  }
}

// 정보 박스 — 탑바 바로 아래, 반투명 어두운 배경
function drawInfoBox(p, name, rlbl) {
  let boxY = 50, boxH = 80;
  let cx = CANVAS_W / 2;
  let cy = boxY + boxH / 2; // 박스 수직 중앙 = 90

  // 반투명 패널
  p.fill(0, 0, 30, 190); p.noStroke(); p.rect(0, boxY, CANVAS_W, boxH);
  // 하단 구분선
  p.fill(COL.btnPurple); p.noStroke(); p.rect(0, boxY + boxH - 2, CANVAS_W, 3);

  // 이름 + 희귀도를 중앙에 세로로 배치
  // 이름: 중앙보다 살짝 위
  setFont(p, 16, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
  p.fill(COL.starGold); p.text(name, cx, cy - 12);

  // 희귀도: 이름 바로 아래
  setFont(p, 10, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
  p.fill(255, 255, 255, 200); p.text(rlbl, cx, cy + 14);
}

function drawCamera(p) {
  if (capture && capture.elt.readyState >= 2) {
    let vw=capture.elt.videoWidth||CANVAS_W, vh=capture.elt.videoHeight||CANVAS_H;
    let s=Math.max(CANVAS_W/vw, CANVAS_H/vh);
    p.image(capture, (CANVAS_W-vw*s)/2, (CANVAS_H-vh*s)/2, vw*s, vh*s);
    p.fill(0,0,0,80); p.noStroke(); p.rect(0,0,CANVAS_W,CANVAS_H);
  } else {
    p.background(COL.bgDark);
    setFont(p, 11, 'bold'); p.fill(COL.txtLight); p.noStroke();
    p.textAlign(p.CENTER,p.CENTER);
    p.text('카메라 연결중...', CANVAS_W/2, CANVAS_H/2);
  }
}

// 픽셀 아트 버튼 — 첨부 이미지 스타일
// 구조: 어두운 외곽 → 본체 → 상단 하이라이트 줄 → 좌상단 흰 광택 픽셀 → 하단 어두운 면
function drawPixelButton(p, x, y, w, h, lbl, theme) {
  theme = theme || 'purple';
  let base, hi, lo, dark, txtCol;
  if (theme==='pink') {
    base='#ff3d8a'; hi='#ff8ab8'; lo='#cc1f6a'; dark='#5a0030'; txtCol='#3d0020';
  } else if (theme==='green') {
    base='#1ec900'; hi='#7fff60'; lo='#0a8000'; dark='#003d00'; txtCol='#002800';
  } else if (theme==='yellow') {
    base='#ffcc00'; hi='#ffe97a'; lo='#b38a00'; dark='#4d3a00'; txtCol='#3a2a00';
  } else { // purple
    base='#7b2fff'; hi='#b87dff'; lo='#4a00cc'; dark='#1a0050'; txtCol='#0d0030';
  }

  let S = 4; // 픽셀 단위 크기
  let r = 6; // 모서리 픽셀 커팅 크기

  // 1. 맨 아래 어두운 그림자 (우하단 오프셋)
  p.fill(dark); p.noStroke();
  p.rect(x+S, y+S, w, h, r);

  // 2. 어두운 외곽선
  p.fill(dark); p.noStroke();
  p.rect(x-2, y-2, w+4, h+4, r+2);

  // 3. 본체
  p.fill(base); p.noStroke();
  p.rect(x, y, w, h, r);

  // 4. 상단 하이라이트 줄 (얇은 밝은 선)
  p.fill(hi); p.noStroke();
  p.rect(x+r, y+3, w-r*2, 5);          // 상단 가로줄
  p.rect(x+3, y+r, 5, h-r*2);          // 좌측 세로줄

  // 5. 하단/우측 어두운 면 (입체감)
  p.fill(lo); p.noStroke();
  p.rect(x+r, y+h-8, w-r*2, 5);        // 하단
  p.rect(x+w-8, y+r, 5, h-r*2);        // 우측

  // 6. 좌상단 흰 광택 픽셀 (이미지의 흰 하이라이트)
  p.fill(255,255,255,200); p.noStroke();
  p.rect(x+r+2,   y+6,  S*2, S);       // 첫 번째 픽셀
  p.rect(x+r+2,   y+6+S, S,  S);       // 두 번째 픽셀 (L자)

  // 7. 텍스트 — 흰색
  setFont(p, 13, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
  p.fill(dark); p.text(lbl, x+w/2+1, y+h/2+1); // 픽셀 두께감용 어두운 레이어
  p.fill(255, 255, 255); p.text(lbl, x+w/2, y+h/2);
}

// 상단 바 — 버튼과 동일한 픽셀 아트 스타일
function drawTopBar(p, label) {
  let dark='#1a0050', base='#7b2fff', hi='#d0b0ff', lo='#4a00cc';
  let S=4, H=50;

  // 1. 하단 그림자
  p.fill(dark); p.noStroke(); p.rect(0, H, CANVAS_W, S);
  // 2. 본체
  p.fill(base); p.noStroke(); p.rect(0, 0, CANVAS_W, H);
  // 3. 상단 하이라이트 줄 — 더 밝고 선명하게
  p.fill(hi); p.noStroke(); p.rect(0, 2, CANVAS_W, 5);
  // 4. 하단 어두운 면
  p.fill(lo); p.noStroke(); p.rect(0, H-9, CANVAS_W, 7);
  // 5. 하단 외곽선
  p.fill(dark); p.noStroke(); p.rect(0, H, CANVAS_W, 4);
  // 6. 좌상단 광택 픽셀 (L자) — 탑바 왼쪽 안쪽
  p.fill(255,255,255,200); p.noStroke();
  p.rect(6, 5, S*2, S);
  p.rect(6, 5+S, S,  S);

  // 별 아이콘 + 텍스트
  drawPixelStar(p, 20, 25, COL.starGold);
  setFont(p, 14, 'bold'); p.textAlign(p.LEFT, p.CENTER); p.noStroke();
  p.fill(dark); p.text(label, 36, 27);     // 픽셀 두께감
  p.fill(255, 255, 255); p.text(label, 35, 26);
  // 하트 아이콘
  drawPixelHeart(p, CANVAS_W-20, 25, '#ff6eb4');
}

// 흰 패널 — 픽셀 프레임 스타일
function drawPixelPanel(p, x, y, w, h) {
  drawPixelFrame(p, x, y, w, h, COL.bgPanel);
}

// ── 픽셀 프레임 헬퍼 ─────────────────────────────────────────────────────────
// 첨부 이미지 스타일: 검정 외곽 → 회색 하이라이트/그림자 → 흰 내부
// bgCol: 내부 배경색, borderPx: 외곽 두께(기본 4)
function drawPixelFrame(p, x, y, w, h, bgCol) {
  let B = 4; // 외곽 검정 두께
  let G = 3; // 회색 하이라이트/그림자 두께

  // 1. 검정 외곽
  p.fill(COL.outline); p.noStroke();
  p.rect(x-B, y-B, w+B*2, h+B*2);

  // 2. 우하단 회색 그림자 (3D 느낌)
  p.fill(160, 160, 160);
  p.rect(x-B+G, y+h,    w+B*2-G*2, G); // 아래 그림자
  p.rect(x+w,   y-B+G,  G,          h+B*2-G*2); // 오른쪽 그림자

  // 3. 좌상단 밝은 하이라이트
  p.fill(230, 230, 230);
  p.rect(x-B,   y-B,    w+B*2-G, G); // 위 하이라이트
  p.rect(x-B,   y-B,    G,        h+B*2-G); // 왼쪽 하이라이트

  // 4. 내부 배경
  p.fill(bgCol || COL.bgPanel); p.noStroke();
  p.rect(x, y, w, h);
}

// 말풍선 박스 — 픽셀 프레임 스타일
function drawSpeechBox(p, x, y, w, h, msg) {
  drawPixelFrame(p, x, y, w, h, COL.bgPanel);
  setFont(p, 11, 'bold'); p.fill(COL.txtDark); p.noStroke();
  p.textAlign(p.LEFT, p.TOP);
  wrap(p, msg, x+14, y+14, 20);
}

// 경고 박스 — 픽셀 프레임 + 핑크 왼쪽 바
function drawAlertBox(p, x, y, w, h, msg) {
  drawPixelFrame(p, x, y, w, h, COL.bgPanel);
  p.fill(COL.btnPink); p.noStroke(); p.rect(x, y, 6, h);
  p.fill(COL.btnPink); p.noStroke(); p.rect(x+14, y+10, 18, 18);
  p.fill(COL.outline); p.noStroke(); p.rect(x+20, y+13, 6, 8);
  p.fill(COL.outline); p.noStroke(); p.rect(x+20, y+23, 6, 3);
  setFont(p, 11, 'bold'); p.fill(COL.txtDark); p.noStroke();
  p.textAlign(p.LEFT, p.TOP);
  wrap(p, msg, x+40, y+14, 20);
}

// 말풍선 (캐릭터 위) — 픽셀 프레임 + 픽셀 꼬리
function drawSpeechBubble(p, x, y, msg) {
  let bw=165, bh=88, bx=x-bw/2, by=y-bh/2;
  drawPixelFrame(p, bx, by, bw, bh, COL.bgPanel);
  // 픽셀 꼬리 (계단형)
  p.fill(COL.outline); p.noStroke();
  p.rect(bx+12, by+bh,   16, 4);
  p.rect(bx+12, by+bh+4, 12, 4);
  p.rect(bx+12, by+bh+8, 8,  4);
  p.rect(bx+12, by+bh+12,4,  4);
  p.fill(COL.bgPanel); p.noStroke();
  p.rect(bx+13, by+bh-1, 14, 4);
  p.rect(bx+13, by+bh+3, 10, 4);
  p.rect(bx+13, by+bh+7, 6,  4);
  p.rect(bx+13, by+bh+11,2,  4);
  // 이모티콘 단일 문자면 크게 중앙 정렬, 일반 텍스트면 기존 방식
  if ([...msg].length <= 2 && msg.match(/\p{Emoji}/u)) {
    setFont(p, 26, 'bold'); p.fill(COL.txtDark); p.noStroke();
    p.textAlign(p.CENTER, p.CENTER);
    p.text(msg, bx+bw/2, by+bh/2);
  } else {
    setFont(p, 11, 'bold'); p.fill(COL.txtDark); p.noStroke();
    p.textAlign(p.LEFT, p.TOP);
    wrap(p, msg, bx+12, by+14, 19);
  }
}

// 말풍선 — 크기 직접 지정 버전 (State3 등 특수 레이아웃용)
// cx/cy는 말풍선 중심, bw/bh는 너비/높이
function drawSpeechBubbleCustom(p, cx, cy, bw, bh, msg) {
  let bx = cx - bw/2, by = cy - bh/2;
  drawPixelFrame(p, bx, by, bw, bh, COL.bgPanel);
  // 픽셀 꼬리 — 왼쪽 방향 (정령이 왼쪽에 있으므로)
  p.fill(COL.outline); p.noStroke();
  p.rect(bx-4,  by+bh*0.5,    4, 16);
  p.rect(bx-8,  by+bh*0.5+2,  4, 12);
  p.rect(bx-12, by+bh*0.5+4,  4, 8);
  p.rect(bx-16, by+bh*0.5+6,  4, 4);
  p.fill(COL.bgPanel); p.noStroke();
  p.rect(bx-1,  by+bh*0.5+1,  3, 14);
  p.rect(bx-5,  by+bh*0.5+3,  4, 10);
  p.rect(bx-9,  by+bh*0.5+5,  4, 6);
  // 텍스트
  setFont(p, 9, 'bold'); p.fill(COL.txtDark); p.noStroke();
  p.textAlign(p.LEFT, p.TOP);
  wrap(p, msg, bx+10, by+12, 17);
}

// 다이얼로그 박스 — 픽셀 프레임 (어두운 내부)
function drawDialogBox(p, x, y, w, h, msg) {
  drawPixelFrame(p, x, y, w, h, p.color(10, 5, 35));
  setFont(p, 11, 'bold'); p.textAlign(p.LEFT, p.TOP);
  p.fill(COL.txtLight); wrap(p, msg, x+14, y+14, 18);
}

// 스캔 영역 — 핑크 코너 + 점선
function drawScanArea(p, x, y, w, h) {
  let cx=x+w/2, cy=y+h/2, cs=20;
  p.push();
  // 점선 박스
  p.stroke(COL.btnPink); p.strokeWeight(2);
  p.drawingContext.setLineDash([8, 6]);
  p.noFill(); p.rect(x, y, w, h);
  p.drawingContext.setLineDash([]);
  // 굵은 코너
  p.stroke(COL.btnYellow); p.strokeWeight(4);
  [[x,y,x+cs,y],[x,y,x,y+cs],[x+w,y,x+w-cs,y],[x+w,y,x+w,y+cs],
   [x,y+h,x+cs,y+h],[x,y+h,x,y+h-cs],[x+w,y+h,x+w-cs,y+h],[x+w,y+h,x+w,y+h-cs]]
   .forEach(([a,b,c,d])=>p.line(a,b,c,d));
  // 십자선
  p.stroke(255,255,255,120); p.strokeWeight(1);
  p.line(cx-12,cy,cx+12,cy); p.line(cx,cy-12,cx,cy+12);
  p.pop();
}

// 하단 패널 — 버튼과 동일한 픽셀 아트 스타일
function drawBottomPanel(p, progress, isGood) {
  let accentCol = isGood ? '#1ec900' : '#ff3d8a';
  let accentHi  = isGood ? '#9fff80' : '#ff8ab8';
  let accentLo  = isGood ? '#0a8000' : '#aa1060';
  let dark      = '#0a001e';
  let panelBg   = '#120828';

  // 1. 패널 본체
  p.fill(dark); p.noStroke(); p.rect(0, 706, CANVAS_W, 96);      // 외곽
  p.fill(panelBg); p.noStroke(); p.rect(0, 710, CANVAS_W, 90);   // 내부
  // 상단 컬러 라인 + 하이라이트
  p.fill(accentCol); p.noStroke(); p.rect(0, 710, CANVAS_W, 4);
  p.fill(accentHi); p.noStroke(); p.rect(0, 710, CANVAS_W, 2);

  // 2. 상태 레이블
  let label = isGood ? '✦ 올바른 주차 감지중...' : '✦ AI 스캔중...';
  setFont(p, 9, 'bold'); p.textAlign(p.LEFT, p.CENTER); p.noStroke();
  p.fill(accentHi); p.text(label, 18, 732);

  // 3. AI 인식 수치
  if (currentLabel) {
    setFont(p, 8, 'normal'); p.textAlign(p.RIGHT, p.CENTER);
    p.fill(255,255,255,140); p.text(currentLabel+' '+(confidence*100).toFixed(0)+'%', CANVAS_W-14, 732);
  }

  // 4. 세그먼트 바 — 이미지처럼 넓고 뚜렷하게
  let segs=14, gap=5;
  let barX=12, barY=745, barH=30;
  let barW=CANVAS_W-barX*2;
  let segW=Math.floor((barW - gap*(segs-1)) / segs);
  let filled=Math.floor(progress*segs);

  for(let i=0; i<segs; i++){
    let sx = barX + i*(segW+gap);
    // 빈 세그먼트: 어두운 외곽 + 내부
    p.fill(dark); p.noStroke(); p.rect(sx-1, barY-1, segW+2, barH+2, 4);
    p.fill(30, 12, 65); p.noStroke(); p.rect(sx, barY, segW, barH, 3);

    if(i < filled){
      // 채워진 세그먼트: 버튼과 동일 레이어 구조
      p.fill(dark); p.noStroke(); p.rect(sx-1, barY-1, segW+2, barH+2, 4); // 외곽
      p.fill(accentLo); p.noStroke(); p.rect(sx, barY, segW, barH, 3);      // 하단 어두운 면
      p.fill(accentCol); p.noStroke(); p.rect(sx, barY, segW, barH-5, 3);   // 본체
      p.fill(accentHi); p.noStroke(); p.rect(sx+2, barY+2, segW-4, 4);      // 상단 하이라이트
      p.fill(255,255,255,180); p.noStroke(); p.rect(sx+2, barY+2, 4, 3);    // 광택 픽셀
    }
  }
}

// 정령 등장 화면 — 오브 이미지(뒤) + 정령 이미지(앞) 레이어 구조
// alpha: 0~1 (기본 1.0, 페이드아웃 시 0으로 감소)
// mode: 'sad'=잘못된주차 표현, 'happy'=올바른주차 기쁨, undefined=도감용 기본
function drawMonsterPlaceholder(p, cx, cy, d, sp, alpha, mode) {
  if (alpha === undefined) alpha = 1.0;
  let r = d/2;
  let baseCol = sp ? sp.color  : COL.btnPurple;
  let hiCol   = sp ? sp.hi     : COL.btnPurpleHi;

  // mode에 따라 이미지 선택
  let img = null;
  if (sp) {
    if (mode === 'sad') {
      // sad 이미지: currentSpiritImgVariant(0 또는 1) → 없으면 기본 이미지로 폴백
      img = spiritSadImgs[currentSpiritImgVariant][sp.id]
         || spiritImgs[sp.id]
         || null;
    } else if (mode === 'happy') {
      img = spiritHappyImgs[sp.id]
         || spiritImgs[sp.id]
         || null;
    } else {
      img = spiritImgs[sp.id] || null; // 도감용 기본
    }
  }

  // ── 정령 이미지 ───────────────────────────────────────────────────────────
  if (img) {
    p.drawingContext.save();
    p.drawingContext.globalAlpha = alpha;
    p.drawingContext.globalCompositeOperation = 'source-over';
    // 비율 유지하며 d×d 영역 안에 맞게 그리기
    let iw = img.naturalWidth  || img.width;
    let ih = img.naturalHeight || img.height;
    let scale = Math.min(d / iw, d / ih);
    let dw = iw * scale;
    let dh = ih * scale;
    p.drawingContext.drawImage(img, cx - dw/2, cy - dh/2, dw, dh);
    p.drawingContext.restore();
  } else {
    setFont(p, 14, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
    p.fill(255, 255, 255, 255*alpha);
    p.text(sp ? sp.name : '?', cx, cy);
  }

}

// 도감 그리드 셀 — 픽셀 프레임 스타일
function drawGridCell(p, x, y, w, h, sp, collected) {
  if (collected) {
    drawPixelFrame(p, x, y, w, h, COL.bgPanel);

    // 카드 배경 이미지 적용
    if (cardBgImg) {
      p.push();
      p.drawingContext.globalAlpha = 1.0;
      p.drawingContext.globalCompositeOperation = 'source-over';
      p.drawingContext.drawImage(cardBgImg, x, y, w, h);
      p.pop();
    }

    let badgeH = 30;
    let r  = Math.floor(Math.min(w, h - badgeH - 10) / 2) - 8;
    let cx = x + w/2;
    let cy = y + (h - badgeH) / 2;
    let baseCol = sp ? sp.color : COL.btnPurple;
    let hiCol   = sp ? sp.hi   : COL.btnPurpleHi;
    let img     = (sp && spiritImgs[sp.id]) ? spiritImgs[sp.id] : null;

    if (img) {
      p.push();
      p.drawingContext.globalAlpha = 1.0;
      p.drawingContext.globalCompositeOperation = 'source-over';
      let iw = img.naturalWidth  || img.width;
      let ih = img.naturalHeight || img.height;
      let size = r * 2;
      let scale = Math.min(size / iw, size / ih);
      let dw = iw * scale;
      let dh = ih * scale;
      p.drawingContext.drawImage(img, cx - dw/2, cy - dh/2, dw, dh);
      p.pop();
    } else {
      setFont(p, 11, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
      p.fill(COL.txtDark); p.text(sp ? sp.name : '?', cx, cy);
    }

    // 이름 배지
    drawPixelFrame(p, x+6, y+h-badgeH-2, w-12, badgeH, p.color(0x6B, 0x4F, 0x2A));
    setFont(p, 10, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
    p.fill('#F6E6B4'); p.text(sp ? sp.name : '???', x+w/2, y+h-badgeH/2-2);

  } else {
    // 미수집 — 어두운 픽셀 프레임
    drawPixelFrame(p, x, y, w, h, p.color(20, 8, 50));
    // 카드 배경 이미지를 어둡게 깔기
    if (cardBgImg) {
      p.push();
      p.drawingContext.globalAlpha = 0.25; // 어둡게
      p.drawingContext.globalCompositeOperation = 'source-over';
      p.drawingContext.drawImage(cardBgImg, x, y, w, h);
      p.pop();
    }
    drawLockIcon(p, x+w/2, y+h/2-12);
    let rlbl = sp ? RARITY_LABEL[sp.rarity] : '???';
    setFont(p, 9, 'bold'); p.textAlign(p.CENTER, p.CENTER); p.noStroke();
    p.fill(sp ? RARITY_COLOR[sp.rarity] : COL.txtLight);
    p.text(rlbl, x+w/2, y+h-18);
  }
}

function drawLockIcon(p, cx, cy) {
  // 자물쇠 몸통
  p.fill(COL.btnPurple); p.noStroke(); p.rect(cx-12, cy-2, 24, 20, 3);
  p.fill(COL.btnPurpleHi); p.noStroke(); p.rect(cx-10, cy, 20, 6, 2);
  // 자물쇠 고리
  p.noFill(); p.stroke(COL.btnPurple); p.strokeWeight(5);
  p.arc(cx, cy-2, 18, 18, p.PI, p.TWO_PI);
  p.noStroke();
  // 열쇠 구멍
  p.fill(COL.outline); p.ellipse(cx, cy+7, 6, 6);
  p.rect(cx-2, cy+9, 4, 6);
}

// ── 픽셀 장식 요소 ──
function drawPixelStar(p, cx, cy, col) {
  p.fill(col); p.noStroke();
  // 단순 픽셀 별 (십자 + 대각)
  p.rect(cx-6,cy-2,12,4); p.rect(cx-2,cy-6,4,12);
  p.rect(cx-4,cy-4,4,4); p.rect(cx,cy-4,4,4);
  p.rect(cx-4,cy,4,4);   p.rect(cx,cy,4,4);
}

function drawPixelHeart(p, cx, cy, col) {
  p.fill(col); p.noStroke();
  p.rect(cx-7,cy-4,4,4); p.rect(cx+3,cy-4,4,4);
  p.rect(cx-9,cy,4,4);   p.rect(cx+5,cy,4,4);
  p.rect(cx-7,cy,12,4);
  p.rect(cx-5,cy+4,10,4);
  p.rect(cx-3,cy+8,6,4);
  p.rect(cx-1,cy+12,2,4);
}

function wrap(p, str, x, y, lh) { str.split('\n').forEach((l,i)=>p.text(l,x,y+i*lh)); }

// ─── LOCALSTORAGE ─────────────────────────────────────────────────────────────
function loadSpiritData() {
  try {
    let raw = localStorage.getItem('kickboard_spirits_v2');
    if(!raw) return [];
    let arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}
function saveSpiritData() {
  localStorage.setItem('kickboard_spirits_v2', JSON.stringify(collectedIds));
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => new p5(sketch));