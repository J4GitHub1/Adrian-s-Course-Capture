# Adrian's Course Capture

A Firefox browser extension that captures and saves text content from web pages while browsing. Perfect for taking notes from online courses, documentation, and articles.

## Features

- **Text Capture** - Automatically records all visible text as you browse
- **Multi-frame Support** - Captures content from iframes and embedded frames
- **Image Saving** - Quick-save images with a single click
- **Session Recording** - Tracks timestamps, duration, and entry counts
- **Smart Filtering** - Automatically filters out CSS, scripts, and noise
- **Visual Feedback** - On-screen indicator showing capture status

## Installation

### From Firefox Add-ons (recommended)
*Coming soon*

### Manual Installation (for development)
1. Download or clone this repository
2. Open Firefox and go to `about:debugging`
3. Click "This Firefox" in the sidebar
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from this folder

## Usage

1. **Start Recording**: Press `Ctrl+Shift+L` (Windows/Linux) or `Cmd+Shift+L` (Mac), or click the extension icon and press "Start Recording"
2. **Browse**: Navigate through web pages as normal - text will be captured automatically
3. **Stop Recording**: Press the same shortcut again or click "Stop Recording"
4. **Save**: A text file will be downloaded with all captured content

## Output Format

Captures are saved to dated folders (`ACC-YYYY-MM-DD/`) with timestamped filenames:

```
════════════════════════════════════════════════════════════
ADRIAN'S COURSE CAPTURE
════════════════════════════════════════════════════════════

Started:  2025-01-20T15:30:45.123Z
Ended:    2025-01-20T15:32:10.456Z
Duration: 85 seconds
Entries:  42
Size:     512.3 KB

────────────────────────────────────────────────────────────

[001] +0s | main | https://example.com/course
Captured text content here...
```

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Toggle Recording | `Ctrl+Shift+L` | `Cmd+Shift+L` |

## Permissions

- `<all_urls>` - Required to capture text from any website
- `tabs` - Required to track the active tab during capture
- `downloads` - Required to save captured content as files

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Author

Adrian Brozek
