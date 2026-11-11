# Three Things

A two-minute morning ritual in mixed reality. Write what you want to get done today with your
finger, pick three, stick them on your real wall, and drop each one into a glass jar when it's
done. The jar keeps filling up, day after day.

Built with Meta's [Immersive Web SDK](https://iwsdk.dev) (WebXR). It runs in the Quest browser,
so there is nothing to install.

**Demo video (2:20):** <https://youtu.be/3y7JnbB56AU>

**Try it:** open <https://big14way.github.io/three-things/> in the Meta Quest browser and tap
*Start in mixed reality*. No headset? <https://big14way.github.io/three-things/emulator/> runs the
same build with Meta's headset emulator in a desktop browser.

## How it works

The first minute teaches itself. A card for something you've already done ("Put on my headset") is
waiting on the board, and a ghost hand shows the gesture: pinch it, point at the jar, let go. Your
first action ends with a clink in the jar. After that, one short instruction ribbon sits wherever
the next action is, and the ghost hand comes back only if you pause.

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

## Built for the headset you have

- **Hands first.** Everything works with bare hands. You can touch the paper with a fingertip,
  point and pinch from a distance, or use controllers.
- **Eyes and hands.** On devices with eye tracking, you look at a card, pinch, look at the jar and
  let go. Gaze tracking is requested, and drops follow your gaze while you hold a card.
- **Narrow field of view.** The paper, the card rail and the board all sit within about ±30° of
  where you're looking. This was checked on the emulator's Meta VR Glasses profile.
- **Your room matters.** The board sticks flush to a real wall and grows on far walls so it stays
  readable. A persistent anchor brings it back on your wall next time. The jar sits on your real
  desk if there's one in front of you. Rooms without planes fall back to a floating layout.
- **Spatial sound.** Every sound is synthesized and plays from where it happens, through an HRTF
  panner.
- **Seated and one-handed.** Everything is within arm's length. Typed quick picks replace writing,
  and voice works where the browser supports speech recognition.

## Run it

```sh
npm install
npm run dev        # https://localhost:8081, with the IWER headset emulator injected
npm run build      # static site in dist/, plus dist/emulator/ with the emulator bundled
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
