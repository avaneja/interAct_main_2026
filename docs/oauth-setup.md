# Setting up Google and GitHub sign-in

InterAct signs people in with Google or GitHub. Each provider needs an OAuth app that belongs to the team. Registering one takes about five minutes and needs a Google or GitHub account; the app's secret must stay on the server.

## Callback addresses

Each provider sends the user back to InterAct at a fixed address. Register exactly these:

| Where InterAct runs | Google callback | GitHub callback |
|---|---|---|
| Local development | `http://localhost:5173/api/v1/auth/google/callback` | `http://localhost:5173/api/v1/auth/github/callback` |
| Deployed demo (M7) | `<PUBLIC_URL>/api/v1/auth/google/callback` | `<PUBLIC_URL>/api/v1/auth/github/callback` |

The first part must match `PUBLIC_URL` in `backend/.env` (default `http://localhost:5173`, the address of the frontend in development).

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/), create or pick a project, and open **APIs & Services → OAuth consent screen**. Choose **External**, fill in the app name and support email, and add yourself and the team as test users.
2. Open **Credentials → Create credentials → OAuth client ID**, choose **Web application**, and add the Google callback address above under **Authorised redirect URIs**.
3. Copy the client ID and client secret.

InterAct asks Google only for the `email` and `profile` scopes.

## GitHub

1. Open **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Homepage URL** to `http://localhost:5173` and **Authorization callback URL** to the GitHub callback address above.
3. Create the app, then **Generate a new client secret**, and copy the client ID and secret.

InterAct asks GitHub only for `read:user` and `user:email`.

## Where the values go

Put them in `backend/.env`, which git ignores:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

- Never commit them, paste them into chats or issues, or put them in the frontend. The backend never sends them to the browser and never prints them.
- A provider without both values is simply not offered on the sign-in page.
- Each teammate can register their own development apps, or the team can share one through a password manager.
- The deployed demo needs its own apps with the deployed callback addresses, set as secrets on the hosting platform (M7).
