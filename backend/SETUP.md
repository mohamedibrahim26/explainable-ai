# Orion AI Backend — Setup Guide

## Prerequisites

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- **PostgreSQL** v14 or later — [postgresql.org](https://www.postgresql.org/download/)

---

## 1. Install PostgreSQL & Create the Database

After installing PostgreSQL, open a terminal and run:

```bash
# Connect as the postgres superuser
psql -U postgres

# Inside psql, create the database and exit
CREATE DATABASE orionai;
\q
```

> On Windows you can also use **pgAdmin** — just create a database named `orionai`.

---

## 2. Configure Environment Variables

Copy the example file and fill it in:

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and set:

```
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/orionai"
JWT_SECRET="change-this-to-a-long-random-string"
JWT_REFRESH_SECRET="another-long-random-string-different-from-above"
PORT=3001
FRONTEND_URL=http://127.0.0.1:5500
```

> **Tips:**
> - Replace `YOUR_PASSWORD` with your PostgreSQL password.
> - Generate secrets with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

---

## 3. Install Dependencies

```bash
cd backend
npm install
```

---

## 4. Run Database Migrations

This creates the `User`, `Conversation`, and `Message` tables:

```bash
npm run db:migrate
```

When prompted for a migration name, type something like `init`.

---

## 5. Start the Backend

```bash
npm run dev
```

You should see:

```
✓ PostgreSQL connected
🌟 Orion AI Backend running at http://localhost:3001
```

Test it:

```bash
curl http://localhost:3001/health
# → {"status":"ok","service":"Orion AI Backend",...}
```

---

## 6. Start the Frontend

Open `AIChatClone/index.html` with Live Server (VS Code extension) on port 5500.

Then click **"Sign in to sync chats"** in the sidebar to create an account.

---

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm start` | Start without auto-reload |
| `npm run db:migrate` | Apply new migrations |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
| `npm run db:reset` | **⚠ Wipes all data** and re-migrates |
| `npm run db:generate` | Regenerate Prisma client after schema changes |

---

## 7. Enable Admin Dashboard

1. Open `backend/.env` and set your email in `ADMIN_EMAILS`:
   ```
   ADMIN_EMAILS=you@example.com
   ```
   Multiple admins: `ADMIN_EMAILS=alice@x.com,bob@x.com`

2. Sign in to Orion AI with that email — the **Admin Dashboard** link will appear in the sidebar.

3. Or navigate directly to `admin.html` — it handles login itself.

---

## Architecture Notes

- **Auth:** Email + password with bcrypt (cost 12). JWTs: 15-min access token + 30-day refresh token. Auto-refresh is handled client-side in `script.js`.
- **SSE streaming** still goes directly from browser → AI provider. The backend only stores auth + conversation history.
- **Guest mode:** Works without signing in — chats are stored in localStorage. Sign in to sync across devices.
