# Installing PIKO AI

## From the installer

1. Download `setup_piko.exe` from the [PIKO AI download repository](https://github.com/black2000a/PIKO-AI-A-APP-DOWNLOAD) (or the `release/` folder in a local build).
2. Run the installer and choose an installation folder if you do not want the default.
3. The wizard creates a Start menu entry and a desktop shortcut named **PIKO AI**.
4. Launch PIKO AI from the shortcut. The first launch initializes the local database.

The installer is per-user by default and does not require administrator rights. The application data stays in `%APPDATA%\PIKO AI`.

### SmartScreen

The build is not code-signed, so Windows may show a SmartScreen warning. Choose **More info → Run anyway**, or sign the build yourself:

```powershell
$env:CSC_LINK = 'C:\path\to\certificate.pfx'
$env:CSC_KEY_PASSWORD = 'your-password'
npm run dist
```

## Portable build

The portable target produces a single executable that runs without installation. It still writes data to `%APPDATA%\PIKO AI`.

## Requirements

- Windows 10 or Windows 11, x64
- 4 GB RAM minimum; 8 GB or more recommended for local models
- Internet access only for cloud AI providers and web research
- Optional: Git on `PATH` for source control
- Optional: Ollama or an OpenCode server for local models

## First run

1. Open a folder with **File → Open Folder**.
2. Open **Model Manager** (Ctrl+Shift+M) and configure at least one provider.
3. Select a model in the AI panel.
4. Try `/analyze` or ask a question in ASK mode before granting write permissions.

## Uninstalling

Use **Settings → Apps → PIKO AI → Uninstall**. Application data in `%APPDATA%\PIKO AI` is kept by default so memory and settings survive reinstalls. Delete that folder manually to remove everything.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “No AI model is available” | Configure a provider in Model Manager, or start Ollama/OpenCode and refresh. |
| OpenCode not connected | Confirm `http://127.0.0.1:4096` is running, or switch AI engine to Direct. |
| Blank window | Open **Help → Open Logs Folder** and inspect the latest log; run `npm run ui-smoke` in a development checkout. |
| Terminal does not start | Ensure PowerShell is available; PIKO AI uses `pwsh.exe` when installed, otherwise `powershell.exe`. |
| Web learning fails | Some sites block automated clients. PIKO AI reports the real HTTP failure and never invents sources. |
| Database corruption | PIKO AI automatically copies a corrupt database aside and recovers from `piko.db.bak`. |
