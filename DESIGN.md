# SideMarkDown Design System

## 1. Atmosphere & Identity

SideMarkDown is a **Quiet Paper Workbench**: warm paper-like neutrals, crisp ink text, a restrained cobalt interaction accent, compact command chrome, and calm tonal layers make writing beside an active browser page feel precise, local, and trustworthy. Its signature is **ink on warm paper with instrument-like controls**: the interface recedes behind the words while actions remain immediately discoverable. This is warm editorial minimalism inspired by Notion's restraint, not a clone; it rejects the current Nord/browser-default mix, equal-weight button rows, hover-hidden primary actions, purple or blue AI gradients, oversized rounding, glass effects, and decorative motion.

## 2. Color

### Palette

All foreground/background contexts below were checked with the WCAG relative-luminance formula. Raw values belong in this table only; implementation consumes semantic roles. The light and dark schemes are automatic through `prefers-color-scheme`.

| Role | Light | Dark | Minimum verified contrast context |
| --- | --- | --- | --- |
| Canvas | `#F2F0EB` | `#1F211F` | outer workbench |
| Surface | `#F8F7F3` | `#262925` | header and controls |
| Editor surface | `#FFFDF8` | `#232522` | writing surface |
| Surface subtle | `#ECE9E2` | `#2D312C` | grouped/contextual controls |
| Ink | `#2A2927` | `#EAE7DF` | 14.30:1 light, 12.50:1 dark on editor |
| Ink strong | `#181715` | `#FFFDF7` | headings and active labels |
| Ink muted | `#67635D` | `#B0ACA2` | 5.87:1 light, 6.82:1 dark on editor |
| Ink faint | `#8A857C` | `#817D74` | 3.61:1 light, 3.77:1 dark; metadata/disabled only |
| Border | `#D9D4CA` | `#41443E` | quiet separation |
| Border strong | `#B9B2A7` | `#5D625A` | control boundary |
| Accent | `#4C6FA3` | `#9CB5D4` | 5.03:1 light, 7.34:1 dark on editor |
| Accent strong | `#355884` | `#C2D2E7` | 7.17:1 light, 10.05:1 dark on editor |
| Accent soft | `#E5EBF3` | `#313A46` | selected/background tint |
| Danger | `#A84C47` | `#E3A09A` | 5.17:1 light, 6.84:1 dark on surface |
| Danger soft | `#F5E7E4` | `#4A302F` | destructive background tint |
| Inline-code ink | `#5A4630` | `#E6C79D` | 7.47:1 light, 7.72:1 dark |
| Inline-code surface | `#F1EADF` | `#3A332A` | compact semantic highlight |
| Code surface | `#24282E` | `#171A1F` | fenced code block |
| Code ink | `#F4EFE6` | `#F2EFE8` | 12.93:1 light, 15.19:1 dark |
| Quote rule | `#8DA1B9` | `#71869F` | structural rail |
| Quote surface | `#F1F3F6` | `#292E34` | quiet quote tint |
| Selection | `#CBD8E8` | `#465873` | selected text background |
| Selection ink | `#1A2230` | `#FFFDF7` | 11.04:1 light, 7.11:1 dark |
| Caret | `#355884` | `#C2D2E7` | visible insertion point |

### Rules

- Accent is reserved for interactive, selected, focus, and active meaning, never decoration. Danger never carries meaning by color alone.
- Ink faint is metadata or disabled text only; it is not body text. Links use Accent strong with an always-visible underline and a 2px underline offset; hover/focus thickens the underline while visited links remain cobalt.
- Selection uses the Selection pair, and caret uses the Caret pair in both schemes. Inline code, code blocks, and quotes use their dedicated pairs rather than a generic surface token.

## 3. Typography

### Scale

The CJK-safe primary stack is `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif`; the local mono stack is `"Cascadia Mono", Consolas, "Liberation Mono", monospace`. The default body is **15px/1.72** and never becomes smaller for headings H4-H6.

| Level | Size / line height | Weight | Tracking | Usage |
| --- | --- | --- | --- | --- |
| H1 | 26px / 1.2 | 700 | `-0.025em` | primary document heading |
| H2 | 21px / 1.3 | 700 | `-0.018em` | section heading |
| H3 | 17px / 1.4 | 600 | `-0.01em` | subsection heading |
| H4 | 15px / 1.5 | 600 | normal | compact hierarchy |
| H5 | 15px / 1.5 | 600 | normal | compact hierarchy |
| H6 | 15px / 1.5 | 600 | normal | compact hierarchy |
| Body | 15px / 1.72 | 400 | normal | paragraph and list text |
| Code | 13px / 1.6 | 400 | normal | fenced code; inline code is `0.9em/1.45` |
| Metadata | 15px / 1.5 | 400 | normal | muted or faint supporting information |

### H1-H6 and CommonMark rules

- Paragraphs are Ink with `0 0 12px`, `overflow-wrap:anywhere`, and normal word breaking. Strong uses the strongest supported 650/700-equivalent weight; emphasis is italic without a color change.
- H1 has 28px top margin except as the first child and 16px bottom; H2 has 26px/10px; H3 has 22px/8px; H4-H6 use progressively quieter spacing without falling below body size.
- Bullets use a 1.45em indent, 8px top/14px bottom, 3px item gap, and Accent markers. Ordered lists share the geometry with Ink strong markers; nested lists add 1.25em indent and 4px vertical separation so three levels fit at 375px.
- Blockquotes use 16px vertical margin, `8px 12px 8px 16px` padding, a 3px Quote rule rail, Quote surface, and Ink muted text. Horizontal rules use a 1px Border token with 24px vertical margin.
- Inline code uses the dedicated warm pair, 4px radius, and `0.12em 0.32em` padding; it is not a pill. Fenced code uses the Code pair, 14px 16px padding, 6px radius, a 1px subtle border, and horizontal scrolling without wrapping.
- Images are maximum inline-size 100% with an 8px radius and subtle border; an image or atomic node selection receives a 2px Accent outline without layout shift. Hard breaks remain unornamented and retain their copy semantics.

## 4. Spacing & Layout

### Base Unit

All spacing derives from a base of **4px**: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px, and `--space-16` 64px. Browser mechanics such as percentages, `clamp()`, intrinsic sizing, and `minmax()` remain raw rather than becoming magic tokens.

### Responsive measure and shell

- The editor is paper inside the workbench, not a card. It fills its available scroll surface and stays clickable over its full width.
- Use responsive inline padding to hold prose near a **72ch** measure on wide panels while keeping a **full-width** contenteditable surface. Never cap the editable element itself to a narrow fixed box.
- Normal paper padding is 24px top, responsive full-width measure padding inline, and 48px bottom. At 420px and below it is 20px top, 16px inline, and 40px bottom.
- The stable scroll owner is the internal Editor or Library view, not an overflowing page. At 375px the Library is one column; wider widths use an intrinsic responsive grid.
- Above 420px, copy and document action groups share one row. At 420px and below, a session draft remains one row when bounding boxes fit; a saved document uses two intentional rows: `Copy MD` plus `Copy compact`, then `Save changes`, `Cancel`, and `Delete`. Labels never abbreviate or become icon-only.

## 5. Components

### App shell

- **Structure**: identity, manual tablist, transient status, contextual actions, then one resolved Editor or Library view.
- **States**: light/dark, Editor/Library active, normal and narrow/saved-document reflow.
- **Accessibility**: landmarks remain concise; the active view is explicit and body-level horizontal overflow is forbidden.

### Manual tablist

- **Structure**: Editor and Library `role="tab"` controls paired with tabpanels.
- **States**: selected, focused, and disabled only while an operation genuinely prevents action.
- **Accessibility**: roving `tabindex`; ArrowLeft/ArrowRight/Home/End move focus only, Enter/Space activates, and Tab exits the tablist. Dirty navigation confirmation runs only on activation; rejection restores focus to the selected Editor tab.

### Copy action group

- **Structure**: persistent `Copy MD` and `Copy compact` controls, each with project-owned inline SVG and visible text.
- **States**: default, hover, active, visible focus, disabled during a real conflicting operation, success/error feedback through the transient status region.
- **Accessibility**: no hover-only affordance; normal controls target 36px where layout permits and never fall below the 24px WCAG floor.

### Document action group

- **Structure**: session mode offers Clear and Save to Library; saved-document mode offers Save changes, Cancel, and Delete alongside the copy group.
- **States**: session, saved clean, saved dirty, confirm/delete error, and narrow two-row reflow.
- **Accessibility**: Delete has a text label and confirmation; active, dirty, and danger states have text/shape/context beyond color.

### Transient status region

- **Structure**: one `role="status"`, polite and atomic live region for operation results only.
- **States and precedence**: Editor/Library idle state leaves it empty; a saved-document clean/dirty state belongs only in the saved-document context strip. A newer operation replaces an older transient message. Success remains 2.5 seconds, errors 5 seconds, then it clears.
- **Exact operation copy**: `Copied`, `Copy failed`, `Draft cleared`, `Saved to Library`, `Save failed`, `Changes saved`, `Document deleted`, `Delete failed`, and `Editor failed to load`.

### Saved-document context strip

- **Structure**: a visible contextual strip above paper while editing a durable Library document.
- **States**: `Editing saved document` plus clean or dirty context. A session-only draft is never called `Saved`.
- **Accessibility**: clean/dirty meaning is exposed in text and does not steal focus or duplicate the transient live-region announcement.

### ProseMirror paper surface

- **Structure**: one inline-rendered Milkdown/ProseMirror CommonMark editor with a full-width paper surface.
- **States**: empty, focused, selection, caret, image/node selection, content stress, light/dark, and reduced motion.
- **Accessibility**: the empty DOM shows `Start writing…` through a scoped data attribute and an empty-editor CSS selector only. It is not Markdown, storage, clipboard text, or accessibility-tree text; it disappears on focus/input. Focus is a high-contrast 2px inset boundary without resizing or a full-panel glow.

### Library card

- **Structure**: title when present, absolute updated metadata, preview, persistent Copy action, and separate visible Edit action.
- **States**: titled/untitled, default, hover, active, focus, CJK/long-token wrap, light/dark, and selected edit handoff.
- **Accessibility**: Copy and Edit stay visible and focusable, retain target geometry, and card copy does not reorder or mutate the saved document.

### Library empty state

- **Structure**: explanatory empty copy with a visible `Go to Editor` action.
- **States**: empty and return-to-Editor focus handoff.
- **Accessibility**: activating it selects Editor through the same view behavior and focuses `.ProseMirror` without creating content or losing the session draft.

## 6. Motion & Interaction

### Timing and rules

- Micro-interactions use **120ms** `ease-out` transitions of **transform, opacity, and color** only. They communicate press, active, focus, selection, or status change; no decorative motion is allowed.
- The reviewed tabs/action-swap patterns reinforce the existing interaction contract: keyboard focus moves independently from tab activation, a newer transient result interrupts and replaces the prior one, and reduced motion preserves the final state without an animated swap. SideMarkDown keeps its existing 120ms CSS treatment and adds no dependency.
- Every interactive control has default, hover, active, focus-visible, disabled, loading, and error/empty behavior where applicable. No animation changes layout properties.
- `prefers-reduced-motion` disables nonessential transitions and animations while preserving state legibility.
- Long status text is visually ellipsized in the top row at narrow widths, while its complete DOM text remains available to assistive technology.

## 7. Depth & Surface

### Strategy

The depth strategy is **tonal-shift plus whisper-border**: the warm canvas, surface, subtle surface, and paper establish quiet layers; a 1px Border or Border strong appears only for required separation, controls, cards, code, selected nodes, and focus contexts. There are no large shadows, glass effects, glows, decorative blobs, or ornamental separators. This preserves compact command clarity without turning the paper surface into another floating card.

### Approved visual authority

The approved mockups are authority for narrow light-mode composition, hierarchy, copy, icon intent, and visual character only after normalization to **375 CSS px**:

- `.omo/frontend-design/mockups/editor-draft-light-v2.png`
- `.omo/frontend-design/mockups/library-draft-light.png`
- `.omo/frontend-design/mockups/editing-draft-light-v2.png`

Their generated-image pixel dimensions are not CSS dimensions. This document is authoritative for exact token values, dimensions, responsive deviations, manual tab/status semantics, dark mode, and accessibility; permitted deviations are only the recorded responsive and accessibility rules.

## 8. Accessibility Constraints & Accepted Debt

### Constraints and inclusive personas

- WCAG 2.2 AA applies: body text contrast is at least 4.5:1, non-text and visible focus contrast are preserved, every interactive control is keyboard reachable, and focus is a visible 2px indicator.
- A keyboard-first writer can write, copy, tab-switch, save, and return at narrow widths without a pointer or focus trap; status announces without focus theft.
- A low-vision user at 200% text zoom can distinguish actions/states without clipping or overlap; controls remain operable.
- A CJK prompt writer has no tofu, horizontal page overflow, title/preview corruption, or line-breaking regression with Korean, Japanese, Chinese, and long unbroken strings.
- A motor-impaired touch/trackpad user can reach visible copy/edit/document actions without hover and with adequate target geometry and spacing.
- A reduced-motion user receives no nonessential movement while tab, status, and card state changes remain legible.

### Extension-origin quality waiver and substitute gate

Lighthouse cannot audit a `chrome-extension://` UI under [GoogleChrome/lighthouse issue #9402](https://github.com/GoogleChrome/lighthouse/issues/9402), and **SEO is inapplicable** to this local Chrome side-panel surface. Do not run Lighthouse against a localhost/Vite substitute and do not claim Lighthouse scores.

The required substitute gate runs against the real unpacked extension origin: production `dist`, three fresh isolated Chromium profiles loaded with `--disable-extensions-except=<dist>` and `--load-extension=<dist>`, and a monotonic timing boundary from `performance.now()` immediately before `page.goto(extensionUrl)` through visible `.ProseMirror`, enabled Editor/Library tabs and every visible action, resolved initial view, and one `requestAnimationFrame`. Each launch must be at most 2000ms; copy/tab feedback must be within 250ms; no external or failed request, page error, worker error, or unexpected console error is allowed. The gzip budgets are `sidepanel.js <= 140000 bytes`, `sidepanel.css <= 8192 bytes`, and `sidepanel.html <= 12288 bytes`.

### Accepted Debt

No debt accepted.
