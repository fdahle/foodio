# Foodio

Express + SQLite API (`api/`) and Vue client (`client/`). Running, users and illustrations are in the README;
this file is about editing the dish catalogue, which is most of the work.

## The catalogue lives in `api/seed/`, not the database

`data/foodio.db` is generated from the seed on every API start (`seed()` in `api/seed.js`, idempotent).
Never edit dishes in the database directly; change the seed and reseed:

```sh
cd api && node --no-warnings --input-type=module -e "const {seed}=await import('./seed.js'); seed()"
```

- `01-…08-*.json`: cuisines → regions → dishes, one dish per line as compact JSON
  (`{"name","aka","emoji","tags","desc","wiki"}`). Keep that formatting; edit lines rather than reformatting files.
  A dish's position in its region is its sort order: the region's headline dishes come first.
- A dish's **key** is `<cuisine-slug>/<dish-slug>` (see `slugify` in `seed.js`). Every other seed file, the
  illustrations (`data/images/<cuisine>/<dish>.webp`) and users' progress hang off this key.
- Renaming a dish or moving it to another cuisine changes its key: add `"old": "new"` to `renamed.json`, or
  the old dish is deleted and the new one starts without image or progress. Moving within a cuisine
  (another region) keeps the key.
- `types.json`: exactly one type per dish (`main snack side soup noodles bread dessert deli drink`). A sauce served
  over meat (mole) is a main, not a side. `deli` ("Cheese & charcuterie") is for products made by a producer and
  eaten as they come: cheeses, cured hams, dry sausages, jerky. Anything cooked or assembled in a kitchen
  (edamame, saganaki, pesto) gets a normal type. The type list also lives in `client/src/util.js`.
- `contains.json`: what the dish usually contains, from the list in `api/diet.js`. It drives the diet filters
  (pescatarian/vegetarian/vegan/avoid), so be strict: fish sauce, dashi, oyster sauce, stock, lard and
  gelatine all count.
- `minor.json`: entries of `contains` that are only seasoning, stock, fat or a side served with it.
  They still rule out vegetarian, but don't earn a `meat` or `seafood` tag (Tonkatsu isn't a seafood dish
  because of Worcestershire sauce; Belgian fries aren't a meat dish because of beef fat). Dishes that come
  "with meat or fish" keep both tags.
- `same-dishes.json`: groups of keys for the same dish listed under several cuisines (shown as "also in…",
  and they share one illustration). Link only when one picture fits all of them: a shared Wikipedia article
  often just means a dish family (all empanadas, ceviches, biryanis), which stay unlinked. Links only work
  across cuisines. A group's id is its first member's key, so that dish pointing to itself is expected.
- Diet tags are computed and never written by hand; the `tags` in the dish lines only matter for the
  extras `spicy` and `street` (and as a fallback type).
- Every new dish needs an entry in `types.json` and `contains.json`; append new keys at the end of those files.

## Conventions

- The same name in two cuisines is intentional when it's the same dish (link it in `same-dishes.json`).
  The original keeps the plain name; a regional variant gets a suffix, e.g. "Raclette (Swiss)".
  Different dishes that share a name (Bara, Natilla) stay unlinked.
- Names are "English (Native)" or the native name: "Hangover Soup (Haejangguk)".
- `aka` (optional) lists other names people search for, never shown: other spellings or transliterations
  (Cevapcici), other established names (Shumai, Pretzel, Spaghetti Bolognese). Search already ignores accents,
  spacing and small typos and also searches descriptions, so don't repeat those; Latin script only, at most 3.
  An alias may name the same dish in another cuisine (Goulash), never a different dish in the same cuisine.
- Descriptions are one sentence, about 80–130 characters, ingredients first, then where it's from or when
  it's eaten. Only set `wiki` when you're sure the English Wikipedia article exists.
- Regions are filed by where a dish comes from, except buckets that mean "national": Pan-Spanish,
  Everywhere in Japan, American Classics, German West & Everywhere. Mexico's "Yucatán, Oaxaca & Coasts"
  deliberately holds the coastal seafood dishes, including Sinaloa and Baja.
- Avoid near-duplicates within a cuisine (a dish plus "the dish with its usual topping").
- A cuisine has ~13–30 dishes. Its `countries` (ISO codes) colour the world map; a new code must also be added
  to `api/continents.js`, or the cuisine lands under "Other". Small islands (Cape Verde, Mauritius,
  Curaçao, …) aren't on the map; that's accepted.
- New or renamed dishes show their emoji until an illustration is made (`npm run sheet`, see README).

## Dishes to add

Dishes aren't added in the app: the *Add a dish* / *Suggest a dish* button puts them on a list (the
`suggestions` table, shown under *Dishes to add* in the Users tab), and they're added to the seed here with
all their details. Read the open ones with
`sqlite3 data/foodio.db "select s.id, s.name, c.slug, s.note from suggestions s left join cuisines c on c.id = s.cuisine_id where s.status = 'open'"`,
and once a dish is in the seed, mark it `update suggestions set status = 'done' where id = …`
(`dismissed` for ones not added: duplicates, near-duplicates, not a dish).

## Feedback

*Report a problem* on a dish and the *Feedback* button in the top bar fill the `feedback` table (shown under
*Feedback* in the Users tab). Dish reports (`picture description cuisine duplicate other`) are fixed in the seed
by the dish's key; `idea bug other` without a dish are about the app. Read the open ones with
`sqlite3 data/foodio.db "select f.id, f.kind, d.key, f.note from feedback f left join dishes d on d.id = f.dish_id where f.status = 'open'"`,
and mark them `update feedback set status = 'done' where id = …` (or `dismissed`).

## Checking changes

After a seed change: reseed, then check that the dish count is what you expect, that new keys didn't
collide, and that diet tags look right
(`sqlite3 data/foodio.db "select key, tags, contains from dishes where key like 'cuisine/%'"`).
There's no git history here, so back up `api/seed/` before large edits.
