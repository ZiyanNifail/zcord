# Making your own pre-configured build

By default every zcord user sets up their own Google key in the app ([SETUP.md](../SETUP.md)). If you'd like **installers that already contain your Google key and class folder**, for yourself on several computers or for colleagues at your school, make a **private** copy of zcord and let GitHub build it for you.

The installers then open with step 1 (Google key) and the class folder already done. Each person still clicks **Sign in with Google** once, so everyone uploads with their own account, and nobody's sign-in is ever stored in the build.

> Everything below must happen in a **private** repository. Your Client secret ends up inside the installers, so don't publish them anywhere public.

## 1. Make a private copy

GitHub doesn't allow private forks of public repositories, so create an empty private repo and push a copy into it:

1. On GitHub: **New repository** → name it (for example `zcord-private`) → **Private** → leave "Add a README" **unticked** → **Create repository**.
2. On your computer:
   ```bash
   git clone https://github.com/ZiyanNifail/zcord.git zcord-private
   cd zcord-private
   git remote rename origin upstream
   git remote add origin https://github.com/<you>/zcord-private.git
   git push -u origin main
   ```

## 2. Add your setup

Pick **one** of these.

**A. Repository secrets (recommended).** The values never appear in the code. In your private repo: **Settings → Secrets and variables → Actions → New repository secret**, and add:

| Name | Value |
| --- | --- |
| `ZCORD_GOOGLE_CLIENT_ID` | Your Client ID (ends in `.apps.googleusercontent.com`) |
| `ZCORD_GOOGLE_CLIENT_SECRET` | Your Client secret (starts with `GOCSPX-`) |
| `ZCORD_DRIVE_FOLDER` | *(optional)* the link to your class recordings folder |
| `ZCORD_DRIVE_FOLDER_NAME` | *(optional)* the folder's name, as shown in the app |

**B. Commit the setup file.** In zcord: **Settings → Other computers → Save setup file**, then in the zcord-private folder:
```bash
git add -f zcord.config.json      # -f because the public repo ignores this file on purpose
git commit -m "Add my zcord setup"
git push
```
This also pre-configures zcord when you run it from the code (`Start zcord`) on another computer.

## 3. Build the installers

In your private repo on GitHub, go to **Actions → Build installers**:

- **Run workflow** builds Windows, Mac and Linux installers. When it finishes (about 10 minutes), download them from the run's **Artifacts** section, or
- push a version tag to publish them as a (private) Release:
  ```bash
  git tag v1.1.0
  git push origin v1.1.0
  ```

## 4. Stay up to date

To bring in new zcord features later:
```bash
git pull upstream main
git push origin main
```
Then build again (step 3).
