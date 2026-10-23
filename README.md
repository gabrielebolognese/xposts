# x-autopost

Posts to X at the times you choose, through the official X API. Runs on GitHub Actions, so there is no server and your PC can be off.

## How it works

Every 30 minutes GitHub runs `post.js`. It looks in `queue/`, and every folder whose time has passed gets posted, then moved to `posted/`.

One folder = one post:

```
queue/
  2026-10-21_0930/      <- date_time, Italian time (HHMM)
    post.txt            <- the text (optional if there is an image)
    image.png           <- up to 4 images: png, jpg, webp, gif
```

- Images are posted in alphabetical order (name them 1.png, 2.png if order matters).
- A post more than 3 hours late goes to `missed/` instead of being posted.
- No links in post.txt: a post with a URL costs $0.20 instead of $0.015.

## Setup

1. X Developer Console -> your app -> User authentication settings: set permissions to **Read and Write**.
2. Keys and tokens: copy the **API Key** and **API Key Secret**, then (re)generate the **Access Token** and **Access Token Secret**. Regenerate after changing permissions, or the tokens stay read-only.
3. Create a **private** GitHub repo and push this folder to it.
4. Repo -> Settings -> Secrets and variables -> Actions -> New repository secret. Add:
   - `X_APP_KEY` = API Key
   - `X_APP_SECRET` = API Key Secret
   - `X_ACCESS_TOKEN` = Access Token
   - `X_ACCESS_SECRET` = Access Token Secret
5. Actions tab -> post-to-x -> **Run workflow** to test it right away.

## Adding posts

From your PC: create the folder in `queue/`, then `git add . && git commit -m "new posts" && git push`.

From the phone: on github.com, open `queue/` -> Add file -> Upload files, and type the folder name in the path (for example `2026-10-22_1800/`).

## Scheduling posts

To fill `queue/` in one go from a markdown file and numbered images:

1. Write the posts in one `.md` or `.txt` file, separated by a line containing only `#--#` (see `examples/posts.md`). Each post is used exactly as written, line breaks included.
2. Name the images by post number: `1.png`, `2.jpg`, `3.webp` and so on (png, jpg, jpeg, webp, gif, max 5 MB). Post N gets image N.
3. Run `npm run schedule`. It opens http://localhost:3000: pick the posts file and the images, check the preview, click **Schedule**, then **Push to GitHub**.

Posts fill the slots 09:00, 11:00, 13:00 and 15:00 (Italian time) in order, starting from the first one at least 15 minutes from now. Slots that already have a folder in `queue/` are skipped.

**Text posts** (no images): choose **Text posts** at the top of the page and pick only the posts file. They get 2 a day at random times from 15:30 to 21:00 (Italian time), at least 1 hour apart. Text posts already scheduled or posted in that window count toward the 2 a day, so a new batch continues after the old one.

The **Scheduled posts** tab lists every upcoming post in your local `queue/`, by day. Run `git pull` first if you want it to match GitHub exactly.

## Timing

GitHub's timer is not exact: runs often start 5 to 20 minutes late. Posts go out between your time and about 30 minutes after it. Runs only happen 06:00 to 23:30 Italian time (edit the cron line in `.github/workflows/post.yml` to change that; cron times are UTC).
