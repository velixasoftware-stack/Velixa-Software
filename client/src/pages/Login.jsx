import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

function IconUser() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16" />
      <path d="M14 21V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v12" />
      <path d="M8 9h0M8 13h0M8 17h0" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconEye({ off }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.4 5.5A9.6 9.6 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.1 2.2-2.1 3.3M6.1 6.9C4.2 8.2 2.9 10 2 12c1 2.5 5 7 10 7 1.3 0 2.5-.3 3.6-.8" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a6c4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Gear({ cx, cy, r, toothLen, opacity }) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g transform={`translate(${cx},${cy})`} opacity={opacity}>
      {teeth.map((a) => (
        <rect key={a} x={-r * 0.16} y={-r - toothLen} width={r * 0.32} height={toothLen + 2} rx={r * 0.08} fill="#ffffff" transform={`rotate(${a})`} />
      ))}
      <circle r={r} fill="none" stroke="#ffffff" strokeWidth={r * 0.22} />
      <circle r={r * 0.32} fill="#ffffff" />
    </g>
  );
}

function LoginIllustration() {
  return (
    <svg viewBox="0 0 320 240" className="login-brand-illustration" aria-hidden="true">
      <rect x="8" y="8" width="304" height="224" rx="28" fill="#ffffff" opacity="0.07" />

      {/* desk */}
      <rect x="40" y="178" width="220" height="9" rx="4" fill="#ffffff" opacity="0.9" />
      <rect x="56" y="187" width="8" height="26" rx="2" fill="#ffffff" opacity="0.55" />
      <rect x="224" y="187" width="8" height="26" rx="2" fill="#ffffff" opacity="0.55" />

      {/* chair back */}
      <rect x="216" y="118" width="9" height="66" rx="4" fill="#ffffff" opacity="0.45" />

      {/* person */}
      <path d="M190 188 q-1 -42 30 -42 q30 0 29 42 z" fill="#ffffff" />
      <circle cx="219" cy="124" r="15" fill="#ffd9b3" />
      <path d="M204 121 q0 -19 15 -19 q15 0 15 19 q-5 -9 -15 -9 q-10 0 -15 9 z" fill="#2a1d14" />

      {/* laptop (drawn after the person so it sits in front, on the desk) */}
      <path d="M184 178 L254 178 L249 170 L189 170 Z" fill="#ffffff" opacity="0.95" />
      <rect x="194" y="132" width="50" height="38" rx="4" fill="#ffffff" />
      <rect x="199" y="137" width="40" height="28" rx="2" fill="#0d9488" />

      {/* microscope, on the desk between the ID cards and the laptop */}
      <image href="/microscope-icon.png" x="88" y="126" width="58" height="58" />

      {/* ID cards */}
      <g transform="translate(34,34) rotate(-10)">
        <rect width="48" height="64" rx="7" fill="#ffffff" />
        <circle cx="24" cy="21" r="10" fill="#14b8a6" />
        <rect x="11" y="38" width="26" height="4" rx="2" fill="#cbd5e1" />
        <rect x="11" y="46" width="20" height="4" rx="2" fill="#cbd5e1" />
        <rect x="11" y="54" width="24" height="4" rx="2" fill="#cbd5e1" />
      </g>
      <g transform="translate(78,20) rotate(6)">
        <rect width="48" height="64" rx="7" fill="#ffffff" />
        <circle cx="24" cy="21" r="10" fill="#0f766e" />
        <rect x="11" y="38" width="26" height="4" rx="2" fill="#cbd5e1" />
        <rect x="11" y="46" width="20" height="4" rx="2" fill="#cbd5e1" />
        <rect x="11" y="54" width="24" height="4" rx="2" fill="#cbd5e1" />
      </g>

      {/* gears */}
      <Gear cx={256} cy={52} r={15} toothLen={6} opacity={0.85} />
      <Gear cx={284} cy={84} r={9} toothLen={4} opacity={0.6} />

      {/* sparkle dots */}
      <circle cx="58" cy="100" r="3" fill="#ffffff" opacity="0.55" />
      <circle cx="292" cy="150" r="3" fill="#ffffff" opacity="0.45" />
      <circle cx="120" cy="18" r="2.5" fill="#ffffff" opacity="0.5" />
    </svg>
  );
}

const FEATURES = [
  'Patient billing, receipts & subscription recharge',
  'Lab result entry, verification & branded reports',
  'AI-powered trend insights on every report',
  'Role-based access across every module',
];

function blankSignup() {
  return { clientName: '', mobile: '', email: '', address: '', adminUsername: '', adminPassword: '', adminName: '' };
}

export default function Login() {
  const [mode, setMode] = useState('client'); // 'client' | 'chief' | 'signup'
  const [clientCode, setClientCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginChiefAdmin, loginClientUser, sessionMessage, clearSessionMessage } = useAuth();
  const navigate = useNavigate();

  const [signup, setSignup] = useState(blankSignup());
  const [signupResult, setSignupResult] = useState(null);

  function updateSignup(field, value) { setSignup((f) => ({ ...f, [field]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    clearSessionMessage();
    setLoading(true);
    try {
      if (mode === 'chief') {
        await loginChiefAdmin(username, password);
        navigate('/chief-admin');
      } else {
        await loginClientUser(clientCode, username, password);
        navigate('/app');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/self-register', signup);
      setSignupResult(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  function goToLoginAfterSignup() {
    setClientCode(signupResult.clientCode);
    setUsername(signupResult.username);
    setPassword('');
    setSignupResult(null);
    setSignup(blankSignup());
    setMode('client');
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="login-brand-top">
          <LoginIllustration />
          <ul className="login-brand-features">
            {FEATURES.map((f) => (
              <li key={f}><span className="feat-dot"><IconCheck /></span>{f}</li>
            ))}
          </ul>
        </div>
        <div className="login-brand-footer">Monthly Recharge Application</div>
      </div>

      <div className="login-panel">
        <div className="login-card" style={mode === 'signup' ? { maxWidth: 460 } : undefined}>
          <img src="/velixa-logo.png" alt="Velixa Software Solutions" className="login-card-logo" />
          {signupResult ? (
            <>
              <div className="login-card-header">
                <h1>You're all set!</h1>
                <p>Your account has been created. A confirmation has been sent to your email and WhatsApp number.</p>
              </div>
              <div className="report-patient-grid" style={{ marginBottom: 20 }}>
                <div><span>Client Code (auto-generated)</span><strong>{signupResult.clientCode}</strong></div>
                <div><span>Username</span><strong>{signupResult.username}</strong></div>
              </div>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                Note down your Client Code above — you'll need it every time you log in.
                Log in now to complete your first month's payment and activate full access.
              </p>
              <button className="login-submit" onClick={goToLoginAfterSignup}>Continue to Login</button>
            </>
          ) : (
            <>
              <div className="login-card-header">
                {mode !== 'signup' && <span className="login-card-brand">LIMS</span>}
                <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
                <p>{mode === 'signup' ? 'Register your lab and start your first month free of setup hassle.' : 'Sign in to continue to your dashboard.'}</p>
              </div>

              {sessionMessage && (
                <p className="error-text"><IconAlert />{sessionMessage}</p>
              )}

              <div className="login-toggle">
                <button type="button" className={mode === 'client' ? 'active' : ''} onClick={() => setMode('client')}>
                  Client Login
                </button>
                <button type="button" className={mode === 'chief' ? 'active' : ''} onClick={() => setMode('chief')}>
                  Chief Admin
                </button>
                <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
                  Sign Up
                </button>
              </div>

              {mode === 'signup' ? (
                <form onSubmit={handleSignup}>
                  <p style={{ fontSize: 13, color: '#64748b', marginTop: -8, marginBottom: 12 }}>
                    Your Client Code will be generated automatically once you submit this form.
                  </p>
                  <div className="form-grid">
                    <label><span>Client / Lab Name</span><input value={signup.clientName} onChange={(e) => updateSignup('clientName', e.target.value)} required /></label>
                    <label><span>Mobile (WhatsApp)</span><input value={signup.mobile} onChange={(e) => updateSignup('mobile', e.target.value)} placeholder="For WhatsApp confirmation" /></label>
                    <label><span>Email</span><input type="email" value={signup.email} onChange={(e) => updateSignup('email', e.target.value)} placeholder="For email confirmation" /></label>
                    <label><span>Address</span><input value={signup.address} onChange={(e) => updateSignup('address', e.target.value)} /></label>
                  </div>
                  <div className="form-grid">
                    <label><span>Your Username</span><input value={signup.adminUsername} onChange={(e) => updateSignup('adminUsername', e.target.value)} required /></label>
                    <label><span>Your Name</span><input value={signup.adminName} onChange={(e) => updateSignup('adminName', e.target.value)} /></label>
                    <label><span>Password</span><input type="password" value={signup.adminPassword} onChange={(e) => updateSignup('adminPassword', e.target.value)} required /></label>
                  </div>
                  {error && <p className="error-text"><IconAlert />{error}</p>}
                  <button type="submit" className="login-submit" disabled={loading}>
                    {loading ? 'Creating account…' : 'Create Account'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSubmit}>
                  {mode === 'client' && (
                    <label>
                      <span>Client Code</span>
                      <div className="input-with-icon">
                        <IconBuilding />
                        <input value={clientCode} onChange={(e) => setClientCode(e.target.value)} placeholder="e.g. DEMO001" required />
                      </div>
                    </label>
                  )}
                  <label>
                    <span>Username</span>
                    <div className="input-with-icon">
                      <IconUser />
                      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username" required />
                    </div>
                  </label>
                  <label>
                    <span>Password</span>
                    <div className="input-with-icon">
                      <IconLock />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        data-pw
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                      />
                      <button
                        type="button"
                        className="pw-toggle"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <IconEye off={showPassword} />
                      </button>
                    </div>
                  </label>
                  {error && <p className="error-text"><IconAlert />{error}</p>}
                  <button type="submit" className="login-submit" disabled={loading}>
                    {loading ? 'Signing in…' : 'Sign In'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
        <p className="login-powered-by">Powered by Velixa Software Solutions Pvt Ltd</p>
      </div>
    </div>
  );
}
