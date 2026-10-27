# WordRush 🚀

A real-time multiplayer Wordle racing game inspired by **skribbl.io** and **Wordle Unlimited**! Join or create rooms, customize your cartoon avatar, and race friends in real-time to solve the same secret word.

---

## ✨ Features

- **Dynamic Word Lengths (4, 5, 6, 7 Letters & Random Mode)**:
  - Not restricted to just 5 letters! Hosts can pick **4 letters** (quick & punchy), **5 letters** (classic), **6 letters** (challenging), **7 letters** (mastermind), or **Random each round**.
  - Board tiles, Team Intel slots, keyboard, and opponent mini-grids dynamically adapt to any length.
- **Online Word Fetching & Massive Offline Database**:
  - Connects to online APIs (Datamuse & Random Word API) to fetch fresh, diverse words.
  - Comes bundled with nearly **2,000 curated common answer words** across all lengths, and over **73,000 dictionary words** for offline reliability!
- **Dictionary API Word Validation**:
  - Validates guesses instantly with local dictionary checks and falls back to the **Free Dictionary API** & **Datamuse API** to accept real English words and modern slang.
- **Team Intel & Live Clue Sharing**:
  - When a player (e.g. Satyam) guesses and hits a letter in the correct position (green), the shared **Team Intel Bar** reveals the letter, spot number, and Satyam's avatar & name!
  - Confirmed letters in the word (yellow) are shared with finder attribution.
  - Opponents' cards on the scoreboard display the discovered letters directly inside their mini-grid tiles.
  - **Click to Inspect Board**: Click any player's card to view their full board, their guesses, and all letters they unlocked for the team.
  - **Scout Discovery Points**: The first player to discover each letter earns `+25 Scout Bonus Points`!
- **In-Game Dictionary Clue & Hints**:
  - Hosts can enable hints: a masked dictionary definition clue appears as time runs down to help players crack tough words!
- **Word Definition Card on Round End**:
  - Automatically fetches and displays the secret word's definition, phonetics (e.g. `[ˈplæn.ɪt]`), part of speech, and example sentence between rounds.
- **Player Statistics & Guess Distribution**:
  - Track Games Played, Win %, Current Streak, Max Streak, Total Scout Points, and an interactive 1–6 guess distribution bar chart.
- **Skribbl.io Style Avatars**:
  - Over 6,800 customizable cartoon avatar combinations (12 colors, 9 eyes, 7 mouths, 9 hats & accessories) with live celebratory animations.
- **Web Audio Sound Synthesizer**:
  - Zero-dependency synthesized audio for keystrokes, flips, solves, low-time ticks, chats, and victory fanfares (with mute toggle).
- **Public Room Browser**:
  - Discover open public matches or create your own with one click.
- **Custom Game Settings**:
  - Hard Mode, custom secret words (4–7 letters), rounds (1–10), timer (30s–240s), and max players (2–20).

---

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open **`http://localhost:3000`** in your browser.

- To play with friends on your local Wi-Fi, have them open `http://<your-local-ip>:3000`.
- To host online for free, deploy to **Render**, **Railway**, **Fly.io**, or any Node.js VPS.

---

## 🎮 How to Play

1. **Customize your Avatar** and enter your name.
2. Click **Quick Play** or **Create Private Room** (share the 4-letter room code or invite link).
3. The host selects the **Word Length (4, 5, 6, 7, or Random)**, rounds, and timer.
4. Each round, everyone gets 6 tries to crack the same hidden word:
   - 🟩 **Green** = Correct letter in the correct position.
   - 🟨 **Yellow** = Correct letter, but wrong position.
   - ⬛ **Gray** = Letter is not in the word.
5. **Scoring**:
   - `100 base points` for solving.
   - `+40 points` per unused guess remaining.
   - `Up to +100 bonus points` for speed.
   - `+25 Scout points` for being the first to uncover a letter's position.
6. **Chat & Anti-Spoiler**: Players who have completed their guess can chat freely; players still guessing cannot chat until they finish to prevent spoilers.
# wordrush
