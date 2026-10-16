const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
// Pin to backend/.env regardless of the working directory the server is started from.
// (A second .env at the repo root has a different JWT_SECRET — loading that by
// accident invalidates every issued token.)
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Define it in backend/.env (canonical) and restart.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Not signed in. Please sign in again.' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Session expired. Please sign out and sign in again.' });
    req.user = user;
    next();
  });
};

// --- Auth Routes ---

// Normalize emails so "User@Example.com " and "user@example.com" are the same account.
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

app.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, email FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Session expired. Please sign out and sign in again.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/register', async (req, res) => {
  const username = req.body.username?.trim();
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
      [username, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email is already taken' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    // LOWER() keeps older mixed-case accounts (e.g. Mb91104@Gmail.com) working.
    const result = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Cart Routes ---
app.post('/cart', authenticateToken, async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = req.body.quantity === undefined ? 1 : Number(req.body.quantity);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: 'Valid productId is required' });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return res.status(400).json({ error: 'Quantity must be between 1 and 99' });
  }
  try {
    const product = await db.query('SELECT id FROM products WHERE id = $1', [productId]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    const result = await db.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [req.user.id, productId, quantity]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/cart', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price
       FROM cart_items ci JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1 ORDER BY ci.id`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/cart/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cart item not found' });
    res.json({ message: 'Item removed from cart' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/shop/checkout', authenticateToken, async (req, res) => {
  const goalId = Number(req.body.goalId);
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goalId is required for checkout' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Goal must exist and belong to the buyer
    const goalRes = await client.query(
      'SELECT id, status FROM savings_goals WHERE id = $1 AND user_id = $2',
      [goalId, req.user.id]
    );
    if (goalRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Goal not found or not yours' });
    }
    if (goalRes.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Goal is already completed — create a new goal to keep shopping.' });
    }

    // 1. Get cart items
    const cartRes = await client.query(
      'SELECT ci.id, ci.product_id, ci.quantity, p.price, p.name FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = $1 ORDER BY ci.id',
      [req.user.id]
    );
    const items = cartRes.rows;
    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }

    let totalOrderAmount = 0;
    for (const item of items) {
      totalOrderAmount += Number(item.price) * item.quantity;
    }

    // 2. Create Order
    const orderRes = await client.query(
      'INSERT INTO orders (user_id, goal_id, total_amount) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, goalId, totalOrderAmount]
    );
    const orderId = orderRes.rows[0].id;

    // 3. Move items to order_items and add to transaction_ledger
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, price_at_purchase, quantity) VALUES ($1, $2, $3, $4)',
        [orderId, item.product_id, item.price, item.quantity]
      );

      await client.query(
        'INSERT INTO transaction_ledger (goal_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4)',
        [goalId, -(Number(item.price) * item.quantity), 'spend', `Bought ${item.name} x${item.quantity}`]
      );
    }

    // 4. Clear Cart
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);

    await client.query('COMMIT');

    // 5. AUTOMATIC TIME SKIP (+1 day) with window-expiry check:
    // if the window elapsed, the goal auto-completes and pays rewards.
    const expiry = await advanceClock(req.user.id, goalId, 1);

    res.status(201).json({
      message: 'Checkout successful!',
      orderId,
      totalAmount: totalOrderAmount,
      receipt: items.map((it) => ({ ...it, price: Number(it.price) })),
      goal_expired: expiry.expired,
      expiry_rewards: expiry.rewards || [],
      expiry_saver: expiry.saver_score ?? null,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Order history for the Report page: every bought item with its category.
app.get('/orders', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT o.id AS order_id, o.goal_id, o.total_amount, o.order_date,
              oi.quantity, oi.price_at_purchase,
              p.name AS product_name, p.category
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.user_id = $1
       ORDER BY o.order_date DESC, o.id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/goals/:id/end', authenticateToken, async (req, res) => {
  const goalId = Number(req.params.id);
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goal id is required' });
  }
  try {
    const goalCheck = await db.query('SELECT id FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Goal not found or not yours' });

    const result = await db.query("UPDATE savings_goals SET status = 'completed' WHERE id = $1 RETURNING *", [goalId]);
    const goal = result.rows[0];
    const { granted, saverScore, totalSpent } = await checkAndAwardRewards(req.user.id, goalId);
    res.json({
      message: 'Goal ended successfully!',
      goal,
      saver_score: saverScore,
      total_spent: totalSpent,
      rewards: granted,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Goal Routes ---


// Savings-based rewards: granted ONLY when a goal is completed — never for spending.
// saver_score = (limit - spent) / limit * 100, clamped at 0.
// Finishing with savings above a checkpoint earns its voucher.
// Returns the newly granted reward rows.
async function checkAndAwardRewards(userId, goalId) {
  const rewardMap = {
    25: 'Flipkart Voucher',
    50: 'Amazon Giftcard',
    75: 'Makemytrip Voucher',
    100: 'Ultimate Saver Reward'
  };
  const checkpoints = [25, 50, 75, 100];
  const granted = [];
  let saverScore = 0, totalSpent = 0, limit = 0;
  try {
    const goalRes = await db.query('SELECT amount_limit FROM savings_goals WHERE id = $1', [goalId]);
    if (goalRes.rows.length === 0) return { granted, saverScore, totalSpent, limit };
    limit = parseFloat(goalRes.rows[0].amount_limit);
    if (!limit || limit <= 0) return { granted, saverScore, totalSpent, limit };

    const spendingRes = await db.query(
      // Net outflow: spends are negative, refunds/positive adjustments offset them.
      // (Summing only negative rows would silently ignore refunds.)
      'SELECT COALESCE(-SUM(amount), 0) AS spent FROM transaction_ledger WHERE goal_id = $1',
      [goalId]
    );
    totalSpent = Math.max(0, parseFloat(spendingRes.rows[0].spent || 0));
    saverScore = Math.max(0, ((limit - totalSpent) / limit) * 100);

    for (const cp of checkpoints) {
      if (saverScore >= cp) {
        const rewardCheck = await db.query(
          'SELECT id FROM rewards WHERE user_id = $1 AND goal_id = $2 AND checkpoint_percentage = $3',
          [userId, goalId, cp]
        );
        if (rewardCheck.rows.length === 0) {
          const ins = await db.query(
            'INSERT INTO rewards (user_id, goal_id, checkpoint_percentage, reward_item) VALUES ($1, $2, $3, $4) RETURNING *',
            [userId, goalId, cp, rewardMap[cp]]
          );
          granted.push(ins.rows[0]);
        }
      }
    }
  } catch (err) {
    console.error('Reward Error:', err);
  }
  return { granted, saverScore: Math.round(saverScore * 100) / 100, totalSpent, limit };
}

// Advance a goal's clock; if the savings window has elapsed
// (start_date reached end_date), auto-complete the goal and grant
// savings rewards. Returns expiry info for the response.
async function advanceClock(userId, goalId, days) {
  await db.query(
    'UPDATE savings_goals SET start_date = start_date + $1 * INTERVAL \'1 day\' WHERE id = $2 AND user_id = $3',
    [days, goalId, userId]
  );
  const cur = await db.query(
    'SELECT start_date, end_date, status FROM savings_goals WHERE id = $1 AND user_id = $2',
    [goalId, userId]
  );
  if (!cur.rows.length) return { expired: false };
  const { start_date, end_date, status } = cur.rows[0];
  if (status !== 'active' || new Date(start_date) < new Date(end_date)) return { expired: false };
  await db.query("UPDATE savings_goals SET status = 'completed' WHERE id = $1", [goalId]);
  const { granted, saverScore, totalSpent } = await checkAndAwardRewards(userId, goalId);
  return { expired: true, rewards: granted, saver_score: saverScore, total_spent: totalSpent };
}

app.post('/goals', authenticateToken, async (req, res) => {
  const { amount_limit, start_date, end_date } = req.body;
  const amount = Number(amount_limit);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount_limit must be a number greater than 0' });
  }
  const start = new Date(start_date);
  const end = new Date(end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'start_date and end_date must be valid dates' });
  }
  if (start >= end) {
    return res.status(400).json({ error: 'start_date must be before end_date' });
  }
  try {
    const result = await db.query(
      'INSERT INTO savings_goals (user_id, amount_limit, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, amount, start.toISOString(), end.toISOString()]
    );
    res.status(201).json({ ...result.rows[0], total_spent: 0, tx_count: 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/goals', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sg.*,
              GREATEST(0, -COALESCE(SUM(tl.amount), 0))::float AS total_spent,
              COUNT(tl.id)::int AS tx_count
       FROM savings_goals sg
       LEFT JOIN transaction_ledger tl ON tl.goal_id = sg.id
       WHERE sg.user_id = $1
       GROUP BY sg.id
       ORDER BY sg.id`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/goals', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM savings_goals WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All goals cleared successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete ONE goal. Its ledger rows, orders and rewards cascade automatically.
app.delete('/goals/:id', authenticateToken, async (req, res) => {
  const goalId = Number(req.params.id);
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goal id is required' });
  }
  try {
    const result = await db.query(
      'DELETE FROM savings_goals WHERE id = $1 AND user_id = $2 RETURNING id',
      [goalId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Goal not found or not yours' });
    res.json({ message: `Goal #${goalId} deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear the rewards earned on ONE goal (e.g. after finishing, start fresh
// without deleting the goal itself).
app.delete('/goals/:id/rewards', authenticateToken, async (req, res) => {
  const goalId = Number(req.params.id);
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goal id is required' });
  }
  try {
    const goalCheck = await db.query('SELECT id FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Goal not found or not yours' });
    const result = await db.query('DELETE FROM rewards WHERE goal_id = $1 AND user_id = $2', [goalId, req.user.id]);
    res.json({
      message: result.rowCount
        ? `Cleared ${result.rowCount} reward${result.rowCount === 1 ? '' : 's'} for goal #${goalId}.`
        : `No rewards to clear for goal #${goalId}.`,
      cleared: result.rowCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products', async (req, res) => {
  try {
    const category = req.query.category?.trim();
    if (category) {
      const result = await db.query(
        'SELECT * FROM products WHERE category = $1 ORDER BY id',
        [category]
      );
      return res.json(result.rows);
    }
    const result = await db.query('SELECT * FROM products ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products/categories', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT category, COUNT(*)::int AS count FROM products GROUP BY category ORDER BY category'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/shop/buy', authenticateToken, async (req, res) => {
  const productId = Number(req.body.productId);
  const goalId = Number(req.body.goalId);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: 'Valid productId is required' });
  }
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goalId is required' });
  }
  try {
    const goalCheck = await db.query('SELECT id FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Goal not found or not yours' });

    const productRes = await db.query('SELECT price, name FROM products WHERE id = $1', [productId]);
    if (productRes.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    
    const product = productRes.rows[0];
    const amount = -product.price;

    const result = await db.query(
      'INSERT INTO transaction_ledger (goal_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [goalId, amount, 'spend', `Bought ${product.name}`]
    );

    res.status(201).json({ message: `Bought ${product.name}!`, transaction: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/goals/:id/skip-time', authenticateToken, async (req, res) => {
  const goalId = Number(req.params.id);
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goal id is required' });
  }
  const { interval } = req.body;

  let days = 0;
  if (interval === 'day') days = 1;
  else if (interval === 'week') days = 7;
  else if (interval === 'month') days = 30;
  else return res.status(400).json({ error: 'Invalid interval. Use day, week or month.' });

  try {
    const goalCheck = await db.query('SELECT id, status FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Goal not found or not yours' });
    if (goalCheck.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'Goal is already completed — its timeline is frozen.' });
    }

    const expiry = await advanceClock(req.user.id, goalId, days);

    if (expiry.expired) {
      return res.json({
        message: 'Window closed — goal completed automatically!',
        expired: true,
        rewards: expiry.rewards,
        saver_score: expiry.saver_score,
        total_spent: expiry.total_spent,
      });
    }
    res.json({ message: `${interval} skipped successfully!`, expired: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Ledger & Reward Routes ---

app.post('/transactions', authenticateToken, async (req, res) => {
  const { goal_id, amount, transaction_type, description } = req.body;
  const goalId = Number(goal_id);
  const value = Number(amount);
  if (!Number.isInteger(goalId) || goalId <= 0) {
    return res.status(400).json({ error: 'Valid goal_id is required' });
  }
  if (!Number.isFinite(value)) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }
  if (!['spend', 'refund', 'adjustment'].includes(transaction_type)) {
    return res.status(400).json({ error: 'transaction_type must be spend, refund or adjustment' });
  }
  // Sign must match the type, otherwise net saver math silently misbehaves
  // (e.g. a positive "spend" would act as a refund).
  if (value === 0) {
    return res.status(400).json({ error: 'Amount must not be zero' });
  }
  if (transaction_type === 'spend' && value > 0) {
    return res.status(400).json({ error: 'Spend amounts must be negative' });
  }
  if (transaction_type === 'refund' && value < 0) {
    return res.status(400).json({ error: 'Refund amounts must be positive' });
  }
  try {
    const goalCheck = await db.query('SELECT id FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Goal not found or not yours' });
    const result = await db.query(
      'INSERT INTO transaction_ledger (goal_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [goalId, value, transaction_type, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/rewards', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM rewards WHERE user_id = $1 ORDER BY earned_at', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Circle & Leaderboard Routes ---

app.get('/circles', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pc.id, pc.circle_name, pc.created_at, pc.created_by,
              (pc.created_by = $1) AS is_creator,
              (SELECT COUNT(*)::int FROM circle_members cm2 WHERE cm2.circle_id = pc.id) AS member_count
       FROM peer_circles pc JOIN circle_members cm ON pc.id = cm.circle_id WHERE cm.user_id = $1 ORDER BY pc.id`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/circles', authenticateToken, async (req, res) => {
  const circle_name = req.body.circle_name?.trim();
  if (!circle_name) {
    return res.status(400).json({ error: 'Circle name is required' });
  }
  if (circle_name.length > 100) {
    return res.status(400).json({ error: 'Circle name is too long (max 100 characters)' });
  }
  try {
    const result = await db.query(
      'INSERT INTO peer_circles (circle_name, created_by) VALUES ($1, $2) RETURNING *',
      [circle_name, req.user.id]
    );
    const circle = result.rows[0];
    await db.query(
      'INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2)',
      [circle.id, req.user.id]
    );
    res.status(201).json(circle);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/circles/join', authenticateToken, async (req, res) => {
  const circle_id = Number(req.body.circle_id);
  if (!Number.isInteger(circle_id) || circle_id <= 0) {
    return res.status(400).json({ error: 'Valid circle_id is required' });
  }
  try {
    const circle = await db.query('SELECT id FROM peer_circles WHERE id = $1', [circle_id]);
    if (circle.rows.length === 0) return res.status(404).json({ error: 'Circle not found' });
    await db.query(
      'INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [circle_id, req.user.id]
    );
    res.json({ message: 'Joined circle successfully!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Leave a circle. If you were the last member the circle (and its
// invites) is removed; if you were the creator, creator passes to the
// longest-standing remaining member.
app.delete('/circles/:id/leave', authenticateToken, async (req, res) => {
  const circleId = Number(req.params.id);
  if (!Number.isInteger(circleId) || circleId <= 0) {
    return res.status(400).json({ error: 'Valid circle id is required' });
  }
  try {
    const del = await db.query(
      'DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2 RETURNING user_id',
      [circleId, req.user.id]
    );
    if (del.rows.length === 0) return res.status(404).json({ error: 'You are not a member of this circle' });

    const remaining = await db.query(
      'SELECT user_id FROM circle_members WHERE circle_id = $1 ORDER BY joined_at LIMIT 1',
      [circleId]
    );
    if (remaining.rows.length === 0) {
      await db.query('DELETE FROM peer_circles WHERE id = $1', [circleId]);
      return res.json({ message: 'Left circle. No members remained, so the circle was removed.' });
    }
    await db.query(
      'UPDATE peer_circles SET created_by = $1 WHERE id = $2 AND (created_by = $3 OR created_by IS NULL)',
      [remaining.rows[0].user_id, circleId, req.user.id]
    );
    res.json({ message: 'Left circle.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a whole circle (creator only). Members/invites cascade.
app.delete('/circles/:id', authenticateToken, async (req, res) => {
  const circleId = Number(req.params.id);
  if (!Number.isInteger(circleId) || circleId <= 0) {
    return res.status(400).json({ error: 'Valid circle id is required' });
  }
  try {
    const circle = await db.query('SELECT id, created_by FROM peer_circles WHERE id = $1', [circleId]);
    if (circle.rows.length === 0) return res.status(404).json({ error: 'Circle not found' });
    if (circle.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the circle creator can delete it. You can leave instead.' });
    }
    await db.query('DELETE FROM peer_circles WHERE id = $1', [circleId]);
    res.json({ message: 'Circle deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/leaderboard/:circleId', authenticateToken, async (req, res) => {
  const circleId = Number(req.params.circleId);
  if (!Number.isInteger(circleId) || circleId <= 0) {
    return res.status(400).json({ error: 'Valid circle id is required' });
  }
  try {
    const memberCheck = await db.query(
      'SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2',
      [circleId, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You must be a member of this circle' });
    }
    // Per-goal SAVER score first ((limit - spent)/limit*100, floored at 0),
    // then best per member. Members without goals appear last with null.
    const query = `
      SELECT u.username, ROUND(MAX(gs.saver_pct), 2) AS best_percentage
      FROM users u
      JOIN circle_members cm ON cm.user_id = u.id AND cm.circle_id = $1
      LEFT JOIN (
        SELECT sg.user_id,
               GREATEST(0, (sg.amount_limit + COALESCE(SUM(tl.amount), 0)) / NULLIF(sg.amount_limit, 0) * 100) AS saver_pct
        FROM savings_goals sg
        LEFT JOIN transaction_ledger tl ON tl.goal_id = sg.id
        GROUP BY sg.id, sg.user_id, sg.amount_limit
      ) gs ON gs.user_id = u.id
      GROUP BY u.id, u.username
      ORDER BY MAX(gs.saver_pct) DESC NULLS LAST;
    `;
    const result = await db.query(query, [circleId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Invite System ---

app.post('/circles/invite', authenticateToken, async (req, res) => {
  const circle_id = Number(req.body.circle_id);
  if (!Number.isInteger(circle_id) || circle_id <= 0) {
    return res.status(400).json({ error: 'Valid circle_id is required' });
  }
  try {
    const memberCheck = await db.query('SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circle_id, req.user.id]);
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'You must be a member to invite others' });

    const token = crypto.randomBytes(9).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.query(
      'INSERT INTO invites (circle_id, token, expires_at, invited_by) VALUES ($1, $2, $3, $4)',
      [circle_id, token, expiresAt, req.user.id]
    );
    res.json({ invite_token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/circles/join-invite', authenticateToken, async (req, res) => {
  const token = req.body.token?.trim();
  if (!token) {
    return res.status(400).json({ error: 'Invite token is required' });
  }
  try {
    const inviteRes = await db.query('SELECT circle_id FROM invites WHERE token = $1 AND expires_at > NOW()', [token]);
    if (inviteRes.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired invite token' });

    const circleId = inviteRes.rows[0].circle_id;
    await db.query(
      'INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [circleId, req.user.id]
    );
    // Multi-use token: stays valid for other friends until expiry.
    res.json({ message: 'Joined circle via invite!', circle_id: circleId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public invite-link preview for the /join/:token landing card.
// Minimal info only: anyone holding the link can see it.
app.get('/circles/invite/:token', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pc.id AS circle_id, pc.circle_name,
              (SELECT COUNT(*)::int FROM circle_members WHERE circle_id = pc.id) AS member_count,
              u.username AS inviter, i.expires_at
       FROM invites i
       JOIN peer_circles pc ON pc.id = i.circle_id
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.token = $1 AND i.expires_at > NOW()`,
      [req.params.token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
