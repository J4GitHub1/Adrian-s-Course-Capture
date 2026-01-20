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

// Content script - runs on each page AND each iframe
// Captures text and sends to background script for storage
// Manages UI elements (indicator, image dots, tab title)

(function() {
  // Prevent double-initialization
  if (window.accContentScriptLoaded) return;
  window.accContentScriptLoaded = true;

  const isTopFrame = (window === window.top);
  
  let isCapturing = false;
  let observer = null;
  let startTime = null;
  let statusIndicator = null;
  let originalTitle = null;
  let entryCount = 0;

  // Elements to ignore when extracting text
  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 
    'META', 'LINK', 'HEAD', 'TEMPLATE'
  ]);

  // Our own indicator ID to exclude
  const INDICATOR_ID = 'acc-capture-indicator';

  // Text limits
  const MIN_TEXT_LENGTH = 10;
  const MAX_TEXT_LENGTH = 100000;

  // Image save dot settings
  const IMG_DOT_SIZE = 20;
  const IMG_MIN_SIZE = 50;
  const IMG_EXTENSIONS = /\.(png|jpe?g)(\?.*)?$/i;
  let imageDotsAdded = new WeakSet();

  // Patterns that indicate code/CSS/technical noise
  const NOISE_PATTERNS = [
    /^#[\w-]+\s*\{/,
    /^\.[\w-]+\s*\{/,
    /^\@keyframes\s+/i,
    /^\@media\s*\(/i,
    /^\@font-face\s*\{/i,
    /box-sizing:\s*inherit/i,
    /font-family:\s*inherit/i,
    /-webkit-[\w-]+:/,
    /^\s*\{[\s\S]*\}\s*$/,
    /w-css-reset/i,
    /wistia_/i,
    /^\d+%\s*\{/,
    /opacity:\s*\d/,
    /animation:\s*[\w-]+/i,
    /transform:\s*\w+/i,
    /base64,/i,
    /data:application\//i,
    /data:image\//i,
    /unicode-range:\s*U\+/i,
    /font-feature-settings:/i,
    /src:\s*url\(/i,
  ];

  // Throttle control
  let pendingMutations = [];
  let processingScheduled = false;
  const THROTTLE_MS = 250;

  // Timer interval reference
  let timerInterval = null;

  // Local deduplication (within this page load)
  let seenText = new Set();

  // ============================================================
  // TAB TITLE MANAGEMENT
  // ============================================================

  const RECORDING_EMOJI = '🔴 ';

  function setRecordingTitle() {
    if (!isTopFrame) return;
    if (originalTitle === null) {
      originalTitle = document.title;
    }
    if (!document.title.startsWith(RECORDING_EMOJI)) {
      document.title = RECORDING_EMOJI + document.title;
    }
  }

  function restoreTitle() {
    if (!isTopFrame) return;
    if (originalTitle !== null) {
      document.title = originalTitle;
      originalTitle = null;
    } else if (document.title.startsWith(RECORDING_EMOJI)) {
      document.title = document.title.substring(RECORDING_EMOJI.length);
    }
  }

  // Watch for title changes and re-add emoji
  let titleObserver = null;
  function startTitleObserver() {
    if (!isTopFrame) return;
    
    const titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver = new MutationObserver(() => {
        if (isCapturing && !document.title.startsWith(RECORDING_EMOJI)) {
          document.title = RECORDING_EMOJI + document.title;
        }
      });
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }

  function stopTitleObserver() {
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }
  }

  // ============================================================
  // VISUAL INDICATOR
  // ============================================================

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function updateTimer() {
    const timerEl = document.getElementById('acc-timer');
    if (timerEl && startTime) {
      const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
      timerEl.textContent = formatTime(elapsed);
    }
  }

  function createIndicator() {
    if (!isTopFrame) return;
    
    statusIndicator = document.createElement('div');
    statusIndicator.id = INDICATOR_ID;
    statusIndicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: linear-gradient(135deg, #e74c3c, #c0392b);
      color: white;
      padding: 10px 16px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      user-select: none;
      cursor: grab;
    `;
    statusIndicator.innerHTML = `
      <span style="width: 10px; height: 10px; background: white; border-radius: 50%; animation: accPulse 1s infinite;"></span>
      <span style="font-weight: 700;">ACC</span>
      <span id="acc-capture-count" style="opacity: 0.9; min-width: 24px;">${entryCount}</span>
      <span style="opacity: 0.7;">|</span>
      <span id="acc-timer" style="opacity: 0.9; font-variant-numeric: tabular-nums;">00:00</span>
    `;
    
    const style = document.createElement('style');
    style.id = 'acc-pulse-style';
    style.textContent = `
      @keyframes accPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.9); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(statusIndicator);

    timerInterval = setInterval(updateTimer, 1000);

    // Make draggable
    let isDragging = false;
    let offsetX, offsetY;

    statusIndicator.addEventListener('mousedown', (e) => {
      isDragging = true;
      statusIndicator.style.cursor = 'grabbing';
      offsetX = e.clientX - statusIndicator.getBoundingClientRect().left;
      offsetY = e.clientY - statusIndicator.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      const maxX = window.innerWidth - statusIndicator.offsetWidth;
      const maxY = window.innerHeight - statusIndicator.offsetHeight;
      statusIndicator.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      statusIndicator.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
      statusIndicator.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        statusIndicator.style.cursor = 'grab';
      }
    });
  }

  function removeIndicator() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (statusIndicator) {
      statusIndicator.remove();
      statusIndicator = null;
    }
    const style = document.getElementById('acc-pulse-style');
    if (style) style.remove();
  }

  function updateCount(count) {
    entryCount = count;
    const counter = document.getElementById('acc-capture-count');
    if (counter) {
      counter.textContent = count;
    }
  }

  // ============================================================
  // IFRAME BORDER FLASH SYSTEM
  // ============================================================
  
  const MAX_IFRAME_DEPTH = 10;
  const FLASH_DURATION = 2000;
  const FLASH_COOLDOWN = 500;
  const BORDER_COLOR = '#e74c3c';
  const BORDER_WIDTH = 5;
  
  let iframeFlashCooldowns = new WeakMap();
  
  function findIframeForWindow(sourceWindow) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        if (iframe.contentWindow === sourceWindow) {
          return iframe;
        }
      } catch (e) {}
    }
    return null;
  }
  
  function createBorderOverlay(iframe) {
    const rect = iframe.getBoundingClientRect();
    
    const overlay = document.createElement('div');
    overlay.className = 'acc-iframe-flash-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: ${BORDER_WIDTH}px solid ${BORDER_COLOR};
      box-sizing: border-box;
      pointer-events: none;
      z-index: 2147483647;
      background: transparent;
      opacity: 1;
      transition: opacity ${FLASH_DURATION}ms ease-out;
    `;
    
    document.body.appendChild(overlay);
    
    requestAnimationFrame(() => {
      overlay.style.opacity = '0';
    });
    
    return overlay;
  }
  
  function flashIframeBorder(iframe) {
    if (!iframe || !isCapturing) return;
    
    const lastFlash = iframeFlashCooldowns.get(iframe) || 0;
    const now = Date.now();
    if (now - lastFlash < FLASH_COOLDOWN) return;
    iframeFlashCooldowns.set(iframe, now);
    
    const overlay = createBorderOverlay(iframe);
    
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.remove();
      }
    }, FLASH_DURATION);
  }
  
  function handleChildFlashMessage(sourceWindow, depth) {
    if (depth > MAX_IFRAME_DEPTH) return;
    
    const iframe = findIframeForWindow(sourceWindow);
    if (iframe) {
      flashIframeBorder(iframe);
    }
    
    if (!isTopFrame) {
      try {
        window.parent.postMessage({
          type: 'ACC_FLASH_IFRAME',
          depth: depth + 1
        }, '*');
      } catch (e) {}
    }
  }
  
  function triggerFlashUpward() {
    if (isTopFrame) return;
    
    try {
      window.parent.postMessage({
        type: 'ACC_FLASH_IFRAME',
        depth: 1
      }, '*');
    } catch (e) {}
  }

  // ============================================================
  // IMAGE SAVE DOT SYSTEM
  // ============================================================

  function shouldAddDot(img) {
    if (!img || !img.src) return false;
    if (imageDotsAdded.has(img)) return false;
    if (!IMG_EXTENSIONS.test(img.src)) return false;
    if (img.naturalWidth < IMG_MIN_SIZE || img.naturalHeight < IMG_MIN_SIZE) return false;
    if (img.width < IMG_MIN_SIZE || img.height < IMG_MIN_SIZE) return false;
    return true;
  }

  function getImageTimestamp() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}-${mm}-${ss}`;
  }

  function createImageDot(img) {
    const dot = document.createElement('div');
    dot.className = 'acc-image-save-dot';
    dot.title = 'Save image (ACC)';
    dot.style.cssText = `
      position: absolute;
      top: 5px;
      right: 5px;
      width: ${IMG_DOT_SIZE}px;
      height: ${IMG_DOT_SIZE}px;
      background: #e74c3c;
      border: 2px solid white;
      border-radius: 50%;
      cursor: pointer;
      z-index: 2147483646;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      opacity: 0;
      transition: opacity 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    dot.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="white" style="pointer-events: none;">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
    </svg>`;

    dot.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const timestamp = getImageTimestamp();
      const extension = img.src.match(/\.(png|jpe?g)/i)?.[1]?.toLowerCase() || 'png';
      const ext = extension === 'jpeg' ? 'jpg' : extension;
      
      try {
        browser.runtime.sendMessage({
          action: 'saveImage',
          url: img.src,
          filename: `img-${timestamp}.${ext}`
        });
        
        dot.style.background = '#27ae60';
        setTimeout(() => {
          dot.style.background = '#e74c3c';
        }, 500);
        
      } catch (err) {
        console.error('[ACC] Failed to save image:', err);
        dot.style.background = '#95a5a6';
        setTimeout(() => {
          dot.style.background = '#e74c3c';
        }, 500);
      }
    });

    return dot;
  }

  function addDotToImage(img) {
    if (!shouldAddDot(img)) return;
    
    imageDotsAdded.add(img);
    
    const parent = img.parentElement;
    if (!parent) return;
    
    let wrapper;
    if (getComputedStyle(parent).position === 'static') {
      wrapper = document.createElement('span');
      wrapper.className = 'acc-image-wrapper';
      wrapper.style.cssText = `position: relative; display: inline-block;`;
      img.parentNode.insertBefore(wrapper, img);
      wrapper.appendChild(img);
    } else {
      wrapper = parent;
    }
    
    const dot = createImageDot(img);
    wrapper.appendChild(dot);
    
    const showDot = () => { dot.style.opacity = '1'; };
    const hideDot = () => { dot.style.opacity = '0'; };
    
    wrapper.addEventListener('mouseenter', showDot);
    wrapper.addEventListener('mouseleave', hideDot);
  }

  function scanForImages() {
    if (!isCapturing || !isTopFrame) return;
    
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      if (img.complete) {
        addDotToImage(img);
      } else {
        img.addEventListener('load', () => addDotToImage(img), { once: true });
      }
    });
  }

  function removeAllImageDots() {
    document.querySelectorAll('.acc-image-save-dot').forEach(dot => dot.remove());
    
    document.querySelectorAll('.acc-image-wrapper').forEach(wrapper => {
      const img = wrapper.querySelector('img');
      if (img && wrapper.parentNode) {
        wrapper.parentNode.insertBefore(img, wrapper);
        wrapper.remove();
      }
    });
    
    imageDotsAdded = new WeakSet();
  }

  // ============================================================
  // TEXT EXTRACTION AND PROCESSING
  // ============================================================

  function extractText(element) {
    if (!element || IGNORED_TAGS.has(element.tagName)) {
      return '';
    }

    if (element.id === INDICATOR_ID) {
      return '';
    }
    
    try {
      if (element.closest && element.closest('#' + INDICATOR_ID)) {
        return '';
      }
    } catch (e) {}

    let text = '';
    
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        text += extractText(node);
      }
    }

    return text;
  }

  function cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function getFrameId() {
    if (isTopFrame) return 'main';
    try {
      const path = window.location.pathname;
      const filename = path.split('/').pop() || 'frame';
      return filename.replace(/\.[^.]+$/, '');
    } catch (e) {
      return 'frame';
    }
  }

  function processText(text, source = 'mutation') {
    let cleaned = cleanText(text);
    
    // Truncate if exceeds maximum length
    if (cleaned.length > MAX_TEXT_LENGTH) {
      cleaned = cleaned.substring(0, MAX_TEXT_LENGTH) + ' [too long to capture]';
    }
    
    if (cleaned.length < MIN_TEXT_LENGTH) {
      return;
    }

    // Filter out indicator updates
    if (cleaned.match(/^\d+$/) || 
        cleaned.match(/^\d{2}:\d{2}$/) ||
        cleaned.match(/^ACC\s*\d*/) ||
        cleaned === 'ACC') {
      return;
    }

    // Filter noise patterns
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(cleaned)) {
        return;
      }
    }

    // Filter if mostly CSS
    const specialChars = (cleaned.match(/[{};:]/g) || []).length;
    const totalChars = cleaned.length;
    if (specialChars / totalChars > 0.1) {
      return;
    }

    // Local deduplication
    const hash = cleaned.substring(0, 100) + cleaned.length;
    if (seenText.has(hash)) {
      return;
    }
    seenText.add(hash);

    const timestamp = new Date().toISOString();
    const frameId = getFrameId();
    
    const entry = {
      timestamp,
      source,
      frameId,
      url: window.location.href,
      text: cleaned
    };

    // Send to background script
    browser.runtime.sendMessage({
      action: 'captureText',
      entry: entry
    }).catch(() => {});

    // Trigger flash animation for iframes
    if (!isTopFrame) {
      triggerFlashUpward();
    }
  }

  // ============================================================
  // MUTATION OBSERVER
  // ============================================================

  function captureInitialContent() {
    if (document.body) {
      const text = extractText(document.body);
      if (text) {
        processText(text, 'initial');
      }
    }
  }

  function processPendingMutations() {
    processingScheduled = false;
    
    if (pendingMutations.length === 0) return;
    
    const mutations = pendingMutations;
    pendingMutations = [];
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const text = extractText(node);
          if (text) {
            processText(text, 'added');
          }
          
          // Scan for images in added elements (top frame only)
          if (isTopFrame && isCapturing) {
            if (node.tagName === 'IMG') {
              if (node.complete) {
                addDotToImage(node);
              } else {
                node.addEventListener('load', () => addDotToImage(node), { once: true });
              }
            } else if (node.querySelectorAll) {
              node.querySelectorAll('img').forEach(img => {
                if (img.complete) {
                  addDotToImage(img);
                } else {
                  img.addEventListener('load', () => addDotToImage(img), { once: true });
                }
              });
            }
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (text) {
            processText(text, 'text-node');
          }
        }
      }
      
      if (mutation.type === 'characterData' && mutation.target) {
        const text = mutation.target.textContent;
        if (text) {
          processText(text, 'modified');
        }
      }
    }
  }

  function startObserver() {
    if (!document.body) {
      const bodyWaiter = new MutationObserver(() => {
        if (document.body) {
          bodyWaiter.disconnect();
          captureInitialContent();
          startObserverOnBody();
        }
      });
      bodyWaiter.observe(document.documentElement, { childList: true });
      return;
    }
    
    captureInitialContent();
    startObserverOnBody();
  }

  function startObserverOnBody() {
    observer = new MutationObserver((mutations) => {
      pendingMutations.push(...mutations);
      
      if (!processingScheduled) {
        processingScheduled = true;
        setTimeout(processPendingMutations, THROTTLE_MS);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingMutations = [];
    processingScheduled = false;
  }

  // ============================================================
  // START / STOP CAPTURE
  // ============================================================

  function startCapture(startTimeISO, initialCount = 0) {
    if (isCapturing) return;
    
    isCapturing = true;
    startTime = startTimeISO ? new Date(startTimeISO) : new Date();
    entryCount = initialCount;
    seenText.clear();

    if (isTopFrame) {
      createIndicator();
      setRecordingTitle();
      startTitleObserver();
      scanForImages();
    }
    
    startObserver();
    console.log(`[ACC][${getFrameId()}] Capture started`);
  }

  function stopCapture() {
    if (!isCapturing) return;
    
    isCapturing = false;
    stopObserver();

    if (isTopFrame) {
      removeIndicator();
      removeAllImageDots();
      stopTitleObserver();
      restoreTitle();
    }
    
    seenText.clear();
    console.log(`[ACC][${getFrameId()}] Capture stopped`);
  }

  // ============================================================
  // MESSAGE HANDLING
  // ============================================================

  // Listen for messages from background script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start') {
      startCapture(message.startTime, message.entryCount || 0);
    } else if (message.action === 'stop') {
      stopCapture();
    } else if (message.action === 'updateCount') {
      updateCount(message.count);
    } else if (message.action === 'autoStopped') {
      stopCapture();
      if (isTopFrame) {
        // Show notification to user
        alert(`Adrian's Course Capture: Recording auto-stopped.\nReason: ${message.reason}\n\nYour capture has been saved.`);
      }
    }
  });

  // Listen for flash messages from child iframes
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ACC_FLASH_IFRAME' && isCapturing) {
      handleChildFlashMessage(event.source, event.data.depth || 1);
    }
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  // Check if we should be capturing (for page navigation scenarios)
  // Retry a few times since background script might not be ready immediately
  function checkAndResumeCapture(attempt = 1) {
    if (isCapturing) return; // Already started by background message
    
    browser.runtime.sendMessage({ action: 'getState' }).then((state) => {
      if (state && state.isCapturing && !isCapturing) {
        console.log(`[ACC] Resuming capture after navigation (attempt ${attempt})`);
        startCapture(state.startTime, state.entryCount);
      }
    }).catch(() => {
      // Background script not ready, retry
      if (attempt < 3) {
        setTimeout(() => checkAndResumeCapture(attempt + 1), 100 * attempt);
      }
    });
  }
  
  // Initial check
  checkAndResumeCapture();

  console.log(`[ACC][${getFrameId()}] Content script loaded`);
})();
