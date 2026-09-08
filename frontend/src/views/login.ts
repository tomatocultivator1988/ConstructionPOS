import { apiPost } from '../lib/api';
import { val, disableBtn, showToast } from '../lib/helpers';
import { loadView } from '../lib/router';

function toggleChrome(show: boolean) {
  const nav = document.querySelector('nav') as HTMLElement;
  const headerRight = document.getElementById('header-user');
  if (nav) nav.style.opacity = show ? '1' : '0';
  if (headerRight) headerRight.style.display = show ? 'flex' : 'none';
}

export function showLogin() {
  toggleChrome(false);
  document.body.classList.remove('staff-user');
  const main = document.getElementById('main-content')!;
  main.innerHTML = `
    <div class="login-page">
      <div class="login-waves">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path class="wave wave-1" d="M0,160 C320,100 640,260 960,160 C1280,60 1380,120 1440,140 L1440,320 L0,320 Z"/>
          <path class="wave wave-2" d="M0,200 C240,280 540,100 820,200 C1100,300 1300,180 1440,200 L1440,320 L0,320 Z"/>
          <path class="wave wave-3" d="M0,240 C400,140 700,300 1000,240 C1180,200 1340,260 1440,250 L1440,320 L0,320 Z"/>
        </svg>
      </div>
      <div class="login-card">
        <div class="login-brand">
          <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
            <rect x="8" y="20" width="24" height="14" rx="2" fill="#f0b429"/>
            <rect x="12" y="24" width="6" height="6" rx="1" fill="#0b2945"/>
            <rect x="22" y="24" width="6" height="6" rx="1" fill="#0b2945"/>
            <path d="M6 20 L20 8 L34 20" stroke="#f0b429" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <rect x="18" y="14" width="4" height="6" rx="1" fill="#f0b429"/>
          </svg>
          <div class="login-title">Jeg Enterprises</div>
          <div class="login-sub">POS System</div>
        </div>
        <div class="form-group">
          <label>Username</label>
          <input id="login-user" placeholder="Enter username" maxlength="50" autofocus />
        </div>
        <div class="form-group">
          <label>PIN</label>
          <input id="login-pin" type="password" placeholder="Enter PIN" maxlength="6" inputmode="numeric" />
          <div class="field-error" id="login-err"></div>
        </div>
        <button class="btn btn-primary login-btn" id="login-btn" onclick="doLogin()">Login</button>
      </div>
    </div>
  `;
}

export async function doLogin() {
  const username = val('login-user').trim();
  const pin = val('login-pin');
  if (!username || !pin) { showToast('Enter username and PIN'); return; }
  const btn = document.getElementById('login-btn') as HTMLButtonElement;
  if (btn) { btn.textContent = 'Logging in...'; btn.disabled = true; }
  try {
    const data = await apiPost<any>('/auth/login', { username, pin });
    localStorage.setItem('buildpro_token', data.token);
    localStorage.setItem('buildpro_user', JSON.stringify(data.user));
    toggleChrome(true);
    loadView(data.user.role === 'staff' ? 'invoices' : 'dashboard');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const homeBtn = document.querySelector(`[data-view="${data.user.role === 'staff' ? 'invoices' : 'dashboard'}"]`);
    if (homeBtn) homeBtn.classList.add('active');
  } catch (e: any) {
    showToast(e.message);
    if (btn) { btn.textContent = 'Login'; btn.disabled = false; }
  }
}

export function logout() {
  localStorage.removeItem('buildpro_token');
  localStorage.removeItem('buildpro_user');
  toggleChrome(false);
  document.body.classList.remove('staff-user');
  showLogin();
}
