import sys,re,os,time
from playwright.sync_api import sync_playwright
OUT='/tmp/h/out/'
def local(url):
    m=re.match(r'https://esm\.sh/(.*)',url)
    if not m: return None
    p=m.group(1)
    if p.startswith('three@0.180.0/examples/jsm/'): return OUT+'three-jsm/'+p.split('examples/jsm/')[1].split('?')[0]
    if p.startswith('three@0.180.0'): return OUT+'three.js'
    if p.startswith('three-mesh-bvh'): return OUT+'bvh.js'
    if p.startswith('meshoptimizer'): return OUT+'meshopt.js'
    if p.startswith('fflate'): return OUT+'fflate.js'
    if p.startswith('@gltf-transform/core'): return OUT+'gt-core.js'
    if p.startswith('@gltf-transform/extensions'): return OUT+'gt-ext.js'
    if p.startswith('@gltf-transform/functions'): return OUT+'gt-fn.js'
    return None
def handle(route):
    url=route.request.url
    f=local(url)
    if f and os.path.exists(f):
        t=open(f).read()
        t=t.replace('from "three"','from "https://esm.sh/three@0.180.0"').replace('from "@gltf-transform/core"','from "https://esm.sh/@gltf-transform/core@4.5.0"')
        route.fulfill(status=200,body=t,headers={'content-type':'application/javascript','access-control-allow-origin':'*'})
    elif url.startswith('http://localhost'): route.continue_()
    else: route.abort()
def main(shot, model='/mnt/user-data/uploads/mini.glb'):
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'])
        pg=b.new_page(viewport={'width':1400,'height':900})
        logs=[]
        pg.on('console',lambda m:logs.append(m.type+': '+m.text[:200]))
        pg.on('pageerror',lambda e:logs.append('PAGEERROR '+str(e)[:300]))
        pg.route('**/*',handle)
        pg.goto('http://localhost:8123/index.html',wait_until='load')
        time.sleep(2)
        pg.set_input_files('#fileInput',model)
        pg.wait_for_function("window.__shrinkApp && window.__shrinkApp.originalModel",timeout=120000)
        time.sleep(4)
        pg.wait_for_selector('#wheelSplit',state='attached',timeout=20000)
        pg.evaluate("document.getElementById('wheelDetails').open=true")
        pg.check('#wheelSplit')
        pg.click('#optimizeBtn')
        pg.wait_for_function("!document.getElementById('downloadBtn').disabled",timeout=240000)
        time.sleep(3)
        print(pg.evaluate("document.getElementById('wheelSplitNote').textContent"))
        pg.evaluate("(()=>{const e=document.getElementById('wheelFront');e.value=60;e.dispatchEvent(new Event('input'));const d=document.getElementById('wheelSize');d.value=85;d.dispatchEvent(new Event('input'))})()")
        time.sleep(1)
        pg.screenshot(path=shot+'_wheels.png',timeout=240000)
        with pg.expect_download(timeout=120000) as dl:
            pg.click('#downloadBtn')
        path=shot+'_wheels.glb'; dl.value.save_as(path); print(pg.evaluate("document.getElementById('status').textContent"));print('GLB',os.path.getsize(path)//1024,'KB',dl.value.suggested_filename)
        print('\n'.join(logs[-15:]))
        b.close()
main(sys.argv[1],*(sys.argv[2:3]))
