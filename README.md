# LARRY — Chief Mouser to the Cabinet Office

A cosy top-down pixel-art game about the real Larry: from a Battersea shelter
to No. 10 Downing Street, complete with his Union Jack bow tie. Prime Ministers
(numbered, anonymous, ever-changing) come and go — you remain, catching mice,
levelling up, and collecting increasingly silly government-issue gadgets.

## The story

You start at Battersea, catching mice in Cattery 4 to impress a mysterious
visitor in a very serious grey suit. Papers are signed, a bow tie is issued,
and PM #1 carries you over the famous threshold. From then on the PMs churn
(vans, flashbulbs, staircase portraits) while your legend grows.

## The house

Explorable and laid out after the real No. 10:

- **Ground floor** — the Entrance Hall (checkerboard floor, black door),
  the Corridor, the Cabinet Room (boat table, green baize, garden windows),
  the Press Office, the PM's Study, and the Grand Staircase — where a
  portrait of every PM accumulates as they come and go
- **Basement** — the Kitchen (big pine table), the Pantry, and the Cellar:
  prime mouse country
- **First floor** — the White Drawing Room, Terracotta Room, Pillared
  Drawing Room, and the State and Small Dining Rooms
- **The Garden** — lawn, bushes, and rain

## Play

It's a static site — no build step. Serve the folder and open it:

```bash
cd larry-game
python3 -m http.server 8000
# open http://localhost:8000
```

Works on desktop (WASD / arrows to move, SPACE to pounce, E for the laser,
Q to meow), on phones (drag anywhere to steer, tap to walk, buttons on the
right), and with a gamepad (stick to move, A pounce, B meow, face/shoulder
buttons for gadgets, START for the menu). Served over HTTP it's also an
installable PWA that works offline.

## Features

- Mice with wander/flee/lured AI, spawning from mouseholes per room
- XP + levels with story "dispatch" cards between them
- Gadgets: Bureaucratic Zoomies, Sonic Whiskers, Diplomatic Collar,
  Laser Pointer of State, Night-Vision Monocle, Ceremonial Cape
- Numbered PMs with gently absurd exit reasons (removal vans and press
  flashbulbs included), tracked with a days-in-office counter
- **Daily Sortie** — a seeded 120-second score attack, the same mice for
  everyone in the world that day, with a shareable result card
- **Press Approval** meter: catches nudge it up, escapes drag it down, and
  the columnists pounce when it dips below 30%
- **Puff & kippers** — pouncing costs stamina (naps and the food bowl
  restore it; a puffed cat leaps short), and gadgets cost kippers 🐟
  earned by catching mice, finishing briefs, and mischief
- **Stakes** — escaping mice raid the pantry for the Rat King's larder:
  he returns sooner, better fed, and worth a big kipper bounty
- **Summons** — politics interrupts: report to the named room for the
  photo-op or read about the snub in tomorrow's papers (briefs pause
  while you're wanted)
- **Room character** — the basement is properly dim (bring the monocle),
  and the Kitchen chef competes with you for mice
- **Photo Mode** — frame the moment like a No. 10 press photo and save it
- Unlockable bow ties (Black Tie, Tartan, Downing Rose, State Gold,
  Rainbow) earned through honours; three difficulty settings from
  🍼 Kitten to 🎩 Chief Mouser
- A generative ambient score that goes sneaky when you stalk and tense
  when the Rat King surfaces; escaping mice plot real routes home (BFS
  pathfinding) instead of running at walls
- Day/night lighting, lamps, rain, and a film-grain vignette for the mood
- Progress auto-saves to localStorage

Dev/test URL params: `?autostart` (skip title), `&nocard` (skip intro card),
`&skipintro` (jump straight to No. 10), `&map=basement&x=4&y=13` (spawn point).

## Art credit

Cat sprites, room furniture and plants are from the free packs by
[toffeecraft](https://toffeecraft.itch.io/cat-pack), with the main cat
recoloured to match the real Larry's coat (and tuxedo/black variants for
the rival mousers). All other art is drawn in code.
