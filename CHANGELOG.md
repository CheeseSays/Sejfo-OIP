# Changelog

Notable changes to the editor, the desktop app, the part SDK and the project format. A breaking
change can land in any release (see the README's
[Project Status](README.md#project-status)); breaking changes are listed first and marked as such.

## 0.1.0 (Unreleased)

The first public source release. The [README](README.md#features) lists what it includes. It also includes:

- A desktop app for Windows (a signed installer) and Linux (a `.deb` and an AppImage).
- Project tests: JSON regression tests for a project's control logic (`npm run test-project`).
- An external PLC link over SLMP (MELSEC 3E binary frames): a Q, L, iQ-R or iQ-F CPU reads and
  writes the scene's tags as its own devices (`M10`, `Y0`, `D100`, `B1A`, `W10`, `TN5`), with a
  connection guide ([guides/slmp/](guides/slmp/)).
- **PLC connections…** beside a controller on a TwinCAT PLC over ADS: the PLC's variables, read from the runtime and
  grouped by program or list, beside the scene's machines and their tag fields. Picking a field and a variable wires
  them, writing the name into the field as the Inspector's Comms group would.

Earlier development history is not part of this repository.
