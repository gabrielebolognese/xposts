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

**From the screenshots folder** (no browser): put one posts file (`.md` or `.txt`) and the images in `../screenshots` (the `screenshots` folder next to this one), then run `npm run from-folder` (or `npm run from-folder -- --text` for text posts). Images named exactly 1 to N go with post 1 to N; any other names are paired in the order the files were created, oldest first. It runs the same checks, schedules, moves the used files to `screenshots/done/<time>/`, and pushes.

The **Scheduled posts** tab lists every upcoming post in your local `queue/`, by day. Run `git pull` first if you want it to match GitHub exactly.

## Timing

GitHub's timer is not exact: runs often start 5 to 20 minutes late. Posts go out between your time and about 30 minutes after it. Runs only happen 06:00 to 23:30 Italian time (edit the cron line in `.github/workflows/post.yml` to change that; cron times are UTC).

## Auto posts

A runner writes long-form posts by itself and adds them to the queue, at most 1 a day, at a random minute between 12:30 and 13:30 (Italian time). Start it in Git Bash from this folder:

```
bash pipeline/run.sh
```

It keeps going until you press Ctrl+C, then prints how many posts it queued and through which day the auto posts are scheduled. `bash pipeline/run.sh --once` stops after one post, and `bash pipeline/run.sh --posts 10` stops once 10 posts are queued. A stopped run picks up where it left off next time.

Each post goes through these stages:
1. Harvest: new items from `pipeline/sources.txt`.
2. Scout: ideas, scored and picked with a niche mix.
3. Research: facts with sources, plus hands-on checks in the public sandbox repo `xposts-sandbox`, which holds no secrets.
4. Credibility: scored on what the research found. Weakly backed ideas are dropped here.
5. Outline.
6. Value gate.
7. Writing, following `.claude/skills/x-long-form-posts/SKILL.md`. No links.
8. Inspection and up to 3 fix rounds. The editor judges content, not wording.
9. Queue: commit and push.

Sonnet handles the scouting (ideas and scores). Opus handles everything from research on.

Posts that still fail after the fix rounds are not queued: they land in `pipeline/review/` with a NEEDS REVIEW note. While the runner is on, it also starts the posting workflow at the exact minute a post comes due.

- **Sources:** one per line in `pipeline/sources.txt` (types are listed at the top of `pipeline/lib/harvest.py`). Product Hunt, the subreddits and Hacker News are read through public feeds. Reddit sometimes answers "too many requests", and that source is then skipped until the next harvest.
- **Settings:** models, windows, scores and limits live in `pipeline/config.json`.
- **Local state (never committed):** `pipeline/data/` (pool, backlog, history), `pipeline/runs/` (every file of every post), `pipeline/logs/`.
- **Requirements:** the `claude` CLI logged in (it shares your Claude usage limits), `gh` logged in, Python 3.11+ with `jsonschema`, Node 22.
- **Tests:** `node --test pipeline/tests/next-slot.test.mjs`, `python -m unittest discover -s pipeline/tests -p "test_*.py"`, `bash pipeline/tests/e2e.sh` (fake model and sandbox, no network).
