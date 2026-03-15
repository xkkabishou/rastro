// Tauri 构建脚本——生成 generate_context!() 所需的元数据
fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
