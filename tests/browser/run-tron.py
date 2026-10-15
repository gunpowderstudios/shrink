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
def main(faces_pos, shot, colour='baked', tex='1024'):
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'])
        pg=b.new_page(viewport={'width':1400,'height':900})
        logs=[]
        pg.on('console',lambda m:logs.append(m.type+': '+m.text[:200]))
        pg.on('pageerror',lambda e:logs.append('PAGEERROR '+str(e)[:300]))
        pg.route('**/*',handle)
        pg.goto('http://localhost:8123/index.html',wait_until='load')
        time.sleep(2)
        pg.set_input_files('#fileInput','/mnt/user-data/uploads/mini.glb')
        pg.wait_for_function("window.__shrinkApp && window.__shrinkApp.originalModel",timeout=120000)
        time.sleep(4)
        pg.screenshot(path=shot+'_original.png',timeout=240000)
        pg.evaluate("document.getElementById('tronDetails') && (document.getElementById('tronDetails').open=true)")
        pg.evaluate(f"(()=>{{const s=document.getElementById('tronFaces');s.value={faces_pos};s.dispatchEvent(new Event('input'))}})()")
        pg.evaluate(f"(()=>{{document.getElementById('tronColour').value='{colour}';document.getElementById('tronTex').value='{tex}'}})()")
        pg.evaluate("window.__shrinkTron.make()")
        pg.wait_for_function("window.__shrinkTron.showing",timeout=180000)
        time.sleep(3)
        print(pg.evaluate("document.getElementById('tronStatus').textContent"))
        pg.screenshot(path=shot+'_tron.png',timeout=240000)
        with pg.expect_download(timeout=120000) as dl:
            pg.click('#tronDownload')
        path=shot+'_tron.glb'; dl.value.save_as(path); print('GLB',os.path.getsize(path)//1024,'KB',dl.value.suggested_filename)
        print('\n'.join(logs[-25:]))
        b.close()
main(int(sys.argv[1]),sys.argv[2],*(sys.argv[3:5]))
