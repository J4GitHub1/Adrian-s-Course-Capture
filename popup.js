/*
 * Copyright (C) 2025 Adrian Brozek
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 * By using this AddOn, you commit to being a generally pleasant human being. 

 */

// Popup script - handles UI interactions

const recordBtn = document.getElementById('recordBtn');
const recordText = document.getElementById('recordText');
const keybindText = document.getElementById('keybindText');

// Detect platform and update keybind display
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
keybindText.textContent = isMac ? 'Cmd+Shift+L' : 'Ctrl+Shift+L';

// Check current capture state on popup open
browser.runtime.sendMessage({ action: "getState" }).then((state) => {
  updateUI(state.isCapturing);
}).catch(() => {
  updateUI(false);
});

// Listen for state changes from background script
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "stateChanged") {
    updateUI(message.isCapturing);
  }
});

// Update UI based on capture state
function updateUI(isCapturing) {
  if (isCapturing) {
    recordBtn.classList.add('recording');
    recordText.textContent = 'Stop Recording';
  } else {
    recordBtn.classList.remove('recording');
    recordText.textContent = 'Start Recording';
  }
}

// Handle record button click
recordBtn.addEventListener('click', async () => {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });

    if (tabs[0]) {
      browser.runtime.sendMessage({
        action: "toggleCapture",
        tabId: tabs[0].id
      });
    }
  } finally {
    // Always close popup after click
    window.close();
  }
});
