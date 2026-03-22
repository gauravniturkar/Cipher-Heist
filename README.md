#  The Cipher Heist
### *A Python Mystery in Five Acts*

---

> *The Meridian Diamond is gone.*
> *340 carats. ₹47 crore. Vanished without a trace.*
> *Three suspects. One night. And a trail of encrypted clues.*
>
> **Python is your only weapon.**

---

## The Case

Someone stole the Meridian Diamond from the Harwick Museum.
The detective assigned to the case? **You.**

But this isn't a point-and-click mystery. There are no hints floating on screen. No multiple choice. No hand-holding.

To crack this case, you write **real Python code** — directly in the browser — to decode messages, crack ciphers, analyze suspects, and ultimately corner the thief on a rooftop in the rain.

Every clue is a lesson. Every answer is a line of code.

---

## Five Acts. Five Concepts. One Thief.

| Act | Title | What You Learn | The Clue |
|-----|-------|---------------|----------|
| I | *The Locked Note* | Variables & Strings | A reversed name in the guestbook |
| II | *The Time of the Theft* | Lists & Indexing | Motion sensor timestamps |
| III | *The Cipher Message* | Loops & ASCII (`chr`/`ord`) | An encrypted hotel receipt |
| IV | *The Suspect's Alibi* | Functions | A suspicion scoring algorithm |
| V | *The Final Confrontation* | Conditionals | A vault PIN locked behind logic |

---

## How It Works

There are no multiple choice buttons. No drag-and-drop. No fill-in-the-blank word banks.

You open a terminal. You read the clue. You write Python. You hit **RUN**.

If your code produces the right output — the case advances.
If it doesn't — you go back and think harder.

```python
# Act I — The guestbook reads "NITRAM"
# Something's off. Reverse it.

name = "NITRAM"
print(name[::-1])

# >>> MARTIN
# The first suspect is identified.
```

That's it. That's the game.

---

## Built With

- **Pure HTML + CSS + JavaScript** — zero dependencies, zero frameworks
- **A custom Python interpreter** — written entirely in JS, runs in the browser
- Supports: variables, strings, lists, loops, functions, conditionals, `chr()`, `ord()`, `range()`, list methods, and more
- **No backend. No install. No account.**

Open the file. Solve the mystery.

---

## Run It Locally

```bash
git clone https://github.com/YOUR_USERNAME/cipher-heist.git
cd cipher-heist
open index.html
```

That's the entire setup guide.

---

## Deploy

Hosted on **GitHub Pages** — live at:

```
https://YOUR_USERNAME.github.io/cipher-heist
```

---

## Who Is This For?

- Someone who just learned Python basics and wants to *use* them
- Someone tired of LeetCode-style problems with no soul
- Someone who thinks learning should feel like an adventure
- Someone who wants to catch a diamond thief at midnight

---

## The Concepts You'll Practice

```python
# Strings & slicing
name[::-1]

# Lists & indexing
timestamps[timestamps.index(79245) - 1]

# Loops & ASCII
for c in codes:
    result += chr(c - 3)

# Functions
def suspicion_score(opportunity, motive, access):
    return (opportunity * 2) + (motive * 1.5) + (access * 2.5)

# Conditionals
for n in range(1, 101):
    if n % 7 == 0 and n % 4 == 0 and n > 50:
        matches.append(n)
```

Five clues. Five concepts. One culprit.

---

## Can You Solve It?

The case is open.

**[▸ Open Case File](https://YOUR_USERNAME.github.io/cipher-heist)**

---

*Built with Python, JavaScript, and a healthy obsession with noir aesthetics.*
*No diamonds were harmed in the making of this project.*
