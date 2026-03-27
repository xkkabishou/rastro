# Tasks: 古代黑陶烧制工艺科技考古综述 — 组会汇报 PPT

## 1. Init
- [x] Parse flags (style=minimal, pages=15-18)
- [x] Create RUN_DIR and scaffold
- [x] Write input.md
- [x] Write proposal.md
- [x] Write tasks.md

## 2. Requirement Research
- [ ] Run research-core (mode=research)
- [ ] AskUserQuestion (Hard Stop)
- [ ] Write requirements.md

## 3. Material Collection
- [ ] Launch parallel collection agents per section
- [ ] Merge into materials.md

## 4. Outline Planning
- [ ] Run content-core (mode=outline)
- [ ] Generate outline.json + outline-preview.md
- [ ] AskUserQuestion for approval (Hard Stop)

## 5. Planning Draft
- [ ] Run content-core (mode=draft)
- [ ] Generate drafts/slide-{nn}.svg
- [ ] Write draft-manifest.json

## 6. Design + Review
- [ ] Run slide-core per slide (mode=design, style=minimal)
- [ ] Run review-core per slide (mode=review)
- [ ] Fix loop if score < 7
- [ ] Run review-core (mode=holistic)

## 7. Delivery
- [ ] Collect SVGs to output/
- [ ] Generate output/index.html from template
- [ ] Generate output/speaker-notes.md
- [ ] Open preview in browser
- [ ] Print summary
