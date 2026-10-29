"""Actual Chrome integration tests, standard-library Python only.
Run: python3 skyshot/tests/browser_test.py [--browser /path/to/chrome]
Uses file://, a private temporary profile, real mouse/key/emulated-touch events,
and explicitly identified deterministic fixtures for hard-to-reach states.
Speaker output is muted: audio tests inspect playback state and PCM, not listening.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
from devtools import DevTools

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'tests' / 'artifacts'
G = 'SkyshotApp.game'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser')
    args = parser.parse_args()
    browser = next((p for p in [args.browser, shutil.which('chromium'), shutil.which('google-chrome'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] if p and Path(p).is_file()), None)
    if not browser:
        raise SystemExit('Supply --browser /path/to/chrome')
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    results = []
    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        results.append({'name': name, 'passed': True})
        print('PASS', name, flush=True)

    with tempfile.TemporaryDirectory(prefix='skyshot-browser-test-') as profile:
        log = open(ARTIFACTS / 'chrome.log', 'w')
        process = subprocess.Popen([browser, '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-features=MediaRouter', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'], stdout=log, stderr=log)
        c = None
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            deadline = time.monotonic() + 25
            while not port_file.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Chrome startup failed; inspect chrome.log')
                time.sleep(.1)
            port = int(port_file.read_text().splitlines()[0])
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=5) as response:
                pages = json.load(response)
            c = DevTools(next(p['webSocketDebuggerUrl'] for p in pages if p['type'] == 'page'))
            for domain in ['Page', 'Runtime', 'Log', 'Network']:
                c.call(domain + '.enable')
            c.call('Emulation.setDeviceMetricsOverride', width=1360, height=1050, deviceScaleFactor=1, mobile=False)
            # Instrument the browser scheduler before app boot, without replacing its behavior.
            c.call('Page.addScriptToEvaluateOnNewDocument', source="""
                window.rafAudit={pending:new Set(),max:0,calls:0};
                const nativeRAF=window.requestAnimationFrame.bind(window), nativeCancel=window.cancelAnimationFrame.bind(window);
                window.requestAnimationFrame=fn=>{let id=nativeRAF(t=>{rafAudit.pending.delete(id);rafAudit.calls++;fn(t)});rafAudit.pending.add(id);rafAudit.max=Math.max(rafAudit.max,rafAudit.pending.size);return id};
                window.cancelAnimationFrame=id=>{rafAudit.pending.delete(id);nativeCancel(id)};
            """)
            c.navigate(ROOT / 'tests/index.html')
            engine = c.js('SkyshotTestResults')
            check(f'All {len(engine)} engine tests pass in Chromium', all(r['passed'] for r in engine))
            c.navigate(ROOT / 'index.html')
            check('Offline file loads ready screen and all six ammo pips', c.js(f"{G}.state==='ready' && !document.getElementById('start-screen').hidden && document.querySelectorAll('.ammo-pip').length===6"))
            check('No AudioContext is created before a user gesture', c.js('SkyshotApp.sound.context===null && !SkyshotApp.sound.enabled'))
            c.screenshot(ARTIFACTS / 'desktop-ready.png')
            c.click('#sound-button')
            c.wait("SkyshotApp.sound.context && SkyshotApp.sound.context.state==='running'")
            check('Sound toggle unlocks Web Audio and persists preference', c.js("SkyshotApp.sound.enabled && localStorage.getItem('skyshot.sound.v1')==='on'"))
            c.click('#start-button')
            check('Start enters play, hides overlay and focuses canvas', c.js(f"{G}.state==='running' && document.getElementById('overlay').hidden && document.activeElement.id==='game'"))
            check('Start cue is played through the real audio path', c.js('SkyshotApp.sound.played.start===1'))
            c.js('window.audioContext=SkyshotApp.sound.context')
            c.wait(f'{G}.birds.length>=2', timeout=6)
            check('Real RAF spawns flying birds with varying parameters', c.js(f"{G}.birds.every(b=>b.state==='flying' && b.vx!==0) && {G}.birds[0].baseY!=={G}.birds[1].baseY"))
            phase = c.js(f'{G}.birds[0].phase')
            time.sleep(.16)
            check('Live birds move and flap as time advances', c.js(f'{G}.birds[0].phase') != phase)
            timing = c.js(f'({{clock:{G}.remaining,wall:performance.now()}})')
            time.sleep(1)
            timing2 = c.js(f'({{clock:{G}.remaining,wall:performance.now(),state:{G}.state}})')
            check('Active timer tracks wall time rather than frame count', timing2['state']=='running' and abs((timing['clock']-timing2['clock'])-(timing2['wall']-timing['wall'])/1000)<.25)

            # Stable bird fixture, then actual mouse events on the live canvas.
            c.js("""window.fixture=(x=.4,y=.38,species=0)=>{const g=SkyshotApp.game;g.birds=[];g.spawnClock=999;g.cooldown=0;g.reloading=false;g.reloadLeft=0;g.ammo=6;const b=g.spawnBird();Object.assign(b,{x:g.width*x,y:g.height*y,baseY:g.height*y,vx:0,amplitude:0,phase:1,direction:1,species:SkyshotEngine.SPECIES[species],size:SkyshotEngine.SPECIES[species].size});return b.id};
                window.canvasPoint=(x,y)=>{const r=document.getElementById('game').getBoundingClientRect();return {x:r.x+x*r.width,y:r.y+y*r.height}};
                window.shotSnapshots=[];document.getElementById('game').addEventListener('pointerdown',()=>{const g=SkyshotApp.game;shotSnapshots.push({ammo:g.ammo,shots:g.shots,recoil:g.recoil,flash:g.flash,bullets:g.bullets.length,hitMarker:g.hitMarker,aim:{...g.aim}})});
            """)
            c.js('fixture()')
            point = c.js('canvasPoint(.4,.38)')
            c.call('Input.dispatchMouseEvent', type='mouseMoved', **point)
            check('Mouse aim maps CSS coordinates into logical canvas coordinates', c.js(f'Math.abs({G}.aim.x-{G}.width*.4)<.01 && Math.abs({G}.aim.y-{G}.height*.38)<.01'))
            left_angle = c.js(f'{G}.gunPose().angle')
            c.call('Input.dispatchMouseEvent', type='mouseMoved', **c.js('canvasPoint(.85,.38)'))
            check('Visible rifle rotates toward the aiming direction', c.js(f'{G}.gunPose().angle') > left_angle)
            c.click_at(**point)
            check('Actual mouse shot hits bird, scores 100 and consumes one round', c.js(f"{G}.hits===1 && {G}.score===100 && {G}.ammo===5 && document.getElementById('score').textContent==='0100'"))
            check('Shot has recoil, flash, tracer and a hit marker at input time', c.js('shotSnapshots.at(-1).recoil===1 && shotSnapshots.at(-1).flash>0 && shotSnapshots.at(-1).bullets===1 && shotSnapshots.at(-1).hitMarker>0'))
            check('Shot and hit cues both played once', c.js('SkyshotApp.sound.played.shot===1 && SkyshotApp.sound.played.hit===1'))
            check('High score persists and ammo HUD removes one pip', c.js("localStorage.getItem('skyshot.best.v1')==='100' && document.querySelectorAll('.ammo-pip.empty').length===1"))
            c.wait(f'{G}.birds.length===0 && {G}.particles.length===0 && {G}.bullets.length===0 && {G}.popups.length===0')
            check('Hit animation, particles and bullets are cleaned up', c.js(f'{G}.recoil<.001'))
            c.click_at(**c.js('canvasPoint(.1,.3)'))
            check('A miss consumes ammo but never adds score', c.js(f'{G}.score===100 && {G}.shots===2 && {G}.streak===0 && {G}.ammo===4'))
            c.key('KeyR')
            check('R starts timed reload and changes the UI', c.js(f"{G}.reloading && document.getElementById('reload-label').textContent==='RELOADING'"))
            before = c.js(f'{G}.shots')
            c.key('Space')
            check('Cannot shoot during reload', c.js(f'{G}.shots') == before)
            c.wait(f'!{G}.reloading')
            check('Reload refills six rounds and plays completion cue', c.js(f'{G}.ammo===6 && SkyshotApp.sound.played.reload>=1 && SkyshotApp.sound.played.loaded>=1'))
            c.js(f'{G}.birds=[];{G}.spawnClock=999')
            for _ in range(6):
                c.key('Space'); time.sleep(.17)
            check('Empty magazine automatically starts a reload', c.js(f'{G}.ammo===0 && {G}.reloading'))
            check('Empty/reloading input never makes negative ammunition', c.js(f'{G}.shoot()===null && {G}.ammo===0'))
            c.key('KeyP')
            snapshot = c.js(f'JSON.stringify({{time:{G}.remaining,reload:{G}.reloadLeft,birds:{G}.birds,bullets:{G}.bullets}})')
            c.key('Space'); c.key('KeyR'); time.sleep(.4)
            check('P pauses simulation, reload and shooting', c.js(f"{G}.state==='paused' && !document.getElementById('pause-screen').hidden") and snapshot == c.js(f'JSON.stringify({{time:{G}.remaining,reload:{G}.reloadLeft,birds:{G}.birds,bullets:{G}.bullets}})'))
            check('Pause silences outstanding sounds', c.js('SkyshotApp.sound.voices.size===0'))
            c.key('KeyP', repeat=True)
            check('Key autorepeat cannot toggle pause', c.js(f"{G}.state==='paused'"))
            c.key('Escape')
            check('Escape resumes with no paused-time catchup', c.js(f"{G}.state==='running' && {G}.reloadLeft>0"))
            c.wait(f'!{G}.reloading')
            c.click('#pause-button'); c.click('#resume-button')
            check('Pause and resume buttons restore canvas focus', c.js(f"{G}.state==='running' && document.activeElement.id==='game'"))
            c.js("document.getElementById('pause-button').focus()")
            c.key('Space')
            check('Keyboard-focused pause button activates natively, not as a shot', c.js(f"{G}.state==='paused'"))
            c.key('Space')
            check('Focused pause button can also resume with Space', c.js(f"{G}.state==='running'"))
            c.js("window.dispatchEvent(new Event('blur'))")
            check('Window focus loss auto-pauses and silences audio', c.js(f"{G}.state==='paused' && SkyshotApp.sound.voices.size===0"))
            c.click('#resume-button')
            c.js("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden")
            check('Hidden-tab lifecycle event automatically pauses', c.js(f"{G}.state==='paused'"))
            c.click('#resume-button')
            c.js(f'{G}.setAim({G}.width*.5,250)')
            x = c.js(f'{G}.aim.x')
            c.key('ArrowLeft', hold=.25)
            check('Held keyboard aim moves left', c.js(f'{G}.aim.x') < x - 30)
            x = c.js(f'{G}.aim.x'); time.sleep(.15)
            check('Key release stops aiming', abs(c.js(f'{G}.aim.x')-x)<.01)
            c.js('fixture(.45,.35,2)')
            c.click_at(**c.js('canvasPoint(.45,.35)'))
            check('Small golden bird awards its 250-point value', c.js(f'{G}.score===350'))
            c.js(f'window.previousLevelCues=SkyshotApp.sound.played.level||0;{G}.level=1;{G}.elapsed=14.95;{G}.remaining=75.05')
            c.wait(f'{G}.level===2')
            check('Live difficulty transition updates label and plays cue', c.js("document.getElementById('level-label').textContent.includes('ROUND 02') && SkyshotApp.sound.played.level===previousLevelCues+1"))
            c.js(f'{G}.elapsed=79.95;{G}.remaining=10.05')
            c.wait(f'{G}.remaining<10')
            check('Final countdown shows urgent timer and warning cue', c.js("document.getElementById('timer').parentElement.classList.contains('urgent') && SkyshotApp.sound.played.tick>=1"))
            c.js(f'{G}.elapsed=89.95;{G}.remaining=.05')
            c.wait(f"{G}.state==='over'")
            check('Timer ends round and displays score, hits and accuracy', c.js("document.getElementById('timer').textContent==='0:00' && !document.getElementById('end-screen').hidden && document.getElementById('final-score').textContent==='350' && document.getElementById('final-hits').textContent==='2'"))
            check('Game over sound is played once', c.js('SkyshotApp.sound.played.over===1'))
            time.sleep(.2)
            check('Game over cannot re-trigger on subsequent frames', c.js('SkyshotApp.sound.played.over===1'))
            c.screenshot(ARTIFACTS / 'desktop-game-over.png')
            c.click('#restart-button')
            check('Restart clears round state and retains personal best', c.js(f"{G}.state==='running' && {G}.score===0 && {G}.shots===0 && {G}.ammo===6 && document.getElementById('best').textContent==='0350'"))
            check('Restart reuses one audio context and cancels finale', c.js('SkyshotApp.sound.context===audioContext && SkyshotApp.sound.played.over===1'))
            c.js('for(let i=0;i<25;i++)SkyshotApp.start()')
            check('25 restarts never create another animation chain', c.js('rafAudit.pending.size===1 && rafAudit.max===1'))
            c.key('Space')
            check('Repeated restarts do not duplicate input handlers', c.js(f'{G}.shots===1 && {G}.ammo===5'))
            c.key('Space', repeat=True)
            check('OS key repeat cannot trigger duplicate shots', c.js(f'{G}.shots===1'))
            c.key('KeyM')
            check('Mute immediately cancels every voice', c.js("!SkyshotApp.sound.enabled && SkyshotApp.sound.voices.size===0 && localStorage.getItem('skyshot.sound.v1')==='off'"))
            c.wait(f'{G}.cooldown===0'); c.key('Space')
            check('Shooting remains functional when audio is muted', c.js(f'{G}.shots===2 && SkyshotApp.sound.voices.size===0'))
            c.key('KeyM')
            check('Unmute reuses the original audio context', c.js('SkyshotApp.sound.enabled && SkyshotApp.sound.context===audioContext'))
            c.wait('SkyshotApp.sound.voices.size===0')
            audio = c.js("Array.from(SkyshotApp.sound.buffers,([name,b])=>{const s=b.getChannelData(0);let peak=0,sum=0,finite=true;for(const x of s){finite=finite&&Number.isFinite(x);peak=Math.max(peak,Math.abs(x));sum+=x*x}return {name,duration:b.duration,finite,peak,rms:Math.sqrt(sum/s.length),start:s[0],end:s[s.length-1]}})")
            check('All exercised sound buffers contain finite nonzero PCM and headroom', len(audio)>=8 and all(a['finite'] and .01<a['peak']<.65 and a['rms']>.001 and abs(a['start'])<.001 and abs(a['end'])<.001 for a in audio))
            check('Finished audio voices disconnect and are removed', c.js('SkyshotApp.sound.voices.size===0'))

            # A/D uses actual held key events and the existing live RAF chain.
            c.js('SkyshotApp.start();fixture(.5,.38)')
            c.call('Input.dispatchMouseEvent', type='mouseMoved', **c.js('canvasPoint(.5,.38)'))
            c.js('window.fixedAim=JSON.stringify(SkyshotApp.game.aim)')
            start_x = c.js(f'{G}.gunPose().x')
            c.key('KeyA', hold=.35)
            left_x = c.js(f'{G}.gunPose().x')
            check('Holding A slides the rifle left while crosshair stays fixed', left_x < start_x - 50 and c.js(f'JSON.stringify({G}.aim)===fixedAim'))
            time.sleep(.15)
            check('Releasing A immediately stops horizontal movement', abs(c.js(f'{G}.gunPose().x') - left_x) < .001)
            c.screenshot(ARTIFACTS / 'gun-movement-left.png')
            c.key('KeyD', hold=.25)
            check('Holding D slides the rifle right without changing height or aim', c.js(f'{G}.gunPose().x') > left_x + 40 and c.js(f'{G}.gunPose().y==={G}.height+6 && JSON.stringify({G}.aim)===fixedAim'))
            c.screenshot(ARTIFACTS / 'gun-movement-right.png')
            def move_key(code, down=True, **extra):
                c.call('Input.dispatchKeyEvent', type='keyDown' if down else 'keyUp', code=code, key=code[-1].lower(), windowsVirtualKeyCode=ord(code[-1]), **extra)
            move_key('KeyA'); move_key('KeyD')
            both_x = c.js(f'{G}.gunPosition'); time.sleep(.18)
            check('Holding A and D together cancels movement', abs(c.js(f'{G}.gunPosition') - both_x) < .001)
            move_key('KeyA', False); time.sleep(.18)
            check('Releasing one opposing key continues the other direction', c.js(f'{G}.gunPosition') > both_x)
            move_key('KeyD', False)
            c.key('KeyA', hold=2)
            check('Held A stops at the left screen inset', c.js(f'Math.abs({G}.gunPosition-.1)<.00001'))
            c.key('KeyD', hold=2)
            check('Held D stops at the right screen inset', c.js(f'Math.abs({G}.gunPosition-.9)<.00001'))
            c.key('KeyA', hold=.3)
            move_key('KeyD'); c.key('KeyP')
            paused_x = c.js(f'{G}.gunPosition'); c.key('KeyA', hold=.15)
            check('Pause freezes rifle position and clears held movement', c.js(f"{G}.state==='paused' && SkyshotApp.debug.heldKeys===0") and abs(c.js(f'{G}.gunPosition') - paused_x)<.001)
            c.click('#resume-button'); time.sleep(.15)
            check('Resume does not resurrect a previously held movement key', abs(c.js(f'{G}.gunPosition') - paused_x)<.001)
            move_key('KeyD', False)
            move_key('KeyA'); c.js("window.dispatchEvent(new Event('blur'))")
            blur_x = c.js(f'{G}.gunPosition'); c.click('#resume-button'); time.sleep(.15)
            check('Focus loss also clears held A/D input', c.js('SkyshotApp.debug.heldKeys===0') and abs(c.js(f'{G}.gunPosition')-blur_x)<.001)
            move_key('KeyA', False)
            # Confirm simultaneous movement/fire uses the same muzzle as rendering.
            c.js("fixture(.5,.38);window.movingShot=null;document.getElementById('game').addEventListener('pointerdown',()=>{const g=SkyshotApp.game,p=g.gunPose(),b=g.bullets.at(-1);movingShot={hit:g.hits,recoil:g.recoil,aligned:Math.abs(b.x1-p.muzzleX)<.001&&Math.abs(b.y1-p.muzzleY)<.001}},{once:true})")
            move_key('KeyA'); time.sleep(.12); c.click_at(**c.js('canvasPoint(.5,.38)')); move_key('KeyA', False)
            check('Can hit a target while moving, with recoil and relocated muzzle tracer', c.js('movingShot.hit===1 && movingShot.recoil===1 && movingShot.aligned'))
            c.key('KeyR'); reload_x=c.js(f'{G}.gunPosition'); c.key('KeyA', hold=.2)
            check('Rifle can move during reload without canceling the reload', c.js(f'{G}.reloading && {G}.gunPosition < {reload_x}'))
            move_key('KeyD'); c.js('SkyshotApp.start()'); time.sleep(.15)
            check('Restart resets rifle stance and clears held movement keys', c.js(f'Math.abs({G}.gunPosition-.76)<.001 && SkyshotApp.debug.heldKeys===0'))
            move_key('KeyD', False)
            modifier_x=c.js(f'{G}.gunPosition')
            move_key('KeyA', modifiers=2); time.sleep(.12); move_key('KeyA', False)
            check('Ctrl+A browser shortcut does not move the rifle', abs(c.js(f'{G}.gunPosition')-modifier_x)<.001)
            check('A/D uses the existing single RAF chain', c.js('rafAudit.pending.size===1 && rafAudit.max===1'))

            # Compose a stable gameplay frame using actual renderer, without changing production art.
            c.js("SkyshotApp.start();fixture(.25,.31);for(const [x,y,s] of [[.51,.39,1],[.73,.26,2],[.87,.47,0]]){const g=SkyshotApp.game,b=g.spawnBird();Object.assign(b,{x:g.width*x,y:g.height*y,baseY:g.height*y,vx:0,amplitude:0,species:SkyshotEngine.SPECIES[s],size:SkyshotEngine.SPECIES[s].size})}SkyshotApp.game.setAim(SkyshotApp.game.width*.73,SkyshotApp.game.height*.26);SkyshotApp.renderer.draw()")
            c.screenshot(ARTIFACTS / 'desktop-playing.png')
            # Snapshot recoil in the same event dispatch, avoiding screenshot latency.
            c.js("window.renderSnapshots=[];document.getElementById('game').addEventListener('pointerdown',()=>{SkyshotApp.renderer.draw();renderSnapshots.push(document.getElementById('game').toDataURL())})")
            c.click_at(**c.js('canvasPoint(.73,.26)'))
            import base64
            (ARTIFACTS/'rifle-firing.png').write_bytes(base64.b64decode(c.js('renderSnapshots.at(-1)').split(',')[1]))
            check('Firing frame contains opaque rendered scene and visible recoil', c.js("SkyshotApp.renderer.context.getImageData(10,10,1,1).data[3]===255 && shotSnapshots.at(-1).recoil===1"))

            c.call('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=2, mobile=True)
            c.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            time.sleep(.2)
            c.js('SkyshotApp.start();fixture(.42,.37)')
            point = c.js('canvasPoint(.42,.37)')
            c.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{**point, 'id':1}])
            c.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
            time.sleep(.1)
            check('Real emulated touch aims and shoots exactly once at 2x DPR', c.js(f'{G}.hits===1 && {G}.shots===1 && {G}.score===100 && {G}.ammo===5'))
            check('Touch position correctly maps into the reticle', c.js(f'Math.abs({G}.aim.x-{G}.width*.42)<.01 && Math.abs({G}.aim.y-{G}.height*.37)<.01'))
            check('Touch recoil and firing effects use the same input path', c.js('shotSnapshots.at(-1).recoil===1 && shotSnapshots.at(-1).bullets===1'))
            point = c.point('#reload-button')
            c.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{**point, 'id':2}])
            c.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
            c.wait(f'{G}.reloading')
            check('Touch reload button works without firing another shot', c.js(f'{G}.shots===1'))
            c.wait(f'!{G}.reloading')
            c.js('fixture(.39,.36)')
            c.screenshot(ARTIFACTS / 'mobile-playing.png')
            check('Mobile layout has no horizontal overflow and reload stays in viewport', c.js("document.documentElement.scrollWidth<=innerWidth && document.getElementById('reload-button').getBoundingClientRect().bottom<innerHeight"))
            c.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{**c.js('canvasPoint(.39,.36)'), 'id':3}])
            c.call('Input.dispatchTouchEvent', type='touchCancel', touchPoints=[])
            shots = c.js(f'{G}.shots'); time.sleep(.3)
            check('Touch cancellation does not leave automatic firing or scrolling', c.js(f'{G}.shots')==shots and c.js('scrollX===0'))
            for width, height in [(320,568),(375,667),(844,390)]:
                c.call('Emulation.setDeviceMetricsOverride', width=width, height=height, deviceScaleFactor=1, mobile=width<600)
                time.sleep(.12)
                c.js('SkyshotApp.pause()')
                check(f'Layout and pause card fit at {width}x{height}', c.js("(()=>{const a=document.getElementById('arena').getBoundingClientRect(),p=document.getElementById('pause-screen').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&p.left>=a.left&&p.right<=a.right&&p.top>=a.top&&p.bottom<=a.bottom})()"))
                if width==320:
                    c.screenshot(ARTIFACTS / 'small-phone-paused.png')
            c.call('Emulation.setDeviceMetricsOverride', width=1100, height=900, deviceScaleFactor=1, mobile=False)
            c.call('Emulation.setTouchEmulationEnabled', enabled=False)
            c.call('Emulation.setEmulatedMedia', features=[{'name':'prefers-reduced-motion','value':'reduce'}])
            c.wait('SkyshotApp.renderer.reducedMotion')
            check('Reduced motion disables CSS transitions and extra visual shake', c.js("getComputedStyle(document.querySelector('.primary-button')).transitionDuration==='0s'"))
            c.js('SkyshotApp.resume()'); time.sleep(.2)
            c.js('const end=performance.now()+2150;while(performance.now()<end){}')
            c.wait(f"{G}.state==='paused'")
            check('Multi-second event-loop stall pauses safely rather than skipping gameplay', c.js("document.getElementById('toast').textContent.includes('PAUSED')"))
            c.click('#pause-restart-button')
            check('Pause-screen restart starts a fresh round', c.js(f"{G}.state==='running' && {G}.score===0 && {G}.ammo===6"))
            c.click('#sound-button')
            c.navigate(ROOT / 'index.html')
            check('Personal best and mute setting persist on reload', c.js("document.getElementById('best').textContent==='0350' && !SkyshotApp.sound.enabled && SkyshotApp.sound.context===null"))
            c.js("localStorage.setItem('skyshot.best.v1','bad-value')")
            c.navigate(ROOT / 'index.html')
            check('Corrupt stored score safely falls back to zero', c.js("document.getElementById('best').textContent==='0000'"))
            c.call('Page.addScriptToEvaluateOnNewDocument', source="Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError')}})")
            c.navigate(ROOT / 'index.html')
            c.js("document.getElementById('start-button').focus()")
            c.key('Space')
            check('Native keyboard activation starts game even when storage is blocked', c.js(f"{G}.state==='running' && document.activeElement.id==='game'"))
            c.js(f"const b={G}.spawnBird();Object.assign(b,{{x:{G}.width*.4,y:260,baseY:260,vx:0,amplitude:0}});{G}.setAim(b.x,b.y)")
            c.key('Space')
            check('Denied storage never prevents scoring', c.js(f'{G}.score>0'))
            c.js('SkyshotApp.dispose();SkyshotApp.dispose()')
            frames = c.js('SkyshotApp.debug.frameCount'); time.sleep(.15)
            check('Dispose cancels RAF and is safely repeatable', c.js('SkyshotApp.debug.disposed && rafAudit.pending.size===0') and c.js('SkyshotApp.debug.frameCount')==frames)
            c.js('1')
            errors = [e for e in c.events if e.get('method')=='Runtime.exceptionThrown' or (e.get('method')=='Log.entryAdded' and e.get('params',{}).get('entry',{}).get('level')=='error') or (e.get('method')=='Runtime.consoleAPICalled' and e.get('params',{}).get('type')=='error')]
            requests = [e for e in c.events if e.get('method')=='Network.requestWillBeSent' and e.get('params',{}).get('request',{}).get('url','').startswith(('http://','https://'))]
            check('No browser JavaScript exceptions or console errors', not errors)
            check('Game and engine tests make zero HTTP/HTTPS requests', not requests)
            report = {'browser':c.call('Browser.getVersion'),'engine':engine,'integration':results,'audio':audio,'errors':errors,'networkRequests':len(requests),'audioListeningTest':False}
            (ARTIFACTS/'results.json').write_text(json.dumps(report,indent=2)+'\n')
            for name in ['failure.json','failure.png']:
                (ARTIFACTS/name).unlink(missing_ok=True)
            print(f'\n{len(results)}/{len(results)} browser checks passed. {len(engine)}/{len(engine)} engine tests passed.', flush=True)
        except Exception as error:
            if c:
                try:
                    print('DIAGNOSTICS', c.js(f"window.SkyshotApp?({{state:{G}.state,time:{G}.remaining,ammo:{G}.ammo,score:{G}.score,reload:{G}.reloadLeft,raf:SkyshotApp.debug,voices:SkyshotApp.sound.voices.size,sounds:SkyshotApp.sound.played}}):null"),flush=True)
                    c.screenshot(ARTIFACTS/'failure.png')
                except Exception:
                    pass
            (ARTIFACTS/'failure.json').write_text(json.dumps({'passed':results,'error':str(error)},indent=2)+'\n')
            raise
        finally:
            if c:
                c.socket.close()
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
            log.close()


if __name__ == '__main__':
    main()
