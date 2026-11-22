# x-autopost

Posts to X at the times you choose, through the official X API. The runner on this PC does the posting; GitHub only stores the repo (the queue and what was posted). Nothing posts while the runner is stopped or the PC is off.

## How it works

While `bash pipeline/run.sh` runs, every 30 seconds it runs `post.js`: every folder in `queue/` whose time has passed gets posted, then moved to `posted/`, and the change is committed and pushed to GitHub.

One folder = one post:

```
queue/
  2026-10-21_0930/      <- date_time, Italian time (HHMM)
    post.txt            <- the text (optional if there is an image)
    image.png           <- up to 4 images: png, jpg, webp, gif
```

- Images are posted in alphabetical order (name them 1.png, 2.png if order matters).
- A `quote.txt` holding a post id makes the post quote that post (the Friday post quotes the week's most viewed X Article).
- A post more than 3 hours late goes to `missed/` instead of being posted.
- Every original post that goes out (a post, a quote post, the first post of a thread, never its replies) adds one line to xAutoReply's inbox, `../xAutoReply/data/own_posts.jsonl` (config `own_posts`): the post id, link, time, kind, text and the times to check it (60 and 240 minutes later). xAutoReply reads the replies then with Claude in Chrome and drafts answers for you to post by hand. No xAutoReply folder next to this repo: nothing is written.
- No links in post.txt: a post with a URL costs $0.20 instead of $0.015.

## Setup

1. X Developer Console -> your app -> User authentication settings: set permissions to **Read and Write**.
2. Keys and tokens: copy the **API Key** and **API Key Secret**, then (re)generate the **Access Token** and **Access Token Secret**. Regenerate after changing permissions, or the tokens stay read-only.
3. In this folder, create a file named `.env` with the 4 values, one per line:
   ```
   X_APP_KEY=your API Key
   X_APP_SECRET=your API Key Secret
   X_ACCESS_TOKEN=your Access Token
   X_ACCESS_SECRET=your Access Token Secret
   ```
   `.env` is in `.gitignore`, so it is never committed.
4. Run `npm install` once.
5. Start the runner: `bash pipeline/run.sh`. It warns at start if `.env` is missing.

## Adding posts

From your PC: create the folder in `queue/`. The runner posts it when its time comes (committing first is not needed).

From the phone: on github.com, open `queue/` -> Add file -> Upload files, and type the folder name in the path (for example `2026-10-22_1800/`). The runner pulls from GitHub every 5 minutes, so schedule it at least 5 minutes ahead.

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

While the runner is on, posts go out within about 30 seconds of their time. When the PC was off or the runner stopped, a post up to 3 hours late still goes out when it starts again; later than that it goes to `missed/`. An auto thread that misses its slot is not lost: it goes back to the virality queue and gets the next slot.

## Auto threads

A runner discovers tools, skills and workflows for Claude Code and Codex, writes an X thread about the best ones, scores each thread for virality, and keeps `queue/` filled with the highest scored threads: 1 a day at 07:00 (Italian time), at most 4 days ahead. Start it in Git Bash from this folder:

```
bash pipeline/run.sh
```

It keeps going until you press Ctrl+C, then prints what it did, through which day threads are scheduled and how many wait in the virality queue. This is the always-on runner: once the day's threads are made it waits, and at midnight the next day's generation starts. A stopped run picks up where it left off next time.

- `bash pipeline/run.sh --posts 20` makes 20 threads and stops: use it once to fill the queue. To reach the number it searches more categories than the usual 2 a day.
- `bash pipeline/run.sh --once` stops after one thread.

**Discovery.** The runner works through the 18 Claude Code and Codex categories in `pipeline/categories.json` in order, 2 category searches a day, and starts a new cycle after the last one. Each search collects signals from GitHub, Hacker News, Reddit and Hugging Face, then Sonnet searches the web around them. Every tool found is stored once in `pipeline/data/discoveries.json`; a tool comes back only for a meaningful change (a new release, a pricing change), at least 60 days after its thread. To add a category, add a line to `categories.json` with the next id.

**Each thread goes through these stages** (Opus from here on):
1. Analyze: the official repo, docs, releases, license and pricing are verified, with facts and sources. Archived, abandoned, unsafe or unverifiable projects are dropped.
2. Score: 8 criteria (problem solving, savings, usefulness, novelty, ease, relevance, reliability, hook strength).
3. Hooks: 12 candidates from different angles, filtered by code (no numbers the facts do not back), then critiqued and refined.
4. Thread: the main post (a hook line of at most 100 characters and a promise line, at most 150 in total), then 4 to 7 replies, numbered 1. 2. 3., at most 560 characters each, every one with a real number. The last reply is a mini setup guide of up to 1,000 characters that says how to find the tool (a GitHub search or a DM or comment CTA), never a link. Rules: `.claude/skills/x-threads/SKILL.md`.
5. Quality control and up to 3 fix rounds.
6. Virality: hook score and full-thread score out of 100 (final = hook x 0.65 + thread x 0.35), from the rules in `pipeline/prompts/virality.md`. Under 80, alternative hooks are tried first. Under 70, the thread is dropped.

**The virality queue.** Finished threads wait in `pipeline/data/virality.json`. The highest scores always go out first: before every step the runner puts the best threads into the next free slots, so a new thread that beats the ones already scheduled takes the earliest slot and pushes the others back, out of `queue/` when they no longer fit. A thread not posted within 7 days of being made expires. Slots that are due within 15 minutes are never changed. `python pipeline/lib/virality.py` lists the queue with scores. The runner makes 1 to 3 threads a day (it searches up to 4 categories when none is ready yet) and starts a new day's generation at midnight.

**Threads in `queue/`:** a folder holds `post.txt` (the main post) and `reply1.txt`, `reply2.txt` and so on. `post.js` posts the main post, then each reply under the previous one, a random 10 to 40 seconds apart. It writes the posted ids to `thread.json`, so a thread that stops halfway resumes at the next reply on the next run, and a started thread is always finished, never moved to `missed/`.

Threads that still fail quality control after the fix rounds land in `pipeline/review/` with a NEEDS REVIEW note. A DM or comment CTA means you answer those people yourself.

**Dashboard.** `npm run dashboard` opens http://localhost:3001: every thread the runner is making or has made, live (its stage, the hook, the full thread with character counts, the virality score, its slot or why it was dropped), the next slots and the runner log. It refreshes every few seconds and only reads the runner's files.

**Post thread now** (on any finished thread in the dashboard) posts that thread on X right away, outside the schedule: the runner's posting loop picks the request up within 30 seconds and posts the main post and the replies 10 to 40 seconds apart. It needs the runner to be running. Nothing else in the schedule changes: the thread is recorded in `pipeline/data/posted-now.json` so it never goes out again, and if it had a slot, its folder is removed and the slot goes to the next best thread. The card then links to the post on X.

- **Settings:** models, slots, the daily searches, scores and limits live in `pipeline/config.json`.
- **Local state (never committed):** `pipeline/data/` (rotation, searches, discoveries, virality queue, history), `pipeline/runs/` (every file of every thread), `pipeline/logs/`.
- **Requirements:** the `claude` CLI logged in (it shares your Claude usage limits; each thread takes about 10 Opus calls), `gh` logged in (the discovery searches GitHub), Python 3.11+ with `jsonschema`, Node 22, and `.env` with the X keys.
- **Tests:** `node --test pipeline/tests/post.test.mjs pipeline/tests/dashboard.test.mjs`, `python -m unittest discover -s pipeline/tests -p "test_*.py"`, `bash pipeline/tests/e2e.sh` (fake model, discovery and X, no network, no posts).

## Claude Studio

Every 3 days the runner posts one "pushing Claude to the edge" project: a live simulation that looks extremely complex (a chess engine's search tree, a full PC architecture, a black hole...), recorded as a video and queued as one long post at 11:00. The next project starts as soon as the last one is queued and takes as long as it needs, even several days: there is no spending limit (a Claude Code session is only stopped if it runs 24 hours). Its folder is named after its post day, 3 days after the last post; a project ready early waits for its day, one ready late takes the next free 11:00. `bash pipeline/run.sh` runs it, nothing else to start.

1. **Brief.** Opus picks the subject (or takes the one you asked for), the real science, and designs the screen for it: every project has its own layout, colours and light or dark mode, around a big hero animation (at least 55% of the screen) that you can zoom (mouse wheel, up to 16x) and pan (drag) in the live view.
2. **Build.** Claude Code (on the Claude subscription, Opus, no libraries) writes the project in `studio/projects/<date>/`, taking screenshots of its own work with `studio/tools/shot.mjs` and fixing what it sees.
3. **Review.** Two separate Opus critics score it: one the whole screen (frames in pairs 1 second apart, so a panel that does not move is caught), one the hero up close (2x detail, motion, and the hero zoomed 4x and 16x through its own zoom). Every project gets at least 3 fix rounds; after that it is recorded once both critics give 9 out of 10 with no major issue, at most 8 rounds. A project still under 6 is held, not posted.
4. **Record.** A 90 second live run samples this PC's real CPU (per thread), RAM, GPU, disk and network; then the run is replayed frame by frame with a controlled clock at 2x resolution and encoded to 1080p 60 fps (`studio/tools/record.mjs`). The video shows the whole screen the whole time, no camera zooms.
5. **Post and queue.** The post is written from the measured numbers, including the build cost Claude Code reports, and goes into `queue/<date>_1100` with the video. The project's code is committed; videos stay on this PC.

When a build is done the runner prints a light blue STUDIO line. Look at a project live, with this PC's real numbers: `bash studio/open.sh` (the latest) or `bash studio/open.sh 2026-11-16`. Choose the next project's subject: `python studio/lib/studio.py --subject "..."` (the runner starts it within 5 minutes). Projects load `studio/kit/studio-kit.js`, which gives them the clock, the measured numbers and the hero zoom hook. Settings: the `studio` block and the `studio_*` models in `pipeline/config.json`.

## Build in public

Every day at 14:00 the runner opens a small form in the browser (http://127.0.0.1:3003): type the replies you wrote today and today's views, press Submit. Then, by itself:

1. **Brief.** It asks Jarvis (its API on this PC, so Jarvis must be running) for `/mbrief` over the last 24 hours (since the previous post): what got done across all projects.
2. **Screenshots.** Jarvis's STATISTICS tab (`pipeline/lib/bip-shot.mjs`) and a frame of today's Claude Studio project.
3. **Post.** Opus writes a hook about building (never about the build itself), the day's Claude Studio project in one sentence, and what got done (`pipeline/prompts/bip.md`). The code puts it together: the hook, "This is day N of building Claude Studio in public.", "Today's Claude Studio project: ...", "On X today: N replies written and N views." (your typed numbers, nothing is read from X), what got done, and the closer ("See you on day N+1", 1000 followers, monetization). It checks the format: sentences up to 150 characters, list items up to 60, at most 3 paragraphs.
4. **Posting.** The post and both screenshots go into `queue/<now>` and the posting loop sends them within 30 seconds. The form shows each step, then the post and its link.

The form stays open until the post is out or midnight; a failed step shows why, and Submit tries again. Day 5 was 2026-11-17, one more each day. Settings: the `bip` block in `pipeline/config.json`.

## Trending posts

On Tuesday, Thursday and Saturday the runner posts one long-form post about something on X's Explore > Trending tab at 09:00. `bash pipeline/run.sh` runs it, nothing else to start:

1. **Read.** From 06:20 (before xAutoReply's first reply session, and it waits while xAutoReply is using Chrome) a Claude in Chrome session reads the Trending tab in your logged-in Chrome, picks up to 3 trends that fit the account (AI, coding agents, software, building; never politics, sports or gossip) and reads their top posts (`pipeline/prompts/trend_read.md`). It only reads: no likes, no clicks that change anything, no X API calls. When Chrome was closed it opens it and closes it again afterwards.
2. **Write.** Opus picks the trend with the best angle for builders, checks the facts on the web and writes the post by the long-form rulebook (`x_long_form_post_writing_rules.txt`, `pipeline/prompts/trend_write.md`). The code checks it (`pipeline/lib/longform-check.mjs`: 800 to 3,000 characters, the two-line hook, paragraphs up to 250 characters, no emojis, dashes or markdown; no links or hashtags; the same AI-tells check as the threads) and asks for up to 2 fixes. A post that still fails goes to `pipeline/review/trend-<date>.txt` and is not posted.
3. **Screenshot.** One of the trend's top posts, rendered from X's public embed (`pipeline/lib/trend-shot.mjs`, no login).
4. **Posting.** The post and the screenshot go into `queue/<date>_0900` (or the next minute when it is ready later) and the posting loop sends them.

When nothing on the tab fits the account there is no post that day, and the runner says so. A failed try runs once more 10 minutes later; after 10:30 the day is skipped, since the trends are stale by then. The Trending tab follows the location in X's Explore settings (Settings, then Explore settings): set it to where your audience is for English trends. See one without posting: `python pipeline/lib/trend.py --now --dry` (the post and the screenshot land in `pipeline/data/trend/<date>-dry/`). Settings: the `trend` block and the `trend_*` models in `pipeline/config.json`.

## Viral posts

Three times a day, at random times between 08:00 and 21:30 (at least 2 hours apart, picked each morning), the runner looks for posts that went viral for a reason other than a big audience and repurposes the best one (`pipeline/lib/viral.py`). No guessing: it copies what is already working.

1. **Read.** When xAutoReply is not using Chrome (like the trending post; a check still blocked 2 hours after its time is skipped), a Claude in Chrome session scrolls the For you timeline of the account signed in to Chrome, reads at least 120 posts, keeps the ones with more than 5,000 views and opens up to 20 of their authors' profiles (`pipeline/prompts/viral_read.md`, read only, no X API).
2. **Pick.** A viral post: more than 5,000 views and at least 15 times its author's followers in views (authors under 800 followers) or at least 20 times (800 or more), in the niche (AI tools, Claude and Codex, automation, building, creator and growth with AI), never used before. The most views per follower wins. None: no post, and the runner says so.
3. **Post.** Opus rewrites it for your account: the same hook, different words, the same format (`pipeline/prompts/viral_write.md`). The code checks it: no links, hashtags, @mentions, emojis or dashes, not a near copy of the original, and the AI-tells check; up to 2 fixes, else `pipeline/review/viral-<date>-<n>.txt`. It is queued at the next free minute at least 30 minutes from any other post.
4. **X Articles.** When the viral post is an X Article, the runner writes your own article on the same hook (`pipeline/lib/article.py`: web research, checks, the cover and the page with the **Post** button) and opens the page right away: post it by hand (X: Articles, Write). The post with the viral hook waits until the article is on your profile (checked every 30 minutes, for up to 48 hours) and then goes out quoting it. At most 3 articles a week (Monday to Sunday); once they are used, the post quotes your closest existing article instead of a new one.

Run a check now: `python pipeline/lib/viral.py --now`. Settings: the `viral` block, `x_handle` (your posting account, where it looks for your articles) and the `viral_*` models in `pipeline/config.json`.

## X Articles

Articles now come only from viral X Articles (see Viral posts above), at most 3 a week. The scheduled pillar articles (Monday, Wednesday, Sunday) are switched off since 2026-11-21: `article.days` is empty in `pipeline/config.json`; put days back in it to turn them on again. Each article is posted by hand from its page:

1. **Brief.** A viral article's title and what it says become the brief: the same hook, your own words and structure, verified facts, nothing of the original author's presented as yours. (The scheduled articles, when switched on, take turns over the pillars in `pipeline/article-pillars.json`: automation playbook, free alternative, viral breakdown, growth myth.)
2. **Write.** Opus writes it with web research, checking every tool, price and view count it uses, plus this PC's real numbers where they fit (Claude Studio builds, the thread pipeline's funnel, the tools it scored, the week's trends) (`pipeline/prompts/article_write.md`). The code checks it: 1,000 to 3,500 words, at least 3 sections, paragraphs up to 400 characters, headings, lists, quotes, bold and italic only, no emojis, dashes or hashtags, and the AI-tells check; up to 2 fixes, else it waits in `pipeline/review/article-<date>.txt`.
3. **Cover.** Opus designs the cover as an HTML file for this article (`pipeline/prompts/article_cover.md`) and `pipeline/lib/article-shot.mjs` exports it as a 1500x600 PNG at 2x (5:2, the Article cover shape). Text that spills out of the frame gets one fix round.
4. **Page.** `articles/<date>/article.html` (`<date>-2` for a second one that day) shows the cover and the article. It opens in the browser as soon as it is ready. Press **Post**: the cover downloads and the article is copied with its formatting. On X: Articles, Write, add the cover, paste the title (**Copy title**) and the article, publish.

The pages stay on this PC (`articles/` is not committed). Settings: the `article` block and the `article_*` models in `pipeline/config.json`.

## Friday post about the article

Switched off since 2026-11-21 (`teaser.day` is "off" in `pipeline/config.json`): a viral article already gets its own post. When on, every Friday at 09:00 it posts about 1,000 characters quoting the week's most viewed X Article, written to make people open it, not a summary (`pipeline/lib/teaser.py`). Set `teaser.day` back to "fri" to turn it on.
