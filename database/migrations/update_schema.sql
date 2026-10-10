-- 5thSave follow-up schema (cart, orders, invites, catalog)
-- Safe to run multiple times (IF NOT EXISTS throughout).

-- 0. Product catalog (referenced by cart_items / order_items)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    price DECIMAL(12, 2) NOT NULL CHECK (price >= 0),
    category VARCHAR(50)
);

-- Seed catalog (only inserts missing names)
INSERT INTO products (name, price, category) VALUES
    ('Burger', 150, 'Food'),
    ('Pizza', 300, 'Food'),
    ('Biryani', 249, 'Food'),
    ('Dosa', 129, 'Food'),
    ('Filter Coffee', 99, 'Food'),
    ('T-Shirt', 500, 'Clothes'),
    ('Jeans', 1200, 'Clothes'),
    ('Kurta', 899, 'Clothes'),
    ('Hoodie', 1299, 'Clothes'),
    ('Shirt', 799, 'Clothes'),
    ('Earbuds', 1500, 'Electronics'),
    ('Powerbank', 2000, 'Electronics'),
    ('Keyboard', 2499, 'Electronics'),
    ('Mouse', 799, 'Electronics'),
    ('Speaker', 2999, 'Electronics'),
    ('Cap', 499, 'Accessories'),
    ('Sunglasses', 999, 'Accessories'),
    ('Backpack', 1499, 'Accessories'),
    ('Wallet', 699, 'Accessories'),
    ('Belt', 449, 'Accessories'),
    ('Watch', 2999, 'Accessories')
ON CONFLICT DO NOTHING;

-- 1. Cart Table (one row per user+product; upsert on conflict)
CREATE TABLE IF NOT EXISTS cart_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, product_id)
);

-- 2. Orders/Receipts Table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    goal_id INTEGER REFERENCES savings_goals(id) ON DELETE CASCADE,
    total_amount DECIMAL(12, 2) NOT NULL,
    order_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    price_at_purchase DECIMAL(12, 2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

-- 4. Circle invite tokens (multi-use until expiry)
CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    circle_id INTEGER REFERENCES peer_circles(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
-- Who shared the link (shown on the join landing card)
ALTER TABLE invites ADD COLUMN IF NOT EXISTS invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 5. Circle creator (who may delete the circle)
ALTER TABLE peer_circles ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
-- Legacy circles: earliest-joined member becomes creator
UPDATE peer_circles pc SET created_by = sub.uid FROM (
  SELECT DISTINCT ON (circle_id) circle_id, user_id AS uid
  FROM circle_members ORDER BY circle_id, joined_at
) sub WHERE sub.circle_id = pc.id AND pc.created_by IS NULL;
