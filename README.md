# Foodio

Track the dishes you've tried from 119 cuisines around the world, with a progress map, ratings, notes, badges and levels.

## Run

```sh
cp .env.example .env        # set SESSION_SECRET (32+ chars, e.g. `openssl rand -hex 32`)
npm install && npm --prefix api install && npm --prefix client install
npm --prefix api run whiten # white-background copies of the illustrations (see below)
npm run dev                 # API on :3000, client on :5173
```

Production: `docker compose up -d --build` (serves on port 3064, data in `./data`).
On first start the app asks you to create the admin account.

**Before hosting, run `npm --prefix api run whiten`** (or, with Docker running,
`docker compose exec app node api/scripts/whiten-images.js`). The illustrations in `data/images/` are in
the repo, but their white-background copies for list rows (`data/images-white/`) are generated, not
committed. Without them the app still works; lists just show the cream-background pictures. Run it again
after new illustrations are added (only missing or outdated copies are made).

The database (`data/foodio.db`) is created on first start; `.env` and everything else in `data/` stay
out of git.

## Users

Friends join through invite links: in the **Users** tab (👥, admins only) create a link per person.
It works once and for 7 days, and only a hash of it is stored. Each user has their own progress, ratings,
notes, diet settings, share link and monthly challenge; the catalogue of dishes is shared.

- Only admins edit dishes and pictures. Everyone can hide dishes for themselves and **suggest a dish**
  (for admins the button says *Add a dish*). Suggestions collect under *Dishes to add* in the Users tab and
  are added to the seed by hand (see CLAUDE.md); *Copy list* copies them as text, *Done* ticks one off.
- **Stats** (group stats) is opt-in: only people who share their own progress and ratings see the group's,
  without names, and a number only shows with at least 3 people behind it (`api/group.js`). Admins also get
  a *Catalogue* overview in the Users tab (over all users): cuisines nobody started, the most hidden dishes.
- Forgotten password: *Reset password* in the Users tab gives a temporary password to pass on. It ends
  the user's sessions, and after logging in with it they have to choose their own.
- Locked out as the admin: start once with `RESET_PASSWORD=<temporary password, 12+ characters>`, log in
  with it, choose a new password, and remove the variable again.
- Databases from before user accounts are migrated on start: everything belongs to the first account,
  which becomes the admin with username `admin` (rename it in the Users tab).
- Back up `data/` (the SQLite database `foodio.db`, plus `images/` and `images-white/`);
  `sqlite3 data/foodio.db ".backup backup.db"` makes a consistent copy while the app runs.

### Behind nginx (HTTPS)

In production the login cookie is HTTPS-only, so serve it through a TLS proxy. Forward the client address
(used for rate limiting) and allow larger bodies for picture uploads and backup imports:

```nginx
location / {
    proxy_pass http://127.0.0.1:3064;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 10m;
}
```

## Dish illustrations

Dishes show an emoji until an illustration exists at `data/images/<cuisine>/<dish>.webp`.
Illustrations are made in the Gemini app as sheets of 12 dishes (4 × 3 grid) and cut up automatically:

```sh
npm run sheet               # copies the prompt for the next 12 dishes to the clipboard
                            # → paste into Gemini, download the image, run it again to import it
npm run sheet -- --redo     # regenerate the last sheet (e.g. wrong order or a dish looks off)
npm run sheet -- --redo --sheet 12   # the same for any other sheet
npm run sheet -- --reslice  # cut all imported sheets again (after a change to the slicer)
npm run sheet -- --status   # progress
npm run sheet -- --api      # generate the pending sheet through the Gemini API instead (paid,
                            # GEMINI_API_KEY in .env; SHEET_MODEL / SHEET_SIZE override model and 1K/2K/4K)
npm run sheet -- --batch 5  # submit the next 5 sheets as one Gemini batch job (half price, done within 24 h);
                            # any later `npm run sheet` checks the job and imports the sheets when it is done
```

Dishes you tried or wishlisted come first, then cuisines you started. Linked dishes (the same dish in
several cuisines) share one drawing. Sheets are kept in `data/sheets/`.

A one-off sheet with a hand-written manifest (`api/sheets/<name>.json`) can be cut with
`npm --prefix api run slice -- <image> <name>`. `npm --prefix api run images` generates images one by one
through the OpenAI API instead (needs `OPENAI_API_KEY`).
