# 5thSave

5thSave is a goal-oriented savings and budget tracking application designed to gamify the saving process. Users set financial limits for specific goals and are rewarded with virtual vouchers when they maintain a high savings percentage.

## 🚀 Core Features

- **Savings Goals**: Create personalized savings goals with defined limits and timeframes.
- **Shopping Simulation**: A built-in shop to simulate real-world spending. Every purchase is linked to a goal and tracked in a transaction ledger.
- **Gamified Rewards**: Automated reward system that grants vouchers (e.g., Flipkart, Amazon, Makemytrip) based on saving milestones (25%, 50%, 75%, 100%).
- **Social Circles**: Join peer circles to compare saving progress via leaderboards and invite friends using unique tokens.
- **Time Progression**: A "Time Skip" feature to simulate the passage of weeks or months to see how savings accumulate over time.

## 🛠 Tech Stack

- **Frontend**: React, Axios, Recharts (for budget visualization).
- **Backend**: Node.js, Express.js.
- **Database**: PostgreSQL.
- **Authentication**: JWT (JSON Web Tokens) and bcryptjs for secure password hashing.

## 📦 Getting Started

### 1. Install
```bash
npm install        # npm workspaces: installs backend + frontend
```

### 2. Database
```bash
createdb 5thsave
cp backend/.env.example backend/.env   # then edit DATABASE_URL + JWT_SECRET
npm run db:init                        # applies init.sql + the migration
```
`db:init` is safe to re-run; both SQL files use `IF NOT EXISTS` / upserts.

### 3. Backend
```bash
npm start          # http://localhost:3000
npm test           # backend smoke suite (port 3457, cleans up after itself)
```

### 4. Frontend
```bash
npm run dev        # http://localhost:5173
```
The frontend calls `/api`, which Vite proxies to `http://localhost:3000`. If the
backend uses another port, set `VITE_DEV_API_URL` in `frontend/.env` (see
`frontend/.env.example`).

## ▲ Deploying to Vercel

The repository is a single Vercel project:

- `frontend/dist` is served statically with an SPA fallback (`/join/:token` works on refresh).
- `api/index.js` runs the Express app as a single Vercel Function; `/api/*` is rewritten to it.
- `backend/index.js` exports the app and only binds a port when run directly.

### Steps

1. **Create a hosted PostgreSQL database** (Neon, Supabase, Vercel Postgres, etc.)
   and copy its **pooled** connection string. Serverless functions open many
   short-lived connections, so the pooler endpoint is strongly recommended.
2. **Apply the schema** from your machine:
   ```bash
   DATABASE_URL='postgres://...' npm run db:init
   ```
3. **Import the repo into Vercel.** `vercel.json` sets the install, build, and
   output settings automatically — no dashboard build overrides needed.
4. **Set environment variables** in Project → Settings → Environment Variables:
   | Variable | Required | Notes |
   | --- | --- | --- |
   | `DATABASE_URL` | yes | Hosted Postgres connection string (prefer the pooler). `POSTGRES_URL` also works. |
   | `JWT_SECRET` | yes | Long random value; changing it invalidates existing sessions |
   | `CORS_ORIGIN` | no | Only needed if the frontend is on another origin |
   | `DATABASE_SSL` | no | Set `true` only for a self-signed provider certificate |
   | `PG_POOL_MAX` | no | Pool size per function instance (default 5) |
5. **Deploy**, then check `https://<your-app>.vercel.app/api/health`. It should
   return `{"status":"ok","database":"up"}`.

### Verify locally before deploying

```bash
npm test             # API logic (40 checks)
npm run test:deploy  # production build + Vercel-style /api routing + SPA fallback
```

`test:deploy` builds the frontend, serves `frontend/dist` with the same SPA
fallback as Vercel, and routes `/api/*` through the actual Serverless Function
entry point.

### Notes

- Frontend API calls use the relative base `/api`, so no `VITE_API_URL` is
  needed on Vercel. Set it only for a split frontend/API deployment.
- Use the provider's pooled connection string (Neon `-pooler`, Supabase port
  `6543`, etc.) to avoid exhausting Postgres connections as functions scale.

## 📊 Database Schema
The project uses a relational structure to ensure transaction integrity:
- `users`: User profiles and credentials.
- `savings_goals`: Target limits and status.
- `transaction_ledger`: Append-only log of all spends and saves.
- `rewards`: Record of checkpoints reached and vouchers earned.
- `peer_circles` & `circle_members`: Social grouping and membership.
- `products` & `orders`: Catalog and purchase history for the shopping simulation.
