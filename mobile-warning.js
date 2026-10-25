// SHRINK 3D (v2.158) — phones and tablets are blocked with a big, friendly message: SHRINK needs a laptop or desktop.
// The test is the same as before: a mobile browser, or a touch screen with a small display. A narrow desktop window is NOT blocked.
(() => {
  const isTouchDevice = navigator.maxTouchPoints > 1;
  const isSmallScreen = window.matchMedia('(max-width: 900px)').matches;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (!(mobileUA || (isTouchDevice && isSmallScreen))) return;
  if (document.getElementById('shrinkMobileBlock')) return;

  const wall = document.createElement('div');
  wall.id = 'shrinkMobileBlock';
  wall.setAttribute('role', 'alertdialog');
  wall.setAttribute('aria-modal', 'true');
  wall.innerHTML = `
    <div class="mb-card">
      <div class="mb-icon">💻</div>
      <h1>Please use a laptop or desktop for better shrinking!</h1>
      <p>SHRINK 3D repairs and shrinks big 3D models, and that needs far more memory and power than a phone or tablet has.</p>
      <p class="mb-small">Open this page on a laptop or desktop computer and it will work properly.</p>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #shrinkMobileBlock{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;overflow:auto;background:radial-gradient(circle at 50% 20%,#123a5c,#06101a 70%);color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
    #shrinkMobileBlock .mb-card{max-width:520px;width:100%}
    #shrinkMobileBlock .mb-icon{font-size:clamp(84px,30vw,150px);line-height:1;margin-bottom:18px}
    #shrinkMobileBlock h1{margin:0 0 18px;font-size:clamp(30px,9vw,46px);line-height:1.15;font-weight:900;letter-spacing:-.5px}
    #shrinkMobileBlock p{margin:0 0 14px;font-size:clamp(18px,5vw,22px);line-height:1.4;color:#d7ebff}
    #shrinkMobileBlock .mb-small{font-size:clamp(15px,4.2vw,18px);color:#9db8cf}
    html.shrink-mobile-blocked,html.shrink-mobile-blocked body{overflow:hidden!important}
  `;
  document.head.appendChild(style);
  document.documentElement.classList.add('shrink-mobile-blocked');
  document.body.appendChild(wall);
})();
