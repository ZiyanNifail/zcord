# Setting up zcord

This guide takes you from nothing to your first lesson uploaded to Google Drive. It takes about 10 minutes, and you only do it once.

1. [Install zcord](#1-install-zcord)
2. [Give zcord a Google key](#2-give-zcord-a-google-key-5-minutes)
3. [Sign in with Google](#3-sign-in-with-google)
4. [Choose your class recordings folder](#4-choose-your-class-recordings-folder)
5. [Test your microphone](#5-test-your-microphone)
6. [Record your first lesson](#6-record-your-first-lesson)

If something goes wrong, see [Troubleshooting](#troubleshooting).

---

## 1. Install zcord

### Option A: download the installer (easiest)

Go to the [**latest release**](https://github.com/ZiyanNifail/zcord/releases/latest) and download the file for your computer:

| Computer | File | Then |
| --- | --- | --- |
| **Windows** | `zcord-Setup-<version>.exe` | Double-click it. zcord installs and opens, and a **zcord** shortcut appears on your Desktop and in the Start menu. |
| **Mac with Apple chip** (M1 or newer) | `zcord-<version>-arm64.dmg` | Open it and drag **zcord** into **Applications**. |
| **Mac with Intel chip** | `zcord-<version>-x64.dmg` | Same as above. |
| **Linux** | `zcord-<version>.AppImage` | Right-click → Properties → allow executing, then double-click. |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple chip; "Processor: Intel" means Intel.

**The first time you open it**, your computer will warn you, because zcord is a free app that isn't registered with Microsoft or Apple:

- **Windows** ("Windows protected your PC"): click **More info** → **Run anyway**.
- **Mac** ("zcord can't be opened" / "Apple could not verify"): click **Done**, then open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to zcord. You only need to do this once.

### Option B: run it from the code

Use this if you want the newest changes, or want to change zcord yourself.

1. Install [Node.js](https://nodejs.org/en/download) (the **LTS** version).
2. Get the code, either with `git clone https://github.com/ZiyanNifail/zcord.git` or with **Code → Download ZIP** on GitHub (unzip it).
3. In the zcord folder, double-click:
   - **Windows:** `Start zcord.bat`. The first run takes a minute or two, and also puts a **zcord** shortcut with the logo on your Desktop. Use that shortcut from then on.
   - **Mac:** `Start zcord.command`. If macOS refuses to open it, right-click it → **Open** → **Open**.
   - **Linux:** `start-zcord.sh` (mark it executable first).

   Or, in a terminal: `npm install` once, then `npm start`.

---

## 2. Give zcord a Google key (5 minutes)

zcord uploads with *your own* Google account. For that, Google needs a free "key" (an OAuth client) that belongs to you. Nobody else sees your recordings, and zcord's author never has access to them.

In zcord, click the ⚙️ **Settings** button (top right). Step 1 lists four short tasks, each with an **Open** button that takes you to the right Google Cloud page. **Sign in to Google Cloud with the same Gmail you'll upload to.**

**a. Turn on Google Drive for a new project.** Click **Open**. If asked, create a project (name it `zcord`) and pick it. Then click **Enable**.

**b. Set up the sign-in screen.** Click **Open**, then **Get started**, and fill in:
- App name: `zcord`
- User support email: your Gmail
- Audience: **External** (using a school/work Google Workspace account? choose **Internal**)
- Contact information: your Gmail

Then tick the agreement and click **Create**.

**c. Add yourself as a tester.** Click **Open**. Under **Test users**, click **Add users**, type your Gmail, and **Save**. (Skip this if you chose Internal.)

**d. Create the key.** Click **Open**, then:
- Application type: **Desktop app** (not "Web application")
- Name: `zcord`
- Click **Create**

A window shows your **Client ID** and **Client secret**. Copy both into zcord's boxes and click **Save key**.

> Google only shows the Client secret **once**. Copy it straight away, or click **Download JSON** and use zcord's **Import it** link instead. If you lose it, open the client in Google Cloud and click **Add secret** to make a new one.

---

## 3. Sign in with Google

In zcord's Settings, click **Sign in with Google**. Your browser opens:

1. Choose the Gmail you added as a test user.
2. Google warns **"Google hasn't verified this app"**. That's expected: the app is your own. Click **Continue**.
3. On the permissions screen, **tick the Google Drive box** and click **Continue**.
4. The browser says "Signed in to zcord". Go back to zcord.

> **Avoid signing in every week:** Google signs "External" apps out after 7 days while they're in *Testing*. To stop that, in Google Cloud open **Audience** and click **Publish app**. You don't need Google's review for your own use.

---

## 4. Choose your class recordings folder

1. In Google Drive, create or open the folder where recordings should go (for example *Class Recordings*).
2. Copy the link from the browser's address bar. It looks like `https://drive.google.com/drive/folders/1AbC…`
3. In zcord's Settings, paste it into **Class recordings folder** and click **Save**.

zcord checks that the folder exists and that you're allowed to add files to it. Shared drives work too, as long as you have **Contributor** access or higher.

---

## 5. Test your microphone

Back in zcord's main window, under **Microphone**:

1. Pick your microphone from the list. The green meter moves when you speak.
2. Choose **Noise cancellation**:
   - **Strong** (recommended): AI noise removal that takes out fans, air-con, typing, traffic and hum. It runs on your computer, so no audio is sent anywhere.
   - **Standard**: lighter, built-in noise suppression.
   - **Off**: your microphone exactly as it is.
3. Click **Test**, say a sentence, and listen to the playback. That's exactly how you'll sound in the recording.

---

## 6. Record your first lesson

1. Under **What students will see**, pick **Entire screen** (recommended, so switching apps never turns the video black). Pick the right monitor if you have two.
2. Type a **Lesson title**. It becomes the file name in Drive.
3. Click **Start recording**. The main window tucks away and a small toolbar appears at the top of the screen.
4. Teach. To point something out, pick a pen in the toolbar (or press `Ctrl+Shift+D`), draw, then click the arrow-cursor button (or press `Esc`) to use your apps again.
5. Click **End** (or press `Ctrl+Shift+E`). zcord saves the video and uploads it to your folder. A notification tells you when it's in Drive, and **Open in Drive** appears in the *Recordings* list.

**Mac only, first recording:** macOS asks for permission to record the screen and use the microphone. Allow both in **System Settings → Privacy & Security** (Screen Recording, Microphone), then quit and reopen zcord.

---

## Using zcord on more than one computer

zcord can save your Google key and folder into a setup file, so a second computer only needs **Sign in with Google**:

1. On the computer that's already set up: **Settings → Other computers → Save setup file**. This creates `zcord.config.json` in the zcord folder (or asks where to save it, if you installed zcord).
2. Copy that file into the zcord folder on the other computer (USB stick, email to yourself, a private repo…).
3. Open zcord there, and click **Sign in with Google**.

The file contains your Client secret but never your sign-in, so each computer signs in separately. **Never put it in a public place** such as a public GitHub repository.

Want installers with your setup built in? See [Making your own pre-configured build](docs/private-build.md).

---

## Troubleshooting

| What you see | What to do |
| --- | --- |
| **Sign in with Google** is greyed out | Finish step 2 first: save the Client ID and secret (or import the JSON file). |
| Google says **"Access blocked"** or **"has not completed the Google verification process"** | Add your Gmail under **Audience → Test users** (step 2c), and sign in with that same Gmail. |
| Google says **"redirect_uri_mismatch"**, or zcord says the key is a "Web application" | The key has the wrong type. Create a new one with Application type **Desktop app** (step 2d). |
| zcord says **"Google did not accept the Client ID or Client secret"** | Copy both again from **Clients**. If the secret isn't shown any more, open the client, click **Add secret**, and use the new one. |
| zcord says **"The Google Drive API is turned off"** | Repeat step 2a with your zcord project selected (top-left of Google Cloud), wait a minute, try again. |
| zcord says the **Drive box wasn't ticked** | Sign in again and tick the Google Drive permission. |
| zcord asks you to **sign in again every week** | Publish the app (see the note in step 3). |
| **Folder won't save**: "can view but cannot add files" | Ask the folder's owner to make you an **Editor** (or **Contributor** on a shared drive). |
| **Upload failed** in the Recordings list | Usually the internet. zcord retries automatically every few minutes; you can also click **Retry**. The video is always kept on your computer (**Show file**). |
| The recording is **black** | You chose **One window** and it was minimised. Use **Entire screen**. On Mac, check the Screen Recording permission. |
| **"Strong noise cancellation could not start"** | zcord switched to Standard automatically. Updating your graphics/audio drivers or zcord usually fixes it. |
| No sound from **computer audio** (videos you play) | Computer sound can only be recorded on Windows. Turn on **Computer sound** before you start. |
