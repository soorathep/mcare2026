-- Feedback survey
CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, answers TEXT NOT NULL);
-- Poster judging (criteria are stored as JSON so they can change without a schema change)
CREATE TABLE IF NOT EXISTS judges (code TEXT PRIMARY KEY, name TEXT NOT NULL, boards TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scores (judge_code TEXT NOT NULL, board TEXT NOT NULL, scores TEXT NOT NULL, total INTEGER NOT NULL, comment TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (judge_code, board));
-- Student staff sign-up (one row per email; the form fields are stored as JSON)
CREATE TABLE IF NOT EXISTS staff (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
-- Survey gift codes (not linked to responses, so answers stay anonymous)
CREATE TABLE IF NOT EXISTS claims (code TEXT PRIMARY KEY, created_at TEXT NOT NULL, claimed_at TEXT);
-- Symposium organizer volunteers from the survey (stored apart from responses; date only, so rows cannot be matched to answers)
CREATE TABLE IF NOT EXISTS organizers (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, data TEXT NOT NULL);
