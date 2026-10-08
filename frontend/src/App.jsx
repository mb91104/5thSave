import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3000';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // login or register
  const [authForm, setAuthForm] = useState({ email: '', password: '', username: '' });
  const [goalForm, setGoalForm] = useState({ amount_limit: '', start_date: '', end_date: '' });
  const [transForm, setTransForm] = useState({ goal_id: '', amount: '', description: '' });
  const [goals, setGoals] = useState([]);
  const [rewards, setRewards] = useState([]);

  useEffect(() => {
    if (token) {
      fetchGoals();
      fetchRewards();
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

  const createGoal = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/goals`, goalForm, { headers: { Authorization: `Bearer ${token}` } });
      fetchGoals();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const addTransaction = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/transactions`, { ...transForm, transaction_type: 'spend' }, { headers: { Authorization: `Bearer ${token}` } });
      fetchGoals();
      fetchRewards();
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
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: '#333' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Welcome to 5thSave!</h1>
        <button onClick={() => { localStorage.removeItem('token'); setToken(null); }}>Logout</button>
      </div>

      <section style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>Set New Savings Goal</h3>
        <form onSubmit={createGoal} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input type="number" placeholder="Limit (₹)" onChange={e => setGoalForm({...goalForm, amount_limit: e.target.value})} />
          <input type="date" onChange={e => setGoalForm({...goalForm, start_date: e.target.value})} />
          <input type="date" onChange={e => setGoalForm({...goalForm, end_date: e.target.value})} />
          <button type="submit">Create Goal</button>
        </form>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <section style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Your Active Goals</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {goals.map(g => (
              <li key={g.id} style={{ padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><strong>Goal #{g.id}</strong>: Limit ₹{g.amount_limit} | Status: {g.status}</span>
                {g.status === 'active' && (
                  <button 
                    onClick={async () => {
                      try {
                        await axios.post(`${API_BASE}/goals/${g.id}/complete`, {}, { headers: { Authorization: `Bearer ${token}` } });
                        fetchGoals();
                        fetchRewards();
                      } catch (err) { alert('Error completing goal'); }
                    }}
                    style={{ fontSize: '12px', cursor: 'pointer', padding: '5px' }}
                  >
                    ⏩ Time Skip
                  </button>
                )}
              </li>
            ))}
            {goals.length === 0 && <li>No goals set yet.</li>}
          </ul>
        </section>

        <section style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Log a Spend</h3>
          <form onSubmit={addTransaction} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input placeholder="Goal ID" onChange={e => setTransForm({...transForm, goal_id: e.target.value})} />
            <input type="number" placeholder="Amount (e.g. -100)" onChange={e => setTransForm({...transForm, amount: e.target.value})} />
            <input placeholder="What did you buy?" onChange={e => setTransForm({...transForm, description: e.target.value})} />
            <button type="submit">Record Transaction</button>
          </form>
        </section>
      </div>

      <section style={{ marginTop: '30px' }}>
        <h3>🏆 Rewards Earned</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {rewards.map(r => (
            <div key={r.id} style={{ 
              padding: '15px', 
              background: '#f0fff0', 
              border: '2px solid #4caf50', 
              borderRadius: '10px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <strong>{r.checkpoint_percentage}% Milestone!</strong><br/>
              {r.reward_item}
            </div>
          ))}
          {rewards.length === 0 && <p>No rewards yet. Keep saving!</p>}
        </div>
      </section>
    </div>
  );
}

export default App;
