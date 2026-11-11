# Three Things

A two-minute morning ritual in mixed reality. Write what you want to get done today with your
finger, pick three, stick them on your real wall, and drop each one into a glass jar when it's
done. The jar keeps filling up, day after day.

Built with Meta's [Immersive Web SDK](https://iwsdk.dev) (WebXR). It runs in the Quest browser,
so there is nothing to install.

**Try it:** open <https://big14way.github.io/three-things/> in the Meta Quest browser and tap
*Start in mixed reality*.

## How it works

- **Write.** A sheet of paper floats at arm's length. Touch it with a fingertip, or point and
  pinch from further away, and write. Your handwriting stays as ink, and nothing is sent anywhere.
  If you'd rather not write, tap **Ideas** for a quick pick.
- **Pick three.** Each note becomes a paper card. Grab a card and put it into one of the three
  slots on the *Today* board.
- **Pin it in your room.** Grab the board and hold it against a wall. It sticks flush to the
  wall, and a spatial anchor keeps it there the next time you look.
- **Done.** Drop a finished card in the jar. It crumples into a paper ball and lands with a
  clink. The label counts what you've finished and your streak.
- **Tomorrow.** The board starts empty. Anything you didn't finish comes back as a card marked
  *from yesterday*.

Your notes stay in the browser's local storage on the headset.

## Run it

```sh
npm install
npm run dev        # https://localhost:8081, with the IWER headset emulator injected
npm run build      # static site in dist/
```

## Input

| | Hands | Controllers | Desktop emulator |
|---|---|---|---|
| Write | fingertip touch, or point + pinch | point + trigger | mouse drag |
| Move a card or the board | point + pinch, drag | point + trigger, drag | drag |
| Buttons | poke or pinch | trigger | click |

## Licence

MIT. Built from Meta's IWSDK starter template (MIT). Handwriting font: Caveat, SIL Open Font
Licence.
