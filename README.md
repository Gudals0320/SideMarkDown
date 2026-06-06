# SideMarkDown

SideMarkDown은 Chrome Manifest V3 기반의 최소 Markdown side panel extension입니다.

Chrome side panel 안에서 Markdown 초안을 작성할 수 있으며, 별도 preview pane 없이 작성 화면 자체에서 Markdown이 inline rendering됩니다. 편집기는 Milkdown을 사용하고, 빌드는 Vite + TypeScript로 구성되어 있습니다.

## 주요 기능

- Chrome side panel에서 동작하는 Markdown editor
- Typora처럼 작성 화면 안에서 inline rendering
- 현재 문서의 Markdown source를 복사하는 `Copy Markdown`
- editor 내용을 비우는 `Clear`
- Chrome이 종료되기 전까지 작성 중 draft 유지
- 장기 저장, 문서 관리, 동기화, autosave UI 없음

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
4. `Copy Markdown`을 누르면 현재 문서의 Markdown source가 clipboard에 복사됩니다.
5. `Clear`를 누르면 editor 내용과 현재 Chrome session draft가 비워집니다.

## 권한

`public/manifest.json` 기준으로 사용하는 권한은 다음 2개뿐입니다.

| Permission | 목적 |
| --- | --- |
| `sidePanel` | 확장 아이콘 클릭 시 Chrome side panel을 열기 위해 사용 |
| `storage` | Chrome이 완전히 종료되기 전까지 작성 중 draft를 `chrome.storage.session`에 보관하기 위해 사용 |

`storage` permission은 장기 저장을 위한 `chrome.storage.local` 또는 계정 동기화를 위한 `chrome.storage.sync`에 사용하지 않습니다. 이 프로젝트는 session 저장소인 `chrome.storage.session`만 사용합니다.

## 보안 검토

최소 권한 원칙에 맞춰 다음 항목을 적용하지 않았습니다.

- `host_permissions` 없음
- `content_scripts` 없음
- `tabs`, `scripting`, `cookies` 권한 없음
- `clipboardRead` 권한 없음
- `storage.local`, `storage.sync`, `unlimitedStorage` 사용 없음
- 외부 CDN 또는 원격 script 로딩 없음
- custom `content_security_policy` 없음
- 원격 서버 전송 기능 없음

SideMarkDown은 사용자가 side panel에 입력한 Markdown draft를 extension 내부에서만 다룹니다. `Copy Markdown`은 사용자가 버튼을 누른 경우에만 현재 Markdown source를 clipboard에 씁니다.

## 저장 정책

SideMarkDown은 영구 저장 기능을 제공하지 않습니다.

작성 중 draft는 Chrome session 동안만 유지됩니다. Chrome 재시작, extension reload, extension update 이후에는 session draft가 사라질 수 있습니다. 이 동작은 문서 저장 기능이 아니라 side panel을 닫았다 다시 열 때 작성 중 내용을 임시로 유지하기 위한 최소 기능입니다.

## 기술 구성

- Chrome Manifest V3
- Chrome `sidePanel` API
- Vite
- TypeScript
- Milkdown

## 프로젝트 구조

```text
SideMarkDown/
  public/manifest.json
  sidepanel.html
  src/background.ts
  src/sidepanel.ts
  src/inline-code-cleanup.ts
  src/markdown-copy.ts
  src/styles.css
  tests/extension-contract.test.mjs
  package.json
  tsconfig.json
  vite.config.ts
```

## 검증 명령

```bash
npm run build
node --test tests\extension-contract.test.mjs
```
