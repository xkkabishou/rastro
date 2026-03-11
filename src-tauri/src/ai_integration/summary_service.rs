// 总结流服务
use crate::{
    ai_integration::{chat_service, AiIntegration, GenerateSummaryRequest, StreamHandleResult},
    errors::AppError,
};

/// 启动总结流
pub async fn start_summary<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    ai: AiIntegration,
    input: GenerateSummaryRequest,
) -> Result<StreamHandleResult, AppError> {
    chat_service::start_summary_flow(app, ai, input).await
}
