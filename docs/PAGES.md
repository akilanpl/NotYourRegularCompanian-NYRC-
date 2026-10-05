# GitHub Pages landing-page deployment

The Pages workflow publishes the static `docs/` directory, including `docs/index.html`. It does not publish the desktop app or a signed release. Only `main` can deploy, including manual dispatch.

## One-time repository setup

A repository administrator must open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source. For this repository, use [Pages settings](https://github.com/akilanpl/NotYourRegularCompanian-NYRC-/settings/pages).

Alternatively, an administrator authenticated with the GitHub CLI can create the site:

```sh
gh api --method POST repos/akilanpl/NotYourRegularCompanian-NYRC-/pages -f build_type=workflow
```

If a site already exists with a branch-based source, update it instead:

```sh
gh api --method PUT repos/akilanpl/NotYourRegularCompanian-NYRC-/pages -f build_type=workflow
```

Verify configuration:

```sh
gh api repos/akilanpl/NotYourRegularCompanian-NYRC-/pages --jq '{html_url,build_type,status}'
```

The expected build_type is `workflow`. This repository's Pages configuration was enabled in response to the failed deployment, using existing administrator access.

## Workflow and recovery

`.github/workflows/pages.yml` deploys on changes to `docs/**` or the workflow on main, and supports manual dispatch. It verifies that the landing page exists and Pages is configured for Actions before uploading/deploying. It retains minimal `contents: read`, `pages: write`, `id-token: write` permissions and the `github-pages` environment.

If `Get Pages site failed` or the configuration check fails, check the repository setting above. A missing site returns HTTP 404. Once configured, rerun the failed job or dispatch the workflow on main. Environment deployment approvals, if configured, still apply.

Do not simply add `enablement: true` with the default GITHUB_TOKEN. [configure-pages v5's official input contract](https://github.com/actions/configure-pages/blob/v5/action.yml) requires a separate privileged token for automatic enablement. One-time administrator setup avoids placing such a token in deployment secrets.

## Landing page

The public URL is [NYRC on GitHub Pages](https://akilanpl.github.io/NotYourRegularCompanian-NYRC-/). The website content and the product README are separate files; editing README.md alone does not update docs/index.html.
