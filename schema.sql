CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  fach TEXT NOT NULL,
  datum TEXT NOT NULL,
  beschreibung TEXT,
  created_at INTEGER,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  settings TEXT
);
CREATE INDEX idx_datum ON events(datum);
