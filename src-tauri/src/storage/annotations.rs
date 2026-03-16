// annotations 表仓储
#![allow(dead_code)]

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// annotations 表记录
#[derive(Debug, Clone)]
pub struct AnnotationRecord {
    pub annotation_id: String,
    pub document_id: String,
    pub annotation_type: String,
    pub color: String,
    pub page_number: i64,
    pub selected_text: String,
    pub note_content: Option<String>,
    pub rects_json: String,
    pub created_at: String,
    pub updated_at: String,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<AnnotationRecord> {
    Ok(AnnotationRecord {
        annotation_id: row.get("annotation_id")?,
        document_id: row.get("document_id")?,
        annotation_type: row.get("annotation_type")?,
        color: row.get("color")?,
        page_number: row.get("page_number")?,
        selected_text: row.get("selected_text")?,
        note_content: row.get("note_content")?,
        rects_json: row.get("rects_json")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 创建标注参数
pub struct CreateAnnotationParams {
    pub document_id: String,
    pub annotation_type: String,
    pub color: String,
    pub page_number: i64,
    pub selected_text: String,
    pub note_content: Option<String>,
    pub rects_json: String,
}

/// 更新标注参数
pub struct UpdateAnnotationParams {
    pub annotation_id: String,
    pub color: Option<String>,
    pub note_content: Option<String>,
}

/// 创建标注
pub fn create(
    connection: &Connection,
    params: &CreateAnnotationParams,
) -> rusqlite::Result<AnnotationRecord> {
    let annotation_id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().to_rfc3339();

    connection.execute(
        "INSERT INTO annotations (
            annotation_id, document_id, annotation_type, color,
            page_number, selected_text, note_content, rects_json,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            annotation_id,
            params.document_id,
            params.annotation_type,
            params.color,
            params.page_number,
            params.selected_text,
            params.note_content,
            params.rects_json,
            timestamp,
            timestamp,
        ],
    )?;

    get_by_id(connection, &annotation_id)
        .map(|record| record.expect("just-inserted annotation should be queryable"))
}

/// 按 annotation_id 查询
pub fn get_by_id(
    connection: &Connection,
    annotation_id: &str,
) -> rusqlite::Result<Option<AnnotationRecord>> {
    connection
        .query_row(
            "SELECT * FROM annotations WHERE annotation_id = ?1",
            params![annotation_id],
            map_row,
        )
        .optional()
}

/// 更新标注（颜色、笔记内容）
pub fn update(
    connection: &Connection,
    params: &UpdateAnnotationParams,
) -> rusqlite::Result<Option<AnnotationRecord>> {
    let timestamp = Utc::now().to_rfc3339();

    // 构建动态 SET 子句
    let mut set_parts = vec!["updated_at = ?1".to_string()];
    let mut param_index = 2u32;

    if params.color.is_some() {
        set_parts.push(format!("color = ?{param_index}"));
        param_index += 1;
    }
    // note_content 始终更新（允许设为 NULL 来清空笔记）
    if params.note_content.is_some() {
        set_parts.push(format!("note_content = ?{param_index}"));
        param_index += 1;
    }

    let sql = format!(
        "UPDATE annotations SET {} WHERE annotation_id = ?{}",
        set_parts.join(", "),
        param_index
    );

    // 构建参数列表
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(timestamp)];
    if let Some(ref color) = params.color {
        values.push(Box::new(color.clone()));
    }
    if let Some(ref note_content) = params.note_content {
        values.push(Box::new(note_content.clone()));
    }
    values.push(Box::new(params.annotation_id.clone()));

    let refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    let affected = connection.execute(&sql, refs.as_slice())?;

    if affected == 0 {
        return Ok(None);
    }

    get_by_id(connection, &params.annotation_id)
}

/// 删除标注
pub fn delete(connection: &Connection, annotation_id: &str) -> rusqlite::Result<bool> {
    let affected = connection.execute(
        "DELETE FROM annotations WHERE annotation_id = ?1",
        params![annotation_id],
    )?;
    Ok(affected > 0)
}

/// 按文档 ID 查询所有标注（按页码 + 创建时间排序）
pub fn list_by_document(
    connection: &Connection,
    document_id: &str,
) -> rusqlite::Result<Vec<AnnotationRecord>> {
    let mut stmt = connection.prepare(
        "SELECT * FROM annotations
         WHERE document_id = ?1
         ORDER BY page_number ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![document_id], map_row)?;
    rows.collect()
}

/// 按文档 ID + 页码查询标注
pub fn list_by_document_and_page(
    connection: &Connection,
    document_id: &str,
    page_number: i64,
) -> rusqlite::Result<Vec<AnnotationRecord>> {
    let mut stmt = connection.prepare(
        "SELECT * FROM annotations
         WHERE document_id = ?1 AND page_number = ?2
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![document_id, page_number], map_row)?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection};

    use super::*;

    fn setup_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE documents (
                  document_id TEXT PRIMARY KEY
                );

                CREATE TABLE annotations (
                  annotation_id   TEXT PRIMARY KEY,
                  document_id     TEXT NOT NULL REFERENCES documents(document_id),
                  annotation_type TEXT NOT NULL,
                  color           TEXT NOT NULL DEFAULT 'yellow',
                  page_number     INTEGER NOT NULL,
                  selected_text   TEXT NOT NULL DEFAULT '',
                  note_content    TEXT,
                  rects_json      TEXT NOT NULL,
                  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX idx_annotations_document_id ON annotations(document_id);
                CREATE INDEX idx_annotations_document_page ON annotations(document_id, page_number);
                "#,
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO documents (document_id) VALUES (?1)",
                params!["doc-1"],
            )
            .unwrap();
        connection
    }

    fn sample_rects_json() -> String {
        r#"[{"x":10.0,"y":20.0,"width":100.0,"height":12.0,"pageNumber":1}]"#.to_string()
    }

    #[test]
    fn create_and_get_annotation() {
        let conn = setup_connection();
        let record = create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "highlight".into(),
                color: "yellow".into(),
                page_number: 1,
                selected_text: "hello world".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();

        assert_eq!(record.document_id, "doc-1");
        assert_eq!(record.annotation_type, "highlight");
        assert_eq!(record.color, "yellow");
        assert_eq!(record.page_number, 1);
        assert_eq!(record.selected_text, "hello world");
        assert!(record.note_content.is_none());

        let fetched = get_by_id(&conn, &record.annotation_id).unwrap().unwrap();
        assert_eq!(fetched.annotation_id, record.annotation_id);
    }

    #[test]
    fn update_color_and_note() {
        let conn = setup_connection();
        let record = create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "highlight".into(),
                color: "yellow".into(),
                page_number: 1,
                selected_text: "test".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();

        let updated = update(
            &conn,
            &UpdateAnnotationParams {
                annotation_id: record.annotation_id.clone(),
                color: Some("red".into()),
                note_content: Some("my note".into()),
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(updated.color, "red");
        assert_eq!(updated.note_content.as_deref(), Some("my note"));
        assert_ne!(updated.updated_at, record.updated_at);
    }

    #[test]
    fn update_nonexistent_returns_none() {
        let conn = setup_connection();
        let result = update(
            &conn,
            &UpdateAnnotationParams {
                annotation_id: "nonexistent".into(),
                color: Some("red".into()),
                note_content: None,
            },
        )
        .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn delete_annotation_reports_existence() {
        let conn = setup_connection();
        let record = create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "underline".into(),
                color: "blue".into(),
                page_number: 2,
                selected_text: "delete me".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();

        assert!(delete(&conn, &record.annotation_id).unwrap());
        assert!(!delete(&conn, &record.annotation_id).unwrap());
        assert!(get_by_id(&conn, &record.annotation_id).unwrap().is_none());
    }

    #[test]
    fn list_by_document_orders_by_page_then_time() {
        let conn = setup_connection();
        // 页 2
        create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "highlight".into(),
                color: "yellow".into(),
                page_number: 2,
                selected_text: "page 2".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();
        // 页 1
        create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "underline".into(),
                color: "red".into(),
                page_number: 1,
                selected_text: "page 1".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();

        let all = list_by_document(&conn, "doc-1").unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].page_number, 1);
        assert_eq!(all[1].page_number, 2);
    }

    #[test]
    fn list_by_document_and_page_filters_correctly() {
        let conn = setup_connection();
        create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "highlight".into(),
                color: "yellow".into(),
                page_number: 1,
                selected_text: "p1".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();
        create(
            &conn,
            &CreateAnnotationParams {
                document_id: "doc-1".into(),
                annotation_type: "highlight".into(),
                color: "green".into(),
                page_number: 3,
                selected_text: "p3".into(),
                note_content: None,
                rects_json: sample_rects_json(),
            },
        )
        .unwrap();

        let page1 = list_by_document_and_page(&conn, "doc-1", 1).unwrap();
        assert_eq!(page1.len(), 1);
        assert_eq!(page1[0].selected_text, "p1");

        let page2 = list_by_document_and_page(&conn, "doc-1", 2).unwrap();
        assert!(page2.is_empty());
    }
}
