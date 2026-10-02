// SHRINK 3D v2.02 — friendly mobile/tablet warning.
(() => {
  const isTouchDevice = navigator.maxTouchPoints > 1;
  const isSmallScreen = window.matchMedia('(max-width: 900px)').matches;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  if (!(mobileUA || (isTouchDevice && isSmallScreen))) return;
  if (document.getElementById('shrinkMobileWarning')) return;

  const banner = document.createElement('div');
  banner.id = 'shrinkMobileWarning';
  banner.setAttribute('role', 'note');
  banner.innerHTML = `
    <div class="mobile-warning-icon">💻</div>
    <div class="mobile-warning-copy">
      <strong>Mobiles are for kids! 😄</strong>
      <span>Hop over to your laptop or PC for best results.</span>
      <small>Big 3D files, fusing, remeshing and splitting need more memory and run much better on desktop.</small>
    </div>
    <button type="button" aria-label="Dismiss mobile warning">×</button>`;

  const header = document.querySelector('.topbar');
  header?.insertAdjacentElement('afterend', banner);

  const style = document.createElement('style');
  style.textContent = `
    #shrinkMobileWarning{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:12px 14px;border:1px solid #4e87bb;border-radius:14px;background:linear-gradient(135deg,rgba(31,91,145,.30),rgba(12,26,39,.92));box-shadow:0 12px 34px rgba(0,0,0,.24);color:#fff}
    #shrinkMobileWarning .mobile-warning-icon{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:12px;background:#267ed0;font-size:23px}
    #shrinkMobileWarning .mobile-warning-copy{min-width:0;flex:1}
    #shrinkMobileWarning strong,#shrinkMobileWarning span,#shrinkMobileWarning small{display:block}
    #shrinkMobileWarning strong{font-size:15px;line-height:1.2}
    #shrinkMobileWarning span{margin-top:2px;font-size:13px;font-weight:700;color:#d7ebff}
    #shrinkMobileWarning small{margin-top:3px;font-size:10.5px;line-height:1.35;color:#9db8cf}
    #shrinkMobileWarning button{appearance:none;border:0;background:transparent;color:#9db8cf;font-size:26px;line-height:1;cursor:pointer;padding:4px 5px}
    #shrinkMobileWarning button:hover{color:#fff}
    @media(max-width:520px){#shrinkMobileWarning{align-items:flex-start;padding:11px 12px}#shrinkMobileWarning .mobile-warning-icon{width:38px;height:38px;flex-basis:38px;font-size:20px}#shrinkMobileWarning strong{font-size:14px}#shrinkMobileWarning span{font-size:12px}}
  `;
  document.head.appendChild(style);
  banner.querySelector('button')?.addEventListener('click', () => banner.remove());
})();
