# Magic Hour production ledger

The recruiter site ships with an original Magic Hour media layer. Product UI, evidence states, session codes, and all readable text remain live HTML so the generated sets never become the source of truth.

## Shipped stills

- `assets/generated/hero-desk.jpeg`: centered iMac and walnut desk hero plate.
- `assets/generated/finish-{obsidian,walnut,bone,steel}.jpeg`: the four Command Center finish environments.
- `assets/generated/candidate-room.jpeg`: private candidate workspace.
- `assets/generated/vault.jpeg`: evidence Vault corridor.
- `assets/generated/privacy-room.jpeg`: sealed glass privacy chamber.
- `assets/generated/evidence.jpeg`: glass evidence-ledger macro.
- `assets/generated/human-review.jpeg`: hiring-team review scene.
- `assets/generated/footer-void.jpeg`: closing architectural void.

Sixty 2K Seedream v4 candidates were generated across fifteen four-image batches. The shipped files are the strongest composition from each relevant batch.

## Shipped motion

The seven H.264 files in `assets/generated/video/` form one desktop scroll-flight:

1. Desk arrival
2. Screen threshold
3. Signal surface
4. Vault flight
5. Privacy chamber
6. Review surface
7. Verified exit

Five clips are eight-second Seedance 2.0 renders. Two four-second product-surface clips replaced drafts rejected by automated moderation. The final still and motion board represents 16,824 Magic Hour credits; rejected drafts are not shipped.

## Runtime rules

- Desktop uses exact scroll seeking when the host supports media byte ranges.
- A muted active-leg playback fallback keeps motion working on simpler static hosts.
- Mobile, reduced-motion, and Save-Data clients receive generated stills instead of the seven video downloads.
- Videos are `preload="none"` in markup and receive their sources only when the cinematic path is enabled.
