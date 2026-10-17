# Micro motion 0.1.2

The existing Figma layout and static surfaces are unchanged.

- Play control press: scale 0.965, 85 ms down / 210 ms return.
- Library rows: scale 0.992; smaller text actions use 0.985.
- Play/pause state: interruptible 150 ms crossfade, drawn without layout changes.
- Screen entry: alpha 0.94 to 1, 2 dp to 0, 220 ms; replaces the earlier conspicuous 0.35 fade and larger translation.
- Ease-out cubic curve, no spring or bounce. Animations use Android's frame scheduler.
- Respects app motion preference and system animator enablement. Cancelled gestures and recycled/detached rows reset their transforms. Playback actions do not wait for an animation.

Validation: debug build, unit tests and lint passed. Emulator smoke check covered library selection and repeated play/pause taps without a crash. Physical 120 Hz performance is not measured.
