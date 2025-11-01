# H4ckoverflow - WXT Edition

A focused, minimalist browser extension designed to boost productivity and perform security reconnaissance, built with the modern WXT framework.

## 🚀 Features

-   **Domain Scanning**: Automatically find subdomains and identify potential vulnerabilities on websites you visit.
-   **Queue-Based Scanning**: Scans run one-by-one without overwhelming your browser.
-   **Dorking Cheatsheet**: Quickly run Google Dork queries for the current domain.
-   **Scan History**: View, manage, and export results from previous scans.
-   **Ignore List**: Prevent automatic scanning on trusted domains.
-   **Customizable**: Adjust API keys and vulnerability wordlists to fit your needs.

## 🛠️ Tech Stack

-   **Framework**: [WXT](https://wxt.dev/) (Web Extension Toolkit)
-   **UI**: [React](https://react.dev/)
-   **Styling**: [Tailwind CSS](https://tailwindcss.com/)
-   **Components**: [ShadCN/UI](https://ui.shadcn.com/)
-   **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
-   **Icons**: [Lucide React](https://lucide.dev/guide/packages/lucide-react)

## 📦 Installation

1.  Navigate to the `extension` directory:
    ```bash
    cd extension
    ```

2.  Install the dependencies using npm:
    ```bash
    npm install
    ```

## 🔥 Development

To run the extension in development mode with hot-reloading:

```bash
# For Chrome
npm run dev

# For Firefox
npm run dev:firefox
```

WXT will generate a `.output` directory containing the extension files.

### Loading the development build

-   **Chrome**:
    1.  Go to `chrome://extensions`
    2.  Enable "Developer mode".
    3.  Click "Load unpacked".
    4.  Select the `extension/.output/chrome-mv3` directory.

-   **Firefox**:
    1.  Go to `about:debugging#/runtime/this-firefox`
    2.  Click "Load Temporary Add-on...".
    3.  Select the `extension/.output/firefox-mv2/manifest.json` file.


## 🏗️ Build and Package

To build the extension for production:

```bash
# Build for Chrome (and other Chromium browsers)
npm run build

# Build for Firefox
npm run build:firefox
```

This will create an optimized build in the `.output` directory.

### Package for Submission

To create a `.zip` file ready for submission to the extension stores:

```bash
# Zip the Chrome build
npm run zip

# Zip the Firefox build
npm run zip:firefox
```

The zipped file will be located in the `extension` directory. You can then upload this file to the Chrome Web Store or Firefox Add-ons portal.
