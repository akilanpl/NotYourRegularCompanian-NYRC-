# Platform support

Build status and native acceptance are separate. The final validation report records actual CI run links and installation evidence.

| Capability | macOS ARM64 | macOS Intel | Windows x64 | Linux x64 |
|---|---|---|---|---|
| Tauri package target | App ZIP | App ZIP | NSIS EXE | Debian DEB |
| Local simulation, timer, SQLite, Pocket, scheduler | Implemented | Implemented | Implemented | Implemented |
| Clipboard, notification, OS secret store | Runtime/OS access required | Runtime/OS access required | Runtime/OS access required | Desktop secret service/OS access required |
| Volume, mute, allowlisted app/web open | macOS adapter | macOS adapter | Explicitly unsupported | Explicitly unsupported |
| System media/focus controls | Unsupported | Unsupported | Unsupported | Unsupported |
| Virtual Body / loopback protocol | Implemented | Implemented | Implemented | Implemented |
| Real ESP32 | Hardware validation required | Hardware validation required | Hardware validation required | Hardware validation required |
| Live cloud / Google | Credentials required | Credentials required | Credentials required | Credentials required |

Only architectures listed by the actual build target are labeled in artifact names. No universal macOS or ARM Windows/Linux claim is made. Windows/Linux GUI install, tray, transparency, notifications and permission-sheet acceptance require a native environment; successful CI is BUILD ONLY until those tests are recorded. Linux DEB targets Debian/Ubuntu with WebKitGTK 4.1, GTK 3 and appindicator dependencies; other distributions require a source build and native validation.

macOS candidates are ad hoc signed locally and not notarized. CI packages are explicitly unsigned unless the optional signing path completes its verification. Intel desktop behavior is not inferred from ARM64 testing.
