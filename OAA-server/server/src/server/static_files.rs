//! headless 形态的管理界面托管：把 `ui/` 静态目录随网关一并出出去。
//!
//! ── 为什么不用 tower-http 的 ServeDir ───────────────────────
//! 界面是一组固定扩展名的扁平文件，需要的只是「读文件 + content-type +
//! 路径安全」三件事，百来行自持实现足够；引 tower-http 只为这一件事，
//! 还得对齐它的 404 / 过滤器行为 —— 不划算（CORS 不用它也是同一理由）。
//!
//! ── 安全边界 ────────────────────────────────────────────────
//!   · 只服务 `ui/` 目录内的文件：路径逐段归一化，`..` 与绝不允许逃出根；
//!   · `/api`、`/v1`、`/auth`、`/health` 前缀不进静态服务 —— 静态 fallback
//!     只接「未注册路由」，但显式挡一道，避免将来某条管理路由改名后
//!     意外落进静态分支；
//!   · 注入的桥接脚本只在 index.html 上发生，其它原样透出。
//!
//! ── 缓存 ────────────────────────────────────────────────────
//! 一律 `no-store`：面板是小流量场景，协商缓存的复杂度不值得 ——
//! 资源换了名字（部署新 ui/）后浏览器立刻拿到新版，不会出现
//! 「发新版后页面引用了旧 js」的中间态。

use std::path::PathBuf;

use axum::body::Body;
use axum::http::{header, Request, Response, StatusCode};
use axum::response::Response as AxumResponse;

use crate::server::errors;

/// 判定路径是否属于「接口保留前缀」：静态服务绝不碰它们，
/// 未注册的接口路径继续走原来的 404 文案（Node 版行为）。
fn is_api_path(path: &str) -> bool {
    path == "/health"
        || path.starts_with("/api/")
        || path.starts_with("/v1/")
        || path.starts_with("/auth/")
        || path == "/api"
        || path == "/v1"
        || path == "/auth"
}

/// 静态服务入口：`ui_dir` 已就绪时尝试出文件，失败回到 404 兜底。
///
/// `gateway_port` 是**网关面**实际监听的端口：分端口部署时它与面板端口
/// 不同（面板 `OAA_PANEL_PORT`，网关 `OAA_PROXY_PORT`），而界面里
/// 「OpenAI 端点」那行提示必须给出网关端口 —— 否则用户照着面板地址
/// 拼出的 base_url 会打到面板端口上，`/v1/*` 在那里根本不存在。
pub async fn serve(request: Request<Body>, ui_dir: PathBuf, gateway_port: u16) -> AxumResponse {
    let path = request.uri().path().to_string();
    if is_api_path(&path) {
        return not_found(request).await;
    }
    let origin = gateway_origin(&request, gateway_port);
    match resolve_file(&ui_dir, &path) {
        Some(file_path) => read_response(&file_path, &origin).await,
        None => not_found(request).await,
    }
}

/// 拼出「浏览器该用的网关源」（`http://host:port`）。
///
/// 主机名取自请求的 `Host` 头（用户实际是从哪个地址打开面板的），端口换成
/// 网关端口 —— 反向代理 / 局域网 IP / localhost 都能得到能直接用的地址，
/// 不必猜部署形态。取不到 Host 时退回 `127.0.0.1`。
fn gateway_origin(request: &Request<Body>, gateway_port: u16) -> String {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim();
    // Host 可能带端口（`192.168.1.19:3066`、IPv6 的 `[::1]:3066`）：只留主机名
    let name = if host.starts_with('[') {
        match host.find(']') {
            Some(end) => &host[..=end],
            None => "",
        }
    } else {
        host.split(':').next().unwrap_or("")
    };
    // 注入的是内联脚本，主机名只保留合法字符，杜绝引号 / 尖括号逃逸
    let name: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
        .collect();
    if name.is_empty() {
        return format!("http://127.0.0.1:{gateway_port}");
    }
    format!("http://{name}:{gateway_port}")
}

/// 把 URL 路径解析到 `ui/` 内的具体文件（`None` = 不存在 / 非法）。
///
/// 逐段归一化而不是字符串拼接：`..`、内嵌点段、重复斜杠都被消化掉，
/// 归一化结果仍带 `..` 前缀的（试图逃出根）一律拒绝。
fn resolve_file(ui_dir: &PathBuf, url_path: &str) -> Option<PathBuf> {
    // 只取路径段，忽略查询串（axum 的 uri().path() 已不含 query，双保险）
    let url_path = url_path.split('?').next().unwrap_or("");
    let mut segments: Vec<&str> = Vec::new();
    for segment in url_path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    let mut file_path = ui_dir.clone();
    if segments.is_empty() {
        file_path.push("index.html");
        return file_path.is_file().then_some(file_path);
    }
    for segment in &segments {
        // 任何一段都不该再带路径分隔符（Windows 反斜杠也算）
        if segment.contains('/') || segment.contains('\\') {
            return None;
        }
        file_path.push(segment);
    }
    if file_path.is_file() {
        return Some(file_path);
    }
    // 无扩展名的路径按页面补 .html（/login → login.html）：
    // 面板的独立登录页就是这种形态；带扩展名的请求不补（/app.js 照字面找）
    let no_extension = segments
        .last()
        .is_some_and(|segment| !segment.contains('.'));
    if no_extension {
        file_path.set_extension("html");
        return file_path.is_file().then_some(file_path);
    }
    None
}

/// 读文件并组装响应；读失败（权限等）按 404 处理（不区分 404/403，
/// 面板资源缺失的唯一正确动作就是「当它不存在」）。
async fn read_response(file_path: &PathBuf, origin: &str) -> AxumResponse {
    let bytes = match tokio::fs::read(file_path).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return errors::not_found_response("GET", "static");
        }
    };
    let file_name = file_path.file_name().and_then(|name| name.to_str());
    let body = match file_name {
        Some("index.html") => inject_web_shim(&bytes, origin),
        // 界面脚本里的「OpenAI 端点」提示是按面板地址拼的，换掉它
        Some("ui.js") => inject_gateway_origin(&bytes),
        _ => bytes,
    };
    let mime = mime_of(file_path);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body));
    response.unwrap_or_else(|_| errors::not_found_response("GET", "static"))
}

/// 网关源在页面里的全局名：`window.__OAA_GATEWAY_ORIGIN__`。
///
/// index.html 里定义、ui.js 里读 —— 两处注入用的是同一个值，所以界面
/// 展示的地址与实际可达的 `/v1` 地址必然一致。
const GATEWAY_ORIGIN_GLOBAL: &str = "__OAA_GATEWAY_ORIGIN__";

/// 界面脚本里的占位片段：原代码用面板 origin 拼端点，这里换成网关 origin。
const UI_ORIGIN_PLACEHOLDER: &str = "${window.location.origin}/v1";

/// 把 ui.js 里「OpenAI 端点」那行的面板 origin 换成注入的网关 origin。
///
/// 只在命中占位片段时改动（`ui.js` 里该片段恰好出现一次）；没命中就原样
/// 返回 —— 界面换了版本也不至于因此坏掉，最多回到旧的展示行为。
///
/// 这里换的是**取值表达式**而不是端口字面量：真正的地址由 index.html 里
/// 注入的全局给出，脚本读一次即可 —— 所以本函数不需要 origin 入参。
fn inject_gateway_origin(js: &[u8]) -> Vec<u8> {
    let Ok(text) = std::str::from_utf8(js) else {
        return js.to_vec();
    };
    let replacement = format!("${{window.{GATEWAY_ORIGIN_GLOBAL}||window.location.origin}}/v1");
    match text.replacen(UI_ORIGIN_PLACEHOLDER, &replacement, 1) {
        replaced if replaced != text => replaced.into_bytes(),
        _ => js.to_vec(),
    }
}

/// 把网页端桥接注入 index.html：`<head>` 开标签后插一段内联脚本，
/// 使 `window.workbuddyDesktop` 在所有界面脚本之前就绪
/// （与桌面壳 bridge.rs 的「页面脚本执行前注入」同一时序保证），
/// 同时先落下网关 origin 供界面脚本读取。
fn inject_web_shim(html: &[u8], origin: &str) -> Vec<u8> {
    let Ok(text) = std::str::from_utf8(html) else {
        return html.to_vec();
    };
    let shim = format!(
        "<script>window.{GATEWAY_ORIGIN_GLOBAL}={};{}</script>",
        js_string_literal(origin),
        crate::web_shim::shim_js()
    );
    match text.replacen("<head>", &format!("<head>{shim}"), 1) {
        replaced if replaced != text => replaced.into_bytes(),
        // 没有 <head>（结构被改坏）也别让面板整页失效：追加到末尾兜底
        _ => format!("{text}{shim}").into_bytes(),
    }
}

/// 把字符串安全地包成 JS 双引号字面量（注入的是内联脚本，不能让值逃逸）。
fn js_string_literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// 扩展名 → content-type（界面用到的固定集合，其余按二进制流处理）
fn mime_of(file_path: &PathBuf) -> String {
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
    .to_string()
}

async fn not_found(request: Request<Body>) -> AxumResponse {
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    errors::not_found_response(&method, &path)
}
