use crate::error::{AppError, AppResult};
use crate::models::{
    now_rfc3339, parse_timestamp, AssistantMode, DailyReflection, EventLogEntry, Interaction,
    Memory, NewAssistantMode, NewInteraction, NewMemory, NewScheduledItem, NewStatusReport,
    NewUserAlias, PetState, ScheduledItem, ScheduledItemError, ScheduledItemKind,
    ScheduledItemStatus, ScheduledRecurrence, Skill, StatusReport, UpdateScheduledItem, UserAlias,
};
use chrono::{Datelike, NaiveDate, TimeZone, Timelike, Utc};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS developer_events (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS pocket (id TEXT PRIMARY KEY, item_json TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS pet_state (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mood TEXT NOT NULL,
    hunger INTEGER NOT NULL,
    energy INTEGER NOT NULL,
    affection INTEGER NOT NULL,
    boredom INTEGER NOT NULL,
    curiosity INTEGER NOT NULL,
    stress INTEGER NOT NULL,
    trust INTEGER NOT NULL,
    relationship_level INTEGER NOT NULL,
    current_animation TEXT,
    current_intent TEXT,
    last_interaction_at TEXT,
    last_llm_call_at TEXT,
    last_report_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.7,
    source_interaction_id TEXT,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT,
    decay_score REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content='memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_input TEXT,
    pet_response TEXT,
    mood TEXT,
    state_snapshot_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON interactions(created_at DESC);

CREATE TABLE IF NOT EXISTS daily_reflections (
    id TEXT PRIMARY KEY,
    reflection_date TEXT NOT NULL,
    learned TEXT,
    noticed TEXT,
    wants TEXT,
    raw_text TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(reflection_date)
);

-- 12-hour idle-triggered status reports (PRD §9.8, REQ-070..076).
-- Replaces the daily-cadence model; daily_reflections kept above for
-- backwards compatibility with existing user databases.
CREATE TABLE IF NOT EXISTS status_reports (
    id TEXT PRIMARY KEY,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    learned TEXT,
    noticed TEXT,
    wants TEXT,
    prose TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_reports_created_at ON status_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('reminder', 'alarm', 'important_date')),
    title TEXT NOT NULL,
    message TEXT,
    scheduled_at TEXT NOT NULL,
    timezone TEXT,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'triggered', 'dismissed', 'cancelled')),
    recurrence TEXT CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'yearly')),
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    triggered_at TEXT,
    dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_items_pending_at
    ON scheduled_items(status, scheduled_at);

CREATE TABLE IF NOT EXISTS user_aliases (
    id TEXT PRIMARY KEY,
    phrase TEXT NOT NULL,
    normalized_phrase TEXT NOT NULL UNIQUE,
    target_type TEXT NOT NULL CHECK (target_type IN ('website', 'application', 'mode')),
    target TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_modes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    actions_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    permissions_json TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    salience INTEGER,
    handled INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

const SCHEDULED_ITEM_SELECT_WITH_WHERE: &str =
    "SELECT id, kind, title, message, scheduled_at, timezone, status, recurrence,
            metadata_json, created_at, updated_at, triggered_at, dismissed_at
     FROM scheduled_items WHERE id = ?1";

fn scheduled_db_error(error: impl std::fmt::Display) -> ScheduledItemError {
    ScheduledItemError::new("database_error", error.to_string())
}

fn next_yearly_occurrence(scheduled_at: &str, timezone: Option<&str>, now: &str) -> Option<String> {
    let previous = parse_timestamp(scheduled_at)?;
    let now = parse_timestamp(now)?;
    let timezone = timezone
        .unwrap_or("UTC")
        .parse::<chrono_tz::Tz>()
        .ok()?;
    let local_previous = previous.with_timezone(&timezone);
    let mut year = local_previous.year().checked_add(1)?;
    loop {
        let (next_year, next_month) = if local_previous.month() == 12 {
            (year.checked_add(1)?, 1)
        } else {
            (year, local_previous.month() + 1)
        };
        let last_day = NaiveDate::from_ymd_opt(next_year, next_month, 1)?
            .pred_opt()?
            .day();
        let day = local_previous.day().min(last_day);
        let date = NaiveDate::from_ymd_opt(year, local_previous.month(), day)?;
        let local_time = date.and_hms_nano_opt(
            local_previous.hour(),
            local_previous.minute(),
            local_previous.second(),
            local_previous.nanosecond(),
        )?;
        let next = resolve_local_occurrence(timezone, local_time)?;
        if next > now {
            return Some(next.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        }
        year = year.checked_add(1)?;
    }
}

fn resolve_local_occurrence(
    timezone: chrono_tz::Tz,
    local_time: chrono::NaiveDateTime,
) -> Option<chrono::DateTime<Utc>> {
    for minute in 0..=180 {
        let candidate = local_time.checked_add_signed(chrono::Duration::minutes(minute))?;
        match timezone.from_local_datetime(&candidate) {
            chrono::LocalResult::Single(value) => return Some(value.with_timezone(&Utc)),
            chrono::LocalResult::Ambiguous(first, second) => {
                return Some(first.min(second).with_timezone(&Utc));
            }
            chrono::LocalResult::None => {}
        }
    }
    None
}

fn serialize_metadata(
    metadata: &Option<serde_json::Value>,
) -> Result<Option<String>, ScheduledItemError> {
    metadata
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| ScheduledItemError::new("invalid_metadata", error.to_string()))
}

fn item_state_error(conn: &Connection, id: &str, operation: &str) -> ScheduledItemError {
    match conn
        .query_row(
            "SELECT status FROM scheduled_items WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
    {
        Ok(None) => ScheduledItemError::new(
            "item_not_found",
            format!("Scheduled item {id} was not found"),
        ),
        Ok(Some(status)) => ScheduledItemError::new(
            "invalid_item_state",
            format!("Cannot {operation} scheduled item {id} while it is {status}"),
        ),
        Err(error) => scheduled_db_error(error),
    }
}

fn parse_scheduled_kind(value: &str) -> Option<ScheduledItemKind> {
    match value {
        "reminder" => Some(ScheduledItemKind::Reminder),
        "alarm" => Some(ScheduledItemKind::Alarm),
        "important_date" => Some(ScheduledItemKind::ImportantDate),
        _ => None,
    }
}

fn parse_scheduled_status(value: &str) -> Option<ScheduledItemStatus> {
    match value {
        "scheduled" => Some(ScheduledItemStatus::Scheduled),
        "triggered" => Some(ScheduledItemStatus::Triggered),
        "dismissed" => Some(ScheduledItemStatus::Dismissed),
        "cancelled" => Some(ScheduledItemStatus::Cancelled),
        _ => None,
    }
}

fn parse_scheduled_recurrence(value: &str) -> Option<ScheduledRecurrence> {
    match value {
        "daily" => Some(ScheduledRecurrence::Daily),
        "weekly" => Some(ScheduledRecurrence::Weekly),
        "monthly" => Some(ScheduledRecurrence::Monthly),
        "yearly" => Some(ScheduledRecurrence::Yearly),
        _ => None,
    }
}

fn map_scheduled_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduledItem> {
    let kind_text: String = row.get(1)?;
    let status_text: String = row.get(6)?;
    let recurrence_text: Option<String> = row.get(7)?;
    let metadata_json: Option<String> = row.get(8)?;
    let kind = parse_scheduled_kind(&kind_text).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            format!("unknown scheduled item kind {kind_text}").into(),
        )
    })?;
    let status = parse_scheduled_status(&status_text).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            format!("unknown scheduled item status {status_text}").into(),
        )
    })?;
    let recurrence = recurrence_text
        .as_deref()
        .map(|value| {
            parse_scheduled_recurrence(value).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    7,
                    rusqlite::types::Type::Text,
                    format!("unknown scheduled item recurrence {value}").into(),
                )
            })
        })
        .transpose()?;
    let metadata = metadata_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, error.into())
        })?;

    Ok(ScheduledItem {
        id: row.get(0)?,
        kind,
        title: row.get(2)?,
        message: row.get(3)?,
        scheduled_at: row.get(4)?,
        timezone: row.get(5)?,
        status,
        recurrence,
        metadata,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        triggered_at: row.get(11)?,
        dismissed_at: row.get(12)?,
    })
}

fn normalize_alias_phrase(phrase: &str) -> String {
    phrase.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn map_assistant_mode(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssistantMode> {
    let actions_json: String = row.get(2)?;
    let actions = serde_json::from_str(&actions_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            error.into(),
        )
    })?;
    Ok(AssistantMode {
        id: row.get(0)?,
        name: row.get(1)?,
        actions,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

impl Db {
    pub fn claim_developer_event(&self,id:&str)->AppResult<bool> {
        Ok(self.conn.lock().execute("INSERT OR IGNORE INTO developer_events(id) VALUES (?1)",[id])? == 1)
    }

    pub fn save_pocket_item(&self, item: &crate::commands::PocketItem) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("INSERT INTO pocket(id,item_json) VALUES (?1,?2)", params![item.id,serde_json::to_string(item)?])?;
        Ok(())
    }
    pub fn get_pocket_item(&self, id: &str) -> AppResult<crate::commands::PocketItem> {
        let raw: Option<String> = self.conn.lock().query_row("SELECT item_json FROM pocket WHERE id=?1",[id],|r|r.get(0)).optional()?;
        Ok(serde_json::from_str(&raw.ok_or_else(||AppError::NotFound("Pocket item".into()))?)?)
    }
    pub fn list_pocket_items(&self) -> AppResult<Vec<crate::commands::PocketItem>> {
        let conn=self.conn.lock(); let mut q=conn.prepare("SELECT item_json FROM pocket ORDER BY rowid DESC LIMIT 100")?;
        let rows=q.query_map([],|r|r.get::<_,String>(0))?;
        let mut items=Vec::new(); for row in rows { let mut item:crate::commands::PocketItem=serde_json::from_str(&row?)?; item.content.clear(); items.push(item); } Ok(items)
    }
    pub fn delete_pocket_item(&self,id:&str)->AppResult<()> {self.conn.lock().execute("DELETE FROM pocket WHERE id=?1",[id])?;Ok(())}

    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA_SQL)?;
        ensure_pet_state_has_last_report_at(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA_SQL)?;
        ensure_pet_state_has_last_report_at(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Run a synchronous DB closure on tokio's blocking pool so async tauri
    /// commands don't stall a runtime worker while holding the rusqlite mutex.
    /// The mutex guard is never held across an `.await` because the closure
    /// itself is sync.
    pub async fn run<F, R>(self: Arc<Self>, f: F) -> AppResult<R>
    where
        F: FnOnce(&Db) -> AppResult<R> + Send + 'static,
        R: Send + 'static,
    {
        tokio::task::spawn_blocking(move || f(&self))
            .await
            .map_err(|e| AppError::Internal(format!("db join: {e}")))?
    }

    // ------- Pet state -------
    pub fn save_pet_state(&self, state: &PetState) -> AppResult<()> {
        let conn = self.conn.lock();
        // REQ-102 — `last_report_at` is monotonic. The pet window's debounced
        // save can carry a watermark that predates a report just written by
        // `run_status_report` (e.g. triggered from the settings window); a
        // blind overwrite would re-open the 12h cadence and duplicate reports.
        // Keep whichever timestamp is newer; a present-but-unparseable side
        // loses to a parseable one.
        let existing_report_at: Option<String> = conn
            .query_row(
                "SELECT last_report_at FROM pet_state WHERE id = ?1",
                params![state.id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        let last_report_at =
            merge_last_report_at(existing_report_at, state.last_report_at.clone());
        conn.execute(
            "INSERT INTO pet_state (id, name, mood, hunger, energy, affection, boredom, curiosity, stress, trust, relationship_level, current_animation, current_intent, last_interaction_at, last_llm_call_at, last_report_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                mood=excluded.mood,
                hunger=excluded.hunger,
                energy=excluded.energy,
                affection=excluded.affection,
                boredom=excluded.boredom,
                curiosity=excluded.curiosity,
                stress=excluded.stress,
                trust=excluded.trust,
                relationship_level=excluded.relationship_level,
                current_animation=excluded.current_animation,
                current_intent=excluded.current_intent,
                last_interaction_at=excluded.last_interaction_at,
                last_llm_call_at=excluded.last_llm_call_at,
                last_report_at=excluded.last_report_at,
                updated_at=excluded.updated_at",
            params![
                state.id,
                state.name,
                state.mood,
                state.hunger,
                state.energy,
                state.affection,
                state.boredom,
                state.curiosity,
                state.stress,
                state.trust,
                state.relationship_level,
                state.current_animation,
                state.current_intent,
                state.last_interaction_at,
                state.last_llm_call_at,
                last_report_at,
                state.created_at,
                state.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn load_pet_state(&self, id: &str) -> AppResult<Option<PetState>> {
        let conn = self.conn.lock();
        let res = conn
            .query_row(
                "SELECT id, name, mood, hunger, energy, affection, boredom, curiosity, stress, trust, relationship_level, current_animation, current_intent, last_interaction_at, last_llm_call_at, last_report_at, created_at, updated_at
                 FROM pet_state WHERE id = ?1",
                params![id],
                |row| {
                    Ok(PetState {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        mood: row.get(2)?,
                        hunger: row.get(3)?,
                        energy: row.get(4)?,
                        affection: row.get(5)?,
                        boredom: row.get(6)?,
                        curiosity: row.get(7)?,
                        stress: row.get(8)?,
                        trust: row.get(9)?,
                        relationship_level: row.get(10)?,
                        current_animation: row.get(11)?,
                        current_intent: row.get(12)?,
                        last_interaction_at: row.get(13)?,
                        last_llm_call_at: row.get(14)?,
                        last_report_at: row.get(15)?,
                        created_at: row.get(16)?,
                        updated_at: row.get(17)?,
                    })
                },
            )
            .optional()?;
        Ok(res)
    }

    // ------- Memories -------
    pub fn create_memory(&self, mem: NewMemory) -> AppResult<Memory> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let importance = mem.importance.unwrap_or(1);
        let confidence = mem.confidence.unwrap_or(0.7);
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO memories (id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                mem.r#type,
                mem.content,
                importance,
                confidence,
                mem.source_interaction_id,
                now,
                now,
                1.0_f32,
            ],
        )?;
        Ok(Memory {
            id,
            r#type: mem.r#type,
            content: mem.content,
            importance,
            confidence,
            source_interaction_id: mem.source_interaction_id,
            created_at: now.clone(),
            last_accessed_at: Some(now),
            decay_score: 1.0,
        })
    }

    pub fn delete_memory(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_memories(&self, limit: i64) -> AppResult<Vec<Memory>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score
             FROM memories ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], map_memory)?;
        Ok(collect_tolerant(iter, "memories"))
    }

    /// Retrieve relevant memories blending FTS text relevance with recency and importance.
    /// Score = importance * 0.4 + recency * 0.3 + relevance * 0.3.
    pub fn search_memories(&self, query: &str, limit: i64) -> AppResult<Vec<Memory>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.list_memories(limit);
        }
        let conn = self.conn.lock();
        let now = Utc::now();
        let fts_query = sanitize_fts_query(trimmed);
        let mut stmt = conn.prepare(
            "SELECT m.id, m.type, m.content, m.importance, m.confidence, m.source_interaction_id, m.created_at, m.last_accessed_at, m.decay_score
             FROM memories m
             JOIN memories_fts f ON f.rowid = m.rowid
             WHERE memories_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let iter = stmt.query_map(params![fts_query, limit * 2], map_memory)?;
        let mut rows = collect_tolerant(iter, "memories");

        // If FTS yields nothing, fall back to LIKE on content for partial matches.
        if rows.is_empty() {
            let like = format!("%{}%", trimmed);
            let mut alt = conn.prepare(
                "SELECT id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score
                 FROM memories WHERE content LIKE ?1 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let alt_iter = alt.query_map(params![like, limit], map_memory)?;
            rows = collect_tolerant(alt_iter, "memories");
        }

        rows.sort_by(|a, b| {
            let sa = scored(a, now);
            let sb = scored(b, now);
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
        });
        rows.truncate(limit as usize);
        Ok(rows)
    }

    pub fn touch_memory_access(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE memories SET last_accessed_at = ?1 WHERE id = ?2",
            params![now_rfc3339(), id],
        )?;
        Ok(())
    }

    // ------- Interactions -------
    pub fn create_interaction(&self, ix: NewInteraction) -> AppResult<Interaction> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO interactions (id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                ix.event_type,
                ix.user_input,
                ix.pet_response,
                ix.mood,
                ix.state_snapshot_json,
                now,
            ],
        )?;
        Ok(Interaction {
            id,
            event_type: ix.event_type,
            user_input: ix.user_input,
            pet_response: ix.pet_response,
            mood: ix.mood,
            state_snapshot_json: ix.state_snapshot_json,
            created_at: now,
        })
    }

    pub fn recent_interactions(&self, limit: i64) -> AppResult<Vec<Interaction>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at
             FROM interactions ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], map_interaction)?;
        Ok(collect_tolerant(iter, "interactions"))
    }

    /// Event log entries whose `created_at` is in the [start, end] range.
    /// Used by §9.8 status report aggregation; `limit` should be generous since
    /// 12h of events is typically small (< 200 entries on a typical day).
    pub fn events_between(&self, start: &str, end: &str, limit: i64) -> AppResult<Vec<EventLogEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, payload_json, salience, handled, created_at
             FROM event_log
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at DESC LIMIT ?3",
        )?;
        let iter = stmt.query_map(params![start, end, limit], |row| {
            Ok(EventLogEntry {
                id: row.get(0)?,
                event_type: row.get(1)?,
                payload_json: row.get(2)?,
                salience: row.get(3)?,
                handled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;
        Ok(collect_tolerant(iter, "event_log"))
    }

    /// Interactions whose `created_at` is between `start` and `end` (inclusive).
    /// Both bounds are RFC3339 strings; sortable as text since RFC3339 with the
    /// same timezone is lexicographically ordered.
    pub fn interactions_between(&self, start: &str, end: &str, limit: i64) -> AppResult<Vec<Interaction>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at
             FROM interactions
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at DESC LIMIT ?3",
        )?;
        let iter = stmt.query_map(params![start, end, limit], map_interaction)?;
        Ok(collect_tolerant(iter, "interactions"))
    }

    // ------- Daily reflections -------
    pub fn save_reflection(&self, r: &DailyReflection) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO daily_reflections (id, reflection_date, learned, noticed, wants, raw_text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(reflection_date) DO UPDATE SET
                learned=excluded.learned,
                noticed=excluded.noticed,
                wants=excluded.wants,
                raw_text=excluded.raw_text",
            params![r.id, r.reflection_date, r.learned, r.noticed, r.wants, r.raw_text, r.created_at],
        )?;
        Ok(())
    }

    pub fn last_reflection(&self) -> AppResult<Option<DailyReflection>> {
        let conn = self.conn.lock();
        let r = conn
            .query_row(
                "SELECT id, reflection_date, learned, noticed, wants, raw_text, created_at
                 FROM daily_reflections ORDER BY reflection_date DESC LIMIT 1",
                [],
                |row| {
                    Ok(DailyReflection {
                        id: row.get(0)?,
                        reflection_date: row.get(1)?,
                        learned: row.get(2)?,
                        noticed: row.get(3)?,
                        wants: row.get(4)?,
                        raw_text: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(r)
    }

    // ------- Status reports (idle-triggered, PRD §9.8) -------
    pub fn save_status_report(&self, r: NewStatusReport) -> AppResult<StatusReport> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO status_reports (id, window_start, window_end, learned, noticed, wants, prose, file_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                r.window_start,
                r.window_end,
                r.learned,
                r.noticed,
                r.wants,
                r.prose,
                r.file_path,
                now,
            ],
        )?;
        Ok(StatusReport {
            id,
            window_start: r.window_start,
            window_end: r.window_end,
            learned: r.learned,
            noticed: r.noticed,
            wants: r.wants,
            prose: r.prose,
            file_path: r.file_path,
            created_at: now,
        })
    }

    pub fn list_status_reports(&self, limit: i64) -> AppResult<Vec<StatusReport>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, window_start, window_end, learned, noticed, wants, prose, file_path, created_at
             FROM status_reports ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], map_status_report)?;
        Ok(collect_tolerant(iter, "status_reports"))
    }

    pub fn last_status_report(&self) -> AppResult<Option<StatusReport>> {
        let conn = self.conn.lock();
        let r = conn
            .query_row(
                "SELECT id, window_start, window_end, learned, noticed, wants, prose, file_path, created_at
                 FROM status_reports ORDER BY created_at DESC LIMIT 1",
                [],
                map_status_report,
            )
            .optional()?;
        Ok(r)
    }

    // ------- Durable scheduled items -------
    pub fn create_scheduled_item(
        &self,
        item: NewScheduledItem,
    ) -> Result<ScheduledItem, ScheduledItemError> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let metadata_json = serialize_metadata(&item.metadata)?;
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO scheduled_items
             (id, kind, title, message, scheduled_at, timezone, status, recurrence,
              metadata_json, created_at, updated_at, triggered_at, dismissed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'scheduled', ?7, ?8, ?9, ?9, NULL, NULL)",
            params![
                id,
                item.kind.as_str(),
                item.title,
                item.message,
                item.scheduled_at,
                item.timezone,
                item.recurrence.map(ScheduledRecurrence::as_str),
                metadata_json,
                now,
            ],
        )
        .map_err(scheduled_db_error)?;
        Ok(ScheduledItem {
            id,
            kind: item.kind,
            title: item.title,
            message: item.message,
            scheduled_at: item.scheduled_at,
            timezone: item.timezone,
            status: ScheduledItemStatus::Scheduled,
            recurrence: item.recurrence,
            metadata: item.metadata,
            created_at: now.clone(),
            updated_at: now,
            triggered_at: None,
            dismissed_at: None,
        })
    }

    pub fn get_scheduled_item(
        &self,
        id: &str,
    ) -> Result<Option<ScheduledItem>, ScheduledItemError> {
        let conn = self.conn.lock();
        conn.query_row(
            SCHEDULED_ITEM_SELECT_WITH_WHERE,
            params![id],
            map_scheduled_item,
        )
        .optional()
        .map_err(scheduled_db_error)
    }

    pub fn list_scheduled_items(
        &self,
        kind: Option<ScheduledItemKind>,
    ) -> Result<Vec<ScheduledItem>, ScheduledItemError> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, title, message, scheduled_at, timezone, status, recurrence,
                        metadata_json, created_at, updated_at, triggered_at, dismissed_at
                 FROM scheduled_items
                 WHERE (?1 IS NULL OR kind = ?1)
                 ORDER BY scheduled_at ASC, created_at ASC",
            )
            .map_err(scheduled_db_error)?;
        let iter = stmt
            .query_map(
                params![kind.map(ScheduledItemKind::as_str)],
                map_scheduled_item,
            )
            .map_err(scheduled_db_error)?;
        iter.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(scheduled_db_error)
    }

    pub fn update_scheduled_item(
        &self,
        id: &str,
        item: UpdateScheduledItem,
    ) -> Result<ScheduledItem, ScheduledItemError> {
        let metadata_json = serialize_metadata(&item.metadata)?;
        let now = now_rfc3339();
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE scheduled_items
                 SET title = ?2, message = ?3, scheduled_at = ?4, timezone = ?5,
                     recurrence = ?6, metadata_json = ?7, updated_at = ?8
                 WHERE id = ?1 AND status = 'scheduled'",
                params![
                    id,
                    item.title,
                    item.message,
                    item.scheduled_at,
                    item.timezone,
                    item.recurrence.map(ScheduledRecurrence::as_str),
                    metadata_json,
                    now,
                ],
            )
            .map_err(scheduled_db_error)?;
        if changed == 0 {
            return Err(item_state_error(&conn, id, "update"));
        }
        conn.query_row(
            SCHEDULED_ITEM_SELECT_WITH_WHERE,
            params![id],
            map_scheduled_item,
        )
        .map_err(scheduled_db_error)
    }

    pub fn cancel_scheduled_item(&self, id: &str) -> Result<ScheduledItem, ScheduledItemError> {
        self.transition_scheduled_item(id, "cancelled", None, "cancel")
    }

    pub fn dismiss_scheduled_item(&self, id: &str) -> Result<ScheduledItem, ScheduledItemError> {
        self.transition_scheduled_item(id, "dismissed", Some(now_rfc3339()), "dismiss")
    }

    pub fn claim_due_scheduled_items(
        &self,
        now: &str,
    ) -> Result<Vec<ScheduledItem>, ScheduledItemError> {
        let mut conn = self.conn.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(scheduled_db_error)?;
        let due_ids = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM scheduled_items
                     WHERE status = 'scheduled' AND scheduled_at <= ?1
                     ORDER BY scheduled_at ASC, created_at ASC",
                )
                .map_err(scheduled_db_error)?;
            let ids = stmt
                .query_map(params![now], |row| row.get::<_, String>(0))
                .map_err(scheduled_db_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(scheduled_db_error)?;
            ids
        };

        let mut claimed = Vec::with_capacity(due_ids.len());
        for id in due_ids {
            let due_item = tx
                .query_row(
                    SCHEDULED_ITEM_SELECT_WITH_WHERE,
                    params![id],
                    map_scheduled_item,
                )
                .map_err(scheduled_db_error)?;
            if due_item.kind == ScheduledItemKind::ImportantDate
                && due_item.recurrence == Some(ScheduledRecurrence::Yearly)
            {
                let next_at = next_yearly_occurrence(
                    &due_item.scheduled_at,
                    due_item.timezone.as_deref(),
                    now,
                ).ok_or_else(|| {
                    ScheduledItemError::new(
                        "recurrence_error",
                        "Could not calculate the next yearly occurrence",
                    )
                })?;
                let changed = tx
                    .execute(
                        "UPDATE scheduled_items
                         SET scheduled_at = ?2, status = 'scheduled', triggered_at = NULL, updated_at = ?3
                         WHERE id = ?1 AND status = 'scheduled' AND scheduled_at <= ?3",
                        params![id, next_at, now],
                    )
                    .map_err(scheduled_db_error)?;
                if changed == 1 {
                    let mut occurrence = due_item;
                    occurrence.status = ScheduledItemStatus::Triggered;
                    occurrence.triggered_at = Some(now.to_string());
                    occurrence.updated_at = now.to_string();
                    claimed.push(occurrence);
                }
                continue;
            }
            let changed = tx
                .execute(
                    "UPDATE scheduled_items
                     SET status = 'triggered', triggered_at = ?2, updated_at = ?2
                     WHERE id = ?1 AND status = 'scheduled' AND scheduled_at <= ?2",
                    params![id, now],
                )
                .map_err(scheduled_db_error)?;
            if changed == 1 {
                claimed.push(
                    tx.query_row(
                        SCHEDULED_ITEM_SELECT_WITH_WHERE,
                        params![id],
                        map_scheduled_item,
                    )
                    .map_err(scheduled_db_error)?,
                );
            }
        }
        tx.commit().map_err(scheduled_db_error)?;
        Ok(claimed)
    }

    fn transition_scheduled_item(
        &self,
        id: &str,
        status: &str,
        dismissed_at: Option<String>,
        operation: &str,
    ) -> Result<ScheduledItem, ScheduledItemError> {
        let now = now_rfc3339();
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE scheduled_items
                 SET status = ?2, dismissed_at = ?3, updated_at = ?4
                 WHERE id = ?1 AND status = ?5",
                params![
                    id,
                    status,
                    dismissed_at,
                    now,
                    if status == "cancelled" {
                        "scheduled"
                    } else {
                        "triggered"
                    }
                ],
            )
            .map_err(scheduled_db_error)?;
        if changed == 0 {
            return Err(item_state_error(&conn, id, operation));
        }
        conn.query_row(
            SCHEDULED_ITEM_SELECT_WITH_WHERE,
            params![id],
            map_scheduled_item,
        )
        .map_err(scheduled_db_error)
    }

    // ------- User aliases and assistant modes -------
    pub fn create_user_alias(&self, alias: NewUserAlias) -> AppResult<UserAlias> {
        let conn = self.conn.lock();
        let id = Uuid::new_v4().to_string();
        let normalized_phrase = normalize_alias_phrase(&alias.phrase);
        let now = now_rfc3339();
        conn.execute(
            "INSERT INTO user_aliases
             (id, phrase, normalized_phrase, target_type, target, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, alias.phrase, normalized_phrase, alias.target_type, alias.target, now],
        )?;
        Ok(UserAlias {
            id,
            phrase: alias.phrase,
            normalized_phrase,
            target_type: alias.target_type,
            target: alias.target,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_user_aliases(&self) -> AppResult<Vec<UserAlias>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, phrase, normalized_phrase, target_type, target, created_at, updated_at
             FROM user_aliases ORDER BY normalized_phrase",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(UserAlias {
                id: row.get(0)?,
                phrase: row.get(1)?,
                normalized_phrase: row.get(2)?,
                target_type: row.get(3)?,
                target: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_user_alias(&self, id: &str, alias: NewUserAlias) -> AppResult<UserAlias> {
        let conn = self.conn.lock();
        let normalized_phrase = normalize_alias_phrase(&alias.phrase);
        let now = now_rfc3339();
        let changed = conn.execute(
            "UPDATE user_aliases
             SET phrase = ?2, normalized_phrase = ?3, target_type = ?4, target = ?5, updated_at = ?6
             WHERE id = ?1",
            params![id, alias.phrase, normalized_phrase, alias.target_type, alias.target, now],
        )?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound("alias".into()));
        }
        let created_at = conn.query_row(
            "SELECT created_at FROM user_aliases WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(UserAlias {
            id: id.to_string(),
            phrase: alias.phrase,
            normalized_phrase,
            target_type: alias.target_type,
            target: alias.target,
            created_at,
            updated_at: now,
        })
    }

    pub fn delete_user_alias(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        let changed = conn.execute("DELETE FROM user_aliases WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound("alias".into()));
        }
        Ok(())
    }

    pub fn create_assistant_mode(&self, mode: NewAssistantMode) -> AppResult<AssistantMode> {
        let conn = self.conn.lock();
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let actions_json = serde_json::to_string(&mode.actions)?;
        conn.execute(
            "INSERT INTO assistant_modes (id, name, actions_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, mode.name, actions_json, now],
        )?;
        Ok(AssistantMode {
            id,
            name: mode.name,
            actions: mode.actions,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_assistant_modes(&self) -> AppResult<Vec<AssistantMode>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, actions_json, created_at, updated_at
             FROM assistant_modes ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], map_assistant_mode)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_assistant_mode(&self, id: &str, mode: NewAssistantMode) -> AppResult<AssistantMode> {
        let conn = self.conn.lock();
        let now = now_rfc3339();
        let actions_json = serde_json::to_string(&mode.actions)?;
        let changed = conn.execute(
            "UPDATE assistant_modes SET name = ?2, actions_json = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, mode.name, actions_json, now],
        )?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound("mode".into()));
        }
        let created_at = conn.query_row(
            "SELECT created_at FROM assistant_modes WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(AssistantMode {
            id: id.to_string(),
            name: mode.name,
            actions: mode.actions,
            created_at,
            updated_at: now,
        })
    }

    pub fn delete_assistant_mode(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        let changed = conn.execute("DELETE FROM assistant_modes WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(crate::error::AppError::NotFound("mode".into()));
        }
        Ok(())
    }

    // ------- Event log -------
    pub fn log_event(&self, event_type: &str, payload: Option<&str>, salience: Option<i32>) -> AppResult<EventLogEntry> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO event_log (id, event_type, payload_json, salience, handled, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![id, event_type, payload, salience, now],
        )?;
        Ok(EventLogEntry {
            id,
            event_type: event_type.to_string(),
            payload_json: payload.map(|s| s.to_string()),
            salience,
            handled: false,
            created_at: now,
        })
    }

    pub fn recent_events(&self, limit: i64) -> AppResult<Vec<EventLogEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, payload_json, salience, handled, created_at
             FROM event_log ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], |row| {
            Ok(EventLogEntry {
                id: row.get(0)?,
                event_type: row.get(1)?,
                payload_json: row.get(2)?,
                salience: row.get(3)?,
                handled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;
        Ok(collect_tolerant(iter, "event_log"))
    }

    // ------- Skills -------
    pub fn upsert_skill(&self, skill: &Skill) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO skills (id, name, description, permissions_json, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                description=excluded.description,
                permissions_json=excluded.permissions_json,
                enabled=excluded.enabled",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.permissions_json,
                if skill.enabled { 1 } else { 0 },
                skill.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_skills(&self) -> AppResult<Vec<Skill>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, permissions_json, enabled, created_at FROM skills ORDER BY name",
        )?;
        let iter = stmt.query_map([], |row| {
            Ok(Skill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                permissions_json: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;
        Ok(collect_tolerant(iter, "skills"))
    }

    // ------- Settings -------
    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock();
        let val = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get::<_, String>(0))
            .optional()?;
        Ok(val)
    }

    pub fn put_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}

/// Collect rows from a `query_map` iterator, skipping any individual rows that
/// fail to decode (e.g. a corrupt cell with a wrong-type value, or NULL where a
/// non-null type is expected). Connection-level / query-level errors are caught
/// upstream by the `?` on `query_map`; only per-row decode failures are tolerated
/// here. PRD §10.2: corrupt records must be ignored or repairable.
/// REQ-102 — pick the newer of two `last_report_at` watermarks. `None` never
/// beats `Some`; when both parse, the later instant wins; a side that fails
/// to parse loses to one that parses (a stale-but-valid stamp is more useful
/// than corrupt data). Timestamps are compared as parsed instants, not
/// strings, because RFC3339 fractional-second precision varies.
fn merge_last_report_at(existing: Option<String>, incoming: Option<String>) -> Option<String> {
    match (existing, incoming) {
        (None, incoming) => incoming,
        (existing, None) => existing,
        (Some(e), Some(i)) => match (parse_timestamp(&e), parse_timestamp(&i)) {
            (Some(et), Some(it)) => Some(if it >= et { i } else { e }),
            (None, Some(_)) => Some(i),
            (Some(_), None) => Some(e),
            (None, None) => Some(i),
        },
    }
}

fn collect_tolerant<I, T>(iter: I, table: &str) -> Vec<T>
where
    I: IntoIterator<Item = rusqlite::Result<T>>,
{
    let mut out = Vec::new();
    let mut skipped = 0_usize;
    for row in iter {
        match row {
            Ok(v) => out.push(v),
            Err(e) => {
                skipped += 1;
                log::warn!("skipping corrupt row in {}: {}", table, e);
            }
        }
    }
    if skipped > 0 {
        log::warn!("skipped {} corrupt row(s) loading {}", skipped, table);
    }
    out
}

fn map_interaction(row: &rusqlite::Row<'_>) -> rusqlite::Result<Interaction> {
    Ok(Interaction {
        id: row.get(0)?,
        event_type: row.get(1)?,
        user_input: row.get(2)?,
        pet_response: row.get(3)?,
        mood: row.get(4)?,
        state_snapshot_json: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn map_status_report(row: &rusqlite::Row<'_>) -> rusqlite::Result<StatusReport> {
    Ok(StatusReport {
        id: row.get(0)?,
        window_start: row.get(1)?,
        window_end: row.get(2)?,
        learned: row.get(3)?,
        noticed: row.get(4)?,
        wants: row.get(5)?,
        prose: row.get(6)?,
        file_path: row.get(7)?,
        created_at: row.get(8)?,
    })
}

/// Idempotent migration: add `last_report_at` to `pet_state` if a pre-§9.8
/// database is being opened. The column is included in `SCHEMA_SQL` for fresh
/// databases, but `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables,
/// so we must inspect the live schema to decide whether to ALTER.
///
/// Errors here are NON-fatal — if the migration fails, downstream queries that
/// reference the column will fail with a clear error and surface the issue.
/// PRD §10.2: a failed migration must not crash app startup.
fn ensure_pet_state_has_last_report_at(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(pet_state)")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        // table_info columns: cid, name, type, notnull, dflt_value, pk
        let name: String = row.get(1)?;
        if name == "last_report_at" {
            return Ok(());
        }
    }
    drop(rows);
    drop(stmt);
    if let Err(e) = conn.execute("ALTER TABLE pet_state ADD COLUMN last_report_at TEXT", []) {
        log::warn!("could not add last_report_at column (may already exist): {e}");
    }
    Ok(())
}

fn map_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        r#type: row.get(1)?,
        content: row.get(2)?,
        importance: row.get(3)?,
        confidence: row.get(4)?,
        source_interaction_id: row.get(5)?,
        created_at: row.get(6)?,
        last_accessed_at: row.get(7)?,
        decay_score: row.get(8)?,
    })
}

fn scored(m: &Memory, now: chrono::DateTime<chrono::Utc>) -> f32 {
    let recency = parse_timestamp(&m.created_at)
        .map(|t| {
            let age_days = (now - t).num_seconds() as f32 / 86_400.0;
            (-age_days / 30.0).exp()
        })
        .unwrap_or(0.5);
    let importance_norm = (m.importance.clamp(1, 10) as f32) / 10.0;
    let confidence = m.confidence.clamp(0.0, 1.0);
    (importance_norm * 0.4) + (recency * 0.3) + (confidence * 0.3) + (m.decay_score * 0.0)
}

/// Sanitize a free-form query for FTS5 — strip unsafe characters and turn each
/// term into a prefix match so partial words still hit (e.g. "Type" → "TypeScript").
fn sanitize_fts_query(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    let terms: Vec<String> = cleaned
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|t| format!("\"{}\"*", t))
        .collect();
    if terms.is_empty() {
        "\"\"".to_string()
    } else {
        terms.join(" OR ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Db {
        Db::open_in_memory().unwrap()
    }

    #[test]
    fn pet_state_round_trip() {
        let db = fresh();
        let state = PetState::new("Mochi");
        db.save_pet_state(&state).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(loaded.name, "Mochi");
        assert_eq!(loaded.energy, 80);
    }

    fn new_scheduled_item(kind: ScheduledItemKind, scheduled_at: &str) -> NewScheduledItem {
        NewScheduledItem {
            kind,
            title: "Project deadline".to_string(),
            message: Some("Submit the final copy".to_string()),
            scheduled_at: scheduled_at.to_string(),
            timezone: Some("Asia/Kolkata".to_string()),
            recurrence: Some(ScheduledRecurrence::Yearly),
            metadata: Some(serde_json::json!({ "source": "test" })),
        }
    }

    #[test]
    fn scheduled_item_create_get_list_and_update_round_trip() {
        let db = fresh();
        let created = db
            .create_scheduled_item(new_scheduled_item(
                ScheduledItemKind::Reminder,
                "2026-10-05T04:30:00.000Z",
            ))
            .unwrap();
        let loaded = db.get_scheduled_item(&created.id).unwrap().unwrap();
        assert_eq!(loaded.kind, ScheduledItemKind::Reminder);
        assert_eq!(loaded.status, ScheduledItemStatus::Scheduled);
        assert_eq!(loaded.timezone.as_deref(), Some("Asia/Kolkata"));
        assert_eq!(loaded.recurrence, Some(ScheduledRecurrence::Yearly));
        assert_eq!(
            loaded.metadata,
            Some(serde_json::json!({ "source": "test" }))
        );
        assert_eq!(db.list_scheduled_items(None).unwrap().len(), 1);
        assert_eq!(
            db.list_scheduled_items(Some(ScheduledItemKind::Alarm))
                .unwrap()
                .len(),
            0
        );

        let updated = db
            .update_scheduled_item(
                &created.id,
                UpdateScheduledItem {
                    title: "Updated deadline".to_string(),
                    message: None,
                    scheduled_at: "2026-10-06T04:30:00.000Z".to_string(),
                    timezone: Some("Asia/Kolkata".to_string()),
                    recurrence: None,
                    metadata: None,
                },
            )
            .unwrap();
        assert_eq!(updated.title, "Updated deadline");
        assert_eq!(updated.status, ScheduledItemStatus::Scheduled);
    }

    #[test]
    fn due_scheduled_items_are_claimed_once_and_survive_reopen() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("scheduled.sqlite");
        let created = {
            let db = Db::open(&db_path).unwrap();
            db.create_scheduled_item(new_scheduled_item(
                ScheduledItemKind::Reminder,
                "2026-10-05T04:30:00.000Z",
            ))
            .unwrap()
        };

        let db = Db::open(&db_path).unwrap();
        let future = db
            .claim_due_scheduled_items("2026-10-05T04:29:59.999Z")
            .unwrap();
        assert!(future.is_empty());
        let due = db
            .claim_due_scheduled_items("2026-10-05T04:30:01.000Z")
            .unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, created.id);
        assert_eq!(due[0].status, ScheduledItemStatus::Triggered);
        assert!(due[0].triggered_at.is_some());
        assert!(db
            .claim_due_scheduled_items("2026-10-05T04:31:00.000Z")
            .unwrap()
            .is_empty());

        let reopened = Db::open(&db_path).unwrap();
        assert_eq!(
            reopened
                .get_scheduled_item(&created.id)
                .unwrap()
                .unwrap()
                .status,
            ScheduledItemStatus::Triggered
        );
    }

    #[test]
    fn concurrent_scheduler_passes_claim_each_due_item_once() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("concurrent-scheduler.sqlite");
        let first = Arc::new(Db::open(&db_path).unwrap());
        let second = Arc::new(Db::open(&db_path).unwrap());
        first
            .create_scheduled_item(new_scheduled_item(
                ScheduledItemKind::Alarm,
                "2026-10-05T04:30:00.000Z",
            ))
            .unwrap();

        let barrier = Arc::new(Barrier::new(2));
        let claim = |db: Arc<Db>, barrier: Arc<Barrier>| {
            thread::spawn(move || {
                barrier.wait();
                db.claim_due_scheduled_items("2026-10-05T04:31:00.000Z")
                    .unwrap()
                    .len()
            })
        };
        let first_claim = claim(first, barrier.clone());
        let second_claim = claim(second, barrier);
        let total = first_claim.join().unwrap() + second_claim.join().unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn yearly_important_date_advances_atomically_and_survives_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("yearly-date.sqlite");
        let created = {
            let db = Db::open(&db_path).unwrap();
            db.create_scheduled_item(NewScheduledItem {
                kind: ScheduledItemKind::ImportantDate,
                title: "Birthday".to_string(),
                message: None,
                scheduled_at: "2026-10-05T04:30:00.000Z".to_string(),
                timezone: Some("Asia/Kolkata".to_string()),
                recurrence: Some(ScheduledRecurrence::Yearly),
                metadata: None,
            })
            .unwrap()
        };
        let db = Db::open(&db_path).unwrap();
        let first = db
            .claim_due_scheduled_items("2026-10-05T04:31:00.000Z")
            .unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].status, ScheduledItemStatus::Triggered);
        assert_eq!(
            first[0].scheduled_at,
            "2026-10-05T04:30:00.000Z"
        );
        assert!(db
            .claim_due_scheduled_items("2026-10-05T04:32:00.000Z")
            .unwrap()
            .is_empty());

        let reopened = Db::open(&db_path).unwrap();
        let next = reopened.get_scheduled_item(&created.id).unwrap().unwrap();
        assert_eq!(next.status, ScheduledItemStatus::Scheduled);
        assert_eq!(next.scheduled_at, "2027-10-05T04:30:00.000Z");
        assert!(next.triggered_at.is_none());
    }

    #[test]
    fn yearly_recurrence_handles_leap_day_and_multiple_missed_years() {
        assert_eq!(
            next_yearly_occurrence(
                "2024-02-29T12:15:00.000Z",
                Some("UTC"),
                "2025-03-01T00:00:00.000Z"
            )
            .as_deref(),
            Some("2026-02-28T12:15:00.000Z")
        );
    }

    #[test]
    fn yearly_recurrence_preserves_local_time_across_daylight_saving_changes() {
        assert_eq!(
            next_yearly_occurrence(
                "2025-03-08T14:00:00.000Z",
                Some("America/New_York"),
                "2025-03-09T00:00:00.000Z"
            )
            .as_deref(),
            Some("2026-03-08T13:00:00.000Z")
        );
    }

    #[test]
    fn aliases_and_modes_persist_with_normalized_exact_aliases() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("assistant-profiles.sqlite");
        let (created_alias, mode) = {
            let db = Db::open(&db_path).unwrap();
            let alias = db
                .create_user_alias(NewUserAlias {
                    phrase: "  Back   To Studies ".to_string(),
                    target_type: "website".to_string(),
                    target: "https://chatgpt.com".to_string(),
                })
                .unwrap();
            let mode = db
                .create_assistant_mode(NewAssistantMode {
                    name: "Study".to_string(),
                    actions: vec![serde_json::json!({
                        "id": "web.open",
                        "payload": { "url": "https://chatgpt.com" },
                        "permission": "none"
                    })],
                })
                .unwrap();
            (alias, mode)
        };
        let db = Db::open(&db_path).unwrap();
        let alias = db.list_user_aliases().unwrap().remove(0);
        assert_eq!(alias.id, created_alias.id);
        assert_eq!(alias.normalized_phrase, "back to studies");
        assert_eq!(db.list_assistant_modes().unwrap()[0].id, mode.id);
        db.update_user_alias(
            &alias.id,
            NewUserAlias {
                phrase: "studies".to_string(),
                target_type: "website".to_string(),
                target: "https://chatgpt.com".to_string(),
            },
        )
        .unwrap();
        db.delete_user_alias(&alias.id).unwrap();
        db.update_assistant_mode(
            &mode.id,
            NewAssistantMode {
                name: "Focus".to_string(),
                actions: vec![],
            },
        )
        .unwrap();
        assert_eq!(db.list_assistant_modes().unwrap()[0].name, "Focus");
        db.delete_assistant_mode(&mode.id).unwrap();
        assert!(db.list_user_aliases().unwrap().is_empty());
        assert!(db.list_assistant_modes().unwrap().is_empty());
    }

    #[test]
    fn cancelled_and_dismissed_scheduled_items_cannot_be_claimed() {
        let db = fresh();
        let cancelled = db
            .create_scheduled_item(new_scheduled_item(
                ScheduledItemKind::Reminder,
                "2026-10-05T04:30:00.000Z",
            ))
            .unwrap();
        assert_eq!(
            db.cancel_scheduled_item(&cancelled.id).unwrap().status,
            ScheduledItemStatus::Cancelled
        );
        assert_eq!(
            db.cancel_scheduled_item(&cancelled.id).unwrap_err().code,
            "invalid_item_state"
        );

        let triggered = db
            .create_scheduled_item(new_scheduled_item(
                ScheduledItemKind::Alarm,
                "2026-10-05T04:30:00.000Z",
            ))
            .unwrap();
        db.claim_due_scheduled_items("2026-10-05T04:30:01.000Z")
            .unwrap();
        assert_eq!(
            db.dismiss_scheduled_item(&triggered.id).unwrap().status,
            ScheduledItemStatus::Dismissed
        );
        assert_eq!(
            db.dismiss_scheduled_item(&triggered.id).unwrap_err().code,
            "invalid_item_state"
        );
        assert!(db
            .claim_due_scheduled_items("2026-10-05T04:31:00.000Z")
            .unwrap()
            .is_empty());
    }

    /// REQ-102 — a debounced frontend save carrying a stale (older or null)
    /// `last_report_at` must never roll back the newer watermark written by
    /// `run_status_report`, possibly from another window.
    #[test]
    fn last_report_at_is_monotonic_on_save() {
        let db = fresh();
        let mut pet = PetState::new("Mochi");
        pet.last_report_at = Some("2026-08-19T12:00:00+00:00".to_string());
        db.save_pet_state(&pet).unwrap();

        // An older watermark loses.
        let mut stale = pet.clone();
        stale.last_report_at = Some("2026-08-19T00:00:00+00:00".to_string());
        db.save_pet_state(&stale).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(
            loaded.last_report_at.as_deref(),
            Some("2026-08-19T12:00:00+00:00")
        );

        // A null watermark loses.
        let mut nulled = pet.clone();
        nulled.last_report_at = None;
        db.save_pet_state(&nulled).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(
            loaded.last_report_at.as_deref(),
            Some("2026-08-19T12:00:00+00:00")
        );

        // A newer watermark advances.
        let mut newer = pet.clone();
        newer.last_report_at = Some("2026-08-19T13:30:00+00:00".to_string());
        db.save_pet_state(&newer).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(
            loaded.last_report_at.as_deref(),
            Some("2026-08-19T13:30:00+00:00")
        );

        // Other fields still follow the latest save (the guard is scoped to
        // the watermark, not the whole row).
        let mut hungry = newer.clone();
        hungry.hunger = 77;
        db.save_pet_state(&hungry).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(loaded.hunger, 77);
    }

    #[test]
    fn merge_last_report_at_prefers_parseable_over_garbage() {
        let newer = Some("2026-08-19T13:00:00+00:00".to_string());
        let garbage = Some("not-a-timestamp".to_string());
        assert_eq!(
            merge_last_report_at(garbage.clone(), newer.clone()),
            newer.clone()
        );
        assert_eq!(merge_last_report_at(newer.clone(), garbage), newer);
    }

    /// PRD §21.3 acceptance: `last_interaction_at` must survive a process
    /// restart and the derived "away minutes" must be computed from that
    /// persisted timestamp, not from session start.
    ///
    /// Simulates a restart by saving to a tempdir DB, dropping the Db (which
    /// closes the rusqlite Connection), and re-opening at the same path.
    #[test]
    fn last_interaction_at_persists_across_restart_and_drives_away_minutes() {
        use chrono::Duration;

        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("mochi.sqlite");

        // Pretend the user last interacted 90 minutes ago.
        let away_minutes_expected: i64 = 90;
        let saved_at = Utc::now() - Duration::minutes(away_minutes_expected);
        let saved_at_iso = saved_at.to_rfc3339();

        // --- Pre-restart: save a state with last_interaction_at set ---
        {
            let db = Db::open(&db_path).unwrap();
            let mut state = PetState::new("Mochi");
            state.id = "default".to_string();
            state.last_interaction_at = Some(saved_at_iso.clone());
            db.save_pet_state(&state).unwrap();
            // db drops here, closing the connection.
        }

        // --- Post-restart: re-open and verify the timestamp survived ---
        let db = Db::open(&db_path).unwrap();
        let loaded = db
            .load_pet_state("default")
            .unwrap()
            .expect("pet state must be present after restart");

        assert_eq!(
            loaded.last_interaction_at.as_deref(),
            Some(saved_at_iso.as_str()),
            "last_interaction_at must round-trip byte-for-byte"
        );

        // Compute away minutes from the persisted timestamp the same way the
        // app would (parse + diff against now).
        let parsed = parse_timestamp(loaded.last_interaction_at.as_deref().unwrap())
            .expect("persisted timestamp must parse as RFC3339");
        let away_minutes = (Utc::now() - parsed).num_seconds() as f64 / 60.0;

        let drift = (away_minutes - away_minutes_expected as f64).abs();
        assert!(
            drift <= 1.0,
            "away minutes derived from persisted timestamp should be ~{} (got {:.3}, drift {:.3})",
            away_minutes_expected,
            away_minutes,
            drift,
        );
    }

    #[test]
    fn memory_create_and_search() {
        let db = fresh();
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "user prefers dark mode".into(),
            importance: Some(5),
            confidence: Some(0.9),
            source_interaction_id: None,
        })
        .unwrap();
        db.create_memory(NewMemory {
            r#type: "user_fact".into(),
            content: "user lives in Seoul".into(),
            importance: Some(3),
            confidence: Some(0.8),
            source_interaction_id: None,
        })
        .unwrap();

        let results = db.search_memories("dark mode", 10).unwrap();
        assert!(results.iter().any(|m| m.content.contains("dark mode")));
    }

    #[test]
    fn fts_query_safe_against_special_chars() {
        let db = fresh();
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "uses TypeScript".into(),
            importance: Some(2),
            confidence: Some(0.7),
            source_interaction_id: None,
        })
        .unwrap();
        // Special chars must not crash FTS.
        let results = db.search_memories("Type*Script!()", 5).unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn delete_memory_works() {
        let db = fresh();
        let m = db
            .create_memory(NewMemory {
                r#type: "preference".into(),
                content: "likes tea".into(),
                importance: Some(1),
                confidence: Some(0.7),
                source_interaction_id: None,
            })
            .unwrap();
        db.delete_memory(&m.id).unwrap();
        let all = db.list_memories(10).unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn settings_round_trip() {
        let db = fresh();
        db.put_setting("foo", "bar").unwrap();
        assert_eq!(db.get_setting("foo").unwrap(), Some("bar".to_string()));
        db.put_setting("foo", "baz").unwrap();
        assert_eq!(db.get_setting("foo").unwrap(), Some("baz".to_string()));
    }

    #[test]
    fn event_log_records_events() {
        let db = fresh();
        db.log_event("APP_STARTED", None, Some(50)).unwrap();
        db.log_event("USER_CLICKED_PET", Some("{}"), Some(20)).unwrap();
        let recent = db.recent_events(10).unwrap();
        assert_eq!(recent.len(), 2);
    }

    /// PRD §10.2: a single corrupt memory row must not abort the whole load.
    /// We insert one well-formed row and one row whose `importance` cell holds a
    /// non-numeric string, which fails rusqlite's `i32` decoding for that row only.
    #[test]
    fn list_memories_skips_corrupt_rows() {
        let db = fresh();
        // Well-formed row via the normal API.
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "good row".into(),
            importance: Some(5),
            confidence: Some(0.9),
            source_interaction_id: None,
        })
        .unwrap();

        // Corrupt row: bypass the API and stuff a non-numeric string into the
        // INTEGER column (SQLite is dynamically typed, so it stores it as TEXT).
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO memories (id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    "corrupt-1",
                    "preference",
                    "bad row",
                    "not-a-number",   // wrong type for i32
                    0.5_f32,
                    Option::<String>::None,
                    "2024-01-01T00:00:00Z",
                    "2024-01-01T00:00:00Z",
                    1.0_f32,
                ],
            ).unwrap();
        }

        // Loader must succeed and return only the well-formed row.
        let rows = db.list_memories(10).expect("loader must not error on corrupt row");
        assert_eq!(rows.len(), 1, "exactly the good row should survive");
        assert_eq!(rows[0].content, "good row");

        // search_memories shares the same tolerance path (fallback LIKE branch
        // when FTS misses). The corrupt row was indexed by the FTS trigger, so
        // a query that matches "bad" should still return zero rows without
        // erroring; "good" should return exactly the good row.
        let bad_search = db.search_memories("bad", 10).expect("must not error");
        assert!(
            bad_search.iter().all(|m| m.content != "bad row"),
            "corrupt row must never be returned"
        );
        let good_search = db.search_memories("good", 10).expect("must not error");
        assert_eq!(good_search.len(), 1);
        assert_eq!(good_search[0].content, "good row");
    }

    /// Same shape for interactions: insert one good + one with non-string `id`
    /// (NULL where the struct expects `String`), loader returns the good row only.
    #[test]
    fn recent_interactions_skips_corrupt_rows() {
        let db = fresh();
        db.create_interaction(NewInteraction {
            event_type: "chat".into(),
            user_input: Some("hi".into()),
            pet_response: Some("hello".into()),
            mood: Some("happy".into()),
            state_snapshot_json: Some("{\"ok\":true}".into()),
        })
        .unwrap();

        // Corrupt row: NULL id where the model declares `id: String` (non-Option).
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO interactions (id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    Option::<String>::None,  // NULL where String is required
                    "chat",
                    Option::<String>::None,
                    Option::<String>::None,
                    Option::<String>::None,
                    "{not valid json",  // also malformed JSON, but we don't parse it
                    "2024-01-01T00:00:00Z",
                ],
            ).unwrap();
        }

        let rows = db.recent_interactions(10).expect("loader must not error");
        assert_eq!(rows.len(), 1, "only the well-formed interaction survives");
        assert_eq!(rows[0].user_input.as_deref(), Some("hi"));
    }

    /// Event log: NULL `handled` column where the loader expects an `i64`.
    /// (`event_type` is NOT NULL at the schema level, so we corrupt the
    /// `handled` cell instead — this still hits the per-row decode failure path.)
    #[test]
    fn recent_events_skips_corrupt_rows() {
        let db = fresh();
        db.log_event("APP_STARTED", None, Some(50)).unwrap();
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO event_log (id, event_type, payload_json, salience, handled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "evt-corrupt",
                    "BAD_EVENT",
                    "{not json",            // we don't parse this column; harmless
                    Option::<i32>::None,
                    Option::<i64>::None,    // NULL where i64 is required
                    "2024-01-01T00:00:00Z",
                ],
            ).unwrap();
        }
        let rows = db.recent_events(10).expect("loader must not error");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].event_type, "APP_STARTED");
    }

    // ----- §9.8 idle-triggered status report -----

    /// Schema as it existed before REQ-070..076 added `last_report_at`. Used to
    /// build a "legacy" SQLite file for the migration test below.
    const PRE_REPORT_PET_STATE_SQL: &str = r#"
        CREATE TABLE IF NOT EXISTS pet_state (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mood TEXT NOT NULL,
            hunger INTEGER NOT NULL,
            energy INTEGER NOT NULL,
            affection INTEGER NOT NULL,
            boredom INTEGER NOT NULL,
            curiosity INTEGER NOT NULL,
            stress INTEGER NOT NULL,
            trust INTEGER NOT NULL,
            relationship_level INTEGER NOT NULL,
            current_animation TEXT,
            current_intent TEXT,
            last_interaction_at TEXT,
            last_llm_call_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    "#;

    /// REQ-070..076 migration: opening a database that was created by a
    /// pre-§9.8 build must add the `last_report_at` column non-destructively
    /// and the existing row must survive byte-for-byte.
    #[test]
    fn migration_adds_last_report_at_to_legacy_db() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("legacy.sqlite");

        // Stand up a "legacy" file with the old 17-column schema and one row.
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(PRE_REPORT_PET_STATE_SQL).unwrap();
            conn.execute(
                "INSERT INTO pet_state (id, name, mood, hunger, energy, affection, boredom, curiosity, stress, trust, relationship_level, current_animation, current_intent, last_interaction_at, last_llm_call_at, created_at, updated_at)
                 VALUES ('default', 'LegacyMochi', 'happy', 30, 80, 50, 20, 60, 10, 50, 1, 'idle', 'idle', NULL, NULL, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
                [],
            ).unwrap();
        }

        // The current opener must run the migration silently.
        let db = Db::open(&db_path).expect("legacy DB should migrate cleanly");

        let mut state = db
            .load_pet_state("default")
            .unwrap()
            .expect("legacy row must survive migration");
        assert_eq!(state.name, "LegacyMochi");
        assert!(
            state.last_report_at.is_none(),
            "newly added column must default to NULL on legacy rows"
        );

        // And the column must accept a value going forward.
        state.last_report_at = Some("2026-05-04T00:00:00Z".to_string());
        db.save_pet_state(&state).unwrap();
        let reloaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(
            reloaded.last_report_at.as_deref(),
            Some("2026-05-04T00:00:00Z")
        );
    }

    /// Idempotency: re-opening an already-migrated DB must be a no-op (no
    /// duplicate-column error from sqlite, no panic from the migration helper).
    #[test]
    fn migration_is_idempotent_on_already_migrated_db() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("modern.sqlite");
        let _ = Db::open(&db_path).unwrap();
        let _ = Db::open(&db_path).expect("second open must not error");
        let _ = Db::open(&db_path).expect("third open must not error");
    }

    /// REQ-115 (frontend gate dependency): `last_report_at` must round-trip
    /// across a process restart so the 12h cadence resumes correctly.
    #[test]
    fn last_report_at_persists_across_restart() {
        use chrono::Duration;
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("mochi.sqlite");

        let saved_at = (Utc::now() - Duration::hours(13)).to_rfc3339();
        {
            let db = Db::open(&db_path).unwrap();
            let mut state = PetState::new("Mochi");
            state.id = "default".to_string();
            state.last_report_at = Some(saved_at.clone());
            db.save_pet_state(&state).unwrap();
        }
        let db = Db::open(&db_path).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(loaded.last_report_at.as_deref(), Some(saved_at.as_str()));
    }

    /// Save → list → last_status_report round-trip on the new table.
    #[test]
    fn status_report_round_trip() {
        let db = fresh();
        let r = db
            .save_status_report(NewStatusReport {
                window_start: "2026-05-03T12:00:00Z".to_string(),
                window_end: "2026-05-04T00:00:00Z".to_string(),
                learned: Some("the user prefers tea".to_string()),
                noticed: Some("they yawned around 11pm".to_string()),
                wants: Some("offer a quiet greeting tomorrow".to_string()),
                prose: Some(
                    "Twelve hours of mostly quiet, with three little play bursts and a cozy late-evening pat. The user seemed calm. Mochi watched the cursor wander and napped twice — sweet, ordinary time."
                        .to_string(),
                ),
                file_path: Some("dreams/2026-05-04-0000.md".to_string()),
            })
            .unwrap();

        assert!(!r.id.is_empty());

        let listed = db.list_status_reports(10).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].learned.as_deref(), Some("the user prefers tea"));
        assert_eq!(
            listed[0].window_start.as_str(),
            "2026-05-03T12:00:00Z"
        );

        let last = db.last_status_report().unwrap().expect("must have a row");
        assert_eq!(last.id, r.id);
    }

    /// Skills loader: NULL `enabled` column where the loader expects an `i64`.
    /// (`permissions_json` is NOT NULL at the schema level.)
    #[test]
    fn list_skills_skips_corrupt_rows() {
        let db = fresh();
        db.upsert_skill(&Skill {
            id: "skill-1".into(),
            name: "Notes".into(),
            description: Some("write notes".into()),
            permissions_json: "[]".into(),
            enabled: true,
            created_at: "2024-01-01T00:00:00Z".into(),
        }).unwrap();
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO skills (id, name, description, permissions_json, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "skill-corrupt",
                    "Bad",
                    Option::<String>::None,
                    "{not valid",          // permissions_json is opaque text, not parsed at load
                    Option::<i64>::None,   // NULL where i64 is required → per-row decode fails
                    "2024-01-01T00:00:00Z",
                ],
            ).unwrap();
        }
        let rows = db.list_skills().expect("loader must not error");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Notes");
    }
}
