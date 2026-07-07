# New Hospital Feasibility Tool

Interactive React tool for assessing the feasibility of launching a new hospital. A setup wizard collects your own project scenario — catchment demand, facility design (bays/beds/rooms), service lines, CapEx, cost base, and growth assumptions — then hands off to an interactive dashboard for exploring volume, revenue, payback, and capacity under Conservative / Realistic / Aggressive scenarios.

Login: user `BPK`, password `B1719`.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Build

```bash
npm run build
```

The production files are generated in `dist/`.

## Deploy on GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main`; the included workflow will build and publish the app.
