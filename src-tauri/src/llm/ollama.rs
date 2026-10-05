use super::provider::{LlmProvider, LlmRequest, LlmResponse};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

pub struct OllamaProvider {
    client: reqwest::Client,
    base_url: String,
    default_model: String,
}

impl OllamaProvider {
    pub fn new(base_url: impl Into<String>, default_model: impl Into<String>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            default_model: default_model.into(),
        }
    }
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: String,
    system: Option<String>,
    stream: bool,
    // Disables reasoning-mode wrapping for "thinking" models (e.g. gemma4:e2b).
    // Without it, Ollama keeps the user-visible `response` empty until the much
    // larger thinking budget is hit. Non-thinking models ignore the field.
    think: bool,
    options: GenerateOptions,
}

#[derive(Serialize, Default)]
struct GenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
    #[serde(default)]
    model: String,
}

impl LlmProvider for OllamaProvider {
    fn name(&self) -> &'static str {
        "ollama"
    }

    fn complete<'a>(
        &'a self,
        req: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<LlmResponse>> + Send + 'a>> {
        Box::pin(async move {
            let model = req.model.clone().unwrap_or_else(|| self.default_model.clone());
            let body = GenerateRequest {
                model: &model,
                prompt: req.prompt,
                system: req.system,
                stream: false,
                think: false,
                options: GenerateOptions {
                    temperature: req.temperature,
                    num_predict: req.max_tokens,
                },
            };
            let url = format!("{}/api/generate", self.base_url);
            let resp = self
                .client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::LlmUnavailable(if e.is_timeout() { "Ollama timeout" } else { "Ollama network failure" }.into()))?;

            if !resp.status().is_success() {
                let status = resp.status();
                return Err(AppError::LlmUnavailable(format!(
                    "ollama responded with status {}",
                    status.as_u16()
                )));
            }

            let parsed: GenerateResponse = serde_json::from_value(super::cloud::bounded_json(resp).await?)
                .map_err(|_| AppError::LlmUnavailable("ollama returned an invalid response".into()))?;
            if parsed.response.trim().is_empty() || parsed.response.len() > 65536 || parsed.model.len() > 150 {
                return Err(AppError::LlmUnavailable("ollama returned an invalid response".into()));
            }

            Ok(LlmResponse {
                text: parsed.response.trim().to_string(),
                model: if parsed.model.is_empty() { model } else { parsed.model },
            })
        })
    }
}
