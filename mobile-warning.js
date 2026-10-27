// SHRINK 3D (v2.185) — dark-green mobile/tablet holding screen with SHRINK logo and white text.
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
      <img class="mb-logo" src="./src/app-icon.png?v=2.18" alt="SHRINK 3D logo">
      <h1>SHRINK 3D is ready on your laptop or desktop</h1>
      <p>SHRINK repairs, reduces and prepares large 3D models, so it works best on a full computer.</p>
      <p class="mb-small">Please open SHRINK 3D on your laptop or desktop for now.</p>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `
    #shrinkMobileBlock{
      position:fixed;inset:0;z-index:2147483647;
      display:flex;align-items:center;justify-content:center;
      padding:28px 24px;box-sizing:border-box;overflow:auto;
      background:
        radial-gradient(circle at 50% 12%,rgba(26,92,56,.38),transparent 42%),
        linear-gradient(180deg,#0a2418 0%,#071b12 58%,#06150e 100%);
      color:#fff;
      font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
      text-align:center
    }
    #shrinkMobileBlock .mb-card{max-width:520px;width:100%;margin:auto}
    #shrinkMobileBlock .mb-logo{
      display:block;
      width:min(58vw,260px);
      height:auto;
      margin:0 auto 26px;
      filter:drop-shadow(0 14px 28px rgba(0,0,0,.34))
    }
    #shrinkMobileBlock h1{
      margin:0 0 18px;
      color:#fff;
      font-size:clamp(30px,8.5vw,46px);
      line-height:1.12;
      font-weight:900;
      letter-spacing:-.6px
    }
    #shrinkMobileBlock p{
      margin:0 0 14px;
      color:#fff;
      font-size:clamp(18px,5vw,22px);
      line-height:1.42;
      font-weight:600
    }
    #shrinkMobileBlock .mb-small{
      margin-top:6px;
      color:#fff;
      font-size:clamp(15px,4.2vw,18px);
      font-weight:500;
      opacity:.86
    }
    html.shrink-mobile-blocked,html.shrink-mobile-blocked body{overflow:hidden!important}
  `;
  document.head.appendChild(style);
  document.documentElement.classList.add('shrink-mobile-blocked');
  document.body.appendChild(wall);
})();
