<!-- Heybe: Mac에서 실행되는 오픈소스 개인 AI 비서 / 로컬 AI 에이전트 -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe: 내 Mac에서 실행되는 오픈소스 개인 AI 비서" width="760"></a>
</p>

<h1 align="center">Heybe: Mac용 오픈소스 개인 AI 비서</h1>

<p align="center"><b>한 번만 말하세요. 나머지는 Heybe가 알아서.</b><br>
내 컴퓨터에서 돌아가는 로컬 AI 에이전트. 샌드박스 안에서 일하고, 중요한 작업 전에는 꼭 먼저 물어봅니다.<br>
기본은 DeepSeek이며, 내 OpenAI 또는 Claude API 키를 사용할 수도 있습니다.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: macOS (Apple Silicon)" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-black">
  <img alt="Status: developer preview in development" src="https://img.shields.io/badge/status-developer%20preview%20in%20development-orange">
  <a href="CONTRIBUTING.md"><img alt="DCO sign-off required" src="https://img.shields.io/badge/DCO-sign--off-green"></a>
  <a href="https://heybe.dev"><img alt="Website: heybe.dev" src="https://img.shields.io/badge/web-heybe.dev-E8453C"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>한국어</b> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (Brasil)</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **현재 개발자 프리뷰를 개발 중이며 아직 다운로드할 수 없습니다.** 아래 스크린샷은 샘플 데이터로 만든 디자인 미리보기입니다.
> **[heybe.dev](https://heybe.dev)** 에서 대기자 명단에 등록하거나 [클릭 가능한 프로토타입](https://heybe.dev/demo)을 체험해 보세요.

## Heybe란?

Heybe는 **내 컴퓨터에서 실행되는 개인용 AI 비서**입니다. 친구에게 부탁하듯 말하면 단계를 계획하고, 웹을 찾아보고, 보고서나 초안을 작성해 결과를 Mac에 파일로 저장합니다. 창을 닫아도 작업은 계속됩니다.

AI 에이전트를 처음 써 보는 분, 그리고 직접 확인하고 고칠 수 있는 **셀프 호스팅 AI 비서**가 필요한 1인 창업자와 개발자를 위해 만들고 있습니다.

- **내 Mac에서 실행**: 파일, 작업, 기록이 내 컴퓨터에 남습니다.
- **안전한 작업 공간**: 모든 작업은 기본적으로 격리된 샌드박스에서 실행되어 개인 파일에 닿지 않습니다.
- **실행 전 확인**: 파일 삭제, 작업 폴더 밖 쓰기, 예산 초과는 클릭으로 승인해야 합니다. 채팅에 "네"라고 쓰는 것만으로는 실행되지 않습니다.
- **AI는 내가 선택**: 기본 DeepSeek, 내 OpenAI·Anthropic Claude API 키 사용(BYOK), Ollama 로컬 모델로 오프라인 대화.
- **오픈소스**: Community 버전은 Apache-2.0이며 저희 계정 없이 빌드하고 실행할 수 있습니다.

## 화면 미리보기 (디자인 시안)

> v1 디자인 시안이며 내용은 샘플입니다. 실제 제품과 다를 수 있습니다.

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Heybe 데스크톱 앱 화면 개요: 첫 실행, 채팅, 작업 진행, 작업 승인, 결과 보고서, 설정" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Heybe 첫 실행: DeepSeek, 내 OpenAI·Claude API 키, Mac 로컬 모델 중 선택" width="420"><br>**1. 첫 실행**: 사용할 AI 선택(DeepSeek, 내 키, 로컬). | <img src="docs/images/heybe-chat-plan.png" alt="Heybe 채팅: 로컬 AI 비서가 한 문장을 단계별 계획으로 정리" width="420"><br>**2. 채팅**: 한 번 말하면 계획부터. 창을 닫아도 계속 진행. |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Heybe 작업 진행: 각 단계가 샌드박스에서 실행되며 중지 버튼과 비용 표시" width="420"><br>**3. 작업 진행**: 실시간 단계, 안전 공간 표시, 중지 버튼, 현재 비용. | <img src="docs/images/heybe-action-approval.png" alt="Heybe 승인 창: AI 에이전트가 파일 삭제 전에 거부, 수정, 승인을 묻는 화면" width="420"><br>**4. 승인**: 중요한 작업은 클릭을 기다립니다. |
| <img src="docs/images/heybe-task-result-report.png" alt="Heybe 결과: 출처가 달린 비교표와 추천을 로컬 파일로 저장" width="420"><br>**5. 결과**: 출처가 있는 보고서를 Heybe 폴더에 저장. | <img src="docs/images/heybe-settings-api-keys.png" alt="Heybe 설정: AI 제공자와 API 키, 항상 켜진 샌드박스, Telegram 등 메신저는 곧 지원" width="420"><br>**6. 설정**: AI와 키, 안전 규칙, 메신저(곧 지원). |

## Heybe로 할 수 있는 일

| 이렇게 말하면 | Heybe가 하는 일 |
|---|---|
| "이 노트 앱 다섯 개 비교해 줘." | 각 사이트를 확인해 출처가 달린 비교표와 추천을 만듭니다. |
| "회의록을 주간 보고로 정리해 줘." | 결정 사항, 할 일, 담당자를 정리한 초안을 만듭니다. |
| "이 기사와 링크된 글 세 개를 요약해 줘." | 페이지를 읽고 링크가 포함된 짧은 요약을 씁니다. |
| "임시 폴더 좀 정리해 줘." | 오래된 사본을 찾고 휴지통으로 옮기기 전에 묻습니다. |
| "이번 주 사이트 지표를 정리해 줘." (1인 창업자) | 짧은 요약과 다음 주 아이디어. |

자세한 내용은 [docs/use-cases.md](docs/use-cases.md)(영문). 첫 프리뷰 이후 아침 브리핑 예약, 가격 알림, **Telegram** 등 메신저 연동을 계획하고 있습니다.

## 기능과 진행 상황

| 기능 | 상태 |
|---|---|
| macOS 데스크톱 앱(Tauri + React), Apple Silicon 우선 | 개발 중 |
| DeepSeek(기본), OpenAI, Claude(내 API 키) 스트리밍 대화 | 개발 중 |
| Ollama 로컬 모델(채팅 전용, 오프라인) | 개발 중 |
| 웹 페이지를 직접 읽는 검색, 출처 표시 | 개발 중 |
| 창을 닫아도 이어지는 긴 작업(로컬 작업 관리자, SQLite) | 뼈대 병합됨 |
| 기본 샌드박스: 세션마다 마이크로 VM(BoxLite, 대안 Lima) | 검증 중 |
| 중요한 작업 클릭 승인, 작업별 비용·모델 표시 | 개발 중 |
| heybe.dev에서 서명·공증된 DMG 배포(Mac App Store 미출시) | 예정 |
| 보고, 고치고, 지울 수 있는 장기 기억 | v1.1 예정 |
| Telegram 등 메신저 | 예정 |
| 에이전트 팀 동적 구성 | Heybe Pro(추후) |

## 비슷한 제품과 비교

2026년 10월 기준 공개 정보를 요약했습니다. 제품은 자주 바뀌므로 각 회사의 공식 문서를 확인하세요.

| | 실행 위치 | 소스 | 모델 | 안전 장치 | 메신저 |
|---|---|---|---|---|---|
| **Heybe**(개발 중) | 내 Mac | 오픈소스(Apache-2.0), 추후 Pro | DeepSeek, OpenAI, Claude(내 키), Ollama | 기본 샌드박스 + 클릭 승인 | Telegram 예정 |
| [ChatGPT](https://chatgpt.com)(Work / 클라우드 브라우저) | OpenAI 클라우드, 데스크톱·모바일 앱 | 비공개 | OpenAI | 새 사이트 방문과 중요한 작업 전 확인 | — |
| [Claude](https://claude.com) 데스크톱(Cowork) | 데스크톱 앱(macOS, Windows), 코드는 로컬 VM, 클라우드 세션도 있음 | 비공개 | Claude | 허용한 폴더만, 민감한 작업 전 확인 | — |
| [Manus](https://manus.im) | 클라우드 에이전트, 데스크톱 앱은 허용한 폴더에서 작업 | 비공개 | Manus 관리 | 로컬 명령마다 승인 | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | 내 컴퓨터나 서버(macOS, Windows, Linux) | 오픈소스(MIT) | 클라우드·로컬 | 선택형 샌드박스(Docker 등) | 20개 이상 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | 셀프 호스팅 멀티 에이전트 런타임 | 소스 공개(FastClaw Community License) | 클라우드·로컬 | 여러 샌드박스 백엔드 | 여러 개 |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | 터미널 | 오픈소스(Apache-2.0) | 클라우드·로컬 | 코드 실행 전 확인 | — |
| [Jan](https://jan.ai) | 데스크톱 앱 | 오픈소스(Apache-2.0) | 로컬(llama.cpp)과 클라우드 API | 채팅 중심, 도구 호출 승인 | — |
| [LM Studio](https://lmstudio.ai) | 데스크톱 앱 | 비공개(개인·업무 무료) | 로컬 모델 | 채팅 중심 | — |

**Heybe를 고를 이유**: 내 Mac에서 돌아가고, 오픈소스이며, 내 API 키를 쓰고, AI와 내 파일 사이에 샌드박스와 승인 버튼이 있는 **Manus 대안**이나 **ChatGPT 에이전트 대안**을 찾는다면.
**아직은 아닐 이유**: Heybe는 아직 출시 전입니다. 지금 당장 필요하다면 위의 성숙한 도구를 추천합니다.

Heybe는 FastClaw의 `/v1` API 위에서 동작하며 이 저장소에는 FastClaw가 포함되지 않습니다([NOTICE](NOTICE) 참고). 언급된 제품명과 상표는 각 소유자에게 있으며 Heybe는 이들과 제휴하거나 보증받지 않았습니다.

## 개인정보와 안전

v1의 설계 원칙이며, 프리뷰 공개 전에 각각 테스트로 확인합니다.

- **기본은 로컬**: 작업, 파일, 기록은 Mac에 저장됩니다. 프롬프트는 내가 고른 AI 서비스로만 가고, 로컬 모델이면 어디에도 가지 않습니다.
- **키는 내 것**: API 키는 macOS 키체인에 보관하며 저장소, 로그, 내보내기에 넣지 않습니다.
- **샌드박스 상시 켜짐**: v1에는 샌드박스를 끄는 모드가 없습니다.
- **승인은 클릭으로**: 무엇이 일어나고 되돌릴 수 있는지 보여 주고, 클릭하기 전에는 실행하지 않습니다.
- **정직한 결과**: 실패는 실패로 표시하고, 애매한 결과는 "검토 대기"로 멈춥니다.

## 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 저장소, FastClaw `/v1` 어댑터, 샌드박스 검증, API 확인 | 진행 중 |
| 1 | 데스크톱 채팅, 제공자와 키, 웹 읽기, 작업과 결과 | 진행 중 |
| v1 개발자 프리뷰 | macOS(Apple Silicon)에서 소스 빌드 | 아직 없음 |
| v1.1 | 장기 기억 | 예정 |
| 이후 | 메신저, 예약 작업, 멀티 에이전트, 서명된 DMG | 예정 |

## 개발자 빠른 시작

현재 저장소에서 동작하는 것은 TypeScript 워크스페이스(어댑터, 작업 관리자, 임시 데스크톱 화면)와 테스트입니다. 엔드투엔드 앱은 아직 없습니다.

```bash
# Node 20 이상, pnpm 10 필요 (corepack enable)
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + 경계 검사 + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # 임시 화면: http://localhost:1420
```

FastClaw와 샌드박스 설정: [docs/phase0-dev-env.md](docs/phase0-dev-env.md), [docs/sandbox-options.md](docs/sandbox-options.md). 실제 키를 파일에 넣지 마세요(`.env`는 git에서 제외됩니다).

## 자주 묻는 질문

<details><summary><b>Mac에서 로컬로 돌아가는 오픈소스 AI 비서가 있나요?</b></summary>
Heybe가 바로 그것을 목표로 개발 중입니다. Apache-2.0, Mac에서 실행, 기본 샌드박스. 아직 다운로드는 불가합니다.</details>

<details><summary><b>Heybe는 무료 Manus 대안인가요?</b></summary>
Community 버전은 무료 오픈소스입니다. 작업은 내 컴퓨터에서 실행되며, 비용은 선택한 AI 서비스(예: DeepSeek) 요금뿐이고 로컬 모델이면 무료입니다.</details>

<details><summary><b>내 OpenAI나 Claude API 키를 쓸 수 있나요?</b></summary>
네. 기본은 DeepSeek이고 OpenAI 또는 Anthropic Claude 키를 가져올 수 있습니다. 키는 macOS 키체인에 저장됩니다.</details>

<details><summary><b>로컬 LLM으로 오프라인 사용이 되나요?</b></summary>
v1에서 Ollama를 통한 오프라인 채팅을 계획하고 있습니다. 로컬 모델의 도구 실행은 아직 보장하지 않습니다.</details>

<details><summary><b>Telegram에서 쓸 수 있나요? Windows는요?</b></summary>
Telegram 등 메신저는 첫 프리뷰 이후 지원 예정입니다. v1은 Mac(Apple Silicon 우선)만 지원합니다.</details>

## Community와 Pro

| | Heybe Community | Heybe Pro(추후) |
|---|---|---|
| 라이선스 | Apache-2.0(이 저장소) | 비공개(Slovian Inc) |
| 비서, 작업, 샌드박스, 승인, 내 키 사용 | ✓ | ✓ |
| 작업마다 알맞은 에이전트 팀 자동 구성 | — | ✓ |
| 가격 | 무료 | 미정 |

## 기여하기

환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 주세요. 모든 커밋에 DCO 서명(`git commit -s`)이 필요하며 CI가 확인합니다. 인용은 [CITATION.cff](CITATION.cff)를 참고하세요.

## 라이선스

자체 코드는 [Apache License 2.0](LICENSE)(Copyright 2026 Slovian Inc)입니다. FastClaw에는 별도로 FastClaw Community License가 적용됩니다([NOTICE](NOTICE)). Heybe는 FastClaw, OpenAI, Anthropic, DeepSeek, Manus, xAI와 제휴 관계가 없습니다.
