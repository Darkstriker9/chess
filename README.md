# React Chess — Local, Online, vs AI — with accounts and saved games

## Structure

```
chess-game/
  backend/
    server.js          Express + Socket.io entry point
    firebaseAdmin.js    Firebase Admin SDK init (Firestore + Auth verification)
    middleware/auth.js   verifies Firebase ID tokens sent from the frontend
    stats.js             shared win/draw/loss crediting logic (games route + abandon-loss)
    presence.js           in-memory online/offline tracking for the friends list
    engine.js             shared chess-api.com / stockfish.online provider logic
    routes/
      aiMove.js          proxies to your chess engine API, keeps the API key secret
      analyzeGame.js       evaluates each position of a finished game for Game Review
      games.js            save / list finished games (Firestore)
      profile.js          returns the logged-in user's win/draw/loss stats + syncs profile doc
      friends.js           search users, send/accept/decline friend requests
  frontend/
    src/pieces/          ONE FILE PER PIECE
      Pawn.js  Rook.js  Knight.js  Bishop.js  Queen.js  King.js
      index.js            wires them together + starting position
    src/chessEngine.js    check / checkmate / stalemate / draws / FEN / SAN
    src/Board.jsx         game state, click-to-move, applies all rules
    src/PromotionModal.jsx
    src/MoveHistory.jsx
    src/Clock.jsx
    src/GameReview.jsx      post-game move-quality analysis (Local/Online only)
    src/firebase.js        Firebase client SDK init (Auth)
    src/Auth.jsx          login / register form (Firebase Auth, email + password)
    src/Avatar.jsx          avatar image, or a colored initial-letter circle as fallback
    src/PlayerBar.jsx        avatar + name + captured pieces, shown above/below the board
    src/Profile.jsx        stats + match list + friends (search/add/accept) + delete account
    src/Lobby.jsx           online lobby: quick match / create / join private room
    src/AiSetup.jsx         choose AI difficulty + your color before starting
    src/pieceThemes.js      piece/board style catalog (Classic, Neon, Wood, etc.)
    src/sound.js             synthesized sound effects (Web Audio API)
    src/api.js             calls the backend REST endpoints, attaches Firebase ID token
    src/App.jsx            menu: local / vs AI / online lobby + account menu
```

## 0. Firebase project setup (one-time, in the Firebase console)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore Database** → create a database (production or test mode is
   fine — access is controlled via the backend's Admin SDK, which bypasses
   security rules).
4. **Project settings → General → Your apps** → add a Web app → copy the
   config values into `frontend/.env` (see below).
5. **Project settings → Service accounts** → Generate new private key →
   paste the full downloaded JSON into `backend/.env` as `FIREBASE_SERVICE_ACCOUNT`
   (see below).

## 1. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `FIREBASE_SERVICE_ACCOUNT` — the full service account JSON from step 0.5
  above, as a single line.
- The AI opponent uses [chess-api.com](https://chess-api.com) (free Stockfish
  18, no API key required) — nothing to configure there. If you switch to a
  provider that does need a key later, add it to `.env` and read it in
  `backend/routes/aiMove.js`.

Then start the server:

```bash
npm start
```

Runs on `http://localhost:4000`.

## 2. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `.env` with your Firebase Web app config from step 0.4 above, then:

```bash
npm run dev
```

Runs on `http://localhost:5173`.

## 3. Deploying (GitHub + Vercel + a backend host)

The frontend is a static Vite build — Vercel is a great fit. The backend
is a long-running Socket.io server, which **Vercel's serverless functions
don't support** (no persistent WebSocket connections), so it needs a host
that runs a normal Node process instead. [Render](https://render.com) and
[Railway](https://railway.app) both have a free/cheap tier and work with
zero config changes to this repo.

### 3.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

The repo already has a `.gitignore` (`node_modules/`, `.env`, `dist/`) —
your real `.env` files with secrets are never committed. `.env.example`
files are, so anyone cloning the repo knows what to fill in.

### 3.2 Backend → Render (or Railway)

On Render: **New → Web Service** → connect this repo →
- **Root directory:** `backend`
- **Build command:** `npm install`
- **Start command:** `npm start`
- **Environment variables:** copy everything from `backend/.env.example`
  with your real values — `FIREBASE_SERVICE_ACCOUNT` (the full JSON as one
  line) and `CLIENT_ORIGIN` (your Vercel URL, see 3.3). Don't set `PORT` —
  Render provides it automatically and `server.js` already reads
  `process.env.PORT`.

Once it's deployed you'll get a URL like `https://your-app.onrender.com` —
that's your `VITE_BACKEND_URL` for the frontend.

Railway works the same way (root directory `backend`, same build/start
commands and env vars).

### 3.3 Frontend → Vercel

On Vercel: **Add New → Project** → import this repo →
- **Root directory:** `frontend`
- Framework preset should auto-detect as Vite (build command
  `npm run build`, output directory `dist`) — leave those as-is.
- **Environment variables:** copy everything from `frontend/.env.example`
  with your real values, plus `VITE_BACKEND_URL` set to your Render/Railway
  URL from 3.2.

`frontend/vercel.json` already has a rewrite rule so client-side routes
(`/lobby`, `/online/ABCDE`, etc.) don't 404 on refresh or direct link —
nothing to configure there.

### 3.4 Wire the two together

- Back in Render/Railway, set `CLIENT_ORIGIN` to your Vercel URL
  (`https://your-app.vercel.app`). `CLIENT_ORIGIN` accepts a comma-separated
  list, so you can include a preview-deployment URL too if you want PR
  previews to work:
  `CLIENT_ORIGIN=https://your-app.vercel.app,https://your-app-git-main-you.vercel.app`
- Redeploy the backend after changing env vars (Render/Railway do this
  automatically on save, or trigger it manually).
- In the Firebase console, **Authentication → Settings → Authorized
  domains**, add your Vercel domain — needed for auth actions like
  password reset emails to work from the deployed site.

### 3.5 Sanity check

- Visit your Vercel URL, sign up, start a **Two Players** game locally —
  confirms the frontend build itself is fine.
- Try **Play Online** in two tabs (or two browsers) — confirms the
  frontend can reach the backend and Socket.io connects (check the
  browser console/Network tab for CORS or connection errors if it
  doesn't).
- `https://your-backend-url/health` should return `{"ok":true}` — quick way
  to confirm the backend deployed and started correctly on its own.

## What's implemented now

- **Full move legality** — every move is filtered through `chessEngine.js`
  so you can never move into check, and castling checks that the king
  isn't in, through, or moving into check.
- **Checkmate / stalemate detection** — the game ends and announces a
  winner (or draw) automatically.
- **Draw rules** — insufficient material, the 50-move rule, and threefold
  repetition are all detected.
- **Pawn promotion picker** — a modal lets you choose queen/rook/bishop/knight
  instead of auto-queening.
- **Move history** — a live, PGN-style move list next to the board.
- **Chess clocks** — 10-minute clocks per side; running out of time ends
  the game.
- **Accounts** — register/login via Firebase Authentication (email +
  password). The frontend talks to Firebase directly for sign-up/sign-in;
  the backend only verifies the resulting ID token on protected requests.
  You can also skip and play as a guest.
- **Saved games** — when a game ends, it's POSTed to `/api/games` and
  stored in Firestore (best-effort — a failed save doesn't interrupt the
  game). `GET /api/games` returns a logged-in user's saved games.
- **Profile page** — signed-in users see a "Profile" link in the menu bar
  showing matches played / wins / draws / losses (running totals kept on
  `users/{uid}` in Firestore) plus a list of their saved games. Stats are
  now credited accurately based on which color the account actually
  played (fixed from an earlier version that just tallied the raw result
  string).
- **Online multiplayer, real lobby-style** — a "Play Online" screen (like a
  game lobby) offers:
  - **Quick Match** — auto-pairs you with the next player also looking for
    a game.
  - **Create Private Room** — generates a 5-character shareable code (a
    "room seal") for a friend to join.
  - **Join Private Room** — type a friend's code to join their room.
  Socket.io handles matchmaking and relays moves between the two browsers
  in real time. A **"Leave game"** button asks for confirmation and, if a
  signed-in player leaves (or disconnects) before the game finishes, the
  backend directly records a **loss** on their Firestore profile — their
  opponent's client independently records its own win the normal way, so
  no client needs to be present for both halves of the result to land.
- **AI opponent** — powered by [chess-api.com](https://chess-api.com)
  (Stockfish 18 NNUE, free, no API key), with automatic fallback to
  [stockfish.online](https://stockfish.online) if the primary provider
  times out or errors, plus a visible retry button in the UI if both fail.
  Your backend proxies the request so the frontend never talks to either
  provider directly.
  - **6 difficulty levels** (Rookie → Grandmaster), which map to search
    depth (3 → 18, the free-tier cap). There's no true Elo-limiting on the
    underlying engine, so treat these as "how deep it searches," not a
    precise rating — Rookie will still play soundly, just less deeply.
  - **Choose your color** — White, Black, or Random — before the game
    starts.
  - AI games are saved to your match history but **never** affect your
    win/draw/loss stats or matches-played count — only Local and Online
    games count toward your profile.
- **Resign & draw** — buttons live under the board. Resigning ends the
  game immediately as a loss for you (with a confirmation prompt first).
  Offering a draw online requires the other player to accept (they get an
  Accept/Decline prompt); in Local/AI mode a draw ends the game right
  away, no negotiation needed since there's no separate account on the
  other side of the board.
- **Piece styles** — a small picker on the main menu (Classic, Onyx &
  Ivory, Neon, Wood, Marble). These are CSS treatments (colors, stroke,
  outline) of the same Unicode chess characters, plus matching board
  square colors per theme. Your choice is saved in `localStorage` and
  persists across visits. (There was briefly a custom-SVG-piece version
  in between, in an attempt to chase down a contrast issue — reverted
  back to the Unicode-glyph look since it read as noticeably more
  polished than the hand-drawn SVG shapes; the contrast fix itself was
  kept.)
- **Background** — a layered gradient (soft gold + emerald glows, a faint
  chessboard texture) instead of flat black.

- **Friends** — from Profile's "Friends" tab: search by username, send a
  request, accept/decline incoming ones. Each friend shows an **online /
  offline** dot (based on whether they currently have the app open —
  tracked over the same Socket.io connection used for online play, not a
  separate presence system). Click a friend to see their stats (matches
  played / wins / draws / losses) and to **unfriend** them. Usernames
  aren't guaranteed unique (Firebase Auth doesn't enforce that), so with
  enough users you may see more than one match for a common name.

- **Avatars — real file upload** — from Profile, pick an image from your
  device; it uploads to Firebase Storage and the resulting URL is saved
  as your Firebase Auth `photoURL`. **This needs Firebase Storage enabled
  in your console** (see setup note below) — with no avatar set, you get
  a colored circle with your username's first letter instead.
- **Delete account** — a "Delete account" button at the bottom of
  Profile, behind two confirmations. Deletes your Firestore profile doc
  (stats, friends list) and the Firebase Auth account itself. Known gap:
  it does **not** scrub your uid out of other people's friends lists
  (that would mean scanning every user's doc), so a deleted friend may
  briefly still show their old username in someone else's list. Saved
  games in the `games` collection are left alone too — they're treated as
  historical records, not tied to a live account.
- **Board flips for black** — in Online and vs AI modes, if you're
  playing black the board orientation flips so your own pieces are at the
  bottom, the same as any standard chess client.
- **Player bars with captured pieces** — above and below the board, each
  side now shows an avatar, name, and a strip of the opponent pieces
  they've captured, plus a `+N` material-lead indicator (standard piece
  values: pawn 1, knight/bishop 3, rook 5, queen 9) — similar to
  chess.com's in-game header. There's no numeric rating/Elo system,
  though — AI shows its difficulty name instead, and online opponents
  just show their username.
- **Vs AI now shows only Resign** (no draw offer — there's no one on the
  other side to agree to one). Vs AI and Local (same-device) games are
  saved to your match history but never touch your win/draw/loss stats or
  matches-played count — only Online games count toward your profile.
- **Game Review** — after a **Local** or **Online** game ends (not vs
  AI), a "Game Review" button runs the same free engine used for the AI
  opponent against every position in the game and classifies each move
  (Best / Excellent / Good / Inaccuracy / Mistake / Blunder), with a
  per-side summary plus a full move list. Two things worth knowing:
  - **No "Brilliant"/"Great" categories.** Those need detecting sacrifices
    and "only good move in a forced position," which is a lot more
    involved than a straight evaluation-loss comparison — this only does
    the simpler centipawn-loss-based classification.
  - **It can take a little while on long games** — positions are
    evaluated one at a time (not in parallel) to stay polite to the free
    engine APIs, capped at 80 positions per game.
- **Sound effects** — a toggle on the main menu (on by default). Fully
  synthesized in the browser with the Web Audio API (short oscillator
  tones for moves/captures/check/game-end) — there are no external audio
  files, so nothing to download and no licensing to worry about.

### Extra setup for avatar uploads (Firebase Storage)

1. Firebase Console → **Build → Storage** → **Get started** → pick a
   location → done. **Note:** Google now requires the **Blaze
   (pay-as-you-go)** plan to use Storage at all, even if your actual usage
   stays well within the always-free monthly quota — you'll be prompted
   to add a billing account.
2. Set Storage security rules so people can only overwrite their own
   avatar (Storage → Rules):
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /avatars/{uid} {
         allow read: if true;
         allow write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
3. Add `VITE_FIREBASE_STORAGE_BUCKET` to `frontend/.env` — see
   `frontend/.env.example` for where to find it in the console.

If you'd rather skip Storage/Blaze entirely, the avatar upload button will
show a clear error until this is set up — everything else in the app
works without it.

## Known simplifications (still worth knowing)

- SAN notation doesn't disambiguate the rare case of two identical pieces
  that could both legally reach the same square (e.g. two knights).
- Online games don't sync the clock server-side — each browser runs its
  own timer, so it's "good enough for casual play" rather than
  tournament-grade fairness. A next step would be making the backend the
  source of truth for time.
- No reconnect/resume — if you refresh mid-game (including online games),
  the game state resets and you'd need to create/join a new room. A
  refresh during an online game will also register as an abandon-loss,
  same as closing the tab, since the backend can't tell the difference.
- The matchmaking queue and room list live in memory on the backend
  process — restarting the backend clears any in-progress lobbies (saved
  finished games in Firestore are unaffected).
