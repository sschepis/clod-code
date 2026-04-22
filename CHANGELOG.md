# Changelog

All notable changes to the **Oboto VS** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-21

### Added

- Multi-LLM chat panel with streaming responses (OpenAI, Anthropic, Gemini, Ollama, LM Studio, and more)
- Dual-LLM triage architecture: fast local model for classification, powerful remote model for execution
- Background agent spawning with `@agent` mentions and concurrent task execution
- Interactive surfaces (HTML webview panels) and local API routes
- Skill system with slash-command registration
- Project scaffolding and convention scanning
- Hierarchical memory (global, project, conversation scopes)
- Peer-to-peer dispatch across VS Code windows on the same workspace
- Editor context menu integration (Ask, Explain, Refactor, Write Tests)
- Multi-chat window support with session persistence
- Plan-propose workflow with approval prompts
- File decoration for AI-modified files (planned)
- Speech-to-text input via microphone
- Kuramoto cross-agent synchronization monitor
- Welcome walkthrough for first-time setup
