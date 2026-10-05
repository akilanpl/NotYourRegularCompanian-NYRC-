//! Durable reminders, alarms, and recurrence-ready important dates.

use crate::models::{
    parse_timestamp, NewScheduledItem, ScheduledItem, ScheduledItemError, ScheduledItemKind,
    ScheduledRecurrence, UpdateScheduledItem,
};
use crate::state::AppState;
use chrono::SecondsFormat;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduledItemRequest {
    pub kind: String,
    pub title: String,
    pub message: Option<String>,
    pub scheduled_at: String,
    pub timezone: Option<String>,
    pub recurrence: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduledItemRequest {
    pub title: String,
    pub message: Option<String>,
    pub scheduled_at: String,
    pub timezone: Option<String>,
    pub recurrence: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[tauri::command]
pub fn create_scheduled_item(
    state: State<'_, AppState>,
    item: CreateScheduledItemRequest,
) -> Result<ScheduledItem, ScheduledItemError> {
    let kind = parse_kind(&item.kind)?;
    let title = validate_title(&item.title)?;
    let scheduled_at = normalize_timestamp(&item.scheduled_at)?;
    let timezone = validate_timezone(item.timezone)?;
    let recurrence = parse_recurrence(item.recurrence)?;
    validate_recurrence_kind(kind, recurrence)?;
    validate_metadata(&item.metadata)?;
    state.db.create_scheduled_item(NewScheduledItem {
        kind,
        title,
        message: validate_message(item.message)?,
        scheduled_at,
        timezone,
        recurrence,
        metadata: item.metadata,
    })
}

#[tauri::command]
pub fn get_scheduled_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<ScheduledItem, ScheduledItemError> {
    let id = validate_id(&id)?;
    state
        .db
        .get_scheduled_item(&id)?
        .ok_or_else(|| ScheduledItemError::new("item_not_found", "Scheduled item was not found"))
}

#[tauri::command]
pub fn list_scheduled_items(
    state: State<'_, AppState>,
    kind: Option<String>,
) -> Result<Vec<ScheduledItem>, ScheduledItemError> {
    let kind = kind.map(|value| parse_kind(&value)).transpose()?;
    state.db.list_scheduled_items(kind)
}

#[tauri::command]
pub fn update_scheduled_item(
    state: State<'_, AppState>,
    id: String,
    item: UpdateScheduledItemRequest,
) -> Result<ScheduledItem, ScheduledItemError> {
    let id = validate_id(&id)?;
    let title = validate_title(&item.title)?;
    let scheduled_at = normalize_timestamp(&item.scheduled_at)?;
    let timezone = validate_timezone(item.timezone)?;
    let recurrence = parse_recurrence(item.recurrence)?;
    let existing = state
        .db
        .get_scheduled_item(&id)?
        .ok_or_else(|| ScheduledItemError::new("item_not_found", "Scheduled item was not found"))?;
    validate_recurrence_kind(existing.kind, recurrence)?;
    validate_metadata(&item.metadata)?;
    state.db.update_scheduled_item(
        &id,
        UpdateScheduledItem {
            title,
            message: validate_message(item.message)?,
            scheduled_at,
            timezone,
            recurrence,
            metadata: item.metadata,
        },
    )
}

#[tauri::command]
pub fn cancel_scheduled_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<ScheduledItem, ScheduledItemError> {
    let id = validate_id(&id)?;
    state.db.cancel_scheduled_item(&id)
}

#[tauri::command]
pub fn dismiss_scheduled_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<ScheduledItem, ScheduledItemError> {
    let id = validate_id(&id)?;
    state.db.dismiss_scheduled_item(&id)
}

#[tauri::command]
pub fn claim_due_scheduled_items(
    state: State<'_, AppState>,
    now: String,
) -> Result<Vec<ScheduledItem>, ScheduledItemError> {
    let now = normalize_timestamp(&now)?;
    state.db.claim_due_scheduled_items(&now)
}

fn parse_kind(value: &str) -> Result<ScheduledItemKind, ScheduledItemError> {
    match value {
        "reminder" => Ok(ScheduledItemKind::Reminder),
        "alarm" => Ok(ScheduledItemKind::Alarm),
        "important_date" => Ok(ScheduledItemKind::ImportantDate),
        _ => Err(ScheduledItemError::new(
            "unsupported_kind",
            format!("Unsupported scheduled item kind: {value}"),
        )),
    }
}

fn parse_recurrence(
    value: Option<String>,
) -> Result<Option<ScheduledRecurrence>, ScheduledItemError> {
    value
        .map(|value| match value.as_str() {
            "daily" => Ok(ScheduledRecurrence::Daily),
            "weekly" => Ok(ScheduledRecurrence::Weekly),
            "monthly" => Ok(ScheduledRecurrence::Monthly),
            "yearly" => Ok(ScheduledRecurrence::Yearly),
            _ => Err(ScheduledItemError::new(
                "invalid_recurrence",
                "Recurrence must be daily, weekly, monthly, or yearly",
            )),
        })
        .transpose()
}

fn validate_recurrence_kind(
    kind: ScheduledItemKind,
    recurrence: Option<ScheduledRecurrence>,
) -> Result<(), ScheduledItemError> {
    if recurrence.is_some() && kind != ScheduledItemKind::ImportantDate {
        return Err(ScheduledItemError::new(
            "invalid_recurrence",
            "Recurrence is currently supported only for important dates",
        ));
    }
    Ok(())
}

fn validate_title(value: &str) -> Result<String, ScheduledItemError> {
    let title = value.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(ScheduledItemError::new(
            "invalid_title",
            "Title must contain 1 to 120 characters",
        ));
    }
    Ok(title.to_string())
}

fn validate_message(value: Option<String>) -> Result<Option<String>, ScheduledItemError> {
    let Some(message) = value else {
        return Ok(None);
    };
    let message = message.trim();
    if message.chars().count() > 500 {
        return Err(ScheduledItemError::new(
            "invalid_message",
            "Message must be at most 500 characters",
        ));
    }
    Ok((!message.is_empty()).then(|| message.to_string()))
}

fn normalize_timestamp(value: &str) -> Result<String, ScheduledItemError> {
    parse_timestamp(value)
        .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| {
            ScheduledItemError::new(
                "invalid_timestamp",
                "scheduledAt must be an ISO 8601/RFC3339 timestamp with an offset",
            )
        })
}

fn validate_timezone(value: Option<String>) -> Result<Option<String>, ScheduledItemError> {
    let Some(timezone) = value else {
        return Ok(None);
    };
    let timezone = timezone.trim();
    let timezone_segments: Vec<&str> = timezone.split('/').collect();
    let valid = timezone.len() <= 100
        && !timezone.is_empty()
        && !timezone.contains("..")
        && ((timezone == "UTC" || timezone == "GMT")
            || (timezone_segments.len() >= 2
                && timezone_segments.iter().all(|segment| !segment.is_empty())))
        && timezone
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '+'))
        && timezone.parse::<chrono_tz::Tz>().is_ok();
    if !valid {
        return Err(ScheduledItemError::new(
            "invalid_timezone",
            "Timezone must be a valid timezone identifier",
        ));
    }
    Ok(Some(timezone.to_string()))
}

fn validate_metadata(metadata: &Option<serde_json::Value>) -> Result<(), ScheduledItemError> {
    if let Some(metadata) = metadata {
        let json = serde_json::to_string(metadata)
            .map_err(|error| ScheduledItemError::new("invalid_metadata", error.to_string()))?;
        if json.len() > 16_384 {
            return Err(ScheduledItemError::new(
                "invalid_metadata",
                "Metadata must be at most 16384 bytes",
            ));
        }
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<String, ScheduledItemError> {
    let id = Uuid::parse_str(value)
        .map_err(|_| ScheduledItemError::new("invalid_id", "Scheduled item id must be a UUID"))?;
    Ok(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_valid_timestamps_and_rejects_invalid_ones() {
        assert_eq!(
            normalize_timestamp("2026-10-05T10:00:00+05:30").unwrap(),
            "2026-10-05T04:30:00.000Z"
        );
        assert_eq!(
            normalize_timestamp("not-a-date").unwrap_err().code,
            "invalid_timestamp"
        );
    }

    #[test]
    fn validates_kind_title_timezone_and_ids() {
        assert_eq!(parse_kind("nope").unwrap_err().code, "unsupported_kind");
        assert_eq!(validate_title("  ").unwrap_err().code, "invalid_title");
        assert_eq!(
            validate_timezone(Some("../unsafe".to_string()))
                .unwrap_err()
                .code,
            "invalid_timezone"
        );
        assert_eq!(
            validate_timezone(Some("Asia//Kolkata".to_string()))
                .unwrap_err()
                .code,
            "invalid_timezone"
        );
        assert_eq!(
            validate_timezone(Some("NotATimezone".to_string()))
                .unwrap_err()
                .code,
            "invalid_timezone"
        );
        assert!(validate_timezone(Some("America/New_York".to_string())).is_ok());
        assert!(validate_timezone(Some("UTC".to_string())).is_ok());
        assert_eq!(validate_id("bad-id").unwrap_err().code, "invalid_id");
        assert!(validate_id(&Uuid::new_v4().to_string()).is_ok());
    }

    #[test]
    fn recurrence_values_are_bounded() {
        assert_eq!(
            parse_recurrence(Some("yearly".to_string())).unwrap(),
            Some(ScheduledRecurrence::Yearly)
        );
        assert_eq!(
            parse_recurrence(Some("hourly".to_string()))
                .unwrap_err()
                .code,
            "invalid_recurrence"
        );
        assert_eq!(
            validate_recurrence_kind(
                ScheduledItemKind::Reminder,
                Some(ScheduledRecurrence::Daily),
            )
            .unwrap_err()
            .code,
            "invalid_recurrence"
        );
        assert!(validate_recurrence_kind(
            ScheduledItemKind::ImportantDate,
            Some(ScheduledRecurrence::Yearly),
        )
        .is_ok());
    }

    #[test]
    fn timestamps_are_canonical_utc() {
        assert_eq!(
            chrono::Utc::now()
                .to_rfc3339_opts(SecondsFormat::Millis, true)
                .ends_with('Z'),
            true
        );
    }
}
