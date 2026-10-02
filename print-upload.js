// SHRINK 3D v2.01 — dedicated upload/change-model control for 3D print mode.
(() => {
  const VERSION = '2.09';
  const $ = id => document.getElementById(id);
  const body = document.body;
  const chooser = document.querySelector('.mode-chooser');
  const dropZone = $('dropZone');
  const fileInput = $('fileInput');
  if (!chooser || !dropZone || !fileInput || document.getElementById('printUploadHero')) return;

  const hero = document.createElement('section');
  hero.id = 'printUploadHero';
  hero.className = 'print-upload-hero';
  hero.hidden = true;
  hero.innerHTML = `
    <div class="print-upload-icon">↓</div>
    <div class="print-upload-copy">
      <strong>DROP A SCULPT HERE</strong>
      <span>STL, OBJ, PLY or GLB — or click to choose</span>
    </div>
    <button type="button" class="print-upload-button">Choose a model</button>`;
  chooser.insertAdjacentElement('afterend', hero);

  const style = document.createElement('style');
  style.id = 'printUploadStyle';
  style.textContent = `
    .print-upload-hero{min-height:260px;margin:0 0 16px;border:2px dashed rgba(73,165,255,.62);border-radius:22px;background:linear-gradient(180deg,rgba(8,19,27,.90),rgba(5,15,20,.82));display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;gap:8px;cursor:pointer;box-shadow:inset 0 0 80px rgba(42,145,255,.04);transition:.16s ease}
    .print-upload-hero:hover,.print-upload-hero.dragover{border-color:#48a7ff;background:linear-gradient(180deg,rgba(16,37,54,.95),rgba(5,18,27,.88));transform:translateY(-1px)}
    .print-upload-hero[hidden]{display:none!important}
    .print-upload-icon{width:62px;height:62px;display:grid;place-items:center;border-radius:17px;background:linear-gradient(135deg,#2e8fff,#58b8ff);font-size:34px;font-weight:900;margin-bottom:8px;box-shadow:0 10px 30px rgba(47,140,255,.24)}
    .print-upload-copy strong{display:block;font-size:25px;line-height:1.1;letter-spacing:-.4px}.print-upload-copy span{display:block;margin-top:7px;color:#a8b7c8;font-size:14px}
    .print-upload-button{margin-top:13px;border:1px solid #4aa4f5;border-radius:12px;background:rgba(47,140,255,.15);color:#fff;padding:11px 19px;font-weight:850;cursor:pointer}
    .print-upload-hero.has-model{min-height:auto;flex-direction:row;justify-content:flex-start;text-align:left;padding:11px 14px;border-style:solid;border-width:1px;gap:12px}
    .print-upload-hero.has-model .print-upload-icon{width:38px;height:38px;flex:0 0 38px;border-radius:10px;font-size:21px;margin:0}
    .print-upload-hero.has-model .print-upload-copy{flex:1}.print-upload-hero.has-model .print-upload-copy strong{font-size:14px}.print-upload-hero.has-model .print-upload-copy span{font-size:11px;margin-top:2px}
    .print-upload-hero.has-model .print-upload-button{margin:0;padding:9px 13px;font-size:12px}
    @media(max-width:620px){.print-upload-hero{min-height:220px}.print-upload-copy strong{font-size:21px}.print-upload-hero.has-model{align-items:center}.print-upload-hero.has-model .print-upload-copy span{display:none}}
  `;
  document.head.appendChild(style);

  function loaded(){ return !!window.__shrinkApp?.sourceFile; }
  function isPrint(){ return body.classList.contains('app-mode-print'); }

  function sync(){
    if (!isPrint()) {
      hero.hidden = true;
      dropZone.style.display = '';
      return;
    }
    const hasModel = loaded();
    hero.hidden = false;
    hero.classList.toggle('has-model', hasModel);
    hero.querySelector('.print-upload-copy strong').textContent = hasModel ? 'MODEL LOADED' : 'DROP A SCULPT HERE';
    hero.querySelector('.print-upload-copy span').textContent = hasModel ? (window.__shrinkApp?.sourceFile?.name || 'Ready to work') : 'STL, OBJ, PLY or GLB — or click to choose';
    hero.querySelector('.print-upload-button').textContent = hasModel ? 'Change model' : 'Choose a model';
    dropZone.style.display = 'none';
  }

  function choose(){ fileInput.click(); }
  hero.addEventListener('click', e => { if (!e.target.closest('.print-upload-button') || e.target.closest('.print-upload-button')) choose(); });
  hero.addEventListener('dragover', e => { e.preventDefault(); hero.classList.add('dragover'); });
  hero.addEventListener('dragleave', () => hero.classList.remove('dragover'));
  hero.addEventListener('drop', e => {
    e.preventDefault(); hero.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      console.warn(`[SHRINK 3D ${VERSION}] Could not pass dropped file to picker`, err);
      choose();
    }
  });

  window.addEventListener('shrink:ui-mode', sync);
  window.addEventListener('shrink:model-opened', () => setTimeout(sync, 0));
  fileInput.addEventListener('change', () => setTimeout(sync, 0));
  sync();
})();
