# zcord

A desktop screen recorder for teaching. It does three things well:

1. **Records your screen without going blank or black** when you switch apps, tabs or slides.
2. **Lets you draw on the screen** (pen, highlighter, arrow, box, circle, laser pointer) to point things out. The ink shows up in the recording.
3. **Uploads the recording to your class recordings folder in Google Drive** as soon as you click **End**.

Runs on Windows, macOS and Linux (Electron).

---

## How it works

| You do | zcord does |
| --- | --- |
| Pick **Entire screen**, type a lesson title, click **Start recording** | Records that monitor at up to 30 fps plus your microphone. A small floating toolbar appears. |
| Switch to slides, a browser, a PDF… | Keeps recording. It captures the whole monitor (not one window), and Chromium's background throttling is switched off, so the video never freezes or goes black. |
| Pick a pen in the toolbar (or press `Ctrl+Shift+D`) | A transparent layer covers the screen. Draw with the mouse or a pen tablet. The ink is captured in the video. Click the arrow-cursor button (or press `Esc`) to go back to using your apps. |
| Click **End** (or press `Ctrl+Shift+E`) | Saves the video to `Videos/zcord Recordings` and uploads it to your Drive folder with a resumable upload. If the upload fails (say the Wi-Fi drops), zcord picks up where it stopped and retries automatically. |

On Windows and macOS the floating toolbar and the main window are **hidden from the recording**, so students see only your screen and your drawings. You can turn this off in Settings.

### Shortcuts (while recording)

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+D` (`⌘⇧D` on Mac) | Drawing mode on/off |
| `Esc` | Leave drawing mode |
| `1` – `6` (in drawing mode) | Pen, highlighter, arrow, box, circle, laser pointer |
| `Ctrl+Shift+Z` | Undo last drawing |
| `Ctrl+Shift+C` | Clear all drawings |
| `Ctrl+Shift+P` | Pause / resume |
| `Ctrl+Shift+E` | End recording and upload |

Toolbar extras: six ink colours, three line thicknesses, and **disappearing ink** (the droplet button): marks fade after a few seconds, which works well for quick "look here" moments.

---

## Install and run

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/ZiyanNifail/zcord.git
cd zcord
npm install
npm start
```

To build an installer you can double-click:

```bash
npm run dist:win     # Windows .exe installer   (run on Windows)
npm run dist:mac     # macOS .dmg                (run on a Mac)
npm run dist:linux   # Linux AppImage
```

The installers are written to `dist/`.

---

## One-time Google Drive setup (about 5 minutes)

zcord uploads with *your* Google account, so it needs a free "key" (an OAuth client) from Google Cloud once. Open zcord's ⚙️ **Settings**: step 1 walks you through it, and each **Open** button takes you to the right Google Cloud page. Sign in to Google Cloud with the same Gmail you'll upload to.

1. **Give zcord a Google key** (in Google Cloud):
   1. **Turn on Google Drive for a new project.** Create a project (name it "zcord") if asked, then click **Enable**.
   2. **Set up the sign-in screen.** Click **Get started**, app name `zcord`, your Gmail as support email, audience **External**, your Gmail as contact, then **Create**. (School Google Workspace account? Choose **Internal** instead.)
   3. **Add yourself as a tester.** Under **Audience → Test users**, click **Add users**, enter your Gmail and **Save**.
   4. **Create the key.** **Clients → Create client**, Application type **Desktop app**, name "zcord", **Create**. Copy the **Client ID** and **Client secret** into zcord and click **Save key**. Google shows the secret only once, so copy it right away, or click **Download JSON** and use zcord's **Import it** link instead.
2. **Sign in with Google.** Your browser opens; choose your Gmail and allow access. Google will warn that the app is unverified. That's expected for an app you set up yourself: click **Continue**. On the permissions screen, make sure the **Google Drive** box is ticked.
3. **Class recordings folder.** Open the folder in Google Drive, copy the link from the address bar, paste it into zcord and click **Save**. zcord checks that you're allowed to add files there.

That's it. From now on every recording uploads into that folder when you click **End**.

### If it doesn't connect

| What you see | What to do |
| --- | --- |
| **Sign in with Google** is greyed out | Finish step 1 first: save the Client ID and secret (or import the JSON file). |
| Google says **"Access blocked"** or **"has not completed the Google verification process"** | Add your Gmail under **Audience → Test users** (step 1.3) and sign in again with that same Gmail. |
| Google says **"redirect_uri_mismatch"**, or zcord says the client is a "Web application" | The key was created with the wrong type. Create a new one with Application type **Desktop app**. |
| zcord says **"Google did not accept the Client ID or Client secret"** | Copy both again from **Clients**. If the secret is no longer shown, open the client, click **Add secret**, and use the new one. |
| zcord says **"The Google Drive API is turned off"** | Do step 1.1 again with your zcord project selected (top-left of Google Cloud), then wait a minute. |
| zcord says the Drive box **wasn't ticked** | Sign in again and tick the Google Drive permission. |

> **Weekly sign-in with "External" apps:** while an External app is in *Testing* mode, Google expires the sign-in after 7 days, and zcord will ask you to sign in again. To avoid this, under **Audience** click **Publish app**. You don't need Google's verification for personal use.

**Shared drives** (school "Team drives") are supported. You need *Contributor* access or higher on the folder.

---

## Tips

- **Choose "Entire screen", not "A window".** Window capture can go black when that window is minimised, and drawings aren't part of the window. Entire screen avoids both.
- **Two monitors?** Pick the monitor students should see. The drawing layer and toolbar open on that monitor.
- **Computer sound** (videos you play in class) can be recorded on **Windows**. Tick *Also record computer sound*. On macOS/Linux only the microphone is recorded.
- **macOS:** the first time, allow zcord under *System Settings → Privacy & Security → Screen Recording* (and *Microphone*), then restart the app.
- **Quality** (Settings): *High* (5 Mbps) keeps small text sharp. An hour of class is roughly 2 GB. *Standard* is about half that.
- Recordings are saved in **1-second pieces straight to disk**, so a crash loses at most about a second, and long lessons don't use up memory.
- Uploads that fail are retried automatically every few minutes and when the app starts. You can also press **Retry** in the *Recordings* list.

---

## Privacy

- Your Google sign-in is stored on your computer only, encrypted with the operating system's keychain.
- zcord talks only to Google (sign-in and Drive). There are no other servers, analytics or tracking.
- It asks for the Google Drive scope so it can write into a folder you created yourself. It never reads or changes anything else.

---

## Project layout

```
src/
  main.js            Electron main process: windows, capture, saving, upload queue
  drive.js           Google OAuth (PKCE, loopback) + resumable Drive uploads
  store.js           Settings / tokens / upload-queue persistence
  preload.js         Safe bridge between the windows and the main process
  renderer/
    control.*        Main window: pick screen, mic, Drive settings, recordings list, MediaRecorder
    toolbar.*        Floating recording toolbar (timer, pause, end, drawing tools)
    overlay.*        Transparent full-screen drawing layer
test/
  drive.test.js      Upload/auth tests against a fake Google server
```

Run the tests with `npm test`.
