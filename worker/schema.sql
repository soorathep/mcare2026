-- Feedback survey
CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, answers TEXT NOT NULL);
-- Poster judging (criteria are stored as JSON so they can change without a schema change)
CREATE TABLE IF NOT EXISTS judges (code TEXT PRIMARY KEY, name TEXT NOT NULL, boards TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scores (judge_code TEXT NOT NULL, board TEXT NOT NULL, scores TEXT NOT NULL, total INTEGER NOT NULL, comment TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (judge_code, board));
