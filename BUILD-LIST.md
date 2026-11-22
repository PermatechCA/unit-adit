# ADIT build list

What's agreed and waiting to be built, in order. Move an item to the bottom under **Done** with its commit
when it ships.

## 1. Card sync and backup (SD card / USB drive)

**Goal:** plug in a card or USB drive, and ADIT copies the library to it as an `ADIT/` folder that a hardware
player can play straight off the card. Next time, it copies only what's new. It can also back the whole
library up as one zip.

**Target player: FiiO (Snowsky) Echo Mini.** Per FiiO's spec page: WAV and FLAC up to 24-bit/192 kHz,
microSD up to 256 GB, FAT32 or exFAT (no NTFS). 32-bit float isn't listed, so the card gets a player copy,
and the library and backups stay float.

### On the card

```
ADIT/
  Field/      HARBOUR GULLS.flac …
  Samples/
  Strip/
  Kit/
    Harbour kit/   01 Kick.flac  02 Snare.flac …     (slot order, one folder per kit)
  Waves/      (off by default: single-cycle tables play as a buzz)
  .adit-sync.json   ADIT's index of what it wrote: id, path, size, source modified date
```

- Folders follow the library categories. Kits are folders, with the slot number leading each file name.
- **Format: FLAC 24-bit by default**, with title, album (= category or kit) and artist tags, so the Echo
  shows real names instead of file names. WAV 24-bit is an option.
- **Over 0 dBFS:** a float sound that peaks above full scale would clip at 24-bit. Its player copy is
  turned down just enough to fit, never clipped, and the index records by how much.
- **Multichannel / ambisonic:** the player is stereo. Ambisonic files get the stereo decode (or the
  receiver position as heard, if one was set). Other multichannel files get channels 1 and 2.
- **Names:** made safe for FAT32/exFAT (no `\ / : * ? " < > |`, no trailing dots or spaces), kept readable;
  clashes get a number.

### Syncing only what's new

- ADIT reads the card's `ADIT/.adit-sync.json` and compares it with the library. It copies what's new or
  changed, and skips what's already there. It shows the plan (copy N, skip N, remove N, size) before writing.
- **Mirror deletions: an option, off by default.** When it's on, a sound deleted in ADIT is removed from the
  card too. ADIT only ever removes files listed in its own index, never anything else on the card.
- A sync cut short (card pulled) is safe to re-run: each file is written, then the index is updated.

### By device

- **Chrome / Edge on a computer (and Chrome on Android):** full sync. The user picks the card's root once;
  ADIT reads and writes the folder directly (`showDirectoryPicker`) and remembers the drive.
- **iPhone / iPad, and Safari / Firefox on a computer:** they can't write to a folder from the web. ADIT reads
  the card's folder (`webkitdirectory`, iOS 18.4+) to see what's there, then builds a **catch-up zip** of only
  what's missing, laid out as `ADIT/…`, through the Share sheet / download. The user saves it to the card in
  Files and taps it to unzip. The index travels inside the zip.
- **Zip:** stored, not compressed (audio barely compresses), ZIP64 for big libraries, streamed through OPFS
  rather than built in memory, so a multi-gigabyte zip doesn't crash Safari.

### Backup (separate from the player copy)

- **Back up everything** → one zip of the library as it is: 32-bit float masters plus every sidecar and
  kit, with the same folders, as a faithful copy. Restoring from it is a later item.

### Tests (ADIT's suite)

A fake drive in the library harness, like the fake OPFS: first sync writes the tree and index; second sync
copies only the new sound; mirror on/off; a sound over 0 dBFS is turned down, not clipped; names made safe;
kit folder in slot order; the catch-up zip holds only what the card lacks and opens as a valid zip.

## Next after that

- Sharing from ADIT: as many ways to share out as possible.

## Done

- Kits in the library, Send kit to (hand-off v2), kinds on single sends. `8ae7170`, `81fc8e0`
