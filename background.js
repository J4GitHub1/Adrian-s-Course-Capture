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

// Background script - handles commands, state management, and downloads
// State now persists here across page navigations

// State management
let isCapturing = false;
let captureStartTime = null;
let capturedText = [];
let seenHashes = new Set();
let activeTabId = null;

// Limits
const MAX_CAPTURE_SIZE = 10 * 1024 * 1024; // 10MB
let currentCaptureSize = 0;

// Get today's date formatted as YYYY-MM-DD
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Generate filename with timestamp
function generateFilename() {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const folderName = `ACC-${getTodayDate()}`;
  return `${folderName}/${time}_capture.txt`;
}

// Generate image filename in the same folder
function generateImageFilename(originalFilename) {
  const folderName = `ACC-${getTodayDate()}`;
  return `${folderName}/${originalFilename}`;
}

// Format captured text for output
function formatOutput() {
  const endTime = new Date();
  
  const header = [
    '═'.repeat(60),
    "ADRIAN'S COURSE CAPTURE",
    '═'.repeat(60),
    '',
    `Started:  ${captureStartTime.toISOString()}`,
    `Ended:    ${endTime.toISOString()}`,
    `Duration: ${Math.round((endTime - captureStartTime) / 1000)} seconds`,
    `Entries:  ${capturedText.length}`,
    `Size:     ${(currentCaptureSize / 1024).toFixed(1)} KB`,
    '',
    '─'.repeat(60),
    ''
  ].join('\n');

  const body = capturedText.map((entry, i) => {
    const timeOffset = Math.round((new Date(entry.timestamp) - captureStartTime) / 1000);
    return [
      `[${String(i + 1).padStart(3, '0')}] +${timeOffset}s | ${entry.frameId} | ${entry.url}`,
      entry.text,
      ''
    ].join('\n');
  }).join('\n');

  return header + body;
}

// Save the capture to file
function saveCapture() {
  const content = formatOutput();
  const filename = generateFilename();
  
  if (content && capturedText.length > 0) {
    console.log("[ACC] Preparing to save", capturedText.length, "entries...");
    
    try {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      
      console.log("[ACC] Blob URL created, initiating download...");
      
      browser.downloads.download({
        url: url,
        filename: filename,
        saveAs: true,
        conflictAction: "uniquify"
      }).then((downloadId) => {
        console.log("[ACC] Download started, ID:", downloadId);
        // Revoke after a delay to ensure download completes
        setTimeout(() => {
          URL.revokeObjectURL(url);
          console.log("[ACC] Blob URL revoked");
        }, 60000); // Keep URL valid for 60 seconds
      }).catch((error) => {
        console.error("[ACC] Download failed:", error);
        URL.revokeObjectURL(url);
      });
    } catch (e) {
      console.error("[ACC] Error creating download:", e);
    }
  } else {
    console.log("[ACC] No content captured, skipping save.");
  }
}

// Start capture on a tab
async function startCapture(tabId) {
  if (isCapturing) return;
  
  isCapturing = true;
  captureStartTime = new Date();
  capturedText = [];
  seenHashes.clear();
  currentCaptureSize = 0;
  activeTabId = tabId;
  
  // Update badge
  browser.browserAction.setBadgeText({ text: "REC", tabId: tabId });
  browser.browserAction.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });

  // Notify popup of state change
  browser.runtime.sendMessage({ action: "stateChanged", isCapturing: true }).catch(() => {});

  // Notify content script to start (it will set up UI and observers)
  try {
    await browser.tabs.sendMessage(tabId, { 
      action: "start",
      startTime: captureStartTime.toISOString()
    });
  } catch (e) {
    // Content script might not be ready, that's okay - it will check state on load
    console.log("[ACC] Could not reach content script, will initialize on page load");
  }
  
  console.log("[ACC] Capture started on tab", tabId);
}

// Stop capture
async function stopCapture() {
  if (!isCapturing) return;
  
  const wasCapturing = isCapturing;
  isCapturing = false;

  // Notify popup of state change
  browser.runtime.sendMessage({ action: "stateChanged", isCapturing: false }).catch(() => {});

  // Update badge
  if (activeTabId) {
    browser.browserAction.setBadgeText({ text: "", tabId: activeTabId });
  }

  // Notify content script to clean up UI
  if (activeTabId) {
    try {
      await browser.tabs.sendMessage(activeTabId, { action: "stop" });
    } catch (e) {
      // Tab might be closed
    }
  }
  
  // Save the captured content
  if (wasCapturing && capturedText.length > 0) {
    saveCapture();
  }
  
  console.log(`[ACC] Capture stopped. ${capturedText.length} entries, ${(currentCaptureSize / 1024).toFixed(1)} KB`);
  
  // Reset state
  capturedText = [];
  seenHashes.clear();
  currentCaptureSize = 0;
  activeTabId = null;
}

// Auto-stop due to size limit
async function autoStopCapture(reason) {
  console.log(`[ACC] Auto-stopping capture: ${reason}`);
  
  // Notify content script about auto-stop
  if (activeTabId) {
    try {
      await browser.tabs.sendMessage(activeTabId, { 
        action: "autoStopped",
        reason: reason
      });
    } catch (e) {
      // Tab might be closed
    }
  }
  
  await stopCapture();
}

// Listen for keyboard shortcut
browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-capture") {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) {
        if (!isCapturing) {
          startCapture(tabs[0].id);
        } else {
          stopCapture();
        }
      }
    });
  }
});

// Listen for messages from content script and popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Popup or content script checking capture state
  if (message.action === "getState") {
    // If from popup (no sender.tab), just return global state
    if (!sender.tab) {
      sendResponse({
        isCapturing: isCapturing,
        startTime: captureStartTime ? captureStartTime.toISOString() : null,
        entryCount: capturedText.length
      });
    } else {
      // From content script - check if this tab is the active one
      sendResponse({
        isCapturing: isCapturing && sender.tab.id === activeTabId,
        startTime: captureStartTime ? captureStartTime.toISOString() : null,
        entryCount: capturedText.length
      });
    }
    return true; // Keep channel open for async response
  }

  // Popup requesting toggle capture
  if (message.action === "toggleCapture") {
    const tabId = message.tabId;
    if (!isCapturing) {
      startCapture(tabId);
    } else {
      stopCapture();
    }
    return true;
  }
  
  // Content script sending captured text
  if (message.action === "captureText") {
    if (!isCapturing) return;
    if (!sender.tab || sender.tab.id !== activeTabId) return;
    
    const entry = message.entry;
    
    // Deduplicate
    const hash = entry.text.substring(0, 100) + entry.text.length;
    if (seenHashes.has(hash)) return;
    seenHashes.add(hash);
    
    // Check size limit
    const entrySize = entry.text.length * 2; // Rough UTF-16 estimate
    if (currentCaptureSize + entrySize > MAX_CAPTURE_SIZE) {
      autoStopCapture(`Size limit reached (${(MAX_CAPTURE_SIZE / 1024 / 1024).toFixed(0)}MB)`);
      return;
    }
    
    currentCaptureSize += entrySize;
    capturedText.push(entry);
    
    // Send updated count back to content script for display
    if (sender.tab) {
      browser.tabs.sendMessage(sender.tab.id, {
        action: "updateCount",
        count: capturedText.length
      }).catch(() => {});
    }
  }
  
  // Save image request
  if (message.action === "saveImage") {
    const imageUrl = message.url;
    const filename = generateImageFilename(message.filename);
    
    browser.downloads.download({
      url: imageUrl,
      filename: filename,
      saveAs: false,
      conflictAction: "uniquify"
    }).then((downloadId) => {
      console.log("[ACC] Saved image:", filename);
    }).catch((error) => {
      console.error("[ACC] Image download failed:", error);
    });
  }
});

// Handle tab updates (page navigation within the same tab)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isCapturing || tabId !== activeTabId) return;
  
  // Log URL changes
  if (changeInfo.url) {
    console.log("[ACC] Tab navigating to:", changeInfo.url);
  }
  
  // When page finishes loading, re-initialize content script
  if (changeInfo.status === 'complete') {
    console.log("[ACC] Page loaded in active capture tab:", tab.url);
    console.log("[ACC] Re-initializing content script...");
    
    // Update badge immediately (gets cleared on navigation)
    browser.browserAction.setBadgeText({ text: "REC", tabId: tabId });
    browser.browserAction.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
    
    // Try to reach content script with retries
    // Cross-domain navigations need more time for content script to initialize
    const sendStartMessage = (attempt = 1) => {
      browser.tabs.sendMessage(tabId, {
        action: "start",
        startTime: captureStartTime.toISOString(),
        entryCount: capturedText.length
      }).then(() => {
        console.log(`[ACC] Content script initialized on ${tab.url} (attempt ${attempt})`);
      }).catch((e) => {
        console.log(`[ACC] Attempt ${attempt} failed:`, e.message || e);
        if (attempt < 10) {
          // Retry with increasing delay, more attempts for cross-domain
          const delay = Math.min(100 * Math.pow(1.5, attempt - 1), 1000);
          console.log(`[ACC] Retry ${attempt}/10 in ${Math.round(delay)}ms...`);
          setTimeout(() => sendStartMessage(attempt + 1), delay);
        } else {
          console.log("[ACC] Could not reach content script after 10 attempts");
          console.log("[ACC] The content script may not be injected on this page");
        }
      });
    };
    
    // Start first attempt after brief delay
    setTimeout(() => sendStartMessage(1), 100);
  }
});

// Handle tab close
browser.tabs.onRemoved.addListener((tabId) => {
  if (isCapturing && tabId === activeTabId) {
    console.log("[ACC] Active capture tab closed, stopping capture");
    stopCapture();
  }
});

// Update badge when switching tabs (just visual indicator)
browser.tabs.onActivated.addListener((activeInfo) => {
  if (isCapturing && activeInfo.tabId === activeTabId) {
    browser.browserAction.setBadgeText({ text: "REC", tabId: activeInfo.tabId });
    browser.browserAction.setBadgeBackgroundColor({ color: "#e74c3c", tabId: activeInfo.tabId });
  } else {
    browser.browserAction.setBadgeText({ text: "", tabId: activeInfo.tabId });
  }
});

console.log("[ACC] Background script loaded.");
