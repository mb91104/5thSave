import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

const API_BASE = 'http://localhost:3000';

const MILESTONES = [
  { pct: 25, name: 'Flipkart Voucher' },
  { pct: 50, name: 'Amazon Giftcard' },
  { pct: 75, name: 'Makemytrip Voucher' },
  { pct: 100, name: 'Ultimate Saver Reward' },
];

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const CATEGORIES = [
  { id: 'Food', label: 'Food' },
  { id: 'Clothes', label: 'Clothes' },
  { id: 'Electronics', label: 'Electronics' },
  { id: 'Accessories', label: 'Accessories' },
];

const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => toDateStr(new Date());
const addDaysStr = (dateStr, days) => {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return toDateStr(d);
};
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const WINDOWS = [
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 30 },
];

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', username: '' });
  const [authError, setAuthError] = useState('');
  const [goalForm, setGoalForm] = useState({ amount_limit: '', start_date: todayStr() });
  const [goalWindow, setGoalWindow] = useState('week'); // 'week' | 'month'
  const [goals, setGoals] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCategory, setActiveCategory] = useState('Food');
  const [categoryCounts, setCategoryCounts] = useState({});
  const [circles, setCircles] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [activeBoard, setActiveBoard] = useState(null);
  const [circleForm, setCircleForm] = useState({ circle_name: '' });
  const [joinToken, setJoinToken] = useState(() => {
    const m = window.location.pathname.match(/^\/join\/([\w-]+)\/?$/);
    return m ? m[1] : null;
  });
  const [invitePreview, setInvitePreview] = useState(null);
  const [inviteStatus, setInviteStatus] = useState('idle'); // idle | loading | ready | invalid
  const [joining, setJoining] = useState(false);
  const [activeGoalId, setActiveGoalId] = useState('');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [cart, setCart] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = (msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // Stale/expired token: drop it and send the user back to sign-in
  // instead of failing every action silently.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401 && localStorage.getItem('token')) {
          localStorage.removeItem('token');
          setToken(null);
          setUser(null);
          toast('Session expired. Please sign in again.');
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, []);

  const fetchGoals = async () => {
    try {
      const res = await axios.get(`${API_BASE}/goals`, { headers: authHeaders });
      setGoals(res.data);
    } catch (err) { console.error(err); }
  };
  const fetchRewards = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rewards`, { headers: authHeaders });
      setRewards(res.data);
    } catch (err) { console.error(err); }
  };
  const fetchProducts = async (category = 'Food') => {
    try {
      const url = category && category !== 'All'
        ? `${API_BASE}/products?category=${encodeURIComponent(category)}`
        : `${API_BASE}/products`;
      const res = await axios.get(url);
      setProducts(res.data);
    } catch (err) { console.error(err); }
  };
  const fetchCategories = async () => {
    try {
      const res = await axios.get(`${API_BASE}/products/categories`);
      const map = {};
      res.data.forEach((r) => { map[r.category] = r.count; });
      setCategoryCounts(map);
    } catch (err) { console.error(err); }
  };
  const selectCategory = (id) => {
    setActiveCategory(id);
    fetchProducts(id);
  };
  const fetchCircles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/circles`, { headers: authHeaders });
      setCircles(res.data);
    } catch (err) { console.error(err); }
  };
  const fetchCart = async () => {
    try {
      const res = await axios.get(`${API_BASE}/cart`, { headers: authHeaders });
      setCart(res.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (token) {
      fetchGoals();
      fetchRewards();
      fetchProducts();
      fetchCategories();
      fetchCircles();
      fetchCart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stats = useMemo(() => {
    const totalLimit = goals.reduce((s, g) => s + (Number(g.amount_limit) || 0), 0);
    const totalSpent = goals.reduce((s, g) => s + (Number(g.total_spent) || 0), 0);
    const active = goals.filter((g) => g.status === 'active').length;
    const completed = goals.filter((g) => g.status !== 'active').length;
    const best = rewards.length ? Math.max(...rewards.map((r) => Number(r.checkpoint_percentage))) : 0;
    return { totalLimit, totalSpent, active, completed, best, count: rewards.length };
  }, [goals, rewards]);

  const goalChartData = useMemo(
    () => goals.slice(0, 7).map((g) => ({ name: `#${g.id}`, limit: Number(g.amount_limit) || 0 })),
    [goals]
  );
  const savingsPie = useMemo(() => [
    { name: 'Achieved', value: stats.best },
    { name: 'Remaining', value: Math.max(0, 100 - stats.best) },
  ], [stats.best]);

  const progressFor = (goal) => {
    const rel = rewards.filter((r) => String(r.goal_id) === String(goal.id));
    if (!rel.length) return 0;
    return Math.max(...rel.map((r) => Number(r.checkpoint_percentage)));
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
    try {
      const res = await axios.post(`${API_BASE}${endpoint}`, authForm);
      if (authMode === 'login') {
        setToken(res.data.token);
        localStorage.setItem('token', res.data.token);
        setUser(res.data.user);
      } else {
        toast('Account created. Please sign in.');
        setAuthMode('login');
      }
    } catch (err) { setAuthError(err.response?.data?.error || 'Authentication failed'); }
  };

  const resetGoals = async () => {
    if (!window.confirm('Delete all goals? This cannot be undone.')) return;
    try {
      await axios.delete(`${API_BASE}/goals`, { headers: authHeaders });
      fetchGoals();
      toast('All goals deleted.');
    } catch (err) { toast(err.response?.data?.error || 'Failed to reset goals'); }
  };

  const windowDays = goalWindow === 'month' ? 30 : 7;
  const goalEndPreview = addDaysStr(goalForm.start_date || todayStr(), windowDays);

  const createGoal = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/goals`, {
        amount_limit: goalForm.amount_limit,
        start_date: goalForm.start_date || todayStr(),
        end_date: goalEndPreview,
      }, { headers: authHeaders });
      setGoalForm({ amount_limit: '', start_date: todayStr() });
      fetchGoals();
      toast(`Savings goal created · ${windowDays}-day window.`);
    } catch (err) { toast(err.response?.data?.error || 'Failed to create goal'); }
  };

  const endGoal = async (goalId) => {
    try {
      await axios.post(`${API_BASE}/goals/${goalId}/end`, {}, { headers: authHeaders });
      toast(`Goal #${goalId} marked complete.`);
      fetchGoals();
      fetchRewards();
    } catch (err) { toast(err.response?.data?.error || 'Failed to end goal'); }
  };

  const addToCart = async (productId) => {
    try {
      await axios.post(`${API_BASE}/cart`, { productId, quantity: 1 }, { headers: authHeaders });
      fetchCart();
      toast('Added to cart.');
    } catch (err) { toast(err.response?.data?.error || 'Failed to add item'); }
  };

  const removeFromCart = async (itemId) => {
    try {
      await axios.delete(`${API_BASE}/cart/${itemId}`, { headers: authHeaders });
      fetchCart();
    } catch (err) { toast(err.response?.data?.error || 'Failed to remove item'); }
  };

  const checkout = async () => {
    if (!activeGoalId) return toast('Select a goal to link this purchase.');
    try {
      const res = await axios.post(`${API_BASE}/shop/checkout`, { goalId: Number(activeGoalId) }, { headers: authHeaders });
      setReceipt(res.data);
      setCart([]);
      await fetchGoals();
      await fetchRewards();
      toast('Payment successful. Timeline advanced by 1 day.');
    } catch (err) { toast(err.response?.data?.error || 'Checkout failed'); }
  };

  const createCircle = async (e) => {
    e.preventDefault();
    if (!circleForm.circle_name.trim()) return toast('Enter a circle name.');
    try {
      await axios.post(`${API_BASE}/circles`, { circle_name: circleForm.circle_name }, { headers: authHeaders });
      fetchCircles();
      setCircleForm({ circle_name: '' });
      toast('Circle created.');
    } catch (err) { toast(err.response?.data?.error || 'Failed to create circle'); }
  };

  const fetchInvitePreview = async (tok) => {
    if (!tok) return;
    setInviteStatus('loading');
    try {
      const res = await axios.get(`${API_BASE}/circles/invite/${tok}`);
      setInvitePreview(res.data);
      setInviteStatus('ready');
    } catch (err) {
      setInvitePreview(null);
      setInviteStatus('invalid');
    }
  };

  useEffect(() => {
    if (joinToken) fetchInvitePreview(joinToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinToken]);

  const exitJoinView = () => {
    setJoinToken(null);
    setInvitePreview(null);
    setInviteStatus('idle');
    window.history.replaceState({}, '', '/');
  };

  const acceptInvite = async () => {
    if (!joinToken) return;
    setJoining(true);
    try {
      const res = await axios.post(`${API_BASE}/circles/join-invite`, { token: joinToken }, { headers: authHeaders });
      toast(res.data.message || 'Joined circle.');
      const cid = res.data.circle_id;
      exitJoinView();
      await fetchCircles();
      setCurrentPage('social');
      if (cid) fetchLeaderboard(cid);
    } catch (err) { toast(err.response?.data?.error || 'Failed to join circle'); }
    setJoining(false);
  };

  const [shareMenu, setShareMenu] = useState(null); // { circle, link } or null

  const getInviteLink = async (circle) => {
    const res = await axios.post(`${API_BASE}/circles/invite`, { circle_id: circle.id }, { headers: authHeaders });
    return `${window.location.origin}/join/${res.data.invite_token}`;
  };

  const openShareMenu = async (circle) => {
    try {
      const link = await getInviteLink(circle);
      setShareMenu({ circle, link });
    } catch (err) { toast(err.response?.data?.error || 'Failed to create invite link'); }
  };

  const shareMessage = () => {
    if (!shareMenu) return '';
    const { circle, link } = shareMenu;
    const name = circle.circle_name || `Circle #${circle.id}`;
    return `Join my savings circle "${name}" on 5thSave: ${link}`;
  };

  const shareViaWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage())}`, '_blank', 'noopener');
    setShareMenu(null);
  };
  const shareViaGmail = () => {
    const subject = 'Join my 5thSave savings circle';
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareMessage())}`, '_blank', 'noopener');
    setShareMenu(null);
  };
  const shareViaSms = () => {
    window.location.href = `sms:?body=${encodeURIComponent(shareMessage())}`;
    setShareMenu(null);
  };
  const shareViaInstagram = async () => {
    // Instagram exposes no link-sharing intent; copy so it can be pasted into DMs or a story.
    try {
      await navigator.clipboard.writeText(shareMessage());
      toast('Link copied — paste it into Instagram DMs or your story.');
    } catch { toast('Copy failed — long-press to copy the link.'); }
    setShareMenu(null);
  };
  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareMessage());
      toast('Invite link copied.');
    } catch { toast('Copy failed — long-press to copy the link.'); }
    setShareMenu(null);
  };

  const leaveCircle = async (circle) => {
    if (!window.confirm(`Leave "${circle.circle_name || `Circle #${circle.id}`}"?`)) return;
    try {
      const res = await axios.delete(`${API_BASE}/circles/${circle.id}/leave`, { headers: authHeaders });
      toast(res.data.message || 'Left circle.');
      if (activeBoard === circle.id) { setActiveBoard(null); setLeaderboard([]); }
      fetchCircles();
    } catch (err) { toast(err.response?.data?.error || 'Failed to leave circle'); }
  };

  const deleteCircle = async (circle) => {
    if (!window.confirm(`Delete "${circle.circle_name || `Circle #${circle.id}`}" for all ${circle.member_count ?? ''} members? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API_BASE}/circles/${circle.id}`, { headers: authHeaders });
      toast('Circle deleted.');
      if (activeBoard === circle.id) { setActiveBoard(null); setLeaderboard([]); }
      fetchCircles();
    } catch (err) { toast(err.response?.data?.error || 'Failed to delete circle'); }
  };

  const fetchLeaderboard = async (circleId) => {
    try {
      setActiveBoard(circleId);
      const res = await axios.get(`${API_BASE}/leaderboard/${circleId}`, { headers: authHeaders });
      setLeaderboard(res.data);
    } catch (err) { console.error(err); }
  };

  const cartTotal = cart.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0);
  const username = user?.username || 'there';
  const initial = (username[0] || 'U').toUpperCase();
  const themeClass = currentPage === 'dashboard' ? 'theme-dashboard' : currentPage === 'shop' ? 'theme-shop' : 'theme-social';

  if (!token) {
    return (
      <div className="auth-wrap">
        {joinToken && (
          <div className="auth-card invite-banner">
            {inviteStatus === 'loading' && <p className="muted">Checking invite link…</p>}
            {inviteStatus === 'ready' && invitePreview && (
              <>
                <h1 style={{ fontSize: 20 }}>{invitePreview.inviter ? `${invitePreview.inviter} invited you` : 'You were invited'} to join</h1>
                <p className="muted" style={{ marginBottom: 0 }}>“{invitePreview.circle_name}” · {invitePreview.member_count} member{invitePreview.member_count === 1 ? '' : 's'} — sign in below to accept.</p>
              </>
            )}
            {inviteStatus === 'invalid' && <div className="auth-error">This invite link is invalid or expired.</div>}
          </div>
        )}
        <div className="auth-card">
          <h1>5th<span>Save</span></h1>
          <p className="muted">Goal-based savings, rewards and group tracking.</p>
          {authError && <div className="auth-error">{authError}</div>}
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === 'register' && (
              <div className="field">
                <label>Username</label>
                <input className="input" placeholder="Your name" value={authForm.username} onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} />
              </div>
            )}
            <div className="field">
              <label>Email</label>
              <input className="input" placeholder="you@example.com" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="input" type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
            </div>
            <button type="submit" className="btn block">{authMode === 'login' ? 'Sign in' : 'Create account'}</button>
            <button type="button" className="link-btn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? 'New to 5thSave? Create an account' : 'Already have an account? Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${themeClass}`}>
      <header className="topbar">
        <div className="logo">
          <div className="logo-mark">₹</div>
          <div>
            <div className="logo-name">5thSave</div>
            <div className="logo-sub">Invest · Save · Grow</div>
          </div>
        </div>
        <nav className="nav">
          <button className={`nav-btn ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
          <button className={`nav-btn ${currentPage === 'shop' ? 'active' : ''}`} onClick={() => setCurrentPage('shop')}>Shop</button>
          <button className={`nav-btn ${currentPage === 'social' ? 'active' : ''}`} onClick={() => setCurrentPage('social')}>Circles</button>
        </nav>
        <div className="search-pill">⌕ &nbsp;Search goals, products, circles…</div>
        <div className="userbox">
          <div className="user-avatar">{initial}</div>
          <button className="logout-btn" onClick={() => { localStorage.removeItem('token'); setToken(null); setUser(null); }}>Log out</button>
        </div>
      </header>

      {joinToken && (
        <div className="join-wrap">
          <div className="card join-card">
            {inviteStatus === 'loading' && <div className="empty">Checking invite link…</div>}
            {inviteStatus === 'invalid' && (
              <>
                <h3>Invite link expired</h3>
                <p>This link is invalid or past its 7-day expiry. Ask for a fresh one.</p>
                <button className="btn secondary" onClick={exitJoinView}>Back to app</button>
              </>
            )}
            {inviteStatus === 'ready' && invitePreview && (
              <>
                <div className="watch-avatar" style={{ width: 52, height: 52, fontSize: 20 }}>
                  {String(invitePreview.circle_name || 'C').slice(0, 1).toUpperCase()}
                </div>
                <h3 style={{ margin: '12px 0 4px' }}>Join “{invitePreview.circle_name}”?</h3>
                <p>
                  {invitePreview.inviter ? `${invitePreview.inviter} invited you · ` : ''}
                  {invitePreview.member_count} member{invitePreview.member_count === 1 ? '' : 's'} · compare savings on the leaderboard.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="btn" disabled={joining} onClick={acceptInvite}>{joining ? 'Joining…' : 'Join circle'}</button>
                  <button className="btn secondary" onClick={exitJoinView}>Not now</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!joinToken && currentPage === 'dashboard' && (
        <>
          <div className="page-head">
            <h2 className="page-title">Hi {username}, your savings portfolio</h2>
            <p className="page-sub">Limits, milestones and rewards — styled like your investments.</p>
          </div>

          <div className="portfolio-card">
            <div className="portfolio-balance">
              <div className="k">Total budget limit</div>
              <div className="v">{inr(stats.totalLimit)}</div>
              <div className="s">▲ Best milestone {stats.best}% · {stats.count} rewards</div>
            </div>
            <div className="portfolio-split">
              <div className="split-cell">
                <div className="k">Spent</div>
                <div className="v">{inr(stats.totalSpent)}</div>
              </div>
              <div className="split-cell">
                <div className="k">Active goals</div>
                <div className="v">{stats.active}</div>
              </div>
              <div className="split-cell">
                <div className="k">Completed</div>
                <div className="v">{stats.completed}</div>
              </div>
              <div className="split-cell">
                <div className="k">Circles</div>
                <div className="v">{circles.length}</div>
              </div>
            </div>
          </div>

          <div className="layout-2">
            <section className="card">
              <div className="card-head">
                <h3>Holdings · {goals.length} goals</h3>
                <button onClick={resetGoals} className="link-btn" style={{ color: '#b42318' }}>Exit all</button>
              </div>
              <div className="card-body">
                <form onSubmit={createGoal} className="form-row">
                  <div className="field">
                    <label>Limit (₹)</label>
                    <input className="input" type="number" min="1" placeholder="e.g. 25,000" value={goalForm.amount_limit} onChange={(e) => setGoalForm({ ...goalForm, amount_limit: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Window</label>
                    <div className="seg">
                      {WINDOWS.map((w) => (
                        <button key={w.id} type="button" className={`seg-btn ${goalWindow === w.id ? 'active' : ''}`} onClick={() => setGoalWindow(w.id)}>
                          {w.label} · {w.days}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label>Start</label>
                    <input className="input" type="date" value={goalForm.start_date} onChange={(e) => setGoalForm({ ...goalForm, start_date: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>&nbsp;</label>
                    <button type="submit" className="btn">Invest</button>
                  </div>
                </form>
                <div className="window-hint">{windowDays}-day window · ends {fmtDate(goalEndPreview)}</div>

                <div className="goal-list">
                  {goals.map((g) => {
                    const pct = progressFor(g);
                    const spent = Number(g.total_spent || 0);
                    const limit = Number(g.amount_limit) || 0;
                    const dep = limit > 0 ? (spent / limit) * 100 : 0;
                    const depCls = dep >= 100 ? 'over' : dep >= 75 ? 'high' : dep >= 50 ? 'mid' : 'low';
                    const left = limit - spent;
                    return (
                      <div key={g.id} className="holding">
                        <div className="holding-tile">G{g.id}</div>
                        <div className="holding-mid">
                          <div className="holding-name">Goal #{g.id} · {g.status}</div>
                          <div className="holding-sub">{fmtDate(g.start_date)} → {fmtDate(g.end_date)}</div>
                          <div className={`deplete ${depCls}`}>
                            <div className="deplete-fill" style={{ width: `${Math.min(dep, 100)}%` }} />
                            {[25, 50, 75].map((t) => (
                              <span key={t} className="deplete-tick" style={{ left: `${t}%` }} />
                            ))}
                          </div>
                          <div className={`spend-line ${dep >= 100 ? 'over' : ''}`}>
                            {dep >= 100
                              ? `${inr(spent)} spent · ${inr(-left)} over budget`
                              : `${inr(spent)} spent of ${inr(limit)} · ${inr(left)} left`}
                          </div>
                        </div>
                        <div className="holding-right">
                          <div className="holding-amt">{inr(limit)}</div>
                          <div className={`holding-pnl ${pct > 0 ? 'up' : 'flat'}`}>{pct > 0 ? `▲ ${pct}%` : '— 0%'} milestone</div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                            <button className="mini-btn primary" onClick={() => { setActiveGoalId(String(g.id)); setCurrentPage('shop'); }}>Shop</button>
                            {g.status === 'active' && <button className="mini-btn" onClick={() => endGoal(g.id)}>Complete</button>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {goals.length === 0 && <div className="empty">No holdings yet. Add your first goal above — like your first SIP.</div>}
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h3>Returns &amp; rewards</h3>
                <a>View all</a>
              </div>
              <div className="card-body">
                <div className="milestones">
                  {MILESTONES.map((m) => {
                    const done = rewards.some((r) => Number(r.checkpoint_percentage) >= m.pct);
                    return (
                      <div key={m.pct} className={`mile ${done ? 'done' : ''}`}>
                        <div className="p">{m.pct}%</div>
                        <div className="n">{m.name}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="chart-box">
                  <h4>Savings distribution</h4>
                  <p>Milestone achievement vs remaining.</p>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={savingsPie} dataKey="value" innerRadius={50} outerRadius={75} paddingAngle={3} strokeWidth={1} stroke="#e5e7eb">
                          <Cell fill="#4F6B6A" />
                          <Cell fill="#e5e7eb" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="chart-box">
                  <h4>Budget by goal</h4>
                  <p>Limit set per goal.</p>
                  <div style={{ height: 160 }}>
                    {goalChartData.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={goalChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11 }} width={44} axisLine={false} tickLine={false} />
                          <Tooltip />
                          <Bar dataKey="limit" fill="#4F6B6A" radius={[6, 6, 2, 2]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <p>No data yet.</p>}
                  </div>
                </div>

                <div className="reward-chips">
                  {rewards.map((r) => (
                    <span key={r.id} className="chip">{r.checkpoint_percentage}% · {r.reward_item}</span>
                  ))}
                  {rewards.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>No rewards earned yet.</span>}
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {!joinToken && currentPage === 'shop' && (
        <>
          <div className="page-head">
            <h2 className="page-title">Explore products</h2>
            <p className="page-sub">Like a watchlist — link a goal, add to cart, place order.</p>
          </div>

          <div className="layout-shop">
            <section className="card">
              <div className="card-head">
                <h3>{activeCategory} · {products.length}</h3>
                <p>Linked to your goals</p>
              </div>
              <div className="card-body">
                <div className="cat-strip">
                  {CATEGORIES.map((c) => {
                    const count = categoryCounts[c.id] ?? 0;
                    return (
                      <button
                        key={c.id}
                        className={`cat-pill ${activeCategory === c.id ? 'active' : ''}`}
                        onClick={() => selectCategory(c.id)}
                      >
                        <span>{c.label}</span>
                        <span className="cat-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="field">
                  <label>Linked savings goal (folio)</label>
                  <select className="select" value={activeGoalId} onChange={(e) => setActiveGoalId(e.target.value)}>
                    <option value="">Select folio</option>
                    {goals.filter((g) => g.status === 'active').map((g) => (
                      <option key={g.id} value={g.id}>Goal #{g.id} · {inr(g.amount_limit)}</option>
                    ))}
                  </select>
                </div>
                <div className="instrument-grid">
                  {products.map((p) => (
                    <div key={p.id} className="instrument">
                      <div className="instrument-top">
                        <div className="instrument-tile">{String(p.name || 'P').slice(0, 1).toUpperCase()}</div>
                        <div className="instrument-name">{p.name}</div>
                      </div>
                      <div className="instrument-price">{inr(p.price)}</div>
                      <div className="instrument-sub">Live price · Qty available</div>
                      <button className="btn secondary block" onClick={() => addToCart(p.id)}>Buy now</button>
                    </div>
                  ))}
                  {products.length === 0 && <div className="empty">No instruments available.</div>}
                </div>
              </div>
            </section>

            <aside className="card cart-panel">
              <div className="card-head">
                <h3>Order · ({cart.length})</h3>
              </div>
              <div className="card-body">
                {cart.length ? (
                  <>
                    {cart.map((item) => (
                      <div key={item.id} className="cart-line">
                        <span>{item.name} × {item.quantity}</span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <strong>{inr(item.price * item.quantity)}</strong>
                          <button className="mini-btn danger" onClick={() => removeFromCart(item.id)}>Remove</button>
                        </span>
                      </div>
                    ))}
                    <div className="cart-total"><span>Payable</span><span>{inr(cartTotal)}</span></div>
                    <button className="btn block" onClick={checkout}>Place order</button>
                  </>
                ) : <div className="empty">Your cart is empty.</div>}

                {receipt && (
                  <div className="receipt">
                    <h4>Receipt · Order #{receipt.orderId}</h4>
                    {receipt.receipt.map((item, i) => (
                      <div key={i} className="receipt-row"><span>{item.name} × {item.quantity}</span><span>{inr(item.price * item.quantity)}</span></div>
                    ))}
                    <div className="receipt-row" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8 }}>
                      <span>Total paid</span><span>{inr(receipt.totalAmount)}</span>
                    </div>
                    <button className="mini-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => setReceipt(null)}>Close receipt</button>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </>
      )}

      {!joinToken && currentPage === 'social' && (
        <>
          <div className="page-head">
            <h2 className="page-title">Circles watchlist</h2>
            <p className="page-sub">Your groups, ranked like top gainers.</p>
          </div>

          <div className="layout-2">
            <section className="card">
              <div className="card-head">
                <h3>Watchlist · {circles.length}</h3>
              </div>
              <div className="card-body">
                <form onSubmit={createCircle} style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder="New circle name" value={circleForm.circle_name} onChange={(e) => setCircleForm({ circle_name: e.target.value })} />
                  <button type="submit" className="btn">Create</button>
                </form>
                <p style={{ fontSize: 12.5, color: '#7c7e8c', margin: '8px 2px 0' }}>Invite friends with a shareable link — no codes to type.</p>
                <div className="circle-list">
                  {circles.map((c, i) => (
                    <div key={c.id} className={`watch-row ${activeBoard === c.id ? 'selected' : ''}`}>
                      <span className="rank-num">{String(i + 1).padStart(2, '0')}</span>
                      <div className="watch-avatar">{String(c.circle_name || 'C').slice(0, 1).toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {c.circle_name || `Circle #${c.id}`}{' '}
                          {c.is_creator && <span className="creator-tag">creator</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#7c7e8c' }}>{c.member_count} member{c.member_count === 1 ? '' : 's'}</div>
                      </div>
                      <button className="mini-btn" onClick={() => fetchLeaderboard(c.id)}>Open</button>
                      <button className="mini-btn primary" onClick={() => openShareMenu(c)}>Share</button>
                      <button className="mini-btn" onClick={() => leaveCircle(c)}>Leave</button>
                      {c.is_creator && <button className="mini-btn danger" onClick={() => deleteCircle(c)}>Delete</button>}
                    </div>
                  ))}
                  {circles.length === 0 && <div className="empty">Empty watchlist. Create a circle or join with a code.</div>}
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h3>Top gainers</h3>
                <p>{activeBoard ? `Circle #${activeBoard}` : 'Select a circle'}</p>
              </div>
              <div className="card-body">
                {leaderboard.length > 0 ? (
                  <>
                    {leaderboard.slice(0, 3).map((e, i) => (
                      <div key={i} className="watch-row">
                        <span className="rank-num">{i + 1}</span>
                        <div className="watch-avatar">{String(e.username || 'U').slice(0, 1).toUpperCase()}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{e.username}</div>
                          <div style={{ fontSize: 12, color: '#7c7e8c' }}>Best savings</div>
                        </div>
                        <span className="gain-pill">▲ {Number(e.best_percentage || 0).toFixed(1)}%</span>
                      </div>
                    ))}
                    <table className="table">
                      <thead><tr><th>#</th><th>Member</th><th style={{ textAlign: 'right' }}>Best savings</th></tr></thead>
                      <tbody>
                        {leaderboard.map((entry, i) => (
                          <tr key={i} className={entry.username === username ? 'me' : ''}>
                            <td>{i + 1}</td>
                            <td>{entry.username}{entry.username === username ? ' (you)' : ''}</td>
                            <td style={{ textAlign: 'right' }}>{Number(entry.best_percentage || 0).toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : <div className="empty">No rankings to display yet.</div>}
              </div>
            </section>
          </div>
        </>
      )}

      {shareMenu && (
        <div className="share-backdrop" onClick={() => setShareMenu(null)}>
          <div className="share-sheet" onClick={(e) => e.stopPropagation()}>
            <h4>Share invite link</h4>
            <p className="share-sub">“{shareMenu.circle.circle_name || `Circle #${shareMenu.circle.id}`}” · expires in 7 days</p>
            <button className="share-row" onClick={shareViaWhatsApp}>
              <span className="share-tile wa">W</span>
              <span>WhatsApp</span>
            </button>
            <button className="share-row" onClick={shareViaGmail}>
              <span className="share-tile gm">G</span>
              <span>Gmail</span>
            </button>
            <button className="share-row" onClick={shareViaInstagram}>
              <span className="share-tile ig">I</span>
              <span>Instagram</span>
            </button>
            <button className="share-row" onClick={shareViaSms}>
              <span className="share-tile sm">S</span>
              <span>SMS</span>
            </button>
            <button className="share-row" onClick={copyShareLink}>
              <span className="share-tile cp">⧉</span>
              <span>Copy link</span>
            </button>
            <button className="mini-btn" style={{ width: '100%', marginTop: 6 }} onClick={() => setShareMenu(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </div>
  );
}

export default App;
