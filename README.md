# Softora - Backend

This folder contains the Node.js/Express backend API for the Softora application. It can be used as an independent repository when split from the monorepo.

Quick start

1. Copy `.env.example` to `.env` and configure the database and mail settings.
2. Install dependencies: `npm install`.
3. Start server: `npm run start` or in development `npm run dev` (requires nodemon).

Health check: GET /api/health

Notes

- The app expects a MySQL/MariaDB instance. The `database.js` module will attempt to create the configured database and tables on startup.
- A default admin user (admin@softora.com / admin123) is created automatically if missing.
