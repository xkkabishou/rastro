use std::{
    env,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};

use crate::errors::{AppError, AppErrorCode};

pub const DEFAULT_PAGE_LIMIT: u32 = 50;
const MAX_PAGE_LIMIT: u32 = 200;
const PDF_CONTENT_TYPE: &str = "application/pdf";

#[derive(Debug, Clone)]
pub struct ZoteroCollection {
    pub collection_id: i64,
    pub key: String,
    pub name: String,
    pub parent_collection_id: Option<i64>,
    pub item_count: u32,
}

#[derive(Debug, Clone)]
pub struct ZoteroItemRecord {
    pub item_key: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<u32>,
    pub publication_title: Option<String>,
    pub pdf_path: Option<String>,
    pub date_added: String,
}

#[derive(Debug, Clone)]
pub struct ZoteroItemsPage {
    pub items: Vec<ZoteroItemRecord>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone)]
pub struct ResolvedAttachment {
    pub parent_item_key: String,
    pub file_path: PathBuf,
    /// Zotero 元数据中的文献标题
    pub title: Option<String>,
}

#[derive(Debug, Clone)]
struct ZoteroLibrary {
    database_path: PathBuf,
    profile_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct AttachmentReference {
    parent_item_key: String,
    attachment_key: String,
    attachment_path: String,
}

#[derive(Debug, Clone)]
pub struct ZoteroConnector {
    library: ZoteroLibrary,
}

impl ZoteroConnector {
    pub fn detect() -> Result<Self, AppError> {
        for candidate in candidate_database_paths() {
            if !candidate.is_file() {
                continue;
            }

            let profile_dir = candidate.parent().map(Path::to_path_buf).ok_or_else(|| {
                AppError::new(
                    AppErrorCode::ZoteroNotFound,
                    "Zotero 数据库路径缺少 profile 目录",
                    false,
                )
            })?;
            let connector = Self {
                library: ZoteroLibrary {
                    database_path: candidate,
                    profile_dir,
                },
            };
            connector.verify_connection()?;
            return Ok(connector);
        }

        Err(AppError::new(
            AppErrorCode::ZoteroNotFound,
            "未检测到 Zotero 数据库，请先安装 Zotero 并添加文献",
            false,
        ))
    }

    pub fn database_path(&self) -> &Path {
        &self.library.database_path
    }

    /// 获取 Zotero profile 目录（storage 所在的父目录）
    pub fn profile_dir(&self) -> &Path {
        &self.library.profile_dir
    }

    pub fn item_count(&self) -> Result<u32, AppError> {
        let connection = self.open_connection()?;
        connection
            .query_row(
                "SELECT COUNT(DISTINCT ia.parentItemID)
                 FROM itemAttachments ia
                 WHERE ia.parentItemID IS NOT NULL
                   AND LOWER(COALESCE(ia.contentType, '')) = ?1
                   AND NOT EXISTS (
                       SELECT 1 FROM deletedItems di WHERE di.itemID = ia.parentItemID
                   )",
                params![PDF_CONTENT_TYPE],
                |row| row.get(0),
            )
            .map_err(map_sqlite_error)
    }

    /// 获取所有 Zotero collections（含每个 collection 的文献数量）
    pub fn fetch_collections(&self) -> Result<Vec<ZoteroCollection>, AppError> {
        let connection = self.open_connection()?;
        let mut statement = connection
            .prepare(
                "SELECT
                     c.collectionID,
                     c.key,
                     c.collectionName,
                     c.parentCollectionID,
                     (
                         SELECT COUNT(*)
                         FROM collectionItems ci
                         JOIN items i ON i.itemID = ci.itemID
                         WHERE ci.collectionID = c.collectionID
                           AND EXISTS (
                               SELECT 1 FROM itemAttachments ia
                               WHERE ia.parentItemID = i.itemID
                                 AND LOWER(COALESCE(ia.contentType, '')) = ?1
                           )
                           AND NOT EXISTS (
                               SELECT 1 FROM deletedItems di WHERE di.itemID = i.itemID
                           )
                     ) AS itemCount
                 FROM collections c
                 WHERE NOT EXISTS (
                     SELECT 1 FROM deletedCollections dc WHERE dc.collectionID = c.collectionID
                 )
                 ORDER BY c.collectionName ASC",
            )
            .map_err(map_sqlite_error)?;

        let rows = statement
            .query_map(params![PDF_CONTENT_TYPE], |row| {
                Ok(ZoteroCollection {
                    collection_id: row.get(0)?,
                    key: row.get(1)?,
                    name: row.get(2)?,
                    parent_collection_id: row.get(3)?,
                    item_count: row.get(4)?,
                })
            })
            .map_err(map_sqlite_error)?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)
    }

    /// 获取指定 collection 下的文献列表（分页）
    /// collection_id 为 None 时返回不属于任何 collection 的文献
    pub fn fetch_items_in_collection(
        &self,
        collection_id: Option<i64>,
        query: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<ZoteroItemsPage, AppError> {
        let limit = limit.clamp(1, MAX_PAGE_LIMIT);
        let (query_value, like_query) = normalize_query(query);
        let connection = self.open_connection()?;

        let (total, rows) = if let Some(cid) = collection_id {
            let total = query_total_in_collection(&connection, cid, &query_value, &like_query)?;
            let rows = query_page_in_collection(&connection, cid, &query_value, &like_query, offset, limit)?;
            (total, rows)
        } else {
            let total = query_total_uncategorized(&connection, &query_value, &like_query)?;
            let rows = query_page_uncategorized(&connection, &query_value, &like_query, offset, limit)?;
            (total, rows)
        };

        if rows.is_empty() {
            return Ok(ZoteroItemsPage {
                items: Vec::new(),
                total,
                offset,
                limit,
            });
        }

        let item_ids: Vec<i64> = rows.iter().map(|r| r.item_id).collect();
        let authors_map = batch_fetch_authors(&connection, &item_ids)?;
        let attachments_map = batch_fetch_first_attachments(&connection, &item_ids)?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let authors = authors_map.get(&row.item_id).cloned().unwrap_or_default();
            let pdf_path = attachments_map
                .get(&row.item_id)
                .and_then(|attachment| self.resolve_attachment_reference(attachment).ok())
                .map(|path| path.to_string_lossy().into_owned());

            items.push(ZoteroItemRecord {
                item_key: row.item_key,
                title: row.title,
                authors,
                year: extract_year(row.raw_year.as_deref()),
                publication_title: row.publication_title,
                pdf_path,
                date_added: row.date_added,
            });
        }

        Ok(ZoteroItemsPage {
            items,
            total,
            offset,
            limit,
        })
    }

    pub fn fetch_items(
        &self,
        query: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<ZoteroItemsPage, AppError> {
        let limit = limit.clamp(1, MAX_PAGE_LIMIT);
        let (query_value, like_query) = normalize_query(query);
        let connection = self.open_connection()?;
        let total = query_total(&connection, &query_value, &like_query)?;
        let rows = query_page(&connection, &query_value, &like_query, offset, limit)?;

        if rows.is_empty() {
            return Ok(ZoteroItemsPage {
                items: Vec::new(),
                total,
                offset,
                limit,
            });
        }

        let item_ids: Vec<i64> = rows.iter().map(|r| r.item_id).collect();
        let authors_map = batch_fetch_authors(&connection, &item_ids)?;
        let attachments_map = batch_fetch_first_attachments(&connection, &item_ids)?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let authors = authors_map.get(&row.item_id).cloned().unwrap_or_default();
            let pdf_path = attachments_map
                .get(&row.item_id)
                .and_then(|attachment| self.resolve_attachment_reference(attachment).ok())
                .map(|path| path.to_string_lossy().into_owned());

            items.push(ZoteroItemRecord {
                item_key: row.item_key,
                title: row.title,
                authors,
                year: extract_year(row.raw_year.as_deref()),
                publication_title: row.publication_title,
                pdf_path,
                date_added: row.date_added,
            });
        }

        Ok(ZoteroItemsPage {
            items,
            total,
            offset,
            limit,
        })
    }

    pub fn resolve_attachment(&self, item_key: &str) -> Result<ResolvedAttachment, AppError> {
        let connection = self.open_connection()?;
        let attachment =
            lookup_attachment_by_item_key(&connection, item_key)?.ok_or_else(|| {
                AppError::new(
                    AppErrorCode::DocumentNotFound,
                    "未找到对应的 Zotero PDF 附件",
                    false,
                )
                .with_detail("itemKey", item_key.to_string())
            })?;
        let file_path = self.resolve_attachment_reference(&attachment)?;

        // 查询 parent item 的标题
        let title = lookup_item_title(&connection, &attachment.parent_item_key).ok().flatten();

        Ok(ResolvedAttachment {
            parent_item_key: attachment.parent_item_key,
            file_path,
            title,
        })
    }

    fn verify_connection(&self) -> Result<(), AppError> {
        self.open_connection().map(|_| ())
    }

    fn open_connection(&self) -> Result<Connection, AppError> {
        // Zotero 运行时几乎总是持有 WAL 锁，优先使用 immutable 模式
        // 避免简单验证查询通过后复杂查询因锁超时的问题
        match self.open_connection_with_flags(true) {
            Ok(connection) => Ok(connection),
            Err(_) => self
                .open_connection_with_flags(false)
                .map_err(map_sqlite_error),
        }
    }

    fn open_connection_with_flags(&self, immutable: bool) -> Result<Connection, rusqlite::Error> {
        let mut flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let target = if immutable {
            flags |= OpenFlags::SQLITE_OPEN_URI;
            sqlite_immutable_uri(&self.library.database_path)
        } else {
            self.library.database_path.to_string_lossy().into_owned()
        };
        let connection = Connection::open_with_flags(&target, flags)?;
        connection.busy_timeout(Duration::from_millis(250))?;
        connection.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))?;
        Ok(connection)
    }

    fn resolve_attachment_reference(
        &self,
        attachment: &AttachmentReference,
    ) -> Result<PathBuf, AppError> {
        let resolved = resolve_attachment_path(
            &self.library.profile_dir,
            &attachment.attachment_key,
            &attachment.attachment_path,
        )
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::DocumentNotFound,
                "Zotero 附件路径格式不受支持",
                false,
            )
            .with_detail("attachmentPath", attachment.attachment_path.clone())
        })?;

        if !resolved.is_absolute() || !resolved.exists() {
            return Err(AppError::new(
                AppErrorCode::DocumentNotFound,
                "Zotero PDF 附件不存在",
                false,
            )
            .with_detail("attachmentPath", resolved.to_string_lossy().to_string()));
        }

        Ok(resolved)
    }

    // -----------------------------------------------------------------------
    // 写入：向 Zotero 添加附件
    // -----------------------------------------------------------------------

    /// 以读写模式打开 Zotero 数据库连接
    fn open_write_connection(&self) -> Result<Connection, AppError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let target = self.library.database_path.to_string_lossy().into_owned();
        let connection = Connection::open_with_flags(&target, flags).map_err(|e| {
            AppError::internal(format!(
                "无法以写入模式打开 Zotero 数据库（Zotero 是否正在运行？）: {}",
                e
            ))
        })?;
        // 写入操作需要更长的等待时间（Zotero 可能持有 WAL 锁）
        connection.busy_timeout(Duration::from_millis(5000)).map_err(map_sqlite_error)?;
        Ok(connection)
    }

    /// 向指定文献条目添加存储式附件（Markdown 文件）
    ///
    /// 步骤：
    /// 1. 查找 parent item 的 itemID 和 libraryID
    /// 2. 生成唯一 8 位 key
    /// 3. 在 storage 目录下创建子文件夹并写入文件
    /// 4. 插入 `items` 和 `itemAttachments` 两行记录
    pub fn add_stored_attachment(
        &self,
        parent_item_key: &str,
        filename: &str,
        content: &str,
        content_type: &str,
    ) -> Result<StoredAttachmentResult, AppError> {
        let connection = self.open_write_connection()?;

        // 查找 parent item
        let (parent_item_id, library_id): (i64, i64) = connection
            .query_row(
                "SELECT itemID, libraryID FROM items WHERE key = ?1",
                params![parent_item_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| {
                AppError::internal(format!(
                    "在 Zotero 中未找到 key={} 的文献条目",
                    parent_item_key
                ))
            })?;

        // 生成唯一 key
        let new_key = generate_unique_key(&connection)?;

        // 在 storage 目录下创建子文件夹并写入文件
        let storage_dir = self
            .library
            .profile_dir
            .join("storage")
            .join(&new_key);
        std::fs::create_dir_all(&storage_dir).map_err(|e| {
            AppError::internal(format!("创建 Zotero 存储目录失败: {}", e))
        })?;

        let file_path = storage_dir.join(filename);
        std::fs::write(&file_path, content).map_err(|e| {
            AppError::internal(format!("写入附件文件失败: {}", e))
        })?;

        // 在事务中插入数据库记录
        let now = chrono::Utc::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let storage_path = format!("storage:{}", filename);

        let tx = connection.unchecked_transaction().map_err(map_sqlite_error)?;

        // 插入 items 表（itemTypeID=3 = attachment）
        tx.execute(
            "INSERT INTO items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key, version, synced)
             VALUES (3, ?1, ?1, ?1, ?2, ?3, 0, 0)",
            params![now, library_id, new_key],
        )
        .map_err(|e| {
            AppError::internal(format!("插入 Zotero items 表失败: {}", e))
        })?;

        let new_item_id = tx
            .query_row("SELECT last_insert_rowid()", [], |row| row.get::<_, i64>(0))
            .map_err(map_sqlite_error)?;

        // 插入 itemAttachments 表（linkMode=0 = stored file）
        tx.execute(
            "INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path, syncState)
             VALUES (?1, ?2, 0, ?3, ?4, 0)",
            params![new_item_id, parent_item_id, content_type, storage_path],
        )
        .map_err(|e| {
            AppError::internal(format!("插入 Zotero itemAttachments 表失败: {}", e))
        })?;

        tx.commit().map_err(map_sqlite_error)?;

        Ok(StoredAttachmentResult {
            item_key: new_key,
            file_path: file_path.to_string_lossy().to_string(),
        })
    }

    /// 检查某个 parent item 下是否已存在同名附件（避免重复写入）
    pub fn find_attachment_by_name(
        &self,
        parent_item_key: &str,
        filename: &str,
    ) -> Result<Option<String>, AppError> {
        let connection = self.open_connection()?;
        let storage_path = format!("storage:{}", filename);

        let result: Option<String> = connection
            .query_row(
                "SELECT attachment.key
                 FROM itemAttachments ia
                 JOIN items attachment ON attachment.itemID = ia.itemID
                 JOIN items parent ON parent.itemID = ia.parentItemID
                 WHERE parent.key = ?1 AND ia.path = ?2
                 LIMIT 1",
                params![parent_item_key, storage_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(map_sqlite_error)?;

        Ok(result)
    }

    /// 更新已存在的存储式附件内容
    pub fn update_stored_attachment(
        &self,
        attachment_key: &str,
        filename: &str,
        content: &str,
    ) -> Result<String, AppError> {
        let file_path = self
            .library
            .profile_dir
            .join("storage")
            .join(attachment_key)
            .join(filename);

        std::fs::write(&file_path, content).map_err(|e| {
            AppError::internal(format!("更新附件文件失败: {}", e))
        })?;

        // 更新修改时间
        let connection = self.open_write_connection()?;
        let now = chrono::Utc::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        connection
            .execute(
                "UPDATE items SET dateModified = ?1, clientDateModified = ?1, synced = 0
                 WHERE key = ?2",
                params![now, attachment_key],
            )
            .map_err(map_sqlite_error)?;

        Ok(file_path.to_string_lossy().to_string())
    }

    /// 将已有的磁盘文件拷贝到 Zotero storage 并创建附件条目
    /// 用于同步翻译后的 PDF 等二进制文件
    pub fn add_file_attachment(
        &self,
        parent_item_key: &str,
        source_file_path: &Path,
        target_filename: &str,
        content_type: &str,
    ) -> Result<StoredAttachmentResult, AppError> {
        if !source_file_path.exists() {
            return Err(AppError::internal(format!(
                "源文件不存在: {}",
                source_file_path.display()
            )));
        }

        let connection = self.open_write_connection()?;

        // 查找 parent item
        let (parent_item_id, library_id): (i64, i64) = connection
            .query_row(
                "SELECT itemID, libraryID FROM items WHERE key = ?1",
                params![parent_item_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| {
                AppError::internal(format!(
                    "在 Zotero 中未找到 key={} 的文献条目",
                    parent_item_key
                ))
            })?;

        let new_key = generate_unique_key(&connection)?;

        // 拷贝文件到 storage 目录
        let storage_dir = self.library.profile_dir.join("storage").join(&new_key);
        std::fs::create_dir_all(&storage_dir).map_err(|e| {
            AppError::internal(format!("创建 Zotero 存储目录失败: {}", e))
        })?;

        let target_path = storage_dir.join(target_filename);
        // 使用软连接而非拷贝，节省磁盘空间
        std::os::unix::fs::symlink(source_file_path, &target_path).map_err(|e| {
            AppError::internal(format!("创建软连接到 Zotero 失败: {}", e))
        })?;

        // 插入数据库记录
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let storage_path = format!("storage:{}", target_filename);

        let tx = connection.unchecked_transaction().map_err(map_sqlite_error)?;

        tx.execute(
            "INSERT INTO items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key, version, synced)
             VALUES (3, ?1, ?1, ?1, ?2, ?3, 0, 0)",
            params![now, library_id, new_key],
        )
        .map_err(|e| AppError::internal(format!("插入 Zotero items 表失败: {}", e)))?;

        let new_item_id = tx
            .query_row("SELECT last_insert_rowid()", [], |row| row.get::<_, i64>(0))
            .map_err(map_sqlite_error)?;

        tx.execute(
            "INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path, syncState)
             VALUES (?1, ?2, 0, ?3, ?4, 0)",
            params![new_item_id, parent_item_id, content_type, storage_path],
        )
        .map_err(|e| AppError::internal(format!("插入 Zotero itemAttachments 表失败: {}", e)))?;

        tx.commit().map_err(map_sqlite_error)?;

        Ok(StoredAttachmentResult {
            item_key: new_key,
            file_path: target_path.to_string_lossy().to_string(),
        })
    }
}

/// 附件插入结果
#[derive(Debug, Clone)]
pub struct StoredAttachmentResult {
    pub item_key: String,
    pub file_path: String,
}

#[derive(Debug)]
struct PageRow {
    item_id: i64,
    item_key: String,
    title: String,
    publication_title: Option<String>,
    raw_year: Option<String>,
    date_added: String,
}
/// 生成 Zotero 兼容的 8 位唯一 key（大写字母 + 数字）
fn generate_unique_key(connection: &Connection) -> Result<String, AppError> {
    use std::time::{SystemTime, UNIX_EPOCH};

    const CHARS: &[u8] = b"23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    let mut attempts = 0;

    loop {
        attempts += 1;
        if attempts > 100 {
            return Err(AppError::internal(
                "无法生成唯一的 Zotero key（尝试次数过多）".to_string(),
            ));
        }

        // 用时间戳 + 尝试次数生成伪随机 key
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .wrapping_add(attempts as u128);

        let key: String = (0..8)
            .map(|i| {
                let idx = ((seed >> (i * 5)) % CHARS.len() as u128) as usize;
                CHARS[idx] as char
            })
            .collect();

        // 确保 key 不存在
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM items WHERE key = ?1)",
                params![key],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !exists {
            return Ok(key);
        }
    }
}

fn candidate_database_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path) = env::var_os("RASTRO_ZOTERO_DB_PATH") {
        candidates.push(PathBuf::from(path));
    }

    if let Some(path) = env::var_os("RASTRO_ZOTERO_PROFILE_DIR") {
        candidates.push(PathBuf::from(path).join("zotero.sqlite"));
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Zotero").join("zotero.sqlite"));
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("Zotero")
                .join("zotero.sqlite"),
        );
    }

    let mut deduped = Vec::new();
    for candidate in candidates {
        if !deduped
            .iter()
            .any(|existing: &PathBuf| existing == &candidate)
        {
            deduped.push(candidate);
        }
    }

    deduped
}

fn normalize_query(query: Option<&str>) -> (String, String) {
    let normalized = query.unwrap_or_default().trim().to_ascii_lowercase();
    let like_query = format!("%{normalized}%");
    (normalized, like_query)
}

fn query_total(connection: &Connection, query: &str, like_query: &str) -> Result<u32, AppError> {
    let sql = format!("SELECT COUNT(*) FROM items i {}", item_filter_sql());
    connection
        .query_row(&sql, params![query, like_query], |row| row.get(0))
        .map_err(map_sqlite_error)
}

fn query_page(
    connection: &Connection,
    query: &str,
    like_query: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<PageRow>, AppError> {
    let sql = format!(
        "SELECT
             i.itemID,
             i.key,
             i.dateAdded,
             COALESCE((
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'title'
                 LIMIT 1
             ), 'Untitled') AS title,
             (
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'publicationTitle'
                 LIMIT 1
             ) AS publicationTitle,
             (
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName IN ('date', 'year')
                 ORDER BY CASE WHEN f.fieldName = 'year' THEN 0 ELSE 1 END
                 LIMIT 1
             ) AS rawYear
         FROM items i
         {}
         ORDER BY i.dateAdded DESC
         LIMIT ?3 OFFSET ?4",
        item_filter_sql()
    );

    let mut statement = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = statement
        .query_map(params![query, like_query, limit, offset], |row| {
            Ok(PageRow {
                item_id: row.get(0)?,
                item_key: row.get(1)?,
                date_added: row.get(2)?,
                title: row.get(3)?,
                publication_title: row.get(4)?,
                raw_year: row.get(5)?,
            })
        })
        .map_err(map_sqlite_error)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)
}

fn fetch_authors(connection: &Connection, item_id: i64) -> Result<Vec<String>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT c.firstName, c.lastName
             FROM itemCreators ic
             JOIN creators c ON c.creatorID = ic.creatorID
             WHERE ic.itemID = ?1
             ORDER BY ic.orderIndex ASC",
        )
        .map_err(map_sqlite_error)?;
    let rows = statement
        .query_map(params![item_id], |row| {
            let first_name = row.get::<_, Option<String>>(0)?.unwrap_or_default();
            let last_name = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let display_name = format!("{first_name} {last_name}").trim().to_string();
            Ok(display_name)
        })
        .map_err(map_sqlite_error)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)
        .map(|authors| {
            authors
                .into_iter()
                .filter(|author| !author.is_empty())
                .collect()
        })
}

fn batch_fetch_authors(
    connection: &Connection,
    item_ids: &[i64],
) -> Result<std::collections::HashMap<i64, Vec<String>>, AppError> {
    use std::collections::HashMap;

    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<String> = (1..=item_ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT ic.itemID, c.firstName, c.lastName
         FROM itemCreators ic
         JOIN creators c ON c.creatorID = ic.creatorID
         WHERE ic.itemID IN ({})
         ORDER BY ic.itemID, ic.orderIndex ASC",
        placeholders.join(", ")
    );

    let mut statement = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = item_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = statement
        .query_map(params.as_slice(), |row| {
            let item_id: i64 = row.get(0)?;
            let first_name = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let last_name = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let display_name = format!("{first_name} {last_name}").trim().to_string();
            Ok((item_id, display_name))
        })
        .map_err(map_sqlite_error)?;

    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (item_id, name) = row.map_err(map_sqlite_error)?;
        if !name.is_empty() {
            map.entry(item_id).or_default().push(name);
        }
    }

    Ok(map)
}

fn batch_fetch_first_attachments(
    connection: &Connection,
    parent_item_ids: &[i64],
) -> Result<std::collections::HashMap<i64, AttachmentReference>, AppError> {
    use std::collections::HashMap;

    if parent_item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<String> = (1..=parent_item_ids.len())
        .map(|i| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT ia.parentItemID, parent.key, attachment.key, ia.path
         FROM itemAttachments ia
         JOIN items attachment ON attachment.itemID = ia.itemID
         JOIN items parent ON parent.itemID = ia.parentItemID
         WHERE ia.parentItemID IN ({})
           AND LOWER(COALESCE(ia.contentType, '')) = ?1
         ORDER BY ia.parentItemID, ia.itemID ASC",
        placeholders.join(", ")
    );

    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    all_params.push(Box::new(PDF_CONTENT_TYPE.to_string()));
    for id in parent_item_ids {
        all_params.push(Box::new(*id));
    }
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        all_params.iter().map(|p| p.as_ref()).collect();

    let mut statement = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = statement
        .query_map(param_refs.as_slice(), |row| {
            let parent_id: i64 = row.get(0)?;
            Ok((
                parent_id,
                AttachmentReference {
                    parent_item_key: row.get(1)?,
                    attachment_key: row.get(2)?,
                    attachment_path: row.get(3)?,
                },
            ))
        })
        .map_err(map_sqlite_error)?;

    let mut map: HashMap<i64, AttachmentReference> = HashMap::new();
    for row in rows {
        let (parent_id, attachment) = row.map_err(map_sqlite_error)?;
        // 只取每个 parent 的第一个附件
        map.entry(parent_id).or_insert(attachment);
    }

    Ok(map)
}

fn lookup_first_attachment(
    connection: &Connection,
    parent_item_id: i64,
) -> Result<Option<AttachmentReference>, AppError> {
    connection
        .query_row(
            "SELECT parent.key, attachment.key, ia.path
             FROM itemAttachments ia
             JOIN items attachment ON attachment.itemID = ia.itemID
             JOIN items parent ON parent.itemID = ia.parentItemID
             WHERE ia.parentItemID = ?1
               AND LOWER(COALESCE(ia.contentType, '')) = ?2
             ORDER BY ia.itemID ASC
             LIMIT 1",
            params![parent_item_id, PDF_CONTENT_TYPE],
            |row| {
                Ok(AttachmentReference {
                    parent_item_key: row.get(0)?,
                    attachment_key: row.get(1)?,
                    attachment_path: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(map_sqlite_error)
}

fn lookup_attachment_by_item_key(
    connection: &Connection,
    item_key: &str,
) -> Result<Option<AttachmentReference>, AppError> {
    connection
        .query_row(
            "SELECT COALESCE(parent.key, attachment.key), attachment.key, ia.path
             FROM itemAttachments ia
             JOIN items attachment ON attachment.itemID = ia.itemID
             LEFT JOIN items parent ON parent.itemID = ia.parentItemID
             WHERE LOWER(COALESCE(ia.contentType, '')) = ?1
               AND (attachment.key = ?2 OR parent.key = ?2)
             ORDER BY CASE WHEN parent.key = ?2 THEN 0 ELSE 1 END, ia.itemID ASC
             LIMIT 1",
            params![PDF_CONTENT_TYPE, item_key],
            |row| {
                Ok(AttachmentReference {
                    parent_item_key: row.get(0)?,
                    attachment_key: row.get(1)?,
                    attachment_path: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(map_sqlite_error)
}

/// 根据 item_key 查询 Zotero 文献标题
fn lookup_item_title(
    connection: &Connection,
    item_key: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT idv.value
             FROM items i
             JOIN itemData id ON id.itemID = i.itemID
             JOIN itemDataValues idv ON idv.valueID = id.valueID
             JOIN fieldsCombined fc ON fc.fieldID = id.fieldID
             WHERE i.key = ?1 AND fc.fieldName = 'title'
             LIMIT 1",
            params![item_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)
}

fn resolve_attachment_path(
    profile_dir: &Path,
    attachment_key: &str,
    attachment_path: &str,
) -> Option<PathBuf> {
    if let Some(relative_path) = attachment_path.strip_prefix("storage:") {
        return Some(
            profile_dir
                .join("storage")
                .join(attachment_key)
                .join(relative_path),
        );
    }

    if let Some(file_uri) = attachment_path.strip_prefix("file://") {
        let file_uri = file_uri.strip_prefix("localhost").unwrap_or(file_uri);
        let decoded = percent_decode(file_uri);
        return Some(PathBuf::from(decoded));
    }

    if let Some(relative_path) = attachment_path.strip_prefix("attachments:") {
        let decoded = percent_decode(relative_path);
        let candidate = PathBuf::from(decoded);
        return Some(if candidate.is_absolute() {
            candidate
        } else {
            profile_dir.join(candidate)
        });
    }

    let candidate = PathBuf::from(attachment_path);
    if candidate.is_absolute() {
        return Some(candidate);
    }

    None
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = decode_hex_digit(bytes[index + 1]);
            let low = decode_hex_digit(bytes[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn extract_year(value: Option<&str>) -> Option<u32> {
    let text = value?.trim();
    if text.is_empty() {
        return None;
    }

    let digits: Vec<char> = text.chars().collect();
    for start in 0..digits.len() {
        if !digits[start].is_ascii_digit() {
            continue;
        }

        let mut end = start;
        while end < digits.len() && digits[end].is_ascii_digit() {
            end += 1;
        }

        if end - start < 4 {
            continue;
        }

        let candidate: String = digits[start..start + 4].iter().collect();
        if let Ok(year) = candidate.parse::<u32>() {
            if (1000..=2999).contains(&year) {
                return Some(year);
            }
        }
    }

    None
}

fn item_filter_sql() -> &'static str {
    "WHERE EXISTS (
         SELECT 1
         FROM itemAttachments ia
         WHERE ia.parentItemID = i.itemID
           AND LOWER(COALESCE(ia.contentType, '')) = 'application/pdf'
     )
     AND NOT EXISTS (
         SELECT 1 FROM deletedItems di WHERE di.itemID = i.itemID
     )
     AND (
         ?1 = ''
         OR LOWER(COALESCE((
             SELECT idv.value
             FROM itemData id
             JOIN fieldsCombined f ON f.fieldID = id.fieldID
             JOIN itemDataValues idv ON idv.valueID = id.valueID
             WHERE id.itemID = i.itemID
               AND f.fieldName = 'title'
             LIMIT 1
         ), '')) LIKE ?2
         OR LOWER(COALESCE((
             SELECT idv.value
             FROM itemData id
             JOIN fieldsCombined f ON f.fieldID = id.fieldID
             JOIN itemDataValues idv ON idv.valueID = id.valueID
             WHERE id.itemID = i.itemID
               AND f.fieldName = 'publicationTitle'
             LIMIT 1
         ), '')) LIKE ?2
         OR LOWER(COALESCE((
             SELECT idv.value
             FROM itemData id
             JOIN fieldsCombined f ON f.fieldID = id.fieldID
             JOIN itemDataValues idv ON idv.valueID = id.valueID
             WHERE id.itemID = i.itemID
               AND f.fieldName IN ('date', 'year')
             ORDER BY CASE WHEN f.fieldName = 'year' THEN 0 ELSE 1 END
             LIMIT 1
         ), '')) LIKE ?2
         OR EXISTS (
             SELECT 1
             FROM itemCreators ic
             JOIN creators c ON c.creatorID = ic.creatorID
             WHERE ic.itemID = i.itemID
               AND LOWER(TRIM(COALESCE(c.firstName || ' ', '') || COALESCE(c.lastName, ''))) LIKE ?2
         )
     )"
}

/// collection 内文献过滤 SQL 片段（带 PDF 附件 + 未删除 + 搜索条件）
fn collection_item_filter_sql() -> &'static str {
    "AND EXISTS (
         SELECT 1
         FROM itemAttachments ia
         WHERE ia.parentItemID = i.itemID
           AND LOWER(COALESCE(ia.contentType, '')) = 'application/pdf'
     )
     AND NOT EXISTS (
         SELECT 1 FROM deletedItems di WHERE di.itemID = i.itemID
     )
     AND (
         ?2 = ''
         OR LOWER(COALESCE((
             SELECT idv.value
             FROM itemData id
             JOIN fieldsCombined f ON f.fieldID = id.fieldID
             JOIN itemDataValues idv ON idv.valueID = id.valueID
             WHERE id.itemID = i.itemID
               AND f.fieldName = 'title'
             LIMIT 1
         ), '')) LIKE ?3
     )"
}

/// collection 内文献总数
fn query_total_in_collection(
    connection: &Connection,
    collection_id: i64,
    query: &str,
    like_query: &str,
) -> Result<u32, AppError> {
    let sql = format!(
        "SELECT COUNT(*) FROM collectionItems ci
         JOIN items i ON i.itemID = ci.itemID
         WHERE ci.collectionID = ?1
         {}",
        collection_item_filter_sql()
    );
    connection
        .query_row(&sql, params![collection_id, query, like_query], |row| row.get(0))
        .map_err(map_sqlite_error)
}

/// collection 内文献分页查询
fn query_page_in_collection(
    connection: &Connection,
    collection_id: i64,
    query: &str,
    like_query: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<PageRow>, AppError> {
    let sql = format!(
        "SELECT
             i.itemID,
             i.key,
             i.dateAdded,
             COALESCE((
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'title'
                 LIMIT 1
             ), 'Untitled') AS title,
             (
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'publicationTitle'
                 LIMIT 1
             ) AS publicationTitle,
             (
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName IN ('date', 'year')
                 ORDER BY CASE WHEN f.fieldName = 'year' THEN 0 ELSE 1 END
                 LIMIT 1
             ) AS rawYear
         FROM collectionItems ci
         JOIN items i ON i.itemID = ci.itemID
         WHERE ci.collectionID = ?1
         {}
         ORDER BY ci.orderIndex DESC, i.dateAdded DESC
         LIMIT ?4 OFFSET ?5",
        collection_item_filter_sql()
    );

    let mut statement = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = statement
        .query_map(params![collection_id, query, like_query, limit, offset], |row| {
            Ok(PageRow {
                item_id: row.get(0)?,
                item_key: row.get(1)?,
                date_added: row.get(2)?,
                title: row.get(3)?,
                publication_title: row.get(4)?,
                raw_year: row.get(5)?,
            })
        })
        .map_err(map_sqlite_error)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)
}

/// 未分类文献（不属于任何 collection）的过滤 SQL
fn uncategorized_filter_sql() -> String {
    format!(
        "WHERE NOT EXISTS (
             SELECT 1 FROM collectionItems ci WHERE ci.itemID = i.itemID
         )
         AND EXISTS (
             SELECT 1
             FROM itemAttachments ia
             WHERE ia.parentItemID = i.itemID
               AND LOWER(COALESCE(ia.contentType, '')) = 'application/pdf'
         )
         AND NOT EXISTS (
             SELECT 1 FROM deletedItems di WHERE di.itemID = i.itemID
         )
         AND (
             ?1 = ''
             OR LOWER(COALESCE((
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'title'
                 LIMIT 1
             ), '')) LIKE ?2
         )"
    )
}

/// 未分类文献总数
fn query_total_uncategorized(
    connection: &Connection,
    query: &str,
    like_query: &str,
) -> Result<u32, AppError> {
    let sql = format!("SELECT COUNT(*) FROM items i {}", uncategorized_filter_sql());
    connection
        .query_row(&sql, params![query, like_query], |row| row.get(0))
        .map_err(map_sqlite_error)
}

/// 未分类文献分页查询
fn query_page_uncategorized(
    connection: &Connection,
    query: &str,
    like_query: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<PageRow>, AppError> {
    let sql = format!(
        "SELECT
             i.itemID,
             i.key,
             i.dateAdded,
             COALESCE((
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'title'
                 LIMIT 1
             ), 'Untitled') AS title,
             (
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName = 'publicationTitle'
                 LIMIT 1
             ) AS publicationTitle,
             (
                 SELECT idv.value
                 FROM itemData id
                 JOIN fieldsCombined f ON f.fieldID = id.fieldID
                 JOIN itemDataValues idv ON idv.valueID = id.valueID
                 WHERE id.itemID = i.itemID
                   AND f.fieldName IN ('date', 'year')
                 ORDER BY CASE WHEN f.fieldName = 'year' THEN 0 ELSE 1 END
                 LIMIT 1
             ) AS rawYear
         FROM items i
         {}
         ORDER BY i.dateAdded DESC
         LIMIT ?3 OFFSET ?4",
        uncategorized_filter_sql()
    );

    let mut statement = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = statement
        .query_map(params![query, like_query, limit, offset], |row| {
            Ok(PageRow {
                item_id: row.get(0)?,
                item_key: row.get(1)?,
                date_added: row.get(2)?,
                title: row.get(3)?,
                publication_title: row.get(4)?,
                raw_year: row.get(5)?,
            })
        })
        .map_err(map_sqlite_error)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)
}

fn map_sqlite_error(error: rusqlite::Error) -> AppError {
    if let rusqlite::Error::SqliteFailure(inner, message) = &error {
        if matches!(
            inner.code,
            rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
        ) {
            let user_message = message
                .clone()
                .unwrap_or_else(|| "Zotero 数据库正被占用，请稍后重试".to_string());
            return AppError::new(AppErrorCode::ZoteroDbLocked, user_message, true);
        }
    }

    AppError::from(error)
}

fn is_locked_sqlite_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(inner, _)
            if matches!(
                inner.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}

fn sqlite_immutable_uri(database_path: &Path) -> String {
    format!(
        "file:{}?mode=ro&immutable=1",
        percent_encode_uri_path(&database_path.to_string_lossy())
    )
}

fn percent_encode_uri_path(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'-' | b'_' | b'~' | b':' => {
                encoded.push(char::from(byte))
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }

    encoded
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    use rusqlite::{Connection, OpenFlags};

    use crate::errors::AppErrorCode;

    use super::{
        extract_year, is_locked_sqlite_error, map_sqlite_error, resolve_attachment_path,
        sqlite_immutable_uri, ZoteroConnector, ZoteroLibrary,
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn extract_year_handles_zotero_date_variants() {
        assert_eq!(extract_year(Some("2009-07-00 07/2009")), Some(2009));
        assert_eq!(extract_year(Some("Spring 2025")), Some(2025));
        assert_eq!(extract_year(Some("n.d.")), None);
    }

    #[test]
    fn resolve_storage_attachment_path_uses_attachment_key_folder() {
        let profile_dir = Path::new("/tmp/zotero-profile");
        let resolved = resolve_attachment_path(profile_dir, "ABCD1234", "storage:paper.pdf")
            .expect("storage path should resolve");
        assert_eq!(
            resolved,
            Path::new("/tmp/zotero-profile/storage/ABCD1234/paper.pdf")
        );
    }

    #[test]
    fn fetch_items_and_resolve_attachment_from_test_database() {
        let (profile_dir, database_path, pdf_path) =
            create_test_library_fixture("zotero-connector-test");

        let connector = ZoteroConnector {
            library: ZoteroLibrary {
                database_path,
                profile_dir,
            },
        };
        let page = connector
            .fetch_items(Some("lovelace"), 0, 10)
            .expect("items should query");
        let expected_pdf_path = pdf_path.to_string_lossy().to_string();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].item_key, "ITEM001");
        assert_eq!(page.items[0].authors, vec!["Ada Lovelace".to_string()]);
        assert_eq!(page.items[0].year, Some(2024));
        assert_eq!(
            page.items[0].pdf_path.as_deref(),
            Some(expected_pdf_path.as_str())
        );

        let attachment = connector
            .resolve_attachment("ITEM001")
            .expect("attachment should resolve");
        assert_eq!(attachment.parent_item_key, "ITEM001");
        assert_eq!(attachment.file_path, pdf_path);
    }

    #[test]
    fn fetch_items_in_collection_uses_descending_collection_order() {
        let (profile_dir, database_path) =
            create_collection_order_fixture("zotero-collection-order");
        let connector = ZoteroConnector {
            library: ZoteroLibrary {
                database_path,
                profile_dir,
            },
        };

        let page = connector
            .fetch_items_in_collection(Some(10), None, 0, 10)
            .expect("collection items should query");

        let ordered_keys: Vec<&str> = page
            .items
            .iter()
            .map(|item| item.item_key.as_str())
            .collect();
        assert_eq!(page.total, 3);
        assert_eq!(ordered_keys, vec!["ITEM003", "ITEM002", "ITEM001"]);
    }

    #[test]
    fn fetch_items_falls_back_to_immutable_mode_when_database_is_locked() {
        let (profile_dir, database_path, _) =
            create_test_library_fixture("zotero-connector-locked");
        let lock_holder = Connection::open(&database_path).expect("lock holder should open db");
        lock_holder
            .execute_batch("BEGIN EXCLUSIVE;")
            .expect("exclusive lock should start");

        let raw_error = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .and_then(|connection| connection.query_row("SELECT 1", [], |row| row.get::<_, i64>(0)));
        let raw_error = raw_error.expect_err("plain readonly query should be blocked by lock");
        assert!(is_locked_sqlite_error(&raw_error));

        let connector = ZoteroConnector {
            library: ZoteroLibrary {
                database_path,
                profile_dir,
            },
        };
        let page = connector
            .fetch_items(None, 0, 10)
            .expect("immutable fallback should keep reads available");

        lock_holder
            .execute_batch("ROLLBACK;")
            .expect("exclusive lock should release");

        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].item_key, "ITEM001");
    }

    #[test]
    fn detect_returns_zotero_not_found_when_configured_path_is_missing() {
        let _guard = ENV_LOCK.lock().unwrap();
        let previous_db = std::env::var_os("RASTRO_ZOTERO_DB_PATH");
        let previous_profile = std::env::var_os("RASTRO_ZOTERO_PROFILE_DIR");
        let previous_home = std::env::var_os("HOME");
        let isolated_home = temp_profile_dir("zotero-empty-home");
        std::env::set_var(
            "RASTRO_ZOTERO_DB_PATH",
            temp_profile_dir("missing-zotero-db").join("missing.sqlite"),
        );
        std::env::remove_var("RASTRO_ZOTERO_PROFILE_DIR");
        std::env::set_var("HOME", &isolated_home);

        let error = ZoteroConnector::detect().expect_err("missing db should not be detected");

        restore_env("RASTRO_ZOTERO_DB_PATH", previous_db);
        restore_env("RASTRO_ZOTERO_PROFILE_DIR", previous_profile);
        restore_env("HOME", previous_home);
        assert_eq!(error.code, AppErrorCode::ZoteroNotFound);
    }

    #[test]
    fn map_sqlite_error_maps_locked_database_to_retryable_app_error() {
        let error = map_sqlite_error(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ErrorCode::DatabaseLocked,
                extended_code: rusqlite::ErrorCode::DatabaseLocked as i32,
            },
            Some("database is locked".to_string()),
        ));

        assert_eq!(error.code, AppErrorCode::ZoteroDbLocked);
        assert!(error.retryable);
    }

    #[test]
    fn sqlite_immutable_uri_encodes_spaces_in_paths() {
        let uri = sqlite_immutable_uri(Path::new("/tmp/work space/zotero.sqlite"));
        assert_eq!(
            uri,
            "file:/tmp/work%20space/zotero.sqlite?mode=ro&immutable=1"
        );
    }

    fn create_test_library_fixture(prefix: &str) -> (PathBuf, PathBuf, PathBuf) {
        let profile_dir = temp_profile_dir(prefix);
        let database_path = profile_dir.join("zotero.sqlite");
        let storage_dir = profile_dir.join("storage").join("ATTACH001");
        fs::create_dir_all(&storage_dir).expect("storage dir should exist");
        let pdf_path = storage_dir.join("paper.pdf");
        fs::write(&pdf_path, b"%PDF").expect("pdf fixture should exist");

        let connection = Connection::open(&database_path).expect("sqlite file should open");
        connection
            .execute_batch(
                "
                CREATE TABLE items (
                  itemID INTEGER PRIMARY KEY,
                  itemTypeID INT NOT NULL,
                  dateAdded TEXT NOT NULL,
                  dateModified TEXT NOT NULL,
                  clientDateModified TEXT NOT NULL,
                  libraryID INT NOT NULL,
                  key TEXT NOT NULL,
                  version INT NOT NULL DEFAULT 0,
                  synced INT NOT NULL DEFAULT 0
                );
                CREATE TABLE itemAttachments (
                  itemID INTEGER PRIMARY KEY,
                  parentItemID INT,
                  linkMode INT,
                  contentType TEXT,
                  charsetID INT,
                  path TEXT,
                  syncState INT DEFAULT 0,
                  storageModTime INT,
                  storageHash TEXT,
                  lastProcessedModificationTime INT
                );
                CREATE TABLE itemData (
                  itemID INT,
                  fieldID INT,
                  valueID INT,
                  PRIMARY KEY (itemID, fieldID)
                );
                CREATE TABLE itemDataValues (
                  valueID INTEGER PRIMARY KEY,
                  value TEXT
                );
                CREATE TABLE itemCreators (
                  itemID INT NOT NULL,
                  creatorID INT NOT NULL,
                  creatorTypeID INT NOT NULL DEFAULT 1,
                  orderIndex INT NOT NULL DEFAULT 0,
                  PRIMARY KEY (itemID, creatorID, creatorTypeID, orderIndex)
                );
                CREATE TABLE deletedItems (
                  itemID INT PRIMARY KEY
                );
                CREATE TABLE creators (
                  creatorID INTEGER PRIMARY KEY,
                  firstName TEXT,
                  lastName TEXT,
                  fieldMode INT
                );
                CREATE TABLE fieldsCombined (
                  fieldID INT NOT NULL,
                  fieldName TEXT NOT NULL,
                  label TEXT,
                  fieldFormatID INT,
                  custom INT NOT NULL,
                  PRIMARY KEY (fieldID)
                );
                ",
            )
            .expect("schema should initialize");
        connection
            .execute_batch(
                "
                INSERT INTO fieldsCombined (fieldID, fieldName, custom) VALUES
                  (1, 'title', 0),
                  (2, 'publicationTitle', 0),
                  (3, 'date', 0);
                INSERT INTO items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)
                VALUES
                  (1, 1, '2026-03-11 10:00:00', '2026-03-11 10:00:00', '2026-03-11 10:00:00', 1, 'ITEM001'),
                  (2, 14, '2026-03-11 10:00:00', '2026-03-11 10:00:00', '2026-03-11 10:00:00', 1, 'ATTACH001');
                INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path)
                VALUES (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
                INSERT INTO itemDataValues (valueID, value) VALUES
                  (1, 'Demo Paper'),
                  (2, 'Journal of Testing'),
                  (3, '2024-01-15');
                INSERT INTO itemData (itemID, fieldID, valueID) VALUES
                  (1, 1, 1),
                  (1, 2, 2),
                  (1, 3, 3);
                INSERT INTO creators (creatorID, firstName, lastName, fieldMode)
                VALUES (1, 'Ada', 'Lovelace', 0);
                INSERT INTO itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
                VALUES (1, 1, 1, 0);
                ",
            )
            .expect("fixture rows should insert");
        drop(connection);

        (profile_dir, database_path, pdf_path)
    }

    fn create_collection_order_fixture(prefix: &str) -> (PathBuf, PathBuf) {
        let profile_dir = temp_profile_dir(prefix);
        let database_path = profile_dir.join("zotero.sqlite");
        for attachment_key in ["ATTACH001", "ATTACH002", "ATTACH003"] {
            let storage_dir = profile_dir.join("storage").join(attachment_key);
            fs::create_dir_all(&storage_dir).expect("storage dir should exist");
            fs::write(storage_dir.join("paper.pdf"), b"%PDF").expect("pdf fixture should exist");
        }

        let connection = Connection::open(&database_path).expect("sqlite file should open");
        connection
            .execute_batch(
                "
                CREATE TABLE items (
                  itemID INTEGER PRIMARY KEY,
                  itemTypeID INT NOT NULL,
                  dateAdded TEXT NOT NULL,
                  dateModified TEXT NOT NULL,
                  clientDateModified TEXT NOT NULL,
                  libraryID INT NOT NULL,
                  key TEXT NOT NULL,
                  version INT NOT NULL DEFAULT 0,
                  synced INT NOT NULL DEFAULT 0
                );
                CREATE TABLE itemAttachments (
                  itemID INTEGER PRIMARY KEY,
                  parentItemID INT,
                  linkMode INT,
                  contentType TEXT,
                  charsetID INT,
                  path TEXT,
                  syncState INT DEFAULT 0,
                  storageModTime INT,
                  storageHash TEXT,
                  lastProcessedModificationTime INT
                );
                CREATE TABLE itemData (
                  itemID INT,
                  fieldID INT,
                  valueID INT,
                  PRIMARY KEY (itemID, fieldID)
                );
                CREATE TABLE itemDataValues (
                  valueID INTEGER PRIMARY KEY,
                  value TEXT
                );
                CREATE TABLE itemCreators (
                  itemID INT NOT NULL,
                  creatorID INT NOT NULL,
                  creatorTypeID INT NOT NULL DEFAULT 1,
                  orderIndex INT NOT NULL DEFAULT 0,
                  PRIMARY KEY (itemID, creatorID, creatorTypeID, orderIndex)
                );
                CREATE TABLE creators (
                  creatorID INTEGER PRIMARY KEY,
                  firstName TEXT,
                  lastName TEXT,
                  fieldMode INT
                );
                CREATE TABLE fieldsCombined (
                  fieldID INT NOT NULL,
                  fieldName TEXT NOT NULL,
                  label TEXT,
                  fieldFormatID INT,
                  custom INT NOT NULL,
                  PRIMARY KEY (fieldID)
                );
                CREATE TABLE deletedItems (
                  itemID INT PRIMARY KEY
                );
                CREATE TABLE collections (
                  collectionID INTEGER PRIMARY KEY,
                  key TEXT NOT NULL,
                  collectionName TEXT NOT NULL,
                  parentCollectionID INT
                );
                CREATE TABLE collectionItems (
                  collectionID INT NOT NULL,
                  itemID INT NOT NULL,
                  orderIndex INT NOT NULL DEFAULT 0,
                  PRIMARY KEY (collectionID, itemID)
                );
                ",
            )
            .expect("schema should initialize");

        connection
            .execute_batch(
                "
                INSERT INTO fieldsCombined (fieldID, fieldName, custom) VALUES
                  (1, 'title', 0),
                  (2, 'publicationTitle', 0),
                  (3, 'date', 0);

                INSERT INTO collections (collectionID, key, collectionName, parentCollectionID)
                VALUES (10, 'COLL001', '黑陶', NULL);

                INSERT INTO items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)
                VALUES
                  (1, 1, '2026-03-11 10:00:00', '2026-03-11 10:00:00', '2026-03-11 10:00:00', 1, 'ITEM001'),
                  (2, 14, '2026-03-11 10:00:00', '2026-03-11 10:00:00', '2026-03-11 10:00:00', 1, 'ATTACH001'),
                  (3, 1, '2026-03-12 10:00:00', '2026-03-12 10:00:00', '2026-03-12 10:00:00', 1, 'ITEM002'),
                  (4, 14, '2026-03-12 10:00:00', '2026-03-12 10:00:00', '2026-03-12 10:00:00', 1, 'ATTACH002'),
                  (5, 1, '2026-03-13 10:00:00', '2026-03-13 10:00:00', '2026-03-13 10:00:00', 1, 'ITEM003'),
                  (6, 14, '2026-03-13 10:00:00', '2026-03-13 10:00:00', '2026-03-13 10:00:00', 1, 'ATTACH003');

                INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path)
                VALUES
                  (2, 1, 0, 'application/pdf', 'storage:paper.pdf'),
                  (4, 3, 0, 'application/pdf', 'storage:paper.pdf'),
                  (6, 5, 0, 'application/pdf', 'storage:paper.pdf');

                INSERT INTO itemDataValues (valueID, value) VALUES
                  (1, 'Paper A'),
                  (2, '2024'),
                  (3, 'Paper B'),
                  (4, '2025'),
                  (5, 'Paper C'),
                  (6, '2026');

                INSERT INTO itemData (itemID, fieldID, valueID) VALUES
                  (1, 1, 1),
                  (1, 3, 2),
                  (3, 1, 3),
                  (3, 3, 4),
                  (5, 1, 5),
                  (5, 3, 6);

                INSERT INTO collectionItems (collectionID, itemID, orderIndex) VALUES
                  (10, 1, 1),
                  (10, 3, 2),
                  (10, 5, 3);
                ",
            )
            .expect("fixture rows should insert");
        drop(connection);

        (profile_dir, database_path)
    }

    fn temp_profile_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be monotonic enough")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("temp profile dir should exist");
        dir
    }

    fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
        if let Some(value) = value {
            std::env::set_var(key, value);
        } else {
            std::env::remove_var(key);
        }
    }
}
