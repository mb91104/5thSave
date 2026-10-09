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
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
      [username, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
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
  const { productId, quantity = 1 } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
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
      'SELECT ci.*, p.name, p.price FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = $1',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/cart/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Item removed from cart' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/shop/checkout', authenticateToken, async (req, res) => {
  const { goalId } = req.body;
  if (!goalId) return res.status(400).json({ error: 'Goal ID is required for checkout' });

  try {
    // 1. Get cart items
    const cartRes = await db.query(
      'SELECT ci.id, ci.product_id, ci.quantity, p.price, p.name FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = $1',
      [req.user.id]
    );
    const items = cartRes.rows;
    if (items.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    let totalOrderAmount = 0;
    for (const item of items) {
      totalOrderAmount += item.price * item.quantity;
    }

    // 2. Create Order
    const orderRes = await db.query(
      'INSERT INTO orders (user_id, goal_id, total_amount) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, goalId, totalOrderAmount]
    );
    const orderId = orderRes.rows[0].id;

    // 3. Move items to order_items and add to transaction_ledger
    for (const item of items) {
      await db.query(
        'INSERT INTO order_items (order_id, product_id, price_at_purchase, quantity) VALUES ($1, $2, $3, $4)',
        [orderId, item.product_id, item.price, item.quantity]
      );

      await db.query(
        'INSERT INTO transaction_ledger (goal_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4)',
        [goalId, -(item.price * item.quantity), 'spend', `Bought ${item.name} x${item.quantity}`]
      );
    }

    // 4. Clear Cart
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);

    // 5. AUTOMATIC TIME SKIP (per requirement 3)
    // We increment start_date by 1 day per checkout as a progression marker
    await db.query(
      "UPDATE savings_goals SET start_date = start_date + (1 || ' days')::interval WHERE id = $1",
      [goalId]
    );

    // 6. Award rewards
    await checkAndAwardRewards(req.user.id, goalId);

    res.status(201).json({ 
      message: 'Checkout successful!', 
      orderId, 
      totalAmount: totalOrderAmount,
      receipt: items 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/goals/:id/end', authenticateToken, async (req, res) => {
  const goalId = req.params.id;
  try {
    const goalCheck = await db.query('SELECT id FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Unauthorized' });

    await db.query("UPDATE savings_goals SET status = 'completed' WHERE id = $1", [goalId]);
    res.json({ message: 'Goal ended successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Goal Routes ---


async function checkAndAwardRewards(userId, goalId) {
  try {
    const goalRes = await db.query('SELECT amount_limit FROM savings_goals WHERE id = $1', [goalId]);
    if (goalRes.rows.length === 0) return;
    const limit = parseFloat(goalRes.rows[0].amount_limit);

    const spendingRes = await db.query('SELECT SUM(amount) as total FROM transaction_ledger WHERE goal_id = $1', [goalId]);
    const totalBalance = parseFloat(spendingRes.rows[0].total || 0);
    
    const percentage = (totalBalance / limit) * 100;

    const rewardMap = {
      25: 'Flipkart Voucher',
      50: 'Amazon Giftcard',
      75: 'Makemytrip Voucher',
      100: 'Ultimate Saver Reward'
    };

    const checkpoints = [25, 50, 75, 100];
    for (const cp of checkpoints) {
      if (percentage >= cp) {
        const rewardCheck = await db.query(
          'SELECT id FROM rewards WHERE user_id = $1 AND goal_id = $2 AND checkpoint_percentage = $3',
          [userId, goalId, cp]
        );
        if (rewardCheck.rows.length === 0) {
          await db.query(
            'INSERT INTO rewards (user_id, goal_id, checkpoint_percentage, reward_item) VALUES ($1, $2, $3, $4)',
            [userId, goalId, cp, rewardMap[cp]]
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

app.delete('/goals', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM savings_goals WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All goals cleared successfully!' });
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

app.post('/goals/:id/skip-time', authenticateToken, async (req, res) => {
  const goalId = req.params.id;
  const { interval } = req.body; 
  
  let days = 0;
  if (interval === 'week') days = 7;
  else if (interval === 'month') days = 30;
  else return res.status(400).json({ error: 'Invalid interval. Use week or month.' });

  try {
    const goalCheck = await db.query('SELECT id, start_date FROM savings_goals WHERE id = $1 AND user_id = $2', [goalId, req.user.id]);
    if (goalCheck.rows.length === 0) return res.status(403).json({ error: 'Unauthorized' });

    await db.query(
      "UPDATE savings_goals SET start_date = start_date + ($1 || ' days')::interval WHERE id = $2",
      [days, goalId]
    );

    await checkAndAwardRewards(req.user.id, goalId);
    res.json({ message: `${interval} skipped successfully!` });
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

// --- Circle & Leaderboard Routes ---

app.get('/circles', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT pc.* FROM peer_circles pc JOIN circle_members cm ON pc.id = cm.circle_id WHERE cm.user_id = $1',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/circles', authenticateToken, async (req, res) => {
  const { circle_name } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO peer_circles (circle_name) VALUES ($1) RETURNING *',
      [circle_name]
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
  const { circle_id } = req.body;
  try {
    await db.query(
      'INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [circle_id, req.user.id]
    );
    res.json({ message: 'Joined circle successfully!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/leaderboard/:circleId', authenticateToken, async (req, res) => {
  const { circleId } = req.params;
  try {
    const query = `
      SELECT 
        u.username, 
        MAX((sg.amount_limit + COALESCE(SUM(tl.amount), 0)) / sg.amount_limit * 100) as best_percentage
      FROM users u
      JOIN circle_members cm ON u.id = cm.user_id
      JOIN savings_goals sg ON u.id = sg.user_id
      LEFT JOIN transaction_ledger tl ON sg.id = tl.goal_id
      WHERE cm.circle_id = $1
      GROUP BY u.id, u.username
      ORDER BY best_percentage DESC;
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
  const { circle_id } = req.body;
  try {
    const memberCheck = await db.query('SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circle_id, req.user.id]);
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'You must be a member to invite others' });

    const token = Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.query(
      'INSERT INTO invites (circle_id, token, expires_at) VALUES ($1, $2, $3)',
      [circle_id, token, expiresAt]
    );
    res.json({ invite_token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/circles/join-invite', authenticateToken, async (req, res) => {
  const { token } = req.body;
  try {
    const inviteRes = await db.query('SELECT circle_id FROM invites WHERE token = $1 AND expires_at > NOW()', [token]);
    if (inviteRes.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired invite token' });

    const circleId = inviteRes.rows[0].circle_id;
    await db.query(
      'INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [circleId, req.user.id]
    );
    await db.query('DELETE FROM invites WHERE token = $1', [token]);
    res.json({ message: 'Joined circle via invite!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
