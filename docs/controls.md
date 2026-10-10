# Controls

Press **Y** to switch instantly between 2D Game and 3D exploration. The top-bar toggle and View selector use the same live switch. No reload or reconnect occurs: position, floor and running workers remain intact, and returning to 3D restores the previous camera view and facing. Typing, open dialogs and camera-controlled activities keep their own controls; finish the activity before switching. Lite continues to use page navigation.

Back to the [README](../README.md).

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk (hold Shift to run); on the ladder, W and S climb; in a car, W is the gas, S brakes and reverses, A and D steer |
| Space | Jump (you can land on desks, couches and the cars in the garage); in a car, brake |
| Mouse drag / wheel | Orbit / zoom the camera |
| E | Interact: hire a worker, open its terminal, read a board, take an issue's note off the board, prompt a board agent, call a meeting in the meeting room, open the screening room's window at the screen beside the meeting room's board, draw on the whiteboard, read the docs at the bookshelf, watch the TV, sit down (or get up), ride the elevator, climb the ladder (or get off it), slide down a fire pole, grab a coffee, take a smoke break, tee off at the golf tee, pet the dog, pick up the basketball (then hold E and let go to shoot), order a drink at the rooftop bar, blow the DJ's air horn, step up to the dart board or the axe lane on the roof (then hold Space and let go to throw), get into one of the cars in the garage (behind the wheel, or beside whoever's driving) or out of it, knock through the north wall past the gong for 2 more desks (at the **🚧 Room to grow** sign). In the [castle](maps.md#the-castle): sit on the throne, where E is for whoever's first in line (or the Hand of the King, with nobody waiting), and speak to the Hand to send out a new worker. On the [space station](maps.md#the-space-station) it's the captain's chair and the First Officer |
| K | On the castle's throne (or in the station's captain's chair): speak to the Hand of the King (the First Officer), to send out a new worker |

| E | Interact: hire a worker, open its terminal, read a board, take an issue's note off the board, prompt a board agent, call a meeting in the meeting room, open the screening room's window at the screen beside the meeting room's board, draw on the whiteboard, read the docs at the bookshelf, watch what's on the big TV or put a video on it, throw the theatre switch beside the TV (the office's lights go down, so the picture stands out in the dark), sit down (or get up), ride the elevator, climb the ladder (or get off it), slide down a fire pole, grab a coffee (it puts your energy back), open the kitchen fridge on the Diet Coke and ice creams inside (and press it again to shut it), take a smoke break, tee off at the golf tee, pet the dog, pick up the basketball (then hold E and let go to shoot), order a drink at the rooftop bar (it takes your stress off), blow the DJ's air horn, bang the office gong (every bot gathers to dance a 🪕 Fugdi), step up to the dart board or the axe lane on the roof (then hold Space and let go to throw), get into one of the cars in the garage (behind the wheel, or beside whoever's driving) or out of it, knock through the north wall past the gong for 2 more desks (at the **🚧 Room to grow** sign). In the [castle](maps.md#the-castle): sit on the throne, where E is for whoever's first in line (or the Hand of the King, with nobody waiting), and speak to the Hand to send out a new worker |
| K | On the castle's throne: speak to the Hand of the King, to send out a new worker |
| P | Prompt: give a task to a new worker, or to the one at this desk |
| C | At the open kitchen fridge: take and drink a can of Diet Coke to restore energy. At a desk, Changes: the files the worker at this desk changed and their diff; commit, discard or open a PR |
| B | Open a shared shell at an empty desk |
| R | Resume a sleeping worker (or restart a shell) |
| X | Send a worker home (frees the desk; a worker with its own worktree asks what to do with it). In the [castle](maps.md#the-castle), the Kingsguard takes it down to the dungeon; on the [space station](maps.md#the-space-station), Security puts it out of the airlock |
| Z | Send a finished regular agent on a break, or call it back |
| L | Hang a big sign over the desk you face (*Operations*, *Code cleanup*), in one of seven colors; again to change it or take it down |
| O | Open a pull request for a worker on its own branch, or see the one it has (a worker across several projects gets one in each) |
| J | Open the smartphone: worker/helper contacts, terminal calls, messages and helper report review |
| N | Go to the worker that has waited longest on someone; again for the next one |
| U | At an agent or shell worker’s desk: walk a helper over to it, which reads what it's doing, tells the worker what it found, and goes home (it cannot edit, commit or open a pull request) |
| F | Hang a picture from the web on a wall (scroll to size it, click to hang it); while moving the jukebox, **Esc** leaves it where it was |
| Q | Put back the issue card you're carrying, or drop the basketball |
| H | These controls; in a car, honk the horn |
| T / Enter | Chat |
| G / 1–6 | Emote: hold G for the wheel (point and let go) or press 1–6 to wave, give a thumbs up, clap, dance, point or facepalm; everyone on your floor sees it |
| ⚡😰 | The two meters under the project name: your energy and your stress. The energy runs out over fifty minutes and the stress winds right up over an hour and a quarter; low on energy your legs get heavy, and past half wound up your hands shake. Coffee in the kitchen puts the energy back, and so does a can of Diet Coke from the fridge (**C**), a drink at the rooftop bar takes the stress off. Run either right out and you keel over (nothing you press moves you) and come round outside the building, with both meters full again — as you do when you join |
| / | Search the chat and every terminal on your floor |
| Ctrl + K (⌘K on a Mac) | Command palette: find a worker, issue, PR, service, board, teammate or action; Enter opens it, Shift+Enter walks you there first |
| V | Join voice; in voice, hold to talk (you're muted when you let go) |
| M | Mute / unmute in voice |
| Ctrl + Space | Dictate, in a worker's terminal or a prompt box: hold it and talk, and what you said is typed in when you let go. A quick tap leaves it listening until the next tap. The **🎤** does the same |
| Tab | The ☰ menu: every window, and what shows on screen |
| Esc | Close any window (a terminal too) and get back to looking around |
| Ctrl + [ | Send Esc to a terminal instead, to close a menu like Claude's `/skills` or interrupt Claude. **⎋ Esc** in the terminal's header does the same |

You can also click a nearby desk to interact with it, or click a worker in the Workers panel (**🤖 Workers**, top right) to open its terminal.

On a phone, use the Lite dashboard at `/lite` instead: a terminal there has a row of keys under it (**1** **2** **3**, the arrows, Enter, Tab, Esc, Ctrl+C) and a box to send a prompt. See [Features](features.md).

## In a terminal

The prompt edits the way it does in your own terminal (iTerm2's *Natural Text Editing*, or VS Code's), in Claude Code, Codex, OpenCode and a shell alike:

| Key | Action |
| --- | --- |
| Shift + Enter | A new line in an agent's prompt, without sending it (in a shell it runs the line, like Enter) |
| Ctrl + Space | Dictate: hold it and talk, and what you said is typed in at the cursor when you let go (see [Features](features.md)). **🎤 Dictate** in the terminal's header does the same |
| Ctrl + ⌫ / ⌥ + ⌫ | Delete the word before the cursor |
| ⌘ + ⌫ | Delete to the start of the line (Mac) |
| ⌘ + ⌦ | Delete to the end of the line (Mac) |
| ⌘ + ← / → | Jump to the start / end of the line (Mac) |

Helpers can assist agent and shell workers, in their own worktree or the shared project checkout. Shell workers receive the findings in office chat; reports are never typed into bash as commands.

At a regular worker’s desk, press U or click **U — Bring a helper** to open the helper dialog. This works for shell and agent workers with or without a separate worktree.

Helpers carry a laptop showing their own terminal. Aim at the helper or its laptop and press **E**, or click **Open helper terminal** in the hint. You can also open the helper by name in the Workers list. **Needs you** means its agent is waiting: answer the question or approve/reject the permission request inside that helper’s terminal. Close it with Esc or ✕ to return to the office.

At the boss chair, sit down and press **E** to open **Boss Control Center**. Choose **Play Minesweeper** to use the existing game. The center is also available from the menu or the Workers panel’s **Boss** button.

## 2D Game (desktop)

Open `/2d`, or select **2D Game** from **View**. The office has the same fixtures, maps, elevator, dialogs and activities as 3D; the exploration camera has a flat, top-down projection.

| Control | Action |
| --- | --- |
| WASD / arrows | Walk with the shared collision physics; forward is toward the top of the map |
| Click ground | Walk there using the existing navigation and collision rules |
| Click worker | Open the existing terminal |
| Click fixture | Approach and use its existing action |
| E / P / U / R / X / O / C / L | The same nearby interaction and worker actions as 3D |
| Scroll | Zoom the map in/out |
| Tab | Complete office menu, including Elevator, Settings and 2D view controls |
| Elevator / project name | Floors, add/remove projects, rooftop and garage |
| ✕ / Esc | Close the top dialog and immediately restore game controls |

Keyboard movement cancels click-to-walk. Activities that take over the camera (including golf, driving, telescope and arcade screens) retain their original camera and controls; finishing returns to the top-down projection. The elevator and floor list retain running worker sessions. Dialogs use the shared modal stack and suspend movement, including nested dialogs. Lite remains available for mobile or a browser without WebGL.

The top bar has a direct **2D / 3D** toggle, available in both views. Switching preserves the selected floor and running workers. In 2D, jumping moves your character while the camera and cutaway stay anchored to the supporting floor.

In **2D Game**, open **Tab → 2D graphics settings** to choose **Reduced (current)** or **Enhanced**. Reduced is the default and preserves the existing quality. Enhanced increases rendering resolution (2–3× pixel ratio) and enables real-time shadows. Changes apply immediately, persist in this browser, and affect only 2D exploration; activities retain their original rendering. Choose Reduced on slower hardware.
