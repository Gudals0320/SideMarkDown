# SideMarkDown

Chrome side panel에서 Typora 느낌의 Markdown 초안을 작성하기 위한 최소 확장 템플릿입니다.

## Plan review

현재 계획은 MVP로 적절합니다. 핵심은 `textarea + preview`가 아니라 Milkdown 기반 WYSIWYG Markdown 편집면을 side panel에 올리는 것입니다. 저장, 동기화, 여러 문서, host permission은 초기 범위에서 빼는 게 맞습니다.

가장 중요한 트레이드오프는 의존성입니다. Milkdown은 Typora식 경험에는 적합하지만 단순 textarea보다 번들이 큽니다. 그래도 “작성 화면 자체가 렌더링되어야 한다”는 요구가 우선이라면 합리적인 선택입니다.

## What is included

- Chrome Manifest V3
- Chrome `sidePanel` API
- Vite + TypeScript
- Milkdown CommonMark editor
- Copy Markdown
- Clear
- Chrome session 동안 draft 유지
- No persistent save
- No host permissions

## Commands

```bash
npm install
npm run build
```

Chrome에서 테스트:

1. `chrome://extensions` 열기
2. Developer mode 켜기
3. Load unpacked 클릭
4. 이 프로젝트의 `dist` 디렉토리 선택
5. 확장 아이콘 클릭

## Project structure

```text
sidemarkdown/
  public/manifest.json
  src/background.ts
  sidepanel.html
  src/sidepanel.ts
  src/styles.css
  package.json
  tsconfig.json
  vite.config.ts
```

## Notes

- Copy는 버튼 클릭 이벤트 안에서 `navigator.clipboard.writeText()`를 사용합니다.
- 장기 저장 기능은 없습니다.
- 작성 중 draft는 `chrome.storage.session`에만 보관되며 Chrome 재시작, 확장 reload/update 시 사라집니다.
