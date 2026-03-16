-- 在 provider_settings 表增加 masked_key 列
-- 避免显示设置页面时读取 macOS Keychain 导致反复弹出授权对话框
ALTER TABLE provider_settings ADD COLUMN masked_key TEXT;
