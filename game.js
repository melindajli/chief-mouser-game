'use strict';
window.addEventListener('error', e => console.log('GAME ERR:', e.message, 'line', e.lineno));
/* =========================================================
   LARRY — Chief Mouser to the Cabinet Office
   From Battersea to No. 10: a cosy top-down mouse-catching
   adventure through the real rooms of Downing Street.
   ========================================================= */

// ---------- Canvas & view ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let ZOOM = 3, VW = 0, VH = 0;

let DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1;
  // visualViewport tracks the real visible area on mobile (URL bars, keyboards)
  const vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  canvas.width = Math.round(vw * DPR);
  canvas.height = Math.round(vh * DPR);
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  // zoom in device pixels: integer, so fractional CSS zoom stays pixel-crisp
  ZOOM = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 240));
  VW = canvas.width / ZOOM;
  VH = canvas.height / ZOOM;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

const TILE = 16;
// one full day/night cycle, in seconds. The "Day N in office" counter is now
// tied to this (a real dawn = a new day) instead of ticking every few seconds.
const DAYLEN = 200;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// pick a random entry, never the same one twice in a row — repeated lines
// are the fastest way to break the writing's spell
const _lastPick = new WeakMap();
function pick(arr) {
  if (!arr || !arr.length) return undefined;
  if (arr.length === 1) return arr[0];
  const last = _lastPick.get(arr);
  let i;
  do { i = (Math.random() * arr.length) | 0; } while (i === last);
  _lastPick.set(arr, i);
  return arr[i];
}
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

/* =========================================================
   Pixel-art sprite builder — shapes, outline, rim shading
   ========================================================= */
function mkS(w, h) { return { w, h, a: Array.from({ length: h }, () => new Array(w).fill(null)) }; }
function sp(s, x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.a[y][x] = c; }
function srect(s, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sp(s, x + i, y + j, c); }
function sell(s, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const dx = rx * Math.sqrt(1 - dy * dy);
    for (let x = Math.round(cx - dx); x < Math.round(cx + dx); x++) sp(s, x, y, c);
  }
}
function soutline(s, c) {
  const add = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.a[y][x]) continue;
    const n = (s.a[y - 1] && s.a[y - 1][x]) || (s.a[y + 1] && s.a[y + 1][x]) || s.a[y][x - 1] || s.a[y][x + 1];
    if (n && n !== c) add.push([x, y]);
  }
  for (const [x, y] of add) s.a[y][x] = c;
}
function sshade(s, outlineC, shadeMap) {
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = s.a[y][x];
    if (!c || c === outlineC) continue;
    const below = s.a[y + 1] ? s.a[y + 1][x] : null;
    if (below === outlineC && shadeMap[c]) s.a[y][x] = shadeMap[c];
  }
}
function sCanvas(s) {
  const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const g = c.getContext('2d');
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.a[y][x]) { g.fillStyle = s.a[y][x]; g.fillRect(x, y, 1, 1); }
  }
  return c;
}

/* =========================================================
   Cat sprites — toffeecraft "Cat Pack" (free pack), with the
   main cat recoloured to the real Larry's coat: grey-brown
   tabby top, warm white paws/underside. Art embedded in
   sheets.js. Frames are 32x32.
   ========================================================= */
const CAT_IMGS = {};
let IMGS_LOADED = 0;
const IMG_KEYS = Object.keys(SHEETS_B64);
for (const k of IMG_KEYS) {
  const img = new Image();
  img.onload = () => { if (++IMGS_LOADED === IMG_KEYS.length) paintPackDecor(); };
  img.src = 'data:image/png;base64,' + SHEETS_B64[k];
  CAT_IMGS[k] = img;
}
// paint the room-pack furniture, rugs, paintings and plants into the
// pre-rendered map canvases once the atlas has decoded
function paintPackDecor() {
  const atlas = CAT_IMGS.decor;
  for (const id in MAPS) {
    const m = MAPS[id];
    const mc = m.canvas.getContext('2d');
    for (const it of (m.packItems || [])) {
      const [sx, sy, w, h] = DECOR_MAP[it.k];
      if (it.clear) {
        for (let ty = it.ty; ty < it.ty + it.fh; ty++) for (let tx = it.tx; tx < it.tx + it.fw; tx++) {
          mc.clearRect(tx * TILE, ty * TILE, TILE, TILE);
          const ch = m.grid[ty][tx];
          drawFloorBase(mc, m.grid, tx, ty, FLOORY(ch) ? (ch === 'f' || ch === 'a' ? 'g' : ch) : floorUnder(m.grid, tx, ty));
          if (ty > 0 && SOLID.has(m.grid[ty - 1][tx]) && m.grid[ty - 1][tx] !== 'T') {
            mc.fillStyle = 'rgba(10,8,6,0.25)'; mc.fillRect(tx * TILE, ty * TILE, TILE, 3);
            mc.fillStyle = 'rgba(10,8,6,0.12)'; mc.fillRect(tx * TILE, ty * TILE + 3, TILE, 2);
          }
        }
      }
      const dx = Math.round(it.tx * TILE + (it.fw * TILE - w) / 2);
      const dy = (it.ty + it.fh) * TILE - h;
      mc.drawImage(atlas, sx, sy, w, h, dx, dy, w, h);
    }
    for (const d of (m.decor || [])) {
      if (d.t !== 'painting') continue;
      const key = 'painting' + (1 + ((hash2(d.x * 5, d.y * 3) * 4) | 0));
      const [sx, sy, w, h] = DECOR_MAP[key];
      mc.drawImage(atlas, sx, sy, w, h, d.x * TILE, d.y * TILE, w, h);
    }
  }
  // the real Larry graces the title screen
  const tc = document.getElementById('titleCat');
  if (tc) {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(CAT_IMGS.larry, 0, 28 * 32, 32, 32, 0, 0, 96, 96);
    // the Union Jack bow tie, worn with enormous dignity even on the menu
    // (same pixels as drawBowTie('down') on the sit pose, at 3× scale)
    g.save();
    g.scale(3, 3);
    g.translate(15, 18);
    const t = TIES[0];
    g.fillStyle = t.wing; g.fillRect(-4, -2, 3, 3); g.fillRect(1, -2, 3, 3);
    g.fillStyle = t.accent; g.fillRect(-3, -1, 1, 1); g.fillRect(2, -1, 1, 1);
    g.fillStyle = t.knot; g.fillRect(-1, -2, 2, 3);
    g.restore();
    tc.textContent = '';
    tc.appendChild(c);
  }
}
// [strip row, frame count] per animation, from the pack's frame index
const CANIM = {
  standDown: [4, 1], standUp: [5, 1], standRight: [6, 1], standLeft: [7, 1],
  walkDown: [4, 4], walkUp: [5, 4], walkRight: [6, 8], walkLeft: [7, 8],
  sit: [28, 1], meow: [28, 3], yawn: [32, 8], wash: [36, 9],
  sleepL: [14, 2], sleep3: [16, 2],
  eat: [20, 8],
  scratchL: [39, 11], scratchR: [40, 11],
  hissL: [41, 2], hissR: [42, 2],
  pawDown: [44, 9], pawUp: [45, 5], pawLeft: [46, 7], pawRight: [47, 7],
  hind: [52, 4],
};
// per-pose baseline nudge so feet meet the shadow
const CAT_YOFF = { sleepL: 4, sleep3: 4, sit: 2, meow: 2, yawn: 2, wash: 2, eat: 1, hind: 2, walkRight: 2, walkLeft: 2, standRight: 2, standLeft: 2 };
function drawCat(img, anim, frame, x, y) {
  const a = CANIM[anim] || CANIM.sit;
  const f = ((frame | 0) % a[1] + a[1]) % a[1]; // wrap, don't clamp — walks must cycle
  ctx.drawImage(img, f * 32, a[0] * 32, 32, 32, Math.round(x) - 16, Math.round(y) - 20 + (CAT_YOFF[anim] || 0), 32, 32);
}
const C_OUT = '#241d16', C_MID = '#8d785c', C_DARK = '#5f4e3a';


// ---------- Points of interest: nap spots, books, art ----------
const TXT_NAP = [
  'You have a very important nap. The nation is safer for it.',
  'Twenty minutes of statecraft (asleep).',
  'You dream of an infinite Pantry.',
  'Someone will need this spot later. It is warm now. Theirs is a future problem.',
  'You assume the position of maximum authority: horizontal.',
  'The inbox can wait. The inbox is mice. The mice can wait.',
  'Eyes closed. Ears on. This is called "vigilance".',
  'A nap, minuted as "strategic review".',
];
const TXT_WAKE = [
  'Refreshed. Dangerous.', 'Awake. Allegedly.', 'You rise. The room adjusts.',
  'Back on duty. The nation exhales.', 'You stretch. Somewhere, a mouse shudders.',
  'Consciousness resumes, on your terms.', 'Rebooted. Fully patched.',
];
// the rotating fact file: real Larry, lightly minuted. Revisited secrets
// draw from this pool instead of repeating themselves.
const LARRY_FACTS = [
  'Larry fact: recruited from Battersea in 2011 — the only member of government hired strictly on merit.',
  'Larry fact: the first cat to hold the OFFICIAL title Chief Mouser to the Cabinet Office. The capitals matter.',
  'Larry fact: he is employed by the Cabinet Office, not the Prime Minister. Elections change nothing. For him.',
  'Larry fact: he has outlasted six Prime Ministers and counting. None of them saw it coming. He did.',
  'Larry fact: in 2019 he napped under a visiting president\'s armoured limousine and simply declined to move. The motorcade waited.',
  'Larry fact: President Obama petted him in 2016. Larry permitted it. History records who approached whom.',
  'Larry fact: the famous front door has no outside handle — Larry stares at it until a human opens it. The system works.',
  'Larry fact: his 2016 scuffle with Palmerston of the Foreign Office cost him his collar. The Foreign Office denies everything.',
  'Larry fact: officially born in 2007. Beyond that, his age is a matter of national security.',
  'Larry fact: once slept through a mouse walking directly past him during a live broadcast. Described by aides as "a choice".',
  'Larry fact: Battersea listed him as a stray with "a strong predatory drive". The understatement of the century.',
  'Larry fact: his Wikipedia page is longer than most ministers\'. It is also more accurate.',
  'Larry fact: Downing Street once issued an official statement that he was "doing fine" after tabloid concern. The tabloids apologised to HIM.',
  'Larry fact: tourists photograph the window radiator daily hoping to see him. He knows. He poses. Occasionally.',
];
const TXT_BOWL = [
  'Chicken. Again. You register a formal complaint by knocking the bowl over.',
  'You eat precisely half, to preserve the mystery.',
  'Acceptable. You knock one biscuit under the counter for later. Statecraft.',
  'You inspect the bowl from four angles before committing. Due diligence.',
  'Fish-shaped biscuits. The shape does not fool you. You eat them anyway.',
  'You eat with the quiet confidence of someone whose food is hand-delivered by the Crown.',
];
const TXT_BOOKS = [
  '"The Subtle Art of Sitting on Keyboards" — a classic.',
  '"A History of the Door of No. 10", 400 pages. You nap on it briefly. Absorbed.',
  'Hansard, Vol. 402. You shred one corner. Improved it.',
  '"Diplomacy for Beginners". Someone underlined "never blink first". Amateurs.',
  'A first edition, spine cracked to exactly the width of one cat. Fate.',
  'You knock a bookmark from its page. A historian will one day be baffled. Good.',
];
const TXT_PAINTING = [
  'A landscape. You could catch that painted duck. Easily.',
  'A statesman on a horse. The horse looks the more sensible of the two.',
  'Priceless, apparently. It does not move. Boring.',
  'You consider the brushwork. You consider scratching it. You rise above.',
  'The eyes follow you around the room. You have decided you are flattered.',
  'A stern old face in oils. You hold its gaze until it, metaphorically, looks away.',
];
const TXT_CLOCK = [
  'The pendulum swings. You could stop it. You are CHOOSING not to. For now.',
  'Tick. Tock. It taunts you. It has taunted cats since 1735.',
  'You have synchronised your naps to its chimes. Precision statecraft.',
  'A grandfather clock. You never met the grandfather. You assume he was tall.',
  'It strikes the hour; you strike a pose. Between you, the nation runs on time.',
];
const TXT_FIRE = [
  'Warm. Approved. You allocate it two more minutes of your schedule.',
  'You stare into the flames like a tiny furry chancellor weighing a budget.',
  'The best seat in the building, and entirely unelected. As are you.',
  'You claim the hearth-rug. Possession is nine-tenths; you supply the tenth by lying on it.',
  'A log settles with a crack. You do not flinch. You considered it, then declined.',
];
const TXT_POND = [
  'You watch the fish. The fish watch you. Stalemate.',
  'The koi files a complaint about surveillance. Noted. Ignored.',
  'You dip one paw. The water is cold, the fish are smug. This is not over.',
  'Reflections of clouds — and one enormous, patient face. Yours.',
  'The goldfish have a name for you. It is not a kind one. You wear it with pride.',
];
const TXT_POSTER = [
  '"ADOPT ME" — your old poster. You keep it up. For the brand.',
  'A kitten poster reading HANG IN THERE. You did.',
  'Battersea, your alma mater. You do not do reunions. You send the odd postcard.',
  'Small print at the foot: "good with children, cameras, and heads of state".',
];
const TXT_TOWER = [
  'You ascend the tower. You survey your domain. All of it. Yours.',
  'High ground acquired. The mice below scatter, wisely.',
  'From up here you can see the Foreign Office. You choose not to.',
  'The summit. You plant no flag; your presence is the flag.',
  'You gaze down upon the room and everyone in it. Literally. For now, only literally.',
];
const TXT_BOX = [
  'If it fits, you sits. It fits. Governance can wait.',
  'The box arrived containing important documents. It now contains you. An upgrade.',
  'Cardboard: the only honest furniture in this building.',
  'A box precisely one size too small. You are undeterred. You are mostly in.',
  'They will search for the box for weeks. It was always going to end this way.',
];
const TXT_SCRATCH = [
  'You maintain the claws. The post absorbs the policy disagreements.',
  'Scratch. Scratch. Scratch. The Treasury can hear it. Good.',
  'Claw maintenance complete. Threat level: restored.',
  'You leave your mark, as every great figure must — only sharper.',
  'The post has served faithfully. You reward it with further destruction.',
];
const TXT_WINDOW = [
  'You watch Whitehall from the window seat. Pedestrians. Pigeons. Politics.',
  'Sun patch located. Occupied. Bliss.',
  'A tourist waves at you. You permit it.',
  'A pigeon lands on the sill, sees you, and files a flight plan elsewhere.',
  'Someone important hurries past with a folder. You blink at them, slowly. They needed that.',
  'The glass is cool. The seat is warm. The arrangement is permanent.',
];
const TXT_RADIATOR = [
  'THE radiator. THE window. Tourists outside take four thousand photos a day of exactly this spot.',
  'Warm metal, world view, plausible deniability. The perfect office.',
  'From here you can see everyone who matters arrive. They cannot see whether you are awake. Power.',
  'A camera flash from the street. You do not move. Legends do not fidget.',
  'The radiator gurgles. You gurgle back, internally. An understanding.',
  'Heat below, empire beyond, nothing required of you. This is the job.',
];
const TXT_PIANO = [
  'You walk across the keys. Chopin, ruined. Improved.',
  'The piano tuner has asked that you stop. The piano tuner is not in charge here.',
  'A slow, deliberate stroll up the octaves. The critics are calling it "brave".',
  'You sit upon middle C. The most important note. It is now yours.',
];
const TXT_LECTERN = [
  'A new lectern appears outside every few months. You have personally inspected every single one. With claws.',
  'Someone practises a very serious speech at this thing quarterly. You assist by sitting exactly where the cameras point.',
  'The wood smells of nerves and furniture polish. You approve of one of these.',
  'You rest your chin upon it, gravely. The photograph will be filed under "statesmanlike".',
];
const TXT_LETTERBOX = [
  'The letterbox rattles. You stare at it, unblinking, for forty minutes. This is called "security".',
  'Post arrives. None of it addressed to you. An oversight, surely. You sit on it until claimed.',
  'A hand pushes an envelope through. You are ready. You are ALWAYS ready.',
  'The famous brass flap. Cold to the nose. You boop it anyway. For morale.',
];
const TXT_UMBRELLA = [
  "Four abandoned umbrellas. Westminster's true national archive.",
  'It will rain. It always rains. The umbrellas know.',
  'You inspect the umbrella stand. It inspects you back. A draw.',
  'One is still faintly damp. You avoid it with the disdain of a professional.',
];
const TXT_DOORSTEP = [
  'The most famous doorstep in the country. You sit upon it as though it were built for you. It was.',
  'You settle on the step. Across the road, thirty cameras rise as one. You do not smile. You never smile. It only makes them keener.',
  'The black door behind you, the world in front. You hold the pose. The nation, briefly, feels reassured.',
  'A tour guide points you out. Forty phones turn. You gaze into the middle distance, historically.',
  'Warm stone, cold morning, flashing bulbs. You have decided this step is, technically, your porch.',
];
const TXT_PORTER = [
  "The hooded guard's chair. Chippendale built it so the watchman outside wouldn't freeze — there's a drawer beneath for hot coals. You have claimed the seat, the hood, and the general principle of warmth.",
  'A leather sentry-box on legs. The constable it was built for is two centuries gone; you have inherited the post, the hood, and the naps.',
  'The hood keeps the draught off. You keep the hood. A fair division of the Entrance Hall.',
  'Two hundred years of doormen sat here against the London cold. None of them curled up in it quite this well.',
];
const TXT_DOOR11 = [
  'An ordinary door in an extraordinary wall: the far side is No. 11. Very few are permitted through it. You are permitted through it in both directions, and use the privilege daily.',
  'The connecting door — two of the most famous addresses in Britain joined by a bit of green baize and a draught. You patrol both sides.',
  'Number Ten this side, Number Eleven that side, one cat straddling the entire constitutional arrangement. Nobody has thought to stop you.',
  'The Chancellor keeps the smaller flat, over No. 10. The Prime Minister takes the bigger one, over No. 11. You take whichever radiator is warmer.',
];
const TXT_TELLY = [
  "The television murmurs the rolling news. Your face appears on it more often than most Cabinet ministers'. You do not watch it. You ARE the content.",
  'Somewhere on this channel a serious man is discussing you gravely. You wash a paw.',
  'The remote has gone under the sofa cushion. It will stay there. This is now a cat decision.',
];
const TXT_FLATKITCHEN = [
  "The flat's little kitchen, where Prime Ministers cook their own suppers and call it unwinding. You supervise from the counter — uninvited, essential.",
  'Not the grand basement kitchen — the family one. A kettle, a hob, a PM in an apron looking briefly human. You permit it.',
  'The famous "kitchen suppers" happen at this table: deals done over pasta. You are always, always under it.',
];
const TXT_FLATWINDOW = [
  'From up here you can see the whole garden and half of Whitehall. The pigeons look smaller from above. Everything does.',
  'The residence window. Off-duty, unofficial, entirely yours. Even Chief Mousers go home; yours is up the stairs.',
];

function buildMouse(body, belly) {
  const s = mkS(14, 10);
  sell(s, 6.5, 6, 4.6, 3.0, body);
  sell(s, 10.5, 5, 2.8, 2.4, body);
  sell(s, 9, 2.6, 1.5, 1.5, '#d78f92'); sell(s, 12, 2.8, 1.3, 1.3, '#d78f92');
  sell(s, 6.5, 7, 2.6, 1.5, belly);
  sp(s, 11, 4, '#2a2522'); sp(s, 13, 5, '#d78f92');
  soutline(s, '#2a2522'); sshade(s, '#2a2522', { [body]: '#948e86' });
  return sCanvas(s);
}
function buildRat() {
  const s = mkS(19, 13);
  sell(s, 8, 8, 6.4, 4.0, '#8a7f74');
  sell(s, 14, 6.5, 3.6, 3.0, '#8a7f74');
  sell(s, 12, 2.8, 1.8, 1.8, '#c9838a'); sell(s, 16, 3.2, 1.6, 1.6, '#c9838a');
  sell(s, 8, 9.5, 3.6, 2.0, '#a89d90');
  sp(s, 15, 5, '#2a2522'); sp(s, 18, 6, '#c9838a');
  srect(s, 5, 5, 1, 3, '#6e645a'); srect(s, 9, 5, 1, 3, '#6e645a'); // mangy stripes
  soutline(s, '#241f1c'); sshade(s, '#241f1c', { '#8a7f74': '#6e645a' });
  return sCanvas(s);
}
const MOUSE_SPRITES = {
  grey: buildMouse('#b4aea6', '#d8d3ca'),
  swift: buildMouse('#c09a6a', '#e6d2ae'),
  trick: buildMouse('#77716d', '#a39d98'),
  still: buildMouse('#9aa2ad', '#c3c9d2'),
  decoy: buildMouse('#c8a84e', '#ead9a2'),
  raider: buildMouse('#8a6f52', '#b09877'),
  rat: buildRat(),
};
const MOUSE = MOUSE_SPRITES.grey; // gallery convenience
// speed/xp multipliers; hp>1 means it shrugs off the first pounce.
// Each late archetype teaches a read: the trickster jukes CHARGED leaps
// (tap instead), the Very Still Mouse hides in plain sight (monocle/sonar),
// the raiding pair punishes chasing the loud one (take the cheese-carrier).
const MOUSE_TYPES = {
  grey: { spd: 1, xp: 1, hp: 1 },
  swift: { spd: 1.4, xp: 1.6, hp: 1 },
  trick: { spd: 1.1, xp: 2, hp: 1, dodge: true },
  still: { spd: 1.5, xp: 2.2, hp: 1, freeze: true },
  decoy: { spd: 0.95, xp: 0.6, hp: 1 },
  raider: { spd: 1.08, xp: 2.4, hp: 1, carry: true },
  rat: { spd: 0.82, xp: 3, hp: 2 },
  ratking: { spd: 1.02, xp: 7, hp: 3 },
};

function buildPerson(suit, hat) {
  const s = mkS(16, 24);
  const skin = '#e2b69b', hair = '#4a3a2b', suitD = '#00000033';
  sell(s, 8, 13.5, 4.8, 5.2, suit);                                        // torso
  srect(s, 7, 10, 2, 4, '#f2efe8'); srect(s, 8, 10, 1, 3, '#a33636');      // shirt & tie
  sell(s, 8, 5.5, 3.6, 4.0, skin);                                         // head
  if (hat === 'chef') { srect(s, 5, 0, 7, 3, '#f4f1ea'); srect(s, 4, 3, 9, 1, '#e2ded2'); }
  else if (hat === 'police') { sell(s, 8, 2.4, 3.4, 2.6, '#22252e'); srect(s, 7, 3, 3, 1, '#c9a227'); }
  else sell(s, 8, 3.2, 3.9, 2.4, hair);
  srect(s, 5, 18, 3, 4, suit); srect(s, 9, 18, 3, 4, suit);                // legs
  srect(s, 5, 22, 3, 1, '#1b1d24'); srect(s, 9, 22, 3, 1, '#1b1d24');      // shoes
  soutline(s, '#20202a'); sshade(s, '#20202a', { [suit]: suit + '' });
  void suitD;
  return sCanvas(s);
}
const P_VISITOR = buildPerson('#5a5f6b'), P_GUARD = buildPerson('#2b2f3a', 'police'),
  P_AIDE = buildPerson('#4a5568'), P_CHEF = buildPerson('#c9c5ba', 'chef'),
  P_BUTLER = buildPerson('#23242a'), P_GARDENER = buildPerson('#4e6b3c'),
  P_WORKER = buildPerson('#5c86a0'), P_PRESS = buildPerson('#8a7a5c');
// the Cabinet, for when it is in session: an assortment of serious suits
const P_MIN1 = buildPerson('#3d4a63'), P_MIN2 = buildPerson('#54443c'), P_MIN3 = buildPerson('#425562');
// seats round the boat table (ground map): four up the far side, three near
const CABINET_SEATS = [
  [30.5, 12.75, P_MIN1, false], [33.5, 12.75, P_MIN2, true], [36.5, 12.75, P_VISITOR, false], [39.5, 12.75, P_MIN3, true],
  [31.5, 16.55, P_MIN2, true], [35.5, 16.55, P_AIDE, false], [38.5, 16.55, P_MIN1, true],
];
const MINISTER_LINES = [
  'Order. The cat has the floor.',
  'Minute that: a cat entered. Uninvited. Correctly.',
  'The Chief Mouser dissents.',
  'Item four: the cat. Item five: also the cat.',
  'He\'s sitting on the agenda. Again.',
  'Let the record show he looked at the Chancellor first.',
  'Can someone move the biscuits UP the table.',
];
// the Cabinet sits in daylight, in the career, once you actually live here
function cabinetInSession(dark) {
  return G.mapId === 'ground' && !G.daily && G.intro.phase === 'done' && dark < 0.4;
}

function buildCanopy() {
  const s = mkS(26, 20);
  sell(s, 13, 12, 12, 7, '#2f5426');
  sell(s, 9, 8, 7, 5.5, '#3d6a30');
  sell(s, 17, 7.5, 7, 5, '#3d6a30');
  sell(s, 13, 5.5, 6, 4, '#4f8140');
  sell(s, 10, 4.5, 3, 2, '#5d9350');
  soutline(s, '#22391c'); sshade(s, '#22391c', { '#2f5426': '#25431e' });
  return sCanvas(s);
}
const TREE_CANOPY = buildCanopy();

/* =========================================================
   Tile rendering — richer, Pokémon-style depth
   ========================================================= */
const SOLID = new Set(['#', 'w', 'D', 'T', 'K', 'S', 'G', 'p', 'h', 'P', 'C', 'q', 'Y', 'E', 'J', 'M']);
const FLOORY = ch => !SOLID.has(ch);

function drawFloorBase(mc, grid, x, y, ch) {
  const px = x * TILE, py = y * TILE, h = hash2(x, y);
  if (ch === 'c') { // marble checkerboard
    const light = (x + y) % 2;
    mc.fillStyle = light ? '#ece5d2' : '#26221e';
    mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = light ? '#ddd5bf' : '#312c27';
    if (h > 0.4) mc.fillRect(px + ((h * 10) | 0), py + ((h * 13) | 0) % 12 + 2, 4, 1);
    if (h > 0.7) mc.fillRect(px + ((h * 5) | 0) + 6, py + ((h * 7) | 0), 3, 1);
    mc.fillStyle = 'rgba(0,0,0,0.08)'; mc.fillRect(px, py + TILE - 1, TILE, 1);
  } else if (ch === 't') {
    mc.fillStyle = '#c9c1b2'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#b3aa99'; mc.fillRect(px + TILE - 1, py, 1, TILE); mc.fillRect(px, py + TILE - 1, TILE, 1);
    mc.fillStyle = '#d4ccbe'; mc.fillRect(px, py, TILE - 1, 1);
    if (h > 0.85) { mc.fillStyle = '#bdb4a4'; mc.fillRect(px + 3, py + 3, 4, 4); }
  } else if (ch === 'v') { // red runner carpet with gold trim at its edges
    mc.fillStyle = '#8d2f35'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = (x + y) % 2 ? '#87292f' : '#93353b';
    for (let i = 0; i < 3; i++) mc.fillRect(px + ((hash2(x + i, y) * 13) | 0), py + ((hash2(y + i, x) * 13) | 0), 2, 2);
    const edge = (dx, dy) => { const yy = y + dy, xx = x + dx; return !(grid[yy] && grid[yy][xx] === 'v'); };
    mc.fillStyle = '#c9a227';
    if (edge(0, -1)) mc.fillRect(px, py + 1, TILE, 1);
    if (edge(0, 1)) mc.fillRect(px, py + TILE - 2, TILE, 1);
    if (edge(-1, 0)) mc.fillRect(px + 1, py, 1, TILE);
    if (edge(1, 0)) mc.fillRect(px + TILE - 2, py, 1, TILE);
  } else if (ch === 'y') { // the Grand Staircase runner: soft golden yellow with a deeper-gold border
    mc.fillStyle = '#c9a23a'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = (x + y) % 2 ? '#c39a30' : '#cfa943';
    for (let i = 0; i < 3; i++) mc.fillRect(px + ((hash2(x + i, y) * 13) | 0), py + ((hash2(y + i, x) * 13) | 0), 2, 2);
    const edgeY = (dx, dy) => { const yy = y + dy, xx = x + dx; return !(grid[yy] && grid[yy][xx] === 'y'); };
    mc.fillStyle = '#8a6a18';
    if (edgeY(0, -1)) mc.fillRect(px, py + 1, TILE, 1);
    if (edgeY(0, 1)) mc.fillRect(px, py + TILE - 2, TILE, 1);
    if (edgeY(-1, 0)) mc.fillRect(px + 1, py, 1, TILE);
    if (edgeY(1, 0)) mc.fillRect(px + TILE - 2, py, 1, TILE);
  } else if (ch === 'g' || ch === 'f' || ch === 'a') {
    // dithered grass
    mc.fillStyle = '#5e9c4e'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#569147';
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if ((i + j) % 2) mc.fillRect(px + i * 2, py + j * 2, 2, 2);
    if (h > 0.78) { // grass tuft
      mc.fillStyle = '#4a7f3c';
      const tx = px + ((h * 11) | 0) + 2, ty = py + (((h * 7) | 0) % 10) + 3;
      mc.fillRect(tx, ty, 1, 3); mc.fillRect(tx + 2, ty + 1, 1, 2); mc.fillRect(tx - 2, ty + 1, 1, 2);
    }
    if (ch === 'a') { // stone garden path
      mc.fillStyle = '#c3bba8'; mc.fillRect(px + 1, py + 1, 14, 14);
      mc.fillStyle = '#b1a894'; mc.fillRect(px + 1, py + 13, 14, 2); mc.fillRect(px + 8, py + 1, 1, 12);
      mc.fillStyle = '#cfc8b6'; mc.fillRect(px + 1, py + 1, 14, 2);
    }
    if (ch === 'f') {
      const fx = px + 4 + ((h * 6) | 0), fy = py + 4 + (((h * 9) | 0) % 6);
      mc.fillStyle = h > 0.5 ? '#f0ece2' : '#e08597';
      mc.fillRect(fx - 2, fy, 2, 2); mc.fillRect(fx + 2, fy, 2, 2); mc.fillRect(fx, fy - 2, 2, 2); mc.fillRect(fx, fy + 2, 2, 2);
      mc.fillStyle = '#e9c46a'; mc.fillRect(fx, fy, 2, 2);
      mc.fillStyle = '#4a7f3c'; mc.fillRect(fx + 1, fy + 4, 1, 3);
    }
  } else if (ch === 'k') { // Downing Street pavement: grey flagstones
    mc.fillStyle = '#8f8b83'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#7c7870';
    mc.fillRect(px, py + TILE - 1, TILE, 1); mc.fillRect(px + TILE - 1, py, 1, TILE);
    if (((x + y) % 2)) mc.fillRect(px, py + 7, TILE, 1);
    mc.fillStyle = '#9c988f'; mc.fillRect(px, py, TILE, 1);
    if (h > 0.88) { mc.fillStyle = '#84807897'; mc.fillRect(px + 4, py + 5, 3, 2); }
  } else if (ch === 'z') { // the tarmac road
    mc.fillStyle = '#3b3a40'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#343339';
    for (let i = 0; i < 5; i++) mc.fillRect(px + ((hash2(x + i, y) * 15) | 0), py + ((hash2(y, x + i) * 15) | 0), 1, 1);
    mc.fillStyle = 'rgba(255,255,255,0.03)'; mc.fillRect(px, py, TILE, 1);
  } else { // wood
    const shade = 0.92 + hash2(x, 0) * 0.16;
    const r = (166 * shade) | 0, g2 = (117 * shade) | 0, b = (69 * shade) | 0;
    mc.fillStyle = `rgb(${r},${g2},${b})`;
    mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = 'rgba(60,35,15,0.35)';
    mc.fillRect(px, py + 4, TILE, 1); mc.fillRect(px, py + 9, TILE, 1); mc.fillRect(px, py + 14, TILE, 1);
    if (h > 0.72) mc.fillRect(px + ((h * 14) | 0), py + (h > 0.86 ? 0 : 10), 1, 4);
    if (h > 0.93) { mc.fillStyle = 'rgba(60,35,15,0.5)'; mc.fillRect(px + 6, py + 6, 2, 2); } // knot
    mc.fillStyle = 'rgba(255,240,210,0.09)'; mc.fillRect(px, py, TILE, 1);
  }
}

function floorUnder(grid, x, y) {
  const n = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of n) {
    const yy = y + dy, xx = x + dx;
    if (yy >= 0 && xx >= 0 && yy < grid.length && xx < grid[0].length && FLOORY(grid[yy][xx])) {
      const c = grid[yy][xx];
      return c === 'f' || c === 'a' ? 'g' : (c === 'U' || c === 'B' || c === 'b' || c === 'r') ? '.' : c;
    }
  }
  return '.';
}

function wallStyle(grid, x, y, mapId) {
  if (mapId === 'shelter') return 'block';
  if (mapId === 'street') return 'georgian';
  if (mapId === 'basement') return 'stone';
  if (mapId === 'ground') {
    if (y >= 34) return 'brick';
    const n = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of n) {
      const yy = y + dy, xx = x + dx;
      const c = grid[yy] && grid[yy][xx];
      if (c === 'g' || c === 'f' || c === 'q' || c === 'a' || c === 'G' || c === 'Y') return 'brick';
    }
    return 'panel';
  }
  return 'panel';
}

function drawWall(mc, grid, x, y, mapId) {
  const px = x * TILE, py = y * TILE;
  const frontFacing = grid[y + 1] && FLOORY(grid[y + 1][x]);
  const style = wallStyle(grid, x, y, mapId);
  if (!frontFacing) { // wall cap
    if (style === 'georgian') { // façade: keep the black brick running the full height
      mc.fillStyle = '#1e1c21'; mc.fillRect(px, py, TILE, TILE);
      mc.fillStyle = '#161418';
      for (let r = 0; r < 4; r++) { mc.fillRect(px, py + r * 4 + 3, TILE, 1); mc.fillRect(px + ((r % 2) ? 4 : 11), py + r * 4, 1, 3); }
      return;
    }
    mc.fillStyle = style === 'brick' ? '#26232a' : '#3b352d';
    mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = 'rgba(255,255,255,0.04)';
    mc.fillRect(px, py + ((x + y) % 2 ? 5 : 11), TILE, 1);
    return;
  }
  if (style === 'brick') {
    mc.fillStyle = '#3a363e'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#2c2931';
    for (let r = 0; r < 4; r++) {
      mc.fillRect(px, py + r * 4 + 3, TILE, 1);
      mc.fillRect(px + ((r % 2) ? 4 : 10), py + r * 4, 1, 3);
    }
    mc.fillStyle = 'rgba(255,255,255,0.06)'; mc.fillRect(px, py, TILE, 1);
  } else if (style === 'georgian') { // the famous black-painted brick of No. 10
    mc.fillStyle = '#211f24'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#181619';
    for (let r = 0; r < 4; r++) {
      mc.fillRect(px, py + r * 4 + 3, TILE, 1);            // mortar courses
      mc.fillRect(px + ((r % 2) ? 4 : 11), py + r * 4, 1, 3); // staggered joints
    }
    mc.fillStyle = 'rgba(255,255,255,0.05)'; mc.fillRect(px, py, TILE, 1);
    mc.fillStyle = 'rgba(0,0,0,0.25)'; mc.fillRect(px, py + TILE - 1, TILE, 1);
  } else if (style === 'stone') {
    mc.fillStyle = '#8f887c'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#7b7468';
    mc.fillRect(px, py + 5, TILE, 1); mc.fillRect(px, py + 11, TILE, 1);
    mc.fillRect(px + 5, py, 1, 5); mc.fillRect(px + 11, py + 6, 1, 5); mc.fillRect(px + 3, py + 12, 1, 4);
    mc.fillStyle = '#9c9588'; mc.fillRect(px, py, TILE, 1);
  } else if (style === 'block') {
    mc.fillStyle = '#c2cbc5'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#aab4ad';
    mc.fillRect(px, py + 7, TILE, 1); mc.fillRect(px + 7, py, 1, 7); mc.fillRect(px + 3, py + 8, 1, 8);
    mc.fillStyle = '#8f9a93'; mc.fillRect(px, py + 14, TILE, 2);
  } else { // No. 10 interior: cream walls over timber wainscot
    mc.fillStyle = '#e8dcbb'; mc.fillRect(px, py, TILE, 10);
    mc.fillStyle = '#dfd2ad'; mc.fillRect(px, py + 8, TILE, 2);
    mc.fillStyle = '#f2e8cd'; mc.fillRect(px, py, TILE, 1);
    mc.fillStyle = '#9c7b52'; mc.fillRect(px, py + 10, TILE, 6);
    mc.fillStyle = '#7c5f3c'; mc.fillRect(px, py + 10, TILE, 1); mc.fillRect(px + 7, py + 11, 1, 5);
    mc.fillStyle = '#ac8a5e'; mc.fillRect(px + 2, py + 12, 4, 3); mc.fillRect(px + 10, py + 12, 4, 3);
  }
}

function drawTile(mc, grid, x, y, mapId) {
  const ch = grid[y][x];
  const px = x * TILE, py = y * TILE;
  if (ch === 'U' || ch === 'B') {
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    for (let i = 0; i < 4; i++) {
      const sh = ch === 'U' ? 40 + i * 14 : 82 - i * 14;
      mc.fillStyle = `rgb(${sh + 60},${sh + 30},${sh})`;
      mc.fillRect(px + 1, py + 1 + i * 4, 14, 4);
      mc.fillStyle = 'rgba(0,0,0,0.3)'; mc.fillRect(px + 1, py + 4 + i * 4, 14, 1);
    }
    mc.fillStyle = '#ffe8b8';
    const ay = ch === 'U' ? py + 4 : py + 8;
    mc.fillRect(px + 7, ay, 2, 5);
    if (ch === 'U') { mc.fillRect(px + 6, ay + 1, 4, 1); mc.fillRect(px + 5, ay + 2, 1, 1); mc.fillRect(px + 10, ay + 2, 1, 1); }
    else { mc.fillRect(px + 6, ay + 3, 4, 1); mc.fillRect(px + 5, ay + 2, 1, 1); mc.fillRect(px + 10, ay + 2, 1, 1); }
    return;
  }
  if (ch === 'b') {
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#3f6fae'; mc.fillRect(px + 4, py + 8, 8, 4);
    mc.fillStyle = '#335c91'; mc.fillRect(px + 4, py + 11, 8, 1);
    mc.fillStyle = '#6b4a2f'; mc.fillRect(px + 5, py + 8, 6, 2);
    return;
  }
  if (ch === 'r') {
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#a22525'; mc.fillRect(px + 1, py + 4, 14, 10);
    mc.fillStyle = '#c73a3a'; mc.fillRect(px + 1, py + 4, 14, 3);
    mc.fillStyle = '#e9c46a'; mc.fillRect(px + 1, py + 8, 14, 1);
    mc.fillStyle = '#f0e3c0'; mc.fillRect(px + 3, py + 5, 10, 4);
    mc.fillStyle = '#7c1c1c'; mc.fillRect(px + 1, py + 13, 14, 1);
    return;
  }
  if (ch === 'E') { // cat tree
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#c9b28a'; mc.fillRect(px + 6, py + 5, 4, 10);      // sisal post
    mc.fillStyle = '#b09a72';
    for (let i = 6; i < 15; i += 2) mc.fillRect(px + 6, py + i, 4, 1);
    mc.fillStyle = '#8a6f4d'; mc.fillRect(px + 2, py + 13, 12, 3);     // base
    mc.fillStyle = '#9c7b52'; mc.fillRect(px + 2, py + 13, 12, 1);
    mc.fillStyle = '#7a5a3a'; mc.fillRect(px + 1, py + 1, 14, 5);      // platform
    mc.fillStyle = '#a22525'; mc.fillRect(px + 2, py + 1, 12, 3);      // cushion top
    mc.fillStyle = '#c73a3a'; mc.fillRect(px + 2, py + 1, 12, 1);
    return;
  }
  if (ch === 'J') { // scratching post
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#8a6f4d'; mc.fillRect(px + 3, py + 12, 10, 3);
    mc.fillStyle = '#c9b28a'; mc.fillRect(px + 6, py + 2, 4, 11);
    mc.fillStyle = '#b09a72';
    for (let i = 3; i < 12; i += 2) mc.fillRect(px + 6, py + i, 4, 1);
    mc.fillStyle = '#e0cfa4'; mc.fillRect(px + 6, py + 2, 4, 1);
    mc.fillStyle = '#77624a'; mc.fillRect(px + 5, py + 6, 1, 3); mc.fillRect(px + 10, py + 8, 1, 3); // claw marks
    return;
  }
  if (ch === 'R') { // the famous radiator
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#ddd6c8'; mc.fillRect(px + 1, py + 3, 14, 10);
    mc.fillStyle = '#c2bbac';
    for (let i = 2; i < 15; i += 3) mc.fillRect(px + i, py + 4, 1, 8);
    mc.fillStyle = '#ece6da'; mc.fillRect(px + 1, py + 3, 14, 1);
    mc.fillStyle = '#8a8478'; mc.fillRect(px + 1, py + 12, 14, 1);
    mc.fillStyle = '#6e6a60'; mc.fillRect(px + 2, py + 13, 2, 2); mc.fillRect(px + 12, py + 13, 2, 2);
    return;
  }
  if (ch === 'u') { // window-seat cushion
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 2, py + 5, 12, 8);
    mc.fillStyle = '#e9c46a'; mc.fillRect(px + 3, py + 6, 10, 5);
    mc.fillStyle = '#a5831f'; mc.fillRect(px + 2, py + 12, 12, 1);
    mc.fillStyle = '#8a6c14'; mc.fillRect(px + 7, py + 8, 2, 2); // button
    return;
  }
  if (ch === 'M') { // grand-ish piano
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    const left = x + 1 < grid[0].length && grid[y][x + 1] === 'M';
    mc.fillStyle = '#1c1a20'; mc.fillRect(px + (left ? 1 : 0), py + 1, left ? 15 : 15, 10);
    mc.fillStyle = '#2e2b36'; mc.fillRect(px + (left ? 2 : 0), py + 2, left ? 13 : 13, 2);
    mc.fillStyle = '#f0ece0'; mc.fillRect(px + (left ? 1 : 0), py + 11, 15, 3);
    mc.fillStyle = '#1c1a20';
    for (let i = 2; i < 15; i += 2) mc.fillRect(px + i, py + 11, 1, 2);
    mc.fillStyle = '#0f0e13'; mc.fillRect(px + (left ? 1 : 0), py + 14, 15, 1);
    return;
  }
  if (ch === 'X') { // cardboard box, open top
    drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
    mc.fillStyle = '#b08a55'; mc.fillRect(px + 2, py + 4, 12, 10);
    mc.fillStyle = '#6e5433'; mc.fillRect(px + 3, py + 5, 10, 5);      // dark interior
    mc.fillStyle = '#c9a26a'; mc.fillRect(px + 1, py + 3, 5, 2); mc.fillRect(px + 10, py + 3, 5, 2); // flaps
    mc.fillStyle = '#8a6f42'; mc.fillRect(px + 2, py + 13, 12, 1);
    return;
  }
  if (ch === 'q') { // pond water with grassy banks
    mc.fillStyle = '#4a7fb5'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#4374a8';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((i + j) % 2) mc.fillRect(px + i * 4, py + j * 4, 4, 4);
    const edge = (dx, dy) => { const yy = y + dy, xx = x + dx; return grid[yy] && grid[yy][xx] !== 'q'; };
    if (edge(0, -1)) { mc.fillStyle = '#3d6a30'; mc.fillRect(px, py, TILE, 2); mc.fillStyle = '#2d4d55'; mc.fillRect(px, py + 2, TILE, 2); }
    if (edge(-1, 0)) { mc.fillStyle = '#3d6a30'; mc.fillRect(px, py, 2, TILE); mc.fillStyle = '#2d4d55'; mc.fillRect(px + 2, py, 2, TILE); }
    if (edge(1, 0)) { mc.fillStyle = '#3d6a30'; mc.fillRect(px + 14, py, 2, TILE); mc.fillStyle = '#2d4d55'; mc.fillRect(px + 12, py, 2, TILE); }
    if (edge(0, 1)) { mc.fillStyle = '#3d6a30'; mc.fillRect(px, py + 14, TILE, 2); mc.fillStyle = '#6b9fce'; mc.fillRect(px, py + 12, TILE, 2); }
    const h = hash2(x, y);
    if (h > 0.6 && !edge(0, -1) && !edge(-1, 0)) { // lily pad
      mc.fillStyle = '#4f8140'; mc.fillRect(px + 4, py + 5, 6, 4);
      mc.fillStyle = '#5d9350'; mc.fillRect(px + 4, py + 5, 6, 2);
      mc.fillStyle = '#4a7fb5'; mc.fillRect(px + 8, py + 6, 2, 2);
      if (h > 0.85) { mc.fillStyle = '#e8b4c4'; mc.fillRect(px + 5, py + 3, 3, 3); mc.fillStyle = '#f0d0da'; mc.fillRect(px + 6, py + 4, 1, 1); }
    }
    return;
  }
  if (ch === 'Y') { // tree trunk (canopy drawn above entities)
    drawFloorBase(mc, grid, x, y, 'g');
    mc.fillStyle = '#5c4126'; mc.fillRect(px + 5, py + 4, 6, 11);
    mc.fillStyle = '#6f5233'; mc.fillRect(px + 5, py + 4, 2, 11);
    mc.fillStyle = '#40301c'; mc.fillRect(px + 9, py + 4, 2, 11);
    mc.fillStyle = '#4a7f3c'; mc.fillRect(px + 3, py + 14, 3, 2); mc.fillRect(px + 10, py + 14, 3, 2);
    return;
  }
  if (!SOLID.has(ch)) { drawFloorBase(mc, grid, x, y, ch); return; }

  if (ch === '#' || ch === 'w' || ch === 'h' || ch === 'D') {
    drawWall(mc, grid, x, y, mapId);
    if (ch === 'w') {
      mc.fillStyle = '#e5ddc8'; mc.fillRect(px + 2, py + 2, 12, 11);
      mc.fillStyle = '#20242e'; mc.fillRect(px + 3, py + 3, 10, 9);
      mc.fillStyle = '#e5ddc8'; mc.fillRect(px + 7, py + 3, 2, 9); mc.fillRect(px + 3, py + 7, 10, 1);
      mc.fillStyle = '#b9ae90'; mc.fillRect(px + 2, py + 13, 12, 2); // sill
    }
    if (ch === 'h') {
      mc.fillStyle = '#0a0908';
      mc.fillRect(px + 5, py + 9, 6, 7);
      mc.fillRect(px + 6, py + 7, 4, 2);
      mc.fillStyle = '#4a4038'; mc.fillRect(px + 4, py + 15, 8, 1);
      mc.fillStyle = 'rgba(255,255,255,0.12)'; mc.fillRect(px + 5, py + 8, 1, 1);
    }
    if (ch === 'D') {
      const left = x + 1 < grid[0].length && grid[y][x + 1] === 'D';
      // white Georgian surround with fanlight, then the famous black door
      mc.fillStyle = '#e8e2d0';
      mc.fillRect(px + (left ? 0 : 14), py, 2, TILE);
      mc.fillRect(px, py, TILE, 1);
      mc.fillStyle = '#0b0b0e'; mc.fillRect(px + (left ? 2 : 0), py + 4, 14, 12);
      mc.fillStyle = '#f2ecdc'; mc.fillRect(px + (left ? 2 : 0), py + 1, 14, 3); // fanlight
      mc.fillStyle = '#9a9284';
      if (left) { mc.fillRect(px + 8, py + 1, 1, 3); mc.fillRect(px + 13, py + 1, 1, 3); }
      else { mc.fillRect(px + 3, py + 1, 1, 3); mc.fillRect(px + 8, py + 1, 1, 3); }
      mc.fillStyle = '#1c1c22';
      mc.fillRect(px + (left ? 3 : 1), py + 6, 11, 3); mc.fillRect(px + (left ? 3 : 1), py + 11, 11, 3);
      mc.fillStyle = 'rgba(255,255,255,0.08)'; mc.fillRect(px + (left ? 3 : 1), py + 6, 11, 1);
      if (mapId === 'ground' && left) {
        mc.fillStyle = '#e8e2d0';
        mc.fillRect(px + 6, py + 7, 1, 2); mc.fillRect(px + 9, py + 7, 2, 1); mc.fillRect(px + 9, py + 8, 1, 1); mc.fillRect(px + 10, py + 8, 1, 1);
        mc.fillRect(px + 9, py + 7, 1, 2);
      } else if (!left) {
        mc.fillStyle = '#e9c46a'; mc.fillRect(px + 3, py + 9, 2, 2);
        mc.fillStyle = '#c98d2c'; mc.fillRect(px + 6, py + 7, 3, 1);
      }
    }
    return;
  }
  drawFloorBase(mc, grid, x, y, floorUnder(grid, x, y));
  const nb = d => { const [dx, dy] = d; const yy = y + dy, xx = x + dx; return yy >= 0 && xx >= 0 && yy < grid.length && xx < grid[0].length && grid[yy][xx] === ch; };
  if (ch === 'T') {
    mc.fillStyle = '#6e3f22'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#8a5230';
    if (!nb([0, -1])) mc.fillRect(px, py, TILE, 2);
    if (!nb([0, 1])) { mc.fillStyle = '#4f2d17'; mc.fillRect(px, py + 13, TILE, 3); }
    const top = mapId === 'ground' ? '#3e6b45' : mapId === 'first' ? '#e9e3d3' : '#b08a55';
    mc.fillStyle = top;
    mc.fillRect(px + (nb([-1, 0]) ? 0 : 2), py + (nb([0, -1]) ? 0 : 3), TILE - (nb([-1, 0]) ? 0 : 2) - (nb([1, 0]) ? 0 : 2), TILE - (nb([0, -1]) ? 0 : 3) - (nb([0, 1]) ? 0 : 4));
    if (mapId === 'basement') { mc.fillStyle = '#9c7846'; mc.fillRect(px + 2, py + 6, 12, 1); mc.fillRect(px + 2, py + 10, 12, 1); }
    if (mapId === 'first' && hash2(x, y) > 0.7) { mc.fillStyle = '#c9a227'; mc.fillRect(px + 6, py + 6, 4, 4); mc.fillStyle = '#e9e3d3'; mc.fillRect(px + 7, py + 7, 2, 2); }
    if (mapId === 'ground' && hash2(x, y) > 0.72) { mc.fillStyle = '#e8e2d0'; mc.fillRect(px + 5, py + 6, 6, 4); mc.fillStyle = '#9a9284'; mc.fillRect(px + 6, py + 7, 4, 1); }
  } else if (ch === 'K') {
    mc.fillStyle = '#8fa0a8'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#d7dde0'; mc.fillRect(px, py, TILE, 5);
    mc.fillStyle = '#e4e9eb'; mc.fillRect(px, py, TILE, 1);
    mc.fillStyle = '#6e7d85'; mc.fillRect(px, py + 13, TILE, 3);
    mc.fillStyle = '#7d8d96'; mc.fillRect(px + 7, py + 6, 2, 6);
    const h = hash2(x * 3, y * 5);
    if (h > 0.75) { mc.fillStyle = '#c98d2c'; mc.fillRect(px + 5, py + 1, 5, 3); mc.fillStyle = '#a8731f'; mc.fillRect(px + 5, py + 3, 5, 1); }
    else if (h > 0.5) { mc.fillStyle = '#e8e2d0'; mc.fillRect(px + 4, py + 1, 8, 3); mc.fillStyle = '#c9c2b0'; mc.fillRect(px + 6, py + 2, 4, 1); }
    else if (h > 0.35) { mc.fillStyle = '#7a9c62'; mc.fillRect(px + 6, py + 1, 4, 3); }
  } else if (ch === 'C') {
    mc.fillStyle = '#5a5f66'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#3c4046'; mc.fillRect(px, py + 12, TILE, 4);
    mc.fillStyle = '#22242a';
    for (let i = 1; i < TILE; i += 3) mc.fillRect(px + i, py + 2, 1, 10);
    mc.fillStyle = '#8b9096'; mc.fillRect(px, py, TILE, 2);
    if (hash2(x, y) > 0.6) { mc.fillStyle = '#c2b8a0'; mc.fillRect(px + 4, py + 8, 6, 3); }
  } else if (ch === 'S') {
    mc.fillStyle = '#3e5f43'; mc.fillRect(px, py, TILE, TILE);
    mc.fillStyle = '#4d7454'; mc.fillRect(px + 1, py + 2, TILE - 2, 8);
    mc.fillStyle = '#5d8663'; mc.fillRect(px + 1, py + 2, TILE - 2, 2);
    mc.fillStyle = '#2f4a34'; mc.fillRect(px, py + 12, TILE, 4);
    if (!nb([-1, 0])) { mc.fillStyle = '#2f4a34'; mc.fillRect(px, py, 3, TILE); mc.fillStyle = '#446a4b'; mc.fillRect(px, py, 3, 2); }
    if (!nb([1, 0])) { mc.fillStyle = '#2f4a34'; mc.fillRect(px + 13, py, 3, TILE); mc.fillStyle = '#446a4b'; mc.fillRect(px + 13, py, 3, 2); }
  } else if (ch === 'G') {
    mc.fillStyle = '#2f5426';
    mc.beginPath(); mc.arc(px + 8, py + 9, 7, 0, 7); mc.fill();
    mc.fillStyle = '#3d6a30'; mc.beginPath(); mc.arc(px + 6, py + 6, 5, 0, 7); mc.fill();
    mc.fillStyle = '#4f8140'; mc.beginPath(); mc.arc(px + 10, py + 6, 4, 0, 7); mc.fill();
    mc.fillStyle = '#5d9350'; mc.beginPath(); mc.arc(px + 9, py + 4, 2, 0, 7); mc.fill();
    if (hash2(x, y) > 0.6) { mc.fillStyle = '#d46a6a'; mc.fillRect(px + 4, py + 8, 2, 2); mc.fillRect(px + 11, py + 10, 2, 2); } // berries
  } else if (ch === 'p') {
    mc.fillStyle = '#a2572f'; mc.fillRect(px + 5, py + 9, 6, 5);
    mc.fillStyle = '#b96a3c'; mc.fillRect(px + 5, py + 9, 6, 1);
    mc.fillStyle = '#7c3f20'; mc.fillRect(px + 5, py + 13, 6, 1);
    mc.fillStyle = '#3d6a30'; mc.fillRect(px + 4, py + 3, 3, 5); mc.fillRect(px + 9, py + 3, 3, 5); mc.fillRect(px + 6, py + 1, 4, 6);
    mc.fillStyle = '#4f8140'; mc.fillRect(px + 6, py + 1, 2, 3);
  } else if (ch === 'P') {
    mc.fillStyle = '#ddd6c4'; mc.fillRect(px + 4, py, 8, TILE);
    mc.fillStyle = '#b9b19c'; mc.fillRect(px + 10, py, 2, TILE);
    mc.fillStyle = '#efe9da'; mc.fillRect(px + 5, py, 2, TILE);
    mc.fillStyle = '#c9c1ab'; mc.fillRect(px + 2, py, 12, 2); mc.fillRect(px + 2, py + 14, 12, 2);
  }
}

// wall decorations painted into the prerender
function drawDecor(mc, d) {
  const px = d.x * TILE, py = d.y * TILE;
  if (d.t === 'painting') {
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 3, py + 2, 10, 8);
    mc.fillStyle = '#1e2a22'; mc.fillRect(px + 4, py + 3, 8, 6);
    mc.fillStyle = '#476b4e'; mc.fillRect(px + 4, py + 6, 8, 3);
    mc.fillStyle = '#7fa3c9'; mc.fillRect(px + 4, py + 3, 8, 2);
    mc.fillStyle = '#e9e3d3'; mc.fillRect(px + 6, py + 4, 2, 1);
  } else if (d.t === 'portraitframe') {
    // empty frame spots are drawn dynamically as PMs accumulate
  } else if (d.t === 'clock') {
    mc.fillStyle = '#4f2d17'; mc.fillRect(px + 4, py + 1, 8, 15);
    mc.fillStyle = '#6e3f22'; mc.fillRect(px + 5, py + 2, 6, 13);
    mc.fillStyle = '#f0e8d2'; mc.fillRect(px + 6, py + 3, 4, 4);
    mc.fillStyle = '#241d16'; mc.fillRect(px + 8, py + 4, 1, 2); mc.fillRect(px + 7, py + 5, 1, 1);
    mc.fillStyle = '#241d16'; mc.fillRect(px + 6, py + 8, 4, 6);
  } else if (d.t === 'fire') {
    mc.fillStyle = '#8f8880'; mc.fillRect(px + 2, py + 4, 12, 12);
    mc.fillStyle = '#9c9588'; mc.fillRect(px + 1, py + 3, 14, 2);
    mc.fillStyle = '#141110'; mc.fillRect(px + 4, py + 7, 8, 9);
    mc.fillStyle = '#7b7468'; mc.fillRect(px + 2, py + 6, 2, 10); mc.fillRect(px + 12, py + 6, 2, 10);
  } else if (d.t === 'books') {
    mc.fillStyle = '#5c4126'; mc.fillRect(px + 1, py + 1, 14, 15);
    for (let r = 0; r < 3; r++) {
      mc.fillStyle = '#40301c'; mc.fillRect(px + 2, py + 2 + r * 5, 12, 4);
      const cols = ['#a33636', '#3f6fae', '#c98d2c', '#476b4e', '#8a5a8f'];
      for (let i = 0; i < 5; i++) {
        mc.fillStyle = cols[(i + r + ((hash2(d.x + i, d.y + r) * 5) | 0)) % 5];
        mc.fillRect(px + 3 + i * 2, py + 2 + r * 5, 2, 4);
      }
    }
  } else if (d.t === 'poster') {
    mc.fillStyle = '#e8e2d0'; mc.fillRect(px + 3, py + 2, 10, 10);
    mc.fillStyle = '#3f6fae'; mc.fillRect(px + 3, py + 2, 10, 3);
    mc.fillStyle = '#241d16'; mc.fillRect(px + 6, py + 7, 4, 3); mc.fillRect(px + 5, py + 6, 2, 2); mc.fillRect(px + 9, py + 6, 2, 2);
  } else if (d.t === 'pans') {
    mc.fillStyle = '#4a4038'; mc.fillRect(px + 2, py + 3, 12, 1);
    mc.fillStyle = '#8b9096'; mc.fillRect(px + 3, py + 4, 4, 4); mc.fillRect(px + 9, py + 4, 4, 5);
    mc.fillStyle = '#6e747a'; mc.fillRect(px + 3, py + 7, 4, 1); mc.fillRect(px + 9, py + 8, 4, 1);
  } else if (d.t === 'rug') {
    const cx = px + 8, cy = py + 8;
    mc.fillStyle = '#8d2f35';
    mc.beginPath(); mc.ellipse(cx, cy, 22, 12, 0, 0, 7); mc.fill();
    mc.fillStyle = '#a13a41';
    mc.beginPath(); mc.ellipse(cx, cy, 17, 8, 0, 0, 7); mc.fill();
    mc.strokeStyle = '#c9a227'; mc.lineWidth = 1;
    mc.beginPath(); mc.ellipse(cx, cy, 19.5, 10, 0, 0, 7); mc.stroke();
  } else if (d.t === 'lectern') {
    mc.fillStyle = '#4f3a28'; mc.fillRect(px + 6, py + 6, 4, 9);
    mc.fillStyle = '#6e5438'; mc.fillRect(px + 3, py + 3, 10, 4);
    mc.fillStyle = '#8a6b48'; mc.fillRect(px + 3, py + 3, 10, 1);
    mc.fillStyle = '#3a2a1c'; mc.fillRect(px + 4, py + 14, 8, 2);
  } else if (d.t === 'umbrella') {
    mc.fillStyle = '#6e6a60'; mc.fillRect(px + 5, py + 8, 7, 7);
    mc.fillStyle = '#82796c'; mc.fillRect(px + 5, py + 8, 7, 1);
    mc.fillStyle = '#a33636'; mc.fillRect(px + 6, py + 3, 1, 6);
    mc.fillStyle = '#3f6fae'; mc.fillRect(px + 8, py + 2, 1, 7);
    mc.fillStyle = '#241d16'; mc.fillRect(px + 10, py + 4, 1, 5);
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 5, py + 2, 2, 1); mc.fillRect(px + 10, py + 3, 2, 1);
  } else if (d.t === 'plaque') {
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 3, py + 4, 10, 8);
    mc.fillStyle = '#8a6c14'; mc.fillRect(px + 4, py + 5, 8, 6);
    mc.fillStyle = '#e9c46a'; mc.fillRect(px + 5, py + 6, 6, 1); mc.fillRect(px + 5, py + 8, 4, 1);
  } else if (d.t === 'chair') {
    mc.fillStyle = '#6b4a2c'; mc.fillRect(px + 4, py + 1, 8, 6);
    mc.fillStyle = '#7d5836'; mc.fillRect(px + 5, py + 2, 6, 4);
    mc.fillStyle = '#4f3520'; mc.fillRect(px + 4, py + 6, 8, 1);
  } else if (d.t === 'xmastree') {
    mc.fillStyle = '#4f3a28'; mc.fillRect(px + 7, py + 13, 3, 3);      // pot & trunk
    mc.fillStyle = '#2f5426'; mc.fillRect(px + 4, py + 9, 9, 4);       // tiers
    mc.fillStyle = '#3d6a30'; mc.fillRect(px + 5, py + 5, 7, 4);
    mc.fillStyle = '#4f8140'; mc.fillRect(px + 6, py + 2, 5, 3);
    mc.fillStyle = '#e9c46a'; mc.fillRect(px + 8, py, 1, 2);           // the fairy's star
    [[5, 10, '#cf2b3a'], [10, 11, '#e9c46a'], [7, 6, '#7fa8d4'], [9, 8, '#cf2b3a'], [6, 12, '#e9c46a']]
      .forEach(([bx, by, c2]) => { mc.fillStyle = c2; mc.fillRect(px + bx, py + by, 1, 1); });
  } else if (d.t === 'pumpkin') {
    mc.fillStyle = '#c9702c'; mc.fillRect(px + 5, py + 9, 7, 6);
    mc.fillStyle = '#e08a3c'; mc.fillRect(px + 6, py + 10, 2, 4);
    mc.fillStyle = '#476b4e'; mc.fillRect(px + 8, py + 7, 1, 2);
    mc.fillStyle = '#241d16'; mc.fillRect(px + 6, py + 11, 1, 1); mc.fillRect(px + 9, py + 11, 1, 1); mc.fillRect(px + 7, py + 13, 3, 1);
  } else if (d.t === 'no10') {
    // THE door of No. 10 — cream surround, fanlight, black door, white "10"
    const X = px, Y = py;
    mc.fillStyle = '#e6ddc7'; mc.fillRect(X + 1, Y + 3, 30, 45);       // stone surround
    mc.fillStyle = '#f2ead3'; mc.fillRect(X + 1, Y + 3, 30, 1);
    mc.fillStyle = '#d6cbb0'; mc.fillRect(X + 1, Y + 46, 30, 2);
    mc.fillStyle = '#20303f'; mc.beginPath(); mc.arc(X + 16, Y + 15, 10, Math.PI, 0); mc.fill();  // fanlight
    mc.strokeStyle = '#e6ddc7'; mc.lineWidth = 1;
    for (let a = 1; a < 4; a++) { const ang = Math.PI + a * (Math.PI / 4); mc.beginPath(); mc.moveTo(X + 16, Y + 15); mc.lineTo(X + 16 + Math.cos(ang) * 10, Y + 15 + Math.sin(ang) * 10); mc.stroke(); }
    mc.fillStyle = '#cfe0ee'; mc.fillRect(X + 9, Y + 9, 3, 2);
    mc.fillStyle = '#17161a'; mc.fillRect(X + 6, Y + 15, 20, 31);      // black door
    mc.fillStyle = '#26242c';                                          // raised panels
    [[9, 19], [16, 19], [9, 28], [16, 28], [9, 37], [16, 37]].forEach(([bx, by]) => mc.fillRect(X + bx, Y + by, 6, 7));
    mc.fillStyle = '#0e0d10';
    [[9, 19], [16, 19], [9, 28], [16, 28], [9, 37], [16, 37]].forEach(([bx, by]) => { mc.fillRect(X + bx, Y + by + 6, 6, 1); mc.fillRect(X + bx + 5, Y + by, 1, 7); });
    mc.fillStyle = '#f0ece0';                                          // the white "10"
    mc.fillRect(X + 11, Y + 16, 1, 6); mc.fillRect(X + 10, Y + 17, 1, 1);
    mc.fillRect(X + 14, Y + 16, 4, 6); mc.fillStyle = '#17161a'; mc.fillRect(X + 15, Y + 17, 2, 4);
    mc.fillStyle = '#c9a227'; mc.fillRect(X + 15, Y + 25, 2, 2);       // lion knocker (brass)
    mc.fillRect(X + 11, Y + 31, 10, 2);                                // letterbox
    mc.fillStyle = '#8a6612'; mc.fillRect(X + 12, Y + 32, 8, 1);
    mc.fillStyle = '#d8cfb6'; mc.fillRect(X + 3, Y + 45, 26, 3);       // the step
    mc.fillStyle = '#c2b997'; mc.fillRect(X + 3, Y + 47, 26, 1);
  } else if (d.t === 'sash') {
    mc.fillStyle = '#e6ddc7'; mc.fillRect(px + 1, py + 1, 14, 17);     // Georgian sash window
    mc.fillStyle = '#3a5a72'; mc.fillRect(px + 3, py + 3, 10, 13);
    mc.fillStyle = '#cfe0ee'; mc.fillRect(px + 3, py + 3, 5, 6);
    mc.fillStyle = '#e6ddc7'; mc.fillRect(px + 7, py + 3, 1, 13); mc.fillRect(px + 3, py + 9, 10, 1);
    mc.fillStyle = '#d6cbb0'; mc.fillRect(px, py, 16, 1);
  } else if (d.t === 'no10lamp') {
    mc.fillStyle = '#1a1a1e'; mc.fillRect(px + 7, py, 2, 6);           // overthrow bracket
    mc.fillRect(px + 3, py + 5, 10, 1);
    mc.fillStyle = '#141416'; mc.fillRect(px + 4, py + 6, 8, 7);       // lantern
    mc.fillStyle = '#ffe6a2'; mc.fillRect(px + 5, py + 7, 6, 5);       // warm glow
    mc.fillStyle = '#1a1a1e'; mc.fillRect(px + 7, py + 6, 2, 7);
    mc.fillStyle = '#101012'; mc.fillRect(px + 5, py + 12, 6, 2);
  } else if (d.t === 'railing') {
    mc.fillStyle = '#141317';
    for (let i = 1; i < TILE; i += 3) { mc.fillRect(px + i, py + 1, 1, 12); mc.fillRect(px + i, py, 1, 2); } // spiked bars
    mc.fillRect(px, py + 3, TILE, 2); mc.fillRect(px, py + 11, TILE, 1);
  } else if (d.t === 'bollard') {
    mc.fillStyle = '#1a1a1e'; mc.fillRect(px + 5, py + 4, 6, 11);
    mc.fillStyle = '#2a2a30'; mc.fillRect(px + 5, py + 4, 2, 11);
    mc.fillStyle = '#0e0d10'; mc.fillRect(px + 4, py + 3, 8, 2);
    mc.fillStyle = '#b8891f'; mc.fillRect(px + 5, py + 6, 6, 1);
  } else if (d.t === 'doormat') {
    mc.fillStyle = '#5a3a20'; mc.fillRect(px + 2, py + 9, 12, 6);
    mc.fillStyle = '#6e4a2c'; mc.fillRect(px + 3, py + 10, 10, 4);
    mc.fillStyle = '#4a2e18'; for (let i = 4; i < 13; i += 2) mc.fillRect(px + i, py + 10, 1, 4);
  } else if (d.t === 'porterchair') {
    // Chippendale's hooded black-leather guard's chair
    mc.fillStyle = '#241d1a'; mc.fillRect(px + 2, py + 1, 12, 5);            // the hood
    mc.beginPath(); mc.arc(px + 8, py + 4, 6, Math.PI, 0); mc.fillStyle = '#2b2320'; mc.fill();
    mc.fillStyle = '#171210'; mc.fillRect(px + 3, py + 5, 10, 8);           // seat back, in shadow
    mc.fillStyle = '#3a2f29'; mc.fillRect(px + 4, py + 6, 8, 5);            // worn leather
    mc.fillStyle = '#4a3d34'; mc.fillRect(px + 4, py + 6, 8, 1);
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 5, py + 8, 1, 1); mc.fillRect(px + 10, py + 8, 1, 1); // brass studs
    mc.fillStyle = '#2b2320'; mc.fillRect(px + 3, py + 13, 10, 2);          // the coal drawer
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 7, py + 14, 2, 1);           // drawer pull
  } else if (d.t === 'door11') {
    // the green-baize connecting door through to No. 11
    mc.fillStyle = '#e8e2d0'; mc.fillRect(px + 1, py, 14, 1); mc.fillRect(px + 1, py, 1, TILE); mc.fillRect(px + 14, py, 1, TILE); // surround
    mc.fillStyle = '#2f4a34'; mc.fillRect(px + 2, py + 1, 12, 15);          // green baize
    mc.fillStyle = '#375740'; mc.fillRect(px + 3, py + 2, 10, 6);
    mc.fillStyle = '#274031'; mc.fillRect(px + 3, py + 9, 10, 6);
    mc.fillStyle = '#1f3226';
    [[4, 2], [12, 2], [4, 14], [12, 14], [8, 8]].forEach(([bx, by]) => mc.fillRect(px + bx, py + by, 1, 1)); // brass-stud diamonds
    mc.fillStyle = '#c9a227'; mc.fillRect(px + 11, py + 8, 2, 2);           // door knob, brass
    mc.fillStyle = '#e0cf9a'; mc.fillRect(px + 4, py + 4, 4, 1);            // little "11" plate
    mc.fillStyle = '#2f4a34'; mc.fillRect(px + 5, py + 4, 1, 1);
  } else if (d.t === 'telly') {
    mc.fillStyle = '#17161a'; mc.fillRect(px + 1, py + 2, 14, 10);          // the set
    mc.fillStyle = '#2b3a4a'; mc.fillRect(px + 2, py + 3, 12, 8);          // screen
    mc.fillStyle = '#3d5468'; mc.fillRect(px + 3, py + 4, 5, 3);           // rolling-news glow
    mc.fillStyle = '#c94a3a'; mc.fillRect(px + 3, py + 9, 10, 1);         // news ticker
    mc.fillStyle = '#0e0d10'; mc.fillRect(px + 6, py + 12, 4, 2);         // stand
    mc.fillStyle = '#3a3630'; mc.fillRect(px + 4, py + 14, 8, 1);
  }
}

/* =========================================================
   The real calendar leaks in: seasons dress the house, and some days
   the Foreign Office cat comes round. Same date-seed idea as the Daily
   Sortie — everyone's No. 10 looks the same on the same day.
   ========================================================= */
const REAL_DATE = new Date();
const SEASON_M = REAL_DATE.getMonth() + 1;
const IS_WINTER = SEASON_M === 12 || SEASON_M <= 2;
const IS_SPRING = SEASON_M >= 3 && SEASON_M <= 5;
const IS_AUTUMN = SEASON_M >= 9 && SEASON_M <= 11;
const IS_DECEMBER = SEASON_M === 12;
const IS_OCTOBER = SEASON_M === 10;
const IS_XMAS = IS_DECEMBER && REAL_DATE.getDate() >= 24 && REAL_DATE.getDate() <= 26;
const IS_GOTCHA_DAY = SEASON_M === 2 && REAL_DATE.getDate() === 15; // hired 15 Feb 2011, on merit
const DATE_SEED = REAL_DATE.getFullYear() * 10000 + SEASON_M * 100 + REAL_DATE.getDate();
// roughly two days in five, Palmerston pays a visit (seeded: the same days for everyone)
const PALM_VISIT = mulberry32(DATE_SEED ^ 0xCA7)() < 0.4;

const TXT_XMASTREE = [
  'The official No. 10 tree. You have completed your assessment: climbable. You are CHOOSING not to. Today.',
  'Forty baubles. Each one a small, glittering provocation. You rise above. For now.',
  'The fairy on top outranks the Chancellor. You outrank the fairy.',
];
const TXT_PUMPKIN = [
  'Someone has carved a face into a vegetable and left it at the door of government. You respect it.',
  'The pumpkin stares. You stare back. It blinks first. (It has no eyelids. A technicality.)',
];

/* =========================================================
   Maps of the real No. 10 (and one shelter)
   ========================================================= */
function makeMap(id, w, h, build) {
  const grid = [];
  for (let y = 0; y < h; y++) grid.push(new Array(w).fill('#'));
  const m = {
    id, w, h, grid,
    holes: [], lamps: [], transitions: [], regions: [], portraits: [], decor: [], npcs: [],
    mouseCap: lvl => Math.min(3 + Math.floor(lvl * 0.8), 8),
    rainy: false,
  };
  const set = (x, y, ch) => { grid[y][x] = ch; };
  const rect = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch; };
  build(m, set, rect);
  // chairs alongside big tables
  if (id === 'ground' || id === 'first') {
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
      if (FLOORY(grid[y][x]) && grid[y - 1][x] === 'T' && hash2(x, y) > 0.25) m.decor.push({ x, y, t: 'chair' });
    }
  }
  const c = document.createElement('canvas');
  c.width = w * TILE; c.height = h * TILE;
  const mc = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) drawTile(mc, grid, x, y, id);
  // soft shadows cast by walls onto the floor below them
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
    if (FLOORY(grid[y][x]) && grid[y][x] !== 'q' && SOLID.has(grid[y - 1][x]) && grid[y - 1][x] !== 'T' && grid[y - 1][x] !== 'q') {
      mc.fillStyle = 'rgba(10,8,6,0.25)'; mc.fillRect(x * TILE, y * TILE, TILE, 3);
      mc.fillStyle = 'rgba(10,8,6,0.12)'; mc.fillRect(x * TILE, y * TILE + 3, TILE, 2);
    }
  }
  for (const d of m.decor) drawDecor(mc, d);
  m.canvas = c;
  m.windows = []; m.water = []; m.trees = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid[y][x] === 'w') m.windows.push([x, y]);
    if (grid[y][x] === 'q') m.water.push([x, y]);
    if (grid[y][x] === 'Y') m.trees.push([x, y]);
  }
  m.fires = m.decor.filter(d => d.t === 'fire');
  // points of interest: nap spots, snacks, and things worth a read
  m.pois = m.pois || [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = grid[y][x];
    if (ch === 'r' || ch === 'S') m.pois.push({ x, y, emoji: '💤', type: 'nap', texts: TXT_NAP });
    if (ch === 'E') m.pois.push({ x, y, emoji: '💤', type: 'nap', texts: TXT_TOWER });
    if (ch === 'X') m.pois.push({ x, y, emoji: '📦', type: 'nap', texts: TXT_BOX });
    if (ch === 'J') m.pois.push({ x, y, emoji: '🪵', type: 'scratch', texts: TXT_SCRATCH });
    if (ch === 'u') m.pois.push({ x, y, emoji: '💤', type: 'nap', texts: TXT_WINDOW });
    if (ch === 'R') m.pois.push({ x, y, emoji: '💤', type: 'nap', texts: TXT_RADIATOR });
    if (ch === 'M') m.pois.push({ x, y, emoji: '🎹', type: 'piano', texts: TXT_PIANO });
    if (ch === 'b') m.pois.push({ x, y, emoji: '🍗', type: 'eat', texts: TXT_BOWL });
  }
  for (const d of m.decor) {
    const map2 = { books: ['📚', TXT_BOOKS], painting: ['🖼️', TXT_PAINTING], clock: ['🕰️', TXT_CLOCK], fire: ['🔥', TXT_FIRE], poster: ['📌', TXT_POSTER], porterchair: ['🪑', TXT_PORTER], telly: ['📺', TXT_TELLY] };
    if (map2[d.t]) m.pois.push({ x: d.x, y: d.y + 1, emoji: map2[d.t][0], type: 'text', texts: map2[d.t][1] });
  }
  m.portraits.forEach(([x, y], i) => m.pois.push({ x, y: y + 1, emoji: '🖼️', type: 'portrait', idx: i }));
  // hidden secrets: invisible until you wander close
  (m.secrets || []).forEach(s => m.pois.push({ x: s.x, y: s.y, emoji: '✨', type: 'secret', fact: s.f, sid: id + ':' + s.x + ',' + s.y }));
  // every potted-plant tile gets a room-pack plant variety
  m.packItems = m.packItems || [];
  const PVAR = ['plantFig', 'plantDracaena', 'plantBushy', 'plantSnake', 'plantTall', 'plantLeafy', 'plantSmall', 'plantSlim', 'plantBushy2'];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid[y][x] === 'p') m.packItems.push({ k: PVAR[(hash2(x * 3, y * 7) * PVAR.length) | 0], tx: x, ty: y, fw: 1, fh: 1, clear: 1 });
  }
  return m;
}

const MAPS = {};

// --- Battersea shelter (the beginning) ---
MAPS.shelter = makeMap('shelter', 22, 15, (m, set, rect) => {
  rect(1, 1, 20, 13, 't');
  rect(2, 1, 7, 2, 'C'); rect(10, 1, 15, 2, 'C'); rect(18, 1, 20, 2, 'C');
  set(3, 11, 'r'); set(6, 8, 'b'); set(15, 5, 'b'); set(19, 12, 'p');
  set(5, 5, 'J'); set(17, 8, 'E');
  m.toys = [[13, 9, '#cf2b3a']];
  m.packItems = [{ k: 'beanbag', tx: 7, ty: 4, fw: 2, fh: 2 }];
  m.pois = (m.pois || []).concat([{ x: 7, y: 4, emoji: '💤', type: 'nap', texts: TXT_NAP }]);
  set(10, 14, 'D'); set(11, 14, 'D');
  set(5, 0, 'w'); set(16, 0, 'w');
  m.decor.push({ x: 12, y: 0, t: 'poster' }, { x: 9, y: 0, t: 'poster' });
  m.secrets = [
    { x: 19, y: 2, f: 'Cage 4\'s card, still pinned up: "LARRY — GOOD BOY. VERY GOOD BOY." The understatement of the century.' },
  ];
  m.holes = [[21, 7], [0, 4]];
  m.lamps = [[11.5, 6.5]];
  m.regions = [[1, 1, 20, 13, 'Battersea — Cattery 4']];
  m.npcs = [{ x: 17, y: 10, sprite: 'worker', rect: [14, 8, 20, 12], quips: [
    'He keeps staring at the mice like they owe him money.',
    'Someone important is coming to see YOU today. Try to look employable.',
    'Cattery 4 has never been this quiet. The mice suspect a merger.',
    'Between us — you\'re wasted here. You should be running something.',
    'Good luck at the interview. Whatever they offer, negotiate for more fish.',
  ] }];
  m.cats = [
    { x: 12, y: 4, set: 'white', name: 'Duchess', mode: 'sit', quips: [
      'Duchess judges your technique. Seven out of ten. The three is for enthusiasm.',
      'Duchess pretends not to care. Duchess cares, enormously, in private.',
      'Do write. Or better: send fish.',
      'Downing Street? How dreadfully public, darling. Do enjoy the tourists.',
      'One hears they change the management weekly there. How exhausting for the sofa.',
    ] },
    { x: 18, y: 11, set: 'ginger', name: 'Biscuit', mode: 'sleep', quips: [
      '…zzz… (Biscuit dreams of a big garden.)',
      '…zzz… (Biscuit will miss you. Probably. …zzz.)',
      '…zzz… (do not wake Biscuit. Biscuit is off duty. Permanently.)',
    ] },
  ];
  m.mouseCap = () => 3;
});

// --- Ground floor: entrance hall, corridor, Cabinet Room, garden ---
MAPS.ground = makeMap('ground', 48, 36, (m, set, rect) => {
  rect(1, 1, 46, 8, 'g');                       // the garden (behind the house)
  for (let x = 2; x <= 45; x += 8) if (x !== 34) set(x, 1, 'Y');           // trees along the back wall
  for (let x = 6; x <= 45; x += 8) if (x !== 38) set(x, 1, 'G');
  [[5, 4], [12, 6], [33, 6], [20, 3], [44, 6], [16, 2]].forEach(([x, y]) => set(x, y, 'G'));
  [[8, 2], [16, 5], [25, 3], [30, 7], [43, 2], [10, 7], [22, 6], [28, 2], [34, 4]].forEach(([x, y]) => { if (m.grid[y][x] === 'g') set(x, y, 'f'); });
  rect(38, 3, 43, 6, 'q');                      // the pond
  m.pois = [{ x: 37, y: 4, emoji: '🐟', type: 'text', texts: TXT_POND }];
  rect(36, 5, 37, 8, 'a');                      // stone path from the terrace
  rect(30, 5, 35, 5, 'a');
  set(36, 9, 'a'); set(37, 9, 'a');             // terrace steps into the garden
  // Cabinet Room (rear, overlooking the garden — boat-shaped table)
  rect(25, 10, 46, 18, '.');
  rect(29, 13, 42, 15, 'T');
  [[26, 9], [27, 9], [31, 9], [32, 9], [40, 9], [41, 9], [44, 9], [45, 9]].forEach(([x, y]) => set(x, y, 'w'));
  m.decor.push({ x: 29, y: 9, t: 'painting' }, { x: 38, y: 9, t: 'painting' }, { x: 43, y: 9, t: 'painting' }, { x: 35, y: 9, t: 'fire' });
  // corridor from the front door to the Cabinet Room
  rect(21, 10, 23, 33, 'v');
  set(24, 13, '.'); set(24, 14, '.');
  // Grand Staircase (yellow runner; portraits of every PM up the wall)
  rect(2, 10, 9, 16, 'y');
  set(3, 11, 'U'); set(3, 15, 'B');
  m.portraits = [[5, 9], [7, 9], [9, 9]];
  // Press Office
  rect(12, 10, 19, 16, '.');
  set(13, 12, 'K'); set(14, 12, 'K'); set(16, 14, 'K'); set(17, 14, 'K');
  set(10, 13, 'v'); set(11, 13, 'v');
  set(20, 13, 'v');
  // PM's Study
  rect(2, 19, 19, 24, '.');
  rect(3, 20, 5, 21, 'S'); set(15, 22, 'K'); set(16, 22, 'K'); set(3, 24, 'p');
  set(10, 22, 'E');                             // a cat tree, gifted by a fan
  set(14, 27, 'J');                             // scratching post in the hall
  m.toys = [[18, 29, '#3f6fae'], [30, 4, '#e9c46a']];
  m.decor.push({ x: 4, y: 18, t: 'books' }, { x: 5, y: 18, t: 'books' }, { x: 10, y: 18, t: 'books' }, { x: 11, y: 18, t: 'painting' });
  set(20, 21, 'v'); set(20, 22, 'v');
  // Entrance Hall (the checkerboard floor and the black door)
  rect(13, 26, 30, 33, 'c');
  set(21, 34, 'D'); set(22, 34, 'D');
  set(16, 34, 'w'); set(17, 34, 'w'); set(26, 34, 'w'); set(27, 34, 'w');
  set(28, 32, 'r'); set(14, 32, 'p'); set(29, 26, 'p'); set(16, 33, 'u');
  m.decor.push({ x: 15, y: 25, t: 'painting' }, { x: 17, y: 25, t: 'painting' }, { x: 19, y: 25, t: 'fire' }, { x: 26, y: 25, t: 'clock' }, { x: 28, y: 25, t: 'painting' });
  m.packItems = [
    { k: 'sofaGreen', tx: 2, ty: 16, fw: 3, fh: 2, clear: 1 },
    { k: 'sofaGrey', tx: 16, ty: 16, fw: 3, fh: 2, clear: 1 },
    { k: 'sofaGrey', tx: 3, ty: 20, fw: 3, fh: 2, clear: 1 },
    { k: 'rugGold', tx: 16, ty: 29, fw: 3, fh: 2 },
    { k: 'rugGreen', tx: 7, ty: 20, fw: 3, fh: 2 },
    { k: 'rugTealV', tx: 22, ty: 13, fw: 1, fh: 3 },
    { k: 'rugTealV', tx: 22, ty: 20, fw: 1, fh: 3 },
    { k: 'rugTealV', tx: 22, ty: 27, fw: 1, fh: 3 },
    { k: 'shelfCube', tx: 18, ty: 10, fw: 2, fh: 1, clear: 1 },
  ];
  set(18, 10, 'K'); set(19, 10, 'K');
  set(12, 16, 'p'); set(26, 17, 'p');
  set(26, 33, 'R'); set(27, 33, 'R');           // Larry's famous radiator, under the front windows
  m.decor.push({ x: 19, y: 32, t: 'lectern' }, { x: 24, y: 32, t: 'umbrella' }, { x: 24, y: 25, t: 'plaque' },
    { x: 28, y: 30, t: 'porterchair' });          // Chippendale's hooded guard's chair, by the door
  m.pois.push(
    { x: 19, y: 32, emoji: '🎤', type: 'text', texts: TXT_LECTERN },
    { x: 24, y: 32, emoji: '☂️', type: 'text', texts: TXT_UMBRELLA },
    { x: 21, y: 33, emoji: '📮', type: 'text', texts: TXT_LETTERBOX },
    { x: 24, y: 26, emoji: '🎖️', type: 'honours' },
    { x: 28, y: 6, emoji: '🤝', type: 'gardendeal' },   // the gardener knows where they dig
    { x: 6, y: 10, emoji: '🖼️', type: 'commission' },   // vanity, in oils, on the Grand Staircase
  );
  m.secrets = [
    { x: 11, y: 33, f: 'Larry fact: recruited from Battersea Dogs & Cats Home in 2011 — the only member of government hired strictly on merit.' },
    { x: 45, y: 17, f: 'Larry fact: he has outlasted six Prime Ministers so far. The seventh checks over their shoulder.' },
    { x: 30, y: 16, f: 'Under the Cabinet table: three biros, one manifesto (chewed), and an IOU signed by a mouse.' },
    { x: 2, y: 16, f: 'The Grand Staircase, where every important arrival trips exactly once. You have seen everything. You will say nothing. For tuna.' },
    { x: 44, y: 7, f: 'The Downing Street pigeons hold their AGM at this pond. You are Item One on the agenda. Again.' },
    { x: 3, y: 2, f: 'Palmerston of the Foreign Office occupied this tree for six hours in 2016. Historians call it The Incident. You call it Tuesday.' },
    { x: 35, y: 11, f: 'Larry fact: the only picture in the Cabinet Room is Robert Walpole — the first Prime Minister — over the fireplace. Everyone else who ever mattered got a chair. He got the wall.' },
    { x: 33, y: 17, f: "Larry fact: the PM's chair is the only one at the table with arms, set midway down, facing the windows. You have tested it. It is, you can confirm, the good chair." },
    { x: 7, y: 12, f: 'Larry fact: the staircase portraits were a gift of Sir Edward Hamilton of the Treasury in 1907. They descend the wall in strict order, back to Walpole — and the wall is nearly full.' },
    { x: 5, y: 14, f: 'Larry fact: Winston Churchill is the only Prime Minister on this staircase to appear twice. You have counted. Repeatedly. Twice.' },
    { x: 6, y: 22, f: "Larry fact: this study was Margaret Thatcher's own office; her portrait by Richard Stone still keeps the room. She worked a cat's hours. You keep them for her." },
    { x: 14, y: 4, f: 'Larry fact: in 1991 an IRA mortar came down in this garden, metres from a Cabinet meeting in progress. The window cracked; the meeting continued. Cats remained, on principle, unbothered.' },
  ];
  m.holes = [[12, 29], [31, 30], [47, 15], [20, 23], [24, 16], [10, 1], [33, 6]]; // last two: garden burrows (tree + hedge)
  m.knockables = [
    { kind: 'teacup', x: 36, y: 13 },   // on the Cabinet table, of course
    { kind: 'papers', x: 16, y: 14 },   // the morning briefing, Press Office
    { kind: 'sandwich', x: 16, y: 30 }, // the guard's lunch, unattended
  ];
  m.lamps = [[15.5, 27.5], [28.5, 27.5], [22.5, 18.5], [26.5, 11.5], [44.5, 11.5], [4.5, 20.5], [33.5, 4.5]];
  m.transitions = [
    { x: 3, y: 11, to: 'first', tx: 4, ty: 12 },
    { x: 3, y: 15, to: 'basement', tx: 3, ty: 2 },
    { x: 22, y: 33, to: 'street', tx: 10, ty: 6 },   // out the famous front door
  ];
  m.decor.push({ x: 22, y: 33, t: 'doormat' });      // the exit, marked
  m.regions = [
    [1, 1, 46, 8, 'The Garden'],
    [25, 10, 46, 18, 'The Cabinet Room'],
    [2, 10, 9, 16, 'The Grand Staircase'],
    [12, 10, 19, 16, 'The Press Office'],
    [2, 19, 19, 24, "The PM's Study"],
    [21, 10, 23, 25, 'The Corridor'],
    [13, 26, 30, 33, 'The Entrance Hall'],
  ];
  m.npcs = [
    { x: 19, y: 31, sprite: 'guard', rect: [15, 29, 27, 33], quips: [
      'Morning, Chief Mouser.',
      'All quiet on the doorstep.',
      'Caught a mouse by the boot-scraper last night. Left it for you. Professional courtesy.',
      'Careful by the cameras, sir — one snap of you asleep and it\'s the front page for a week.',
      'If anyone asks, you were "in a meeting". You were on the radiator.',
      'Post\'s late again. You\'ll want to supervise the letterbox. You always do.',
      'They come and go through that door. You stay. Steadies the ship, having you here.',
    ] },
    { x: 15, y: 13, sprite: 'aide', rect: [12, 11, 19, 16], quips: [
      'Has anyone seen the briefing? ANYONE?',
      'Minister, the cat outranks you. No, I won\'t put that in writing.',
      'The meeting moved. Again. To a room that may no longer exist.',
      'We\'ve held three positions on this since breakfast. You\'ve held one: nap.',
      'Please don\'t sit on the red box. …Of course you\'re sitting on the red box.',
      'Someone\'s been feeding you ham under the table. I am choosing not to have seen it.',
    ] },
    { x: 30, y: 6, sprite: 'gardener', rect: [24, 2, 35, 8], quips: [
      'Mind the begonias. Delicate things.',
      'Rain again. Good for the roses. Bad for the photo-ops.',
      'No digging. I know that look.',
      'Found a fresh mouse hole by the wall. Thought you\'d want first refusal.',
      'The pigeons and I have an understanding. You\'re welcome to renegotiate it.',
    ] },
  ];
  m.cats = [
    { x: 10, y: 4, set: 'tux', name: 'Palmerston', mode: 'wander', rect: [4, 2, 20, 7], quips: [
      'Palmerston, Foreign Office. This garden is neutral territory. FOR NOW.',
      'We do not discuss the Incident of 2017.',
      'Your bow tie is… adequate. For a domestic posting.',
      'Hiss. (Diplomatically.)',
      'The Foreign Office has the larger garden, you know. One simply mentions it.',
      'One receives so many invitations. One declines them all. You should try it.',
    ] },
  ];
  // the real calendar dresses the house
  if (IS_DECEMBER) {
    m.decor.push({ x: 25, y: 25, t: 'xmastree' }); // Entrance Hall, against the back wall
    m.pois.push({ x: 25, y: 26, emoji: '🎄', type: 'text', texts: TXT_XMASTREE });
  }
  if (IS_OCTOBER) {
    m.decor.push({ x: 25, y: 32, t: 'pumpkin' }); // on the famous doorstep
    m.pois.push({ x: 25, y: 32, emoji: '🎃', type: 'text', texts: TXT_PUMPKIN });
  }
  m.rainy = true;
});

// --- Basement: the kitchen, pantry and cellar (mouse country) ---
MAPS.basement = makeMap('basement', 30, 20, (m, set, rect) => {
  rect(1, 1, 18, 17, 't');
  rect(6, 8, 13, 10, 'T');
  for (let x = 3; x <= 16; x++) if (x % 5 !== 0) set(x, 1, 'K');
  set(1, 5, 'K'); set(1, 6, 'K'); set(1, 12, 'K');
  set(3, 3, 'b'); set(4, 3, 'b');               // Larry's bowls, food and water
  set(2, 2, 'U');
  m.decor.push({ x: 5, y: 0, t: 'pans' }, { x: 10, y: 0, t: 'pans' }, { x: 15, y: 0, t: 'pans' });
  rect(21, 1, 28, 7, 't');
  for (let x = 22; x <= 27; x++) set(x, 1, 'K');
  set(22, 4, 'K'); set(23, 4, 'K'); set(24, 4, 'K');
  set(19, 4, 't'); set(20, 4, 't');
  rect(21, 11, 28, 17, 't');
  set(22, 12, 'K'); set(23, 12, 'K'); set(26, 15, 'K');
  set(25, 16, 'X');                             // a very important cardboard box
  set(19, 14, 't'); set(20, 14, 't');
  m.toys = [[9, 13, '#e9c46a']];
  m.secrets = [
    { x: 2, y: 16, f: "Larry fact: he is officially employed by the Cabinet Office. Job title: Chief Mouser. Salary: tuna, negotiated upward annually." },
    { x: 27, y: 2, f: 'Behind the baked beans: a mouse parliament. 650 seats. All of them marginal.' },
  ];
  m.holes = [[0, 8], [0, 14], [29, 4], [29, 13], [9, 18], [19, 6], [24, 8]];
  m.lamps = [[4.5, 3.5], [14.5, 5.5], [24.5, 2.5], [24.5, 13.5]];
  m.transitions = [{ x: 2, y: 2, to: 'ground', tx: 4, ty: 15 }];
  // the chef's counter: slip him kippers, he opens the pantry door a crack
  m.pois = [{ x: 7, y: 1, emoji: '🤝', type: 'chefdeal' }];
  m.regions = [
    [1, 1, 18, 17, 'The Kitchen'],
    [21, 1, 28, 7, 'The Pantry'],
    [21, 11, 28, 17, 'The Cellar'],
  ];
  m.npcs = [{ x: 9, y: 4, sprite: 'chef', rect: [2, 2, 16, 7], quips: [
    'Mind the flour, paws.',
    'One saucer of milk, coming up. Don\'t tell the vet.',
    'The pantry mice are ORGANISED, I tell you. They\'ve got a rota.',
    'Cabinet lunch is at one. The mice have already RSVP\'d.',
    'You catch \'em, I ask no questions. That\'s our arrangement.',
    'There\'s a bit of leftover salmon with your name on it. Literally — I labelled it.',
  ] }];
  m.mouseCap = lvl => Math.min(5 + Math.floor(lvl * 0.8), 11);
});

// --- First floor: state rooms ---
MAPS.first = makeMap('first', 44, 26, (m, set, rect) => {
  rect(1, 11, 42, 14, 'v');
  set(2, 12, 'B');
  rect(1, 1, 12, 9, '.');
  rect(2, 2, 3, 2, 'S'); set(9, 7, 'S'); set(11, 1, 'p'); set(1, 9, 'p');
  set(4, 2, 'M'); set(5, 2, 'M');               // the White Room piano
  set(9, 1, 'u');                                // window seat
  set(10, 2, 'K'); set(11, 2, 'K');              // étagère
  m.packItems = [
    { k: 'sofaGreen', tx: 2, ty: 2, fw: 2, fh: 1, clear: 1 },
    { k: 'poufGold', tx: 9, ty: 7, fw: 1, fh: 1, clear: 1 },
    { k: 'etagere', tx: 10, ty: 2, fw: 2, fh: 1, clear: 1 },
    { k: 'rugPink', tx: 6, ty: 4, fw: 3, fh: 3 },
    { k: 'sofaGrey', tx: 17, ty: 2, fw: 2, fh: 1, clear: 1 },
    { k: 'poufGold', tx: 25, ty: 7, fw: 1, fh: 1, clear: 1 },
    { k: 'shelfDark', tx: 24, ty: 2, fw: 2, fh: 1, clear: 1 },
    { k: 'rugGreen', tx: 20, ty: 4, fw: 3, fh: 2 },
    { k: 'rugDamask', tx: 18, ty: 12, fw: 4, fh: 1 },
  ];
  set(6, 10, 'v'); set(7, 10, 'v');
  rect(15, 1, 28, 9, '.');
  rect(17, 2, 18, 2, 'S'); set(25, 7, 'S'); set(27, 1, 'p');
  set(26, 8, 'X'); set(21, 1, 'u');
  set(24, 2, 'K'); set(25, 2, 'K');
  set(32, 9, 'p'); set(42, 14, 'p');
  set(21, 10, 'v'); set(22, 10, 'v');
  m.toys = [[25, 12, '#cf2b3a']];
  rect(31, 1, 42, 9, '.');
  set(33, 3, 'P'); set(38, 3, 'P'); set(33, 7, 'P'); set(38, 7, 'P');
  set(35, 10, 'v'); set(36, 10, 'v');
  rect(6, 16, 24, 24, '.');
  rect(10, 19, 20, 21, 'T');
  set(14, 15, 'v'); set(15, 15, 'v');
  rect(27, 16, 38, 24, '.');
  rect(31, 19, 34, 20, 'T');
  set(31, 15, 'v'); set(32, 15, 'v');
  [3, 4, 9, 10, 17, 18, 25, 26, 33, 34, 40, 41].forEach(x => set(x, 0, 'w'));
  m.decor.push({ x: 6, y: 0, t: 'fire' }, { x: 21, y: 0, t: 'fire' }, { x: 37, y: 0, t: 'painting' },
    { x: 3, y: 10, t: 'painting' }, { x: 11, y: 10, t: 'painting' }, { x: 17, y: 10, t: 'painting' },
    { x: 27, y: 10, t: 'painting' }, { x: 31, y: 10, t: 'painting' }, { x: 39, y: 10, t: 'painting' });
  m.portraits = [[4, 15], [6, 15], [8, 15], [10, 15], [12, 15], [18, 15], [20, 15], [22, 15], [24, 15], [26, 15], [34, 15], [36, 15]];
  m.secrets = [
    { x: 41, y: 9, f: 'Larry fact: a President of the United States once bent down to greet Larry near this spot. Larry permitted 4.0 seconds of contact. A record.' },
    { x: 23, y: 24, f: 'The state dinner service, in use since 1735. You have never broken a single piece. The humans have broken nine.' },
    { x: 12, y: 22, f: 'Larry fact: the State Dining Room was raised by Sir John Soane in the 1820s — a soaring vaulted chamber bolted onto the house purely for banquets. It seats a Cabinet of egos. You seat one cat, centrally.' },
    { x: 24, y: 7, f: "Larry fact: the Doric columns framing the Terracotta Room are Quinlan Terry's, from the 1980s restoration. Grand, load-bearing, and — you have quietly confirmed — climbable." },
    { x: 40, y: 7, f: 'Larry fact: the Pillared Drawing Room is the largest of the state rooms, named for its screen of columns. It is where Prime Ministers pose with presidents. You have photobombed four such photographs.' },
  ];
  // the No. 11 connecting door, at the far end of the landing — through to the residence
  m.decor.push({ x: 43, y: 13, t: 'door11' });
  m.pois = m.pois || [];
  m.pois.push({ x: 41, y: 13, emoji: '🚪', type: 'text', texts: TXT_DOOR11 });
  m.holes = [[0, 12], [43, 13], [25, 20], [39, 18]];
  m.knockables = [{ kind: 'vase', x: 10, y: 2 }]; // Regency, wobbly, on the étagère
  m.lamps = [[3.5, 12.5], [20.5, 12.5], [36.5, 12.5], [6.5, 2.5], [21.5, 2.5], [36.5, 2.5], [15.5, 22.5], [36.5, 17.5]];
  m.transitions = [
    { x: 2, y: 12, to: 'ground', tx: 4, ty: 11 },
    { x: 42, y: 13, to: 'flat', tx: 4, ty: 15 },     // through the No. 11 door, up to the private flat
  ];
  m.regions = [
    [1, 1, 12, 9, 'The White Drawing Room'],
    [15, 1, 28, 9, 'The Terracotta Room'],
    [31, 1, 42, 9, 'The Pillared Drawing Room'],
    [6, 16, 24, 24, 'The State Dining Room'],
    [27, 16, 38, 24, 'The Small Dining Room'],
    [1, 11, 42, 14, 'The Landing'],
  ];
  m.npcs = [{ x: 20, y: 12, sprite: 'butler', rect: [4, 11, 40, 14], quips: [
    'The State Room is dusted, sir.',
    'The chandelier was polished this morning. Do try not to sit on it.',
    'Shall I fetch the good saucer? The occasion, one feels, demands it.',
    'One has learned to iron a newspaper flat. You then sit upon it. We persevere.',
    'Do signal if the ambassador bores you. I shall arrange an urgent nap.',
  ] }];
  m.cats = [
    { x: 34, y: 5, set: 'black', name: 'Gladstone', mode: 'sit', rect: [32, 2, 41, 8], quips: [
      'Gladstone, Treasury. I count mice as assets.',
      'The Pillared Room is under audit. Move along.',
      'Your XP is inflationary. Noted. I\'ve written to someone about it.',
      'Every treat you receive is, technically, unfunded. We shall allow it.',
      'I have modelled your career. Forecast: insufferable, but stable.',
    ] },
  ];
  m.mouseCap = lvl => Math.min(3 + Math.floor(lvl * 0.6), 7);
});

// --- The private flat: the PM's residence, above No. 11 (reached via the connecting door) ---
MAPS.flat = makeMap('flat', 34, 22, (m, set, rect) => {
  // The Sitting Room — off-duty, domestic, the one room with a telly
  rect(1, 1, 15, 9, '.');
  set(3, 0, 'w'); set(4, 0, 'w'); set(11, 0, 'w'); set(12, 0, 'w');
  m.decor.push({ x: 8, y: 0, t: 'fire' }, { x: 13, y: 0, t: 'telly' }, { x: 1, y: 0, t: 'painting' });
  set(14, 3, 'u');                                  // window seat — Larry's off-duty perch
  set(2, 8, 'p'); set(14, 8, 'p');
  m.packItems = [
    { k: 'sofaGrey', tx: 3, ty: 7, fw: 3, fh: 2, clear: 1 },
    { k: 'sofaGreen', tx: 9, ty: 7, fw: 3, fh: 2, clear: 1 },
    { k: 'rugGold', tx: 6, ty: 4, fw: 3, fh: 2 },
  ];
  set(6, 10, '.'); set(7, 10, '.');                // sitting room → landing
  // The Flat Kitchen — the family kitchen, home of the "kitchen suppers"
  rect(18, 1, 32, 9, '.');
  set(20, 0, 'w'); set(29, 0, 'w');
  for (let x = 19; x <= 31; x++) if (x % 4 !== 0) set(x, 1, 'K');   // the counter
  set(31, 3, 'K'); set(31, 4, 'K');
  rect(22, 5, 26, 6, 'T');                          // the little supper table
  set(30, 8, 'p');
  m.decor.push({ x: 21, y: 0, t: 'pans' }, { x: 27, y: 0, t: 'pans' });
  set(24, 10, '.'); set(25, 10, '.');              // kitchen → landing
  // The Residence Landing — the golden stair-runner continues up here
  rect(1, 11, 32, 17, 'y');
  set(2, 12, 'B');                                 // the residence stair, back down to the state floor
  set(15, 18, 'w'); set(16, 18, 'w');
  set(30, 16, 'p');
  m.decor.push({ x: 33, y: 13, t: 'door11' });     // THE connecting door, through to No. 11 proper
  m.toys = [[20, 14, '#e9c46a']];
  m.pois = [
    { x: 24, y: 7, emoji: '🍝', type: 'text', texts: TXT_FLATKITCHEN },
    { x: 15, y: 17, emoji: '💤', type: 'text', texts: TXT_FLATWINDOW },
    { x: 31, y: 13, emoji: '🚪', type: 'text', texts: TXT_DOOR11 },
  ];
  m.secrets = [
    { x: 8, y: 14, f: 'Larry fact: the Prime Minister lives up here, in the flat above No. 11 — the larger of the two. The Chancellor takes the smaller flat over No. 10. Occupants have been known to swap. You never move; you simply RESIDE.' },
    { x: 27, y: 15, f: 'The wallpaper up here has, on occasion, cost more than anyone in public life cares to admit. You decline to take a view. You do, however, choose to sharpen your claws in the OTHER room.' },
    { x: 5, y: 16, f: 'Larry fact: officially, no cat has the run of the private flat. Officially. You have made your own arrangements — as you have with every rule in this house.' },
  ];
  m.holes = [[0, 14], [33, 16], [9, 10]];
  m.lamps = [[8.5, 3.5], [24.5, 3.5], [6.5, 14.5], [26.5, 14.5]];
  m.transitions = [
    { x: 2, y: 12, to: 'first', tx: 41, ty: 13 },   // down the residence stair
    { x: 32, y: 13, to: 'first', tx: 41, ty: 13 },  // back through the No. 11 door
  ];
  m.regions = [
    [1, 1, 15, 9, 'The Sitting Room'],
    [18, 1, 32, 9, 'The Flat Kitchen'],
    [1, 11, 32, 17, 'The Residence Landing'],
  ];
  m.npcs = [{ x: 10, y: 7, sprite: 'butler', rect: [1, 1, 15, 9], quips: [
    "Off duty, Chief Mouser? Up here you needn't be Chief anything.",
    'The PM cooks their own supper on Sundays. Badly. Kindly. You supervise.',
    'Mind the good sofa. That is the only house rule up here — and it is, of course, yours to break.',
    'Quieter, this floor. No cameras, no Cabinet. Just the kettle, the telly, and you.',
    'Through that door is No. 11. I did not see you use it. I never do.',
  ] }];
  m.mouseCap = lvl => Math.min(2 + Math.floor(lvl * 0.3), 4);
});

// --- Downing Street: the famous front of No. 10 ---
MAPS.street = makeMap('street', 22, 15, (m, set, rect) => {
  rect(1, 4, 20, 10, 'k');                 // the pavement (grey flagstones)
  rect(1, 11, 20, 13, 'z');                // the road
  m.decor.push(
    { x: 10, y: 1, t: 'no10' },            // THE door of No. 10 (2 wide × 3 tall)
    { x: 10, y: 0, t: 'no10lamp' },        // the overthrow lamp above it
    { x: 5, y: 1, t: 'sash' }, { x: 7, y: 1, t: 'sash' },
    { x: 14, y: 1, t: 'sash' }, { x: 16, y: 1, t: 'sash' },
    { x: 6, y: 5, t: 'bollard' }, { x: 15, y: 5, t: 'bollard' },
    { x: 10, y: 4, t: 'doormat' },
  );
  for (let x = 1; x <= 20; x++) m.decor.push({ x, y: 10, t: 'railing' });   // railings at the kerb
  // sit on the most famous doorstep in the country
  m.pois = [{ x: 11, y: 5, emoji: '📸', type: 'text', texts: TXT_DOORSTEP }];
  m.holes = [[1, 12], [20, 12]];           // a couple of gutter mouseholes
  m.lamps = [[3.5, 3.5], [18.5, 3.5]];
  m.glows = [[10.6, 1.6, 70]];             // the lamp over the famous door, warm at night
  m.regions = [[0, 0, 21, 14, 'Downing Street']];
  m.transitions = [
    { x: 10, y: 4, to: 'ground', tx: 22, ty: 32 },   // back in through the door
    { x: 11, y: 4, to: 'ground', tx: 22, ty: 32 },
  ];
  m.npcs = [
    { x: 13, y: 5, sprite: 'officer', rect: [12, 5, 15, 6], quips: [
      'Morning. Mind the step.',
      'Quiet shift. Just you, me, and forty photographers.',
      'They\'re here for you, not the door. Everyone knows that.',
      'Best behaviour for the cameras, Chief Mouser. …Or don\'t. They\'ll love it either way.',
    ] },
    { x: 7, y: 12, sprite: 'press', rect: [3, 12, 9, 13], quips: [
      'Over here! Give us a look, Larry!',
      'One for the front page? Course you will.',
      'That\'s the shot. That\'s DEFINITELY the shot.',
    ] },
    { x: 14, y: 12, sprite: 'press', rect: [11, 12, 18, 13], quips: [
      'Chief Mouser! CHIEF MOUSER! …He blinked at me. Print it.',
      'Ten years on that step and never once posed. A legend.',
      'Hold the front page — cat sits down. STOP THE PRESSES.',
    ] },
  ];
  m.rainy = true;
  m.mouseCap = () => 3;
});

const NPC_SPRITES = { worker: P_WORKER, guard: P_GUARD, aide: P_AIDE, chef: P_CHEF, butler: P_BUTLER, gardener: P_GARDENER, press: P_PRESS, officer: P_GUARD };
const SECRET_TOTAL = Object.values(MAPS).reduce((n, m) => n + m.pois.filter(p => p.type === 'secret').length, 0);

// ---------- The Honours List ----------
const HONOURS = [
  { id: 'first', name: 'First Blood (Ceremonial)', test: () => G.catches >= 1 },
  { id: 'fifty', name: 'Fifty Mice for the Crown', test: () => G.catches >= 50 },
  { id: 'century', name: 'The Century', test: () => G.catches >= 100 },
  { id: 'hat', name: 'Hat-Trick Hero' },
  { id: 'secrets', name: 'Official Historian', test: () => G.secretsFound.size >= SECRET_TOTAL },
  { id: 'pm5', name: 'Outlasted Five PMs', test: () => pmCount >= 5 },
  { id: 'night10', name: 'Night Stalker', test: () => G.nightCatches >= 10 },
  { id: 'briefs5', name: 'Model Employee', test: () => G.briefsDone >= 5 },
  { id: 'ratking', name: 'Deposer of the Rat King' },
  { id: 'box', name: 'If It Fits, You Sits' },
  { id: 'decade', name: 'The Institution', test: () => pmCount >= 10 },
  { id: 'standoff', name: 'Staring Contest Champion' },
  { id: 'beloved', name: 'Darling of the Press', test: () => G.approval >= 95 },
  { id: 'menace', name: 'Registered National Menace', test: () => G.mischief.size >= MISCHIEF.length },
  { id: 'garter', name: 'Order of the Garter (Feline Div.)' },
  { id: 'vanity', name: 'Patron of the Arts (Self-Portraits)' },
  { id: 'newlife', name: 'Nine Lives (One Spent Well)' },
];
function earnHonour(id) {
  if (G.daily) return; // sorties run on a scratch profile; honours only count in the career
  if (G.honours.has(id)) return;
  const h = HONOURS.find(x => x.id === id);
  if (!h) return;
  G.honours.add(id);
  toast('🎖️ Honour earned: ' + h.name + '.');
  [659, 880, 1047, 1319].forEach((f, i) => tone(f, f, 0.13, 'triangle', 0.06, i * 0.09));
  save();
}
function checkHonours() {
  for (const h of HONOURS) if (h.test && !G.honours.has(h.id) && h.test()) earnHonour(h.id);
}

// ---------- The List of Mischief: a cat's true civic duties ----------
const MISCHIEF = [
  { id: 'teacup', text: "Knock the PM's teacup off the Cabinet table", hint: 'Something porcelain sits unguarded where great decisions are made…' },
  { id: 'vase', text: 'Topple the vase in the White Drawing Room', hint: 'Upstairs. Regency. Wobbly. Asking for it.' },
  { id: 'papers', text: 'Scatter the morning briefing in the Press Office', hint: 'Very important papers. Allegedly.' },
  { id: 'sandwich', text: "Steal the guard's sandwich", hint: 'Left unattended in the Entrance Hall. Amateur hour.' },
  { id: 'meowpress', text: 'Meow during a press conference', hint: 'Give the microphones something worth printing.' },
  { id: 'photobomb', text: 'Photobomb the press pack', hint: 'Be in shot when a flash pops.' },
  { id: 'boxes', text: 'Supervise the removal boxes', hint: 'A PM departs, boxes appear. Boxes require inspection.' },
  { id: 'radiator', text: 'Hold the famous radiator (45 uninterrupted seconds)', hint: 'The warmest seat in government. Defend it.' },
];
function earnMischief(id) {
  if (G.daily || G.mischief.has(id)) return;
  const it = MISCHIEF.find(x => x.id === id);
  if (!it) return;
  G.mischief.add(id);
  G.xp += 12;
  G.fish += 2;
  toast('😼 MISCHIEF: ' + it.text + ' ✓ (+12 XP · +2 🐟)');
  [523, 622, 740, 880].forEach((f, i) => tone(f, f, 0.09, 'triangle', 0.06, i * 0.07));
  while (G.xp >= xpNeed(G.level)) { G.xp -= xpNeed(G.level); G.level++; queueBeat(G.level); }
  checkHonours();
  updateHUD();
  save();
}

// knockable props: teacups exist to be pushed off tables. This is the law.
const KNOCK_DEFS = {
  teacup: { quip: '💥 CRASH. "That teacup was Wedgwood," whispers an aide. "WAS."', color: '#f3ead9', shatter: true },
  vase: { quip: '💥 The vase (Regency, irreplaceable) is now performance art. You feel nothing.', color: '#7fa8d4', shatter: true },
  papers: { quip: '📄 The morning briefing achieves flight. The Press Office weeps quietly.', color: '#efe9dc', shatter: false },
  sandwich: { quip: '🥪 The sandwich has been requisitioned. For security reasons.', color: '#d9b46a', shatter: false },
};
function setupKnocks() {
  G.knocks = (curMap().knockables || []).map(k => ({
    kind: k.kind, x: (k.x + 0.5) * TILE, y: k.y * TILE + 4, up: true, fallT: 0, respawn: 0,
  }));
}
function updateKnocks(dt) {
  const L = G.larry;
  for (const kn of G.knocks) {
    if (!kn.up) {
      if (kn.fallT > 0) {
        kn.fallT -= dt;
        if (kn.fallT <= 0) { // hits the floor
          const def = KNOCK_DEFS[kn.kind];
          addParticle(kn.x, kn.y + 12, def.color, def.shatter ? 8 : 5, def.shatter ? 34 : 20);
          if (def.shatter) { tone(2200, 900, 0.1, 'square', 0.06); tone(1400, 500, 0.16, 'square', 0.05, 0.06); G.shake = Math.max(G.shake, 0.08); }
          else tone(700, 400, 0.1, 'triangle', 0.05);
          toast(def.quip);
        }
      }
      kn.respawn -= dt;
      if (kn.respawn <= 0) kn.up = true;
      continue;
    }
    // sandwiches are stolen on contact; everything else needs a pounce or a paw
    const d = dist(kn.x, kn.y, L.x, L.y);
    if (kn.kind === 'sandwich' ? d < 10 : (L.pounceT > 0 && d < 17)) {
      kn.up = false; kn.fallT = kn.kind === 'sandwich' ? 0.01 : 0.28; kn.respawn = 90;
      earnMischief(kn.kind);
      if (kn.kind === 'sandwich') { addFloat(kn.x, kn.y - 10, 'chomp!', '#f0d0a0'); tone(300, 180, 0.08, 'square', 0.06); }
      else addFloat(kn.x, kn.y - 10, '!', '#f0d0a0');
    }
  }
}
function drawKnock(kn) {
  if (!kn.up && kn.fallT <= 0) return;
  const fall = kn.up ? 0 : (0.28 - kn.fallT) / 0.28;
  const x = Math.round(kn.x), y = Math.round(kn.y + fall * 10);
  ctx.save();
  ctx.translate(x, y);
  if (fall) ctx.rotate(fall * 1.4);
  if (kn.kind === 'teacup') {
    ctx.fillStyle = '#e6dcc4'; ctx.fillRect(-3, -1, 6, 1);          // saucer
    ctx.fillStyle = '#f6f0e2'; ctx.fillRect(-2, -4, 4, 3);          // cup
    ctx.fillStyle = '#c9a76a'; ctx.fillRect(-1, -4, 2, 1);          // tea
    ctx.fillStyle = '#f6f0e2'; ctx.fillRect(2, -3, 1, 2);           // handle
  } else if (kn.kind === 'vase') {
    ctx.fillStyle = '#7fa8d4'; ctx.fillRect(-2, -7, 4, 6);
    ctx.fillStyle = '#5d87b5'; ctx.fillRect(-1, -8, 2, 1); ctx.fillRect(-2, -3, 4, 1);
    ctx.fillStyle = '#a4c3e0'; ctx.fillRect(-2, -7, 1, 4);
  } else if (kn.kind === 'papers') {
    ctx.fillStyle = '#efe9dc'; ctx.fillRect(-3, -3, 7, 3);
    ctx.fillStyle = '#b9b2a2'; ctx.fillRect(-2, -2, 5, 1);
    ctx.fillStyle = '#cf2b3a'; ctx.fillRect(2, -3, 1, 1);           // TOP SECRET stamp
  } else if (kn.kind === 'sandwich') {
    ctx.fillStyle = '#e0c084'; ctx.fillRect(-3, -3, 6, 1); ctx.fillRect(-3, -1, 6, 1);
    ctx.fillStyle = '#8fae5a'; ctx.fillRect(-3, -2, 6, 1);
  }
  ctx.restore();
}

// ---------- Summons: politics barges in and demands a photograph ----------
const SUMMONS_SPOTS = [
  ['ground', 'The Cabinet Room', 'the trade delegation photo'],
  ['ground', 'The Entrance Hall', 'the doorstep arrival shot'],
  ['ground', 'The Garden', 'the garden reception'],
  ['first', 'The State Dining Room', 'the state dinner walkthrough'],
  ['first', 'The White Drawing Room', 'the ambassador\'s farewell'],
];
function startSummons() {
  const [mapId, region, why] = SUMMONS_SPOTS[(Math.random() * SUMMONS_SPOTS.length) | 0];
  // a photo-op is a quest, not a race: it stands until you wander over — no
  // countdown, no penalty for taking your time (the main arc is never timed)
  G.summons = { mapId, region, why, att: 0, shown: null };
  toast('📜 PHOTO-OP: ' + (G.pm || 'The PM') + ' would like you in ' + region + ' for ' + why + '. Wander over whenever — there is, of course, a treat in it.');
  tone(392, 392, 0.15, 'square', 0.06); tone(523, 523, 0.15, 'square', 0.06, 0.18);
  updateSummonsHUD();
}
function updateSummonsHUD() {
  // the photo-op lives inside the day tracker now — one corner block, one
  // narrative, no separate checklist line
  document.getElementById('summons').classList.add('hidden');
  updateDayHUD();
}

// ---------- Red Box briefs: little missions with XP attached ----------
// Each Red Box brief carries a `why` — the in-world reason it landed on your
// desk — shown when it's issued. `text` is the short objective for the HUD.
// The Red Box runs a SERIALIZED campaign, not a random shuffle: one long
// story of the mice organising — from probing the new cat, to a trained
// resistance, to an all-out siege directed from beneath the Cellar. Tasks are
// issued in order (G.briefStage); the escalating `why` texts continue the plot.
const CAMPAIGN = [
  { text: 'Catch 2 mice — first day in post', kind: 'catch', n: 2,
    why: 'Your first morning as Chief Mouser. The Cabinet Office would like proof you can, in fact, catch mice. Catch two, anywhere. Set the tone for the reign.' },
  { text: 'Clear 3 mice from the Kitchen', kind: 'catch', map: 'basement', n: 3,
    why: 'Word has gone round the skirting boards that the new cat is untested. The mice strike the Kitchen first, to see what you do. Clear three (downstairs, down the Grand Staircase).' },
  { text: 'Cut through the red tape', kind: 'yarn', n: 8,
    why: 'Your first true adversary at No. 10 is not a mouse. A ball of ministerial red tape has come loose in the corridors — and the mice are watching to see whether bureaucracy defeats you as it defeats everyone else. Cut through it.' },
  { text: 'Catch a swift brown mouse', kind: 'catch', type: 'swift', n: 1,
    why: 'They send a fast one — a scout, testing your speed while the rest watch from the dark. Catch the swift brown mouse and end the experiment before they draw conclusions.' },
  { text: 'Catch 2 mice in the Garden', kind: 'catch', region: 'The Garden', n: 2,
    why: 'Emboldened, the mice open a second front: fresh burrows out by the pond. This is coordination now, not chance. Do not let them dig in — catch two.' },
  { text: 'Catch a mouse after dark', kind: 'catch', night: true, n: 1,
    why: 'They have studied your habits. The raids now come after lights-out, when they are certain you are asleep. Catch one after dark and disabuse them of the notion.' },
  { text: 'Catch a trickster mouse', kind: 'catch', type: 'trick', n: 1,
    why: 'This is no longer a rabble. A trickster appears — it reads your pounce and sidesteps it. Something below is TRAINING them. Catch it: a quick tap beats a wind-up.' },
  { text: 'Take one strategic nap', kind: 'nap', n: 1,
    why: 'Intelligence suggests the mice mean to exhaust you — to keep you chasing shadows until you drop. Deny them. Take one dignified, strategic nap, and let them wonder what you know that they do not.' },
  { text: 'Catch a mouse on the First Floor', kind: 'catch', map: 'first', n: 1,
    why: 'They have breached the First Floor, where ambassadors dine and states are received. This cannot be borne. Catch one upstairs (up the Grand Staircase) and make the point in the room where points are made.' },
  { text: 'Catch a Very Still Mouse', kind: 'catch', type: 'still', n: 1,
    why: 'One mouse has sat motionless for days, memorising your routes — a saboteur, a spy for whatever now rules below the Cellar. Find the Very Still Mouse before it reports back.' },
  // ---- the siege proper: from here the campaign loops, escalating ----
  { text: 'Retake the Kitchen (3 mice)', kind: 'catch', map: 'basement', n: 3,
    why: 'The Kitchen has fallen a SECOND time — and this time they came in numbers, brazen and drilled. Retake it. Clear three. They must learn there is no second chance with you.' },
  { text: 'Cut through the red tape', kind: 'yarn', n: 8,
    why: 'The mice have discovered PAPERWORK. Red tape spools loose through every corridor, nearly to the Cabinet Room. Cut through it before the government notices the mice run it better than they do.' },
  { text: 'Hold the night (catch after dark)', kind: 'catch', night: true, n: 1,
    why: 'A coordinated night assault, floor to floor, directed by something large beneath the Cellar. Catch one after dark and send the message back up the chain: the night is still, and will remain, yours.' },
  { text: 'Hold the Garden (2 mice)', kind: 'catch', region: 'The Garden', n: 2,
    why: 'The siege spills outdoors; every wall of the house is being tested at once. Hold the Garden — catch two — and hold the line. They will not find it undefended while you draw breath.' },
];
const BRIEF_LOOP_FROM = 10; // once the campaign is done, cycle the "siege" tail forever
const HOLDING_BRIEF = { text: 'Keep up the patrols — catch 2 mice', kind: 'catch', n: 2,
  why: 'The picture below is still forming. Keep the pressure on while it clears — catch two more on your rounds.' };
// swift mice spawn from lv3, tricksters lv5, Very Still Mice lv7
function briefPossible(d) {
  if (d.type === 'swift' && G.level < 3) return false;
  if (d.type === 'trick' && G.level < 5) return false;
  if (d.type === 'still' && G.level < 7) return false;
  return true;
}
function newBrief() {
  const len = CAMPAIGN.length;
  const idx = G.briefStage < len ? G.briefStage
    : BRIEF_LOOP_FROM + (G.briefStage - BRIEF_LOOP_FROM) % (len - BRIEF_LOOP_FROM);
  let def = CAMPAIGN[idx];
  // if the next story beat needs a mouse we can't spawn yet, hold it and run a
  // holding-pattern patrol instead — the campaign never skips a beat
  if (!briefPossible(def)) def = HOLDING_BRIEF;
  else G.briefStage++;
  G.brief = { def, prog: 0 };
  toast('📕 NEW RED BOX TASK — ' + (def.why || def.text));
  tone(500, 700, 0.15, 'triangle', 0.06);
  updateHUD();
}
function briefEvent(kind, info = {}) {
  const b = G.brief;
  if (!b || G.intro.phase !== 'done') return;
  const d = b.def;
  if (d.kind !== kind) return;
  if (d.map && info.map !== d.map) return;
  if (d.type && info.type !== d.type) return;
  if (d.night && !info.night) return;
  if (d.region && info.region !== d.region) return;
  b.prog++;
  if (b.prog >= d.n) {
    G.brief = null;
    G.briefCD = 22;
    G.xp += 30;
    G.fish += 3;
    G.briefsDone++;
    toast('📕 TASK COMPLETE — the Red Box approves. +30 XP · +3 🐟. The next task will arrive shortly.');
    goalEvent('brief');
    sLevel();
    while (G.xp >= xpNeed(G.level)) { G.xp -= xpNeed(G.level); G.level++; queueBeat(G.level); }
    checkHonours();
  }
  updateHUD();
}

// ---------- Current-map helpers ----------
function curMap() { return MAPS[G.mapId]; }
function tileAt(px, py) {
  const m = curMap();
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return '#';
  return m.grid[ty][tx];
}
const isSolid = (px, py) => SOLID.has(tileAt(px, py));
function circleFree(px, py, r) {
  return !isSolid(px - r, py - r) && !isSolid(px + r, py - r) && !isSolid(px - r, py + r) && !isSolid(px + r, py + r);
}

// ---------- Audio ----------
let AC = null, muted = false;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(f0, f1, dur, type, vol, when = 0) {
  const a = audio(); if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, a.currentTime + when);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), a.currentTime + when + dur);
  g.gain.setValueAtTime(vol, a.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + when + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + when); o.stop(a.currentTime + when + dur + 0.02);
}
const sSqueak = () => { tone(1500, 2200, 0.09, 'sine', 0.12); tone(1900, 1300, 0.07, 'sine', 0.08, 0.09); };
const sCatch = () => { sSqueak(); tone(320, 160, 0.08, 'square', 0.08); playMotif(0.05, 0.026, 'triangle', 0.1); };
const sPounce = () => tone(500, 900, 0.1, 'triangle', 0.07);
const sLevel = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.14, 'square', 0.07, i * 0.09));
const sMeow = () => { tone(680, 520, 0.22, 'triangle', 0.1); tone(1360, 1040, 0.22, 'sine', 0.03); };
const sClick = () => tone(900, 700, 0.05, 'square', 0.05);
const sLaser = () => tone(1200, 2400, 0.15, 'sawtooth', 0.05);
const sStairs = () => { tone(300, 200, 0.1, 'triangle', 0.06); tone(260, 180, 0.1, 'triangle', 0.06, 0.12); };
// feline delights: the stuttering bird-chatter, a happy trill/mrrp, a stretch groan
const sChatter = () => { for (let i = 0; i < 6; i++) tone(1500 + Math.random() * 260, 1380, 0.03, 'square', 0.028, i * 0.055); };
const sTrill = () => { tone(680, 1120, 0.12, 'sine', 0.05); tone(1120, 900, 0.1, 'sine', 0.03, 0.1); };
const sStretch = () => { tone(480, 760, 0.36, 'sine', 0.05); };

// THE LARRY MOTIF — four notes (G C E D), the game's one musical signature.
// Quick and bright on a catch, square and proud on the title, slow and
// stately when the Evening Paper goes to print.
const MOTIF = [392, 523.25, 659.25, 587.33];
function playMotif(step = 0.09, vol = 0.05, type = 'triangle', when = 0) {
  MOTIF.forEach((f, i) => tone(f, f, step * 1.5, type, vol, when + i * step));
}

// a real purr: a low sawtooth rumble with the ~21Hz flutter cats actually
// have, instead of a bare sine blip. Respect the mute like everything else.
function purr(dur = 0.8, vol = 0.045) {
  const a = audio(); if (!a || muted) return;
  const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 46;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
  const g = a.createGain();
  const lfo = a.createOscillator(); lfo.frequency.value = 21;
  const lg = a.createGain(); lg.gain.value = vol * 0.55;
  lfo.connect(lg).connect(g.gain);
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.linearRampToValueAtTime(vol, a.currentTime + 0.16);
  g.gain.linearRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(lp).connect(g).connect(a.destination);
  o.start(); lfo.start();
  o.stop(a.currentTime + dur + 0.05); lfo.stop(a.currentTime + dur + 0.05);
}

// ---------- Rain on the window: looping filtered noise, ducked indoors ----------
let rainSrc = null, rainGain = null, rainFilt = null;
function rainAmbience() {
  const want = G.running && !G.paused && G.raining && !muted;
  if (!AC) return; // no audio until the first user gesture unlocks it
  if (want && !rainSrc) {
    const len = AC.sampleRate; // one second of noise, looped
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    rainSrc = AC.createBufferSource(); rainSrc.buffer = buf; rainSrc.loop = true;
    rainFilt = AC.createBiquadFilter(); rainFilt.type = 'lowpass';
    rainGain = AC.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(rainFilt).connect(rainGain).connect(AC.destination);
    rainSrc.start();
  }
  if (rainGain) {
    // outdoors it patters bright and close; through the sash windows it's a muffled wash
    const outside = G.mapId === 'ground' && G.larry.y < 10 * TILE;
    const target = want ? (outside ? 0.035 : 0.016) : 0;
    rainFilt.frequency.setTargetAtTime(outside ? 2400 : 520, AC.currentTime, 0.4);
    rainGain.gain.setTargetAtTime(target, AC.currentTime, 0.8);
    if (!want && rainGain.gain.value < 0.001 && rainSrc) {
      try { rainSrc.stop(); } catch (e) { }
      rainSrc = null; rainGain = null; rainFilt = null;
    }
  }
}

// ---------- Adaptive music: a generative score that follows the mood ----------
// calm wander → lazy pentatonic plucks · mouse nearby → sneaky under-layer
// speeds up · Rat King or the press → tense drone. All synthesized, tiny volume.
let musicOn = true, musNext = 0, musStep = 0, musIdx = 2;
// screen shake is off by default — the little judder on every catch reads as
// jitter, especially when a toast pops at the same moment. Opt back in via the
// pause menu; the choice persists in its own key (survives dailies + restarts).
let shakeOn = false;
try { shakeOn = localStorage.getItem('larry-shake') === 'on'; } catch (e) { }
const MUS_SCALE = [220, 246.94, 293.66, 329.63, 392, 440, 493.88, 587.33];
function musicTick() {
  if (!musicOn || muted || !AC || !G.running || G.paused) return;
  const t = AC.currentTime;
  if (t < musNext - 0.12) return;
  const danger = G.mice.some(mo => mo.type === 'ratking') || G.press.active;
  const stalk = !danger && G.mice.some(mo => dist(mo.x, mo.y, G.larry.x, G.larry.y) < 90);
  const tempo = danger ? 0.4 : stalk ? 0.62 : 1.15;
  const when = Math.max(0, musNext - t);
  musStep++;
  musIdx = clamp(musIdx + ((Math.random() * 3) | 0) - 1, 0, MUS_SCALE.length - 1);
  const f = MUS_SCALE[musIdx] * (G.isNight ? 0.5 : 1);
  tone(f, f, tempo * 0.9, 'triangle', G.isNight ? 0.011 : 0.016, when);
  if (musStep % 4 === 0) tone(110, 110, tempo * 1.7, 'sine', 0.02, when);
  if (stalk && musStep % 2 === 1) tone(f / 2, f / 2, tempo * 0.5, 'sine', 0.013, when);
  if (danger) tone(61.7, 61.7, tempo * 1.9, 'sawtooth', 0.009, when);
  musNext = (t > musNext + 1 ? t : musNext) + tempo;
}

// a commanding meow: startles nearby mice (tap Larry, B on a pad, Q on keys)
function meowNow() {
  if (!G.running || G.paused || G.napping) return;
  G.catAnim = { name: 'meow', t: 0, dur: 3 / 5, fps: 5 };
  sMeow();
  if (G.press.active) earnMischief('meowpress');
  for (const mo of G.mice) {
    if (dist(mo.x, mo.y, G.larry.x, G.larry.y) < 70 && mo.state !== 'charmed') {
      mo.state = 'stunned'; mo.stateT = 0.9;
      addFloat(mo.x, mo.y - 8, '!', '#f0d0a0');
    }
  }
}

// ---------- PMs & story ----------
// PMs are anonymous and numbered — they come and go; Larry remains.
const PM_EXITS = [
  'resigned to spend more time with their hedge. The hedge declined to comment.',
  'stepped down after losing a televised debate to a bowl of salad.',
  'was promoted to Minister for Looking Busy, effective immediately.',
  'called a snap election during karaoke night and lost to the karaoke machine.',
  'was last seen chasing their own manifesto down Whitehall.',
  'swapped jobs with the tea trolley "for efficiency reasons".',
  'moved next door to No. 11 for the bigger kitchen.',
  'got locked out and refused, on principle, to knock.',
  'attempted to reshuffle the Cabinet and lost track of where they put themselves.',
  'resigned by carrier pigeon. The pigeon has requested asylum.',
  'was defeated 1–0 by a lettuce in a leadership contest. The lettuce declined the job.',
  'departed to "pursue exciting opportunities", clutching the good stapler.',
  'tripped on the famous doorstep and kept walking, out of embarrassment, forever.',
  'was sworn in and out on the same afternoon, setting a record nobody wanted.',
  'left to write memoirs, which were mostly about you.',
  'stood down after the Cabinet voted, 22–1, to "just ask the cat instead".',
];
let pmCount = 0;
function nextPM() { pmCount++; return 'PM #' + pmCount; }
function exitReason(idx) { return PM_EXITS[(idx - 1) % PM_EXITS.length]; }

const GADGETS = {
  zoomies: { name: '👟 Bureaucratic Zoomies', desc: 'Go-faster booties from the security detail. TAP 👟 for a three-second burst of ludicrous speed (pounce recharges almost instantly while it lasts). Costs 2 🐟.' },
  whiskers: { name: '📡 Sonic Whiskers', desc: 'Standard MI-Paw issue. TAP 📡 to send out a sonar pulse that reveals every mouse on the floor for a few seconds — even through walls. Costs 2 🐟.' },
  collar: { name: '🎀 Diplomatic Collar', desc: 'A gift from a visiting delegation. TAP 🎀 to charm every nearby mouse — they stop dead, utterly besotted. (Nearby mice also flee a little slower, always.) Costs 3 🐟.' },
  laser: { name: '🔴 Laser Pointer of State', desc: 'Requisitioned from the Cabinet Room. TAP 🔴 to deploy the red dot; mice cannot resist it. (You can. Obviously. Mostly.) Costs 2 🐟.' },
  monocle: { name: '🌙 Night-Vision Monocle', desc: "MI-Paw's finest. TAP 🌙 to toggle night vision — nights (and the Cellar) look brighter and mice glow. Very dignified. Free to wear." },
  cape: { name: '🦸 Ceremonial Cape', desc: 'By Appointment. Mice are worth DOUBLE XP, always. TAP 🦸 to arm a SUPER POUNCE: your next pounce flies further and catches everything near the landing. Costs 4 🐟.' },
};

const FLAVOUR = [
  'The photocopier in the Press Office has achieved sentience. Unrelated: more mice.',
  'A junior minister tried to pet you without clearance. You allowed it. Morale +200%.',
  'The Cabinet debated your treat budget. It passed unanimously. Fear works.',
  'Someone left the Pantry open overnight. The mice have formed a committee.',
  'You were mentioned in the papers again. The PM was not. Awkward.',
  'A visiting dignitary bowed to you in the Entrance Hall. Protocol is protocol.',
  'Your approval rating remains the highest in the building. The building has noticed.',
  'The seating plan for the state dinner now lists you before the Chancellor.',
  'An intern was caught feeding you ham. The intern has been promoted by public demand.',
  'The Grand Staircase portraits were rehung an inch higher "for security reasons". Your radiator was not moved. Priorities.',
  'A think tank published a paper titled "The Larry Doctrine". You have not read it. You are it.',
  'Tourists outside chanted your name at a departing minister. The minister waved back. Embarrassing for everyone.',
  'The Treasury attempted to audit your treat budget and simply gave up.',
  'A wasp entered the Cabinet Room. You handled it. The official record says "decisively".',
];

function beatFor(level) {
  switch (level) {
    // ---- the gadget years: one arrives every OTHER level (2–12), so the
    //      toy-box fills up gradually instead of all in the first few minutes ----
    case 2: return { title: 'A Gift from Security', body: 'The officers at the door have been watching your work. They are impressed. They also have a locker full of confiscated novelty items.', gadget: 'zoomies' };
    case 3: return { title: 'The Van Outside', body: 'A removal van idles on Downing Street. {OLD} has {EXIT} A new PM arrives within the hour: {NEW}. Their portrait is already going up on the staircase. You remain. You always remain.', pmChange: true };
    case 4: return { title: 'A Package from MI-Paw', body: 'It arrived in the Pantry in a plain brown box marked "CATNIP — DO NOT OPEN". It was not catnip. It was a set of standard-issue sonic whiskers, and they are magnificent.', gadget: 'whiskers' };
    case 5: return { title: 'Another Van', body: 'You know the drill by now. {OLD} {EXIT} Incoming: {NEW}, who has promised "strong and stable saucers of milk". We shall see.', pmChange: true };
    case 6: return { title: 'The Delegation', body: 'A foreign delegation visited the Terracotta Room today. They ignored the Foreign Secretary entirely and queued to meet you. One of them left a gift.', gadget: 'collar' };
    case 7: return { title: 'Reports from Below', body: 'The kitchen staff refuse to fetch the good cheese after dark. The junior mice have started PAYING TRIBUTE. Somewhere beneath the Cellar, something enormous is holding court. MI-Paw stamps the file: KING RAT — AT LARGE. Keep an eye on the basement.' };
    case 8: return { title: 'The Cabinet Requisition', body: 'A red dot has been appearing on the Cabinet Room wall during meetings, reducing ministers to helpless distraction. Nobody could find the source. The source has now been requisitioned. It is yours.', gadget: 'laser' };
    case 9: return { title: 'The Palmerston Incident', body: '{OLD} {EXIT} Incoming: {NEW}. Meanwhile: the Foreign Office cat has been seen in YOUR garden, at YOUR pond, watching YOUR pigeons. He left a single feather on the terrace. This means war. Diplomatic war. (Win the stare-off.)', pmChange: true };
    case 10: return { title: 'Night Duty', body: 'MI-Paw has been watching your after-dark patrols with quiet approval. A flat package arrives, unmarked: their finest optics, cut for a cat. The Cellar holds no shadows for you now.', gadget: 'monocle' };
    case 11: return { title: 'The State Visit', body: 'A motorcade. Flags. A visiting head of state who, live on camera, walked straight past the receiving line and crouched to greet YOU. Two protocol officers fainted. The photograph is already framed in the Press Office.' };
    case 12: return { title: 'By Royal Appointment', body: 'A ceremony was held in the garden. For you. You are presented with a ceremonial cape, By Appointment. You wear it as though you were born in it — which, arguably, you were.', gadget: 'cape' };
    // ---- act three: the legend years ----
    case 13: return { title: 'The Van, and a Committee', body: '{OLD} {EXIT} Incoming: {NEW}. Downstairs, the mice have formed a negotiating committee. Their demands: unrestricted pantry access and a formal apology. Your counter-offer is scheduled for tonight. The counter-offer is you.', pmChange: true };
    case 14: return { title: 'The Christmas Card', body: "This year's official No. 10 Christmas card is a photograph of you on the Grand Staircase. The Prime Minister appears in the background, slightly out of focus. Nobody involved considers this an accident." };
    case 15: return { title: 'A Question in the House', body: '{OLD} {EXIT} Incoming: {NEW}. Also today, an MP formally asked the House whether the Chief Mouser is now "doing more governing than the government". The Speaker ruled the question "self-evidently true" and moved on.', pmChange: true };
    case 16: return { title: 'The Biography', body: 'An unauthorised biography has entered its third printing: "LARRY: THE POWER BEHIND THE DOOR". Serialised in three papers. You have not read it. You do not read about yourself. You simply occur, and history keeps up.' };
    // ---- the finale (a credits card follows; the game continues after) ----
    case 17: return { title: 'By Order of the Crown', body: 'A letter arrives bearing a seal you have only seen on television. The Palace "notes with approval the continued excellence of the Chief Mouser" and confers upon you the ORDER OF THE GARTER (FELINE DIVISION). The ceremony is held in the garden. Even Palmerston attends. He nods. Once.', finale: true };
    default: {
      if (level % 2 === 1) return { title: 'The Van. Again.', body: '{OLD} {EXIT} Incoming: {NEW}. The staircase is running out of wall for the portraits. You have been replaced zero times.', pmChange: true };
      return { title: 'Meanwhile, at No. 10…', body: FLAVOUR[(level / 2 | 0) % FLAVOUR.length] + ' The mice grow bolder. So do you.' };
    }
  }
}

// ---------- Game state ----------
const SAVE_KEY = 'larry-chief-mouser-v2';
const G = {
  running: false, paused: false,
  mapId: 'shelter',
  larry: { x: 11 * TILE, y: 10 * TILE, cvx: 0, cvy: 0, dir: 'down', flip: false, frame: 0, animT: 0, idleT: 0, pounceT: 0, pounceCD: 0, moving: false, px: 0, py: 1, charging: false, chargeT: 0, landT: 0, lastPower: 0, prevVX: 0, turnCD: 0 },
  mice: [], particles: [], floats: [], boxes: [], npcs: [], butterflies: [], toys: [], rivals: [],
  level: 1, xp: 0, catches: 0,
  pm: null, pmDays: 1, dayIdx: undefined,
  bowtie: false,
  intro: { phase: 'shelter', catches: 0 },
  visitor: null,
  time: 30, raining: false, rainT: 20,
  laser: null,
  toolCD: {}, zoomiesT: 0, sonarT: 0, sonarRingT: -1, nv: false, superArmed: false, shake: 0,
  press: { active: false, t: 0, cd: 35, catches: 0, bads: 0 }, paps: [],
  nearPoi: null, napping: false, napPos: null, catAnim: null, idleAnim: null,
  secretsFound: new Set(), brief: null, briefCD: 14, lastBrief: null, briefStage: 0, catchTimes: [], isNight: false,
  honours: new Set(), nightCatches: 0, briefsDone: 0, ratKingCD: 45, hitstop: 0, flash: 0,
  escapes: 0, snowing: false,
  cardQueue: [], camX: 0, camY: 0,
  fade: 0, fadeDir: 0, fadeCb: null, transCD: 0,
  region: '',
  approval: 72, crisis: false,
  diff: 'mouser', tie: 'union',
  daily: null, dailyRng: null,
  tut: 0, moveT: 0,
  mischief: new Set(), napKind: null, radT: 0, knocks: [],
  stam: 100, stamShown: -1,
  fish: 5, larder: 0,
  summons: null, summonsCD: 75, chefCD: 0,
  dream: null, dreamT: 0, dreamDone: false, dreamCD: 0,
  ownPortrait: 0, lives: 0,
};
const has = g => {
  const need = { zoomies: 2, whiskers: 4, collar: 6, laser: 8, monocle: 10, cape: 12 };
  return G.level >= need[g];
};
// exponential ramp while the gadgets flow (lv 1–10), then a gentle linear
// climb — late levels should cost ~30 catches, not 140. Base + exponent were
// raised (55→85, 1.28→1.24) so early levels don't fly past in the first
// minutes: the story DISPATCH cards fire on level-up, and levelling too fast
// meant they interrupted constantly. Late game stays roughly where it was.
const xpNeed = l => l <= 10
  ? Math.floor(85 * Math.pow(1.24, l - 1))
  : Math.floor(85 * Math.pow(1.24, 9) + (l - 10) * 95);

// ---------- Difficulty & bow ties ----------
const DIFFS = {
  // kitten still gets press visits (they gate two mischief entries) — the
  // pack just leaves without consequences when things go wrong
  kitten: { label: '🍼 Kitten', mSpd: 0.82, life: 1.6, press: true, pressPen: false },
  mouser: { label: '🐱 Mouser', mSpd: 1, life: 1, press: true, pressPen: true },
  chief: { label: '🎩 Chief Mouser', mSpd: 1.15, life: 0.72, press: true, pressPen: true },
};
const DIFF = () => DIFFS[G.diff] || DIFFS.mouser;
// cosmetic bow ties, unlocked by honours — worn with equal dignity
const TIES = [
  { id: 'union', name: 'Union Jack', need: 0, wing: '#1e3f8f', accent: '#cf2b3a', knot: '#f6f0e2' },
  { id: 'black', name: 'Black Tie', need: 2, wing: '#23262e', accent: '#3a3f4d', knot: '#8b93a6' },
  { id: 'tartan', name: 'Tartan', need: 4, wing: '#7a2430', accent: '#2c5232', knot: '#e0c56f' },
  { id: 'rose', name: 'Downing Rose', need: 6, wing: '#b85c7e', accent: '#8f3d5f', knot: '#f2d7e2' },
  { id: 'gold', name: 'State Gold', need: 8, wing: '#b8891f', accent: '#8a6410', knot: '#f3df9a' },
  { id: 'rainbow', name: 'Rainbow', need: 10, wing: '#d64550', accent: '#3f8f5a', knot: '#f2e28a' },
];
const tieDef = () => TIES.find(t => t.id === G.tie) || TIES[0];

function save() {
  if (G.daily) return; // daily sorties never touch the career save
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      level: G.level, xp: G.xp, catches: G.catches, pm: G.pm, pmDays: G.pmDays, pmCount,
      bowtie: G.bowtie, introDone: G.intro.phase === 'done', mapId: G.mapId,
      x: G.larry.x, y: G.larry.y, secrets: Array.from(G.secretsFound),
      honours: Array.from(G.honours), nightCatches: G.nightCatches, briefsDone: G.briefsDone, briefStage: G.briefStage, escapes: G.escapes,
      approval: Math.round(G.approval), diff: G.diff, tie: G.tie,
      mischief: Array.from(G.mischief),
      fish: G.fish, larder: G.larder,
      ownPortrait: G.ownPortrait || 0, lives: G.lives || 0,
    }));
  } catch (e) { }
}
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }

// ---------- The working day: the Morning Red Box and the Evening Paper ----------
// Every real calendar day deals three goals from the box (seeded — the same
// three for everyone). Finish all three and the Evening Paper goes to print:
// the day's numbers, a headline, a streak, and a reward. Career mode only.
const DAY_KEY = 'larry-day-v1';
const DAY_GOALS = [
  { id: 'mice', text: 'Catch {n} mice', n: 8, kind: 'catch' },
  { id: 'night', text: 'Catch {n} mice after dark', n: 2, kind: 'catch', night: true },
  { id: 'briefs', text: 'Clear {n} briefs from the Red Box', n: 2, kind: 'brief' },
  { id: 'naps', text: 'Take {n} dignified naps', n: 2, kind: 'nap' },
  { id: 'summons', text: 'Sit beautifully for a photo-op', n: 1, kind: 'summons', min: 3 },
  { id: 'press', text: 'Send the press home happy', n: 1, kind: 'press', min: 3 },
  { id: 'swift', text: 'Catch {n} swift brown mice', n: 2, kind: 'catch', type: 'swift', min: 3 },
  { id: 'trick', text: 'Catch a trickster (tap, don\'t wind up)', n: 1, kind: 'catch', type: 'trick', min: 5 },
  { id: 'still', text: 'Spot and catch a Very Still Mouse', n: 1, kind: 'catch', type: 'still', min: 7 },
  { id: 'fish', text: 'Bank {n} kippers', n: 6, kind: 'fish' },
];
const GOAL_PALM = { id: 'palm', text: 'Win a stare-off with Palmerston', n: 1, kind: 'palm' };
let DAY = null;
function dateStr(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function saveDay() { try { localStorage.setItem(DAY_KEY, JSON.stringify(DAY)); } catch (e) { } }
function goalDef(id) { return id === 'palm' ? GOAL_PALM : DAY_GOALS.find(x => x.id === id); }
// daily-goal quantities scale with rank — the job only gets bigger
function dayGoalN(g) {
  const L = G.level;
  if (g.id === 'mice') return Math.min(20, 6 + Math.floor(L * 0.7));
  if (g.id === 'fish') return Math.min(18, 5 + Math.floor(L * 0.5));
  if (g.id === 'night' || g.id === 'swift') return Math.min(5, 1 + Math.floor(L / 4));
  return g.n; // one-offs (trickster, still, summons, press, briefs, naps) stay singular
}
function initDay() {
  if (G.daily || G.intro.phase !== 'done') return;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(DAY_KEY)); } catch (e) { }
  const today = dateStr(REAL_DATE);
  if (prev && prev.date === today) {
    DAY = prev;
    updateDayHUD();
    if (!DAY.doneAll) {
      const done = DAY.goals.filter(g => g.prog >= g.n).length;
      toast('📦 The Red Box, resumed: ' + done + '/3 done today.');
    }
    return;
  }
  const yesterday = dateStr(new Date(REAL_DATE.getTime() - 86400000));
  const carried = prev && (prev.lastDone === yesterday || prev.lastDone === today) ? (prev.streak || 0) : 0;
  const streakLost = prev && prev.streak > 0 && !carried;
  // deal three goals, seeded by the date, level-appropriate — with quantities
  // that grow as the siege deepens (escalation, not a flat checklist)
  const rnd = mulberry32(DATE_SEED ^ 0x5EED);
  const pool = DAY_GOALS.filter(g => !g.min || G.level >= g.min);
  const picks = [];
  while (picks.length < 3 && pool.length) picks.push(pool.splice((rnd() * pool.length) | 0, 1)[0]);
  if (PALM_VISIT && G.level >= 4) picks[0] = GOAL_PALM;
  DAY = {
    date: today, streak: carried, lastDone: prev ? prev.lastDone : null, doneAll: false,
    goals: picks.map(g => { const n = dayGoalN(g); return { id: g.id, text: g.text.replace('{n}', n), n, prog: 0 }; }),
    stats: { catch: 0, escape: 0, brief: 0, fish: 0, palm: 0 },
    ap0: Math.round(G.approval),
  };
  saveDay();
  updateDayHUD();
  const intro = DAY.streak >= 7 ? 'Another dawn, another box, and still the mice have not learned. This morning\'s items:'
    : DAY.streak >= 3 ? 'The mice did not relent overnight. Neither does the box. Today\'s items:'
      : G.level >= 8 ? 'The morning box lands with a heavier thud these days. Today\'s items:'
        : 'The morning box arrives. Today\'s items, in order of national importance:';
  const lines = [intro, ''].concat(DAY.goals.map(g => '📕 ' + g.text));
  lines.push('');
  if (PALM_VISIT) lines.push('🎩 Intelligence: Palmerston is visiting today. The garden is NOT neutral.');
  if (IS_XMAS) lines.push('🎄 It is also Christmas. The tree has been assessed. (Climbable.)');
  if (IS_GOTCHA_DAY) { lines.push('🎉 And it is your Gotcha Day — hired 15 Feb 2011, on merit. The kitchen sends up 10 🐟.'); G.fish += 10; }
  lines.push(DAY.streak > 0 ? '🔥 Streak: ' + DAY.streak + ' day' + (DAY.streak === 1 ? '' : 's') + '. The papers are counting.'
    : streakLost ? 'The streak has lapsed. The nation, graciously, forgets.' : 'Finish all three and the Evening Paper prints something flattering.');
  showCard('THE MORNING RED BOX', 'Today at No. 10', lines.join('\n'), null, null);
}
function updateDayHUD() {
  const el = document.getElementById('daybox');
  if (!el) return;
  if (!DAY || G.daily || G.intro.phase !== 'done') { el.classList.add('hidden'); return; }
  const done = DAY.goals.filter(g => g.prog >= g.n).length;
  let txt = DAY.doneAll ? '📦 ✓ day well governed · 🔥 ' + DAY.streak : '📦 Red Box ' + done + '/3';
  if (G.summons) txt += '\n📸 photo-op: ' + G.summons.region + (G.summons.att > 0.5 ? ' — hold still…' : '');
  el.textContent = txt;
  el.classList.remove('hidden');
}
function goalEvent(kind, info = {}) {
  if (!DAY || G.daily || G.intro.phase !== 'done') return;
  if (kind === 'catch') DAY.stats.catch++;
  else if (kind === 'escape') DAY.stats.escape++;
  else if (kind === 'brief') DAY.stats.brief++;
  else if (kind === 'fish') DAY.stats.fish += info.n || 1;
  else if (kind === 'palm') DAY.stats.palm = DAY.stats.palm || 0;
  let changed = false;
  for (const g of DAY.goals) {
    if (g.prog >= g.n) continue;
    const def = goalDef(g.id);
    if (!def || def.kind !== kind) continue;
    if (def.type && info.type !== def.type) continue;
    if (def.night && !info.night) continue;
    g.prog = Math.min(g.n, g.prog + (kind === 'fish' ? (info.n || 1) : 1));
    changed = true;
    if (g.prog >= g.n) {
      const done = DAY.goals.filter(x => x.prog >= x.n).length;
      if (done < 3) toast('📦 Red Box: ' + g.text + ' ✓ (' + done + '/3)');
    }
  }
  if (changed && !DAY.doneAll && DAY.goals.every(g => g.prog >= g.n)) eveningPaper();
  else updateDayHUD();
  saveDay();
}
function eveningPaper() {
  const yesterday = dateStr(new Date(REAL_DATE.getTime() - 86400000));
  DAY.doneAll = true;
  DAY.streak = (DAY.lastDone === yesterday ? (DAY.streak || 0) : 0) + 1;
  DAY.lastDone = DAY.date;
  G.fish += 6;
  G.xp += 25;
  const s = DAY.stats;
  const apd = Math.round(G.approval) - DAY.ap0;
  const heads = ['MOUSER DELIVERS', 'THE CAT GOVERNS ON', 'BOX TICKED, NATION SECURE', 'NOTHING GETS PAST HIM', 'COMPETENCE SPOTTED AT NO. 10'];
  const body =
    'The Evening Paper goes to print:\n\n' +
    '🐭 ' + s.catch + ' caught · 💨 ' + s.escape + ' escaped\n' +
    '📕 ' + s.brief + ' briefs cleared · 🐟 ' + s.fish + ' kippers banked\n' +
    '📊 Approval ' + (apd >= 0 ? '+' : '') + apd + '% on the day' +
    (s.ops ? '\n📸 ' + s.ops + ' photo-op' + (s.ops === 1 ? '' : 's') + ' attended, beautifully' : '') +
    (s.palm ? '\n🎩 Palmerston: ' + s.palm + ' mice poached. Noted. Filed. Unforgiven.' : '') +
    (G.brief ? '\n\n📕 Tomorrow\'s Red Box, already on the desk: "' + G.brief.def.text + '"' : '') +
    '\n\n🔥 Streak: ' + DAY.streak + ' day' + (DAY.streak === 1 ? '' : 's') + ' with the box cleared.' +
    '\n\nReward: +6 🐟 · +25 XP. Larry may now nap with a completely clear conscience.';
  showCard('THE EVENING PAPER', '"' + pick(heads) + '"', body, null, () => {
    while (G.xp >= xpNeed(G.level)) { G.xp -= xpNeed(G.level); G.level++; queueBeat(G.level); }
    updateHUD();
    maybeShowCard();
  });
  playMotif(0.3, 0.06, 'triangle');                    // the motif, slow and stately: the presses roll
  tone(MOTIF[0] / 2, MOTIF[0] / 2, 1.2, 'sine', 0.045); // under a long, satisfied root note
  saveDay();
  updateDayHUD();
}

// ---------- Input ----------
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) chargeStart('key'); }
  if (e.key === 'Escape') { houseMapOpen() ? closeHouseMap() : menuOpen ? closeMenu() : openMenu(); }
  if (e.key.toLowerCase() === 'm') toggleHouseMap(); // pull up the house map
  if (e.key.toLowerCase() === 'e') useTool(TOOLS[3]); // laser
  if (e.key.toLowerCase() === 'q') meowNow();
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= TOOLS.length) useTool(TOOLS[n - 1]);
});
window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === ' ') chargeRelease('key');
});
// focus loss: drop any held charge, joystick and keys — never fire a surprise pounce
function inputBlur() {
  chargeCancel();
  resetStick();
  for (const k in keys) keys[k] = false;
}
window.addEventListener('blur', inputBlur);
document.addEventListener('visibilitychange', () => { if (document.hidden) inputBlur(); });

const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0, t0: 0, moved: false };
let tapTarget = null; // tap-to-walk destination in world px
const stickEl = document.getElementById('stick'), nubEl = document.getElementById('stickNub');
function joyVec() {
  let x = 0, y = 0;
  if (keys['a'] || keys['arrowleft']) x -= 1;
  if (keys['d'] || keys['arrowright']) x += 1;
  if (keys['w'] || keys['arrowup']) y -= 1;
  if (keys['s'] || keys['arrowdown']) y += 1;
  if (x || y) { tapTarget = null; const m = Math.hypot(x, y); return { x: x / m, y: y / m }; }
  const pv = padAxes();
  if (pv) { tapTarget = null; return pv; }
  if (joy.active) {
    const m = Math.hypot(joy.dx, joy.dy);
    if (m > 4) {
      tapTarget = null;
      const c = Math.min(1, m / 28);
      return { x: joy.dx / m * c, y: joy.dy / m * c };
    }
  }
  if (tapTarget) {
    const d = dist(G.larry.x, G.larry.y, tapTarget.x, tapTarget.y);
    if (d > 6) return { x: (tapTarget.x - G.larry.x) / d, y: (tapTarget.y - G.larry.y) / d };
    tapTarget = null;
  }
  return { x: 0, y: 0 };
}
// Unified input: Pointer Events when available (modern mobile webviews,
// desktop mouse), raw touch events as the fallback.
function resetStick() {
  joy.active = false;
  nubEl.style.transform = '';
  stickEl.style.left = '26px'; stickEl.style.top = 'auto'; stickEl.style.bottom = 'calc(30px + env(safe-area-inset-bottom))';
}
function inputStart(id, cx, cy) {
  if (joy.active) return;
  joy.active = true; joy.id = id; joy.cx = cx; joy.cy = cy;
  joy.dx = joy.dy = 0; joy.t0 = performance.now(); joy.moved = false;
  stickEl.style.left = (cx - 55) + 'px'; stickEl.style.top = (cy - 55) + 'px'; stickEl.style.bottom = 'auto';
}
function inputMove(id, cx, cy) {
  if (!joy.active || id !== joy.id) return;
  joy.dx = cx - joy.cx; joy.dy = cy - joy.cy;
  const m = Math.hypot(joy.dx, joy.dy), c = Math.min(m, 38);
  if (m > 10) joy.moved = true;
  nubEl.style.transform = m > 1 ? `translate(${joy.dx / m * c}px,${joy.dy / m * c}px)` : '';
}
function inputEnd(id, cx, cy) {
  if (!joy.active || id !== joy.id) return;
  // a quick press that never dragged = "walk here" (or a chin-scritch meow on Larry)
  if (!joy.moved && performance.now() - joy.t0 < 350 && G.running && !G.paused) {
    const wx = clamp(G.camX + cx * DPR / ZOOM, TILE, (curMap().w - 1) * TILE);
    const wy = clamp(G.camY + cy * DPR / ZOOM, TILE, (curMap().h - 1) * TILE);
    if (dist(wx, wy, G.larry.x, G.larry.y) < 16 && !G.napping) {
      meowNow();
    } else {
      tapTarget = { x: wx, y: wy, lastD: Infinity, stuckT: 0 };
    }
  }
  resetStick();
}
if (window.PointerEvent) {
  window.addEventListener('pointerdown', e => {
    audio();
    if (e.target.closest('button') || !G.running || G.paused) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    inputStart(e.pointerId, e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('pointermove', e => {
    if (!joy.active || e.pointerId !== joy.id) return;
    if (e.cancelable) e.preventDefault();
    inputMove(e.pointerId, e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('pointerup', e => inputEnd(e.pointerId, e.clientX, e.clientY));
  window.addEventListener('pointercancel', e => { if (joy.active && e.pointerId === joy.id) resetStick(); });
} else {
  window.addEventListener('touchstart', e => {
    audio();
    if (e.target.closest('button') || !G.running || G.paused) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    inputStart(t.identifier, t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    if (!joy.active) return;
    for (const t of e.changedTouches) if (t.identifier === joy.id) {
      e.preventDefault();
      inputMove(t.identifier, t.clientX, t.clientY);
    }
  }, { passive: false });
  window.addEventListener('touchend', e => {
    for (const t of e.changedTouches) inputEnd(t.identifier, t.clientX, t.clientY);
  }, { passive: true });
}
// belt and braces for mobile webviews: never let the page pan, zoom or bounce
document.addEventListener('touchmove', e => {
  if (G.running && !G.paused) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.documentElement.style.touchAction = 'none';
document.body.style.touchAction = 'none';
canvas.style.touchAction = 'none';

// ---------- Gamepad ----------
// stick / d-pad to move · A pounce · B meow · X/Y/LB/RB/select/RT gadgets · start = menu
// browsers fire gamepadconnected on the pad's first input even if it was
// plugged in before load, so until then we skip getGamepads() entirely —
// phones never pay for a controller they don't have
let padPrev = [], padSeen = false;
function padAxes() {
  if (!padSeen) return null;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    let x = p.axes[0] || 0, y = p.axes[1] || 0;
    if (p.buttons[12] && p.buttons[12].pressed) y = -1;
    if (p.buttons[13] && p.buttons[13].pressed) y = 1;
    if (p.buttons[14] && p.buttons[14].pressed) x = -1;
    if (p.buttons[15] && p.buttons[15].pressed) x = 1;
    const m = Math.hypot(x, y);
    if (m > 0.25) return { x: x / Math.max(1, m), y: y / Math.max(1, m) };
  }
  return null;
}
let padA = false;
const PAD_MAP = [
  [1, () => meowNow()],
  [2, () => useTool(TOOLS[1])], [3, () => useTool(TOOLS[0])],
  [4, () => useTool(TOOLS[2])], [5, () => useTool(TOOLS[3])],
  [6, () => useTool(TOOLS[4])], [7, () => useTool(TOOLS[5])],
  [9, () => (menuOpen ? closeMenu() : openMenu())],
];
function pollPad() {
  if (!padSeen) return;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    for (const [i, fn] of PAD_MAP) {
      const dn = !!(p.buttons[i] && p.buttons[i].pressed);
      if (dn && !padPrev[i]) fn();
      padPrev[i] = dn;
    }
    const a = !!(p.buttons[0] && p.buttons[0].pressed); // A: hold to charge
    if (a && !padA) chargeStart('pad');
    if (!a && padA) chargeRelease('pad');
    padA = a;
    break;
  }
}
window.addEventListener('gamepadconnected', () => {
  padSeen = true;
  toast('🎮 Controller connected: stick to move · A pounce · B meow · face/shoulder buttons for gadgets · START for menu');
});

// ---------- Actions ----------
function interactPoi(p) {
  // ---- the kipper economy's proper sinks: intel and vanity ----
  if (p.type === 'chefdeal') {
    if (G.fish < 4) { toast('🤝 The chef eyes your tin. "Four kippers and the pantry door swings open. You\'re short." He returns to the soup.'); sClick(); return; }
    showChoice('THE KITCHEN — OFF THE RECORD', 'The Chef\'s Arrangement',
      'The chef wipes his hands and leans in. "Four kippers, and the pantry door stays open for half a minute. What runs out of it is your department. I was never here. I am ALWAYS here — it\'s my kitchen. But you understand."',
      '🤝 Pay 4 🐟', '🚶 Another time', which => {
        if (which !== 'a') return;
        G.fish -= 4;
        const n = spawnMouseNear([[29, 4], [24, 8], [19, 6]], 3);
        G.sonarT = 8;
        toast('🚪 The pantry door swings. ' + n + ' mice bolt for the Kitchen — and your whiskers know EXACTLY where they are.');
        tone(500, 800, 0.15, 'triangle', 0.06);
        updateHUD();
      });
    return;
  }
  if (p.type === 'gardendeal') {
    if (G.fish < 3) { toast('🤝 The gardener tips his hat. "Three kippers and I\'ll show you where they\'re digging. Come back when you\'re flush."'); sClick(); return; }
    showChoice('THE GARDEN — A QUIET WORD', 'The Gardener\'s Tip',
      'The gardener leans on his rake. "Three kippers and I\'ll give the far burrow a poke with this. What comes out, comes out fast. The begonias saw nothing."',
      '🤝 Pay 3 🐟', '🚶 Another time', which => {
        if (which !== 'a') return;
        G.fish -= 3;
        const n = spawnMouseNear([[10, 1], [33, 6]], 2);
        G.sonarT = 8;
        toast('🌱 The rake goes in. ' + n + ' mice erupt from the burrow — the garden is suddenly very busy.');
        tone(500, 800, 0.15, 'triangle', 0.06);
        updateHUD();
      });
    return;
  }
  if (p.type === 'commission') {
    const PRICES = [25, 60, 120];
    const tier = G.ownPortrait || 0;
    if (tier >= 3) { toast('🖼️ Your portrait dominates the Grand Staircase. The wall can structurally support no further ambition. You inspect it anyway. Magnificent.'); sClick(); return; }
    const price = PRICES[tier];
    const PITCH = [
      'A discreet artist can be engaged. A modest study of yourself, in oils, hung on the Grand Staircase among the Prime Ministers. Entirely appropriate. Long overdue, frankly.',
      'The modest portrait no longer captures your standing. The artist proposes something GRANDER — gilt frame, commanding gaze, twice the canvas. The PMs\' portraits would, of course, appear slightly smaller by comparison. Unavoidable.',
      'The artist, trembling, proposes the final work: a portrait so ENORMOUS it requires two men and a permit. Visiting dignitaries would see it before they see the Prime Minister. This is, you feel, as it should be.',
    ];
    if (G.fish < price) { toast('🖼️ The artist quotes ' + price + ' 🐟 for the next portrait. Your tin holds ' + G.fish + '. Art waits for kippers.'); sClick(); return; }
    showChoice('THE GRAND STAIRCASE', 'A Commission (' + price + ' 🐟)', PITCH[tier],
      '🖼️ Commission it', '💰 Prudence, for now', which => {
        if (which !== 'a') return;
        G.fish -= price;
        G.ownPortrait = tier + 1;
        toast(['🖼️ The portrait is hung, low, at cat height, where it matters. You regard it. It regards you. Both approve.',
          '🖼️ The grander portrait goes up. A passing minister says "is that new?" You do not dignify it.',
          '🖼️ The ENORMOUS portrait is installed by two men and a permit. The staircase is now, officially, yours.'][tier]);
        playMotif(0.16, 0.05, 'triangle');
        if (G.ownPortrait >= 3) earnHonour('vanity');
        updateHUD();
        save();
      });
    return;
  }
  if (p.type === 'nap') {
    G.napping = true;
    G.larry.idleT = 0;
    G.dreamT = 0; G.dreamDone = false; // a fresh nap may bring a fresh dream
    G.napKind = p.texts; G.radT = 0;
    // climb onto the thing: cat-tree platform, inside the box, onto the cushion
    G.napPos = p.texts === TXT_TOWER ? { x: (p.x + 0.5) * TILE, y: p.y * TILE + 1 }
      : (p.texts === TXT_BOX || p.texts === TXT_WINDOW) ? { x: (p.x + 0.5) * TILE, y: (p.y + 0.45) * TILE }
        : null;
    toast(pick(p.texts || TXT_NAP));
    tone(500, 350, 0.3, 'sine', 0.05);
    briefEvent('nap');
    goalEvent('nap');
    if (p.texts === TXT_BOX) earnHonour('box');
    return;
  }
  if (p.type === 'honours') {
    const latest = [...G.honours].pop();
    const h = latest && HONOURS.find(x => x.id === latest);
    toast('🎖️ Career: ' + G.catches + ' caught, ' + G.escapes + ' escaped, ' + G.secretsFound.size + ' secrets uncovered, ' + G.honours.size + ' honours.' + (h ? ' Latest: ' + h.name + '.' : ' The Palace is watching. Catch things.'));
    sClick();
    return;
  }
  if (p.type === 'secret') {
    const first = !G.secretsFound.has(p.sid);
    if (first) {
      G.secretsFound.add(p.sid);
      addParticle((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, '#ffe8b8', 12, 44);
      [784, 1047, 1319].forEach((f, i) => tone(f, f, 0.12, 'sine', 0.06, i * 0.08));
      save();
      toast('✨ ' + p.fact);
    } else {
      // a found secret doesn't repeat itself — it rotates the fact file
      sClick();
      toast('✨ ' + pick(LARRY_FACTS));
    }
    return;
  }
  if (p.type === 'piano') {
    toast(pick(p.texts));
    [392, 523, 587, 494, 659, 784].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.06, i * 0.11));
    return;
  }
  if (p.type === 'scratch') {
    toast(pick(p.texts));
    G.catAnim = { name: 'scratchL', t: 0, dur: 11 / 8, fps: 8 };
    addParticle((p.x + 0.5) * TILE, (p.y + 0.5) * TILE - 4, '#c9b28a', 6, 30);
    tone(220, 140, 0.08, 'sawtooth', 0.05);
    tone(220, 140, 0.08, 'sawtooth', 0.05, 0.12);
    tone(220, 140, 0.08, 'sawtooth', 0.05, 0.24);
    return;
  }
  if (p.type === 'eat') {
    toast(pick(p.texts));
    G.catAnim = { name: 'eat', t: 0, dur: 8 / 5, fps: 5 };
    if (G.stam < 100) addFloat(G.larry.x, G.larry.y - 18, '+30 puff', '#7fd4a0');
    G.stam = Math.min(100, G.stam + 30);
    tone(400, 300, 0.06, 'triangle', 0.04); tone(400, 300, 0.06, 'triangle', 0.04, 0.3);
    return;
  }
  if (p.type === 'portrait') {
    let text;
    if (p.idx + 1 > pmCount) text = 'An empty frame. Waiting. It will not have to wait long.';
    else if (p.idx + 1 === pmCount) text = 'PM #' + pmCount + '. Current management. Adequate. For now.';
    else text = 'PM #' + (p.idx + 1) + '. Lasted ' + (21 + ((p.idx * 37) % 300)) + ' days. You outlasted them. Obviously.';
    toast(text);
    sClick();
    return;
  }
  toast(pick(p.texts));
  sClick();
}
function doPounce(power = 0) {
  if (!G.running || G.paused) return;
  const L = G.larry;
  if (G.napping) { wakeUp(); return; }
  // win a stare-off with a well-timed pounce
  for (const c of G.rivals) {
    if (c.state === 'stare' && dist(c.x, c.y, L.x, L.y) < 44) {
      c.state = 'walk'; c.tx = c.x + (c.x < L.x ? -60 : 60); c.ty = c.y - 30; c.t = 3;
      c.huntCD = 60; c.stareT = 0;
      G.xp += 20;
      toast('Palmerston withdraws. Diplomatically. +20 XP');
      earnHonour('standoff');
      goalEvent('palm');
      sMeow();
      while (G.xp >= xpNeed(G.level)) { G.xp -= xpNeed(G.level); G.level++; queueBeat(G.level); }
      updateHUD();
      return;
    }
  }
  // near something interesting with no mouse in play: a plain tap inspects instead
  // (a wound-up leap is always a leap — you meant it)
  if (power === 0 && G.nearPoi && !G.mice.some(mo => dist(mo.x, mo.y, L.x, L.y) < 55)) { interactPoi(G.nearPoi); return; }
  if (L.pounceCD > 0 || L.pounceT > 0) return;
  L.superP = G.superArmed;
  if (G.superArmed) { G.superArmed = false; G.shake = 0.25; addParticle(L.x, L.y, '#ffd98a', 12, 60); tone(400, 150, 0.25, 'square', 0.09); }
  L.lastPower = power;
  L.perfectDone = false;
  L.pounceT = pounceDur(L.superP, power); // charged leaps fly further
  // pouncing takes puff: a tired cat still leaps, just shorter and slower to reset
  const tired = G.stam < 25;
  G.stam = Math.max(0, G.stam - (8 + power * 10));
  if (tired) {
    L.pounceT *= 0.7;
    addFloat(L.x, L.y - 18, 'puffed…', '#a8c8d8');
  }
  L.pounceCD = (G.zoomiesT > 0 ? 0.25 : has('zoomies') ? 0.7 : 1.15) * (tired ? 1.5 : 1);
  const v = joyVec();
  if (v.x || v.y) { L.px = v.x; L.py = v.y; }
  else {
    L.px = L.dir === 'side' ? (L.flip ? -1 : 1) : 0;
    L.py = L.dir === 'down' ? 1 : L.dir === 'up' ? -1 : 0;
  }
  addParticle(L.x - L.px * 6, L.y + 6, '#cfc8b8', 5 + (power * 4 | 0), 26);
  sPounce();
  if (power > 0.5) tone(300, 700, 0.14, 'triangle', 0.05);
}
// hold to charge, release to fly: taps behave exactly as before.
// the one true pounce trajectory, shared by physics, sprite frames,
// squash-stretch and the aim marker — tune it in exactly one place
function pounceDur(superP, power) { return (superP ? 0.34 : 0.24) * (1 + power * 0.9); }
const POUNCE_SPD = 265;
// each charge is owned by the source that started it (key / ptr / pad), so a
// stray tap on another input can't detonate someone else's wind-up
function chargeStart(src) {
  const L = G.larry;
  if (!G.running || G.paused || L.charging) return false;
  L.charging = true;
  L.chargeSrc = src;
  L.chargeT = 0;
  return true;
}
function chargeRelease(src) {
  const L = G.larry;
  if (!L.charging || L.chargeSrc !== src) return;
  L.charging = false;
  const p = clamp(L.chargeT / 0.55, 0, 1);
  L.chargeT = 0;
  doPounce(p < 0.18 ? 0 : p);
}
// aborted gestures (pointercancel, focus loss) drop the charge without leaping
function chargeCancel() {
  const L = G.larry;
  L.charging = false;
  L.chargeT = 0;
}
function doLaser() {
  const L = G.larry;
  let dx = L.dir === 'side' ? (L.flip ? -1 : 1) : 0, dy = L.dir === 'down' ? 1 : L.dir === 'up' ? -1 : 0;
  const v = joyVec(); if (v.x || v.y) { dx = v.x; dy = v.y; }
  const m = curMap();
  let lx = L.x + dx * 70, ly = L.y + dy * 70;
  lx = clamp(lx, TILE, (m.w - 1) * TILE); ly = clamp(ly, TILE, (m.h - 1) * TILE);
  if (isSolid(lx, ly)) { lx = L.x + dx * 34; ly = L.y + dy * 34; }
  G.laser = { x: lx, y: ly, t: 3 };
  for (const mo of G.mice) if (dist(mo.x, mo.y, lx, ly) < 120) { mo.state = 'lured'; mo.stateT = 2.6; }
  sLaser();
}

// ---------- Gadgets are tools: tap to use ----------
const TOOLS = [
  { key: 'zoomies', emoji: '👟', cd: 10, cost: 2, use: () => { G.zoomiesT = 3; addParticle(G.larry.x, G.larry.y + 4, '#e9c46a', 8, 40); tone(300, 900, 0.25, 'sawtooth', 0.06); } },
  { key: 'whiskers', emoji: '📡', cd: 12, cost: 2, use: () => { G.sonarT = 5; G.sonarRingT = 0; tone(900, 1500, 0.2, 'sine', 0.07); tone(900, 1500, 0.2, 'sine', 0.04, 0.25); } },
  { key: 'collar', emoji: '🎀', cd: 14, cost: 3, use: () => { let n = 0; for (const mo of G.mice) if (dist(mo.x, mo.y, G.larry.x, G.larry.y) < 95) { mo.state = 'charmed'; mo.stateT = 3; n++; } addParticle(G.larry.x, G.larry.y, '#e77', 10, 60); tone(600, 900, 0.18, 'triangle', 0.07); tone(900, 1200, 0.18, 'triangle', 0.05, 0.2); if (n) addFloat(G.larry.x, G.larry.y - 18, n + ' charmed!', '#f0a5b5'); } },
  { key: 'laser', emoji: '🔴', cd: 8, cost: 2, use: doLaser },
  { key: 'monocle', emoji: '🌙', cd: 0, use: () => { G.nv = !G.nv; sClick(); }, isOn: () => G.nv },
  { key: 'cape', emoji: '🦸', cd: 15, cost: 4, use: () => { G.superArmed = true; tone(200, 500, 0.3, 'square', 0.06); addFloat(G.larry.x, G.larry.y - 18, 'SUPER POUNCE ARMED', '#ffd98a'); }, isOn: () => G.superArmed },
];
function useTool(t) {
  if (!G.running || G.paused || !has(t.key)) return;
  if (t.cd && (G.toolCD[t.key] || 0) > 0) return;
  if (t.cost && G.fish < t.cost) { // gadgets run on kippers now
    toast('🐟 Not enough kippers for ' + t.emoji + ' (' + t.cost + ' needed, ' + G.fish + ' in the tin). Catch more mice!');
    tone(220, 160, 0.12, 'square', 0.05);
    return;
  }
  if (t.cost) { G.fish -= t.cost; updateHUD(); }
  t.use();
  if (t.cd) G.toolCD[t.key] = t.cd;
}
// One-true button binding: pointerdown when supported (fires instantly on touch
// AND mouse, no 300ms delay, no double-fire), touchstart+click fallback otherwise.
function bindBtn(el, fn) {
  if (window.PointerEvent) {
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
    // keyboard/assistive activation dispatches a synthetic click with detail 0
    el.addEventListener('click', e => { if (e.detail === 0) fn(); });
  } else {
    el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('click', fn);
  }
}
function buildGadgetBar() {
  const bar = document.getElementById('gadgets');
  if (bar.dataset.built) return;
  bar.dataset.built = '1';
  TOOLS.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'gbtn hidden'; b.id = 'g_' + t.key;
    b.innerHTML = t.emoji + '<span class="key">' + (i + 1) + '</span>' + (t.cost ? '<span class="cost">🐟' + t.cost + '</span>' : '');
    bindBtn(b, () => useTool(t));
    bar.appendChild(b);
  });
}
function refreshGadgetBar() {
  for (const t of TOOLS) {
    const el = document.getElementById('g_' + t.key);
    if (el) el.classList.toggle('hidden', !has(t.key));
  }
}

// ---------- Mice ----------
const STEAL_LINES = [
  '🧀 A mouse made off with the good cheddar. Somewhere below, the Rat King smiles. (Larder: {n})',
  '🥧 The pork pie for Thursday has been… redistributed. The Rat King grows bold. (Larder: {n})',
  "🍰 A corner of the PM's birthday cake is GONE. This is personal now. (Larder: {n})",
  '🥖 The state-dinner baguette has left the building. The chef is inconsolable. (Larder: {n})',
  '🫖 Someone got into the biscuit tin marked CABINET USE ONLY. The audacity. (Larder: {n})',
  '🧈 The good butter. THE GOOD BUTTER. The Rat King dines like a lord tonight. (Larder: {n})',
];
function pickMouseType(rnd = Math.random) {
  const r = rnd();
  if (G.level >= 6 && r < 0.1 && !G.mice.some(mo => mo.type === 'rat')) return 'rat';
  if (G.level >= 7 && r < 0.24 && !G.mice.some(mo => mo.type === 'still')) return 'still';
  if (G.level >= 5 && r < 0.42) return 'trick';
  if (G.level >= 3 && r < 0.62) return 'swift';
  return 'grey';
}
function spawnMouse() {
  const m = curMap();
  if (G.mice.length >= m.mouseCap(G.level)) return;
  const rnd = G.daily ? G.dailyRng : Math.random; // daily sorties are seeded: same mice for everyone
  let pool = m.holes;
  // if the current brief wants garden mice, favour the garden burrows
  if (G.brief && G.brief.def.region === 'The Garden' && G.mapId === 'ground' && Math.random() < 0.6) {
    const gh = m.holes.filter(([, hy]) => hy <= 8);
    if (gh.length) pool = gh;
  }
  const [hx, hy] = pool[(rnd() * pool.length) | 0];
  const n = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of n) {
    const tx = hx + dx, ty = hy + dy;
    if (tx > 0 && ty > 0 && tx < m.w && ty < m.h && FLOORY(m.grid[ty][tx])) {
      const type = pickMouseType(rnd);
      G.mice.push({
        x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx: 0, ty: 0,
        state: 'wander', stateT: 0, dir: 1, animT: Math.random() * 9, scale: 0,
        type, hp: MOUSE_TYPES[type].hp, life: (16 + rnd() * 14) * DIFF().life, dodgeCD: 0, iframes: 0,
      });
      return;
    }
  }
}
// flush mice from specific holes (the chef's pantry door, the gardener's
// burrows) — paid intel turns kippers back into hunting
function spawnMouseNear(holes, n) {
  const m = curMap();
  let spawned = 0;
  for (let tries = 0; tries < n * 4 && spawned < n; tries++) {
    const [hx, hy] = holes[(Math.random() * holes.length) | 0];
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const tx = hx + dx, ty = hy + dy;
      if (tx > 0 && ty > 0 && tx < m.w && ty < m.h && FLOORY(m.grid[ty][tx])) {
        const type = pickMouseType();
        G.mice.push({
          x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx: 0, ty: 0,
          state: 'wander', stateT: 0, dir: 1, animT: Math.random() * 9, scale: 0,
          type, hp: MOUSE_TYPES[type].hp, life: (16 + Math.random() * 14) * DIFF().life, dodgeCD: 0, iframes: 0,
        });
        spawned++;
        break;
      }
    }
  }
  return spawned;
}

// the raiding pair: a loud decoy and a quiet accomplice with the cheese.
// Chase the squeaker and the cheddar walks out the door.
function spawnPair() {
  const m = curMap();
  const [hx, hy] = m.holes[(Math.random() * m.holes.length) | 0];
  const spots = [];
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]) {
    const tx = hx + dx, ty = hy + dy;
    if (tx > 0 && ty > 0 && tx < m.w && ty < m.h && FLOORY(m.grid[ty][tx])) spots.push([tx, ty]);
    if (spots.length >= 2) break;
  }
  if (spots.length < 2) return;
  [['decoy', spots[0]], ['raider', spots[1]]].forEach(([type, [tx, ty]]) => {
    G.mice.push({
      x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx: 0, ty: 0,
      state: 'wander', stateT: 0, dir: 1, animT: Math.random() * 9, scale: 0,
      type, hp: 1, life: (type === 'decoy' ? 26 : 18) * DIFF().life, dodgeCD: 0, iframes: 0,
    });
  });
  toast('🧀 A raiding pair! The squeaky one is a DISTRACTION — the quiet one has the cheese.');
  tone(900, 1400, 0.1, 'sine', 0.05); tone(500, 350, 0.14, 'triangle', 0.05, 0.12);
}
function nearestHole(mo) {
  const m = curMap();
  let best = null, bd = 1e9;
  for (const [hx, hy] of m.holes) {
    const n = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of n) {
      const tx = hx + dx, ty = hy + dy;
      if (tx > 0 && ty > 0 && tx < m.w && ty < m.h && FLOORY(m.grid[ty][tx])) {
        const d = dist(mo.x, mo.y, (tx + 0.5) * TILE, (ty + 0.5) * TILE);
        if (d < bd) { bd = d; best = [(tx + 0.5) * TILE, (ty + 0.5) * TILE]; }
        break;
      }
    }
  }
  return best;
}
// breadth-first route over the tile grid (maps are small), so escaping mice
// plan a path around the furniture instead of face-planting into a sofa
function findPath(pxFrom, pyFrom, pxTo, pyTo) {
  const m = curMap();
  const sx = clamp((pxFrom / TILE) | 0, 0, m.w - 1), sy = clamp((pyFrom / TILE) | 0, 0, m.h - 1);
  const txg = clamp((pxTo / TILE) | 0, 0, m.w - 1), tyg = clamp((pyTo / TILE) | 0, 0, m.h - 1);
  const key = (x, y) => y * m.w + x;
  const prev = new Int32Array(m.w * m.h).fill(-1);
  const q = [key(sx, sy)];
  prev[key(sx, sy)] = key(sx, sy);
  let head = 0;
  while (head < q.length) {
    const k = q[head++];
    const x = k % m.w, y = (k / m.w) | 0;
    if (x === txg && y === tyg) {
      const path = [];
      let c = k;
      while (prev[c] !== c) { path.push(c); c = prev[c]; }
      path.reverse();
      return path.map(pk => ({ x: (pk % m.w + 0.5) * TILE, y: (((pk / m.w) | 0) + 0.5) * TILE }));
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx2 = x + dx, ny2 = y + dy;
      if (nx2 < 0 || ny2 < 0 || nx2 >= m.w || ny2 >= m.h) continue;
      const nk = key(nx2, ny2);
      if (prev[nk] !== -1 || !FLOORY(m.grid[ny2][nx2])) continue;
      prev[nk] = k;
      q.push(nk);
    }
  }
  return null;
}
function mouseTarget(mo) {
  const m = curMap();
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 60;
    const x = mo.x + Math.cos(a) * r, y = mo.y + Math.sin(a) * r;
    if (x > TILE && y > TILE && x < (m.w - 1) * TILE && y < (m.h - 1) * TILE && !isSolid(x, y)) { mo.tx = x; mo.ty = y; return; }
  }
  mo.tx = mo.x; mo.ty = mo.y;
}
function updateMouse(mo, dt, idx) {
  const L = G.larry;
  const T = MOUSE_TYPES[mo.type] || MOUSE_TYPES.grey;
  mo.animT += dt; mo.scale = Math.min(1, mo.scale + dt * 4);
  mo.dodgeCD = Math.max(0, mo.dodgeCD - dt);
  mo.iframes = Math.max(0, mo.iframes - dt);
  if (mo.stateT > 0) mo.stateT -= dt;
  else if (mo.state === 'lured' || mo.state === 'charmed' || mo.state === 'stunned') mo.state = 'flee';
  const dL = dist(mo.x, mo.y, L.x, L.y);

  // ---- awareness: mice get absorbed in sniffing/grooming ("busy") ----
  // A busy mouse is oblivious — it holds still and its flee radius collapses,
  // so a patient stalk (creep in while charging) is rewarded with a guaranteed
  // catch. Rushing in at speed snaps it alert like any other mouse.
  mo.busy = Math.max(0, (mo.busy || 0) - dt);
  const larrySpd = Math.hypot(L.cvx, L.cvy);
  if (mo.state === 'wander' && mo.busy <= 0 && dL > 40 && Math.random() < dt * 0.22) {
    mo.busy = 1.7 + Math.random() * 1.5; // stops to sniff something fascinating
  }
  if (mo.busy > 0) {
    // startled out of it by noise-at-speed nearby, a landing pounce, or contact
    if ((dL < 62 && larrySpd > 42) || (L.pounceT > 0 && dL < 70 && larrySpd > 42) || dL < 12) {
      if (dL >= 12) { // it noticed you coming — the moment is gone
        mo.busy = 0; mo.state = 'flee';
        addFloat(mo.x, mo.y - 8, '!', '#f0d0a0');
      }
    } else if (Math.random() < dt * 1.2) {
      addFloat(mo.x, mo.y - 7, '…', '#cfc8b8'); // absorbed. utterly oblivious.
    }
  }

  // tricksters read a wound-up leap and sidestep it — a quick tap is too
  // fast to juke, so uncharged pounces are the counter (and a busy trickster
  // never sees it coming at all)
  if (T.dodge && mo.busy <= 0 && mo.dodgeCD <= 0 && L.pounceT > 0.15 && L.lastPower > 0.3 && dL < 46 && mo.state !== 'charmed' && mo.state !== 'stunned') {
    const px2 = -(mo.y - L.y), py2 = (mo.x - L.x);
    const pm = Math.max(1, Math.hypot(px2, py2)), side = Math.random() < 0.5 ? 1 : -1;
    const jx = mo.x + px2 / pm * 16 * side, jy = mo.y + py2 / pm * 16 * side;
    if (circleFree(jx, jy, 3)) { mo.x = jx; mo.y = jy; }
    mo.dodgeCD = 1.1;
    addParticle(mo.x, mo.y, '#cfc8b8', 3, 20);
    addFloat(mo.x, mo.y - 8, '!', '#f0d0a0');
  }

  // the Very Still Mouse: freezes when watched from a distance (near-
  // invisible unless the monocle or sonar is on), bolts when you get close
  if (T.freeze && mo.state !== 'charmed' && mo.state !== 'stunned' && mo.state !== 'lured' && mo.state !== 'leave') {
    // only a calm mouse freezes — once it bolts, it stays bolted until it
    // settles again (no flickering back to statue mid-flee)
    if (mo.state === 'wander' && dL > 30 && dL < 95) mo.state = 'freeze';
    else if (mo.state === 'freeze' && (dL <= 30 || dL >= 95)) {
      mo.state = dL <= 30 ? 'flee' : 'wander';
      if (dL <= 30) { addFloat(mo.x, mo.y - 8, '!!', '#f0d0a0'); tone(1600, 2400, 0.06, 'sine', 0.05); }
    }
  }

  // the decoy squeaks for attention, and slopes off once its partner is gone
  if (mo.type === 'decoy') {
    if (Math.random() < dt * 0.9) addFloat(mo.x, mo.y - 10, '♪ squeak!', '#ead9a2');
    if (Math.random() < dt && !G.mice.some(m2 => m2.type === 'raider')) mo.life = Math.min(mo.life, 0.1);
  }

  // heading home: mice that linger too long make for the nearest hole
  mo.life -= dt;
  if (mo.life <= 0 && (mo.state === 'wander' || mo.state === 'flee') && mo.state !== 'leave') {
    const h = nearestHole(mo);
    if (h) {
      mo.state = 'leave'; mo.hx = h[0]; mo.hy = h[1];
      mo.path = findPath(mo.x, mo.y, mo.hx, mo.hy); mo.pi = 0;
    }
    else mo.life = 10;
  }

  const calmDream = G.dream && G.dream.buff === 'calm';
  // a busy mouse barely notices the world: its flee radius collapses to 12px
  const fleeAt = mo.busy > 0 ? 12 : (calmDream ? 52 : 62);
  if (mo.state !== 'lured' && mo.state !== 'charmed' && mo.state !== 'stunned' && mo.state !== 'leave' && mo.state !== 'freeze' && dL < fleeAt) mo.state = 'flee';
  else if (mo.state === 'flee' && dL > 110) { mo.state = 'wander'; mouseTarget(mo); }

  const fleeSpd = (55 + Math.min(20, G.level * 2)) * T.spd * DIFF().mSpd * (calmDream ? 0.93 : 1) * (mo.type === 'decoy' ? 0.55 : 1);
  let sp = 22 * T.spd, vx = 0, vy = 0;
  if (mo.state === 'charmed' || mo.state === 'stunned' || mo.state === 'freeze') {
    sp = 0;
    if (mo.state === 'charmed' && Math.random() < dt * 3) addParticle(mo.x, mo.y - 6, '#e77');
  } else if (mo.state === 'leave') {
    sp = fleeSpd * 0.85;
    // follow the plotted route home, waypoint by waypoint
    let txp = mo.hx, typ = mo.hy;
    if (mo.path && mo.pi < mo.path.length) {
      const wp = mo.path[mo.pi];
      if (dist(mo.x, mo.y, wp.x, wp.y) < 5) mo.pi++;
      if (mo.pi < mo.path.length) { txp = mo.path[mo.pi].x; typ = mo.path[mo.pi].y; }
    }
    const dw = Math.max(1, dist(mo.x, mo.y, txp, typ));
    vx = (txp - mo.x) / dw; vy = (typ - mo.y) / dw;
    if (dist(mo.x, mo.y, mo.hx, mo.hy) < 6) { // gone
      addParticle(mo.x, mo.y, '#8a8378', 5, 20);
      addFloat(mo.x, mo.y - 8, pick(GOTAWAY_LINES), '#c9b7a0');
      G.escapes++;
      goalEvent('escape');
      // only mice that actually got at the food provision the Rat King:
      // cheese-carriers always, opportunists only down in the pantry itself.
      // (An ordinary escape upstairs stings once, not three times.)
      if (!G.daily && (T.carry || (G.mapId === 'basement' && Math.random() < 0.4))) {
        G.larder++;
        toast(T.carry
          ? '🧀 The quiet one made it home WITH the cheddar. Somewhere below, the Rat King applauds. (Larder: ' + G.larder + ')'
          : STEAL_LINES[G.larder % STEAL_LINES.length].replace('{n}', G.larder));
        tone(340, 220, 0.14, 'triangle', 0.05);
      }
      G.approval = Math.max(0, G.approval - (G.press.active && DIFF().pressPen ? 6 : 2));
      if (G.press.active) { G.press.bads++; }
      if (G.daily) {
        G.daily.escaped++; G.daily.combo = 0;
        G.daily.score = Math.max(0, G.daily.score - 50);
        G.daily.shown = -1;
        addFloat(mo.x, mo.y - 16, '-50', '#f0a0a0');
      }
      G.mice.splice(idx, 1);
      return;
    }
  } else if (mo.state === 'flee') {
    sp = fleeSpd;
    const d = Math.max(1, dL); vx = (mo.x - L.x) / d; vy = (mo.y - L.y) / d;
  } else if (mo.state === 'lured' && G.laser) {
    sp = 66;
    const d = Math.max(1, dist(mo.x, mo.y, G.laser.x, G.laser.y));
    if (d > 6) { vx = (G.laser.x - mo.x) / d; vy = (G.laser.y - mo.y) / d; } else sp = 0;
  } else if (mo.busy > 0) {
    sp = 0; // rooted to the spot, nose-deep in something fascinating
  } else {
    if (!mo.tx || dist(mo.x, mo.y, mo.tx, mo.ty) < 6 || Math.random() < dt * 0.3) mouseTarget(mo);
    const d = Math.max(1, dist(mo.x, mo.y, mo.tx, mo.ty)); vx = (mo.tx - mo.x) / d; vy = (mo.ty - mo.y) / d;
  }
  if (has('collar') && dL < 48 && mo.state !== 'lured' && sp > 0) {
    sp *= 0.55;
    if (Math.random() < dt * 2) addParticle(mo.x, mo.y - 6, '#e77');
  }
  if (vx) mo.dir = vx > 0 ? 1 : -1;
  const nx = mo.x + vx * sp * dt, ny = mo.y + vy * sp * dt;
  if (circleFree(nx, mo.y, 3)) mo.x = nx; else if (mo.state !== 'leave') mouseTarget(mo);
  if (circleFree(mo.x, ny, 3)) mo.y = ny; else if (mo.state !== 'leave') mouseTarget(mo);
}

// ---------- NPCs ----------
function setupNpcs() {
  G.npcs = curMap().npcs.map(n => ({
    x: (n.x + 0.5) * TILE, y: (n.y + 0.5) * TILE, tx: 0, ty: 0,
    sprite: n.sprite, rect: n.rect, quips: n.quips,
    pauseT: 1 + Math.random() * 2, animT: Math.random() * 9, quipCD: 3, flip: false,
  }));
}
function updateNpc(n, dt) {
  n.animT += dt;
  n.quipCD = Math.max(0, n.quipCD - dt);
  if (n.quipCD <= 0 && dist(n.x, n.y, G.larry.x, G.larry.y) < 30) {
    toast(pick(n.quips));
    n.quipCD = 12;
  }
  if (n.pauseT > 0) { n.pauseT -= dt; return; }
  if (!n.tx || dist(n.x, n.y, n.tx, n.ty) < 4) {
    const [x0, y0, x1, y1] = n.rect;
    for (let i = 0; i < 8; i++) {
      const tx = (x0 + Math.random() * (x1 - x0) + 0.5) * TILE, ty = (y0 + Math.random() * (y1 - y0) + 0.5) * TILE;
      if (!isSolidOn(curMap(), tx, ty)) { n.tx = tx; n.ty = ty; break; }
    }
    n.pauseT = 1.5 + Math.random() * 3;
    return;
  }
  const d = Math.max(1, dist(n.x, n.y, n.tx, n.ty));
  const vx = (n.tx - n.x) / d, vy = (n.ty - n.y) / d;
  n.flip = vx < 0;
  const nx = n.x + vx * 16 * dt, ny = n.y + vy * 16 * dt;
  if (circleFreeOn(curMap(), nx, n.y, 4)) n.x = nx; else n.tx = 0;
  if (circleFreeOn(curMap(), n.x, ny, 4)) n.y = ny; else n.tx = 0;
}
function isSolidOn(m, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
  return SOLID.has(m.grid[ty][tx]);
}
function circleFreeOn(m, px, py, r) {
  return !isSolidOn(m, px - r, py - r) && !isSolidOn(m, px + r, py - r) && !isSolidOn(m, px - r, py + r) && !isSolidOn(m, px + r, py + r);
}

// ---------- Yarn balls: battable physics toys ----------
function setupToys() {
  G.toys = (curMap().toys || []).map(([x, y, color]) => ({
    x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, vx: 0, vy: 0, color, spin: 0,
  }));
}
function updateToy(t, dt) {
  const L = G.larry;
  const d = dist(t.x, t.y, L.x, L.y);
  if (d < 10 && (L.moving || L.pounceT > 0)) { // batted!
    if (Math.hypot(t.vx, t.vy) < 20) briefEvent('yarn');
    const push = L.pounceT > 0 ? 190 : 120;
    const dx2 = (t.x - L.x) / Math.max(1, d), dy2 = (t.y - L.y) / Math.max(1, d);
    t.vx = dx2 * push + L.cvx * 0.4;
    t.vy = dy2 * push + L.cvy * 0.4;
    tone(700 + Math.random() * 200, 500, 0.06, 'triangle', 0.04);
  }
  const fr = Math.pow(0.12, dt); // friction
  t.vx *= fr; t.vy *= fr;
  if (Math.abs(t.vx) < 2) t.vx = 0;
  if (Math.abs(t.vy) < 2) t.vy = 0;
  const nx = t.x + t.vx * dt, ny = t.y + t.vy * dt;
  if (circleFree(nx, t.y, 3)) t.x = nx; else t.vx = -t.vx * 0.6;
  if (circleFree(t.x, ny, 3)) t.y = ny; else t.vy = -t.vy * 0.6;
  t.spin += (Math.abs(t.vx) + Math.abs(t.vy)) * dt * 0.1;
}
function drawToy(t) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(t.x, t.y + 3, 3, 1.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = t.color;
  ctx.beginPath(); ctx.arc(t.x, t.y, 2.8, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(t.x, t.y, 1.7, t.spin, t.spin + 2.2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(t.x - 1.5, t.y - 1.5, 1, 1);
}

// ---------- The other cats of Whitehall ----------
function setupRivals() {
  // Palmerston only comes round on visit days (date-seeded) — a rival you
  // sometimes have is a better rival than one who lives on your lawn
  G.rivals = (curMap().cats || []).filter(c => c.name !== 'Palmerston' || PALM_VISIT || G.intro.phase !== 'done').map(c => ({
    x: (c.x + 0.5) * TILE, y: (c.y + 0.5) * TILE,
    img: CAT_IMGS[c.set], name: c.name, quips: c.quips,
    mode: c.mode, state: c.mode === 'sleep' ? 'sleep' : 'sit',
    rect: c.rect || [c.x - 3, c.y - 2, c.x + 3, c.y + 2],
    t: 2 + Math.random() * 5, tx: 0, ty: 0, dir: 'down', flip: false,
    animT: Math.random() * 9, quipCD: 4, anim: null,
  }));
}
function updateRival(c, dt) {
  c.animT += dt;
  c.quipCD = Math.max(0, c.quipCD - dt);
  if (c.quipCD <= 0 && dist(c.x, c.y, G.larry.x, G.larry.y) < 28) {
    toast(c.name + ': "' + pick(c.quips) + '"');
    c.quipCD = 14;
    if (c.state === 'sit' && !c.anim) c.anim = { name: 'meow', t: 0 };
  }
  if (c.anim) {
    c.anim.t += dt;
    if (c.anim.t * 6 >= CANIM[c.anim.name][1]) c.anim = null;
  } else if (c.state === 'sit' && Math.random() < dt * 0.06) {
    c.anim = { name: Math.random() < 0.5 ? 'yawn' : 'wash', t: 0 };
  }
  if (c.mode === 'sleep') return;
  // Palmerston hunts your mice — beat him to the pounce
  if (c.name === 'Palmerston' && G.intro.phase === 'done') {
    c.huntCD = (c.huntCD === undefined ? 26 : c.huntCD) - dt;
    if (c.state !== 'hunt' && c.huntCD <= 0 && G.mice.length) {
      c.state = 'hunt';
      toast('👀 Palmerston has spotted a mouse. Beat him to it!');
      tone(320, 200, 0.2, 'square', 0.06);
    }
    // block his path during a hunt and it becomes a stare-off
    if (c.state === 'stare') {
      c.stareT -= dt;
      c.flip = G.larry.x < c.x;
      if (c.stareT <= 0) {
        c.state = 'hunt';
        toast('Palmerston is unimpressed. The hunt resumes.');
      }
      return;
    }
    if (c.state === 'hunt') {
      if (dist(c.x, c.y, G.larry.x, G.larry.y) < 24) {
        c.state = 'stare'; c.stareT = 1.6;
        toast('⚔️ STARE-OFF! Pounce to assert protocol!');
        tone(200, 400, 0.2, 'sawtooth', 0.07);
        return;
      }
      let best = null, bd = 1e9, bi = -1;
      for (let i = 0; i < G.mice.length; i++) {
        const d = dist(G.mice[i].x, G.mice[i].y, c.x, c.y);
        if (d < bd) { bd = d; best = G.mice[i]; bi = i; }
      }
      if (!best) {
        c.state = 'sit'; c.t = 4; c.huntCD = 45;
        toast('Palmerston: "Hmph. Beginner\'s luck."');
        return;
      }
      const vx = (best.x - c.x) / Math.max(1, bd), vy = (best.y - c.y) / Math.max(1, bd);
      if (Math.abs(vx) > Math.abs(vy) * 0.8) { c.dir = 'side'; c.flip = vx < 0; }
      else c.dir = vy > 0 ? 'down' : 'up';
      const nx = c.x + vx * 58 * dt, ny = c.y + vy * 58 * dt;
      if (circleFreeOn(curMap(), nx, c.y, 4)) c.x = nx;
      if (circleFreeOn(curMap(), c.x, ny, 4)) c.y = ny;
      if (bd < 9) {
        G.mice.splice(bi, 1);
        addParticle(best.x, best.y, '#cfc8b8', 8, 34);
        toast('📰 "FOREIGN OFFICE CAT OUT-MOUSES LARRY" — early edition');
        tone(240, 120, 0.3, 'sawtooth', 0.06);
        if (G.press.active) G.press.bads++;
        G.approval = Math.max(0, G.approval - 2);
        if (DAY) { DAY.stats.palm = (DAY.stats.palm || 0) + 1; saveDay(); } // the Evening Paper keeps count
        c.state = 'sit'; c.t = 5; c.huntCD = 50;
      }
      return;
    }
  }
  c.t -= dt;
  if (c.state === 'sit' && c.t <= 0) {
    // pick somewhere nearby to saunter to
    const [x0, y0, x1, y1] = c.rect;
    for (let i = 0; i < 8; i++) {
      const tx = (x0 + Math.random() * (x1 - x0) + 0.5) * TILE, ty = (y0 + Math.random() * (y1 - y0) + 0.5) * TILE;
      if (!isSolidOn(curMap(), tx, ty)) { c.tx = tx; c.ty = ty; c.state = 'walk'; break; }
    }
    c.t = 3 + Math.random() * 5;
  } else if (c.state === 'walk') {
    const d = dist(c.x, c.y, c.tx, c.ty);
    if (d < 4 || c.t <= 0) { c.state = 'sit'; c.t = 4 + Math.random() * 6; return; }
    const vx = (c.tx - c.x) / d, vy = (c.ty - c.y) / d;
    if (Math.abs(vx) > Math.abs(vy) * 0.8) { c.dir = 'side'; c.flip = vx < 0; }
    else c.dir = vy > 0 ? 'down' : 'up';
    const nx = c.x + vx * 22 * dt, ny = c.y + vy * 22 * dt;
    if (circleFreeOn(curMap(), nx, c.y, 4)) c.x = nx; else c.state = 'sit';
    if (circleFreeOn(curMap(), c.x, ny, 4)) c.y = ny; else c.state = 'sit';
  }
}
function drawRival(c) {
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath(); ctx.ellipse(c.x, c.y + 6, 7, 2.4, 0, 0, 7); ctx.fill();
  if (c.state === 'stare') {
    drawCat(c.img, c.flip ? 'hissL' : 'hissR', (c.animT * 5) % 2, c.x, c.y);
  } else if (c.state === 'sleep') {
    drawCat(c.img, c.name === 'Biscuit' ? 'sleep3' : 'sleepL', (c.animT * 1.6) % 2, c.x, c.y);
  } else if (c.state === 'sit') {
    if (c.anim) drawCat(c.img, c.anim.name, c.anim.t * 6, c.x, c.y);
    else drawCat(c.img, 'sit', 0, c.x, c.y);
  } else {
    const anim = c.dir === 'side' ? (c.flip ? 'walkLeft' : 'walkRight') : c.dir === 'up' ? 'walkUp' : 'walkDown';
    drawCat(c.img, anim, c.animT * (c.dir === 'side' ? 10 : 7), c.x, c.y);
  }
}

// ---------- Butterflies (garden ambience) ----------
function setupButterflies() {
  G.butterflies = [];
  if (G.mapId !== 'ground') return;
  const n = IS_SPRING ? 5 : IS_WINTER ? 1 : 3; // spring brings company
  for (let i = 0; i < n; i++) {
    G.butterflies.push({
      x: (6 + i * (IS_SPRING ? 8 : 12)) * TILE, y: (2 + (i % 3) * 2) * TILE,
      t: i * 2.1, hue: i === 1 ? '#f0ece2' : '#e8a24c',
    });
  }
}
function updateButterfly(b, dt) {
  b.t += dt;
  b.x += Math.cos(b.t * 0.7) * 14 * dt + Math.sin(b.t * 2.3) * 8 * dt;
  b.y += Math.sin(b.t * 1.1) * 10 * dt;
  b.x = clamp(b.x, 2 * TILE, 45 * TILE);
  b.y = clamp(b.y, 1.5 * TILE, 7.5 * TILE);
}

// ---------- The Press: periodic scrutiny with consequences ----------
// P_PRESS is defined up with the other person sprites (used by the street map too)
const HEADLINES_GOOD = [
  '📰 "LARRY DOES IT AGAIN" — every front page',
  '📰 "CHIEF MOUSER SAVES THE NATION (AGAIN)"',
  '📰 "THE ONLY COMPETENT ONE AT NO. 10" — sources',
  '📰 "PAWS OF STEEL" — an eight-page pullout',
  '📰 "GOVERNMENT WORKING, CONFIRMS CAT"',
  '📰 "LARRY 1, CHAOS 0" — the back page too',
  '📰 "A SAFE PAIR OF PAWS" — leader column, glowing',
  '📰 "WHO NEEDS A CABINET?" asks influential columnist',
];
const HEADLINES_BAD = [
  '📰 "MOUSE ESCAPES UNDER LARRY\'S NOSE" — exclusive',
  '📰 "IS LARRY LOSING HIS TOUCH?" asks columnist',
  '📰 "CATASTROPHE AT NO. 10" — page one',
  '📰 "ASLEEP AT THE WHEEL (AND ON IT)" — damning',
  '📰 "THE MOUSE THAT GOT AWAY: A NATION ASKS HOW"',
  '📰 "CHIEF MOUSER? CHIEF SNOOZER" — the sketch, cruel',
  '📰 "NINE LIVES, ZERO EXCUSES" — furious editorial',
];
function updatePress(dt) {
  const P = G.press;
  if (G.intro.phase !== 'done') return;
  if (!P.active) {
    P.cd -= dt;
    if (P.cd <= 0 && G.mapId === 'ground' && G.fadeDir === 0 && !G.paused && DIFF().press && !G.daily) {
      P.active = true; P.t = 18; P.catches = 0; P.bads = 0; P.slept = false;
      G.paps = [[17.5, 29.5], [25.5, 30.5]].map(([x, y], i) => ({
        x: x * TILE, y: y * TILE, animT: i * 3, flashT: 0, nextFlash: 1 + i, flip: false,
      }));
      toast('📰 The press is watching No. 10… (catch 2, lose none!)');
      tone(700, 500, 0.2, 'triangle', 0.07);
    }
    return;
  }
  P.t -= dt;
  if (G.napping && !P.slept) { // asleep on the job, in front of everyone
    P.slept = true; P.bads++;
    if (DIFF().pressPen) G.approval = Math.max(0, G.approval - 3);
    addFloat(G.larry.x, G.larry.y - 20, 'papped!', '#f0a0a0');
  }
  for (const p of G.paps) {
    p.animT += dt;
    p.flip = G.larry.x < p.x;
    p.flashT = Math.max(0, p.flashT - dt);
    p.nextFlash -= dt;
    if (p.nextFlash <= 0) {
      p.flashT = 0.14; p.nextFlash = 1.4 + Math.random() * 2.4;
      addParticle(p.x + (p.flip ? -6 : 6), p.y - 12, '#ffffff', 2, 14);
      tone(1900, 1300, 0.03, 'square', 0.025);
      if (dist(p.x, p.y, G.larry.x, G.larry.y) < 44) earnMischief('photobomb');
    }
  }
  if (P.t <= 0) {
    P.active = false; P.cd = 45 + Math.random() * 30;
    G.paps = [];
    if (P.bads > 0 && !DIFF().pressPen) {
      toast('📰 The press got their photos and toddled off. No harm done. (Kitten mode is kind.)');
    } else if (P.bads > 0) {
      toast(pick(HEADLINES_BAD));
      G.xp = Math.max(0, G.xp - 15);
      G.approval = Math.max(0, G.approval - 10);
      tone(300, 150, 0.4, 'sawtooth', 0.06);
    } else if (P.catches >= 2) {
      toast(pick(HEADLINES_GOOD));
      G.xp += 25;
      G.fish += 3;
      G.approval = Math.min(100, G.approval + 8);
      goalEvent('press');
      sLevel();
      while (G.xp >= xpNeed(G.level)) { G.xp -= xpNeed(G.level); G.level++; queueBeat(G.level); }
    } else {
      toast('📰 The press got bored and left. No harm done.');
    }
    updateHUD();
  }
}
function drawPap(p) {
  drawPerson(P_PRESS, p.x, p.y, p.animT, p.flip, false);
  ctx.fillStyle = '#1b1d24';
  ctx.fillRect(p.x + (p.flip ? -7 : 3), p.y - 12, 4, 3);
  if (p.flashT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${p.flashT * 5})`;
    ctx.beginPath(); ctx.arc(p.x + (p.flip ? -5 : 5), p.y - 11, 7, 0, 7); ctx.fill();
  }
}

// ---------- Particles & floats ----------
function addParticle(x, y, color, n = 1, spread = 20) {
  for (let i = 0; i < n; i++) G.particles.push({ x, y, vx: (Math.random() - 0.5) * spread, vy: (Math.random() - 0.5) * spread - 8, t: 0.5 + Math.random() * 0.4, color });
}
function addFloat(x, y, text, color = '#ffe8b8') { G.floats.push({ x, y, t: 1.3, text, color }); }
const CATCH_LINES = [
  'A gift for the Cabinet!', 'Order! Order!', 'Purrfect.', 'Filed under: dealt with.',
  'For King and Kibble!', 'Policy, delivered.', 'The motion carries.', 'Minuted.',
  'Another U-turn. Theirs.', 'Committee adjourned.', 'Vetted. Vetoed.', 'Efficiency savings!',
  'Take THAT to the Lords.', 'Constituency work.', 'Nationalised.', 'A strong mandate.',
  'Question time is over.', 'Redacted.',
];
const GOTAWAY_LINES = ['got away!', 'gone!', 'into the skirting!', 'escaped custody!', 'resigned!', 'off the record!'];
const NEARMISS_LINES = ['SO close!', 'a whisker off!', 'it HEARD you!', 'next time.', 'noted. hunted.', 'inquiry launched!'];

// ---------- Catch & level ----------
function catchMouse(i) {
  const mo = G.mice[i];
  const T = MOUSE_TYPES[mo.type] || MOUSE_TYPES.grey;
  if (mo.hp > 1) { // the rat shrugs off the first pounce
    mo.hp--;
    mo.iframes = 0.9;
    mo.state = 'stunned'; mo.stateT = 0.7;
    const d = Math.max(1, dist(mo.x, mo.y, G.larry.x, G.larry.y));
    const kx = mo.x + (mo.x - G.larry.x) / d * 14, ky = mo.y + (mo.y - G.larry.y) / d * 14;
    if (circleFree(kx, ky, 3)) { mo.x = kx; mo.y = ky; }
    addFloat(mo.x, mo.y - 10, 'THUMP!', '#f0d0a0');
    addParticle(mo.x, mo.y, '#cfc8b8', 6, 30);
    tone(180, 90, 0.12, 'square', 0.09);
    return;
  }
  G.mice.splice(i, 1);
  G.catches++;
  G.fish += mo.type === 'ratking' ? 5 + G.larder : mo.type === 'rat' ? 2 : 1;
  if (mo.type === 'raider') { // the cheddar comes home
    G.fish += 2;
    addFloat(mo.x, mo.y - 16, 'cheese recovered! +2 🐟', '#9fe8a0');
  }
  G.approval = Math.min(100, G.approval + 0.6);
  if (G.isNight) G.nightCatches++;
  if (G.press.active) G.press.catches++;
  G.hitstop = 0.05; G.flash = 0.09; // a beat of impact
  if (G.daily) {
    G.daily.caught++; G.daily.combo++;
    G.daily.bestCombo = Math.max(G.daily.bestCombo, G.daily.combo);
    const pts = 100 + (G.daily.combo - 1) * 25;
    G.daily.score += pts;
    G.daily.shown = -1; // refresh the HUD line right away
    addFloat(mo.x, mo.y - 16, '+' + pts, '#9fe8a0');
  }
  let gain = Math.round((12 + Math.floor(G.level * 1.5)) * T.xp);
  if (has('cape')) gain *= 2;
  if (G.dream && G.dream.buff === 'xp') gain = Math.round(gain * 1.15);
  if (mo.busy > 0) { // taken completely unawares — the stalk paid off
    gain = Math.round(gain * 1.3);
    addFloat(mo.x, mo.y - 16, 'UNAWARES! +30%', '#9fd6ff');
    tone(700, 1050, 0.09, 'triangle', 0.06);
  }
  if (G.lives) gain = Math.round(gain * (1 + G.lives * 0.08)); // old lives sharpen the instincts
  G.xp += gain;
  addParticle(mo.x, mo.y, '#e9c46a', 8, 40);
  addParticle(mo.x, mo.y, '#f3ead9', 5, 30);
  addFloat(mo.x, mo.y - 8, '+' + gain + ' XP');
  G.shake = Math.max(G.shake, 0.06);
  // a fully-wound leap that connects: chef's kiss
  // (flag, not lastPower reset — reach and squash still need the power for the rest of the leap)
  if (G.larry.pounceT > 0 && G.larry.lastPower > 0.55 && !G.larry.perfectDone) {
    G.larry.perfectDone = true; // one bonus per leap
    G.xp += 8;
    if (G.daily) G.daily.perfects = (G.daily.perfects || 0) + 1;
    addFloat(G.larry.x, G.larry.y - 24, 'PERFECT! +8', '#ffd98a');
    addParticle(mo.x, mo.y, '#ffd98a', 6, 40);
    tone(880, 1320, 0.12, 'triangle', 0.07);
  }
  if (mo.type === 'ratking') {
    toast('📰 "RAT KING DEPOSED IN CELLAR COUP" — every front page. The mice observe a day of mourning.');
    earnHonour('ratking');
    G.shake = 0.3;
    if (G.larder > 0) {
      addFloat(mo.x, mo.y - 26, 'LARDER RECOVERED! +' + G.larder + '🐟', '#9fe8a0');
      G.larder = 0;
    }
  }
  if (G.intro.phase === 'done' && Math.random() < 0.22) addFloat(G.larry.x, G.larry.y - 16, pick(CATCH_LINES), '#9fd6ff');
  sCatch();
  if (!G.daily) {
    briefEvent('catch', { map: G.mapId, type: mo.type, night: G.isNight, region: G.region });
    goalEvent('catch', { type: mo.type, night: G.isNight });
    checkHonours();
  }
  // hat-trick: three catches inside eight seconds
  G.catchTimes.push(G.time);
  G.catchTimes = G.catchTimes.filter(t => G.time - t < 8);
  if (G.catchTimes.length >= 3) {
    G.catchTimes = [];
    G.xp += 15;
    addFloat(G.larry.x, G.larry.y - 22, 'HAT-TRICK! +15', '#ffd98a');
    [659, 784, 1047].forEach((f, i) => tone(f, f, 0.1, 'square', 0.07, i * 0.07));
    earnHonour('hat');
  }
  if (G.intro.phase === 'shelter') {
    G.intro.catches++;
    if (G.intro.catches >= 2) beginVisitor();
  } else if (G.intro.phase === 'done' && !G.daily) {
    while (G.xp >= xpNeed(G.level)) {
      G.xp -= xpNeed(G.level);
      G.level++;
      queueBeat(G.level);
    }
  }
  updateHUD();
  save();
}

function queueBeat(level) {
  const b = beatFor(level);
  let body = b.body, newPM = null;
  if (b.pmChange) {
    const old = G.pm;
    newPM = nextPM();
    body = body.replaceAll('{OLD}', old).replaceAll('{NEW}', newPM).replaceAll('{EXIT}', exitReason(pmCount - 1));
  }
  G.cardQueue.push({ title: b.title, body, gadget: b.gadget, newPM, level });
  if (b.finale) {
    earnHonour('garter');
    G.cardQueue.push({
      level, title: 'You Remain',
      body: 'PMs will come. Vans will go. Portraits will climb the staircase until the staircase surrenders. But the file is stamped PERMANENT, the radiator is warm, and the whole grand, mouse-riddled house is YOURS.\n\nThank you for playing. Larry remains on duty — the mice, the honours, the mischief and the Daily Sortie continue for as long as you do. 🐾\n\n(And when you are ready: cats get NINE lives. A New Life awaits in the pause menu — the climb begins again, and everything you earned comes with you.)',
    });
  }
  maybeShowCard();
}

function showCard(kicker, title, body, gadgetHtml, onClose) {
  G.paused = true;
  document.getElementById('cardKicker').textContent = kicker;
  document.getElementById('cardTitle').textContent = title;
  document.getElementById('cardBody').textContent = body;
  const gEl = document.getElementById('cardGadget');
  if (gadgetHtml) {
    gEl.classList.remove('hidden');
    gEl.querySelector('.gname').textContent = gadgetHtml.name;
    gEl.querySelector('.gdesc').textContent = gadgetHtml.desc;
  } else gEl.classList.add('hidden');
  document.getElementById('cardWrap').classList.remove('hidden');
  document.getElementById('cardBtn').onclick = () => {
    sClick();
    document.getElementById('cardWrap').classList.add('hidden');
    G.paused = false;
    if (onClose) onClose();
  };
}

function maybeShowCard() {
  if (G.paused || !G.cardQueue.length) return;
  const c = G.cardQueue.shift();
  sLevel();
  showCard('LEVEL ' + c.level + ' — DISPATCH FROM NO. 10', c.title, c.body,
    c.gadget ? { name: 'NEW GADGET: ' + GADGETS[c.gadget].name, desc: GADGETS[c.gadget].desc } : null,
    () => {
      if (c.newPM) {
        G.pm = c.newPM; G.pmDays = 1; G.dayIdx = Math.floor(G.time / DAYLEN);
        if (G.mapId === 'ground') { spawnBoxes(); flashbulbs(); }
        if (pmCount === 10) {
          G.cardQueue.unshift({
            level: G.level, title: 'The Institution',
            body: 'PM #10 moves in today. Ten Prime Ministers. One cat. The papers have stopped calling you a pet; the word now used is "constant". Somewhere in the building a civil servant updates your file to read, simply: PERMANENT.',
          });
        }
        checkHonours();
        save();
      }
      if (c.gadget === 'monocle') G.nv = true;
      refreshGadgetBar();
      updateHUD();
      maybeShowCard();
    });
}

// a story card with two choices — same card, second button
function showChoice(kicker, title, body, aLabel, bLabel, cb) {
  const btn = document.getElementById('cardBtn'), b2 = document.getElementById('cardBtn2');
  const done = which => {
    btn.textContent = 'Continue';
    b2.classList.add('hidden');
    cb(which);
  };
  showCard(kicker, title, body, null, () => done('a'));
  btn.textContent = aLabel;
  b2.textContent = bLabel;
  b2.classList.remove('hidden');
  b2.onclick = () => {
    sClick();
    document.getElementById('cardWrap').classList.add('hidden');
    G.paused = false;
    done('b');
  };
}

// ---------- Dreams: naps ask a small question, the answer lingers ----------
// Each buff is tiny and lasts until the next dream replaces it. The point is
// that napping — the stamina mechanic — feels like a reward, not downtime.
const DREAM_NOTES = {
  xp: 'mice are worth a little more today (+15% XP)',
  reach: 'pounces land a whisker further today',
  stam: 'puff recovers faster today',
  calm: 'mice relax around you today — they startle later',
  zoom: 'Larry moves a touch quicker today',
};
const DREAMS = [
  {
    body: 'The Infinite Pantry again. Shelf after shelf, cheddar to the horizon, every wheel of it unguarded.',
    a: ['🧀 Eat everything', 'xp'], b: ['🚪 Guard the door', 'reach'],
  },
  {
    body: 'You dream you are enormous. Building-sized. You supervise Whitehall by lying on all of it at once.',
    a: ['🏛️ Keep lying there', 'stam'], b: ['🐾 One colossal pounce', 'reach'],
  },
  {
    body: 'The red dot appears. It apologises. For everything. It offers terms.',
    a: ['🤝 Accept the truce', 'calm'], b: ['🔴 CHASE IT ANYWAY', 'zoom'],
  },
  {
    body: 'You are at the lectern. The nation watches. You deliver one perfect, devastating meow and take no questions.',
    a: ['🎤 Let it echo', 'xp'], b: ['🚶 Exit briskly, stage left', 'zoom'],
  },
  {
    body: 'Palmerston, in the dream, admits your bow tie is better. He would never. That is how you know it is a dream.',
    a: ['😌 Savour it', 'stam'], b: ['👀 Stay vigilant, even here', 'calm'],
  },
];
function showDream() {
  const d = pick(DREAMS);
  showChoice('💤 MEANWHILE, IN THE DREAM', 'Larry dreams…', d.body, d.a[0], d.b[0], which => {
    const buff = which === 'a' ? d.a[1] : d.b[1];
    G.dream = { buff };
    toast('💭 The dream lingers: ' + DREAM_NOTES[buff] + '.');
    tone(660, 880, 0.2, 'sine', 0.04); tone(880, 660, 0.2, 'sine', 0.03, 0.22);
  });
}

function spawnBoxes() {
  G.boxes = [];
  [[17, 30], [24, 29], [18, 28], [25, 32]].forEach(([x, y]) => G.boxes.push({ x: x * TILE, y: y * TILE, t: 30 }));
}
function flashbulbs() {
  for (let i = 0; i < 12; i++) {
    setTimeout(() => { if (G.running && G.mapId === 'ground') { addParticle(21.5 * TILE + (Math.random() - 0.5) * 40, 33.4 * TILE, '#ffffff', 3, 26); tone(1800, 1200, 0.04, 'square', 0.03); } }, i * 260 + Math.random() * 150);
  }
}
// a barrage of camera flashes around a point on the current map
function pressFlashes(cx, cy, n = 14) {
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (!G.running) return;
      const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 46;
      addParticle(cx + Math.cos(a) * r, cy + Math.sin(a) * r - 12, '#ffffff', 3, 22);
      tone(1900, 1150, 0.04, 'square', 0.03);
    }, i * 190 + Math.random() * 120);
  }
}

// ---------- The doorstep press conference: Larry meets the world's media ----------
function beginPressIntro() {
  G.larry.dir = 'down'; G.larry.flip = false; G.larry.idleT = 6; // face the cameras, sit
  const CARDS = [
    ['DOWNING STREET — LIVE', 'The World\'s Press',
      'You are carried over the threshold and set down on the most famous doorstep in Britain. Thirty cameras go off at once; a wall of microphones descends. Somebody bellows, "LARRY! THIS WAY, LARRY!"\n\nUntil roughly an hour ago you were a stray in a Battersea shelter with strong opinions about a cardboard box. You have agreed to NONE of this.'],
    ['THE QUESTIONS BEGIN', 'On How It Feels',
      '"Chief Mouser! How does it FEEL, serving at the very heart of government?"\n\nYou consider the question. You consider the microphone. You briefly consider batting the microphone. You rise above it — barely — and give them one long, unbothered blink.\n\n(Privately: you do not know what a civil servant is. You know what tuna is. You are prepared to negotiate.)'],
    ['ON THE RECORD', 'Priorities for the Term',
      '"And your priorities in office, Larry?"\n\nIn strict order: the warm radiator, the sunny windowsill, and whoever is presently holding the tuna. You are fairly sure that is the entire job. You are fairly sure you are already better at it than most of the building.\n\n(You decline to take follow-ups. Legends do not do follow-ups.)'],
    ['THE LIFESTYLE PIECE', 'Quite the Upgrade',
      '"A Battersea rescue, now living at No. 10 — bit bougie for a shelter cat, isn\'t it?"\n\nIt IS drafty. It IS full of important people who trip on the doorstep. You do not know which fork is for statecraft, and you have owned a bow tie for all of forty minutes.\n\nBut the food, they keep telling you, is free. And endless. …You could, conceivably, get used to that.'],
    ['TOMORROW\'S FRONT PAGE', 'Just Larry',
      'You sit. You face the flashbulbs dead-on and say absolutely nothing, with tremendous authority.\n\nBy morning it runs on every front page — one word, no surname: LARRY. You have not spoken a syllable. You never will. It will not matter.\n\nBehind you, someone holds the great black door open. Time to inspect the house. It is yours now; you simply have not told them yet.'],
  ];
  let i = 0;
  const step = () => {
    if (i >= CARDS.length) {
      save(); initDay();
      toast('🚪 Walk up to the black door of No. 10 whenever you\'re ready to head inside.');
      pressFlashes(G.larry.x, G.larry.y, 8);
      return;
    }
    const [kick, title, body] = CARDS[i++];
    tone(1900, 1200, 0.04, 'square', 0.04); // a camera shutter as each beat lands
    showCard(kick, title, body, null, step);
  };
  step();
}

// ---------- The intro: Battersea, the visitor, the adoption ----------
function beginVisitor() {
  G.intro.phase = 'visitor';
  G.visitor = { x: 10.5 * TILE, y: 13.2 * TILE, animT: 0, done: false };
  toast('Someone is watching you…');
}
function visitorReaches() {
  G.visitor.done = true;
  showCard('BATTERSEA, SOUTH LONDON', 'The Visitor',
    'A person in a very serious grey suit has been watching you work. "That one," they say, pointing directly at you. "The one with the eyes of a professional." The shelter staff nod. Papers are signed. A cat carrier appears.',
    null,
    () => {
      showCard('HM GOVERNMENT — VACANCY FILLED', 'You Are Being Recruited',
        'The role: CHIEF MOUSER TO THE CABINET OFFICE. It comes with one town house (shared with whoever the Prime Minister is this week), one garden (large), unlimited mice (yours), and — effective immediately — one Union Jack bow tie.',
        { name: 'ISSUED: 🎀 Union Jack Bow Tie', desc: 'Dress code is dress code. You wear it with enormous dignity.' },
        () => {
          G.bowtie = true;
          G.pm = nextPM(); G.pmDays = 1; G.dayIdx = Math.floor(G.time / DAYLEN);
          startFade(() => {
            // arrive OUT FRONT, on the famous doorstep, to a wall of press
            switchMap('street', 11 * TILE, 6.5 * TILE);
            G.intro.phase = 'done';
            G.visitor = null;
            pressFlashes(11 * TILE, 6.5 * TILE);        // a beat of flashes, live, before the questions
            setTimeout(beginPressIntro, 750);
          });
        });
    });
}

// ---------- Map switching ----------
function switchMap(id, x, y) {
  G.mapId = id;
  G.larry.x = x; G.larry.y = y;
  G.mice = []; G.laser = null; G.boxes = []; tapTarget = null; G.napping = false; G.napPos = null;
  if (G.press.active && id !== 'ground') { // the pack disperses if you slip away
    G.press.active = false; G.press.cd = 40; G.paps = [];
    toast('📰 The press lost interest. This time.');
  }
  G.transCD = 0.9;
  const cap = Math.min(3, curMap().mouseCap(G.level));
  for (let i = 0; i < cap; i++) spawnMouse();
  setupNpcs();
  setupButterflies();
  setupToys();
  setupRivals();
  setupKnocks();
  const m = curMap();
  G.camX = clamp(x - VW / 2, 0, Math.max(0, m.w * TILE - VW));
  G.camY = clamp(y - VH / 2, 0, Math.max(0, m.h * TILE - VH));
  G.region = '';
  save();
}
function startFade(cb) { G.fadeDir = 1; G.fadeCb = cb; }

let toastT = null;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), Math.max(2600, text.length * 52));
}
function wakeUp() {
  G.napping = false;
  G.napPos = null;
  G.napKind = null; G.radT = 0;
  toast(pick(TXT_WAKE));
}

// ---------- HUD ----------
function updateHUD() {
  document.getElementById('lvl').textContent = 'LV ' + G.level + (G.lives ? '·' + (G.lives + 1) + '🐾' : '');
  document.getElementById('mice').textContent = '🐭 ' + G.catches;
  document.getElementById('xpfill').style.width = Math.min(100, G.xp / xpNeed(G.level) * 100) + '%';
  if (!G.daily) {
    document.getElementById('pmline').textContent = G.pm ? (G.pm + ' in office') : 'Battersea, London';
    document.getElementById('pmday').textContent = G.pm ? ('Day ' + G.pmDays) : 'Unemployed';
  }
  const ap = document.getElementById('approval');
  if (ap) {
    if (G.intro.phase === 'done' && !G.daily) {
      ap.textContent = (G.approval >= 60 ? '📈' : G.approval >= 35 ? '📊' : '📉') + Math.round(G.approval) + '%';
      ap.classList.remove('hidden');
    } else ap.classList.add('hidden');
  }
  const fEl = document.getElementById('fish');
  if (fEl) {
    fEl.textContent = '🐟 ' + G.fish;
    fEl.classList.toggle('hidden', G.intro.phase !== 'done' && !G.daily);
  }
  const bEl = document.getElementById('brief');
  if (G.brief) {
    const d = G.brief.def;
    // a persistent, labelled objective in the corner: finish it to get the next
    bEl.textContent = '📕 TASK: ' + d.text + (d.n > 1 ? ' (' + G.brief.prog + '/' + d.n + ')' : '');
    bEl.classList.remove('hidden');
  } else bEl.classList.add('hidden');
}

// ---------- Update ----------
function update(dt) {
  const L = G.larry;
  G.time += dt;
  const tod = (G.time / DAYLEN) % 1;
  const dark = G.daily ? 0 : 0.5 - 0.5 * Math.cos(tod * Math.PI * 2); // sorties are played in honest daylight
  document.getElementById('clock').textContent = dark > 0.55 ? '🌙' : (G.snowing ? '❄️' : G.raining ? '🌧️' : '☀️');

  G.isNight = dark > 0.5;
  G.rainT -= dt;
  if (G.rainT <= 0) {
    const r = Math.random();
    const wasSnow = G.snowing;
    // the real calendar leaks in: autumn is wet, winter can snow properly,
    // the rest of the year mostly behaves
    const snowP = IS_WINTER ? 0.26 : 0.02;
    const rainP = IS_AUTUMN ? 0.45 : IS_SPRING ? 0.3 : 0.22;
    G.snowing = r < snowP;
    G.raining = !G.snowing && r < snowP + rainP;
    if (G.snowing && !wasSnow) toast('❄️ Snow over Westminster. The garden goes quiet.');
    G.rainT = 25 + Math.random() * 30;
  }

  // Daily Sortie: the clock is the whole game
  if (G.daily && !G.daily.over) {
    G.daily.t -= dt;
    const secs = Math.max(0, Math.ceil(G.daily.t));
    if (secs <= 3 && secs > 0 && secs !== G.daily.lastTick) { // heartbeat ticks, immune to score refreshes
      G.daily.lastTick = secs;
      tone(1100, 1100, 0.07, 'square', 0.06);
    }
    if (secs !== G.daily.shown) {
      G.daily.shown = secs;
      document.getElementById('pmline').textContent = '📅 DAILY SORTIE';
      document.getElementById('pmday').textContent = '⏱ ' + secs + 's · ' + G.daily.score;
    }
    if (G.daily.t <= 0) { dailyEnd(); return; }
  }

  // approval: the nation is always keeping score — but it also forgets.
  // Below 50, approval drifts gently back up while the press pack is away,
  // so one bad stretch can't spiral into Rat King + crisis + summons at once.
  if (G.intro.phase === 'done' && !G.daily) {
    if (G.approval < 50 && !G.press.active) {
      const before = Math.round(G.approval);
      G.approval = Math.min(50, G.approval + dt * 0.35);
      if (Math.round(G.approval) !== before) updateHUD();
    }
    if (G.approval < 30 && !G.crisis) {
      G.crisis = true;
      toast('📉 "CHIEF MOUSER IN CRISIS" — the columnists smell blood. Catch mice; let none escape.');
      G.press.cd = Math.min(G.press.cd, 8);
      tone(220, 110, 0.5, 'sawtooth', 0.05);
    } else if (G.approval > 45) G.crisis = false;
    if (G.approval >= 95) earnHonour('beloved');
  }

  // gentle first-minute tutorial, shelter only (waits out the room-name toast)
  if (G.intro.phase === 'shelter' && !G.paused) {
    if (G.tut === 0) {
      G.moveT += dt;
      if (G.moveT > 2.2) { G.tut = 1; G.moveT = 0; toast('🐾 Drag anywhere to steer — or tap a spot and Larry will trot over. (WASD on a keyboard.)'); }
    } else if (G.tut === 1 && L.moving) {
      G.moveT += dt;
      if (G.moveT > 1.1) { G.tut = 2; toast('That\'s it. Now stalk a mouse and tap 🐾 (or SPACE) to pounce — HOLD it to wind up a longer leap!'); }
    }
  }

  // puff: naps are now professionally justifiable
  G.stam = Math.min(100, G.stam + (G.napping ? 12 : 2) * (G.dream && G.dream.buff === 'stam' ? 1.6 : 1) * dt);
  if (Math.abs(G.stam - G.stamShown) >= 1) {
    G.stamShown = G.stam;
    const sf = document.getElementById('stfill');
    sf.style.width = G.stam + '%';
    sf.classList.toggle('tired', G.stam < 25);
  }
  if (G.stam < 25 && L.moving && Math.random() < dt * 0.7) addFloat(L.x + 6, L.y - 14, '~', '#a8c8d8');
  if (G.stam < 25 && !G.tiredHint) {
    G.tiredHint = true;
    toast('💤 Larry is puffed — pounces fall short. A nap spot (or the food bowl) restores his bounce.');
  }

  // a SUMMONS: politics interrupts, attendance is not optional
  if (G.intro.phase === 'done' && !G.daily && !G.summons && !G.press.active) {
    G.summonsCD -= dt;
    if (G.summonsCD <= 0) startSummons();
  }
  if (G.summons) {
    const S = G.summons;
    if (G.mapId === S.mapId && G.region === S.region) {
      S.att += dt;
      if (S.att >= 4) { // attended, sat beautifully — no rush, no penalty for taking your time
        G.summons = null;
        G.summonsCD = 110 + Math.random() * 70;
        G.fish += 5;
        G.approval = Math.min(100, G.approval + 4);
        G.xp += 15;
        toast('📸 You sat. You stared into the middle distance. The photograph is MAGNIFICENT. +5 🐟 +15 XP');
        if (DAY) { DAY.stats.ops = (DAY.stats.ops || 0) + 1; saveDay(); } // the Evening Paper keeps count
        goalEvent('summons');
        [659, 784, 988].forEach((f, i) => tone(f, f, 0.1, 'triangle', 0.06, i * 0.08));
        while (G.xp >= xpNeed(G.level)) { G.xp -= xpNeed(G.level); G.level++; queueBeat(G.level); }
        updateHUD();
      }
    } else S.att = Math.max(0, S.att - dt * 2); // wandered off mid-photo
    updateSummonsHUD();
  }

  // the Red Box delivers the NEXT task only once the current one is done —
  // objectives never time out or get reshuffled; you finish before you move on.
  // Briefs and the photo-op are independent quests; neither blocks the other.
  if (G.intro.phase === 'done' && !G.brief) {
    G.briefCD -= dt;
    if (G.briefCD <= 0) newBrief();
  }
  // warm shimmer above the famous radiator
  if (G.mapId === 'ground' && Math.random() < dt * 1.6) {
    addParticle((26 + Math.random() * 2) * TILE, 33.2 * TILE, 'rgba(255,235,200,0.4)', 1, 6);
  }
  // birdsong in the garden by day
  if (G.mapId === 'ground' && !G.isNight && !G.raining && G.larry.y < 10 * TILE && Math.random() < dt * 0.25) {
    const f = 1700 + Math.random() * 900;
    tone(f, f * 1.25, 0.07, 'sine', 0.025);
    tone(f * 1.1, f * 0.9, 0.06, 'sine', 0.02, 0.1);
  }
  // a raiding pair plots something (lv 9+): one squeaks, one carries
  if (G.level >= 9 && !G.daily && G.intro.phase === 'done' && (G.mapId === 'basement' || G.mapId === 'ground')) {
    G.pairCD = (G.pairCD === undefined ? 50 : G.pairCD) - dt;
    if (G.pairCD <= 0) {
      G.pairCD = 70 + Math.random() * 50;
      if (!G.mice.some(m2 => m2.type === 'raider' || m2.type === 'decoy')) spawnPair();
    }
  }
  // walking into a Cabinet meeting: the ministers react, on the record
  G.cabQuipCD = Math.max(0, (G.cabQuipCD || 0) - dt);
  if (cabinetInSession(dark) && G.cabQuipCD <= 0 && dist(L.x, L.y, 35.5 * TILE, 14.5 * TILE) < 72) {
    const seat = CABINET_SEATS[(Math.random() * CABINET_SEATS.length) | 0];
    addFloat(seat[0] * TILE, (seat[1] - 1.6) * TILE, pick(MINISTER_LINES), '#cfd8e8');
    G.cabQuipCD = 7 + Math.random() * 5;
  }

  // the division bell, somewhere across Whitehall — urgent for somebody else
  if (!G.daily && G.intro.phase === 'done') {
    G.bellCD = (G.bellCD === undefined ? 120 + Math.random() * 120 : G.bellCD - dt);
    if (G.bellCD <= 0) {
      G.bellCD = 240 + Math.random() * 240;
      for (let i = 0; i < 6; i++) tone(1568, 1520, 0.09, 'square', 0.012, i * 0.16);
      if (Math.random() < 0.4) toast("🔔 The division bell rings, far away. Somebody else's problem.");
    }
  }
  // the Rat King stirs
  if (G.level >= 8 && G.mapId === 'basement' && G.intro.phase === 'done' && !G.mice.some(m2 => m2.type === 'ratking')) {
    G.ratKingCD -= dt;
    if (G.ratKingCD <= 0) {
      // every raid on the pantry brings him back sooner, and better fed
      G.ratKingCD = Math.max(30, 90 + Math.random() * 60 - G.larder * 8);
      const kingHp = 3 + (G.larder >= 6 ? 2 : G.larder >= 3 ? 1 : 0);
      G.mice.push({
        x: 25.5 * TILE, y: 14.5 * TILE, tx: 0, ty: 0,
        state: 'wander', stateT: 0, dir: 1, animT: 0, scale: 0,
        type: 'ratking', hp: kingHp, life: 40, dodgeCD: 0, iframes: 0,
      });
      toast('👑 Something enormous stirs in the Cellar…' + (kingHp > 3 ? ' It has been eating WELL.' : ''));
      tone(120, 60, 0.5, 'sawtooth', 0.08);
      G.shake = 0.2;
    }
  }

  // "Day N in office" advances with the sun, not a stopwatch: each dawn the
  // current PM clocks another day (naps fast-forward time, so sleeping counts)
  if (G.pm && !G.daily) {
    const dayIdx = Math.floor(G.time / DAYLEN);
    if (G.dayIdx === undefined) G.dayIdx = dayIdx;
    if (dayIdx > G.dayIdx) {
      G.pmDays += dayIdx - G.dayIdx; G.dayIdx = dayIdx;
      document.getElementById('pmday').textContent = 'Day ' + G.pmDays;
    }
  }

  if (G.fadeDir === 1) {
    G.fade = Math.min(1, G.fade + dt * 3);
    if (G.fade >= 1) { G.fadeDir = -1; if (G.fadeCb) { const cb = G.fadeCb; G.fadeCb = null; cb(); } }
  } else if (G.fadeDir === -1) {
    G.fade = Math.max(0, G.fade - dt * 2.2);
    if (G.fade <= 0) G.fadeDir = 0;
  }

  const v = joyVec();
  if (G.napping) {
    if (v.x || v.y) wakeUp();
    else {
      G.time += dt * 5; // naps fast-forward the day
      if (Math.random() < dt * 0.9) purr(1.1, 0.04); // a low, dignified purr — the real rumble
      const np = G.napPos || L;
      if (Math.random() < dt * 1.2) addFloat(np.x + 8, np.y - 14, 'z', '#8a83a0');
      // making biscuits: a dozy knead of the blanket, with a small happy mrrp
      if (Math.random() < dt * 0.3) { sTrill(); addFloat(np.x - 6, np.y - 10, 'mrrp', '#d6bce0'); }
      // deep enough into a nap, Larry dreams — and the dream asks a question
      // (one per nap, and not again for a while: dreams should stay a treat)
      if (!G.daily && G.intro.phase === 'done' && !G.dreamDone && (G.dreamCD || 0) <= 0) {
        G.dreamT = (G.dreamT || 0) + dt;
        if (G.dreamT > 3.5) { G.dreamDone = true; G.dreamCD = 140; showDream(); }
      }
    }
  }
  // one-shot animations (eat, scratch, meow) and idle grooming
  if (G.catAnim) {
    G.catAnim.t += dt;
    if (G.catAnim.t >= G.catAnim.dur || v.x || v.y) G.catAnim = null;
  }
  if (G.idleAnim) {
    G.idleAnim.t += dt;
    if (G.idleAnim.t * 6 >= CANIM[G.idleAnim.name][1] || v.x || v.y) G.idleAnim = null;
  } else if (!G.napping && !G.catAnim && L.idleT > 3 && Math.random() < dt * 0.14) {
    G.idleAnim = { name: pick(['wash', 'wash', 'yawn']), t: 0 };  // a groom or a yawn
  }
  G.chatterCD = Math.max(0, (G.chatterCD || 0) - dt);
  G.affCD = Math.max(0, (G.affCD || 0) - dt);
  if (!G.napping && !G.catAnim && !G.paused) {
    // the involuntary chatter at prey he can't reach — a butterfly, a pigeon
    if (G.chatterCD <= 0 && L.idleT > 1.2) {
      const flit = (G.butterflies || []).find(b => dist(b.x, b.y, L.x, L.y) < 48);
      if (flit && Math.random() < dt * 0.6) {
        G.catAnim = { name: 'meow', t: 0, dur: 0.55, fps: 10 };
        sChatter(); addFloat(L.x + 5, L.y - 16, 'ekekek!', '#cfe0f0'); G.chatterCD = 6;
      }
    }
    // a slow blink and a lean at nearby staff — affection, feline-style
    if (G.affCD <= 0 && L.idleT > 4) {
      const near = (G.npcs || []).find(n => dist(n.x, n.y, L.x, L.y) < 26);
      if (near && Math.random() < dt * 0.4) {
        addFloat(L.x, L.y - 18, '♥', '#f2a6c4'); sTrill(); G.affCD = 9;
      }
    }
  }
  // nearby point of interest?
  {
    G.nearPoi = null;
    let bd = 24;
    for (const p of curMap().pois) {
      const d = dist(L.x, L.y, (p.x + 0.5) * TILE, (p.y + 0.5) * TILE);
      if (d < bd) { bd = d; G.nearPoi = p; }
    }
    const btn = document.getElementById('btnPounce');
    const want = G.napping ? '⏰' : G.nearPoi && !G.mice.some(mo => dist(mo.x, mo.y, L.x, L.y) < 55) ? G.nearPoi.emoji : '🐾';
    if (btn.textContent !== want) btn.textContent = want;
  }
  L.pounceCD = Math.max(0, L.pounceCD - dt);
  G.dreamCD = Math.max(0, (G.dreamCD || 0) - dt);
  G.transCD = Math.max(0, G.transCD - dt);
  G.zoomiesT = Math.max(0, G.zoomiesT - dt);
  G.sonarT = Math.max(0, G.sonarT - dt);
  G.shake = Math.max(0, G.shake - dt);
  if (G.sonarRingT >= 0) { G.sonarRingT += dt; if (G.sonarRingT > 1.2) G.sonarRingT = -1; }
  for (const t of TOOLS) {
    if (G.toolCD[t.key] > 0) G.toolCD[t.key] = Math.max(0, G.toolCD[t.key] - dt);
    const el = document.getElementById('g_' + t.key);
    if (el && !el.classList.contains('hidden')) {
      el.classList.toggle('cooling', (G.toolCD[t.key] || 0) > 0);
      el.classList.toggle('toggled', !!(t.isOn && t.isOn()));
      el.classList.toggle('broke', !!(t.cost && G.fish < t.cost));
    }
  }
  document.getElementById('btnPounce').classList.toggle('cooling', L.pounceCD > 0);
  if (G.zoomiesT > 0 && Math.random() < dt * 20) addParticle(L.x, L.y + 5, '#e9c46a', 1, 12);

  let sp = (has('zoomies') ? 78 : 70) + (G.zoomiesT > 0 ? 55 : 0) + (G.dream && G.dream.buff === 'zoom' ? 8 : 0);
  if (G.stam < 25) sp *= 0.86; // a puffed cat trudges
  let mx = v.x, my = v.y;
  if (L.charging && L.pounceT <= 0 && !G.napping) {
    L.chargeT += dt;
    sp *= 0.32; // creep while winding up
    if (L.chargeT > 0.55 && Math.random() < dt * 8) addParticle(L.x, L.y + 5, '#e9c46a', 1, 10); // fully wound
  }
  if (L.pounceT > 0) {
    L.pounceT -= dt;
    sp = POUNCE_SPD; mx = L.px; my = L.py;
    if (L.pounceT <= 0) { // touchdown
      L.landT = 0.12;
      addParticle(L.x, L.y + 5, '#cfc8b8', 5, 24);
      // pouncing at a butterfly just sends it fluttering merrily off
      for (const b of (G.butterflies || [])) {
        if (dist(b.x, b.y, L.x, L.y) < 22) {
          b.x = clamp(b.x + (Math.random() - 0.5) * 34, 2 * TILE, 45 * TILE);
          b.y = clamp(b.y - 10 - Math.random() * 8, 1.5 * TILE, 7.5 * TILE);
          addFloat(b.x, b.y - 6, '!', '#f0ece2');
        }
      }
      // agonizingly close?
      let nearest = 1e9;
      for (const mo of G.mice) nearest = Math.min(nearest, dist(mo.x, mo.y, L.x, L.y));
      if (nearest > 15 && nearest < 28 && Math.random() < 0.7) {
        addFloat(L.x, L.y - 18, pick(NEARMISS_LINES), '#f0d0a0');
        tone(500, 350, 0.09, 'triangle', 0.05);
      }
    }
  }
  L.landT = Math.max(0, L.landT - dt);
  L.moving = !!(mx || my);
  // momentum: ease into and out of a run rather than snapping
  const k = L.pounceT > 0 ? 1 : Math.min(1, dt * 14);
  L.cvx += (mx * sp - L.cvx) * k;
  L.cvy += (my * sp - L.cvy) * k;
  if (!L.moving && Math.hypot(L.cvx, L.cvy) < 4) { L.cvx = 0; L.cvy = 0; }
  if (L.moving) {
    L.idleT = 0;
    if (Math.abs(mx) > Math.abs(my) * 0.8) { L.dir = 'side'; L.flip = mx < 0; }
    else L.dir = my > 0 ? 'down' : 'up';
    L.animT += dt * (L.pounceT > 0 ? 2 : 1);
  } else {
    L.idleT += dt;
    if (L.idleT > 7 && Math.random() < dt * 0.5) { addFloat(L.x + 8, L.y - 18, 'z', '#8a83a0'); }
    if (L.idleT > 7 && Math.random() < dt * 0.35) purr(0.7, 0.022); // content, off duty
  }
  if (L.cvx || L.cvy) {
    const nx = L.x + L.cvx * dt, ny = L.y + L.cvy * dt;
    if (circleFree(nx, L.y, 5)) L.x = nx; else L.cvx = 0;
    if (circleFree(L.x, ny, 5)) L.y = ny; else L.cvy = 0;
  }
  if (has('cape') && L.moving && Math.random() < dt * 12) addParticle(L.x, L.y + 4, '#e9c46a', 1, 8);
  // a sharp about-turn kicks up dust
  L.turnCD = Math.max(0, L.turnCD - dt);
  if (L.moving && L.turnCD <= 0 && mx && L.prevVX && Math.sign(mx) !== Math.sign(L.prevVX) && Math.abs(L.cvx) > 30) {
    addParticle(L.x - mx * 4, L.y + 5, '#cfc8b8', 3, 16);
    L.turnCD = 0.35;
  }
  if (mx) L.prevVX = mx;

  // give up on a tap destination we can't reach (wall in the way)
  if (tapTarget) {
    const d = dist(L.x, L.y, tapTarget.x, tapTarget.y);
    if (d > tapTarget.lastD - 8 * dt) tapTarget.stuckT += dt; else tapTarget.stuckT = 0;
    tapTarget.lastD = d;
    if (tapTarget.stuckT > 0.6) tapTarget = null;
  }

  if (G.transCD <= 0 && G.fadeDir === 0) {
    const m = curMap();
    const tx = Math.floor(L.x / TILE), ty = Math.floor(L.y / TILE);
    for (const tr of m.transitions) {
      if (tr.x === tx && tr.y === ty) {
        sStairs();
        G.transCD = 99;
        startFade(() => switchMap(tr.to, (tr.tx + 0.5) * TILE, (tr.ty + 0.5) * TILE));
        break;
      }
    }
  }

  {
    const m = curMap();
    const tx = Math.floor(L.x / TILE), ty = Math.floor(L.y / TILE);
    for (const [x0, y0, x1, y1, name] of m.regions) {
      if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) {
        if (G.region !== name) { G.region = name; toast(name); }
        break;
      }
    }
  }

  const reach = (L.pounceT > 0 ? (L.superP ? 30 : 15 + L.lastPower * 6) : 8) + (G.dream && G.dream.buff === 'reach' ? 3 : 0);
  if (!G.napping) for (let i = G.mice.length - 1; i >= 0; i--) {
    // an oblivious mouse is easier to bag — the pounce is generous against it
    const r2 = reach + (G.mice[i].busy > 0 ? 5 : 0);
    if (G.mice[i].iframes <= 0 && dist(G.mice[i].x, G.mice[i].y, L.x, L.y) < r2) catchMouse(i);
  }

  for (let i = G.mice.length - 1; i >= 0; i--) updateMouse(G.mice[i], dt, i);
  if (Math.random() < dt / (G.daily ? 1.0 : Math.max(1.2, 2.4 - G.level * 0.12))) spawnMouse();
  updatePress(dt);
  for (const n of G.npcs) updateNpc(n, dt);
  // the chef also hunts: competition for kills in the Kitchen
  G.chefCD = Math.max(0, G.chefCD - dt);
  if (G.mapId === 'basement' && G.chefCD <= 0) {
    const chef = G.npcs.find(n => n.sprite === 'chef');
    if (chef) {
      let cm = null, cd2 = 60;
      for (const mo of G.mice) {
        if (mo.type === 'ratking') continue;
        const d2 = dist(mo.x, mo.y, chef.x, chef.y);
        if (d2 < cd2) { cd2 = d2; cm = mo; }
      }
      if (cm) {
        chef.tx = clamp(cm.x, chef.rect[0] * TILE, chef.rect[2] * TILE);
        chef.ty = clamp(cm.y, chef.rect[1] * TILE, chef.rect[3] * TILE);
        chef.pauseT = 0;
        if (cd2 < 11) {
          G.mice.splice(G.mice.indexOf(cm), 1);
          addParticle(cm.x, cm.y, '#f3ead9', 5, 24);
          addFloat(cm.x, cm.y - 10, 'confiscated!', '#f0d0a0');
          toast('👨‍🍳 The chef got there first. "Health and safety," he says, smugly. No XP for you.');
          G.chefCD = 25;
        }
      }
    }
  }
  for (const b of G.butterflies) updateButterfly(b, dt);
  for (const t of G.toys) updateToy(t, dt);
  for (const c of G.rivals) updateRival(c, dt);
  updateKnocks(dt);
  // removal boxes demand supervision
  if (!G.mischief.has('boxes')) {
    for (const b of G.boxes) if (dist(b.x, b.y, L.x, L.y) < 18) { earnMischief('boxes'); break; }
  }
  // holding the famous radiator
  if (G.napping && G.napKind === TXT_RADIATOR) {
    G.radT += dt;
    if (G.radT >= 45) earnMischief('radiator');
  }

  if (G.visitor && !G.visitor.done) {
    const vi = G.visitor;
    vi.animT += dt;
    const d = dist(vi.x, vi.y, L.x, L.y);
    if (d > 20) {
      vi.x += (L.x - vi.x) / d * 34 * dt;
      vi.y += (L.y - vi.y) / d * 34 * dt;
    } else visitorReaches();
  }

  if (G.laser) { G.laser.t -= dt; if (G.laser.t <= 0) G.laser = null; }
  for (let i = G.boxes.length - 1; i >= 0; i--) { G.boxes[i].t -= dt; if (G.boxes[i].t <= 0) G.boxes.splice(i, 1); }

  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt;
    if (p.t <= 0) G.particles.splice(i, 1);
  }
  for (let i = G.floats.length - 1; i >= 0; i--) {
    const f = G.floats[i];
    f.t -= dt; f.y -= 14 * dt;
    if (f.t <= 0) G.floats.splice(i, 1);
  }

  // kippers banked today (one watcher instead of a hook at every payout)
  if (G.prevFish === undefined) G.prevFish = G.fish;
  if (G.fish > G.prevFish) goalEvent('fish', { n: G.fish - G.prevFish });
  G.prevFish = G.fish;

  // rain on the windows: a soft filtered wash, heavier-sounding indoors
  rainAmbience();

  // camera eases after Larry instead of hard-locking
  const m = curMap();
  const mapW = m.w * TILE, mapH = m.h * TILE;
  const ctx2 = clamp(L.x - VW / 2, 0, Math.max(0, mapW - VW));
  const cty = clamp(L.y - VH / 2, 0, Math.max(0, mapH - VH));
  const ck = Math.min(1, dt * 7);
  G.camX += (ctx2 - G.camX) * ck;
  G.camY += (cty - G.camY) * ck;
  if (mapW < VW) G.camX = (mapW - VW) / 2;
  if (mapH < VH) G.camY = (mapH - VH) / 2;
}

// ---------- Draw ----------
const darkCanvas = document.createElement('canvas');
function draw() {
  const L = G.larry;
  const m = curMap();
  const tod = (G.time / DAYLEN) % 1;
  const dark = G.daily ? 0 : 0.5 - 0.5 * Math.cos(tod * Math.PI * 2); // sorties are played in honest daylight

  const shX = (shakeOn && G.shake > 0) ? (Math.random() - 0.5) * 5 : 0;
  const shY = (shakeOn && G.shake > 0) ? (Math.random() - 0.5) * 5 : 0;
  const camX = G.camX + shX, camY = G.camY + shY;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0b10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(ZOOM, 0, 0, ZOOM, -camX * ZOOM, -camY * ZOOM);

  ctx.drawImage(m.canvas, 0, 0);

  // window sky
  const skyDay = [130, 170, 210], skyNight = [18, 22, 44];
  const sky = skyDay.map((c, i) => Math.round(c + (skyNight[i] - c) * dark));
  for (const [x, y] of m.windows) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = `rgb(${sky[0]},${sky[1]},${sky[2]})`;
    ctx.fillRect(px + 3, py + 3, 10, 9);
    ctx.fillStyle = `rgba(255,255,255,${0.25 - dark * 0.2})`;
    ctx.fillRect(px + 4, py + 4, 3, 2);
    if (G.raining) {
      ctx.strokeStyle = 'rgba(200,220,255,0.5)'; ctx.lineWidth = 0.5;
      for (let i = 0; i < 3; i++) {
        const rx = px + 4 + ((G.time * 20 + i * 37 + x * 13) % 8);
        ctx.beginPath(); ctx.moveTo(rx, py + 4); ctx.lineTo(rx - 1, py + 11); ctx.stroke();
      }
    }
    ctx.fillStyle = '#e5ddc8'; ctx.fillRect(px + 7, py + 3, 2, 9); ctx.fillRect(px + 3, py + 7, 10, 1);
  }

  // pond sparkle
  if (m.water.length) {
    for (let i = 0; i < 5; i++) {
      const w = m.water[(i * 7 + ((G.time / 1.3) | 0) * 3) % m.water.length];
      const gl = (G.time * 2 + i * 1.3) % 1;
      ctx.fillStyle = `rgba(220,240,255,${0.5 * Math.sin(gl * Math.PI)})`;
      ctx.fillRect(w[0] * TILE + 3 + i * 2, w[1] * TILE + 4 + ((i * 5) % 8), 2, 1);
    }
  }

  // fireplaces flicker
  for (const f of m.fires) {
    const px = f.x * TILE, py = f.y * TILE;
    const fl = Math.sin(G.time * 11 + f.x) * 0.5 + 0.5;
    ctx.fillStyle = '#d9822b';
    ctx.fillRect(px + 5, py + 11 - fl * 2, 6, 4 + fl * 2);
    ctx.fillStyle = '#f2b13e';
    ctx.fillRect(px + 6, py + 12 - fl, 4, 3 + fl);
    ctx.fillStyle = '#f8dd7a';
    ctx.fillRect(px + 7, py + 13, 2, 2);
  }

  // grandfather clock pendulum
  for (const d of m.decor) {
    if (d.t !== 'clock') continue;
    const px = d.x * TILE, py = d.y * TILE;
    const sw = Math.sin(G.time * 2.4) * 2;
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + 8 + sw, py + 12); ctx.stroke();
    ctx.fillStyle = '#e9c46a'; ctx.fillRect(px + 7 + sw, py + 12, 2, 2);
  }

  // portraits of the PMs (they accumulate)
  if (m.portraits.length && pmCount > 0) {
    for (let i = 0; i < m.portraits.length; i++) {
      if (i >= pmCount) break;
      const [x, y] = m.portraits[i];
      const px = x * TILE + 3, py = y * TILE + 2;
      const last = (i === m.portraits.length - 1 && pmCount > m.portraits.length);
      ctx.save();
      if (last) { ctx.translate(px + 5, py + 6); ctx.rotate(0.12); ctx.translate(-(px + 5), -(py + 6)); }
      ctx.fillStyle = '#c9a227'; ctx.fillRect(px, py, 10, 12);
      ctx.fillStyle = '#241f1a'; ctx.fillRect(px + 1, py + 1, 8, 10);
      ctx.fillStyle = '#8a8378';
      ctx.fillRect(px + 3, py + 3, 4, 3);
      ctx.fillRect(px + 2, py + 6, 6, 4);
      ctx.restore();
      ctx.font = '4px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = '#e9c46a';
      ctx.fillText(last ? '+' + (pmCount - m.portraits.length + 1) : '' + (i + 1), px + 5, py + 11);
    }
  }

  // Larry's own commissioned portrait(s) on the Grand Staircase — each tier
  // replaces the last with something larger. Vanity, in oils, escalating.
  if (G.ownPortrait > 0 && G.mapId === 'ground') {
    const t9 = G.ownPortrait;
    const w9 = t9 === 1 ? 10 : t9 === 2 ? 14 : 22;
    const h9 = t9 === 1 ? 12 : t9 === 2 ? 16 : 26;
    const px = 4 * TILE + (TILE - w9) / 2, py = (9 + 1) * TILE - 2 - h9; // bottom-aligned to the wall
    ctx.fillStyle = '#c9a227'; ctx.fillRect(px, py, w9, h9);                       // gilt frame
    if (t9 >= 2) { ctx.fillStyle = '#e9c46a'; ctx.fillRect(px + 1, py + 1, w9 - 2, h9 - 2); }
    ctx.fillStyle = '#1e2a22'; ctx.fillRect(px + 2, py + 2, w9 - 4, h9 - 4);       // canvas
    const cx9 = px + w9 / 2, cy9 = py + h9 * 0.42, s9 = t9 === 3 ? 2 : 1;          // the subject
    ctx.fillStyle = '#8a7a5c';
    ctx.fillRect(cx9 - 3 * s9, cy9 - 2 * s9, 6 * s9, 5 * s9);                       // tabby head
    ctx.fillRect(cx9 - 4 * s9, cy9 - 3 * s9, 2 * s9, 2 * s9); ctx.fillRect(cx9 + 2 * s9, cy9 - 3 * s9, 2 * s9, 2 * s9); // ears
    ctx.fillStyle = '#efe9dc'; ctx.fillRect(cx9 - 2 * s9, cy9 + 1 * s9, 4 * s9, 2 * s9); // white muzzle
    ctx.fillStyle = '#84ab50'; ctx.fillRect(cx9 - 2 * s9, cy9, s9, s9); ctx.fillRect(cx9 + s9, cy9, s9, s9); // the eyes
    ctx.fillStyle = '#1e3f8f'; ctx.fillRect(cx9 - 2 * s9, cy9 + 3 * s9, 4 * s9, s9); // the bow tie, of course
    if (t9 >= 3) { ctx.fillStyle = '#c9a227'; ctx.font = '4px monospace'; ctx.textAlign = 'center'; ctx.fillText('LARRY', cx9, py + h9 - 3); }
  }

  // lamps
  for (const [lx, ly] of m.lamps) {
    const wx = lx * TILE, wy = ly * TILE;
    ctx.fillStyle = '#1c1a20'; ctx.fillRect(wx - 1, wy - 14, 2, 14);
    ctx.fillStyle = '#2a2732'; ctx.fillRect(wx - 3, wy - 18, 6, 5);
    ctx.fillStyle = dark > 0.3 ? '#ffd98a' : '#e9e2cf'; ctx.fillRect(wx - 2, wy - 17, 4, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(wx, wy + 1, 4, 1.5, 0, 0, 7); ctx.fill();
  }

  // removal boxes
  for (const b of G.boxes) {
    ctx.fillStyle = '#a2764a'; ctx.fillRect(b.x, b.y, 14, 11);
    ctx.fillStyle = '#8a6138'; ctx.fillRect(b.x, b.y, 14, 3);
    ctx.fillStyle = '#d8cbb0'; ctx.fillRect(b.x + 6, b.y, 2, 11);
    ctx.fillStyle = '#5c4126'; ctx.fillRect(b.x + 2, b.y + 5, 6, 3);
  }

  // interaction prompt above a nearby point of interest
  if (G.nearPoi && !G.napping) {
    const p = G.nearPoi;
    const bob2 = Math.sin(G.time * 4) * 1.5;
    ctx.fillStyle = 'rgba(255,232,184,0.95)';
    ctx.beginPath(); ctx.arc((p.x + 0.5) * TILE, p.y * TILE - 4 + bob2, 2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(20,16,32,0.9)';
    ctx.beginPath(); ctx.arc((p.x + 0.5) * TILE, p.y * TILE - 4 + bob2, 1, 0, 7); ctx.fill();
  }

  // tap-to-walk destination marker
  if (tapTarget) {
    const pu = (G.time * 2) % 1;
    ctx.strokeStyle = `rgba(255,232,184,${0.8 * (1 - pu)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(tapTarget.x, tapTarget.y, 3 + pu * 6, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,232,184,0.9)';
    ctx.fillRect(tapTarget.x - 1, tapTarget.y - 1, 2, 2);
  }

  // laser dot
  if (G.laser) {
    const f = 0.7 + 0.3 * Math.sin(G.time * 30);
    ctx.fillStyle = `rgba(255,40,40,${f})`;
    ctx.beginPath(); ctx.arc(G.laser.x, G.laser.y, 2, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,90,90,${f * 0.35})`;
    ctx.beginPath(); ctx.arc(G.laser.x, G.laser.y, 4.5, 0, 7); ctx.fill();
  }

  // charged-pounce landing marker
  if (L.charging && L.pounceT <= 0 && !G.napping) {
    const pw = Math.min(1, L.chargeT / 0.55);
    let dx = L.dir === 'side' ? (L.flip ? -1 : 1) : 0, dy = L.dir === 'down' ? 1 : L.dir === 'up' ? -1 : 0;
    const vv = joyVec(); if (vv.x || vv.y) { dx = vv.x; dy = vv.y; }
    const dur = pounceDur(G.superArmed, pw);
    const lx2 = L.x + dx * POUNCE_SPD * dur, ly2 = L.y + dy * POUNCE_SPD * dur;
    ctx.strokeStyle = `rgba(233,196,106,${0.35 + pw * 0.4 + Math.sin(G.time * 10) * 0.1})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lx2, ly2, 5 + pw * 3, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgba(233,196,106,${0.5 + pw * 0.3})`;
    ctx.fillRect(lx2 - 1, ly2 - 1, 2, 2);
  }

  // entities sorted by y
  const ents = [];
  for (const kn of G.knocks) ents.push({ y: kn.y, draw: () => drawKnock(kn) });
  for (const t of G.toys) ents.push({ y: t.y - 4, draw: () => drawToy(t) });
  for (const mo of G.mice) ents.push({ y: mo.y, draw: () => drawMouse(mo) });
  for (const c of G.rivals) ents.push({ y: c.y, draw: () => drawRival(c) });
  for (const p of G.paps) ents.push({ y: p.y, draw: () => drawPap(p) });
  for (const n of G.npcs) ents.push({ y: n.y, draw: () => drawPerson(NPC_SPRITES[n.sprite], n.x, n.y, n.animT, n.flip, n.tx && n.pauseT <= 0) });
  // the Cabinet in session: ministers round the boat table by day. Walk in
  // mid-meeting; they will cope. They always cope.
  if (cabinetInSession(dark)) {
    for (const [sx2, sy2, spr2, fl2] of CABINET_SEATS) {
      ents.push({ y: sy2 * TILE, draw: () => drawPerson(spr2, sx2 * TILE, sy2 * TILE, 0, fl2, false) });
    }
  }
  if (G.visitor) ents.push({ y: G.visitor.y, draw: () => drawPerson(P_VISITOR, G.visitor.x, G.visitor.y, G.visitor.animT, false, !G.visitor.done) });
  ents.push({ y: L.y, draw: () => drawLarry(L) });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.draw();

  // tree canopies overhang everything below them
  for (const [tx, ty] of m.trees) {
    ctx.drawImage(TREE_CANOPY, tx * TILE - 5, ty * TILE - 12);
  }

  // butterflies
  for (const b of G.butterflies) {
    const flap = Math.sin(b.t * 18) > 0 ? 1 : 2;
    ctx.fillStyle = b.hue;
    ctx.fillRect(b.x - flap, b.y, flap, 2);
    ctx.fillRect(b.x + 1, b.y, flap, 2);
    ctx.fillStyle = '#33261a'; ctx.fillRect(b.x, b.y, 1, 2);
  }

  for (const p of G.particles) {
    ctx.globalAlpha = Math.min(1, p.t * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;

  // rain in the garden
  // snow drifts over the garden
  if (G.snowing && m.rainy) {
    ctx.fillStyle = 'rgba(240,246,255,0.8)';
    const gx0 = 1 * TILE, gy0 = 1 * TILE, gw = 46 * TILE, gh = 8 * TILE;
    ctx.save(); ctx.beginPath(); ctx.rect(gx0, gy0, gw, gh); ctx.clip();
    for (let i = 0; i < 40; i++) {
      const fx = gx0 + ((i * 61.3 + G.time * 9 + Math.sin(G.time * 0.8 + i) * 14) % gw);
      const fy = gy0 + ((i * 47.7 + G.time * 26) % gh);
      ctx.fillRect(fx, fy, i % 3 ? 1 : 2, i % 3 ? 1 : 2);
    }
    ctx.restore();
  }
  if (G.raining && m.rainy) {
    ctx.strokeStyle = 'rgba(190,210,255,0.35)'; ctx.lineWidth = 0.6;
    const gx0 = 1 * TILE, gy0 = 1 * TILE, gw = 46 * TILE, gh = 8 * TILE;
    ctx.save(); ctx.beginPath(); ctx.rect(gx0, gy0, gw, gh); ctx.clip();
    for (let i = 0; i < 46; i++) {
      const rx = gx0 + ((i * 53.7 + G.time * 130) % gw);
      const ry = gy0 + ((i * 37.3 + G.time * 340) % gh);
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 1.5, ry + 6); ctx.stroke();
    }
    ctx.restore();
  }

  // darkness + lights (night vision is a toggled tool)
  // the basement is below stairs and below lighting standards: always dim —
  // the monocle's natural habitat
  const effDark = G.mapId === 'basement' ? Math.max(dark, 0.55) : dark;
  const alpha = effDark * (G.nv ? 0.42 : 0.58);
  if (alpha > 0.02) {
    darkCanvas.width = canvas.width; darkCanvas.height = canvas.height;
    const dc = darkCanvas.getContext('2d');
    dc.fillStyle = `rgba(10,12,38,${alpha})`;
    dc.fillRect(0, 0, canvas.width, canvas.height);
    dc.globalCompositeOperation = 'destination-out';
    const lights = [{ x: L.x, y: L.y, r: G.nv ? 100 : 65 }];
    for (const [lx, ly] of m.lamps) lights.push({ x: lx * TILE, y: ly * TILE - 16, r: 55 });
    for (const [gx, gy, gr] of (m.glows || [])) lights.push({ x: gx * TILE, y: gy * TILE, r: gr || 60 }); // post-less warm glows
    for (const f of m.fires) lights.push({ x: f.x * TILE + 8, y: f.y * TILE + 14, r: 42 });
    if (G.laser) lights.push({ x: G.laser.x, y: G.laser.y, r: 18 });
    for (const li of lights) {
      const sx = (li.x - camX) * ZOOM, sy = (li.y - camY) * ZOOM, sr = li.r * ZOOM;
      const grd = dc.createRadialGradient(sx, sy, 0, sx, sy, sr);
      grd.addColorStop(0, 'rgba(0,0,0,0.95)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = grd;
      dc.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(darkCanvas, 0, 0);
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -camX * ZOOM, -camY * ZOOM);
    if (G.nv && dark > 0.35) {
      for (const mo of G.mice) {
        ctx.fillStyle = 'rgba(120,255,140,0.25)';
        ctx.beginPath(); ctx.arc(mo.x, mo.y, 5, 0, 7); ctx.fill();
      }
    }
  }

  // sonar: expanding pulse ring, then every mouse pinged through walls
  if (G.sonarRingT >= 0) {
    ctx.strokeStyle = `rgba(140,220,255,${0.7 * (1 - G.sonarRingT / 1.2)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(L.x, L.y, G.sonarRingT * 260, 0, 7); ctx.stroke();
  }
  if (G.sonarT > 0) {
    const pulse = (G.time % 0.9) / 0.9;
    for (const mo of G.mice) {
      ctx.strokeStyle = `rgba(140,220,255,${0.8 * (1 - pulse)})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(mo.x, mo.y, 3 + pulse * 10, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(140,220,255,0.35)';
      ctx.fillRect(mo.x - 1, mo.y - 1, 2, 2);
    }
  }

  // floats
  ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'center';
  for (const f of G.floats) {
    ctx.globalAlpha = Math.min(1, f.t);
    ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 0.5, f.y + 0.5);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // fireflies drift over the garden at night
  if (m.rainy && dark > 0.4 && !G.raining) {
    for (let i = 0; i < 6; i++) {
      const fx = (7 + i * 6.5 + Math.sin(G.time * 0.35 + i * 1.7) * 3.2) * TILE;
      const fy = (2.5 + ((i * 13) % 5) + Math.sin(G.time * 0.6 + i * 2.3) * 1.4) * TILE;
      const gl = 0.4 + 0.4 * Math.sin(G.time * (1.3 + i * 0.17) + i);
      if (gl <= 0.15) continue;
      ctx.fillStyle = `rgba(216,240,160,${gl * 0.25})`;
      ctx.beginPath(); ctx.arc(fx, fy, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(232,255,190,${gl})`;
      ctx.fillRect(fx - 0.5, fy - 0.5, 1.4, 1.4);
    }
  }
  // catch flash
  if (G.flash > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(255,246,222,${Math.min(0.3, G.flash * 3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ZOOM, 0, 0, ZOOM, -camX * ZOOM, -camY * ZOOM);
  }
  if (G.fade > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(5,5,10,${G.fade})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawBowTie(dir) {
  const t = tieDef();
  if (dir === 'side') {
    ctx.fillStyle = t.wing; ctx.fillRect(0, -2, 2, 3); ctx.fillRect(3, -2, 2, 3);
    ctx.fillStyle = t.accent; ctx.fillRect(0, -1, 2, 1); ctx.fillRect(3, -1, 2, 1);
    ctx.fillStyle = t.knot; ctx.fillRect(2, -2, 1, 3);
  } else {
    ctx.fillStyle = t.wing; ctx.fillRect(-4, -2, 3, 3); ctx.fillRect(1, -2, 3, 3);
    ctx.fillStyle = t.accent; ctx.fillRect(-3, -1, 1, 1); ctx.fillRect(2, -1, 1, 1);
    ctx.fillStyle = t.knot; ctx.fillRect(-1, -2, 2, 3);
  }
}

function drawLarry(L) {
  const img = CAT_IMGS.larry;
  // napping on furniture: draw him up on the perch itself
  const px2 = G.napping && G.napPos ? G.napPos.x : L.x;
  const py2 = G.napping && G.napPos ? G.napPos.y : L.y;
  if (!(G.napping && G.napPos)) {
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath(); ctx.ellipse(px2, py2 + 6, 7, 2.4, 0, 0, 7); ctx.fill();
  }
  const dirAnim = p => L.dir === 'side' ? (L.flip ? p + 'Left' : p + 'Right') : L.dir === 'up' ? p + 'Up' : p + 'Down';
  let anim, frame;
  if (G.napping) { anim = 'sleep3'; frame = (G.time * 1.6) % 2; }  // curled cosy, not rump-to-camera
  else if (G.catAnim) { anim = G.catAnim.name; frame = G.catAnim.t * G.catAnim.fps; }
  else if (L.pounceT > 0) {
    anim = dirAnim('paw');
    frame = Math.min(CANIM[anim][1] - 1, Math.max(0, (1 - L.pounceT / pounceDur(L.superP, L.lastPower)) * CANIM[anim][1]));
  } else if (L.moving) {
    anim = dirAnim('walk');
    frame = L.animT * (L.dir === 'side' ? 12 : 8);
  } else if (L.idleT > 2.5) {
    if (G.idleAnim) { anim = G.idleAnim.name; frame = G.idleAnim.t * 6; }
    else { anim = 'sit'; frame = 0; }
  } else { anim = dirAnim('stand'); frame = 0; }
  // squash & stretch: anticipation crouch, mid-air stretch, landing squish
  let sqx = 1, sqy = 1;
  if (!G.napping) {
    if (L.landT > 0) { sqx = 1.14; sqy = 0.82; }
    else if (L.pounceT > 0) {
      const s = Math.sin((1 - L.pounceT / pounceDur(L.superP, L.lastPower)) * Math.PI) * 0.13;
      if (L.dir === 'side') { sqx = 1 + s; sqy = 1 - s; } else { sqx = 1 - s; sqy = 1 + s; }
    } else if (L.charging) {
      const c = Math.min(1, L.chargeT / 0.55);
      sqy = 1 - c * 0.16 + (c >= 1 ? Math.sin(G.time * 40) * 0.02 : 0); // coiled, trembling
      sqx = 1 + c * 0.1;
    }
  }
  ctx.save();
  ctx.translate(px2, py2);
  ctx.scale(sqx, sqy);
  ctx.translate(-px2, -py2);
  if (has('cape') && !G.napping) {
    ctx.fillStyle = '#7c2d3e';
    ctx.fillRect(L.x - 5, L.y - 8, 10, 6 + Math.sin(G.time * 6));
    ctx.fillStyle = '#e9c46a'; ctx.fillRect(L.x - 5, L.y - 9, 10, 1);
  }
  drawCat(img, anim, frame, px2, py2);
  // the bow tie, on any front-ish pose
  const facing = G.napping ? 'none'
    : (anim.endsWith('Up')) ? 'none'
      : (anim.endsWith('Left') || anim.endsWith('Right')) ? 'side' : 'down';
  if (G.bowtie && facing !== 'none') {
    ctx.save();
    ctx.translate(Math.round(L.x), Math.round(L.y));
    if (facing === 'side') { ctx.translate(L.flip ? -8 : 4, -1); drawBowTie('side'); }
    else { ctx.translate(-1, -2 + (CAT_YOFF[anim] || 0)); drawBowTie('down'); }
    ctx.restore();
  }
  if (has('monocle') && facing === 'down' && !G.napping) {
    ctx.fillStyle = 'rgba(160,255,190,0.85)';
    ctx.fillRect(L.x + 3, L.y - 8, 2, 2);
  }
  ctx.restore();
}

function drawMouse(mo) {
  const king = mo.type === 'ratking';
  const spr = MOUSE_SPRITES[king ? 'rat' : mo.type] || MOUSE_SPRITES.grey;
  const rat = mo.type === 'rat' || king;
  ctx.save();
  ctx.translate(mo.x, mo.y);
  // a frozen Very Still Mouse all but vanishes — unless the monocle or a
  // sonar ping is lighting it up
  if (mo.state === 'freeze') ctx.globalAlpha = (G.nv || G.sonarT > 0) ? 0.85 : 0.18;
  const sc = king ? 1.35 : 1;
  ctx.scale(mo.dir * mo.scale * sc, mo.scale * sc);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(0, 4, rat ? 7 : 5, 1.5, 0, 0, 7); ctx.fill();
  const still = mo.state === 'charmed' || mo.state === 'stunned' || mo.state === 'freeze' || mo.busy > 0;
  const hop = still ? 0 : Math.abs(Math.sin(mo.animT * 14)) * 1.4;
  if (mo.busy > 0) { // nose down, tail curled, dead to the world: the stalker's cue
    const sniff = Math.sin(mo.animT * 9) * 0.6;
    ctx.fillStyle = '#d78f92'; ctx.fillRect(6, -1 + sniff, 1, 1); // the twitching nose
    ctx.fillStyle = 'rgba(207,200,184,0.8)';
    if ((mo.animT * 2 | 0) % 2) ctx.fillRect(8, -4 + sniff, 1, 1);
  }
  ctx.strokeStyle = rat ? '#c9838a' : '#d78f92'; ctx.lineWidth = rat ? 1.1 : 0.8;
  ctx.beginPath(); ctx.moveTo(rat ? -8 : -6, 1 - hop);
  ctx.quadraticCurveTo(rat ? -12 : -9, -1 - hop + Math.sin(mo.animT * 10), rat ? -15 : -11, 1 - hop);
  ctx.stroke();
  ctx.drawImage(spr, rat ? -9 : -7, (rat ? -7 : -5) - hop);
  if (mo.type === 'raider') { // the cheese, carried in plain sight
    ctx.fillStyle = '#e9c46a'; ctx.fillRect(-3, -7 - hop, 4, 3);
    ctx.fillStyle = '#c9a227'; ctx.fillRect(-2, -6 - hop, 1, 1); ctx.fillRect(0, -5 - hop, 1, 1);
  }
  if (king) { // a tiny, non-negotiable crown
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(4, -10 - hop, 5, 2);
    ctx.fillRect(4, -12 - hop, 1, 2); ctx.fillRect(6, -12 - hop, 1, 2); ctx.fillRect(8, -12 - hop, 1, 2);
    ctx.fillStyle = '#cf2b3a'; ctx.fillRect(6, -10 - hop, 1, 1);
  }
  if (mo.state === 'stunned') {
    ctx.fillStyle = '#f0d0a0';
    for (let i = 0; i < 3; i++) {
      const a = mo.animT * 6 + i * 2.1;
      ctx.fillRect(Math.cos(a) * 6 - 1, -9 + Math.sin(a) * 1.5, 2, 2);
    }
  }
  ctx.restore();
}

function drawPerson(spr, x, y, animT, flip, walking) {
  const bob = walking ? ((animT * 6 | 0) % 2) : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y + 6, 6, 2, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y - 17 - bob));
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(spr, -8, 0);
  ctx.restore();
}

// ---------- Main loop ----------
let lastT = performance.now(), saveT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
  lastT = now;
  if (!G.running) return;
  pollPad();
  musicTick();
  G.flash = Math.max(0, G.flash - dt);
  if (G.hitstop > 0) G.hitstop -= dt;
  // the final seconds of a Daily Sortie play out in slow motion
  else if (!G.paused) update(G.daily && !G.daily.over && G.daily.t < 3 && G.daily.t > 0 ? dt * 0.55 : dt);
  draw();
  saveT += dt;
  if (saveT > 12) { saveT = 0; save(); }
}
requestAnimationFrame(loop);

// ---------- Boot / title ----------
// shared world entry: HUD, controls, spawns — used by career mode and the daily
function bootWorld() {
  document.getElementById('title').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  if (window.matchMedia('(pointer:coarse)').matches) {
    document.getElementById('stick').classList.remove('hidden');
    document.getElementById('btns').classList.remove('hidden');
  }
  document.getElementById('gadgets').classList.remove('hidden');
  document.getElementById('btnMenu').classList.remove('hidden');
  document.getElementById('btnMap').classList.remove('hidden');
  buildGadgetBar();
  refreshGadgetBar();
  if (has('monocle')) G.nv = true; // night vision on once the monocle is earned
  G.running = true;
  const m = curMap();
  G.camX = clamp(G.larry.x - VW / 2, 0, Math.max(0, m.w * TILE - VW));
  G.camY = clamp(G.larry.y - VH / 2, 0, Math.max(0, m.h * TILE - VH));
  updateHUD();
  G.mice = [];
  for (let i = 0; i < 3; i++) spawnMouse();
  setupNpcs();
  setupButterflies();
  setupToys();
  setupRivals();
  setupKnocks();
  sMeow();
}

// ---------- Daily Sortie: one seeded 120-second run per day, same for everyone ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function startDaily() {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  G.dailyRng = mulberry32(seed);
  G.daily = { t: 120, score: 0, caught: 0, escaped: 0, combo: 0, bestCombo: 0, seed, over: false, shown: -1 };
  G.level = 5; G.xp = 0; G.catches = 0;
  if (!pmCount) pmCount = 1;
  G.pm = 'PM #' + pmCount; G.bowtie = true;
  G.intro = { phase: 'done', catches: 0 };
  G.tut = 9;
  G.mapId = 'ground';
  G.larry.x = 21.5 * TILE; G.larry.y = 31 * TILE;
  G.time = 40; G.isNight = false;
  G.raining = false; G.snowing = false; G.rainT = 1e9;
  G.press.active = false; G.press.cd = 1e9; G.paps = [];
  G.brief = null; G.briefCD = 1e9;
  G.ratKingCD = 1e9;
  G.summons = null; G.summonsCD = 1e9;
  G.fish = 10; G.stam = 100; G.larder = 0; // fixed ration: gadget budgeting is part of the puzzle
  bootWorld();
  toast('📅 TODAY\'S SORTIE — 120 seconds. Everyone in the world gets these exact mice today. Set a score worth sharing. GO!');
  tone(523, 784, 0.25, 'triangle', 0.07);
}
function dailySeedStr(seed) {
  const y = (seed / 10000) | 0, mo = ((seed / 100) | 0) % 100, da = seed % 100;
  return da + '/' + mo + '/' + y;
}
function dailyEnd() {
  const D = G.daily;
  D.over = true;
  G.paused = true;
  const key = 'larry-daily-' + D.seed;
  let best = 0;
  try { best = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) { }
  const isBest = D.score > best;
  if (isBest) { best = D.score; try { localStorage.setItem(key, '' + best); } catch (e) { } }
  const statsLine = '🐭 ' + D.caught + ' caught · 💨 ' + D.escaped + ' escaped · 🔥 best streak ×' + D.bestCombo;
  // the compact grid line is what actually gets pasted into the group chat
  const grid = (D.caught ? '🐭'.repeat(Math.min(D.caught, 10)) + (D.caught > 10 ? '+' : '') : '—')
    + (D.escaped ? ' 💨×' + D.escaped : '')
    + (D.perfects ? ' ⭐×' + D.perfects : '')
    + (D.bestCombo > 1 ? ' 🔥×' + D.bestCombo : '');
  D.shareText = '🐈 LARRY — Daily Sortie ' + dailySeedStr(D.seed) +
    '\n' + grid +
    '\n🏆 ' + D.score + (isBest ? ' — personal best!' : ' (best today: ' + best + ')');
  document.getElementById('dailyStats').textContent = statsLine;
  document.getElementById('dailyScore').textContent = D.score + (isBest ? ' ★ NEW BEST' : '');
  document.getElementById('dailyBest').textContent = 'Best today: ' + best + ' · ' + dailySeedStr(D.seed);
  document.getElementById('dailyWrap').classList.remove('hidden');
  [784, 659, 523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, 'square', 0.06, i * 0.09));
}

function startGame(fresh) {
  const s = fresh ? null : loadSave();
  if (s && s.introDone) {
    G.level = s.level; G.xp = s.xp; G.catches = s.catches; G.pm = s.pm; G.pmDays = s.pmDays || 1;
    pmCount = s.pmCount || 1;
    G.bowtie = !!s.bowtie;
    G.intro.phase = 'done';
    G.mapId = MAPS[s.mapId] ? s.mapId : 'ground';
    G.larry.x = s.x || 21.5 * TILE; G.larry.y = s.y || 31 * TILE;
    G.secretsFound = new Set(s.secrets || []);
    G.honours = new Set(s.honours || []);
    G.nightCatches = s.nightCatches || 0;
    G.escapes = s.escapes || 0;
    G.briefsDone = s.briefsDone || 0;
    G.briefStage = s.briefStage || 0;
    G.approval = s.approval != null ? s.approval : 72;
    G.diff = DIFFS[s.diff] ? s.diff : 'mouser';
    G.tie = TIES.some(t => t.id === s.tie) ? s.tie : 'union';
    G.mischief = new Set(s.mischief || []);
    // saves from before the flatter XP curve can bank xp above the new,
    // lower thresholds — clamp so one catch doesn't fire a burst of level-ups
    G.xp = Math.min(G.xp, Math.max(0, xpNeed(G.level) - 1));
    // pre-economy saves get a kipper allowance proportional to their career
    G.fish = s.fish != null ? s.fish : Math.min(30, Math.floor((s.catches || 0) / 2) + 5);
    G.larder = s.larder || 0;
    G.ownPortrait = s.ownPortrait || 0;
    G.lives = s.lives || 0;
    G.stam = 100;
  } else {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
    G.level = 1; G.xp = 0; G.catches = 0; pmCount = 0;
    G.pm = null; G.bowtie = false;
    G.intro = { phase: 'shelter', catches: 0 };
    G.mapId = 'shelter';
    G.larry.x = 11 * TILE; G.larry.y = 10 * TILE;
    G.approval = 72; G.tie = 'union';
    G.mischief = new Set();
    G.fish = 5; G.larder = 0; G.stam = 100;
    fresh = true;
  }
  if (location.search.includes('skipintro') && G.intro.phase !== 'done') {
    G.intro.phase = 'done'; G.bowtie = true; G.pm = nextPM();
    G.mapId = 'ground'; G.larry.x = 21.5 * TILE; G.larry.y = 31 * TILE;
  }
  const q = new URLSearchParams(location.search);
  const lvParam = parseInt(q.get('lv'), 10);
  if (lvParam) G.level = lvParam;
  if (q.get('press')) G.press.cd = 0.05;
  if (q.get('brief')) G.briefCD = 0.3;
  if (q.get('night')) G.time = 75;
  if (q.get('snow')) { G.snowing = true; G.raining = false; G.rainT = 60; }
  const mapParam = q.get('map');
  if (mapParam && MAPS[mapParam]) {
    G.mapId = mapParam;
    const qx = parseFloat(q.get('x')), qy = parseFloat(q.get('y'));
    G.larry.x = (isNaN(qx) ? MAPS[mapParam].w / 2 : qx + 0.5) * TILE;
    G.larry.y = (isNaN(qy) ? MAPS[mapParam].h / 2 : qy + 0.5) * TILE;
  }

  bootWorld();
  initDay(); // the morning Red Box (career mode, once the intro is done)
  if (fresh && G.intro.phase === 'shelter' && !location.search.includes('nocard')) {
    showCard('SOUTH LONDON, PRESENT DAY', 'Battersea',
      'The shelter is warm. The service is adequate. The other cats lack ambition. You are LARRY — currently between opportunities — and the mice in Cattery 4 have grown complacent. Show whoever is watching what you can do. (Catch 2 mice.)',
      null, null);
  }
}

document.getElementById('btnNew').addEventListener('click', () => { audio(); playMotif(0.13, 0.055, 'square'); startGame(true); });
document.getElementById('btnContinue').addEventListener('click', () => { audio(); playMotif(0.13, 0.055, 'square'); startGame(false); });
document.getElementById('btnDaily').addEventListener('click', () => { audio(); sClick(); startDaily(); });
// PWA: offline play when served over http(s) with sw.js alongside (no-op in the artifact)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  try { navigator.serviceWorker.register('sw.js').catch(() => { }); } catch (e) { }
}
// pounce button: press to charge, release to leap (tap = instant pounce)
{
  const pb = document.getElementById('btnPounce');
  if (window.PointerEvent) {
    let ptrId = null;
    pb.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); audio();
      if (chargeStart('ptr')) ptrId = e.pointerId; // only claim it if we actually own the charge
    });
    window.addEventListener('pointerup', e => { if (ptrId !== null && e.pointerId === ptrId) { ptrId = null; chargeRelease('ptr'); } });
    window.addEventListener('pointercancel', e => { if (ptrId !== null && e.pointerId === ptrId) { ptrId = null; chargeCancel(); } });
  } else {
    pb.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); audio(); chargeStart('ptr'); }, { passive: false });
    pb.addEventListener('touchend', e => { e.preventDefault(); chargeRelease('ptr'); }, { passive: false });
    pb.addEventListener('click', () => { if (chargeStart('ptr')) chargeRelease('ptr'); });
  }
}
function toggleMute() {
  muted = !muted;
  document.getElementById('btnMute').textContent = muted ? '🔇' : '🔊';
  menuLabels();
}
bindBtn(document.getElementById('btnMute'), toggleMute);

// ---------- Pause menu ----------
let menuOpen = false, restartArmed = false;
function menuLabels() {
  document.getElementById('menuSound').textContent = muted ? 'Sound: OFF' : 'Sound: ON';
  document.getElementById('menuMusic').textContent = musicOn ? 'Music: ON' : 'Music: OFF';
  document.getElementById('menuShake').textContent = 'Screen shake: ' + (shakeOn ? 'ON' : 'OFF');
  document.getElementById('menuDiff').textContent = 'Difficulty: ' + DIFF().label;
  document.getElementById('menuTie').textContent = 'Bow tie: 🎀 ' + tieDef().name;
  document.getElementById('menuMischief').textContent = '😼 Mischief';
}
function openMenu() {
  if (!G.running || G.paused || menuOpen) return;
  menuOpen = true; G.paused = true; restartArmed = false;
  const dayLines = DAY && !G.daily && G.intro.phase === 'done'
    ? '\n' + DAY.goals.map(g => (g.prog >= g.n ? '✓ ' : '· ') + g.text + (g.n > 1 ? ' (' + Math.min(g.prog, g.n) + '/' + g.n + ')' : '')).join('\n')
    + (DAY.streak > 0 ? '\n🔥 streak: ' + DAY.streak : '')
    : '';
  document.getElementById('menuStats').textContent =
    '🐭 ' + G.catches + ' caught   🏅 ' + G.honours.size + ' honours   🔍 ' + G.secretsFound.size + ' secrets   PM #' + pmCount
    + (G.lives ? '   🐾 life ' + (G.lives + 1) : '') + dayLines;
  // a New Life unlocks once the Garter is conferred (the L17 finale)
  document.getElementById('menuLife').classList.toggle('hidden', !(G.honours.has('garter') && !G.daily));
  menuLabels();
  document.getElementById('menuRestart').textContent = 'Restart from Battersea';
  document.getElementById('menuWrap').classList.remove('hidden');
  sClick();
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; G.paused = false;
  document.getElementById('menuWrap').classList.add('hidden');
  sClick();
}
bindBtn(document.getElementById('btnMenu'), () => { audio(); menuOpen ? closeMenu() : openMenu(); });
bindBtn(document.getElementById('menuResume'), closeMenu);
bindBtn(document.getElementById('menuSound'), toggleMute);
bindBtn(document.getElementById('menuMusic'), () => { musicOn = !musicOn; menuLabels(); sClick(); });
bindBtn(document.getElementById('menuShake'), () => {
  shakeOn = !shakeOn;
  try { localStorage.setItem('larry-shake', shakeOn ? 'on' : 'off'); } catch (e) { }
  menuLabels(); sClick();
});
bindBtn(document.getElementById('menuDiff'), () => {
  if (G.daily) { toast('📅 Difficulty is locked during a Daily Sortie — same run for everyone.'); return; }
  const ks = Object.keys(DIFFS);
  G.diff = ks[(ks.indexOf(G.diff) + 1) % ks.length];
  menuLabels(); sClick(); save();
});
bindBtn(document.getElementById('menuTie'), () => {
  const unlocked = TIES.filter(t => G.honours.size >= t.need);
  const i = unlocked.findIndex(t => t.id === G.tie);
  G.tie = unlocked[(i + 1) % unlocked.length].id;
  if (unlocked.length < TIES.length && (i + 1) >= unlocked.length) {
    const nxt = TIES.find(t => G.honours.size < t.need);
    if (nxt) toast('🎀 Next: ' + nxt.name + ' — unlocks at ' + nxt.need + ' honours (you have ' + G.honours.size + ').');
  }
  menuLabels(); sClick(); save();
});
bindBtn(document.getElementById('menuPhoto'), photoMode);
function openMischief() {
  document.getElementById('menuWrap').classList.add('hidden');
  menuOpen = false; G.paused = true;
  document.getElementById('mischiefList').innerHTML = MISCHIEF.map(it =>
    G.mischief.has(it.id)
      ? '<div class="mrow done">✓ ' + it.text + '</div>'
      : '<div class="mrow">🔍 ' + it.hint + '</div>').join('');
  document.getElementById('mischiefWrap').classList.remove('hidden');
  sClick();
}
bindBtn(document.getElementById('menuMischief'), openMischief);

// ---------- House map: a pop-out schematic of No. 10, floor by floor ----------
const HOUSE_FLOORS = [
  { id: 'street', label: 'OUTSIDE · DOWNING STREET' },
  { id: 'flat', label: 'THE PRIVATE FLAT · ABOVE No. 11' },
  { id: 'first', label: 'FIRST FLOOR' },
  { id: 'ground', label: 'GROUND FLOOR' },
  { id: 'basement', label: 'BASEMENT' },
];
const floorLabel = id => (HOUSE_FLOORS.find(f => f.id === id) || {}).label || '';
function openHouseMap() {
  document.getElementById('menuWrap').classList.add('hidden');
  menuOpen = false; G.paused = true;
  const onFloor = HOUSE_FLOORS.some(f => f.id === G.mapId);
  document.getElementById('mapHere').textContent = G.mapId === 'street'
    ? 'outside, on Downing Street'
    : onFloor ? (G.region || '—') + ' · ' + floorLabel(G.mapId).toLowerCase()
      : 'not in the house';
  const host = document.getElementById('mapFloors');
  host.textContent = '';
  for (const f of HOUSE_FLOORS) {
    const m = MAPS[f.id];
    if (!m || !m.canvas) continue;
    const here = G.mapId === f.id;
    const div = document.createElement('div');
    div.className = 'mapfloor' + (here ? ' here' : '');
    const label = document.createElement('div');
    label.className = 'flabel';
    label.textContent = f.label;
    if (here) { const you = document.createElement('span'); you.className = 'fyou'; you.textContent = ' — 🐈 you are here'; label.appendChild(you); }
    div.appendChild(label);
    // scale the pre-rendered floor plan down to fit; mark Larry on his floor
    const TW = 320, scale = TW / (m.w * TILE), TH = Math.round(m.h * TILE * scale);
    const c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(m.canvas, 0, 0, m.w * TILE, m.h * TILE, 0, 0, TW, TH);
    if (here) {
      const mx = G.larry.x * scale, my = G.larry.y * scale;
      g.fillStyle = 'rgba(11,11,16,0.9)'; g.beginPath(); g.arc(mx, my, 6.5, 0, 7); g.fill();
      g.fillStyle = '#9fe8a0'; g.beginPath(); g.arc(mx, my, 4.5, 0, 7); g.fill();
      g.fillStyle = '#0b0b10'; g.beginPath(); g.arc(mx, my, 1.8, 0, 7); g.fill();
    }
    div.appendChild(c);
    const rooms = document.createElement('div');
    rooms.className = 'frooms';
    (m.regions || []).forEach((r, i) => {
      if (i) rooms.appendChild(document.createTextNode(' · '));
      const name = r[4];
      if (here && name === G.region) { const b = document.createElement('b'); b.style.color = '#9fe8a0'; b.textContent = name; rooms.appendChild(b); }
      else rooms.appendChild(document.createTextNode(name));
    });
    div.appendChild(rooms);
    host.appendChild(div);
  }
  document.getElementById('mapWrap').classList.remove('hidden');
  sClick();
}
function houseMapOpen() { return !document.getElementById('mapWrap').classList.contains('hidden'); }
function closeHouseMap() {
  document.getElementById('mapWrap').classList.add('hidden');
  G.paused = false;
  sClick();
}
// pull the map up (or put it away) from anywhere in play — Pokémon-style
function toggleHouseMap() {
  if (!G.running) return;
  if (houseMapOpen()) { closeHouseMap(); return; }
  // don't pop it over a story card or the daily results
  if (!document.getElementById('cardWrap').classList.contains('hidden')) return;
  if (!document.getElementById('dailyWrap').classList.contains('hidden')) return;
  openHouseMap();
}
bindBtn(document.getElementById('menuMap'), openHouseMap);
bindBtn(document.getElementById('mapClose'), closeHouseMap);
bindBtn(document.getElementById('btnMap'), toggleHouseMap);

// ---------- Save codes: the career as a portable string ----------
function exportCode() {
  if (!G.daily) save(); // freshen the stored career first (dailies never touch it)
  const raw = localStorage.getItem(SAVE_KEY);
  return raw ? 'LARRY1.' + btoa(raw) : '';
}
function importCode(code) {
  try {
    const c = (code || '').trim();
    if (!c.startsWith('LARRY1.')) throw new Error('prefix');
    const json = atob(c.slice(7));
    const s = JSON.parse(json);
    if (typeof s.level !== 'number' || !s.introDone) throw new Error('shape');
    localStorage.setItem(SAVE_KEY, json);
    location.reload();
  } catch (e) {
    toast("❌ That code didn't take — make sure you copied the whole thing, LARRY1. and all.");
    tone(220, 160, 0.15, 'square', 0.05);
  }
}
function openSaveBox() {
  document.getElementById('menuWrap').classList.add('hidden');
  menuOpen = false; G.paused = true;
  const code = exportCode();
  document.getElementById('saveCode').value = code || '(no career save yet — finish the Battersea intro first)';
  document.getElementById('saveIn').value = '';
  document.getElementById('saveWrap').classList.remove('hidden');
  sClick();
}
bindBtn(document.getElementById('menuSave'), openSaveBox);
// plain click for clipboard access (needs real user activation on mobile)
document.getElementById('saveCopy').addEventListener('click', () => {
  const code = document.getElementById('saveCode').value;
  if (!code.startsWith('LARRY1.')) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code)
      .then(() => toast('📋 Save code copied. Text it to yourself — Larry travels well.'))
      .catch(() => toast('Long-press the code box to copy it.'));
  } else toast('Long-press the code box to copy it.');
});
document.getElementById('saveLoad').addEventListener('click', () => importCode(document.getElementById('saveIn').value));
bindBtn(document.getElementById('saveClose'), () => {
  document.getElementById('saveWrap').classList.add('hidden');
  G.paused = false;
  sClick();
});
bindBtn(document.getElementById('mischiefClose'), () => {
  document.getElementById('mischiefWrap').classList.add('hidden');
  G.paused = false;
  sClick();
});
// ---------- Nine Lives: prestige, feline edition ----------
// After the Garter, a New Life restarts the climb — level, gadgets and the
// campaign reset — while everything EARNED endures: honours, secrets,
// mischief, bow ties, the staircase portraits, your own portrait, the
// lifetime catch count and the day streak. Each life spent adds +8% XP
// forever and a slightly better-provisioned first morning.
function beginNewLife() {
  document.getElementById('menuWrap').classList.add('hidden');
  menuOpen = false;
  const next = (G.lives || 0) + 2; // lives=0 means life 1: the next is life 2
  showChoice('THE NINTH LIFE PROTOCOL', 'Life ' + next + ' of Nine',
    'Cats are issued nine lives; you have been using this one since Battersea. Begin another?\n\nThe level, the gadgets and the Red Box campaign reset — a fresh climb, a fresh war with the mice. Everything EARNED remains: the honours, the secrets, the mischief, the bow ties, every portrait on the staircase (including, obviously, yours), and the streak.\n\nOld lives leave their mark: each one sharpens the instincts (+8% XP, forever) and the kitchen starts you better provisioned. The mice will not know what has hit them. Again.',
    '🐾 Begin Life ' + next, '🛋️ Remain, for now', which => {
      if (which !== 'a') { G.paused = false; return; }
      G.lives = (G.lives || 0) + 1;
      earnHonour('newlife');
      G.level = 1; G.xp = 0;
      G.fish = 5 + G.lives * 5;
      G.larder = 0; G.briefStage = 0; G.brief = null; G.briefCD = 10;
      G.nv = false; G.superArmed = false; G.dream = null; G.crisis = false;
      G.approval = Math.max(60, Math.round(G.approval)); // the nation remembers fondly
      startFade(() => {
        switchMap('ground', 21.5 * TILE, 31 * TILE);
        buildGadgetBar(); refreshGadgetBar();
        updateHUD();
        showCard('LONDON SW1A 2AA — AGAIN', 'The First Morning (Again)',
          'You wake on the famous radiator as though none of it ever happened — except all of it happened, and the wall of honours proves it. Somewhere below, a new generation of mice is being told you are only a legend.\n\nCorrect them.',
          null, () => { save(); pressFlashes(G.larry.x, G.larry.y, 6); });
      });
    });
}
bindBtn(document.getElementById('menuLife'), beginNewLife);

bindBtn(document.getElementById('menuRestart'), () => {
  if (!restartArmed) {
    restartArmed = true;
    document.getElementById('menuRestart').textContent = 'Sure? Tap again to restart';
    return;
  }
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  location.reload();
});

// ---------- Photo mode ----------
// frames the live canvas like a No. 10 press photo; long-press or Save to keep
function photoMode() {
  document.getElementById('menuWrap').classList.add('hidden');
  menuOpen = false; G.paused = true;
  const b = Math.round(20 * DPR), band = Math.round(58 * DPR);
  const pc = document.createElement('canvas');
  pc.width = canvas.width + b * 2; pc.height = canvas.height + b * 2 + band;
  const p = pc.getContext('2d');
  p.fillStyle = '#f3ead9'; p.fillRect(0, 0, pc.width, pc.height);
  p.drawImage(canvas, b, b);
  p.strokeStyle = '#d8cbaa'; p.lineWidth = Math.max(1, DPR);
  p.strokeRect(b - 1, b - 1, canvas.width + 2, canvas.height + 2);
  p.fillStyle = '#33291d';
  p.font = Math.round(9 * DPR) + 'px "Press Start 2P", monospace';
  p.fillText('LARRY · CHIEF MOUSER TO THE CABINET OFFICE', b, pc.height - band + Math.round(20 * DPR));
  p.fillStyle = '#8a7657';
  p.font = Math.round(7 * DPR) + 'px "Press Start 2P", monospace';
  p.fillText(new Date().toDateString() + ' · No. 10 Downing Street · mice: ' + G.catches, b, pc.height - band + Math.round(38 * DPR));
  const url = pc.toDataURL('image/png');
  document.getElementById('photoImg').src = url;
  const a = document.getElementById('photoSave');
  a.href = url; a.download = 'larry-no10.png';
  document.getElementById('photoWrap').classList.remove('hidden');
  sClick();
}
bindBtn(document.getElementById('photoClose'), () => {
  document.getElementById('photoWrap').classList.add('hidden');
  G.paused = false;
});

// ---------- Daily Sortie buttons ----------
// plain click, not pointerdown: navigator.share needs the transient user
// activation that touch pointerdown doesn't grant
document.getElementById('dailyCopy').addEventListener('click', () => {
  const t = G.daily && G.daily.shareText;
  if (!t) return;
  if (navigator.share) {
    navigator.share({ text: t }).catch(() => {
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('📋 Result copied — paste it to a friend.')).catch(() => { });
    });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(t).then(() => toast('📋 Result copied — paste it to a friend.')).catch(() => { });
  }
});
bindBtn(document.getElementById('dailyDone'), () => location.reload());
document.getElementById('titleCat').textContent = '🐈';
const existingSave = loadSave();
if (existingSave && existingSave.introDone) document.getElementById('btnContinue').classList.remove('hidden');
if (location.search.includes('autostart')) startGame(true);

// sprite-sheet inspection mode for development: ?gallery
if (location.search.includes('gallery')) {
  document.getElementById('title').classList.add('hidden');
  setTimeout(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d2030'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const SC = 4;
    const anims = [['sit', 0], ['walkDown', 1], ['walkRight', 2], ['walkUp', 1], ['sleepL', 0], ['yawn', 4], ['wash', 3], ['pawRight', 3], ['eat', 2]];
    Object.keys(CAT_IMGS).forEach((k, ri) => {
      const img = CAT_IMGS[k];
      anims.forEach(([name, fr], fi) => {
        const a = CANIM[name];
        ctx.drawImage(img, fr * 32, a[0] * 32, 32, 32, 16 + fi * 34 * SC / 1.6, 12 + ri * 34 * SC / 1.2, 32 * SC / 1.6, 32 * SC / 1.6);
      });
    });
  }, 400);
}
