"""90-second live RAF soak: normal randomized birds and actual mouse clicks.
No time jumps, stationary target fixtures, gameplay mutations, or external packages.
Run: python3 skyshot/tests/live_round.py [--browser /path/to/chrome]
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
ARTIFACTS = ROOT/'tests/artifacts'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--browser');args=parser.parse_args()
    browser=next((p for p in [args.browser,shutil.which('chromium'),shutil.which('google-chrome'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] if p and Path(p).is_file()),None)
    if not browser:
        raise SystemExit('Supply --browser /path/to/chrome')
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='skyshot-live-round-') as profile:
        p=subprocess.Popen([browser,'--headless=new','--no-first-run','--no-default-browser-check','--mute-audio','--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        c=None
        try:
            portfile=Path(profile)/'DevToolsActivePort'
            deadline=time.monotonic()+25
            while not portfile.exists():
                if time.monotonic()>deadline:raise RuntimeError('Chrome startup timeout')
                time.sleep(.1)
            port=portfile.read_text().splitlines()[0]
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list') as f:pages=json.load(f)
            c=DevTools(next(x['webSocketDebuggerUrl'] for x in pages if x['type']=='page'))
            for domain in ['Page','Runtime','Log']:c.call(domain+'.enable')
            c.call('Emulation.setDeviceMetricsOverride',width=1200,height=960,deviceScaleFactor=1,mobile=False)
            c.navigate(ROOT/'index.html')
            # Observe performance without changing gameplay or adding another RAF chain.
            c.js("window.renderTimings=[];const draw=SkyshotApp.renderer.draw.bind(SkyshotApp.renderer);SkyshotApp.renderer.draw=function(dt){const t=performance.now();draw(dt);renderTimings.push(performance.now()-t)}")
            c.click('#start-button'); start=time.monotonic();last_report=-1;max_birds=0;max_particles=0;clicks=0
            while time.monotonic()-start<110:
                state=c.js("(()=>{const g=SkyshotApp.game,r=document.getElementById('game').getBoundingClientRect();const b=g.birds.slice().reverse().find(b=>b.state==='flying'&&b.x>35&&b.x<g.width-35);return {state:g.state,remaining:g.remaining,score:g.score,hits:g.hits,shots:g.shots,ammo:g.ammo,reloading:g.reloading,cooldown:g.cooldown,birds:g.birds.length,particles:g.particles.length,point:b?{x:r.x+b.x/g.width*r.width,y:r.y+b.y/g.height*r.height}:null}})()")
                max_birds=max(max_birds,state['birds']);max_particles=max(max_particles,state['particles'])
                if state['state']=='over':break
                if state['state']!='running':raise AssertionError(f'Unexpected state: {state}')
                section=int((90-state['remaining'])//15)
                if section!=last_report:
                    print(f"ROUND {section+1}: {state['remaining']:.1f}s left, {state['score']} points, {state['hits']}/{state['shots']} hits",flush=True);last_report=section
                if state['point'] and not state['reloading'] and state['cooldown']==0:
                    c.click_at(**state['point']);clicks+=1
                else:time.sleep(.04)
            wall=time.monotonic()-start
            final=c.js("({state:SkyshotApp.game.state,remaining:SkyshotApp.game.remaining,score:SkyshotApp.game.score,hits:SkyshotApp.game.hits,shots:SkyshotApp.game.shots,escaped:SkyshotApp.game.escaped,accuracy:SkyshotApp.game.accuracy,level:SkyshotApp.game.level,frames:SkyshotApp.debug.frameCount,overlay:!document.getElementById('end-screen').hidden})")
            errors=[e for e in c.events if e.get('method')=='Runtime.exceptionThrown' or (e.get('method')=='Log.entryAdded' and e.get('params',{}).get('entry',{}).get('level')=='error')]
            timings=c.js('renderTimings.slice().sort((a,b)=>a-b)')
            checks={'endedNaturally':final['state']=='over' and final['remaining']==0,'wallClockDuration':89<=wall<=93,'movingBirdsHit':final['hits']>=20,'sixDifficultyLevels':final['level']==6,'boundedEntities':max_birds<=18 and max_particles<110,'endScreenVisible':final['overlay'],'noConsoleErrors':not errors}
            report={'browser':c.call('Browser.getVersion'),'wallSeconds':wall,'realMouseClicks':clicks,'final':final,'peakBirds':max_birds,'peakParticles':max_particles,'renderMilliseconds':{'median':timings[len(timings)//2],'p95':timings[int(len(timings)*.95)]},'checks':checks,'errors':errors}
            (ARTIFACTS/'live-round.json').write_text(json.dumps(report,indent=2)+'\n')
            c.screenshot(ARTIFACTS/'live-round-finished.png')
            print(json.dumps(report,indent=2),flush=True)
            assert all(checks.values()),'Live round checks failed'
        finally:
            if c:c.socket.close()
            p.terminate()
            try:p.wait(timeout=8)
            except subprocess.TimeoutExpired:p.kill();p.wait()

if __name__=='__main__':main()
