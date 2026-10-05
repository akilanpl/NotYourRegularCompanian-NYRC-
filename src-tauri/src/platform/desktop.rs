//! Native desktop adapter. Only fixed programs and validated arguments are used.
use crate::commands::{validate_application, validate_web_url, DesktopActionError};
use std::process::Command;
fn require_supported(id: &str) -> Result<(), DesktopActionError> {
    if super::registry(std::env::consts::OS, false)
        .iter()
        .any(|c| c.id == id && c.status == super::CapabilityStatus::Supported)
    {
        Ok(())
    } else {
        Err(DesktopActionError::new(
            "unsupported_on_current_platform",
            "No verified desktop adapter for this operation",
        ))
    }
}
pub fn open_website(url: String) -> Result<(), DesktopActionError> {
    require_supported("web.open")?;
    validate_web_url(&url)?;
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let result = match std::env::var_os("WINDIR") {
        Some(windows_dir) => Command::new(
            std::path::PathBuf::from(windows_dir)
                .join("System32")
                .join("rundll32.exe"),
        )
        .args(["url.dll,FileProtocolHandler", &url])
        .status(),
        None => Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Windows directory is unavailable",
        )),
    };
    #[cfg(target_os = "linux")]
    let result = Command::new("/usr/bin/xdg-open").arg(&url).status();
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err(DesktopActionError::new(
            "open_failed",
            "Could not open website",
        )),
        Err(error) => Err(DesktopActionError::new("open_failed", error.to_string())),
    }
}

pub fn open_application(application: String) -> Result<(), DesktopActionError> {
    require_supported("app.launch")?;
    let app = validate_application(&application)?;
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").args(["-a", app]).status();
    #[cfg(not(target_os = "macos"))]
    let result: std::io::Result<std::process::ExitStatus> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Application aliases are supported on macOS only",
    ));
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err(DesktopActionError::new(
            "application_unavailable",
            "Configured application is unavailable",
        )),
        Err(error) => Err(DesktopActionError::new(
            "application_unavailable",
            error.to_string(),
        )),
    }
}

pub fn get_system_volume() -> Result<u8, DesktopActionError> {
    require_supported("system.volume.read")?;
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/osascript")
            .args(["-e", "output volume of (get volume settings)"])
            .output()
            .map_err(|error| DesktopActionError::new("volume_unavailable", error.to_string()))?;
        if !output.status.success() {
            return Err(DesktopActionError::new(
                "volume_unavailable",
                "Could not read system volume",
            ));
        }
        let value = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u8>()
            .map_err(|_| {
                DesktopActionError::new("volume_unavailable", "System returned an invalid volume")
            })?;
        return Ok(value.min(100));
    }
    #[cfg(not(target_os = "macos"))]
    Err(DesktopActionError::new(
        "unsupported_on_current_platform",
        "System volume control is supported on macOS only",
    ))
}

pub fn set_system_volume(volume: i32) -> Result<u8, DesktopActionError> {
    require_supported("system.volume.write")?;
    let volume = clamp_system_volume(volume);
    #[cfg(target_os = "macos")]
    {
        let script = format!("set volume output volume {volume}");
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .status()
            .map_err(|error| DesktopActionError::new("volume_unavailable", error.to_string()))?;
        if status.success() {
            return Ok(volume);
        }

        return Err(DesktopActionError::new(
            "volume_unavailable",
            "Could not set system volume",
        ));
    }
    #[cfg(not(target_os = "macos"))]
    Err(DesktopActionError::new(
        "unsupported_on_current_platform",
        "System volume control is supported on macOS only",
    ))
}

pub(crate) fn clamp_system_volume(volume: i32) -> u8 {
    volume.clamp(0, 100) as u8
}

pub fn set_system_mute(muted: bool) -> Result<bool, DesktopActionError> {
    require_supported("system.mute")?;
    #[cfg(target_os = "macos")]
    {
        let script = if muted {
            "set volume with output muted"
        } else {
            "set volume without output muted"
        };
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", script])
            .status()
            .map_err(|error| DesktopActionError::new("volume_unavailable", error.to_string()))?;
        if status.success() {
            return Ok(muted);
        }
        return Err(DesktopActionError::new(
            "volume_unavailable",
            "Could not change mute state",
        ));
    }
    #[cfg(not(target_os = "macos"))]
    Err(DesktopActionError::new(
        "unsupported_on_current_platform",
        "Mute control is supported on macOS only",
    ))
}
