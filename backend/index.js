const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- Auth Routes ---

app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  console.log('Register attempt:', { username, email });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
      [username, email, hashedPassword]
    );
    console.log('Registration successful for:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt:', { email });
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    console.log('User found:', !!user);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    console.log('Password match:', match);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Goal Routes ---

async function checkAndAwardRewards(userId, goalId) {
  try {
    // 1. Get goal limit
    const goalRes = await db.query('SELECT amount_limit FROM savings_goals WHERE id = $1', [goalId]);
    if (goalRes.rows.length === 0) return;
    const limit = parseFloat(goalRes.rows[0].amount_limit);

    // 2. Sum all spending (amount is negative for spending)
    const spendingRes = await db.query('SELECT SUM(amount) as total FROM transaction_ledger WHERE goal_id = $1', [goalId]);
    const totalSpending = parseFloat(spendingRes.rows[0].total || 0);
    
    // Amount saved is the limit minus the absolute spending (if spending is negative)
    // Example: limit 1000, spending -200 -> saved 800.
    // If spending is -800 -> saved 200.
    const saved = limit + totalSpending; 
    const percentage = (saved / limit) * 100;

    const checkpoints = [25, 50, 75, 100];
    for (const cp of checkpoints) {
      if (percentage >= cp) {
        // Check if already awarded
        const rewardCheck = await db.query(
          'SELECT id FROM rewards WHERE user_id = $1 AND goal_id = $2 AND checkpoint_percentage = $3',
          [userId, goalId, cp]
        );
        if (rewardCheck.rows.length === 0) {
          await db.query(
            'INSERT INTO rewards (user_id, goal_id, checkpoint_percentage, reward_item) VALUES ($1, $2, $3, $4)',
            [userId, goalId, cp, `Reward for ${cp}% savings checkpoint!`]
          );
        }
      }
    }
  } catch (err) {
    console.error('Reward Error:', err);
  }
}

app.post('/goals', authenticateToken, async (req, res) => {
  const { amount_limit, start_date, end_date } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO savings_goals (user_id, amount_limit, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, amount_limit, start_date, end_date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/goals', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM savings_goals WHERE user_id = $1', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/shop/buy', authenticateToken, async (req, res) => {
  const { productId, goalId } = req.body;
  try {
    const productRes = await db.query('SELECT price, name FROM products WHERE id = $1', [productId]);
    if (productRes.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    
    const product = productRes.rows[0];
    const amount = -product.price;

    const result = await db.query(
      'INSERT INTO transaction_ledger (goal_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [goalId, amount, 'spend', `Bought ${product.name}`]
    );
    
    await checkAndAwardRewards(req.user.id, goalId);
    
    res.status(201).json({ message: `Bought ${product.name}!`, transaction: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/goals/:id/skip-day', authenticateToken, async (req, res) => {
  const goalId = req.params.id;
  try {
    const goalCheck = await db.query('SELECT id FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Unauthorized' });

    // Increment the end_date or start_date by 1 day to simulate time passing
    // Since we use end_date for "completion", let's move start_date forward
    await db.query(
      "UPDATE savings_goals SET start_date = start_date + interval '1 day' WHERE id = $1",
      [goalId]
    );

    await checkAndAwardRewards(req.user.id, goalId);
    res.json({ message: 'One day has passed...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Ledger & Reward Routes ---

app.post('/transactions', authenticateToken, async (req, res) => {
  const { goal_id, amount, transaction_type, description } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO transaction_ledger (goal_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [goal_id, amount, transaction_type, description]
    );
    
    // Trigger reward check immediately after transaction
    await checkAndAwardRewards(req.user.id, goal_id);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/rewards', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM rewards WHERE user_id = $1', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
