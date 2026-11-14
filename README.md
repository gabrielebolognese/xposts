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

GitHub's timer is not exact: runs often start 5 to 20 minutes late. Posts go out between your time and about 30 minutes after it. Runs only happen from about 05:00 (06:00 in summer) to 23:30 Italian time (edit the cron line in `.github/workflows/post.yml` to change that; cron times are UTC).

## Auto threads

A runner discovers useful tools, repositories, free alternatives and AI models, writes an X thread about the best ones, scores each thread for virality, and keeps `queue/` filled with the highest scored threads: 3 a day at 06:00, 10:00 and 14:00 (Italian time), at most 4 days ahead. Start it in Git Bash from this folder:

```
bash pipeline/run.sh
```

It keeps going until you press Ctrl+C, then prints what it did, through which day threads are scheduled and how many wait in the virality queue. This is the always-on runner: once the day's threads are made it waits, and at midnight the next day's generation starts. A stopped run picks up where it left off next time.

- `bash pipeline/run.sh --posts 20` makes 20 threads and stops: use it once to fill the queue. To reach the number it searches more categories than the usual 5 a day (up to 15).
- `bash pipeline/run.sh --once` stops after one thread.

**Discovery.** The runner works through the 120 categories in `pipeline/categories.json` in order, about 5 category searches a day, and starts a new cycle after the last one. Each search collects signals from GitHub, Hacker News, Reddit and Hugging Face, then Sonnet searches the web around them. Every tool found is stored once in `pipeline/data/discoveries.json`; a tool comes back only for a meaningful change (a new release, a pricing change), at least 60 days after its thread. To add a category, add a line to `categories.json` with the next id.

**Each thread goes through these stages** (Opus from here on):
1. Analyze: the official repo, docs, releases, license and pricing are verified, with facts and sources. CLI tools are installed and run once in the public sandbox repo `xposts-sandbox`, which holds no secrets. Archived, abandoned, unsafe or unverifiable projects are dropped.
2. Score: 8 criteria (problem solving, savings, usefulness, novelty, ease, relevance, reliability, hook strength).
3. Hooks: 12 candidates from different angles, filtered by code (no numbers the facts do not back), then critiqued and refined.
4. Thread: the main post (the hook and a promise line), then 4 to 7 replies, numbered 1. 2. 3., at most 280 characters each. The last reply says how to find the tool (a GitHub search or a DM or comment CTA), never a link. Rules: `.claude/skills/x-threads/SKILL.md`.
5. Quality control and up to 3 fix rounds.
6. Virality: hook score and full-thread score out of 100 (final = hook x 0.65 + thread x 0.35), from the rules in `pipeline/prompts/virality.md`. Under 80, alternative hooks are tried first. Under 70, the thread is dropped.

**The virality queue.** Finished threads wait in `pipeline/data/virality.json`. The highest scores always go out first: before every step the runner puts the best threads into the next free slots, so a new thread that beats the ones already scheduled takes the earliest slot and pushes the others back, out of `queue/` when they no longer fit (they can wait indefinitely). Slots that are due within 15 minutes are never changed. `python pipeline/lib/virality.py` lists the queue with scores. The runner makes 4 to 20 threads a day (it searches more categories when it has fewer than 4) and starts a new day's generation at midnight.

**Threads in `queue/`:** a folder holds `post.txt` (the main post) and `reply1.txt`, `reply2.txt` and so on. `post.js` posts the main post, then each reply under the previous one, a random 10 to 40 seconds apart. It writes the posted ids to `thread.json`, so a thread that stops halfway resumes at the next reply on the next run, and a started thread is always finished, never moved to `missed/`.

Threads that still fail quality control after the fix rounds land in `pipeline/review/` with a NEEDS REVIEW note. While the runner is on, it also starts the posting workflow at the exact minute a post comes due. A DM or comment CTA means you answer those people yourself.

- **Settings:** models, slots, the daily searches, scores and limits live in `pipeline/config.json`.
- **Local state (never committed):** `pipeline/data/` (rotation, searches, discoveries, virality queue, history), `pipeline/runs/` (every file of every thread), `pipeline/logs/`.
- **Requirements:** the `claude` CLI logged in (it shares your Claude usage limits; each thread takes about 10 Opus calls), `gh` logged in, Python 3.11+ with `jsonschema`, Node 22.
- **Tests:** `node --test pipeline/tests/post.test.mjs`, `python -m unittest discover -s pipeline/tests -p "test_*.py"`, `bash pipeline/tests/e2e.sh` (fake model, discovery and sandbox, no network).
