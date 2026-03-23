# OpenClaw Complete Feature Inventory

**Generated:** 2026-03-22
**Codebase version:** 2026.3.14
**Source:** `/Users/sdoumbouya/Library/Mobile Documents/com~apple~CloudDocs/claude-env3/openclaw`

---

## Executive Summary

OpenClaw is a multi-channel AI gateway that runs on user devices, integrating with messaging platforms, AI model providers, and system-level capabilities. The codebase contains:

- **19+ CLI commands** for administration, configuration, and operation
- **35+ agent tools** (distinct tool modules, not counting sub-variants)
- **52 bundled skills** covering productivity, media, smart home, coding, and messaging
- **77 extensions** (plugins) spanning channels, AI providers, speech, memory, and capabilities
- **Full media pipeline** for audio, video, images, PDFs, and document understanding
- **ACP (Agent Client Protocol)** for IDE/editor integration
- **Cron scheduler** with isolated agent execution, delivery, and heartbeat monitoring
- **Browser automation** via Chrome CDP, Playwright, and MCP-based snapshot/interaction
- **Canvas workspace** for visual/HTML artifact hosting with live reload
- **Voice system** with wake words, talk mode, and text-to-speech
- **Native apps** for macOS, iOS, and Android
- **Gateway server** with WebSocket protocol, OpenAI-compatible HTTP API, auth, and multi-agent orchestration
- **Memory system** with vector embeddings, search, and multiple backend providers

---

## 1. CLI Commands

Source: `src/commands/`

| # | Command | Primary File(s) | Description |
|---|---------|-----------------|-------------|
| 1 | `agent` | `agent.ts` | Send single messages to the agent; run agent interactions |
| 2 | `agents` | `agents.ts`, `agents.commands.*.ts` | Multi-agent management: add, list, delete, bind, configure identity |
| 3 | `backup` | `backup.ts` | Create and verify state/config backups with atomic writes |
| 4 | `channels` | `channels.ts`, `channels/*.ts` | Add, remove, probe, and show status of messaging channels |
| 5 | `config` / `configure` | `configure.ts`, `configure.*.ts` | Interactive and non-interactive configuration: channels, daemon, gateway, wizard |
| 6 | `dashboard` | `dashboard.ts` | Open web dashboard with deep links |
| 7 | `doctor` | `doctor.ts`, `doctor-*.ts` | Comprehensive system diagnostics: auth, browser, config, cron, gateway, install, memory, sandbox, security, sessions, state integrity, workspace |
| 8 | `gateway` | `gateway-status.ts`, `gateway-install-token.ts` | Gateway lifecycle: status, presence, install tokens |
| 9 | `health` | `health.ts` | System health check with formatted output |
| 10 | `message` | `message.ts` | Send messages to channels/agents programmatically |
| 11 | `models` | `models.ts`, `models/*.ts` | List, set, and manage AI model configuration; auth provider resolution |
| 12 | `onboard` | `onboard.ts`, `onboard-*.ts` | First-run onboarding: auth setup, channel config, skills, hooks, search providers |
| 13 | `reset` | `reset.ts` | Reset agent state, sessions, or full configuration |
| 14 | `sandbox` | `sandbox.ts`, `sandbox-*.ts` | Docker/Podman sandbox management: explain, display, formatters |
| 15 | `sessions` | `sessions.ts`, `sessions-*.ts` | Session lifecycle: list, cleanup, store targets, model resolution |
| 16 | `setup` | `setup.ts`, `setup/*.ts` | System setup wizard: completion, gateway config, secret input, finalization |
| 17 | `signal-install` | `signal-install.ts` | Signal messenger CLI installation helper |
| 18 | `status` | `status.ts`, `status-*.ts`, `status-all.ts` | Comprehensive status output: agents, daemon, gateway probe, channel links, service summary, scan, JSON export |
| 19 | `uninstall` | `uninstall.ts` | Clean uninstall of OpenClaw components |
| 20 | `docs` | `docs.ts` | Open documentation |
| 21 | `auth-choice` | `auth-choice.ts`, `auth-choice.*.ts` | Provider auth selection: API key, OAuth, plugin-provider, model check, moonshot |
| 22 | `ollama-setup` | `ollama-setup.ts` | Ollama local model provider setup |
| 23 | `vllm-setup` | `vllm-setup.ts` | vLLM provider setup |

---

## 2. Agent Tools

Source: `src/agents/tools/`

### 2.1 Core Communication Tools

| Tool | File | Description |
|------|------|-------------|
| **message** | `message-tool.ts` | Send messages to any channel (Telegram, Discord, Slack, WhatsApp, iMessage, etc.) |
| **sessions_send** | `sessions-send-tool.ts` | Send messages to other agent sessions |
| **sessions_send (A2A)** | `sessions-send-tool.a2a.ts` | Agent-to-Agent protocol session messaging |
| **sessions_spawn** | `sessions-spawn-tool.ts` | Spawn new agent sessions (isolated or linked) |
| **sessions_yield** | `sessions-yield-tool.ts` | Yield control back to the calling session |
| **sessions_list** | `sessions-list-tool.ts` | List active and recent sessions |
| **sessions_history** | `sessions-history-tool.ts` | Retrieve session conversation history |
| **session_status** | `session-status-tool.ts` | Get status of a specific session |
| **agents_list** | `agents-list-tool.ts` | List configured agents |
| **subagents** | `subagents-tool.ts` | Manage and invoke sub-agents |

### 2.2 Web & Search Tools

| Tool | File | Description |
|------|------|-------------|
| **web_fetch** | `web-fetch.ts` | Fetch and extract content from URLs (readability mode) |
| **web_search** | `web-search.ts` | Search the web via configured providers (Brave, Tavily, Perplexity, Google, etc.) |
| **web_guarded_fetch** | `web-guarded-fetch.ts` | SSRF-guarded URL fetching |

### 2.3 Media & Generation Tools

| Tool | File | Description |
|------|------|-------------|
| **image** | `image-tool.ts` | Process, analyze, and understand images |
| **image_generate** | `image-generate-tool.ts` | Generate images via AI providers (OpenAI, fal, Google) |
| **pdf** | `pdf-tool.ts` | Read, extract, and process PDF documents |
| **tts** | `tts-tool.ts` | Text-to-speech synthesis |
| **canvas** | `canvas-tool.ts` | Create/update visual artifacts in the canvas workspace |

### 2.4 Browser Tool

| Tool | File | Description |
|------|------|-------------|
| **browser** | `browser-tool.ts`, `browser-tool.actions.ts`, `browser-tool.schema.ts` | Full browser automation: navigate, click, fill forms, take screenshots, evaluate JS |

### 2.5 Infrastructure Tools

| Tool | File | Description |
|------|------|-------------|
| **cron** | `cron-tool.ts` | Create, list, update, delete scheduled tasks |
| **memory** | `memory-tool.ts` | Search and manage long-term memory with citations |
| **gateway** | `gateway-tool.ts`, `gateway.ts` | Query and interact with the gateway server |
| **nodes** | `nodes-tool.ts`, `nodes-utils.ts` | Manage connected node devices (mobile, desktop) |
| **agent_step** | `agent-step.ts` | Execute a single agent reasoning step |

---

## 3. Bundled Skills (52)

Source: `skills/`

### 3.1 Messaging & Communication (8)

| Skill | Description |
|-------|-------------|
| **bluebubbles** | iMessage integration via BlueBubbles server |
| **discord** | Discord operations via the message tool |
| **himalaya** | CLI email management via IMAP/SMTP |
| **imsg** | iMessage/SMS CLI for listing chats, history, and sending |
| **slack** | Slack control including reactions and pins |
| **voice-call** | Start voice calls via the voice-call plugin |
| **wacli** | WhatsApp messaging and history via wacli CLI |
| **xurl** | X (Twitter) API: post, reply, search, DMs, media upload |

### 3.2 Productivity & Notes (10)

| Skill | Description |
|-------|-------------|
| **1password** | 1Password CLI setup, sign-in, secret read/inject |
| **apple-notes** | Apple Notes via the `memo` CLI on macOS |
| **apple-reminders** | Apple Reminders via remindctl CLI |
| **bear-notes** | Bear notes via grizzly CLI |
| **notion** | Notion API: pages, databases, blocks |
| **obsidian** | Obsidian vault management and obsidian-cli |
| **things-mac** | Things 3 task management on macOS |
| **trello** | Trello boards, lists, and cards via REST API |
| **gog** | Google Workspace: Gmail, Calendar, Drive, Contacts, Sheets, Docs |
| **ordercli** | Foodora order status CLI |

### 3.3 Media & Audio (8)

| Skill | Description |
|-------|-------------|
| **camsnap** | RTSP/ONVIF camera frame/clip capture |
| **gifgrep** | GIF search, download, and still extraction |
| **nano-pdf** | Natural-language PDF editing |
| **openai-image-gen** | Batch image generation via OpenAI Images API |
| **openai-whisper** | Local speech-to-text (no API key) |
| **openai-whisper-api** | OpenAI Audio Transcription API (Whisper) |
| **songsee** | Audio spectrograms and feature visualizations |
| **video-frames** | Extract frames/clips from video via ffmpeg |

### 3.4 Smart Home & IoT (4)

| Skill | Description |
|-------|-------------|
| **eightctl** | Eight Sleep pod control: status, temperature, alarms |
| **openhue** | Philips Hue lights and scenes via OpenHue CLI |
| **sonoscli** | Sonos speaker control: discover, play, volume, group |
| **blucli** | BluOS CLI for playback, grouping, volume |

### 3.5 Development & DevOps (7)

| Skill | Description |
|-------|-------------|
| **coding-agent** | Delegate coding to Codex, Claude Code, or Pi agents |
| **gh-issues** | GitHub issue triage, sub-agent PR creation, review monitoring |
| **github** | GitHub CLI: issues, PRs, CI, code review, API queries |
| **gemini** | Gemini CLI for Q&A, summaries, generation |
| **mcporter** | MCP server management: list, configure, auth, call tools |
| **skill-creator** | Create, edit, audit AgentSkills |
| **tmux** | Remote-control tmux sessions via keystrokes/pane scraping |

### 3.6 AI & Agent Management (5)

| Skill | Description |
|-------|-------------|
| **clawhub** | ClawHub CLI: search, install, update, publish skills |
| **model-usage** | Per-model usage/cost summaries via CodexBar |
| **node-connect** | Diagnose node connection/pairing failures |
| **oracle** | Oracle CLI: prompt bundling, engines, sessions |
| **session-logs** | Search/analyze session logs via jq |

### 3.7 TTS & Voice (2)

| Skill | Description |
|-------|-------------|
| **sag** | ElevenLabs TTS with mac-style `say` UX |
| **sherpa-onnx-tts** | Local offline TTS via sherpa-onnx |

### 3.8 Search & Web (4)

| Skill | Description |
|-------|-------------|
| **blogwatcher** | Monitor blogs and RSS/Atom feeds for updates |
| **goplaces** | Google Places API text search and details |
| **summarize** | Summarize/transcribe URLs, podcasts, local files |
| **weather** | Weather/forecasts via wttr.in or Open-Meteo |

### 3.9 System & Utilities (4)

| Skill | Description |
|-------|-------------|
| **canvas** | Canvas visual workspace skill |
| **healthcheck** | Host security hardening and risk-tolerance configuration |
| **peekaboo** | macOS UI capture and automation |
| **spotify-player** | Terminal Spotify playback/search |

---

## 4. Extensions (77)

Source: `extensions/`

### 4.1 Messaging Channels (23)

| Extension | Description |
|-----------|-------------|
| **bluebubbles** | BlueBubbles iMessage channel |
| **discord** | Discord channel |
| **feishu** | Feishu/Lark channel (community: @m1heng) |
| **googlechat** | Google Chat channel |
| **imessage** | iMessage channel |
| **irc** | IRC channel |
| **line** | LINE channel |
| **matrix** | Matrix channel |
| **mattermost** | Mattermost channel |
| **msteams** | Microsoft Teams channel |
| **nextcloud-talk** | Nextcloud Talk channel |
| **nostr** | Nostr NIP-04 encrypted DMs |
| **signal** | Signal channel |
| **slack** | Slack channel |
| **synology-chat** | Synology Chat channel |
| **telegram** | Telegram channel |
| **tlon** | Tlon/Urbit channel |
| **twitch** | Twitch channel |
| **whatsapp** | WhatsApp channel |
| **zalo** | Zalo channel |
| **zalouser** | Zalo Personal Account via zca-js |

### 4.2 AI / LLM Providers (32)

| Extension | Description |
|-----------|-------------|
| **amazon-bedrock** | Amazon Bedrock provider |
| **anthropic** | Anthropic provider |
| **anthropic-vertex** | Anthropic via Google Vertex |
| **byteplus** | BytePlus provider |
| **chutes** | Chutes.ai provider |
| **cloudflare-ai-gateway** | Cloudflare AI Gateway provider |
| **copilot-proxy** | GitHub Copilot Proxy provider |
| **fal** | fal provider (image generation) |
| **github-copilot** | GitHub Copilot provider |
| **google** | Google (Gemini) provider |
| **huggingface** | Hugging Face provider |
| **kilocode** | Kilo Gateway provider |
| **kimi-coding** | Kimi provider |
| **minimax** | MiniMax provider + OAuth |
| **mistral** | Mistral provider |
| **modelstudio** | Model Studio provider |
| **moonshot** | Moonshot provider |
| **nvidia** | NVIDIA provider |
| **ollama** | Ollama (local) provider |
| **openai** | OpenAI provider |
| **opencode** | OpenCode Zen provider |
| **opencode-go** | OpenCode Go provider |
| **openrouter** | OpenRouter provider |
| **perplexity** | Perplexity provider |
| **qianfan** | Qianfan provider |
| **sglang** | SGLang provider |
| **together** | Together provider |
| **venice** | Venice provider |
| **vercel-ai-gateway** | Vercel AI Gateway provider |
| **vllm** | vLLM provider |
| **volcengine** | Volcengine provider |
| **xai** | xAI (Grok) provider |
| **xiaomi** | Xiaomi provider |
| **zai** | Z.AI provider |

### 4.3 Speech & TTS (3)

| Extension | Description |
|-----------|-------------|
| **elevenlabs** | ElevenLabs speech synthesis |
| **microsoft** | Microsoft speech (Azure TTS/STT) |
| **talk-voice** | Voice/talk mode runtime |

### 4.4 Memory & Knowledge (2)

| Extension | Description |
|-----------|-------------|
| **memory-core** | Core memory search plugin |
| **memory-lancedb** | LanceDB-backed long-term memory with auto-recall/capture |

### 4.5 Web Search & Content (3)

| Extension | Description |
|-----------|-------------|
| **brave** | Brave Search |
| **tavily** | Tavily search |
| **firecrawl** | Firecrawl web scraping |

### 4.6 Capabilities & Utilities (11)

| Extension | Description |
|-----------|-------------|
| **acpx** | ACP runtime backend via acpx |
| **device-pair** | Device pairing for companion apps |
| **diagnostics-otel** | OpenTelemetry diagnostics exporter |
| **diffs** | Diff viewer plugin |
| **llm-task** | JSON-only LLM task plugin |
| **lobster** | Typed pipelines + resumable approvals workflow |
| **open-prose** | OpenProse VM skill pack (slash command + telemetry) |
| **openshell** | OpenShell sandbox backend |
| **phone-control** | Phone/device control |
| **qwen-portal-auth** | Qwen portal authentication |
| **voice-call** | Voice call plugin |

### 4.7 Infrastructure (3)

| Extension | Description |
|-----------|-------------|
| **shared** | Shared extension utilities |
| **synthetic** | Synthetic/test provider |
| **thread-ownership** | Thread ownership management |

---

## 5. Media Pipeline

### 5.1 Core Media (`src/media/`)

| Module | Description |
|--------|-------------|
| **audio.ts** | Audio processing, format detection, duration extraction |
| **audio-tags.ts** | Audio metadata/tag extraction |
| **image-ops.ts** | Image manipulation: resize, convert, optimize |
| **pdf-extract.ts** | PDF text and structure extraction |
| **png-encode.ts** | PNG encoding utilities |
| **mime.ts** | MIME type detection and sniffing |
| **base64.ts** | Base64 encode/decode for media |
| **fetch.ts** | Media fetching with Telegram network support |
| **server.ts** | Media server for serving uploaded/generated files |
| **store.ts** | Media storage with redirect support |
| **ffmpeg-exec.ts** | FFmpeg execution wrapper with limits |
| **file-context.ts** | File context resolution for media inputs |
| **web-media.ts** | Web-sourced media handling |
| **inbound-path-policy.ts** | Security policies for inbound media paths |

**Supported formats:** Images (PNG, JPEG, GIF, WebP, SVG), Audio (MP3, WAV, OGG, M4A, FLAC, WebM), Video (MP4, MOV, WebM, AVI), Documents (PDF)

### 5.2 Media Understanding (`src/media-understanding/`)

Multi-provider media analysis pipeline:

| Provider | Directory | Capabilities |
|----------|-----------|-------------|
| **OpenAI** | `providers/openai/` | Vision (images), audio transcription |
| **Google** | `providers/google/` | Gemini vision + audio |
| **Deepgram** | `providers/deepgram/` | Audio transcription |
| **Groq** | `providers/groq/` | Audio transcription |
| **Mistral** | `providers/mistral/` | Vision analysis |
| **Moonshot** | `providers/moonshot/` | Vision analysis |

Additional capabilities:
- **Video processing** (`video.ts`): Frame extraction for vision analysis
- **Echo transcript** (`echo-transcript.ts`): Transcript passthrough
- **Concurrency control** (`concurrency.ts`): Rate limiting for external APIs
- **Auto-audio detection** (`runner.auto-audio.test.ts`): Automatic audio format handling

### 5.3 Image Generation (`src/image-generation/`)

| Provider | File | Models |
|----------|------|--------|
| **OpenAI** | `providers/openai.ts` | DALL-E 3, GPT-Image |
| **fal** | `providers/fal.ts` | Flux, SDXL, etc. |
| **Google** | `providers/google.ts` | Imagen |

### 5.4 Text-to-Speech (`src/tts/`)

| Provider | File | Features |
|----------|------|----------|
| **OpenAI** | `providers/openai.ts` | OpenAI TTS voices |
| **ElevenLabs** | `providers/elevenlabs.ts` | ElevenLabs voices (via extension) |
| **Microsoft** | `providers/microsoft.ts` | Azure Cognitive Services TTS |
| **Edge TTS** | Validation in `edge-tts-validation.test.ts` | Microsoft Edge TTS (free) |

Core TTS pipeline: `tts-core.ts` handles text preparation, voice selection, and streaming.

---

## 6. ACP (Agent Client Protocol)

Source: `src/acp/`

IDE/editor integration layer implementing the Agent Client Protocol for tools like VS Code, Cursor, and other editors.

| Component | File(s) | Description |
|-----------|---------|-------------|
| **Server** | `server.ts` | ACP gateway server; bridges IDE connections to the OpenClaw gateway |
| **Client** | `client.ts` | ACP client for connecting to remote ACP servers |
| **Translator** | `translator.ts` | Protocol translation: ACP messages to/from gateway protocol; handles cancel scoping, session rate limiting, stop reasons, prompt prefixes |
| **Event Mapper** | `event-mapper.ts` | Maps gateway events to ACP events |
| **Session Mapper** | `session-mapper.ts` | Maps ACP sessions to gateway sessions |
| **Session** | `session.ts` | ACP session lifecycle management |
| **Policy** | `policy.ts` | ACP access and usage policies |
| **Secret File** | `secret-file.ts` | Secure credential storage for ACP connections |
| **Control Plane** | `control-plane/` | ACP control plane: runtime options, session management, identity, spawn |
| **Persistent Bindings** | `persistent-bindings.*.ts` | Persistent IDE-to-agent bindings with lifecycle management |
| **Commands** | `commands.ts` | ACP-specific CLI commands |

---

## 7. Cron (Scheduled Tasks)

Source: `src/cron/`

| Component | File(s) | Description |
|-----------|---------|-------------|
| **Schedule Engine** | `schedule.ts` | Cron expressions, `at` times, `every` intervals with timezone and stagger support |
| **Service** | `service/service.ts` | Main cron service: job management, timer arming, dedup, restart catchup |
| **Isolated Agent** | `isolated-agent/isolated-agent.ts` | Run cron jobs in isolated agent sessions with separate model/auth config |
| **Delivery** | `delivery.ts` | Deliver cron results to channels (announce, webhook, or none) |
| **Store** | `store.ts` | Persistent cron job storage with migration support |
| **Run Log** | `run-log.ts` | Track cron execution history |
| **Heartbeat Policy** | `heartbeat-policy.ts` | Heartbeat-based health monitoring for recurring jobs |
| **Session Reaper** | `session-reaper.ts` | Cleanup stale cron sessions |
| **Stagger** | `stagger.ts` | Deterministic stagger for distributed cron timing |

**Schedule types:** `at` (one-shot), `every` (interval), `cron` (cron expression with tz)
**Delivery modes:** `none`, `announce` (to channel), `webhook`
**Session targets:** `main`, `isolated`, `current`, `session:<id>`

---

## 8. Browser Automation

Source: `src/browser/`

A comprehensive browser automation system with multiple integration modes:

### 8.1 Core Browser Engine

| Component | File(s) | Description |
|-----------|---------|-------------|
| **Chrome Integration** | `chrome.ts`, `chrome.executables.ts` | Chrome/Chromium process management and profile detection |
| **CDP (Chrome DevTools Protocol)** | `cdp.ts`, `cdp-timeouts.ts`, `cdp-proxy-bypass.ts` | Direct CDP connection with timeout and proxy management |
| **Playwright Session** | `pw-session.ts` | Playwright browser session management with page CDPs |
| **Server** | `server.ts` | HTTP/WebSocket browser automation server |
| **Server Context** | `server-context.ts` | Browser context lifecycle: profiles, tab operations, hot reload |

### 8.2 Playwright Tools

| Component | File(s) | Description |
|-----------|---------|-------------|
| **Interactions** | `pw-tools-core.interactions.ts` | Click, type, fill, select, upload files, handle dialogs |
| **Snapshots** | `pw-tools-core.snapshot.ts` | DOM snapshots with role-based accessibility tree |
| **Screenshots** | `pw-tools-core.screenshots-element-selector.test.ts`, `screenshot.ts` | Full-page and element screenshots |
| **State** | `pw-tools-core.state.ts` | Cookie and local storage management |
| **Storage** | `pw-tools-core.storage.ts` | Browser data persistence |
| **Trace** | `pw-tools-core.trace.ts` | Playwright trace recording |
| **Downloads** | `pw-tools-core.downloads.ts` | File download handling |
| **Evaluate** | `pw-tools-core.interactions.evaluate.abort.test.ts` | JavaScript evaluation in page context |

### 8.3 AI-Powered Browser

| Component | File(s) | Description |
|-----------|---------|-------------|
| **AI Module** | `pw-ai.ts`, `pw-ai-module.ts`, `pw-ai-state.ts` | AI-driven browser automation (computer use) |
| **Chrome MCP** | `chrome-mcp.ts`, `chrome-mcp.snapshot.ts` | MCP-based Chrome interaction and snapshot |
| **Client Actions** | `client-actions.ts`, `client-actions-core.ts`, `client-actions-observe.ts` | Programmatic browser interaction API |

### 8.4 Browser Infrastructure

| Component | File(s) | Description |
|-----------|---------|-------------|
| **Profiles** | `profiles.ts`, `profiles-service.ts`, `profile-capabilities.ts` | Multi-profile browser management |
| **Auth** | `control-auth.ts`, `http-auth.ts` | Browser server authentication |
| **Navigation Guard** | `navigation-guard.ts` | URL allowlisting and navigation safety |
| **URL Patterns** | `url-pattern.ts` | URL matching and filtering |
| **Form Fields** | `form-fields.ts` | Form field detection and interaction |
| **Proxy Files** | `proxy-files.ts` | File proxying for browser access |

---

## 9. Canvas (Visual Workspace)

Source: `src/canvas-host/`

| Component | File(s) | Description |
|-----------|---------|-------------|
| **Server** | `server.ts` | HTTP server for hosting canvas artifacts (HTML, CSS, JS) with WebSocket live reload |
| **A2UI** | `a2ui.ts`, `a2ui/` | Agent-to-UI framework: render agent-generated HTML/interactive content |
| **File Resolver** | `file-resolver.ts` | Secure file resolution within canvas root directory |

Features:
- Static file serving with MIME detection
- WebSocket-based live reload for development
- Chokidar file watcher for hot updates
- Configurable root directory and port
- State directory integration

---

## 10. Voice System

### 10.1 Voice Wake (`src/infra/voicewake.ts`)

| Feature | Description |
|---------|-------------|
| **Wake Words** | Configurable triggers: default `["openclaw", "claude", "computer"]` |
| **Persistent Config** | Stored in `settings/voicewake.json` within state directory |
| **Sanitization** | Automatic cleanup and fallback to defaults |

### 10.2 Talk Mode (`src/config/talk.ts`, `src/config/talk-defaults.ts`)

| Feature | Description |
|---------|-------------|
| **Talk Configuration** | Full talk mode configuration schema |
| **API Key Fallback** | Automatic fallback for speech API credentials |
| **Talk Defaults** | Sensible defaults for talk mode parameters |

### 10.3 Voice Call Extension (`extensions/voice-call/`)

| Feature | Description |
|---------|-------------|
| **Voice Call Plugin** | Initiate and manage voice calls |
| **Runtime API** | Programmatic voice call control |

### 10.4 Talk-Voice Extension (`extensions/talk-voice/`)

| Feature | Description |
|---------|-------------|
| **Talk Voice Plugin** | Real-time voice interaction mode |

### 10.5 TTS Pipeline (`src/tts/`)

Multiple TTS providers (OpenAI, ElevenLabs, Microsoft, Edge TTS) with text preparation, voice selection, and streaming output.

---

## 11. Gateway Server

Source: `src/gateway/`

The gateway is the core server that bridges all channels, agents, and tools.

### 11.1 Core Server

| Component | Description |
|-----------|-------------|
| **WebSocket Server** | Real-time bidirectional communication |
| **HTTP Endpoints** | REST API including OpenAI-compatible `/v1/chat/completions` |
| **OpenAI Responses API** | Compatible with OpenAI Responses format |
| **Auth** | Token-based, device auth, role-based access control |
| **Config Reload** | Hot-reload configuration without restart |
| **Multi-Agent** | Run multiple agents with independent configs |

### 11.2 Gateway Methods (`src/gateway/server-methods/`)

| Method Group | Description |
|--------------|-------------|
| **agent** | Agent invocation, events, timestamps |
| **agents** | Agent CRUD mutations |
| **browser** | Browser profile and tab management |
| **channels** | Channel lifecycle and status |
| **chat** | Chat message handling, transcripts, directives |
| **config** | Configuration management |
| **connect** | Client connection handling |
| **cron** | Cron job management |
| **devices** | Device registration and management |
| **doctor** | Diagnostic checks |
| **exec-approval(s)** | Command execution approval workflow |
| **health** | Health check endpoints |
| **logs** | Log streaming |
| **models** | Model catalog and selection |
| **nodes** | Node management, invoke, wake |
| **push** | Push notification delivery |
| **restart-request** | Graceful restart |
| **secrets** | Secret management |
| **send** | Message sending |
| **sessions** | Session lifecycle and history |
| **skills** | Skill status and management |
| **system** | System info and control |
| **talk** | Talk mode configuration |
| **tools-catalog** | Available tool listing |
| **tts** | TTS configuration |
| **update** | System updates |
| **usage** | Usage statistics |
| **validation** | Input validation |
| **voicewake** | Voice wake word configuration |
| **web** | Web UI serving |
| **wizard** | Setup wizard sessions |

---

## 12. Memory System

Source: `src/memory/`

| Component | Description |
|-----------|-------------|
| **Manager** | Central memory management: sync, search, embed, batch operations |
| **Embeddings** | Multi-provider: OpenAI, Gemini, Mistral, Voyage, Ollama, node-llama, remote HTTP |
| **Vector Store** | SQLite-vec for local vector storage |
| **Search** | Hybrid search (vector + keyword), MMR reranking, temporal decay |
| **QMD** | Query-driven memory with query parsing, scoping, and process management |
| **Batch Processing** | Batch embedding via HTTP, Gemini, Voyage providers |
| **Session Files** | Session transcript indexing |
| **Prompt Section** | Memory-augmented prompt generation with citations |
| **Query Expansion** | Automatic query expansion for better recall |
| **Multimodal** | Multimodal memory support |

---

## 13. Additional Systems

### 13.1 Security (`src/security/`)

| Feature | Description |
|---------|-------------|
| **Audit** | Deep security audits: channel allow-from, config regex, dangerous flags, tool policy |
| **Skill Scanner** | Security scanning of skill definitions |
| **DM Policy** | Direct message access policies per channel |
| **Safe Regex** | Regex validation to prevent ReDoS |
| **External Content** | External content security analysis |
| **Windows ACL** | Windows-specific ACL handling |

### 13.2 Daemon (`src/daemon/`)

| Platform | Implementation |
|----------|---------------|
| **macOS** | launchd plist generation and management |
| **Linux** | systemd unit and linger configuration |
| **Windows** | schtasks scheduled task management |
| **Node** | Generic Node.js service mode |

### 13.3 Hooks (`src/hooks/`)

| Feature | Description |
|---------|-------------|
| **Bundled Hooks** | `boot-md`, `bootstrap-extra-files`, `command-logger`, `session-memory` |
| **Gmail Hooks** | Gmail watcher with lifecycle, error handling |
| **Message Hooks** | Pre/post message processing hooks |
| **Plugin Hooks** | Extension-provided hooks |
| **Module Loader** | Dynamic hook module loading |
| **Import URL** | Remote hook import via URL |

### 13.4 Context Engine (`src/context-engine/`)

| Feature | Description |
|---------|-------------|
| **Registry** | Context provider registration |
| **Delegate** | Context delegation to providers |
| **Legacy Support** | Backward-compatible context resolution |

### 13.5 Native Apps

| Platform | Directory | Technology |
|----------|-----------|-----------|
| **macOS** | `apps/macos/` | Swift/SwiftUI (Observation framework) |
| **iOS** | `apps/ios/` | Swift/SwiftUI with Activity Widget and Share Extension |
| **Android** | `apps/android/` | Kotlin/Gradle |
| **Swabble** | `Swabble/` | Swift package: SwabbleCore + SwabbleKit + CLI |

### 13.6 Packages

| Package | Directory | Description |
|---------|-----------|-------------|
| **clawdbot** | `packages/clawdbot/` | Bot runtime package |
| **moltbot** | `packages/moltbot/` | Legacy bot package |

### 13.7 Device Pairing (`src/pairing/`)

| Feature | Description |
|---------|-------------|
| **Setup Codes** | QR/setup code generation for device pairing |
| **Pairing Challenge** | Challenge-response authentication |
| **Pairing Store** | Persistent paired device storage |
| **Bonjour Discovery** | mDNS/Bonjour local network discovery (`src/infra/bonjour*.ts`) |

### 13.8 Routing (`src/routing/`)

| Feature | Description |
|---------|-------------|
| **Account ID Resolution** | Multi-account channel routing |
| **Session Key Continuity** | Persistent session routing across restarts |
| **Default Account Warnings** | Missing default account diagnostics |

### 13.9 Sandbox (`src/process/`)

| Feature | Description |
|---------|-------------|
| **Docker/Podman** | Container-based sandbox execution |
| **Command Queue** | Queued command execution |
| **Kill Tree** | Process tree termination |
| **Supervisor** | Process supervision and restart |
| **Lanes** | Execution lane management |

### 13.10 Web UI (`ui/`)

Single-page web application (Vite + likely React/Vue) serving as the gateway control panel and chat interface.

### 13.11 Internationalization (`src/i18n/`)

Registry-based i18n system. Docs support zh-CN translation via `docs/.i18n/` pipeline.

### 13.12 Auto-Reply (`src/auto-reply/`)

Automated reply system with command detection, dispatch, and state management for channel messages.

### 13.13 Polls (`src/polls.ts`)

Create polls on supported channels (Telegram, Discord) with configurable options, duration, and max selections.

### 13.14 Link Understanding (`src/link-understanding/`)

URL detection and content extraction for shared links in messages.

### 13.15 Markdown Processing (`src/markdown/`)

Channel-specific markdown rendering: WhatsApp formatting, tables, code fences, blockquotes, frontmatter.

### 13.16 Logging (`src/logging/`)

Structured logging with:
- Subsystem-based log routing
- Redaction for secrets/identifiers
- Console capture
- Diagnostic session state
- Log file size caps
- Timestamp management

---

## 14. Cross-References

### Feature Dependencies

| Feature | Depends On |
|---------|-----------|
| **Agent Tools** | Gateway, Memory, Browser, Canvas, Cron, TTS, Sessions, Media Pipeline |
| **Channels** | Gateway, Routing, Media Pipeline, Markdown, Polls, Auto-Reply |
| **Browser** | Gateway (server context), Chrome/Playwright, Media (screenshots) |
| **Voice** | TTS, Gateway (voicewake/talk methods), Native Apps (wake word forwarding) |
| **Cron** | Gateway, Sessions (isolated agents), Delivery (channels), Cron Store |
| **Memory** | Embeddings (multi-provider), SQLite-vec, Session files, Config |
| **ACP** | Gateway (client/translator), Sessions, Config, Auth |
| **Canvas** | Gateway (canvas capability), Media (MIME detection), File system |
| **Skills** | Agent runtime, Node-host (system_run), Config, Plugin SDK |
| **Native Apps** | Gateway (WebSocket), Device Pairing, Push notifications |

### Tool-to-Extension Mapping

| Agent Tool | Required Extension(s) |
|------------|----------------------|
| `web_search` | brave, tavily, perplexity, google (any one) |
| `image_generate` | fal, openai, google (any one) |
| `tts` | elevenlabs, microsoft, openai (any one) |
| `memory` | memory-core or memory-lancedb |
| `browser` | None (core), chrome-mcp optional |
| `message` | Channel extensions (telegram, discord, slack, etc.) |

---

## 15. Rebuild Implications

### Critical (Must-Have for Core Functionality)

| Feature | Reason |
|---------|--------|
| **Gateway Server** | Central nervous system; all features depend on it |
| **Agent Runtime** (`src/agents/`) | Core AI interaction loop |
| **Sessions** | Conversation state management |
| **Config System** | All components read configuration |
| **Auth** | Security foundation for all access |
| **CLI Framework** | Primary user interface |
| **Provider System** | At least one AI provider needed |
| **Message Tool** | Core agent-to-channel communication |
| **Routing** | Multi-channel message dispatch |
| **Daemon** | Background operation (production deployment) |
| **Logging** | Observability and debugging |

### Important (High-Value, Early Priority)

| Feature | Reason |
|---------|--------|
| **Telegram/Discord/Slack channels** | Most-used messaging integrations |
| **Memory System** | Long-term context and recall |
| **Web Search + Fetch** | Essential agent capability |
| **Media Pipeline** | Image/audio/PDF understanding |
| **Cron Scheduler** | Autonomous task execution |
| **Browser Automation** | Computer-use capability |
| **TTS** | Voice interaction support |
| **Doctor** | Self-diagnosis and troubleshooting |
| **Onboarding** | First-run experience |
| **Security Audit** | Safety guarantees |

### Nice-to-Have (Can Be Deferred)

| Feature | Reason |
|---------|--------|
| **Canvas** | Visual workspace; niche use case |
| **ACP** | IDE integration; developer-only |
| **Native Apps (iOS/Android/macOS)** | Companion experience; gateway works standalone |
| **Swabble** | macOS-specific Swift framework |
| **Polls** | Channel-specific feature |
| **Link Understanding** | Enhancement, not core |
| **Auto-Reply** | Convenience feature |
| **Bundled Hooks** | Power-user customization |
| **i18n** | Localization can come later |
| **Many Provider Extensions** | Only need 2-3 providers initially |
| **Niche Channel Extensions** | IRC, Nostr, Tlon, Synology, etc. |
| **Smart Home Skills** | IoT integrations |
| **Lobster/OpenProse** | Specialized workflow tools |

### Rebuild Order Recommendation

1. **Phase 1 (Foundation):** Gateway, Config, Auth, Sessions, Logging, CLI
2. **Phase 2 (Core Agent):** Agent Runtime, Provider System (OpenAI + Anthropic + Ollama), Message Tool, Routing
3. **Phase 3 (Channels):** Telegram, Discord, Slack, WhatsApp, Media Pipeline
4. **Phase 4 (Intelligence):** Memory, Web Search/Fetch, Browser, Cron, TTS
5. **Phase 5 (Experience):** Doctor, Onboarding, Security Audit, Status/Health, Dashboard
6. **Phase 6 (Expansion):** Skills, Canvas, ACP, Native Apps, Additional Providers/Channels

---

## Appendix A: File Counts by Area

| Area | Approx. Files (non-test) | Test Files |
|------|--------------------------|------------|
| `src/agents/` | ~300 | ~310 |
| `src/gateway/` | ~200 | ~250 |
| `src/commands/` | ~150 | ~200 |
| `src/browser/` | ~80 | ~70 |
| `src/cron/` | ~30 | ~50 |
| `src/memory/` | ~60 | ~40 |
| `src/media/` | ~25 | ~15 |
| `src/media-understanding/` | ~25 | ~15 |
| `extensions/` (77 dirs) | ~500+ | ~200+ |
| `skills/` (52 dirs) | ~52 SKILL.md | N/A |
| `src/tts/` | ~8 | ~3 |
| `src/image-generation/` | ~5 | ~3 |
| `src/acp/` | ~25 | ~15 |
| `src/canvas-host/` | ~5 | ~2 |

## Appendix B: Complete Extension List (Alphabetical)

1. acpx
2. amazon-bedrock
3. anthropic
4. anthropic-vertex
5. bluebubbles
6. brave
7. byteplus
8. chutes
9. cloudflare-ai-gateway
10. copilot-proxy
11. device-pair
12. diagnostics-otel
13. diffs
14. discord
15. elevenlabs
16. fal
17. feishu
18. firecrawl
19. github-copilot
20. google
21. googlechat
22. huggingface
23. imessage
24. irc
25. kilocode
26. kimi-coding
27. line
28. llm-task
29. lobster
30. matrix
31. mattermost
32. memory-core
33. memory-lancedb
34. microsoft
35. minimax
36. mistral
37. modelstudio
38. moonshot
39. msteams
40. nextcloud-talk
41. nostr
42. nvidia
43. ollama
44. open-prose
45. openai
46. opencode
47. opencode-go
48. openrouter
49. openshell
50. perplexity
51. phone-control
52. qianfan
53. qwen-portal-auth
54. sglang
55. shared
56. signal
57. slack
58. synology-chat
59. synthetic
60. talk-voice
61. tavily
62. telegram
63. thread-ownership
64. tlon
65. together
66. twitch
67. venice
68. vercel-ai-gateway
69. vllm
70. voice-call
71. volcengine
72. whatsapp
73. xai
74. xiaomi
75. zai
76. zalo
77. zalouser

## Appendix C: Complete Skill List (Alphabetical)

1. 1password
2. apple-notes
3. apple-reminders
4. bear-notes
5. blogwatcher
6. blucli
7. bluebubbles
8. camsnap
9. canvas
10. clawhub
11. coding-agent
12. discord
13. eightctl
14. gemini
15. gh-issues
16. gifgrep
17. github
18. gog
19. goplaces
20. healthcheck
21. himalaya
22. imsg
23. mcporter
24. model-usage
25. nano-pdf
26. node-connect
27. notion
28. obsidian
29. openai-image-gen
30. openai-whisper
31. openai-whisper-api
32. openhue
33. oracle
34. ordercli
35. peekaboo
36. sag
37. session-logs
38. sherpa-onnx-tts
39. skill-creator
40. slack
41. songsee
42. sonoscli
43. spotify-player
44. summarize
45. things-mac
46. tmux
47. trello
48. video-frames
49. voice-call
50. wacli
51. weather
52. xurl
