-- Run this once against your Neon database, e.g.:
--   psql "$DATABASE_URL" -f migrations.sql

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  room_id TEXT,
  white_username TEXT,
  black_username TEXT,
  pgn TEXT,
  result TEXT, -- '1-0', '0-1', or '1/2-1/2'
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_owner ON games(owner_user_id);
