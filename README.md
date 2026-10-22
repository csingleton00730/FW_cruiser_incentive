# SilvaIncentive

Replaces the quarterly `Cruising_Incentive_Calculations` workbook for F&W Forestry Services.

Upload the Crystal "Production Report Qtrly Incentive" (.xls), the CASL export (whole database) and
Andy's SP/MP report; the app applies the fixed policy (40-hour minimum and 80 audit hurdle from the Cruiser Manual — a cruiser can be included past these only as a recorded, acknowledged exception; F1/F2/F3/FS
work codes only, zero-plot / zero-hour / zero-acre days removed, Western-division 3xxxx employees out),
takes plot multipliers from the SP/MP report's scale-up table, grades production against a regression
standard, distributes the pool, and exports an F&W-branded workbook.

- `src/engine/` — pure TypeScript calculation engine. `policy.ts` holds the locked rules.
  `calculate.test.ts` reconciles against the 1Q 2026 workbook (legacy mode ties out to the cent).
- `src/parsers/` — readers for the three files (.xls/.xlsx/.csv; column names matched loosely), tested against the real exports.
- `src/export/` — ExcelJS branded workbook.
- `src/storage/repository.ts` — storage interface; v1 = IndexedDB. Implement the interface for a backend.
- `src/sample/` — the 1Q 2026 quarter (real Crystal + CASL data) as sample data.
- `scripts/make-standalone.mjs` — single-file HTML that runs from a folder, no server.

```
npm install
npm test               # engine + parser tests
npm run dev            # local dev server
npm run build          # hosted build → dist/   (no sample data)
npm run build:review   # review build with the 1Q 2026 sample → ../SilvaIncentive.html (single file)
npm run build:artifact # review build packaged for claude.ai artifact hosting → artifact/
node e2e.mjs           # headless browser run against the real files (needs Playwright chromium)
```

## Hosting on GitHub Pages

The app is static; nothing is sent to a server. Uploaded reports stay in the user's browser,
and saved quarters live in that browser's storage for the site.

1. Create a repository (public or private) and push this folder to `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
   The site appears at `https://<user>.github.io/<repo>/`.

The hosted build never includes the sample quarter (real cruiser data); `vite.config.ts`
swaps `src/sample/sample.ts` for `src/sample/stub.ts` unless `VITE_INCLUDE_SAMPLE=1`.
Note that a Pages site is reachable by anyone with the URL even from a private repository.
