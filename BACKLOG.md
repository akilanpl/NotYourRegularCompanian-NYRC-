# NYRC historical UI/UX review

The May 2026 review described an earlier UI. These notes are retained as history;
[the RC scorecard](docs/PROMPT5-RELEASE.md) is the current acceptance record.

| Original note | Final disposition |
|---|---|
| #15 Per-event autonomous speech cooldowns | The shared bounded cooldown remains a deliberate proactivity throttle. Different timings are optional product tuning, not a release defect. |
| #16 Duplicate character names | The original renderer was replaced by the NYRC SVG renderer and named companion control; expression labeling describes state. |
| #17 Settings loading semantics | The loading message now has role=status. |
| #18 Fixed-width legacy chat | The old chat/dock flow was replaced by the unified assistant. |
| #19 Similar raster mood palettes | Original SVG expressions use face geometry and semantic reactions. |
| #20 Unconditional click jump | Semantic touch/hold/double-tap reactions replaced the old click behavior. |
| #21 Native E2E harness | Automated pure/backend regressions plus packaged native acceptance are recorded. A separate harness is optional infrastructure; stock browser preview is not claimed to test native commands. |
| #22 Mixed-DPI crossing | Fixed in Prompt 5: physical adjacency/overlap, target-scale landing, four regression cases. Real multi-monitor acceptance requires hardware. |

The original review commits and PRs preserve the detailed discussion. Future
feature work should be proposed independently of the v1 RC acceptance scope.
