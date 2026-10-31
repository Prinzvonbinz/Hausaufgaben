CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  fach TEXT NOT NULL,
  datum TEXT NOT NULL,
  beschreibung TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_datum ON events(datum);
