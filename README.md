# Two Person GitHub Chat

Static GitHub Pages chat app for two people. Messages are stored in `data/chat.json` in this repository.

## Deploy

This repo includes a GitHub Pages workflow in `.github/workflows/pages.yml`. After pushing to `main`, enable GitHub Pages in the repository settings with source **GitHub Actions**.

The site URL will be:

```text
https://hoanganh19.github.io/testhtml/
```

## Chat Storage

GitHub Pages cannot write files by itself. To send messages, each browser session needs a GitHub token with repository content write permission. The token is stored only in that browser's `localStorage`; it is not committed to the repo or embedded in the page.
