# Music auto-tagging (mood, style, vocals)

Status: **exploration only.** Nothing is decided or built. This is a record of a research conversation (November 2026), to pick up later. Before building anything, turn it into a proposal in `ROADMAP.md` under the usual process.

The figures for model sizes, speeds and licenses below come from memory, not from fresh research or measurement. Verify them before relying on them.

## The problem

Preparing music for a tabletop RPG means finding tracks that fit a mood (tense, exploration, sad, stealth, horror…) **and** a setting (fantasy, modern, futuristic, cyberpunk…), and knowing whether a track has vocals. Going through downloaded music by ear is slow. The goal is for the app to suggest tags for each track, and to warn about tracks whose mood changes so much during their length that they're probably unusable.

Constraint: the app has no runtime dependencies (`DESIGN.md` §1.1). The owner is willing to make an exception and use npm packages for this feature only. That exception has to be stated in the proposal.

## Options considered

1. **Essentia's pre-trained music classifiers (MTG / Discogs-EffNet).** A shared ~18 MB fingerprint model with small classifier "heads": 56 mood/theme tags from MTG-Jamendo (*epic, dark, adventure, film, calm, melancholic, space…*), 400 Discogs styles (*Score*, *Celtic*, *Medieval*, *Dark Ambient*, *Synthwave*, *Industrial*…), a reliable voice/instrumental classifier, and arousal/valence. Run it with `essentia.js` (WASM + TensorFlow.js), or with the ONNX exports on `onnxruntime-web`/`-node` and a mel spectrogram written by hand. **Licensing:** essentia.js is AGPL and the models are CC BY-NC-SA (non-commercial).
2. **CLAP, zero-shot, via `transformers.js`** (`@huggingface/transformers`, Apache-2.0). Audio and text share one fingerprint space, so labels are free text ("medieval tavern music with lute", "cyberpunk synthwave", "a person singing"). The stored fingerprints also allow text search and "more like this". It's large (about 150–600 MB depending on compression) and its scores are fuzzy. Models: `Xenova/clap-htsat-unfused` (general) and `Xenova/larger_clap_music` (more music-focused, bigger).
3. **AudioSet classifier (YAMNet on TensorFlow.js at ~4 MB, or AST on transformers.js at ~90 MB compressed).** 521–527 fixed labels: *Singing, Choir, Speech*, 7 coarse moods, genres, instruments (harp, bagpipes and orchestra point to fantasy; synthesizer and electric guitar to modern or sci-fi), and non-music sounds (rain, fire, crowd), which would also help label ambience and sound effects.
4. **Hand-written signal analysis, no packages** (optionally `Meyda`, MIT). Tempo, loudness and its range, brightness, how often notes start, and major/minor key, mapped onto an intensity/mood grid. Good for intensity, weak for style and vocals.
5. **Text metadata.** yt-dlp titles, descriptions, tags and channel names ("Dark Dungeon Ambience | D&D"), classified by keywords or a small text model. Cheap. A supplement, never the whole answer.

## Preferred direction: your own classifier on top of pre-trained fingerprints

Don't train a network from scratch (that would need tens of thousands of tracks). Do this instead:

1. A pre-trained model (CLAP or Discogs-EffNet) turns each audio window into a fingerprint, a list of a few hundred numbers. This model is never retrained, and it's the only part that needs a package.
2. The owner tags tracks from a **predefined tag list**, grouped:
   - **Vocals:** pick exactly one (Vocals / Choir / No Vocals).
   - **Style:** mostly one (modern / fantasy / futuristic / cyberpunk).
   - **Mood:** any number, scored independently (tense, exploration, sad, stealth, horror…).
3. A small classifier per group (logistic regression or a tiny two-layer network) is trained on the fingerprints. Training takes under a second, so it can rerun after every tagging. It's plain math with no framework and no DOM, so it fits `public/app/logic/` and can be fully unit-tested.
4. **Suggest, confirm, retrain:** untagged tracks get suggestions, the owner accepts or corrects them, and the model improves. Ask about the tracks the model is least sure of first (active learning).
5. **Cold start:** CLAP's zero-shot guesses from tag names, or a vote among the most similar tagged tracks (works from about 5 examples per tag), until there's enough data to train.

### How many tagged tracks are needed (rough, per tag, both with and without the tag)

| Tag group | Difficulty | First suggestions | Fairly reliable |
|---|---|---|---|
| Vocals / Choir / No Vocals | easy | ~10 each | ~30 each |
| Style | moderate | ~20 each | ~50 each |
| Broad mood (tense / calm / sad) | moderate | ~25 each | ~60 each |
| Close moods (tense / stealth / horror) | hard, depends on taste | ~40 each | 100+ each |

That's about 150–200 tagged tracks for useful suggestions (correcting maybe 1 in 4 or 5), and 400–500 for mostly accepting them. Tagging 200 tracks takes about 2 hours, less once you're mainly confirming.

### Rules for the data

- Each tagged track must have an answer for **every** group (or an explicit "skipped"). A missing tag otherwise reads as "doesn't apply" and teaches the model the wrong thing.
- Show how many examples each tag has. Rare tags stay weak.
- Count tracks, not windows. Windows from one track aren't independent examples.
- Measure reliability per tag with cross-validation (train on most tracks, test on the rest, rotating), and only show suggestions above a confidence threshold.

## Runs on CPU

CLAP runs on CPU without trouble. `onnxruntime-node` uses the CPU by default, and the browser would use WASM, maybe 2–4 times slower. The audio half is about 30M parameters, so a 10-second window should take a few tenths of a second (an estimate, to benchmark). It needs a few hundred MB of memory, which is fine on the 8 GB target machine as a batch job. Most of the download is the text half (RoBERTa), which is only needed to turn words into fingerprints: convert the tag names once and store them, and load it on demand only for text search. The compressed (8-bit) version is smaller and faster at a small cost in accuracy.

## Whole-track timeline and mood-variance flag

Sampling 3 clips misses tracks whose mood changes. Instead, fingerprint the **whole track** in consecutive 10-second windows and use the result as a timeline:

- Run the tag classifier **per window**, which gives a mood timeline ("calm 0:00–1:40, tense 1:40–3:10, battle from 3:10").
- **Spread:** the average distance of the windows from the track's mean fingerprint (the mood wanders).
- **Jumps:** the largest distance between neighboring windows (a sudden switch).
- **Sections:** group neighboring windows that sound alike, and tag each section.
- Flag the outliers ("mood varies"). Set the threshold relative to the library (e.g. the most variable 10%), since raw distances mean nothing on their own.

Details:
- Smooth over neighboring windows, or require a change to last 2–3 windows, so a drum fill doesn't set off the flag.
- Ignore fade-ins, fade-outs and silence (a loudness floor; the stored waveform peaks, `DESIGN.md` §6.6, show where they are).
- Don't train on windows of tracks that vary. Use only steady tracks, or let the tag dialog say which section the tags apply to.
- The waveform peaks also give a cheap pre-filter for loudness swings, before any model runs.
- **Bonus:** instead of discarding a varied track, suggest its steady section as `startAt`/`endAt`, which tracks already support (`DESIGN.md` §2.3, §8.1). This is especially useful for long YouTube compilations.

**Cost:** about 0.2–0.4 s per window on CPU (estimated), so about 6–12 s per 5-minute track and roughly 2–3 hours for 1,000 tracks, once. Ways to cut it: sample every 30 s first and fill in only where samples differ, or use 10-second windows every 15–20 s.

## Where it would run

The recommendation is the **backend, as a batch job**. Analysis is preparation work, and keeping it out of the browser tab that plays audio at the table avoids glitches. Node can't decode MP3/OGG itself, so use the optional `ffmpeg` (already used for downloads, `DESIGN.md` §5.4) or the decoders in `wasm-audio-decoders`, and `onnxruntime-node` for the model. Store fingerprints and predictions in sidecar `.json` files. Model files must be stored locally, since the browser never fetches from the internet (§1.1). The alternative is a browser Web Worker that copies the `WaveformService` pattern (§6.6).

## Open questions for later

- CLAP or Discogs-EffNet as the fingerprint source? (Test both against ~30 tracks tagged by hand.)
- Is the non-commercial license on the Essentia models acceptable?
- Is text search worth loading the text half of CLAP?
- What's the final tag list per group, and is "skipped" allowed?
- Should training happen on the backend or in `logic/`?
- How should suggestions, the mood timeline and the variance flag look in the UI?
