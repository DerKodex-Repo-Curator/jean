//! Backend loop of the agents infrastructure. It runs without any client:
//! 1. `chat:done` / `chat:error` / `chat:cancelled` mark delegations to check.
//! 2. Checks read the finished session and queue an update for its agent.
//! 3. Due schedules queue updates.
//! 4. Queued updates are sent as one message to the agent's home session
//!    when it is idle, not paused, and within its hourly wake budget.

use std::time::Duration;

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Notify;

use super::db;
use crate::chat::types::{MessageRole, RunStatus};

const TICK: Duration = Duration::from_secs(5);
/// Wait after a run ends before reading its final state (waiting-for-input
/// and the last message are saved right after the event on some backends).
const CHECK_DELAY_SECS: i64 = 2;
const BUSY_RETRY_SECS: i64 = 5;
const SUMMARY_CHARS: usize = 1500;
/// Most agent-to-agent hops in one chain.
pub const MAX_AGENT_HOPS: i64 = 3;

static WAKE: Lazy<Notify> = Lazy::new(Notify::new);

/// Run the engine soon (new event, run ended, approval decided).
pub fn nudge() {
    WAKE.notify_one();
}

/// Start listeners and the loop. Call once after `agents::init`.
pub fn start(app: AppHandle) {
    for event_name in ["chat:done", "chat:error", "chat:cancelled"] {
        let listener_app = app.clone();
        app.listen(event_name, move |event| {
            let Ok(payload) = serde_json::from_str::<Value>(event.payload()) else {
                return;
            };
            let Some(session_id) = payload
                .get("session_id")
                .or_else(|| payload.get("sessionId"))
                .and_then(Value::as_str)
            else {
                return;
            };
            let kind = event_name.trim_start_matches("chat:");
            let error = payload.get("error").and_then(Value::as_str);
            on_run_ended(&listener_app, session_id, kind, error);
        });
    }

    // Runs that ended while Jean was closed did not emit events: check every
    // active delegation once (a check of a still-running session waits).
    let at = db::now() + 20;
    if let Err(e) = super::with_db(&app, |conn| db::requeue_active_delegations(conn, at)) {
        log::warn!("[Agents] requeue failed: {e}");
    }

    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = tick(&app).await {
                log::warn!("[Agents] tick failed: {e}");
            }
            tokio::select! {
                _ = tokio::time::sleep(TICK) => {}
                _ = WAKE.notified() => {}
            }
        }
    });
}

fn on_run_ended(app: &AppHandle, session_id: &str, kind: &str, error: Option<&str>) {
    let marked = super::with_db(app, |conn| {
        db::mark_delegation_run_ended(conn, session_id, kind, error, db::now() + CHECK_DELAY_SECS)
    })
    .unwrap_or(0);
    // An agent's own run ended: its queued updates can be delivered now.
    if marked > 0 || super::agent_for_session(app, session_id).is_some() {
        super::notify_changed(app);
    }
}

async fn tick(app: &AppHandle) -> Result<(), String> {
    let mut changed = false;
    let checks = super::with_db(app, |conn| db::due_delegation_checks(conn, db::now()))?;
    for delegation in checks {
        changed |= check_delegation(app, &delegation).await?;
    }
    let fired = super::with_db(app, |conn| db::fire_due_schedules(conn, db::now()))?;
    changed |= !fired.is_empty();
    let agents = super::with_db(app, db::agents_with_pending_events)?;
    for agent_id in agents {
        changed |= deliver(app, &agent_id).await?;
    }
    if changed {
        use crate::http_server::EmitExt;
        let _ = app.emit_all("cache:invalidate", &json!({ "keys": ["agents"] }));
    }
    Ok(())
}

/// Path of a worktree for session lookups (agent worktrees use their folder).
fn worktree_path(app: &AppHandle, worktree_id: &str) -> Option<String> {
    if let Some(path) = super::workdir_for_worktree(app, worktree_id) {
        return Some(path);
    }
    crate::projects::storage::load_projects_data(app)
        .ok()?
        .find_worktree(worktree_id)
        .map(|w| w.path.clone())
}

/// "project / worktree" label (or the agent name for agent sessions).
fn worktree_label(app: &AppHandle, worktree_id: &str) -> String {
    if let Some(agent) = super::agent_for_worktree(app, worktree_id) {
        return format!("agent {}", agent.name);
    }
    let Ok(data) = crate::projects::storage::load_projects_data(app) else {
        return worktree_id.to_string();
    };
    let Some(wt) = data.find_worktree(worktree_id) else {
        return worktree_id.to_string();
    };
    let project = data
        .projects
        .iter()
        .find(|p| p.id == wt.project_id)
        .map(|p| p.name.as_str())
        .unwrap_or("?");
    format!("{project} / {}", wt.name)
}

pub(crate) fn truncate(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    format!("{cut}…")
}

/// Map a finished session to a delegation status.
pub(crate) fn outcome_status(
    waiting_for_input: bool,
    last_event: Option<&str>,
    last_run_status: Option<&RunStatus>,
) -> &'static str {
    if waiting_for_input {
        return "waiting";
    }
    match (last_event, last_run_status) {
        (Some("error"), _) | (_, Some(RunStatus::Crashed)) => "failed",
        (Some("cancelled"), _) | (_, Some(RunStatus::Cancelled)) => "cancelled",
        _ => "done",
    }
}

/// Returns true when the delegation produced an update.
async fn check_delegation(app: &AppHandle, d: &db::Delegation) -> Result<bool, String> {
    if crate::chat::registry::is_session_actively_managed(&d.session_id) {
        super::with_db(app, |conn| {
            db::defer_delegation_check(conn, d.id, Some(db::now() + BUSY_RETRY_SECS))
        })?;
        return Ok(false);
    }
    let label = worktree_label(app, &d.worktree_id);
    let session = match worktree_path(app, &d.worktree_id) {
        Some(path) => crate::chat::get_session(
            app.clone(),
            d.worktree_id.clone(),
            path,
            d.session_id.clone(),
            Some(6),
        )
        .await
        .ok(),
        None => None,
    };
    let Some(session) = session else {
        let body = format!(
            "Session {} ({label}) is gone: its worktree or session no longer exists.",
            d.session_id
        );
        super::with_db(app, |conn| {
            db::add_event(conn, &d.agent_id, "delegation", &body, d.hop, None)?;
            db::finish_delegation(conn, d.id, "failed", "Session no longer exists")
        })?;
        return Ok(true);
    };
    // A detached run still going (e.g. resumed after restart): wait for its event.
    if matches!(
        session.last_run_status,
        Some(RunStatus::Running) | Some(RunStatus::Resumable)
    ) && d.last_event.is_none()
    {
        super::with_db(app, |conn| db::defer_delegation_check(conn, d.id, None))?;
        return Ok(false);
    }

    let status = outcome_status(
        session.waiting_for_input,
        d.last_event.as_deref(),
        session.last_run_status.as_ref(),
    );
    let reply = session
        .messages
        .iter()
        .rev()
        .find(|m| m.role == MessageRole::Assistant && !m.content.trim().is_empty())
        .map(|m| truncate(&m.content, SUMMARY_CHARS))
        .unwrap_or_default();
    let verb = match status {
        "waiting" => match session.waiting_for_input_type.as_deref() {
            Some("plan") => "is waiting for plan approval",
            Some("question") => "is asking a question",
            _ => "is waiting for input",
        },
        "failed" => "failed",
        "cancelled" => "was cancelled",
        _ => "finished",
    };
    let mut body = format!(
        "Session \"{}\" ({label}, sessionId {}) {verb}.",
        session.name, d.session_id
    );
    if let Some(error) = d.last_error.as_deref().filter(|_| status == "failed") {
        body.push_str(&format!("\nError: {}", truncate(error, 500)));
    }
    if !reply.is_empty() {
        body.push_str(&format!("\nLast reply:\n{reply}"));
    }
    let summary = truncate(&reply, 300);
    super::with_db(app, |conn| {
        db::add_event(conn, &d.agent_id, "delegation", &body, d.hop, None)?;
        db::finish_delegation(conn, d.id, status, &summary)
    })?;
    Ok(true)
}

/// The agent's home session: the active (or first) session of its worktree.
/// A new session has no saved mode yet (it would load as Plan, which blocks
/// the Jean MCP tools), so save the default mode once.
pub(crate) async fn home_session(
    app: &AppHandle,
    agent: &db::Agent,
) -> Result<(crate::chat::types::Session, String), String> {
    let path = super::agent_workdir(app, &agent.id)?;
    let sessions = crate::chat::get_sessions(
        app.clone(),
        agent.worktree_id.clone(),
        path.clone(),
        None,
        None,
    )
    .await?;
    let mut session = sessions
        .active_session_id
        .as_deref()
        .and_then(|id| sessions.sessions.iter().find(|s| s.id == id))
        .or_else(|| sessions.sessions.first())
        .cloned()
        .ok_or_else(|| format!("Agent {} has no session", agent.id))?;
    if matches!(
        crate::chat::storage::load_metadata(app, &session.id),
        Ok(None)
    ) {
        let default_mode = crate::load_preferences(app.clone())
            .await
            .ok()
            .map(|prefs| prefs.default_execution_mode);
        let mode = wake_execution_mode(default_mode.as_deref())
            .or(default_mode.as_deref())
            .unwrap_or("build")
            .to_string();
        crate::chat::set_session_execution_mode(
            app.clone(),
            agent.worktree_id.clone(),
            path.clone(),
            session.id.clone(),
            mode.clone(),
        )
        .await?;
        session.selected_execution_mode = Some(mode);
    }
    Ok((session, path))
}

/// Wake-ups need the Jean MCP tools, which Plan mode blocks: keep the
/// session's Build/Yolo mode, use Build otherwise.
pub(crate) fn wake_execution_mode(selected: Option<&str>) -> Option<&'static str> {
    match selected {
        Some("build") | Some("yolo") => None,
        _ => Some("build"),
    }
}

pub(crate) fn compose_update(events: &[db::AgentEvent]) -> String {
    let mut message =
        String::from("[Jean agent update] Automatic message from Jean, not from the user.\n");
    for (i, event) in events.iter().enumerate() {
        message.push_str(&format!(
            "\n### {}. {}\n{}\n",
            i + 1,
            event.kind,
            event.body.trim()
        ));
    }
    message.push_str("\nDecide the next step. If nothing is needed, reply briefly.");
    message
}

/// Returns true when updates were sent.
async fn deliver(app: &AppHandle, agent_id: &str) -> Result<bool, String> {
    let Some(agent) = super::with_db(app, |conn| db::get_agent(conn, agent_id))? else {
        return Ok(false);
    };
    if agent.paused {
        return Ok(false);
    }
    let (session, path) = home_session(app, &agent).await?;
    if crate::chat::registry::is_session_actively_managed(&session.id) || session.waiting_for_input
    {
        return Ok(false);
    }
    let since = db::now() - 3600;
    let events = super::with_db(app, |conn| {
        if db::wakes_since(conn, &agent.id, since)? >= agent.max_wakes_per_hour {
            return Ok(Vec::new());
        }
        let events = db::pending_events(conn, &agent.id)?;
        if events.is_empty() {
            return Ok(events);
        }
        let ids: Vec<i64> = events.iter().map(|e| e.id).collect();
        db::mark_events_delivered(conn, &ids)?;
        db::record_wake(conn, &agent.id, &session.id)?;
        // Agent-to-agent requests: the answer of this run goes back to the sender.
        for event in &events {
            if let Some(sender) = event.reply_to_agent.as_deref() {
                db::upsert_delegation(conn, sender, &session.id, &agent.worktree_id, event.hop)?;
            }
        }
        Ok(events)
    })?;
    if events.is_empty() {
        return Ok(false);
    }
    let mut payload = json!({
        "sessionId": session.id,
        "worktreeId": agent.worktree_id,
        "worktreePath": path,
        "message": compose_update(&events),
    });
    if let Some(mode) = wake_execution_mode(session.selected_execution_mode.as_deref()) {
        payload["executionMode"] = json!(mode);
    }
    let app_clone = app.clone();
    let agent_name = agent.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            crate::http_server::dispatch::dispatch_command(&app_clone, "send_chat_message", payload)
                .await
        {
            log::warn!("[Agents] wake of {agent_name} failed: {e}");
        }
    });
    Ok(true)
}

/// Execute or reject a pending approval, then queue the result for the agent.
pub async fn decide_approval(
    app: &AppHandle,
    approval_id: i64,
    approve: bool,
) -> Result<db::Approval, String> {
    let status = if approve { "approved" } else { "denied" };
    let decided = super::with_db(app, |conn| db::decide_approval(conn, approval_id, status))?;
    if !decided {
        return Err(format!("Approval #{approval_id} is already decided"));
    }
    let approval = super::with_db(app, |conn| db::get_approval(conn, approval_id))?
        .ok_or_else(|| format!("Approval #{approval_id} not found"))?;
    let (final_status, result, body) = if approve {
        match crate::jean_mcp_core::run_approved_tool(
            app.clone(),
            approval.tool.clone(),
            approval.args.clone(),
        )
        .await
        {
            Ok(value) => {
                let text = truncate(&value.to_string(), 1000);
                (
                    "approved",
                    text.clone(),
                    format!(
                        "The user approved #{approval_id} ({}). It ran. Result: {text}",
                        approval.tool
                    ),
                )
            }
            Err(e) => (
                "failed",
                e.clone(),
                format!(
                    "The user approved #{approval_id} ({}), but it failed: {e}",
                    approval.tool
                ),
            ),
        }
    } else {
        (
            "denied",
            String::new(),
            format!(
                "The user denied #{approval_id} ({}). Do not retry it without asking.",
                approval.tool
            ),
        )
    };
    super::with_db(app, |conn| {
        db::set_approval_result(conn, approval_id, final_status, &result)?;
        db::add_event(conn, &approval.agent_id, "approval", &body, 0, None)?;
        Ok(())
    })?;
    super::notify_changed(app);
    super::with_db(app, |conn| db::get_approval(conn, approval_id))?
        .ok_or_else(|| format!("Approval #{approval_id} not found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_status_mapping() {
        assert_eq!(outcome_status(true, Some("done"), None), "waiting");
        assert_eq!(outcome_status(false, Some("error"), None), "failed");
        assert_eq!(
            outcome_status(false, None, Some(&RunStatus::Crashed)),
            "failed"
        );
        assert_eq!(outcome_status(false, Some("cancelled"), None), "cancelled");
        assert_eq!(
            outcome_status(false, Some("done"), Some(&RunStatus::Cancelled)),
            "cancelled"
        );
        assert_eq!(
            outcome_status(false, Some("done"), Some(&RunStatus::Completed)),
            "done"
        );
    }

    #[test]
    fn wake_mode_avoids_plan_mode() {
        assert_eq!(wake_execution_mode(Some("plan")), Some("build"));
        assert_eq!(wake_execution_mode(None), Some("build"));
        assert_eq!(wake_execution_mode(Some("build")), None);
        assert_eq!(wake_execution_mode(Some("yolo")), None);
    }

    #[test]
    fn truncate_counts_chars_not_bytes() {
        assert_eq!(truncate("  short ", 10), "short");
        assert_eq!(truncate("ééééé", 3), "ééé…");
    }

    #[test]
    fn update_message_lists_events_and_marks_source() {
        let events = vec![
            db::AgentEvent {
                id: 1,
                agent_id: "jean".into(),
                kind: "delegation".into(),
                body: "Session A finished.".into(),
                hop: 0,
                reply_to_agent: None,
                created_at: 0,
            },
            db::AgentEvent {
                id: 2,
                agent_id: "jean".into(),
                kind: "schedule".into(),
                body: "Schedule #3 is due.".into(),
                hop: 0,
                reply_to_agent: None,
                created_at: 0,
            },
        ];
        let message = compose_update(&events);
        assert!(message.starts_with("[Jean agent update]"));
        assert!(message.contains("### 1. delegation\nSession A finished."));
        assert!(message.contains("### 2. schedule\nSchedule #3 is due."));
    }
}
