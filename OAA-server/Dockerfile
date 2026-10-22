# OAA-server headless 网关镜像（多阶段构建，amd64 + arm64）
#
#   · 只构建网关本体 crate（包名 oaa-server），面板直接用预构建的 ui/ 产物
#   · 不需要桌面壳与其图标 / 资源

# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS builder
WORKDIR /build

# 可选：容器内 cargo 拉取 crates.io 走宿主代理（按需传入）
ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""

# TARGETARCH 由 buildx/BuildKit 自动注入：amd64 / arm64。它是预置 ARG，
# 阶段内要用必须重新声明，否则恒为空串（会导致 arm64 分支永不命中）。
ARG TARGETARCH

# ── 配置华为云 Debian apt 源（替换官方 deb.debian.org）──
RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources \
    && printf '%s\n' \
        'deb https://mirrors.huaweicloud.com/debian/ bookworm main contrib non-free non-free-firmware' \
        'deb https://mirrors.huaweicloud.com/debian/ bookworm-updates main contrib non-free non-free-firmware' \
        'deb https://mirrors.huaweicloud.com/debian-security/ bookworm-security main contrib non-free non-free-firmware' \
        > /etc/apt/sources.list

# ── 配置华为云 Cargo sparse 镜像源（关键修复点）──
# 注意：Cargo 1.70+ 使用 sparse 协议时，registry 字段直接填索引根地址即可，
# 无需额外配置 index 字段。同时显式 proxy = false 避免与镜像源冲突。
RUN mkdir -p /root/.cargo \
    && printf '%s\n' \
        '[source.crates-io]' \
        'replace-with = "huaweicloud"' \
        '' \
        '[source.huaweicloud]' \
        'registry = "https://mirrors.huaweicloud.com/repository/rust/crates-io"' \
        '' \
        '[http]' \
        'proxy = false' \
        '' \
        '[net]' \
        'git-fetch-with-cli = true' \
        'retry = 3' \
        > /root/.cargo/config.toml \
    && cat /root/.cargo/config.toml

# arm64 需要 aarch64 的 C 工具链与 glibc 开发头文件（rusqlite bundled 的
# SQLite、ring 的 C/汇编源码用）。
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        rustup target add aarch64-unknown-linux-gnu \
        && apt-get update \
        && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross \
        && rm -rf /var/lib/apt/lists/*; \
    fi
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++

# 统一构建脚本：amd64 原生 / arm64 交叉，产物统一归位到 /build/oaa-server-bin
RUN { echo '#!/bin/sh -e'; \
      echo 'cd /build'; \
      echo 'if [ "$TARGETARCH" = "arm64" ]; then'; \
      echo '  cargo build --release -p oaa-server --target aarch64-unknown-linux-gnu --target-dir /build/target'; \
      echo '  cp /build/target/aarch64-unknown-linux-gnu/release/oaa-server /build/oaa-server-bin'; \
      echo 'else'; \
      echo '  cargo build --release -p oaa-server --target-dir /build/target'; \
      echo '  cp /build/target/release/oaa-server /build/oaa-server-bin'; \
      echo 'fi'; \
    } > /build/cargo-build.sh && chmod +x /build/cargo-build.sh

# 桩依赖层：先只放清单 + 空的 lib/bin，把整棵依赖树编一遍做缓存底座
COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml server/
RUN mkdir -p server/src/bin \
    && echo "" > server/src/lib.rs \
    && echo "fn main() {}" > server/src/bin/oaa-server.rs
RUN /build/cargo-build.sh

# 真源码层：COPY 会保留源文件 mtime，增量判断可能误判「没变」，先 touch 再编
COPY server/src server/src
RUN find server/src -type f -exec touch {} + \
    && /build/cargo-build.sh

# ── 运行时 ──────────────────────────────────────────────────
FROM debian:bookworm-slim

# 注意：slim 镜像无 ca-certificates，apt 源必须用 http:// 而非 https://
RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources \
    && printf '%s\n' \
        'deb http://mirrors.huaweicloud.com/debian/ bookworm main contrib non-free non-free-firmware' \
        'deb http://mirrors.huaweicloud.com/debian/ bookworm-updates main contrib non-free non-free-firmware' \
        'deb http://mirrors.huaweicloud.com/debian-security/ bookworm-security main contrib non-free non-free-firmware' \
        > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/oaa-server-bin /usr/local/bin/oaa-server
COPY ui /app/ui

# 容器内默认形态：全网卡监听 + 数据落卷 + 自托管面板。
# 运行时仍沿用上游的 OAA_* 环境变量前缀与 /data 数据目录
# （刻意不改 —— 它们是运行时契约，改了会和上游文档/脚本不一致）。
ENV OAA_HOST=0.0.0.0 \
    OAA_PROXY_HOME=/data \
    OAA_UI_DIR=/app/ui \
    OAA_CAPTCHA_ENABLED=1
VOLUME ["/data"]
EXPOSE 3065
WORKDIR /app
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${OAA_PROXY_PORT:-3065}/health" || exit 1
ENTRYPOINT ["/usr/local/bin/oaa-server"]
