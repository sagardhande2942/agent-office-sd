# Worker appearances

Open **Settings → Workers → Worker appearances**. Admins can enable Original, Fictional, or both, choose any subset of the 20 fictional characters, then **Apply appearances**. Everyone in the building sees the same choices and assignments immediately; running agent processes, terminals and sessions keep working.

The fictional roster is Naruto, Pikachu, Goku, Mario, Luigi, Sonic, Totoro, SpongeBob, Luffy, Doraemon, Kirby, Link, Yoshi, Stitch, Baymax, Shrek, Batman, Spider-Man, Deadpool and Darth Vader. Each has a distinct procedural cartoon body and signature outfit. These are built entirely in Three.js code, with no imported models or downloaded textures.

Fictional identities are unique across active workers on all floors, including shells, helpers and board agents. Fictional-only mode assigns unused characters in selected roster order. Mixed mode alternates new slots, beginning with Original. When the pool is full, additional workers use Original; hiring is never blocked by appearance settings. When a fictional worker leaves, the oldest waiting fictional slot can take its freed character. Eligible existing assignments remain stable when the pool changes.

Choices, assignments and alternating slot preferences are stored in the office's `.agent-office/worker-appearances.json` and restored after restart. Offline remote floors reserve their assigned identities until their host reports the roster, preventing duplicate characters during reconnect. Removing a floor releases its assignments. Decorative idle NPCs remain Original.

Original workers retain map outfits and holiday costumes. Fictional workers keep their signature clothes. Switching back restores the current Original outfit. Names, status lights, work props, walking, typing, waiting and celebrations use the existing worker animation system.

The visual factory registry and Settings extension registry allow future appearance categories to live in their own modules. Human and Alien categories are not included in this release.

## Verification

Run `npm run typecheck`, `npm test`, `npm run build`, and `node --import tsx scripts/e2e-appearances.mjs`. The browser check uses an isolated two-floor office and real shell workers, verifies synchronized allocation and live changes, and records screenshots under `docs/appearance-evidence` (or `APPEARANCE_ARTIFACTS`).
