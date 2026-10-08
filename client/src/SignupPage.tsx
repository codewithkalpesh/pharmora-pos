import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext.js';
import './auth.css';

export function SignupPage() {
  const { signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Required Fields
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Optional Fields
  const [showOptional, setShowOptional] = useState(false);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [gstin, setGstin] = useState('');
  const [drugLicenseNumber, setDrugLicenseNumber] = useState('');

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  // Redirect if already authenticated
  if (isAuthenticated && !busy && !success) {
    navigate('/', { replace: true });
    return null;
  }

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: '#cbd5e1' };
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (score <= 2) return { score: 1, label: 'Weak (min 6 chars)', color: '#ef4444' };
    if (score <= 4) return { score: 2, label: 'Medium', color: '#f59e0b' };
    return { score: 3, label: 'Strong', color: '#10b981' };
  };

  const strength = getPasswordStrength(password);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    // Validations
    if (!shopName.trim()) {
      setError('Please enter your shop name.');
      return;
    }
    if (!ownerName.trim()) {
      setError('Please enter the owner full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!phone.trim() || phone.trim().length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please verify your confirm password.');
      return;
    }

    setBusy(true);

    try {
      await signup({
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        confirmPassword,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        pincode: pincode.trim() || undefined,
        gstin: gstin.trim().toUpperCase() || undefined,
        drugLicenseNumber: drugLicenseNumber.trim().toUpperCase() || undefined,
      });

      setSuccess(true);
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 1000);
    } catch (err: any) {
      setError(err?.message || 'Failed to create shop account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-viewport">
      <div className="signup-card">
        {/* Branding */}
        <div className="login-branding">
          <div className="login-logo">P</div>
          <h1 className="login-title">Create Shop Account</h1>
          <p className="login-subtitle">Join Pharmora POS — Multi-Tenant Pharmacy System</p>
        </div>

        {/* Success Alert */}
        {success && (
          <div className="signup-success-alert" role="status">
            <span>🎉</span>
            <div>
              <strong>Shop Created Successfully!</strong>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>Logging you into your dashboard…</p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="login-error-alert" role="alert">
            <span>⚠️</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span>{error}</span>
              {error.toLowerCase().includes('already exists') && (
                <Link to="/login" style={{ color: '#0284c7', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'underline' }}>
                  Click here to Log In instead →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Signup Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="signup-section-title">Shop & Owner Details</div>

          <div className="signup-grid-2">
            <div className="login-field">
              <label htmlFor="signup-shopname">Shop / Pharmacy Name *</label>
              <input
                id="signup-shopname"
                type="text"
                className="login-input"
                placeholder="e.g. Apex Medical Store"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                disabled={busy || success}
                required
                autoFocus
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-ownername">Owner Full Name *</label>
              <input
                id="signup-ownername"
                type="text"
                className="login-input"
                placeholder="e.g. Dr. Rajesh Sharma"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                disabled={busy || success}
                required
              />
            </div>
          </div>

          <div className="signup-grid-2">
            <div className="login-field">
              <label htmlFor="signup-email">Email Address *</label>
              <input
                id="signup-email"
                type="email"
                className="login-input"
                placeholder="e.g. owner@apexmed.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy || success}
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-phone">Mobile Number *</label>
              <input
                id="signup-phone"
                type="tel"
                className="login-input"
                placeholder="e.g. 9876543210"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy || success}
                required
              />
            </div>
          </div>

          <div className="signup-grid-2">
            <div className="login-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="signup-password">Password *</label>
                {password && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: strength.color }}>
                    {strength.label}
                  </span>
                )}
              </div>
              <div className="password-input-wrap">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="login-input"
                  placeholder="Min 6 characters"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy || success}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '👁️' : '🔒'}
                </button>
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="signup-confirm-password">Confirm Password *</label>
              <div className="password-input-wrap">
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="login-input"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={busy || success}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? '👁️' : '🔒'}
                </button>
              </div>
            </div>
          </div>

          {/* Optional Details Accordion */}
          <div className="optional-section">
            <button
              type="button"
              className="optional-toggle-btn"
              onClick={() => setShowOptional(!showOptional)}
            >
              <span>{showOptional ? '▼' : '▶'} Additional Shop Details (Optional)</span>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                GSTIN, Drug License, Address
              </span>
            </button>

            {showOptional && (
              <div className="optional-fields-container">
                <div className="login-field">
                  <label htmlFor="signup-address">Shop Address</label>
                  <input
                    id="signup-address"
                    type="text"
                    className="login-input"
                    placeholder="e.g. Shop No. 4, Station Road"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    disabled={busy || success}
                  />
                </div>

                <div className="signup-grid-3">
                  <div className="login-field">
                    <label htmlFor="signup-city">City</label>
                    <input
                      id="signup-city"
                      type="text"
                      className="login-input"
                      placeholder="e.g. Mumbai"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      disabled={busy || success}
                    />
                  </div>
                  <div className="login-field">
                    <label htmlFor="signup-state">State</label>
                    <input
                      id="signup-state"
                      type="text"
                      className="login-input"
                      placeholder="e.g. Maharashtra"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      disabled={busy || success}
                    />
                  </div>
                  <div className="login-field">
                    <label htmlFor="signup-pincode">Pincode</label>
                    <input
                      id="signup-pincode"
                      type="text"
                      className="login-input"
                      placeholder="e.g. 400001"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value)}
                      disabled={busy || success}
                    />
                  </div>
                </div>

                <div className="signup-grid-2">
                  <div className="login-field">
                    <label htmlFor="signup-gstin">GSTIN (Optional)</label>
                    <input
                      id="signup-gstin"
                      type="text"
                      className="login-input"
                      placeholder="e.g. 27AAAAA0000A1Z5"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value)}
                      disabled={busy || success}
                    />
                  </div>

                  <div className="login-field">
                    <label htmlFor="signup-drug-license">Drug License No. (Optional)</label>
                    <input
                      id="signup-drug-license"
                      type="text"
                      className="login-input"
                      placeholder="e.g. 20B/21B-MH-12345"
                      value={drugLicenseNumber}
                      onChange={(e) => setDrugLicenseNumber(e.target.value)}
                      disabled={busy || success}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            className="login-submit-btn"
            disabled={busy || success || !shopName.trim() || !ownerName.trim() || !email.trim() || !phone.trim() || !password}
          >
            {busy ? 'Creating Shop & Account…' : success ? '✓ Account Created!' : 'Create Shop & Start POS'}
          </button>
        </form>

        {/* Link back to login */}
        <div className="signup-footer-links">
          <span>Already have an account?</span>{' '}
          <Link to="/login" className="signup-login-link">
            Login to your shop
          </Link>
        </div>

        <div className="login-footer-note">
          <span>Your shop database is private, isolated, and encrypted.</span>
        </div>
      </div>
    </div>
  );
}
