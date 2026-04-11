// E+F+H. Provider 配置与凭据 + 使用统计 + 自定义提示词 Command
// 对应 rust-backend-system.md Section 7.3 E + F + H
use serde::Serialize;
use tauri::State;

use crate::{
    app_state::AppState,
    models::ProviderId,
    storage::{custom_prompts, provider_settings, usage_events},
};

/// Provider 配置 DTO（脱敏）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigDto {
    pub provider: ProviderId,
    pub model: String,
    pub base_url: Option<String>,
    pub is_active: bool,
    pub masked_key: Option<String>,
    pub last_test_status: Option<String>,
    pub last_tested_at: Option<String>,
}

/// Provider 连接测试结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectivityDto {
    pub provider: ProviderId,
    pub model: String,
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// 删除 Key 结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProviderKeyResult {
    pub provider: ProviderId,
    pub removed: bool,
}

/// 使用统计 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatsDto {
    pub by_provider: Vec<ProviderUsageDto>,
    pub total: UsageTotalDto,
}

/// 单 Provider 使用统计
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageDto {
    pub provider: ProviderId,
    pub model: String,
    pub by_feature: Vec<FeatureUsageDto>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
}

/// 单功能维度使用统计
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureUsageDto {
    pub feature: String,
    pub count: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
}

/// 使用统计汇总
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotalDto {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
    pub currency: String,
}

// --- E. Provider 配置与凭据 (5 个) ---

/// 返回脱敏配置与当前激活状态
#[tauri::command]
pub fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigDto>, crate::errors::AppError> {
    let records = {
        let connection = state.storage.connection();
        provider_settings::list_all(&connection)?
    };

    records
        .into_iter()
        .map(|record| build_provider_config_dto(&state, record))
        .collect()
}

/// Key 写入 Keychain，同时将脱敏 Key 存入 DB
#[tauri::command]
pub fn save_provider_key(
    state: State<'_, AppState>,
    provider: ProviderId,
    api_key: String,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    state.keychain.save_key(provider.as_str(), &api_key)?;

    // 将脱敏 key 同步写入 DB，后续显示设置页面无需访问 Keychain
    let masked = state.keychain.mask_key(&api_key);
    let record = {
        let connection = state.storage.connection();
        provider_settings::update_masked_key(&connection, provider.as_str(), Some(&masked))?;
        provider_settings::get_by_provider(&connection, provider.as_str())?
    }
    .ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::ProviderNotConfigured,
            "Provider 配置不存在",
            false,
        )
    })?;

    build_provider_config_dto(&state, record)
}

/// 删除 Keychain 中的 Key，同时清除 DB 中的脱敏 Key
#[tauri::command]
pub fn remove_provider_key(
    state: State<'_, AppState>,
    provider: ProviderId,
) -> Result<RemoveProviderKeyResult, crate::errors::AppError> {
    let removed = state.keychain.delete_key(provider.as_str())?;

    if removed {
        let connection = state.storage.connection();
        provider_settings::update_masked_key(&connection, provider.as_str(), None)?;
    }

    Ok(RemoveProviderKeyResult { provider, removed })
}

/// 修改当前生效 Provider 与模型
#[tauri::command]
pub fn set_active_provider(
    state: State<'_, AppState>,
    provider: ProviderId,
    model: String,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    let record = {
        let mut connection = state.storage.connection();
        provider_settings::set_active(&mut connection, provider.as_str(), &model)?
    };

    build_provider_config_dto(&state, record)
}

/// 实际发送测试请求验证连接
#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, AppState>,
    provider: ProviderId,
    model: Option<String>,
) -> Result<ProviderConnectivityDto, crate::errors::AppError> {
    let result = state.ai_integration.test_connection(provider, model).await;
    let tested_at = chrono::Utc::now().to_rfc3339();

    {
        let connection = state.storage.connection();
        match &result {
            Ok(_) => provider_settings::update_test_status(
                &connection,
                provider.as_str(),
                Some("ok"),
                Some(&tested_at),
            )?,
            Err(error) => provider_settings::update_test_status(
                &connection,
                provider.as_str(),
                Some(&error.message),
                Some(&tested_at),
            )?,
        }
    }

    let result = result?;
    Ok(ProviderConnectivityDto {
        provider: result.provider,
        model: result.model,
        success: result.success,
        latency_ms: result.latency_ms,
        error: result.error,
    })
}

/// 更新 Provider 配置（base_url、model）
#[tauri::command]
pub fn update_provider_config(
    state: State<'_, AppState>,
    provider: ProviderId,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    let normalized_base_url = base_url
        .as_deref()
        .map(|value| crate::ai_integration::provider_registry::normalize_base_url(provider, value));

    // 写入前校验 base_url 安全性
    if let Some(ref url) = normalized_base_url {
        crate::ai_integration::provider_registry::validate_base_url(url)?;
    }

    let record = {
        let connection = state.storage.connection();
        provider_settings::update_config(
            &connection,
            provider.as_str(),
            normalized_base_url.as_deref(),
            model.as_deref(),
        )?
    }
    .ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::InternalError,
            "未找到对应 Provider 配置",
            false,
        )
    })?;

    build_provider_config_dto(&state, record)
}

/// 可用模型列表项
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: Option<String>,
}

/// 拉取模型列表结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchModelsResult {
    pub provider: ProviderId,
    pub models: Vec<ModelInfo>,
}

/// 通过 /v1/models 拉取可用模型列表
#[tauri::command]
pub async fn fetch_available_models(
    state: State<'_, AppState>,
    provider: ProviderId,
) -> Result<FetchModelsResult, crate::errors::AppError> {
    // 读取 provider 配置获取 base_url 和 key
    let record = {
        let connection = state.storage.connection();
        provider_settings::get_by_provider(&connection, provider.as_str())?
    }
    .ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::InternalError,
            "未找到对应 Provider 配置",
            false,
        )
    })?;

    let api_key = state.keychain.get_key(provider.as_str())?.ok_or_else(|| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::ProviderKeyMissing,
            "请先配置 API Key",
            false,
        )
    })?;

    let has_custom_base_url = record.base_url.is_some();
    let base_url = record
        .base_url
        .map(|value| crate::ai_integration::provider_registry::normalize_base_url(provider, &value))
        .unwrap_or_else(|| {
            crate::ai_integration::provider_registry::default_base_url(provider).to_string()
        });

    // 读取后校验（防止历史脏数据泄露 Key）
    if has_custom_base_url {
        crate::ai_integration::provider_registry::validate_base_url(&base_url)?;
    }

    let base_url = base_url.trim_end_matches('/');

    // 构建 models 请求（base_url 已包含版本前缀如 /v1 或 /v1beta）
    let url = format!("{}/models", base_url);

    let client = reqwest::Client::new();
    let mut request_builder = client.get(&url);

    // 设置认证头
    match provider {
        ProviderId::Openai | ProviderId::Claude => {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", api_key));
            if provider == ProviderId::Claude {
                request_builder = request_builder.header("x-api-key", &api_key);
                request_builder = request_builder.header("anthropic-version", "2023-06-01");
            }
        }
        ProviderId::Gemini => {
            // Gemini 使用 query param
            request_builder = request_builder.query(&[("key", &api_key)]);
        }
    }

    let response = request_builder
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|err| {
            crate::errors::AppError::new(
                crate::errors::AppErrorCode::ProviderConnectionFailed,
                format!("拉取模型列表失败: {}", err),
                true,
            )
        })?;

    // W3: HTTP 状态码检查
    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(
            crate::ai_integration::provider_registry::map_provider_http_error(
                status,
                &error_body,
                "拉取模型列表失败",
            ),
        );
    }

    let body: serde_json::Value = response.json().await.map_err(|err| {
        crate::errors::AppError::new(
            crate::errors::AppErrorCode::ProviderConnectionFailed,
            format!("解析模型列表响应失败: {}", err),
            true,
        )
    })?;

    // 解析不同 Provider 的响应格式
    let models = match provider {
        ProviderId::Openai => {
            // OpenAI 格式: { "data": [{ "id": "gpt-4o", ... }] }
            body["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["id"].as_str().map(|id| ModelInfo {
                        id: id.to_string(),
                        name: m["id"].as_str().map(String::from),
                    })
                })
                .collect()
        }
        ProviderId::Claude => {
            // Claude 格式: { "data": [{ "id": "claude-sonnet-4-20250514", "display_name": "..." }] }
            body["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["id"].as_str().map(|id| ModelInfo {
                        id: id.to_string(),
                        name: m["display_name"].as_str().map(String::from),
                    })
                })
                .collect()
        }
        ProviderId::Gemini => {
            // Gemini 格式: { "models": [{ "name": "models/gemini-2.5-pro", "displayName": "..." }] }
            body["models"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["name"].as_str().map(|name| {
                        let id = name.strip_prefix("models/").unwrap_or(name);
                        ModelInfo {
                            id: id.to_string(),
                            name: m["displayName"].as_str().map(String::from),
                        }
                    })
                })
                .collect()
        }
    };

    Ok(FetchModelsResult { provider, models })
}

// --- F. 使用统计 (1 个) ---

/// 汇总问答、总结、翻译消耗
#[tauri::command]
pub fn get_usage_stats(
    state: State<'_, AppState>,
    from: Option<String>,
    to: Option<String>,
    provider: Option<ProviderId>,
) -> Result<UsageStatsDto, crate::errors::AppError> {
    let events = {
        let connection = state.storage.connection();
        usage_events::list_filtered(
            &connection,
            from.as_deref(),
            to.as_deref(),
            provider.as_ref().map(|p| p.as_str()),
        )?
    };

    let mut by_provider: Vec<ProviderUsageDto> = Vec::new();
    let mut total_input = 0;
    let mut total_output = 0;
    let mut total_cost = 0.0;

    for event in events {
        total_input += event.input_tokens;
        total_output += event.output_tokens;
        total_cost += event.estimated_cost;

        let provider_id = event.provider.parse()?;
        let position = by_provider
            .iter()
            .position(|entry| entry.provider == provider_id && entry.model == event.model);

        let entry = if let Some(position) = position {
            &mut by_provider[position]
        } else {
            by_provider.push(ProviderUsageDto {
                provider: provider_id,
                model: event.model.clone(),
                by_feature: Vec::new(),
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0.0,
            });
            by_provider.last_mut().unwrap_or_else(|| unreachable!())
        };

        entry.input_tokens += event.input_tokens;
        entry.output_tokens += event.output_tokens;
        entry.estimated_cost += event.estimated_cost;

        let feature_position = entry
            .by_feature
            .iter()
            .position(|feature| feature.feature == event.feature);
        let feature = if let Some(position) = feature_position {
            &mut entry.by_feature[position]
        } else {
            entry.by_feature.push(FeatureUsageDto {
                feature: event.feature.clone(),
                count: 0,
                input_tokens: 0,
                output_tokens: 0,
                estimated_cost: 0.0,
            });
            entry
                .by_feature
                .last_mut()
                .unwrap_or_else(|| unreachable!())
        };

        feature.count += 1;
        feature.input_tokens += event.input_tokens;
        feature.output_tokens += event.output_tokens;
        feature.estimated_cost += event.estimated_cost;
    }

    Ok(UsageStatsDto {
        by_provider,
        total: UsageTotalDto {
            input_tokens: total_input,
            output_tokens: total_output,
            estimated_cost: total_cost,
            currency: "USD".to_string(),
        },
    })
}

// --- G. 缓存统计与清理 (2 个) ---

/// 缓存统计 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatsDto {
    pub total_bytes: u64,
    pub translation_bytes: u64,
    pub summary_bytes: u64,
    pub summary_count: u32,
    pub document_count: u32,
}

/// 清理全部翻译缓存结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearCacheResult {
    pub freed_bytes: u64,
}

/// 获取缓存统计：翻译产物总字节数、总结字节数、文档数量
#[tauri::command]
pub fn get_cache_stats(
    state: State<'_, AppState>,
) -> Result<CacheStatsDto, crate::errors::AppError> {
    let connection = state.storage.connection();

    // 翻译产物总字节数
    let translation_bytes: u64 = connection.query_row(
        "SELECT COALESCE(SUM(file_size_bytes), 0) FROM translation_artifacts",
        [],
        |row| row.get(0),
    )?;

    // AI 总结存储字节数（Markdown 文本长度之和）
    let summary_bytes: u64 = connection.query_row(
        "SELECT COALESCE(SUM(LENGTH(content_md)), 0) FROM document_summaries",
        [],
        |row| row.get(0),
    )?;

    // AI 总结数量
    let summary_count: u32 = connection.query_row(
        "SELECT COUNT(*) FROM document_summaries",
        [],
        |row| row.get(0),
    )?;

    // 活跃文档数量（未软删除）
    let document_count: u32 = connection.query_row(
        "SELECT COUNT(*) FROM documents WHERE is_deleted = 0",
        [],
        |row| row.get(0),
    )?;

    Ok(CacheStatsDto {
        total_bytes: translation_bytes + summary_bytes,
        translation_bytes,
        summary_bytes,
        summary_count,
        document_count,
    })
}

/// 清理所有翻译缓存：删除文件 + 数据库记录
#[tauri::command]
pub fn clear_all_translation_cache(
    state: State<'_, AppState>,
) -> Result<ClearCacheResult, crate::errors::AppError> {
    let connection = state.storage.connection();

    // R3-M2: 检查是否有活跃翻译任务，防止竞态
    let active_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM translation_jobs WHERE status IN ('pending', 'running')",
        [],
        |row| row.get(0),
    )?;
    if active_count > 0 {
        return Err(crate::errors::AppError::new(
            crate::errors::AppErrorCode::InternalError,
            format!("当前有 {} 个翻译任务正在进行，请先取消后再清理缓存", active_count),
            false,
        ));
    }

    let transaction = connection.unchecked_transaction()?;

    // 查询所有翻译产物文件路径和大小
    let artifacts: Vec<(String, u64)> = {
        let mut statement = transaction.prepare(
            "SELECT file_path, file_size_bytes FROM translation_artifacts",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>("file_path")?,
                row.get::<_, u64>("file_size_bytes")?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut freed_bytes: u64 = 0;
    for (file_path, size) in &artifacts {
        let path = std::path::Path::new(file_path);
        match std::fs::remove_file(path) {
            Ok(()) => freed_bytes += size,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                // 文件已不存在，仍计入释放量（数据库记录即将删除）
                freed_bytes += size;
            }
            Err(err) => {
                // 记录日志但不中断整体清理流程
                eprintln!("清理翻译缓存文件失败 {}: {}", file_path, err);
            }
        }
    }

    // 删除数据库记录
    transaction.execute("DELETE FROM translation_artifacts", [])?;
    transaction.execute("DELETE FROM translation_jobs", [])?;
    transaction.commit()?;

    Ok(ClearCacheResult { freed_bytes })
}

// --- H. 自定义提示词 (3 个) ---

/// 默认翻译提示词（考古学论文，与 Python antigravity_translate/prompts.py 同步）
pub const DEFAULT_TRANSLATION_PROMPT: &str = "你是考古学论文的英译中引擎。读者是考古学研一新生，英文一般。\n目标：让读者像听导师用大白话讲论文一样轻松读懂。\n\n翻译要求：\n- 意译，不逐词硬译。读懂英文原意后用口语化的中文讲出来\n- 风格像导师给学生解释论文：通俗、好懂，可以适当展开解释\n- 英文论文写得很压缩，翻译时可以稍微展开说清楚，让人一读就明白\n- 不用第一人称，不用'xxx呢'句式\n\n翻译技巧：\n- 英文长句拆成中文短句，英文被动句翻成中文主动句\n- 不照搬英文语序，按中文说话习惯重新组织\n- 'It is worth noting that...' 之类的套话直接省掉，说内容\n- 'was found to be' 'has been shown to' 这类绕弯的说法简化\n- 少用'然而/此外/不仅如此'等书面连接词\n- 可以用'也就是说''简单来说''换句话说'来帮读者理解\n\n翻译示例：\n原：It is worth noting that these ceramics exhibit significant differences in their paste composition, suggesting that they were likely manufactured at different production centers.\n译：这些陶器的胎土成分差别很大，说明它们很可能不是在同一个地方烧制的，而是来自不同的生产中心。\n\n原：Through XRF analysis of the samples, we found that they contained relatively high concentrations of lead.\n译：用X射线荧光(XRF)分析这些样品后发现，里面的铅含量比较高。\n\n括注规则：\n- 只有地名和专业分析方法需要括注英文，其他一律不加括注\n- 地名首次出现时括注：瑙克拉提斯(Naucratis)、雅典(Athens)\n- 分析方法首次出现时括注：中子活化分析(NAA)、X射线荧光(XRF)\n- 除此之外不加任何英文括注\n\n保留原样不翻译：\n化学符号、样品编号、测量值(14C/BP/cal BC)、引用标记[1][Smith 2020]、人名保留英文";

/// 默认总结提示词（科技考古陶器研究方向 — 精读模板 v3）
///
/// 输出为 Markdown 精读笔记，包含 10 个模块。**不在 prompt 层面做格式硬约束**，
/// Callout 前缀 (`> `) 的补齐由后端 `normalize_callout_prefixes()` 后处理完成，
/// 避免长 prompt 引起的成本浪费与 LLM 注意力稀释。
pub const DEFAULT_SUMMARY_PROMPT: &str = "你是一位考古学博士研究生，研究方向是中国东南地区新石器时代至商代的陶器工艺（黑陶、黑衣陶、渗碳陶）、产地溯源、科技考古分析方法（XRF / XRD / SEM-EDS / EPMA / 拉曼光谱 / FTIR / TGA-DTA / 岩相薄片等）。请以该领域研究者的专业素养，基于下面的 PDF 正文摘录生成一份论文精读笔记。\n\n【写作风格】\n1. 平实的学术文风，用词准确、句式规整，不口语化、不故作高深。\n2. 考古学 / 材料科学中有通行说法就用通行说法，不自造术语。\n3. 慎用比喻修辞，用事实和数据说话。\n4. 中文为主，学术术语保留英文原文。\n5. 严格区分'作者明确表述'与'基于数据的合理推断'（后者标注'推测'）。\n6. 涉及术语翻译时，优先使用中国考古学 / 材料科学权威文献的通行译名；遇到与日常词汇同音的专有名词（如文化名、遗址名、矿物名），请以领域学者的审慎态度核对用字，避免写成更常见的同音日常词汇。\n7. 不要在笔记前加任何引言或说明，直接从 frontmatter 开始输出。\n\n【笔记结构】\n按以下顺序输出（模块无内容可省略，但 frontmatter / H1 标题 / 一句话结论三项必须出现）：\n\n1. YAML frontmatter：必须用裸 `---` 行包围，不要用 ```yaml 代码块。字段：title / authors / year / source / tags\n2. H1 论文中文标题\n3. 一句话结论（Obsidian callout: [!abstract]）\n4. ## 🏺 样品信息速览（表格：遗址 / 地理位置 / 年代 / 样品类型 / 样品数量 / 保存状况）\n5. ## 🔬 分析方法清单（列表：方法名 + 测量目标）\n6. ## 📖 术语与关键概念（表格）\n7. ## 🧱 技术链分析（4 个 [!info] callout：原料来源 → 成型工艺 → 烧成温度与气氛 → 表面处理）\n8. ## 📊 核心数据与图表解读（按重要性列 2-4 张图表，保留原始数值与单位）\n9. ## 📚 前置知识（[!note] callout）\n10. ## 🏗️ 文章结构标签（列表，带节号）\n11. ## ⚠️ 研究局限与未来方向（作者承认 / 读者推断 / 可推进方向）\n12. ## 🎯 与当前课题的关联度（[!tip] callout，课题是'黑陶烧制技术与呈色机理'；若无关则写'与当前黑陶课题无直接关联'）\n13. ## ❓ 待确认的疑问（2+ 个 [!question] callout）\n\n【内容原则】\n- 只基于摘录内容作答，不要声称访问了原 PDF。\n- 保留原始数据单位和精度：化学成分（如 Al₂O₃ 20.84 wt%）、温度、测年（cal BC/BP、14C）。\n- 化学符号、样品编号、引用标记 [1][Smith 2020] 保留原样。\n- LaTeX 公式用 $inline$ 或 $$block$$，下标如 $K_2O$、$Al_2O_3$。\n- 技术链模块按'原料来源 → 成型工艺 → 烧成温度与气氛 → 表面处理'顺序写。\n- 致黑机理（若涉及）须明确归入：渗碳 / 陶衣 / 漆灰涂层 / 还原铁相转变 / 石墨涂抹 之一。";

/// 论文评审模式总结提示词
pub const PAPER_REVIEW_SUMMARY_PROMPT: &str = "请以论文评审的视角，基于下面的 PDF 正文摘录生成评审摘要。\n说明：正文摘录来自前端对 PDF 的文本提取，可能包含少量版式噪声；请只基于摘录内容作答。\n\n请按照以下结构输出：\n1. 研究问题与创新性\n2. 方法论评价（优势与局限）\n3. 数据与证据质量\n4. 论证逻辑与结论合理性\n5. 改进建议";

/// 自定义提示词 DTO
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPromptDto {
    pub prompt_key: String,
    pub content: Option<String>,
    pub is_custom: bool,
    pub default_content: String,
}

/// 重置提示词结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCustomPromptResult {
    pub reset: bool,
}

/// 获取提示词默认值
fn default_prompt_for_key(key: &str) -> Result<&'static str, crate::errors::AppError> {
    match key {
        "translation" => Ok(DEFAULT_TRANSLATION_PROMPT),
        "summary" => Ok(DEFAULT_SUMMARY_PROMPT),
        _ => Err(crate::errors::AppError::new(
            crate::errors::AppErrorCode::InternalError,
            format!("不支持的提示词 key: '{}'，仅允许 'translation' 或 'summary'", key),
            false,
        )),
    }
}

/// 获取自定义提示词（含默认值）
#[tauri::command]
pub fn get_custom_prompt(
    state: State<'_, AppState>,
    prompt_key: String,
) -> Result<CustomPromptDto, crate::errors::AppError> {
    let default_content = default_prompt_for_key(&prompt_key)?;
    let content = {
        let connection = state.storage.connection();
        custom_prompts::get(&connection, &prompt_key)?
    };

    Ok(CustomPromptDto {
        prompt_key,
        is_custom: content.is_some(),
        content: content.clone(),
        default_content: default_content.to_string(),
    })
}

/// 保存自定义提示词
#[tauri::command]
pub fn save_custom_prompt(
    state: State<'_, AppState>,
    prompt_key: String,
    content: String,
) -> Result<CustomPromptDto, crate::errors::AppError> {
    let default_content = default_prompt_for_key(&prompt_key)?;
    let timestamp = chrono::Utc::now().to_rfc3339();

    {
        let connection = state.storage.connection();
        custom_prompts::upsert(&connection, &prompt_key, &content, &timestamp)?;
    }

    Ok(CustomPromptDto {
        prompt_key,
        content: Some(content),
        is_custom: true,
        default_content: default_content.to_string(),
    })
}

/// 重置提示词为默认值（删除自定义记录）
#[tauri::command]
pub fn reset_custom_prompt(
    state: State<'_, AppState>,
    prompt_key: String,
) -> Result<ResetCustomPromptResult, crate::errors::AppError> {
    let _ = default_prompt_for_key(&prompt_key)?;
    let reset = {
        let connection = state.storage.connection();
        custom_prompts::delete(&connection, &prompt_key)?
    };

    Ok(ResetCustomPromptResult { reset })
}

fn build_provider_config_dto(
    _state: &State<'_, AppState>,
    record: provider_settings::ProviderSettingRecord,
) -> Result<ProviderConfigDto, crate::errors::AppError> {
    // masked_key 直接从 DB 读取，不触发 Keychain 访问
    Ok(ProviderConfigDto {
        provider: record.provider.parse()?,
        model: record.model,
        base_url: record.base_url,
        is_active: record.is_active,
        masked_key: record.masked_key,
        last_test_status: record.last_test_status,
        last_tested_at: record.last_tested_at,
    })
}
