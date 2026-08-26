# SideMarkDown

SideMarkDown은 Chrome Manifest V3 기반의 최소 Markdown side panel extension입니다.

Chrome side panel 안에서 Markdown 초안을 작성할 수 있으며, 별도 preview pane 없이 작성 화면 자체에서 Markdown이 inline rendering됩니다. 편집기는 Milkdown을 사용하고, 빌드는 Vite + TypeScript로 구성되어 있습니다.

## 주요 기능

- Chrome side panel에서 동작하는 Markdown editor
- Typora처럼 작성 화면 안에서 inline rendering
- 문단 구조를 보존해 현재 source를 복사하는 `Markdown`
- 메모장이나 ChatGPT prompt용 한 줄 간격 source를 복사하는 `Compact`
- editor 내용을 비우는 `Clear`
- Chrome이 종료되기 전까지 작성 중 draft 유지
- 명시적으로 저장한 Markdown을 Chrome 재시작 후에도 유지하는 기기 로컬 Library
- Library 카드의 원문 복사, 편집, 삭제
- 계정, cloud sync, export/import 없음

## 바로 설치하기

빌드 없이 사용하려면 GitHub Release에서 배포용 zip 파일을 내려받습니다.

1. [Releases](https://github.com/Gudals0320/SideMarkDown/releases/latest) 페이지를 엽니다.
2. `SideMarkDown-0.1.0.zip`을 다운로드합니다.
3. zip 파일을 압축 해제합니다.
4. Chrome에서 `chrome://extensions`를 엽니다.
5. 우측 상단의 `Developer mode`를 켭니다.
6. `Load unpacked`를 클릭합니다.
7. 압축 해제한 폴더 중 `manifest.json`이 들어 있는 폴더를 선택합니다.
8. 확장 아이콘을 클릭하면 SideMarkDown side panel이 열립니다.

이 방식은 Chrome Web Store 설치가 아니라 Chrome의 개발자 모드에서 unpacked extension으로 적용하는 방식입니다.

## 설치 및 빌드

source에서 직접 빌드하려면 다음 명령을 실행합니다.

```bash
npm install
npm run build
```

빌드가 끝나면 배포용 Chrome extension 파일은 `dist/`에 생성됩니다.

## Chrome에 적용하는 방법

직접 빌드한 경우 적용 방법:

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 우측 상단의 `Developer mode`를 켭니다.
3. `Load unpacked`를 클릭합니다.
4. 이 프로젝트의 `dist/` 폴더를 선택합니다.
5. 확장 아이콘을 클릭하면 SideMarkDown side panel이 열립니다.

배포용 패키지를 만들 때는 `npm run build` 후 생성된 `dist/` 폴더를 기준으로 패키징합니다.

## 사용 방법

1. 확장 아이콘을 클릭해 side panel을 엽니다.
2. Markdown을 입력합니다.
3. 작성 화면 안에서 heading, list, inline code 등이 바로 렌더링됩니다.
4. 목적에 맞는 복사 버튼을 누릅니다.
5. `Save`를 누르면 현재 Markdown이 새 Library 카드로 저장됩니다. 같은 내용을 다시 저장해도 별도 카드가 생성됩니다.
6. `Library` 탭에서 카드를 누르면 H1을 포함한 저장 원문 전체가 복사됩니다.
7. 카드의 편집 아이콘을 누르면 같은 editor에서 문서를 수정하거나 삭제할 수 있습니다. 이때 일반 session draft는 별도로 보존됩니다.
8. `Clear`를 누르면 일반 Editor 내용과 현재 Chrome session draft가 비워집니다.

| 버튼 | 용도 | 줄바꿈 동작 |
| --- | --- | --- |
| `Markdown` | Typora나 다른 Markdown 문서로 이동 | 문단 사이의 빈 줄을 보존합니다. |
| `Compact` | 메모장이나 ChatGPT prompt에 붙여넣기 | 인접한 heading과 일반 문단은 개행 하나로 연결하고 마지막 개행을 제거합니다. |

editor에서 `Enter`는 새 문단을 만들고 `Shift+Enter`는 문단 안에 hard break를 만듭니다. 두 복사 모드 모두 `Shift+Enter`의 Markdown hard-break 표기와 줄바꿈을 보존합니다. `Compact`로 복사하면 서로 인접한 일반 문단이 빈 줄 없이 연결되므로, 다시 Markdown으로 파싱할 때 하나의 문단과 soft line break로 해석될 수 있습니다. 문단 구조를 보존해야 하는 문서에는 `Markdown`을 사용하세요. List, blockquote, fenced code 내부의 빈 줄과 들여쓰기는 `Compact`에서도 유지되며, 이러한 구조 블록과 다른 최상위 블록 사이에는 구조 분리를 위한 빈 줄을 유지합니다.

## 권한

`public/manifest.json` 기준으로 사용하는 권한은 다음 2개뿐입니다.

| Permission | 목적 |
| --- | --- |
| `sidePanel` | 확장 아이콘 클릭 시 Chrome side panel을 열기 위해 사용 |
| `storage` | 일반 draft는 `chrome.storage.session`에, 명시적으로 저장한 Library 문서는 `chrome.storage.local`에 보관하기 위해 사용 |

`chrome.storage.local`의 Library는 같은 기기와 Chrome profile 안에서만 유지됩니다. 계정 동기화를 위한 `chrome.storage.sync`와 추가 용량을 위한 `unlimitedStorage`는 사용하지 않습니다.

## 보안 검토

최소 권한 원칙에 맞춰 다음 항목을 적용하지 않았습니다.

- `host_permissions` 없음
- `content_scripts` 없음
- `tabs`, `scripting`, `cookies` 권한 없음
- `clipboardRead` 권한 없음
- `storage.sync`, `unlimitedStorage` 사용 없음
- 외부 CDN 또는 원격 script 로딩 없음
- custom `content_security_policy` 없음
- 원격 서버 전송 기능 없음

SideMarkDown은 사용자가 side panel에 입력하거나 Library에 저장한 Markdown을 extension 내부에서만 다룹니다. `Markdown`, `Compact`, Library 카드 복사는 사용자가 직접 누른 경우에만 `text/plain` clipboard write 경로로 원문을 복사합니다.

## 저장 정책

일반 Editor에서 작성 중인 draft와 사용자가 명시적으로 저장한 Library 문서는 서로 다른 수명으로 관리됩니다.

- 일반 draft는 `chrome.storage.session`에 저장되어 side panel을 닫았다 다시 여는 동안 유지되지만, Chrome 재시작, extension reload 또는 update 뒤에는 사라질 수 있습니다.
- `Save`로 만든 Library 문서는 `chrome.storage.local`에 저장되어 Chrome을 완전히 종료하고 다시 실행해도 같은 기기와 Chrome profile에서 유지됩니다.
- 카드 제목과 미리보기는 저장 원문에서 파생되며, 카드 클릭 시에는 H1을 포함한 원문 전체가 복사됩니다.
- extension 제거 후 복구, 다른 기기나 profile로의 이전, backup/restore, cloud sync는 지원하지 않습니다.

## 기술 구성

- Chrome Manifest V3
- Chrome `sidePanel` API
- Vite
- TypeScript
- Milkdown
- Zod

## 프로젝트 구조

```text
SideMarkDown/
  public/manifest.json
  sidepanel.html
  src/background.ts
  src/library.ts
  src/sidepanel.ts
  src/inline-code-cleanup.ts
  src/markdown-copy.ts
  src/styles.css
  tests/extension-contract.test.mjs
  tests/library.test.mjs
  tests/library-e2e.test.mjs
  package.json
  tsconfig.json
  vite.config.ts
```

## 검증 명령

```bash
npm ci
npx playwright install chromium
npm test
npm run test:e2e
npm run test:all
npm audit --audit-level=moderate
```

`npm test`는 빌드와 20개의 extension contract 및 Library domain test를 실행합니다. `npm run test:e2e`는 격리된 Chromium 프로필을 시작하고 `dist/`를 unpacked extension으로 로드해 기존 editor 회귀와 Library 사용자 흐름 19개를 검증합니다. 여기에는 3,000자 이상 문서를 저장한 뒤 같은 프로필로 Chrome을 완전히 다시 실행하는 영속성 시나리오가 포함됩니다. 이 검증은 사용자의 일반 Chrome 프로필을 수정하지 않습니다. `npm run test:all`은 build, contract/domain test, 실제 extension E2E를 모두 실행하는 전체 로컬 게이트입니다. 마지막으로 `npm audit --audit-level=moderate`로 moderate 이상 보안 취약점을 확인합니다.
