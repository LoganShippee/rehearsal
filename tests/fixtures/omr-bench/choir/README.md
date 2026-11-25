# Choir OMR Benchmark Fixtures

Public-domain and CPDL-licensed choral editions paired with ground-truth MusicXML (`.mxl`), used to measure Scan & Fix accuracy on real choir notation (hymns, SATB + piano, two-part treble, Tenor treble-8 clef, multi-verse lyrics, and realistic photo/photocopy degradations).

## Source Editions (Clean PDF + Gold MusicXML)

| Folder | Title & Composer | Scoring / Feature Covered | CPDL # | License | Source URL |
|---|---|---|---|---|---|
| `abide-with-me` | *Abide with me* (tune: *Autumn*), Francis Duckworth (text: Henry Francis Lyte) | Simple SATB hymn, shared SA / TB staves, 6 verses | #70077 | Public Domain | https://www.cpdl.org/wiki/index.php/Abide_with_me_(Francis_Duckworth) |
| `ave-verum-corpus` | *Ave verum corpus*, KV 618 — Wolfgang Amadeus Mozart | SATB + keyboard reduction | #11784 | CPDL | https://www.cpdl.org/wiki/index.php/Ave_verum_corpus,_KV_618_(Wolfgang_Amadeus_Mozart) |
| `sub-tuum-praesidium` | *Sub tuum praesidium* — Alexandre Guilmant | Two-part treble (SA) + keyboard | #36402 | CPDL | https://www.cpdl.org/wiki/index.php/Sub_tuum_praesidium_(Alexandre_Guilmant) |
| `sicut-cervus` | *Sicut cervus* — Giovanni Pierluigi da Palestrina | Open-score SATB, Tenor octave-treble (`G2`/`8vb`) clef | #47451 | CPDL | https://www.cpdl.org/wiki/index.php/Sicut_cervus_(Giovanni_Pierluigi_da_Palestrina) |
| `stille-nacht` | *Stille Nacht* (*Silent night, holy night*) — Franz Xaver Gruber (harm. C. H. Reinecke) | Multi-verse SATB carol (3 underlaid verses) | #67514 | CPDL | https://www.cpdl.org/wiki/index.php/Stille_Nacht_(Franz_Xaver_Gruber) |
| `locus-iste` | *Locus iste* — Anton Bruckner | Open-score SATB, Tenor octave-treble (`G2`/`8vb`) clef | #47921 | CPDL | https://www.cpdl.org/wiki/index.php/Locus_iste_(Anton_Bruckner) |

## Realistic Phone-Photo / Photocopy Variants

Generated locally from clean source PDFs via `tools/omr-bench/degrade_pdf.swift` (250 DPI rasterization, Gaussian blur radius `0.7`, slight rotation `1.2°`, warm gray photocopy paper background `0.93`, re-wrapped as PDF):

- `stille-nacht-photo/` (1 page)
- `abide-with-me-photo/` (2 pages)
- `locus-iste-photo/` (2 pages)
