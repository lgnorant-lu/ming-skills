---
name: browser-qa
description: "浏览器手动QA — 上线/PR前在真实浏览器中验证页面。触发词：帮我测页面、验证UI没问题、发布前QA、页面截图看一下、检查这个功能在浏览器里能不能用。驱动 claude-in-chrome/Playwright 像真实用户一样点击导航、提交表单、走关键流程，并抓截图+检查控制台错误+网络4xx/5xx+Core Web Vitals。与 e2e-testing（生成可持续运行的代码化测试套件）不同，本技能聚焦一次性的人工核查场景：PR review 触碰了前端代码、部署到 staging 后肉眼确认、上线前最后一道目视检查。"
description_en: Use this skill to automate visual testing and UI interaction verification using browser automation after deploying features.
description_zh: 浏览器QA — 基于浏览器的端到端质量保证测试
origin: ECC
---

# Browser QA — Automated Visual Testing & Interaction

## When to Use

- After deploying a feature to staging/preview
- When you need to verify UI behavior across pages
- Before shipping — confirm layouts, forms, interactions actually work
- When reviewing PRs that touch frontend code
- Accessibility audits and responsive testing

## How It Works

Uses the browser automation MCP (claude-in-chrome, Playwright, or Puppeteer) to interact with live pages like a real user.

### Phase 1: Smoke Test
```
1. Navigate to target URL
2. Check for console errors (filter noise: analytics, third-party)
3. Verify no 4xx/5xx in network requests
4. Screenshot above-the-fold on desktop + mobile viewport
5. Check Core Web Vitals: LCP < 2.5s, CLS < 0.1, INP < 200ms
```

### Phase 2: Interaction Test
```
1. Click every nav link — verify no dead links
2. Submit forms with valid data — verify success state
3. Submit forms with invalid data — verify error state
4. Test auth flow: login → protected page → logout
5. Test critical user journeys (checkout, onboarding, search)
```

### Phase 3: Visual Regression
```
1. Screenshot key pages at 3 breakpoints (375px, 768px, 1440px)
2. Compare against baseline screenshots (if stored)
3. Flag layout shifts > 5px, missing elements, overflow
4. Check dark mode if applicable
```

### Phase 4: Accessibility
```
1. Run axe-core or equivalent on each page
2. Flag WCAG AA violations (contrast, labels, focus order)
3. Verify keyboard navigation works end-to-end
4. Check screen reader landmarks
```

## Output Format

```markdown
## QA Report — [URL] — [timestamp]

### Smoke Test
- Console errors: 0 critical, 2 warnings (analytics noise)
- Network: all 200/304, no failures
- Core Web Vitals: LCP 1.2s ✓, CLS 0.02 ✓, INP 89ms ✓

### Interactions
- [✓] Nav links: 12/12 working
- [✗] Contact form: missing error state for invalid email
- [✓] Auth flow: login/logout working

### Visual
- [✗] Hero section overflows on 375px viewport
- [✓] Dark mode: all pages consistent

### Accessibility
- 2 AA violations: missing alt text on hero image, low contrast on footer links

### Verdict: SHIP WITH FIXES (2 issues, 0 blockers)
```

## Integration

Works with the browser MCP available on this machine:
- `mcp__claude-in-chrome__*` tools (preferred — drives your actual Chrome)
- Direct Playwright/Puppeteer scripts if you prefer a code-driven run

Pair with `/e2e-testing` when you want to promote a one-off check into a durable automated test suite.
