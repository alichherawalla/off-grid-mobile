# What to test by hand — `release/sync-feedback`

Six defects were fixed, one is withdrawn (section 3), and the mobile inference runtime moved — which is the
riskiest thing in here and has its own section. Each one below names the exact thing to do, what you should see, and what the
failure looked like before, so a partial fix cannot pass as a whole one.

Automated coverage already holds the logic: shared 461, mobile 3129, desktop pro sync 573, renderer 204.
None of it can prove a real transfer between two machines, which is what this list is for.

**Setup once:** Mac desktop and Windows desktop both running, Android and iPhone both paired, all four on
the same network. Install the new mobile build on the phones and a fresh desktop build on both machines.

---

## 1. A received file can be opened — the one to test first

Two reports were one defect, so both directions must pass.

1. On the **phone**, send a file manually to **Windows**. Wait for the transfer to complete.
2. On Windows, open Activity and find that row.

- **Expect:** the row offers the file — a preview and a working Open.
- **Before:** "This activity no longer has a local file", while the bytes were on disk.

3. On the **phone**, attach an image to a chat message. Open that chat on the **Mac**.

- **Expect:** the image opens.
- **Before:** "the file has moved".

**The case that actually broke it:** a device that has re-registered since the transfer. If you can, unpair
and re-pair a phone, then open an activity row from *before* the re-pair. That is the condition the fix
targets — the record names the peer as it was, the row asks for the peer as it is now.

## 2. Generated media arrives on the phone

Before this test, fully stop and restart the Windows `npm run dev` process so Electron reloads the
new Shared bundle. Generated media and message attachments have no policy settings. They always move
with their chat, so one successful replication to every connected device proves each journey.

1. On the **desktop**, generate an image.
2. Watch the **Android** phone.

- **Expect:** it arrives with no extra switch touched. Generated media is on by default now.
- **Before:** attachments arrived and generated media did not.

3. Go to the phone's receiving settings. Confirm that **Chats**, **Projects**, **Model settings**,
   **Generated media**, and **Message attachments** are not shown as options. These records always
   sync across the mesh.

   In the same screen, confirm there are only two sections: **Sending** and **Receiving**. Sending
   must not show Chats, Projects, or Model settings, and there must be no Ambient sharing section.
   Confirm that **Destination** and **From** each use one drop-down, not a row of device chips.
   Confirm that **Automatic sharing** and **Receiving rules** are compact summary rows. Each
   **Configure** action must open a policy matrix in a bottom sheet.
   The Automatic sharing matrix must contain only **Screenshots** and **Downloads**. Generated media
   and Message attachments move with their chats and must not have optional controls.

4. Turn **Files** off. Generate another image.

- **Expect:** it still arrives. "Files" means files sent to you directly, and it no longer governs
  generated media.
- **Before:** one switch silently governed both.

Repeat 1 and 2 for a **message attachment** from desktop. It also has no Receiving switch and always
syncs across the mesh.

## 3. Copy in another app on Android, paste on the desktop

The headline fix from your list, and the one that needs a permission you have never granted before.

1. Install the new build. Open **Sync settings** and turn **Clipboard sync** ON.

- **Expect:** a sheet appears saying Android hides the clipboard from apps that are not on screen, with a
  button to open Accessibility settings.
- **Expect:** nothing asked for this at launch — only when you switched the feature on.

2. Tap the button, and turn **Off Grid AI** on in the Accessibility list.

- Read that screen's description while you are there. It says what is read and what is not, and it is what
  a user decides on.

3. Come back to the app. Open **Chrome**, select some text, copy it.

- **Expect:** it reaches the desktop clipboard.
- **Before:** nothing outside the Off Grid app was ever captured — the phone had never sent one clipboard
  entry, in either build.

4. Copy something **inside** the Off Grid app.

- **Expect:** still works. That path already worked and must not have regressed.

5. Now turn the Accessibility service **off** in Android settings, return, and toggle Clipboard sync off
   and on again.

- **Expect:** the sheet appears again, because the grant is genuinely missing. It is not a one-time
  explainer.

6. Copy an image or a file in another app.

- **Expect:** nothing syncs. Clipboard sync is text-only by design, so this is a check that it fails
  quietly rather than doing something surprising.

**The honest limit:** capture rides on a text selection. A long-press "Copy" with no highlight may still
come back empty. If you find a copy that does not travel, tell me whether you had text selected.

## 4. Pairing — NOT FIXED, but worth reproducing precisely

I had this wrong and the test suite caught me. My first fix hid a cancelled attempt, and
`deviceManagement.integration.test.tsx` disproved the premise: that journey cancels, reads "Pairing
cancelled", retries and pairs, so retry-after-cancel already worked and the confirmation is wanted. I
reverted the behaviour change and kept only a genuine robustness fix — an attempt is now read at its LAST
state, so it can never be presented from an earlier row of its own history.

**So do not test for a fix here. Test to pin down the sequence**, because the working journey and your
report disagree, and the difference is the bug:

1. Start pairing, type a **wrong** code, let it fail.
2. Press **Cancel** on the failed attempt.
3. Start pairing again with the correct code.

Tell me exactly what the sheet says at each step, and whether the retry pairs. My suspicion is that a
cancel does nothing to an attempt that has already reached `failed` — a terminal attempt has nothing left
to cancel — so it stays on screen as the last thing that happened. The journey that passes cancels while
still `waiting_for_confirmation`, which is a different state and a different code path.

A screen recording of those three steps would settle it in one pass.

## 5. A fresh phone can find the desktop

This is the one that needs the awkward setup, and it is worth it — it silenced the desktop completely.

1. On the **Mac**, plug in a **dock or USB-Ethernet adapter with no DHCP** — anything that lands on a
   `169.254.x` self-assigned address. `ifconfig` should show it active with that address.
2. From another machine: `dns-sd -B _offgrid._tcp local`

- **Expect:** the Mac's record is listed.
- **Before:** nothing from the Mac appeared, while its own setting still read discoverable. The log said
  `Bonjour discovery unavailable: send EHOSTUNREACH 224.0.0.251:5353`.

3. On a phone with **no pairing to that Mac**, open Devices and scan.

- **Expect:** the Mac appears and can be paired.
- **Before:** invisible. An already-paired phone kept working, which is what hid this.

4. Now move the Mac between networks — switch Wi-Fi, or pull the cable and use Wi-Fi.

- **Expect:** within a few seconds the Mac is discoverable again at its new address, with no restart.
- **This is new behaviour.** Desktop never followed its own address before, so it is the most likely place
  for a regression. Please try it twice.

## 6. A generated image previews on Windows

1. On **Windows**, generate an image.

- **Expect:** the preview renders in the chat.
- **Before:** the preview was broken; only Download produced a working file.

2. Generate one whose prompt makes a long filename, and one while the app is at a different window size.

- **Expect:** both preview. The old failure was in the path, not the picture, so a path with a space in it
  is the interesting case — the profile directory "Off Grid AI Desktop" already contains two.

3. Then confirm sync: that image should reach the phone (this is also test 2).

## 7. Nothing regressed on macOS previews

The preview fix touched a path shared by every locally served image.

1. On the **Mac**, open Replay, a generated image, and a style-picker thumbnail.

- **Expect:** all render as before. macOS never had the Windows fault, so this is purely a no-regression
  check on the same code.

## 8. The mobile inference runtime moved — the riskiest change here

`llama.rn` went from 0.12.9 to 0.13.0-rc.0. It is a release candidate, and it changed the TTS API.

1. Load a text model you use often and send a few messages.

- **Expect:** loads and streams as before. Try one on the Hexagon/NPU backend too, since those kernels come
  from this runtime — they are byte-identical to what we shipped, but worth one pass.

2. **Speak a reply with OuteTTS.** This is the one I would test first.

- **Expect:** speech sounds as it did.
- **Why:** 0.13 removed the guide-token API OuteTTS used and moved that job into native. I adapted the
  engine, but guide tokens are what kept the spoken output tied to the text, so a regression would show as
  drifting or wrong words rather than an error.

3. Try **Nemotron 3.5** — new in this runtime, and it should now load where it could not before.

4. Voice mode: switch text → voice mid-conversation.

- **Expect:** it may still say "LLM is busy". That is Pat's open defect, not this bump. Note if it got
  worse.

---

## 9. The durable queue — a file that is still coming now says so

The store that remembered finished transfers now remembers unfinished ones too. Read section 10
before you start: half of what this changes is deliberately not wired yet, and testing for it would
waste your time.

**The one line that was the bug:** the store accepted only `completed` and `failed` and returned
early on everything else. So "queued for a device that is switched off" existed in memory and nowhere
else, and closing the app erased the fact that anything was expected at all.

### 9.1 A file still on its way survives a restart

1. Put the **Windows** desktop to sleep, or quit it.
2. From the **phone**, send it a file.
3. Look at Activity on the phone.

- **Expect:** a row for that file, reading as queued, naming Windows.
- **Before:** it appeared briefly and then nothing. Not an error, just silence.

4. **Force-quit the phone app and reopen it.** Open Activity.

- **Expect:** the row is still there, still queued. This is the whole point.
- **Before:** gone. Nothing recorded that a file was owed.

5. Do the same in reverse: desktop to a phone in aeroplane mode, then restart the desktop app.

### 9.2 An arriving file draws a real placeholder

The control naming a file arrives before its bytes, so the receiver can show what is coming.

1. Send a **large** image or PDF phone → Mac, so the bytes take a moment.
2. Watch Activity on the Mac while it transfers.

- **Expect:** a row with the correct **filename and size** while it is still arriving, and a bar that
  fills. Not a spinner over nothing, and not a row that appears only once it has landed.
- **Before:** nothing until it completed.

### 9.3 Activity lists file transfers only

Everything rides one queue now, but Activity is the list for things whose bytes you are waiting on.

1. With Clipboard sync on, copy some text. Send a chat. Change a model setting. Add a document to a
   project.
2. Open Activity on both devices.

- **Expect:** **none** of those four appears as an Activity row. Files, generated media, message
  attachments, screenshots, downloads and models do.
- **Why it matters:** a row per clipboard entry or per chat op would bury the transfers.

Then confirm they still actually sync — hidden from Activity is not the same as off.

### 9.4 History did not regress

The same store holds the finished rows it always did.

1. Open Activity on a device with a transfer history.

- **Expect:** completed and failed rows as before, newest first, with the same names and devices.
- **The case worth checking:** send a **multi-file model package**. Its rows finish inside the same
  millisecond, and the ordering had to be given a deliberate tie-break. They should read in a stable
  order, and re-opening the screen must not shuffle them.

### 9.5 A queued row is never tidied away

History is capped at 100 rows. That cap must not eat work that has not happened yet.

1. On a device with a long transfer history, queue a file for a peer that is off.
2. Move enough files to push the finished count past the cap.

- **Expect:** the queued row is still there. Only finished rows are forgotten.

### 9.6 Retry and cancel do what the row offers

The two platforms genuinely differ here, and it is now declared rather than accidental.

1. Make a transfer fail (peer off mid-send).
2. On the **desktop** row: **Retry** is offered, and pressing it re-sends.
3. On the **phone** row: retry is **not** offered for a live transfer; cancel and dismiss are.

- **Expect:** no button that does nothing when pressed.
- **Before:** the phone briefly offered a retry that reached no handler and threw.

### 9.7 Projects still sync, quietly

1. Add a document to a project on one device.

- **Expect:** it reaches the other device, and creates **no** Activity row.

---

## 10. What is NOT wired yet — do not report these as bugs

The queue records what is owed. It does not yet act on it. Three consequences:

- **A queued row does not resend itself.** After 9.1, bringing the device back does **not** make the
  file go automatically from the restored row. Retry still runs from memory, so a restart loses the
  ability to resume even though the row survives. Replaying from rows is the next change, and it is
  the one that needs its own device round.
- **Models and clipboard still keep their own separate stores.** They were already durable, so
  nothing regresses, but they are not on the one queue yet. Collapsing them needs the row to carry
  package identity first — a model package is one row over several transfers.
- **Some rows are still assembled by the screen.** Ambient deliveries on desktop, and ambient,
  knowledge and model rows on mobile, are still built in the UI. They work; they are simply not
  through the shared projection yet.

### Test status, stated honestly

- **shared** `@offgrid/sync` — 466/466.
- **desktop** — 4144 passed, 1 skipped, 0 failed across 437 files. The separate `.dbtest` project is
  262/264; both failures are `fetch failed` in `image-runtime-reliability`, an external-network test
  unrelated to this work.
- **mobile** — 8190 passed, 103 failed across 11 suites. **None of the failures is sync.** They are
  rntl screen suites failing at import with `Cannot read properties of undefined (reading
  'CenteredAlert')` from a barrel cycle in `src/components/index.ts` via `ModelCardContent.tsx` —
  separate in-flight work. Every sync suite passes, including `ambientShare.integration`.

---

## Not fixed, so do not test for a fix

Recorded in `FEEDBACK_2026-08-12.md` with the reason each one waits:

- **A reinstall costs a mesh seat** (Pat). Needs a device identity that survives reinstall — a product
  decision, and acting without one would evict a device someone still uses.
- **"LLM is busy" on a text-to-voice switch** (Pat). Cause found: the send is refused after a 15-second
  wait while this codebase documents a 74-second prefill. The fix should wait on progress rather than
  elapsed time, and wants a device round of its own.
- **Muse Glimmer 30B on Android.** Still absent from llama.rn 0.13.0-rc.0. Upstream PR #379 carries it and
  is open; we check again immediately before the release. It IS testable on **desktop**, which moved to
  llama.cpp b10369 — and by Meta's own numbers it is a desktop model anyway: under 20 GB at 4-bit, needing
  a 24-32 GB envelope.
- **The persona text opening a reply.** The route is real — `systemPrompt` is a synced setting and that
  sentence exists only in mobile — but the evidence was overwritten before it could be read. If you see it
  again, run the query in the feedback doc **before** changing any setting.
- **The web-search result reading as the answer.** Did not reproduce; that chip renders collapsed. A
  screenshot of the turn would settle it.

---

# Added 2026-08-12 (later) — vision repair, the loader, and the desktop chat path

These landed after the sections above. The vision ones matter most: they were found on a real iPhone
holding a model that arrived from Android, and that exact path is what section A reproduces.

## A. A transferred vision model can be repaired from the chat

The case: SmolVLM on iOS, sent from Android with `Send model`, carrying its vision tag but refusing
photo attachments — and the Download Manager's repair answered with a raw **401**.

1. On **Android**, pick a vision model whose projector is present. Send it to the **iPhone**.
2. On the iPhone, make that model active and open a chat.

- **Expect:** if the package arrived whole, photos attach and no card appears. That is a pass.
- **Before:** the model advertised vision and the composer refused the photo, with nothing on screen
  explaining why.

3. To reach the repair path, use a model whose projector is genuinely absent (an older transfer, or a
   `recovered_` row). Open a chat with it active.

- **Expect:** a card — **"This model can't see images"** — with **Get vision file**.
- **Expect:** tapping it shows the three dots, then either fetches the file or explains why it cannot.
- **Before:** no route from the chat at all; the fix lived in a screen the user had no reason to open.

4. Tap **Get vision file** and wait.

- **Expect on success:** the model reloads and photos attach.
- **Expect when the source is unknown** (a locally imported model): *"No Source To Repair From"* naming
  the next step. This is a PASS — an imported model has no upstream, and saying so is correct.
- **Expect when several repos match:** *"Cannot Identify This Model"*, listing them. Also a PASS: a
  projector from a different quantisation loads and then reads images wrongly, so refusing is right.
- **Before:** every one of these was `Repair Failed: 401`.

**Check the same outcomes in the Download Manager** (the wrench on a completed row). Both surfaces read
one message rule, so they must say exactly the same thing for the same model.

## B. A model stops advertising sight it does not have

1. Find a vision model with no projector on the device. Open the **model picker** (home sheet) and the
   **model selector** in chat.

- **Expect:** no "Vision" badge on that row.
- **Before:** the badge showed from a stored flag while the composer refused images — the two disagreed
  about the same model, which is what made this look like a chat bug.

## C. The three-dot loader replaced every spinner

One loader now means one thing. A ring spinner on a button reads as a retry glyph, which is why pairing
and sharing looked like they had failed the moment they started.

1. **Pair** a device — watch the Pair button.
2. **Share a file** — watch the Share button.
3. Trigger the icon-button pending states on the Devices screen: **reconnect**, **disconnect**.
4. Open **Integrations** and connect an MCP server.
5. Open the **model transfer sheet** while it loads, and an **audio** message while it prepares.

- **Expect:** three pulsing dots everywhere, never a rotating ring.
- **Expect:** a button does **not** change height when it flips to loading.
- **Before:** a circular spinner that read as "retry".

## D. Desktop — an attached image survives Resend, Regenerate and Edit

This is the one that produced *"I don't see an image attached"* on a message that visibly had one.

1. Attach an image in desktop chat with a vision model active. Send it. Confirm the answer describes the
   image.
2. On that same turn press **Regenerate**.
3. Press **Resend** on the user message.
4. **Edit** the user message text and submit.

- **Expect:** all three still see the image. The attachment chip stays on the turn after an edit.
- **Before:** each replayed the text alone; the model said it saw no image and fell back to reading your
  screen. Editing also deleted the attachment permanently, so the chip vanished from the thread.

5. Reopen the conversation after an edit.

- **Expect:** the chip is still on the edited turn.

## E. Desktop — the thinking toggle on a non-Qwen model

1. Load **Muse Glimmer 30B** on desktop. Turn **Thinking** on and send a prompt.
2. Turn it off and send another.

- **Expect:** the two replies differ in whether reasoning is produced.
- **Before:** the toggle did nothing in either direction — we sent `enable_thinking`, which that template
  never reads, plus a `<think>` parser for delimiters it never emits.

**Report the off position specifically.** ON is safe (the template defaults to high), but the OFF value
is the one unverified thing in this change — I could not re-read the template to confirm how it renders a
disable. If OFF still reasons, say so; that is a known gap, not a surprise.

## F. Desktop — sizes agree on one card

1. Start downloading a large model (Nemotron 3.5 is 25.4 GB).

- **Expect:** the size in the meta line and the size in the progress line are the **same number**.
- **Before:** "25.4GB" above "1.2 GB of 23.7 GB" — decimal GB against GiB, both labelled GB.

## G. Desktop — the two new models, and the sidebar

1. Restart the desktop app. Open **Models**.

- **Expect:** **Nemotron 3.5 Lightning 30B** under Text, **Muse Glimmer 30B** under **Vision** (it has a
  projector, so it is promoted), each with a **NEW** badge and a **CHALLENGER** chip.
- **Note:** a restart is required — the catalog loads in the main process.

2. Switch the app to **light** theme and hover each sidebar row.

- **Expect:** the label darkens and stays readable.
- **Before:** the label turned near-white on a near-white row and disappeared. Light mode only.

## H. The four-device mesh connects every direct pair

Use Android, iPhone, Mac and Windows on the same Wi-Fi network.

1. Start Sync on all four devices. On each device, press **Rescan** once.
2. Wait for the mesh to settle. Do not enter another pairing code.

- **Expect:** each device connects directly to the other three devices.
- **Expect:** Android shows only **WiFi**, never **Nearby**.
- **Expect:** every LAN route is named **WiFi**.

3. Force-quit Android and iPhone. Start both apps at nearly the same time.

- **Expect:** Android and iPhone connect to each other automatically.
- **Expect:** simultaneous silent pairing does not leave both phones disconnected.

4. While the iPhone is on the network, make its saved pairing need repair.

- **Expect:** the iPhone stays under **Available** because it is reachable now.
- **Expect:** the key action is visible, and no pencil is visible.
- **Expect:** after the iPhone leaves the network and discovery reports it lost, the row moves to
  **Saved**.

5. Use the key action on an offline saved row and enter the current code.

- **Expect:** the pairing is replaced, the device reconnects, and the licence still uses the same
  number of device slots.

## I. Enhanced prompt and generated image use one Mobile result

1. Generate an image on Android with prompt enhancement on.

- **Expect:** **Enhanced prompt** is collapsible at the top of the image result.
- **Expect:** the image and caption are below it in the same message bubble.
- **Expect:** the result has one timestamp, one menu and no empty bubble.

2. Confirm the image reaches iPhone, Mac and Windows and appears in each Gallery.
3. Restart one receiving device.

- **Expect:** the image remains in the chat and Gallery after restart.

## J. A phone attachment reaches another phone

1. With no older transfers queued, attach one image to a chat on iPhone.
2. Watch the same chat on Android.

- **Expect:** a loader appears when the durable record arrives.
- **Expect:** the image replaces the loader without a rescan or pairing code.

3. Repeat while a large iPhone-to-Android file is already moving.

- **Expect:** the loader can remain while the older file is ahead in the queue, but the image must
  arrive when its bytes are transferred. It must not disappear or become an empty message.
