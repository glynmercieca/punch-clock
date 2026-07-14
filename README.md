# PWA Punch Clock

A static GitHub Pages PWA that lets a user sign in with Google, punch in with **Start job**, and punch out with **End job**. It writes to this Google Sheet:

`1wCZYkXgZ_oQT2Q5FwnWlgQNzQHWYdO35CibUX-OZtWo`

## Sheet layout

The app expects these columns on the first sheet tab:

| Column | Header | Filled by |
|---|---|---|
| A | Date | Start job |
| B | From | Start job |
| C | To | End job |

You can use any tab name. By default, the app automatically uses the first tab in the spreadsheet.

## Setup

### 1. Prepare the Google Sheet

Add this header row to row 1:

```text
Date | From | To
```

Make sure the Google account signing in has edit access to the spreadsheet.

### 2. Configure Firebase Authentication

1. In Firebase Console, open the `punch-clock-4da13` project.
2. Go to **Authentication** → **Sign-in method** and enable **Google**.
3. Go to **Authentication** → **Settings** → **Authorized domains** and add:
   - `localhost` for local testing
   - `YOUR_GITHUB_USERNAME.github.io` for GitHub Pages
4. In the Firebase project's linked Google Cloud project, enable the **Google Sheets API**.
5. Configure the OAuth consent screen. The app requests the Google Sheets scope when a user signs in.

Firebase keeps the authentication session across browser restarts and refreshes its own ID token automatically. Google Sheets access is a separate Google OAuth token: the app retains it for up to 55 minutes, then the user must select **Refresh Google access** to obtain a new one. A browser-only Firebase app cannot securely retain a Google refresh token indefinitely.

For a project site, your final app URL will usually be:

```text
https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY_NAME/
```

### 3. Test locally

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

### 5. Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload all files in this folder.
3. In GitHub, go to **Settings → Pages**.
4. Set source to your main branch and root folder.
5. Open the GitHub Pages URL after it is published.

## How it works

- **Start job** appends a new row with Date and From time.
- After starting, **Start job** is disabled and **End job** is enabled.
- **End job** updates the same row's To column with the current time.
- The active job row is stored in browser `localStorage`, so refreshing the page keeps the End job button enabled.
- Dates are written to Google Sheets as `YYYY-MM-DD`.
- Times are written to Google Sheets as `HH:mm`.
- The app footer shows the deployed version from `version.json`.

## Versioning

The repository includes `scripts/bump-version.sh`, which increments the patch version in `version.json`.

The GitHub Actions workflow at `.github/workflows/bump-version-on-push.yml` runs that script after every push and commits the new version back to the branch automatically.

## Customization

In `app.js`, you can edit:

```js
SHEET_NAME: '',       // leave blank to use the first sheet tab
DATE_COLUMN: 'A',
FROM_COLUMN: 'B',
TO_COLUMN: 'C',
```

For example, if your tab is called `Timesheet`, set:

```js
SHEET_NAME: 'Timesheet',
```

## Important notes

This app is suitable for personal/internal use. Anyone who uses it must sign in with Google and must have permission to edit the target sheet. For a public workforce app, you would normally use a small backend or Apps Script web app to avoid giving every user direct edit access to the spreadsheet.
