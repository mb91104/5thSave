import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, 
  Tooltip, Legend, BarChart, Bar, XAxis, YAxis 
} from 'recharts';

const API_BASE = 'http://localhost:3000';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', username: '' });
  const [goalForm, setGoalForm] = useState({ amount_limit: '', start_date: '', end_date: '' });
  const [goals, setGoals] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [products, setProducts] = useState([]);
  const [circles, setCircles] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [circleForm, setCircleForm] = useState({ circle_name: '', invite_token: '' });
  const [activeGoalId, setActiveGoalId] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard'); // dashboard, shop, social
  const [cart, setCart] = useState([]);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    if (token) {
      fetchGoals();
      fetchRewards();
      fetchProducts();
      fetchCircles();
      fetchCart();
    }
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
    try {
      const res = await axios.post(`${API_BASE}${endpoint}`, authForm);
      if (authMode === 'login') {
        setToken(res.data.token);
        localStorage.setItem('token', res.data.token);
        setUser(res.data.user);
      } else {
        alert('Registered! Please login.');
        setAuthMode('login');
      }
    } catch (err) { alert(err.response?.data?.error || 'Auth failed'); }
  };

  const fetchGoals = async () => {
    try {
      const res = await axios.get(`${API_BASE}/goals`, { headers: { Authorization: `Bearer ${token}` } });
      setGoals(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchRewards = async () => {
    try {
      const res = await axios.get(`${API_BASE}/rewards`, { headers: { Authorization: `Bearer ${token}` } });
      setRewards(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/products`);
      setProducts(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchCircles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/circles`, { headers: { Authorization: `Bearer ${token}` } });
      setCircles(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchCart = async () => {
    try {
      const res = await axios.get(`${API_BASE}/cart`, { headers: { Authorization: `Bearer ${token}` } });
      setCart(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchLeaderboard = async (circleId) => {
    try {
      const res = await axios.get(`${API_BASE}/leaderboard/${circleId}`, { headers: { Authorization: `Bearer ${token}` } });
      setLeaderboard(res.data);
    } catch (err) { console.error(err); }
  };

  const resetGoals = async () => {
    if (!window.confirm('Are you sure you want to clear all your goals?')) return;
    try {
      await axios.delete(`${API_BASE}/goals`, { headers: { Authorization: `Bearer ${token}` } });
      fetchGoals();
      alert('Goals reset!');
    } catch (err) { alert(err.response?.data?.error || 'Error resetting goals'); }
  };

  const createGoal = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/goals`, goalForm, { headers: { Authorization: `Bearer ${token}` } });
      fetchGoals();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const endGoal = async (goalId) => {
    try {
      await axios.post(`${API_BASE}/goals/${goalId}/end`, { }, { headers: { Authorization: `Bearer ${token}` } });
      alert('Goal ended!');
      fetchGoals();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const addToCart = async (productId) => {
    try {
      await axios.post(`${API_BASE}/cart`, { productId, quantity: 1 }, { headers: { Authorization: `Bearer ${token}` } });
      fetchCart();
      alert('Added to cart!');
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const removeFromCart = async (itemId) => {
    try {
      await axios.delete(`${API_BASE}/cart/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchCart();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const checkout = async () => {
    if (!activeGoalId) return alert('Please select a goal for this session');
    try {
      const res = await axios.post(`${API_BASE}/shop/checkout`, { goalId: activeGoalId }, { headers: { Authorization: `Bearer ${token}` } });
      setReceipt(res.data);
      setCart([]);
      fetchGoals();
      fetchRewards();
      alert('Checkout successful! Time has progressed.');
    } catch (err) { alert(err.response?.data?.error || 'Checkout failed'); }
  };

  const createCircle = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/circles`, { circle_name: circleForm.circle_name }, { headers: { Authorization: `Bearer ${token}` } });
      fetchCircles();
      setCircleForm({ ...circleForm, circle_name: '' });
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const joinCircleInvite = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/circles/join-invite`, { token: circleForm.invite_token }, { headers: { Authorization: `Bearer ${token}` } });
      fetchCircles();
      setCircleForm({ ...circleForm, invite_token: '' });
      alert('Joined circle successfully!');
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const generateInvite = async (circleId) => {
    try {
      const res = await axios.post(`${API_BASE}/circles/invite`, { circle_id: circleId }, { headers: { Authorization: `Bearer ${token}` } });
      alert(`Invite Token: ${res.data.invite_token}`);
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  if (!token) {
    return (
      <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <h1 style={{ color: '#2c3e50' }}>5thSave Login</h1>
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '300px' }}>
          {authMode === 'register' && <input placeholder="Username" onChange={e => setAuthForm({...authForm, username: e.target.value})} />}
          <input placeholder="Email" onChange={e => setAuthForm({...authForm, email: e.target.value})} />
          <input type="password" placeholder="Password" onChange={e => setAuthForm({...authForm, password: e.target.value})} />
          <button type="submit" style={{ cursor: 'pointer', padding: '10px' }}>{authMode === 'login' ? 'Login' : 'Register'}</button>
          <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
            Switch to {authMode === 'login' ? 'Register' : 'Login'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: '#333', maxWidth: '1000px', margin: '0 auto' }}>
      <nav style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid #eee', paddingBottom: '10px' }}>
        <button onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
        <button onClick={() => setCurrentPage('shop')}>Shopping</button>
        <button onClick={() => setCurrentPage('social')}>Social</button>
        <button onClick={() => { localStorage.removeItem('token'); setToken(null); }} style={{ marginLeft: 'auto' }}>Logout</button>
      </nav>

      {currentPage === 'dashboard' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <section style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
            <h3>Set New Savings Goal</h3>
            <form onSubmit={createGoal} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="number" placeholder="Limit (₹)" onChange={e => setGoalForm({...goalForm, amount_limit: e.target.value})} />
              <input type="date" onChange={e => setGoalForm({...goalForm, start_date: e.target.value})} />
              <input type="date" onChange={e => setGoalForm({...goalForm, end_date: e.target.value})} />
              <button type="submit">Create Goal</button>
            </form>
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0 }}>Your Active Goals</h4>
                <button onClick={resetGoals} style={{ fontSize: '11px', padding: '2px 5px', color: 'red', cursor: 'pointer' }}>Reset All</button>
              </div>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {goals.map(g => (
                  <li key={g.id} style={{ padding: '10px', borderBottom: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <span><strong>Goal #{g.id}</strong>: Limit ₹{g.amount_limit} | Status: {g.status}</span>
                    {g.status === 'active' && (
                      <button onClick={() => endGoal(g.id)} style={{ fontSize: '12px', alignSelf: 'flex-start' }}>End Goal</button>
                    )}
                  </li>
                ))}
                {goals.length === 0 && <li>No goals set yet.</li>}
              </ul>
            </div>
          </section>

          <section style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
            <h3>📊 Budget Progress</h3>
            {goals.length > 0 ? (
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={[
                        { name: 'Spent', value: goals[0].amount_limit || 0 }, // Simplified for the first goal
                        { name: 'Remaining', value: Math.max(0, goals[0].amount_limit - (goals[0].amount_limit || 0)) }
                      ]} 
                      cx="50%" cy="50%" 
                      outerRadius={80} 
                      fill="#8884d8" 
                      dataKey="value" 
                      label
                    >
                      <Cell fill="#ff4d4f" />
                      <Cell fill="#52c41a" />
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : <p>No goals set to visualize.</p>}
            <div style={{ marginTop: '20px' }}>
               <h4 style={{ margin: 0 }}>🎁 Rewards Earned</h4>
               <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                {rewards.map(r => (
                  <div key={r.id} style={{ padding: '10px', background: '#f0fff0', border: '1px solid #4caf50', borderRadius: '5px' }}>
                    <strong>{r.checkpoint_percentage}%!</strong><br/>{r.reward_item}
                  </div>
                ))}
                {rewards.length === 0 && <p>No rewards yet.</p>}
               </div>
            </div>
          </section>
        </div>
      )}

      {currentPage === 'shop' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
            <h3>🛒 Shopping Simulation</h3>
            <p>Select a goal to apply the spending to.</p>
            <select 
              onChange={e => setActiveGoalId(e.target.value)} 
              style={{ width: '100%', marginBottom: '20px', padding: '10px' }}
            >
              <option value="">-- Select Goal --</option>
              {goals.map(g => <option key={g.id} value={g.id}>Goal #{g.id} (Limit ₹{g.amount_limit})</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
              {products.map(p => (
                <div key={p.id} style={{ padding: '15px', border: '1px solid #eee', borderRadius: '8px', textAlign: 'center', background: '#f9f9f9' }}>
                  <strong>{p.name}</strong><br/>
                  ₹{p.price}<br/>
                  <button 
                    onClick={() => addToCart(p.id)}
                    style={{ marginTop: '10px', cursor: 'pointer' }}
                  >
                    Add to Cart
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px', background: '#fafafa' }}>
            <h3>🛒 Your Cart</h3>
            {cart.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {cart.map(item => (
                  <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', padding: '5px', borderBottom: '1px solid #eee' }}>
                    <span>{item.name} x{item.quantity} (₹{item.price * item.quantity})</span>
                    <button onClick={() => removeFromCart(item.id)} style={{ color: 'red', cursor: 'pointer' }}>X</button>
                  </li>
                ))}
                <div style={{ marginTop: '20px', fontWeight: 'bold', textAlign: 'right' }}>
                  Total: ₹{cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)}
                </div>
                <button 
                  onClick={checkout} 
                  style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                >
                  Checkout
                </button>
              </ul>
            ) : <p>Cart is empty.</p>}
            
            {receipt && (
              <div style={{ marginTop: '20px', padding: '10px', background: '#fff', border: '1px dashed #999', borderRadius: '5px' }}>
                <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>🧾 Receipt</h4>
                <div style={{ fontSize: '12px' }}>
                  {receipt.receipt.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{item.name} x{item.quantity}</span>
                      <span>₹{item.price * item.quantity}</span>
                    </div>
                  ))}
                  <hr/>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span>Total</span>
                    <span>₹{receipt.totalAmount}</span>
                  </div>
                </div>
                <button 
                  onClick={() => setReceipt(null)} 
                  style={{ width: '100%', marginTop: '10px', fontSize: '11px' }}
                >
                  Close Receipt
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {currentPage === 'social' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <section style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
            <h3>👥 Social & Circles</h3>
            <form onSubmit={createCircle} style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
              <input 
                placeholder="New Circle Name" 
                value={circleForm.circle_name} 
                onChange={e => setCircleForm({...circleForm, circle_name: e.target.value})} 
              />
              <button type="submit">Create</button>
            </form>
            <form onSubmit={joinCircleInvite} style={{ display: 'flex', gap: '5px', marginBottom: '20px' }}>
              <input 
                placeholder="Enter Invite Token" 
                value={circleForm.invite_token} 
                onChange={e => setCircleForm({...circleForm, invite_token: ''})} 
              />
              <button type="submit">Join via Invite</button>
            </form>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {circles.map(c => (
                <li key={c.id} style={{ padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{c.circle_name} (ID: {c.id})</span>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button onClick={() => fetchLeaderboard(c.id)}>View Rank</button>
                    <button onClick={() => generateInvite(c.id)}>Invite</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
            <h3>🏆 Circle Leaderboard</h3>
            {leaderboard.length > 0 ? (
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead style={{ borderBottom: '2px solid #ddd' }}>
                  <tr><th>User</th><th>Best Savings %</th></tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td>{entry.username}</td>
                      <td>{entry.best_percentage?.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>Select a circle to see rankings.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
