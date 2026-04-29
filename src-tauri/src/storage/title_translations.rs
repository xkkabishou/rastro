// 标题翻译缓存表仓储
use rusqlite::{params, Connection, OptionalExtension, Row};
use sha2::{Digest, Sha256};

/// title_translations 表记录
#[derive(Debug, Clone)]
pub struct TitleTranslationRecord {
    pub title_hash: String,
    #[allow(dead_code)]
    pub original_title: String,
    pub translated_title: String,
    #[allow(dead_code)]
    pub provider: String,
    #[allow(dead_code)]
    pub model: String,
    #[allow(dead_code)]
    pub created_at: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<TitleTranslationRecord> {
    Ok(TitleTranslationRecord {
        title_hash: row.get("title_hash")?,
        original_title: row.get("original_title")?,
        translated_title: row.get("translated_title")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        created_at: row.get("created_at")?,
    })
}

/// 计算标题的 SHA-256 哈希（十六进制）
pub fn hash_title(title: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// 通过哈希查询单个标题翻译
pub fn get_by_hash(
    connection: &Connection,
    title_hash: &str,
) -> rusqlite::Result<Option<TitleTranslationRecord>> {
    connection
        .query_row(
            "SELECT * FROM title_translations WHERE title_hash = ?1",
            params![title_hash],
            map_row,
        )
        .optional()
}

/// 插入一条标题翻译记录
pub fn insert(
    connection: &Connection,
    title_hash: &str,
    original_title: &str,
    translated_title: &str,
    provider: &str,
    model: &str,
    created_at: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR REPLACE INTO title_translations
         (title_hash, original_title, translated_title, provider, model, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            title_hash,
            original_title,
            translated_title,
            provider,
            model,
            created_at,
        ],
    )?;
    Ok(())
}

/// 从给定标题列表中返回尚未缓存的标题
#[allow(dead_code)] // 预留的缓存筛选函数，测试中有覆盖
pub fn list_uncached_titles(
    connection: &Connection,
    titles: &[String],
) -> rusqlite::Result<Vec<String>> {
    if titles.is_empty() {
        return Ok(Vec::new());
    }

    // 计算所有标题的哈希
    let hashes: Vec<String> = titles.iter().map(|t| hash_title(t)).collect();

    // 查询已缓存的哈希
    let placeholders: String = hashes
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT title_hash FROM title_translations WHERE title_hash IN ({})",
        placeholders
    );

    let mut statement = connection.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = hashes
        .iter()
        .map(|h| h as &dyn rusqlite::types::ToSql)
        .collect();
    let cached_hashes: Vec<String> = statement
        .query_map(params.as_slice(), |row| row.get::<_, String>(0))?
        .filter_map(Result::ok)
        .collect();

    // 返回未缓存的原始标题
    Ok(titles
        .iter()
        .zip(hashes.iter())
        .filter(|(_, hash)| !cached_hashes.contains(hash))
        .map(|(title, _)| title.clone())
        .collect())
}

/// 批量查询标题翻译（返回 原始标题哈希 → 翻译记录）
pub fn batch_get(
    connection: &Connection,
    hashes: &[String],
) -> rusqlite::Result<Vec<TitleTranslationRecord>> {
    if hashes.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders: String = hashes
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT * FROM title_translations WHERE title_hash IN ({})",
        placeholders
    );

    let mut statement = connection.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = hashes
        .iter()
        .map(|h| h as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = statement.query_map(params.as_slice(), map_row)?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use crate::storage::Storage;

    use super::{batch_get, get_by_hash, hash_title, insert, list_uncached_titles};

    #[test]
    fn hash_title_is_deterministic() {
        let h1 = hash_title("Hello World");
        let h2 = hash_title("Hello World");
        assert_eq!(h1, h2);
        assert_ne!(h1, hash_title("hello world"));
    }

    #[test]
    fn insert_and_get_by_hash_roundtrip() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();

        let title = "Ceramic Analysis in Ancient Greece";
        let hash = hash_title(title);
        insert(
            &connection,
            &hash,
            title,
            "古希腊陶器分析",
            "openai",
            "gpt-4o-mini",
            "2026-03-18T00:00:00Z",
        )
        .unwrap();

        let record = get_by_hash(&connection, &hash).unwrap().unwrap();
        assert_eq!(record.original_title, title);
        assert_eq!(record.translated_title, "古希腊陶器分析");
        assert_eq!(record.provider, "openai");
    }

    #[test]
    fn list_uncached_titles_filters_correctly() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();

        let cached_title = "Already Translated Title".to_string();
        let uncached_title = "New Title".to_string();

        // 插入一条缓存
        let hash = hash_title(&cached_title);
        insert(
            &connection,
            &hash,
            &cached_title,
            "已翻译的标题",
            "openai",
            "gpt-4o-mini",
            "2026-03-18T00:00:00Z",
        )
        .unwrap();

        let uncached =
            list_uncached_titles(&connection, &[cached_title.clone(), uncached_title.clone()])
                .unwrap();
        assert_eq!(uncached.len(), 1);
        assert_eq!(uncached[0], uncached_title);
    }

    #[test]
    fn batch_get_returns_matching_records() {
        let storage = Storage::new_in_memory().unwrap();
        let connection = storage.connection();

        let title1 = "Title One";
        let title2 = "Title Two";
        let hash1 = hash_title(title1);
        let hash2 = hash_title(title2);

        insert(
            &connection,
            &hash1,
            title1,
            "标题一",
            "openai",
            "gpt-4o-mini",
            "2026-03-18T00:00:00Z",
        )
        .unwrap();
        insert(
            &connection,
            &hash2,
            title2,
            "标题二",
            "gemini",
            "gemini-flash",
            "2026-03-18T00:00:00Z",
        )
        .unwrap();

        let results = batch_get(&connection, &[hash1.clone(), hash2.clone()]).unwrap();
        assert_eq!(results.len(), 2);

        // 不存在的哈希
        let empty = batch_get(&connection, &["nonexistent".to_string()]).unwrap();
        assert!(empty.is_empty());
    }
}
