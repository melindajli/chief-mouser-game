# LARRY — Roadmap & Brainstorm

Where the game could go next: the most technically ambitious gaps, and what a
consumer would notice is missing. Guiding star: **fun, cute, escalating
challenge — playable by kids and adults alike.**

## Most technically ambitious gaps

1. **Daily Downing Street (shareable seeded runs).** A deterministic daily
   seed (mouse spawns, weather, PM events) so everyone plays the *same* day
   and compares scores — Wordle-style virality with a share card
   ("Day 142 at No. 10 — 23 mice, 0 escapes 🐈"). Needs a seeded RNG
   throughout and a run-summary screen.
2. **Ghost cats / async multiplayer.** Record an input trace of a run and
   replay a friend's "ghost Larry" in your house racing you to the same mice.
   No servers needed if shared via URL-encoded traces.
3. **Adaptive WebAudio score.** Replace bleeps with a generative soundtrack
   that layers stems by state: cosy harp by the fire, sneaky pizzicato when
   stalking, brass sting when the Rat King appears, muffled rain filter in
   the garden.
4. **Real pathfinding AI.** Mice currently steer reactively; A* over the tile
   grid would let them *plan* routes to mouseholes, cut through furniture
   gaps, and coordinate (one decoys, one dashes) — a real difficulty
   multiplier that reads as intelligence, not unfair speed.
5. **WebGL lighting pass.** True 2D dynamic lights (lamps casting furniture
   shadows, Larry's night-vision as a shader, flashbulb bloom) instead of
   canvas-composited darkness.
6. **PWA + offline + cloud saves.** Installable icon on kids' tablets,
   service-worker offline play, save-slot sync across phone/desktop.
7. **Gamepad + full accessibility.** Controller support, remappable keys,
   reduced-motion / colour-blind / dyslexia-friendly font options, screen-
   reader labels on all buttons.
8. **Localization.** The writing is the charm — a string table would let it
   be charming in Welsh, French, etc.

## What's missing from a consumer's perspective

- **Onboarding.** A first-minute guided tutorial (Battersea already is one —
  make it teach: move → pounce → gadget → nap) with no reading required, so
  a 6-year-old can start.
- **A visible goal ladder.** Session goals ("Today's briefs: 3"), a daily
  streak, and a clear long arc (Chief Mouser → Order of the Garter?) so every
  session opens with a reason to play.
- **Fail states with grace.** Nothing truly bad can happen yet. Gentle stakes
  — a "Press Approval" meter that dips when mice escape during photo-ops and
  triggers a cheeky headline — give adults tension without punishing kids.
- **Cosmetic progression.** Unlockable bow ties (tartan, rainbow, black tie
  for state dinners), hats, collars — earned via honours. Kids replay for
  outfits; zero balance impact.
- **Photo mode.** Freeze, frame, sticker, and save a PNG of Larry mid-pounce.
  This is the #1 shareability feature for a cute game.
- **Difficulty settings.** "Kitten" (slower mice, no escapes) / "Mouser" /
  "Chief Mouser" (night-only spawns, faster Rat King).
- **Save slots** so siblings can share a device.
- **Session summary screen** — what you caught, found, and unlocked today.
- **Sound design depth** — more purrs, rain-on-window, distant division bell.

## Recently shipped (this branch)

- Unified Pointer Events input: joystick-drag, tap-to-walk, tap-Larry-to-meow
  now work identically on touch, mouse, and pen; buttons fire on pointerdown
  (no 300ms delay, no double-fire).
- `visualViewport`-aware canvas sizing (mobile URL bar / rotation safe).
- Pause menu (⚙️ / ESC): resume, sound toggle, career stats, safe restart.
- **Daily Sortie** (#1 above): date-seeded 120s score attack, deterministic
  spawn sequence, combo scoring, per-day personal best, share/copy result.
  (Caveat: the seed drives the spawn *sequence*; later draws can shift as
  your play changes when the spawn cap bites. Good enough to compare runs.)
- **Adaptive music** (#3): generative pentatonic score — calm plucks, a
  sneaky under-layer when a mouse is close, a tense drone for the Rat King
  and the press pack. Toggle in the menu.
- **Pathfinding** (#4, the BFS half): escaping mice now plot a route to
  their hole around the furniture. (Full A* coordination still to come.)
- **Gamepad + meow key** (#7 partial): controllers fully mapped; Q to meow.
- **PWA** (#6 partial): manifest + service worker + real-sprite icons;
  installable and offline when served over HTTP. (Cloud saves still need a
  backend.)
- **Press Approval meter**: the consumer-facing "gentle stakes" — escapes
  and bad headlines drag it down, a sub-30% dip triggers a crisis and
  summons the press; 95% earns the Darling of the Press honour.
- **Cosmetics**: six bow ties unlocked by honours, worn in-world.
- **Photo Mode**: framed press-photo PNG with caption and date.
- **Difficulty settings**: Kitten (slow mice, press visits are consequence-
  free) / Mouser / Chief Mouser (faster, twitchier).
- **Tutorial**: two timed hints in the shelter teach move + pounce.

- **Charge-pounce**: hold 🐾/SPACE/pad-A to wind up (crouch, tremble, landing
  marker), release to fly up to ~1.9× further; a fully-wound catch scores a
  PERFECT bonus. Taps behave exactly as before.
- **The List of Mischief**: 8 cheeky objectives (knock the Cabinet teacup,
  topple the Regency vase, scatter the briefing, steal the sandwich, meow at
  the press, photobomb a flash, supervise removal boxes, hold the radiator)
  with knockable props, an in-menu checklist showing hints until solved, and
  the Registered National Menace honour for the full set.
- **Juice pass**: squash & stretch on pounce/charge/landing, landing dust,
  about-turn poofs, catch micro-shake, "SO close!" near-miss feedback, and
  slow-motion with heartbeat ticks over a Daily Sortie's final 3 seconds.

- **Third act + finale** (from the full-playthrough review): bespoke story
  beats for levels 8–14 (King Rat at large, the Palmerston Incident, the
  State Visit, the mouse committee, the Christmas card, a Question in the
  House, the Biography), a level-15 finale — the Order of the Garter
  (Feline Division), with its own honour — followed by a "You Remain"
  credits card that hands over to open-ended prestige play.
- **XP curve bend**: exponential only through the gadget era (lv ≤ 10),
  linear after. Level 20 now costs ~34 worst-case catches instead of 143;
  full-arc playthrough dropped from 302 catches to 134.
- **Variety pass**: PM exit reasons 9 → 16, flavour dispatches 6 → 14.

- **The depth batch** (from the gameplay-gaps review): stamina ("puff")
  spent by pounces and restored by naps/the food bowl, with a tired
  debuff; a kipper economy (🐟 per catch/brief/mischief/press win) that
  gadget activations spend; larder stakes — escaped mice provision the
  Rat King, who returns sooner and tougher; mandatory SUMMONS photo-ops
  that pause briefs and punish snubs; a permanently dim basement; and a
  Kitchen chef who competes for mice.

Still open from the list: ghost cats, WebGL lighting, cloud saves,
localization, remappable keys/colour-blind modes, save slots, NPC daily
schedules, mouse counterplay types, stealth vision cones, daily mutators,
Mouser's Logbook, dream vignettes, day-structure event waves, prestige
("A New Reign"), session bookends, house map.
