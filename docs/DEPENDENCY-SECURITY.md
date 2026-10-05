# Dependency security policy

CI runs `npm audit --audit-level=high` and cargo-audit 0.22.2 against the committed lockfiles. Vulnerability findings fail. Audit JSON is retained. No advisory is hidden with `--ignore`.

## Reviewed Linux transitive soundness warning

[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) affects glib 0.18.5; its `VariantStrIter` implementation can dereference an invalid pointer. The upstream fixed range is >=0.20.0. The exact Linux chain is NYRC → Tauri 2.11.0 → tauri-runtime-wry / wry 0.55 / tao 0.35 → GTK 0.18.2 / webkit2gtk 2.0.2 → glib 0.18.5. GTK's glib interface cannot be replaced by glib 0.20 independently.

NYRC does not use `VariantStrIter` or its `array_iter_str` constructor. The release source audit also checks for new calls. This is a narrowly reviewed unreachable API, not a claim that the dependency itself is fixed. `scripts/security-audit.mjs` permits only this exact advisory/package/version among soundness warnings. Every other soundness warning and every vulnerability fails. Reassess when Tauri moves to a compatible updated GTK stack; do not suppress the whole GTK dependency tree.

Maintenance notices for proc-macro-error and unic crates remain visible in the audit report. They do not become vulnerability exemptions. Review upstream changes before each release.
