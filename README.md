# Skyshot — Bird Hit

A complete, lightweight bird-shooting arcade game made with HTML, CSS, vanilla JavaScript, Canvas 2D, and Web Audio. No build tools, dependencies, backend, external assets, or API keys are needed to play.

**[Play Skyshot on GitHub Pages](https://mohammadhamza-cpu.github.io/bird-hit/)**

## Play locally

Open `index.html` in a modern browser. Keep the six runtime files together. Or serve this repository with `python3 -m http.server 8000 --bind 127.0.0.1` and visit http://127.0.0.1:8000.

## Controls

- Mouse: aim and left-click to fire.
- Touch: tap a bird to aim/fire; tap Reload for a fresh magazine.
- Hold **A / D**: move the rifle left / right independently of your aim; release to stop.
- **R**: reload. Empty magazines reload automatically.
- **P / Escape**: pause or resume.
- **M**: toggle sound (off by default).
- Keyboard aiming: focus the game, hold arrow keys, and press Space to fire.

The rifle is hand-free, starts at the lower right, follows the black crosshair, and recoils along its barrel. Horizontal movement has screen-edge limits and stops on pause/focus loss. Start, pause, game-over, and restart screens are included.

## Gameplay

Play a 90-second round with six shots per magazine and unlimited reserve ammunition. Reloading takes 1.35 active seconds. Birds fly at different heights and speeds, with animated wings. Difficulty increases every 15 seconds.

Teal birds score 100 points, coral birds 150, and small golden birds 250. Consecutive hits build a multiplier up to 5x; missed shots and escaped birds reset it. Shots use precise silhouette-based hitscan detection, with visible tracer bullets, muzzle flashes, feathers, and floating scores. The timer pauses when you leave the page. High score and sound preference are stored locally when permitted.

## Source layout

- [index.html](index.html): page, HUD, overlays, controls.
- [styles.css](styles.css): responsive colorful interface.
- [engine.js](engine.js): state, movement, hit detection, scoring, reload, timer.
- [renderer.js](renderer.js): original landscape, birds, rifle, crosshair, effects.
- [audio.js](audio.js): locally synthesized effects with gesture-controlled playback.
- [app.js](app.js): input, lifecycle, local storage, and one animation loop.
- [tests/engine.test.js](tests/engine.test.js): deterministic engine tests.
- [tests/browser_test.py](tests/browser_test.py): real Chrome keyboard, mouse, and emulated-touch tests.
- [tests/live_round.py](tests/live_round.py): full-length real-time test.
- [tests/devtools.py](tests/devtools.py): Python-standard-library Chrome automation client.

## Local testing completed

After the A/D movement update, **45/45 engine tests** passed in JavaScriptCore and Chrome, and **84/84 Chrome browser checks** passed. The run covered aiming, horizontal movement, shooting while moving, recoil, hits, scoring, ammunition, reloads, timer, pause/resume, restart, touch controls, responsive layout, audio state, cleanup, and duplicate-loop prevention. No page JavaScript exceptions or console errors were observed; the local game/test pages made zero HTTP/HTTPS requests.

An earlier full 90-second live round completed with 97 moving-bird hits from 114 actual mouse shots. Audio was verified programmatically, not by listening. Safari/Firefox UI and physical mobile devices were not tested. The counts above describe local regression testing.

To rerun, open [tests/index.html](tests/index.html), or run:

```sh
python3 tests/browser_test.py
python3 tests/live_round.py
```

The Python harnesses require installed Chrome/Chromium, but no Python packages. They accept `--browser /path/to/chrome`, use a private temporary profile, and write ignored local artifacts under `tests/artifacts/`.

## GitHub Pages

GitHub Pages publishes the default `main` branch from the repository root (`/`). The empty `.nojekyll` file disables Jekyll processing. All game asset URLs are relative, so the repository subpath works without modification. Future commits to `main` automatically update the site.

No credentials are needed by the deployed game. Keep personal tokens and local environment files out of this repository.
