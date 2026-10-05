//! BYO providers. Credentials stay in Rust; errors never include response bodies or URLs.
use super::provider::{LlmProvider, LlmRequest, LlmResponse};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::{future::Future, pin::Pin, time::Duration};
pub struct CloudProvider {
    kind: String,
    endpoint: String,
    model: String,
    key: String,
    client: reqwest::Client,
}
pub fn validate_endpoint(endpoint: &str, local: bool) -> AppResult<()> {
    let u = reqwest::Url::parse(endpoint)
        .map_err(|_| AppError::InvalidInput("invalid provider endpoint".into()))?;
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(AppError::InvalidInput(
            "endpoint must not contain credentials, query or fragment".into(),
        ));
    }
    let loopback = matches!(
        u.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (local && !loopback) || !(u.scheme() == "https" || u.scheme() == "http" && loopback) {
        return Err(AppError::InvalidInput(
            "use HTTPS, or HTTP on loopback only".into(),
        ));
    }
    Ok(())
}
impl CloudProvider {
    pub fn new(
        kind: String,
        endpoint: String,
        model: String,
        key: String,
        timeout: u64,
    ) -> AppResult<Self> {
        validate_endpoint(&endpoint, false)?;
        if !matches!(kind.as_str(), "openai" | "gemini")
            || model.is_empty()
            || model.len() > 150
            || !model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
        {
            return Err(AppError::InvalidInput("invalid provider or model".into()));
        }
        if kind == "gemini" && endpoint != "https://generativelanguage.googleapis.com/v1beta" {
            return Err(AppError::InvalidInput(
                "Gemini uses its official endpoint".into(),
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout.clamp(2, 120)))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AppError::LlmUnavailable("client unavailable".into()))?;
        Ok(Self {
            kind,
            endpoint,
            model,
            key,
            client,
        })
    }
}
pub fn response_text(kind: &str, v: &Value) -> AppResult<String> {
    let t = if kind == "gemini" {
        v.pointer("/candidates/0/content/parts/0/text")
    } else {
        v.pointer("/choices/0/message/content")
    };
    t.and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= 65536)
        .map(str::to_owned)
        .ok_or_else(|| AppError::LlmUnavailable("malformed provider response".into()))
}
pub fn status_error(status: reqwest::StatusCode) -> AppError {
    AppError::LlmUnavailable(
        match status.as_u16() {
            401 | 403 => "invalid authentication",
            429 => "rate limited",
            _ => "provider request failed",
        }
        .into(),
    )
}
impl LlmProvider for CloudProvider {
    fn name(&self) -> &'static str {
        if self.kind == "gemini" {
            "gemini"
        } else {
            "openai"
        }
    }
    fn complete<'a>(
        &'a self,
        req: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<LlmResponse>> + Send + 'a>> {
        Box::pin(async move {
            let builder = if self.kind == "gemini" {
                self.client.post(format!("{}/models/{}:generateContent",self.endpoint,self.model)).header("x-goog-api-key",&self.key).json(&json!({"systemInstruction":{"parts":[{"text":req.system.unwrap_or_default()}]},"contents":[{"parts":[{"text":req.prompt}]}],"generationConfig":{"maxOutputTokens":req.max_tokens.unwrap_or(800),"temperature":req.temperature.unwrap_or(0.3)}}))
            } else {
                self.client.post(format!("{}/chat/completions",self.endpoint.trim_end_matches('/'))).bearer_auth(&self.key).json(&json!({"model":self.model,"messages":[{"role":"system","content":req.system.unwrap_or_default()},{"role":"user","content":req.prompt}],"max_tokens":req.max_tokens.unwrap_or(800),"temperature":req.temperature.unwrap_or(0.3)}))
            };
            let r = builder.send().await.map_err(|e| {
                AppError::LlmUnavailable(
                    if e.is_timeout() {
                        "timeout"
                    } else {
                        "network failure"
                    }
                    .into(),
                )
            })?;
            if !r.status().is_success() {
                return Err(status_error(r.status()));
            }
            let v = bounded_json(r).await?;
            Ok(LlmResponse {
                text: response_text(&self.kind, &v)?,
                model: self.model.clone(),
            })
        })
    }
}
/// Bound streamed response bytes even if the server omits Content-Length.
pub async fn bounded_json(mut r: reqwest::Response) -> AppResult<Value> {
    let mut bytes = Vec::new();
    while let Some(chunk) = r
        .chunk()
        .await
        .map_err(|_| AppError::LlmUnavailable("response network failure".into()))?
    {
        if bytes.len() + chunk.len() > 262144 {
            return Err(AppError::LlmUnavailable("response too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::LlmUnavailable("malformed provider response".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints() {
        for s in [
            "file:///tmp/key",
            "http://example.com",
            "https://x.com/?key=a",
            "https://user:pass@x.com",
        ] {
            assert!(validate_endpoint(s, false).is_err());
        }
        assert!(validate_endpoint("http://127.0.0.1:11434", true).is_ok());
        assert!(validate_endpoint("https://example.com", true).is_err());
    }
    #[test]
    fn malformed() {
        assert!(response_text("openai", &json!({})).is_err());
        assert_eq!(
            response_text(
                "gemini",
                &json!({"candidates":[{"content":{"parts":[{"text":"hello"}]}}]})
            )
            .unwrap(),
            "hello"
        );
        assert!(!status_error(reqwest::StatusCode::UNAUTHORIZED)
            .to_string()
            .contains("key"));
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    fn fake_server(status: u16, body: &str) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = body.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut input = [0u8; 8192];
            let n = socket.read(&mut input).unwrap();
            let request = String::from_utf8_lossy(&input[..n]);
            assert!(request.contains("POST /v1/chat/completions"));
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer test-only-key"));
            write!(socket,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        });
        (format!("http://{addr}/v1"), handle)
    }
    #[tokio::test]
    async fn production_adapter_fake_transport() {
        for (status, body, expected) in [
            (
                200,
                r#"{"choices":[{"message":{"content":"safe response"}}]}"#,
                "safe response",
            ),
            (
                401,
                r#"{"secret":"must-not-leak"}"#,
                "invalid authentication",
            ),
            (429, "private body", "rate limited"),
            (200, "not JSON", "malformed provider response"),
        ] {
            let (url, handle) = fake_server(status, body);
            let p = CloudProvider::new(
                "openai".into(),
                url,
                "test-model".into(),
                "test-only-key".into(),
                3,
            )
            .unwrap();
            let result = p
                .complete(LlmRequest {
                    system: None,
                    prompt: "test".into(),
                    model: None,
                    max_tokens: Some(10),
                    temperature: None,
                })
                .await;
            let text = match result {
                Ok(r) => r.text,
                Err(e) => e.to_string(),
            };
            assert!(text.contains(expected));
            assert!(!text.contains("must-not-leak"));
            handle.join().unwrap();
        }
    }
    #[tokio::test]
    async fn unavailable_connection_is_redacted() {
        let p = CloudProvider::new(
            "openai".into(),
            "http://127.0.0.1:1/v1".into(),
            "test".into(),
            "test-only-key".into(),
            2,
        )
        .unwrap();
        let e = p
            .complete(LlmRequest {
                system: None,
                prompt: "test".into(),
                model: None,
                max_tokens: None,
                temperature: None,
            })
            .await
            .unwrap_err()
            .to_string();
        assert!(e.contains("network failure"));
        assert!(!e.contains("test-only-key"));
    }
}
