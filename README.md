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

### Backend
1. Navigate to the backend directory: `cd backend`
2. Install dependencies: `npm install`
3. Configure your `.env` file with `DATABASE_URL` and `JWT_SECRET`.
4. Start the server: `npm start` (Runs on port 3000).

### Frontend
1. Navigate to the frontend directory: `cd frontend`
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev`

## 📊 Database Schema
The project uses a relational structure to ensure transaction integrity:
- `users`: User profiles and credentials.
- `savings_goals`: Target limits and status.
- `transaction_ledger`: Append-only log of all spends and saves.
- `rewards`: Record of checkpoints reached and vouchers earned.
- `peer_circles` & `circle_members`: Social grouping and membership.
- `products` & `orders`: Catalog and purchase history for the shopping simulation.
