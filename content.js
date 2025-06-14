let isEffectivelyRecording = false; // Renamed to clarify its purpose

// Check recording state from background on load
chrome.runtime.sendMessage({ action: 'checkRecordingState' }, (response) => {
    if (chrome.runtime.lastError) {
        console.error("[Content] Error checking recording state:", chrome.runtime.lastError.message);
        return;
    }
    if (response && response.isRecording !== undefined && response.isPaused !== undefined) {
        isEffectivelyRecording = response.isRecording && !response.isPaused;
        console.log("[Content] Initial recording state: isRecording=", response.isRecording, "isPaused=", response.isPaused, "Effective=", isEffectivelyRecording);
        
        if (isEffectivelyRecording) {
            
            logEvent('pageload', {
                url: window.location.href,
                title: document.title
            });
            // If effectively recording, attach window scroll listener
            window.addEventListener('scroll', handleWindowScroll, { passive: true });
            attachGenericElementScrollListeners(); // Attach to other scrollable elements
            if (document.body) { // Start observer if body exists
                genericElementScrollObserver.observe(document.body, { childList: true, subtree: true });
            } else { // Otherwise, wait for DOMContentLoaded
                document.addEventListener('DOMContentLoaded', () => {
                    if (document.body) genericElementScrollObserver.observe(document.body, { childList: true, subtree: true });
                });
            }
        } else {
            window.removeEventListener('scroll', handleWindowScroll); // Ensure it's removed if not effectively recording
        }
    } else {
        // If response is not as expected, or missing, isEffectivelyRecording remains false (its initial value).
        // Log this situation for easier debugging, as it's a primary reason why no events would be recorded.
        console.warn("[Content] Initial recording state response from background was invalid or incomplete. Response:", response, ". Effective recording state remains:", isEffectivelyRecording);
        // Ensure listeners that might depend on this state are not active/are cleaned up.
        window.removeEventListener('scroll', handleWindowScroll);
        cleanupGenericElementScrollListeners(); // Ensure generic scroll listeners are cleaned up
        if (genericElementScrollObserver) genericElementScrollObserver.disconnect(); // Ensure observer is disconnected
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Content] Received message:", message);

    if (message.action === 'updateRecordingState') {
        const newEffectiveState = message.isRecording && !message.isPaused;
        const oldEffectiveState = isEffectivelyRecording;
        
        if (isEffectivelyRecording !== newEffectiveState) {
            isEffectivelyRecording = newEffectiveState;
            console.log(`[Content] Effective recording state updated: ${isEffectivelyRecording}. (isRecording=${message.isRecording}, isPaused=${message.isPaused})`);

            // Manage scroll listeners based on effective recording state
            if (isEffectivelyRecording) {
                window.addEventListener('scroll', handleWindowScroll, { passive: true });
                attachGenericElementScrollListeners(); // Discover and attach to elements
                if (genericElementScrollObserver && document.body) genericElementScrollObserver.observe(document.body, { childList: true, subtree: true });
            } else {
                window.removeEventListener('scroll', handleWindowScroll);
                if (windowScrollDebounceTimeout) { // Clear any pending window scroll log
                    clearTimeout(windowScrollDebounceTimeout);
                    windowScrollDebounceTimeout = null;
                }
                cleanupGenericElementScrollListeners(); // Remove listeners from elements
                if (genericElementScrollObserver) genericElementScrollObserver.disconnect();
            }
        }
        
        // If recording just started, the background script handles logging the initial navigation.
        // This content script logs 'pageload' via the initial check if it loads
        // into an already-recording session for this tab.
        // Clear input map only when recording fully stops, not on pause.
        if (!message.isRecording) { // When recording fully stops
            inputLastValueMap = new WeakMap(); // Re-initialize to clear old values
        }
        
        // Send acknowledgment back
        if (sendResponse) {
            sendResponse({ success: true });
        }
    } else if (message.action === 'captureRightClickedElementForFind') {
        if (lastRightClickedElement && isEffectivelyRecording) {
            const locators = getElementLocator(lastRightClickedElement);
            logEvent('findElement', { // New event type for findelement tag
                locators: locators,
                tagName: lastRightClickedElement.tagName
            });
            console.log("[Content] Logged 'findElement' for:", lastRightClickedElement);
            // lastRightClickedElement = null; // Optionally clear after use, or let it be overwritten by next right click
            if (sendResponse) sendResponse({ success: true });
        } else {
            console.warn("[Content] No last right-clicked element found or not recording for 'findElement'.");
            if (sendResponse) sendResponse({ success: false, error: "No element or not recording" });
        }
        return true; // Indicate async response
    }
});

// Function to show a temporary notification on the page
function showPasswordEnteredNotification() {
    const existingNotification = document.getElementById('web-recorder-password-notification');
    if (existingNotification && existingNotification.parentNode) {
        existingNotification.parentNode.removeChild(existingNotification);
    }

    const notification = document.createElement('div');
    notification.id = 'web-recorder-password-notification'; // ID for potential removal/styling
    notification.textContent = 'Password entered (masked for recording)';
    Object.assign(notification.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: '#28a745', // A pleasant green
        color: 'white',
        padding: '12px 18px',
        borderRadius: '6px',
        zIndex: '2147483647', // Max z-index
        boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
        opacity: '0',
        transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
        transform: 'translateY(20px)'
    });
    document.body.appendChild(notification);

    setTimeout(() => { // Animate in
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 50);

    setTimeout(() => { // Animate out and remove
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(20px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300); // Wait for fade out transition
    }, 3500); // Display for 3.5 seconds
}

// Utility: Send event to background
function logEvent(type, details = {}) {
    // Explicitly log the check *before* returning or proceeding
    console.log(`[DIAGNOSTIC] logEvent attempt. Type: ${type}, isEffectivelyRecording: ${isEffectivelyRecording}. Details:`, details);
    if (!isEffectivelyRecording) {
        console.log(`[DIAGNOSTIC] logEvent SKIPPED for type: ${type} because isEffectivelyRecording is false.`);
        return;
    }
    try {
        chrome.runtime.sendMessage({
            action: 'logEvent',
            type,
            details
        });
        console.log(`[DIAGNOSTIC] logEvent successfully sent message to background for type: ${type}.`);
    } catch (err) {
        console.error(`[Content] logEvent error sending message for type: ${type}:`, err, 'Details:', details);
    }
}

// Utility: Get all three locator types (id, css, xpath) for an element
function getElementLocator(el) {
    if (!el || !el.tagName) {
        return { id: null, css: null, xpath: null };
    }

    const foundId = el.id ? el.id : null;

    // CSS Selector Generation
    let foundCss = null;
    const tagNameLower = el.tagName.toLowerCase();
    const classNameString = el.getAttribute('class'); // Use getAttribute for robustness

    if (classNameString && typeof classNameString === 'string' && classNameString.trim() !== '') {
        const classes = classNameString.trim().split(/\s+/).filter(Boolean); // Filter out empty strings from multiple spaces
        if (classes.length > 0) {
            try {
                foundCss = tagNameLower + '.' + classes.map(cls => CSS.escape(cls)).join('.');
            } catch (e) {
                console.warn(`[Content getElementLocator] Error using CSS.escape for classes: "${classNameString}", falling back to tagName.`, e);
                foundCss = tagNameLower; // Fallback if CSS.escape fails or is not supported (though it should be)
            }
        } else {
            foundCss = tagNameLower; // Tag name if class attribute is empty after trim/split
        }
    } else {
        foundCss = tagNameLower; // Tag name if no class attribute or it's not a string
    }

    function generateXPathForElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const tagName = el.tagName.toLowerCase();

        // Priority A: span with 'item-text' class and specific text() - MOVED UP for higher priority
        // Generates XPath like: //span[contains(@class,'item-text') and normalize-space()='ActualText']
        if (tagName === 'span' && el.classList && el.classList.contains('item-text')) {
            const textContent = el.textContent ? el.textContent.trim() : '';
            // Ensure text is not empty and safe for XPath (no single quotes)
            // 'item-text' itself is safe for contains(@class, 'item-text')
            if (textContent && !textContent.includes("'")) {
                return `//${tagName}[contains(@class,'item-text') and normalize-space()='${textContent}']`;
            }
        }

        // Priority B: Specific class 'profile' (formerly Priority 0)
        if (el.classList && el.classList.contains('profile')) {
            // Ensure 'profile' doesn't have single quotes (it doesn't, but good practice)
            if (!'profile'.includes("'")) {
                return `//${tagName}[contains(@class,'profile')]`;
            }
        }

        // Priority C: Specific class 'item-text' and 'name' attribute (formerly Priority 0.5)
        if (el.classList && el.classList.contains('item-text') && el.hasAttribute('name')) {
            const nameValue = el.getAttribute('name');
            // Ensure 'item-text' is safe (it is) and nameValue is not null/empty and safe for XPath
            // 'item-text' does not contain single quotes, so it's safe for contains(@class, 'item-text')
            if (nameValue && nameValue.trim() !== '' && !nameValue.includes("'") && !nameValue.includes('"')) {
                return `//${tagName}[contains(@class,'item-text') and @name='${nameValue}']`;
            }
        }

        // Priority D: ID (formerly Priority 1)
        // Ensure ID does not contain single or double quotes for the XPath expression
        if (el.id && !el.id.includes("'") && !el.id.includes('"')) {
            return `//${tagName}[@id='${el.id}']`;
        }

        // Priority 2: Class using contains()
        let classAttributeValue = null;
        if (el.hasAttribute('class')) { // Check existence first
            classAttributeValue = el.getAttribute('class');
        }
        // Fallback for SVG or other cases if getAttribute returns null but .className is informative
        if (!classAttributeValue && typeof el.className === 'string' && el.className.trim() !== '') {
            classAttributeValue = el.className;
        } else if (!classAttributeValue && el.className && typeof el.className === 'object' &&
                   Object.prototype.hasOwnProperty.call(el.className, 'baseVal') &&
                   typeof el.className.baseVal === 'string' && el.className.baseVal.trim() !== '') {
            classAttributeValue = el.className.baseVal;
        }

        if (classAttributeValue) {
            const trimmedClasses = classAttributeValue.trim();
            if (trimmedClasses !== '') {
                // Split classes and take the first one that doesn't contain a single quote
                const classes = trimmedClasses.split(/\s+/);
                for (const cls of classes) {
                    if (cls && !cls.includes("'")) { // Ensure class is not empty and no single quote
                        return `//${tagName}[contains(@class,'${cls}')]`;
                    }
                }
            }
        }
        // Priority E: Tag name only (fallback, formerly Priority 3)
        return `//${tagName}`;
    }
    const foundXpath = generateXPathForElement(el);

    return { id: foundId, css: foundCss, xpath: foundXpath };
}

// Track input value changes
const inputLastValueMap = new WeakMap();

// Helper function to handle text input logging for blur and Enter key
function handleTextInput(target, isEnterKey = false) {
    console.log('[Content Input Debug] handleTextInput called. Target:', target, 'isEnterKey:', isEnterKey, 'isEffectivelyRecording:', isEffectivelyRecording);
    if (!isEffectivelyRecording) {
        console.log('[Content Input Debug] Not effectively recording, skipping.');
        return;
    }

    try {
        const { value, type } = target;
        const prevValue = inputLastValueMap.get(target) || '';
        console.log(`[Content Input Debug] Current value: "${value}", Prev value: "${prevValue}", Type: "${type}"`);

        // Log on Enter if value is not empty.
        // Log on blur if value is not empty AND value has changed from what was last recorded/set.
        const shouldLog = isEnterKey ? (value !== '') : (value !== '' && value !== prevValue);
        console.log('[Content Input Debug] Should log:', shouldLog);

        if (shouldLog) {
            const locators = getElementLocator(target);
            console.log('[Content Input Debug] Locators for input target:', locators);
            if (!locators || (!locators.id && !locators.css && !locators.xpath)) {
                console.warn('[Content Input Debug] No valid locators found for input target:', target, 'Generated locators:', locators);
                // Decide if you want to log with missing locators or skip
            }

            const eventDetails = {
                value: type === 'password' ? '********' : value,
                type, // HTML input type
                locators: locators
            };
            if (isEnterKey) {
                eventDetails.enterKey = true;
            }
            logEvent('input', eventDetails);
            inputLastValueMap.set(target, value); // Update last known value to current logged value

            if (type === 'password') {
                showPasswordEnteredNotification();
            }
        }
    } catch (error) {
        console.error('[Content Input Debug] Error during input event processing:', error, 'Target was:', target);
        // Optionally, re-throw or handle more gracefully depending on desired behavior
    }
}

// --- Attaching Input Listeners ---

function attachInputListeners() {
    // Handle text inputs and textareas
    document.querySelectorAll('input:not([type="file"]), textarea').forEach(el => {
        if (el.dataset.listenerAttached) return;
        el.dataset.listenerAttached = 'true';
        inputLastValueMap.set(el, el.value);

        // Log the complete input value when field loses focus
        el.addEventListener('blur', e => {
            handleTextInput(e.target, false);
        });

        // Handle Enter key specially (common form submission)
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                handleTextInput(e.target, true);
            }
        });
    });

    // Handle select dropdowns
    document.querySelectorAll('select').forEach(el => {
        if (el.dataset.listenerAttached) return;
        el.dataset.listenerAttached = 'true';

        el.addEventListener('change', e => {
            if (!isEffectivelyRecording) return;
            const allLocators = getElementLocator(e.target);
            logEvent('selectChange', { // Changed event type from 'input' to 'selectChange'
                value: e.target.value,
                // type: 'select', // No longer needed as event type itself is specific
                locators: allLocators // Locators of the select element
            });
        });
    });

    // Handle file inputs
    document.querySelectorAll('input[type="file"]').forEach(el => {
        if (el.dataset.fileListenerAttached) return; // Use a different dataset property to avoid conflict
        el.dataset.fileListenerAttached = 'true';

        el.addEventListener('change', e => {
            if (!isEffectivelyRecording) return;

            if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files).map(file => file.name); // Get all selected filenames
                const allLocators = getElementLocator(e.target);
                logEvent('uploadfile', {
                    filenames: files, // Array of filenames
                    fileCount: files.length,
                    locators: allLocators
                });
            }
        });
    });


}

// Attach listeners on DOM ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    attachInputListeners();
} else {
    document.addEventListener('DOMContentLoaded', attachInputListeners);
}

// MutationObserver for dynamic DOM changes
const observer = new MutationObserver(() => {
    if (isEffectivelyRecording) attachInputListeners();
});
observer.observe(document.body, { childList: true, subtree: true });

// --- Click Events ---
document.addEventListener('click', e => { // Listen in capture phase
    console.log('[Content Click Debug] Click event triggered. Target:', e.target, 'isEffectivelyRecording:', isEffectivelyRecording, 'Location:', window.location.href);
    if (!isEffectivelyRecording) {
        console.log('[Content Click Debug] Not effectively recording, skipping.');
        return;
    }

    try {
        // Get all possible locators for the target
        const allLocators = getElementLocator(e.target);
        console.log('[Content Click Debug] Locators for target:', allLocators, 'Target details:', {
            tagName: e.target.tagName,
            id: e.target.id,
            className: e.target.className,
            textContent: e.target.textContent?.trim().substring(0, 50),
            href: e.target.href // Log href if it's a link
        });

        // Log click event with all available information
        logEvent('click', {
            target: {
                tagName: e.target.tagName,
                className: (typeof e.target.className === 'string' ? e.target.className : (e.target.className && typeof e.target.className.baseVal === 'string' ? e.target.className.baseVal : '')) || '',
                id: e.target.id,
                textContent: e.target.textContent?.trim().substring(0, 50),
                value: e.target.value, // Include value for input elements
                type: e.target.type, // Include type for input elements
                name: e.target.name // Include name attribute
            },
            offsetX: e.offsetX,
            offsetY: e.offsetY,
            pageX: e.pageX,
            pageY: e.pageY,
            locators: allLocators,
            timestamp: new Date().toISOString() // Add explicit timestamp
        });

        // Additional debug logging
        if (!allLocators || (!allLocators.id && !allLocators.css && !allLocators.xpath)) {
            console.warn('[Content Click Debug] No valid locators found for click target:', e.target, 'Generated locators:', allLocators);
        }
        console.log('[Content Click Debug] Successfully processed and attempted to log click event.');
    } catch (error) {
        console.error('[Content Click Debug] Error during click event processing:', error, 'Target was:', e.target);
    }
}, true); // Use capture phase to ensure we catch all clicks

// --- Right Click ---
let lastRightClickedElement = null; // Store the last element right-clicked

document.addEventListener('contextmenu', e => {
    lastRightClickedElement = e.target; // Store the element for potential "Find Element" action
    if (!isEffectivelyRecording) return;
    const allLocators = getElementLocator(e.target);
    logEvent('rightclick', { // This logs the standard RightClickElement event
        locators: allLocators,
        tagName: e.target.tagName // Keep existing rightclick logging
    });
});

// --- Drag and Drop Functionality ---
let draggedElement = null;
let dragStartLocators = null; // Will store {id, css, xpath}

// Drag over event (don't log every move, just prevent default to allow drop)
document.addEventListener('dragover', e => {
    if (!isEffectivelyRecording || !draggedElement) return;
    e.preventDefault(); // Necessary to allow drop
});

// Drop event
document.addEventListener('drop', e => {
    if (!isEffectivelyRecording || !draggedElement) return;
    e.preventDefault();
    
    const dropTarget = e.target;
    const dropLocators = getElementLocator(dropTarget);
    
    logEvent('drop', {
        sourceLocators: dragStartLocators,
        targetLocators: dropLocators,
        draggedTagName: draggedElement.tagName,
        draggedId: draggedElement.id,
        draggedClassName: draggedElement.className,
        dropTargetTagName: dropTarget.tagName,
        dropTargetId: dropTarget.id,
        dropTargetClassName: dropTarget.className,
        pageX: e.pageX,
        pageY: e.pageY
    });
    
    // Reset drag state
    draggedElement = null;
    dragStartLocators = null;
});

// Drag end event (in case drop happens outside valid drop targets)
document.addEventListener('dragend', e => {
    if (!isEffectivelyRecording) return;
    
    // Only log if we still have a reference to the dragged element
    // but no drop was logged (drop outside valid target)
    if (draggedElement) {
        logEvent('dragend', {
            locators: dragStartLocators, // Locators of the element that was being dragged
            tagName: draggedElement.tagName,
            id: draggedElement.id,
            className: draggedElement.className,
            pageX: e.pageX,
            pageY: e.pageY,
            cancelled: true
        });
        
        // Reset drag state
        draggedElement = null;
        dragStartLocators = null;
    }
});

// --- Send Keys (Arrow Keys) ---
// This listener captures arrow key presses on the document.
document.addEventListener('keydown', (e) => {
    if (!isEffectivelyRecording) return;

    // Map of browser key event strings (e.key) to the desired XML attribute values
    const sendKeyMap = {
        "ArrowUp": "ARROW_UP",
        "ArrowDown": "ARROW_DOWN",
        "ArrowLeft": "ARROW_LEFT",
        "ArrowRight": "ARROW_RIGHT",
        "Enter": "ENTER",
        "Backspace": "BACK_SPACE", // Note: e.key is "Backspace"
        "Tab": "TAB",
        "Escape": "ESCAPE",
        "Delete": "DELETE",
        "Insert": "INSERT",
        " ": "SPACE", // Note: e.key for spacebar is " "
        // "Control": "CONTROL" // Capturing modifier keys alone is often not useful.
                               // Consider logging key combinations if needed.
    };

    const mappedKey = sendKeyMap[e.key];

    if (mappedKey) {
        // We don't preventDefault here to allow normal arrow key behavior
        // (e.g., cursor movement in input fields, page scrolling).
        // The event is logged regardless of the target.

        const targetElement = e.target;
        const allLocators = getElementLocator(targetElement);

        logEvent('sendkeys', {
            key: mappedKey,                 // The "ARROW_UPPERCASE" version for XML
            originalEventKey: e.key,        // e.g., "ArrowUp", for debugging or richer logs
            targetContext: {                // Context about where the key press occurred
                tagName: targetElement.tagName,
                id: targetElement.id,
                type: targetElement.type, // e.g., "text", "textarea"
                // Optionally log a snippet of the value if it's an input/textarea
                // value: (targetElement.value !== undefined && targetElement.value !== null) ? String(targetElement.value).substring(0, 50) : undefined
            },
            locators: allLocators           // Locators of the focused element
        });
    }
});

// --- Scroll Detection ---

// For Window Scroll
let windowLastScrollY = 0;
let windowScrollDebounceTimeout = null;
const SCROLL_DEBOUNCE_DELAY = 300; // milliseconds to wait after scrolling stops

// Function to handle WINDOW scroll events
function handleWindowScroll() { // Renamed from handleScroll
    if (!isEffectivelyRecording) return;

    // Clear any existing debounce timeout
    clearTimeout(windowScrollDebounceTimeout);

    // Set a new timeout to log the event after scrolling has paused
    windowScrollDebounceTimeout = setTimeout(() => {
        const scrollTop = window.scrollY;
        if (Math.abs(scrollTop - windowLastScrollY) > 10) { // Significance threshold
            const scrollHeight = document.documentElement.scrollHeight;
            const clientHeight = window.innerHeight; // Viewport height
            const totalScrollable = Math.max(scrollHeight - clientHeight, 1);
            const scrollPercentage = scrollHeight > clientHeight ? Math.round((scrollTop / totalScrollable) * 100) : 0;
            const pageLocators = { id: null, css: 'html', xpath: '/HTML' };

            logEvent('scroll', {
                scrollTop,
                scrollPercentage,
                elementType: 'window', // Always report as 'window'
                locators: pageLocators, // Always use page-level locators
                isWindow: true          // Always true for this simplified logic
            });
            windowLastScrollY = scrollTop; // Update windowLastScrollY only when an event is actually logged
        }
    }, SCROLL_DEBOUNCE_DELAY);
}

// For Generic DOM Element Scrolls (non-iframe, non-window)
const genericElementScrollHandlers = new WeakMap(); // Stores { lastScrollY, debounceTimeoutId, handler } for each element

function handleGenericElementScroll(event) {
    if (!isEffectivelyRecording) return;

    const element = event.currentTarget; // The element to which the listener was attached
    if (!element || typeof element.scrollTop === 'undefined') return;

    let state = genericElementScrollHandlers.get(element);
    // State should always exist if handler is called, as it's set during attach.
    if (!state) {
        console.warn("[Content Scroll] State not found for scrolled element. Initializing.", element);
        state = { lastScrollY: element.scrollTop, debounceTimeoutId: null, handler: handleGenericElementScroll };
        genericElementScrollHandlers.set(element, state);
    }

    clearTimeout(state.debounceTimeoutId);
    state.debounceTimeoutId = setTimeout(() => {
        const scrollTop = element.scrollTop;
        // Check scroll significance against the element's own last scroll position
        if (Math.abs(scrollTop - state.lastScrollY) > 10) {
            const scrollHeight = element.scrollHeight;
            const clientHeight = element.clientHeight;
            const totalScrollable = Math.max(scrollHeight - clientHeight, 1);
            const scrollPercentage = scrollHeight > clientHeight ? Math.round((scrollTop / totalScrollable) * 100) : 0;
            
            logEvent('scroll', {
                scrollTop,
                scrollPercentage,
                elementType: element.tagName.toLowerCase(),
                locators: getElementLocator(element),
                isWindow: false // It's an element scroll
            });
            state.lastScrollY = scrollTop; // Update this element's last scroll Y
        }
    }, SCROLL_DEBOUNCE_DELAY);
}

function attachGenericElementScrollListeners() {
    if (!document.body || !isEffectivelyRecording) return; // Ensure body exists and recording is active

    const potentialElements = document.querySelectorAll('div, section, main, article, aside, ul, ol, pre, textarea, form');
    potentialElements.forEach(el => {
        if (el !== document.documentElement && el !== document.body && el.tagName !== 'IFRAME') {
            const style = window.getComputedStyle(el);
            const isPotentiallyScrollableByCss = (style.overflow === 'scroll' || style.overflow === 'auto' ||
                                                style.overflowX === 'scroll' || style.overflowX === 'auto' ||
                                                style.overflowY === 'scroll' || style.overflowY === 'auto');
            const hasScrollableContent = (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);

            if (isPotentiallyScrollableByCss && hasScrollableContent) {
                if (!el.dataset.genericScrollListenerAttached) {
                    el.addEventListener('scroll', handleGenericElementScroll, { passive: true });
                    el.dataset.genericScrollListenerAttached = 'true';
                    genericElementScrollHandlers.set(el, {
                        lastScrollY: el.scrollTop,
                        debounceTimeoutId: null,
                        handler: handleGenericElementScroll
                    });
                }
            }
        }
    });
}

// Window scroll listener is managed directly based on `isEffectivelyRecording` state changes
// (see initial state check and 'updateRecordingState' message handler).

// The MutationObserver below is for `attachInputListeners` to catch dynamic input fields.
const inputObserver = new MutationObserver(() => {
    if (isEffectivelyRecording) attachInputListeners();
});
if (document.body) { // Ensure body exists before observing
    inputObserver.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        inputObserver.observe(document.body, { childList: true, subtree: true });
    });
}

// MutationObserver for dynamically added/removed generic scrollable elements
const genericElementScrollObserver = new MutationObserver(mutations => {
    if (!isEffectivelyRecording) return;
    attachGenericElementScrollListeners(); // Re-check and attach to new elements

    mutations.forEach(mutation => {
        mutation.removedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE && node.dataset && node.dataset.genericScrollListenerAttached === 'true') {
                const state = genericElementScrollHandlers.get(node);
                if (state) {
                    node.removeEventListener('scroll', state.handler);
                    clearTimeout(state.debounceTimeoutId);
                    genericElementScrollHandlers.delete(node);
                }
                delete node.dataset.genericScrollListenerAttached;
            }
        });
    });
});

function cleanupGenericElementScrollListeners() {
    document.querySelectorAll('[data-generic-scroll-listener-attached="true"]').forEach(el => {
        const state = genericElementScrollHandlers.get(el);
        if (state) {
            el.removeEventListener('scroll', state.handler);
            clearTimeout(state.debounceTimeoutId);
            genericElementScrollHandlers.delete(el);
        }
        delete el.dataset.genericScrollListenerAttached;
    });
}

// --- Iframe Focus Tracking ---
let activeIframeElement = null; // Stores the <iframe> HTML element from the parent document whose content is currently focused
const iframeScrollHandlers = new WeakMap(); // Store scroll handlers and state for iframes
const iframeClickHandlers = new WeakMap(); // Store click handlers for iframes

// Helper to check if an iframe is same-origin and accessible
function isIframeAccessible(iframe) {
    try {
        // Try to access contentDocument - will throw for cross-origin
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;
        if (!doc || !win) {
            console.log('[Content Iframe Debug] Iframe not accessible - no doc/win:', iframe.src);
            return false;
        }
        
        // Additional check for same-origin
        const iframeOrigin = new URL(iframe.src, window.location.origin).origin;
        const isSameOrigin = iframeOrigin === window.location.origin;
        console.log('[Content Iframe Debug] Iframe origin check:', {
            iframeSrc: iframe.src,
            iframeOrigin,
            windowOrigin: window.location.origin,
            isSameOrigin
        });
        return isSameOrigin;
    } catch (e) {
        console.log('[Content Iframe Debug] Error checking iframe accessibility:', iframe.src, e);
        return false;
    }
}

// Helper to get iframe locators with enhanced reliability
function getIframeLocators(iframe) {
    const locators = getElementLocator(iframe);
    
    // Add additional identifiers if available
    if (iframe.name) {
        locators.name = iframe.name;
    }
    if (iframe.id) {
        locators.id = iframe.id;
    }
    if (iframe.src) {
        try {
            const url = new URL(iframe.src, window.location.origin);
            locators.src = url.href;
        } catch (e) {
            locators.src = iframe.src;
        }
    }
    
    return locators;
}

// Helper to log switch to frame event
function logSwitchToFrame(iframe) {
    if (!iframe || !isEffectivelyRecording) return;
    
    console.log('[Content Iframe Debug] Logging switchToFrame for:', {
        src: iframe.src,
        id: iframe.id,
        name: iframe.name
    });

    logEvent('switchToFrame', {
        timestamp: Date.now(),
        src: iframe.src,
        name: iframe.name || '',
        locators: getIframeLocators(iframe)
    });
}

// Enhanced focus tracking for iframes
window.addEventListener('focus', (event) => {
    if (!isEffectivelyRecording) {
        console.log('[Content Iframe Debug] Not recording, ignoring focus event');
        return;
    }

    console.log('[Content Iframe Debug] Focus event:', {
        target: event.target,
        targetTagName: event.target.tagName,
        targetId: event.target.id,
        targetClassName: event.target.className,
        ownerDoc: event.target.ownerDocument === window.document ? 'main' : 'iframe'
    });

    const focusedElement = event.target;
    const ownerDoc = focusedElement.ownerDocument;

    if (ownerDoc === window.document) {
        // Focus is in the main document
        if (activeIframeElement) {
            console.log('[Content Iframe Debug] Switching to parent frame from:', {
                iframeSrc: activeIframeElement.src,
                iframeId: activeIframeElement.id,
                iframeName: activeIframeElement.name
            });
            
            logEvent('switchToParentFrame', {
                timestamp: Date.now(),
                iframeSrc: activeIframeElement.src,
                iframeLocators: getIframeLocators(activeIframeElement)
            });
            activeIframeElement = null;
        }
    } else if (ownerDoc && ownerDoc.defaultView && ownerDoc.defaultView.frameElement) {
        // Focus is inside an iframe
        const currentIframe = ownerDoc.defaultView.frameElement;
        
        console.log('[Content Iframe Debug] Focus in iframe:', {
            iframeSrc: currentIframe.src,
            iframeId: currentIframe.id,
            iframeName: currentIframe.name,
            isActive: currentIframe === activeIframeElement
        });
        
        if (currentIframe && currentIframe !== activeIframeElement) {
            // Log switch to frame before updating active iframe
            logSwitchToFrame(currentIframe);
            activeIframeElement = currentIframe;

            // Set up click handler if not already done
            if (isIframeAccessible(currentIframe) && !iframeClickHandlers.has(currentIframe)) {
                console.log('[Content Iframe Debug] Setting up click handler for iframe:', currentIframe.src);
                try {
                    const iframeDoc = currentIframe.contentDocument;
                    const clickHandler = (e) => {
                        if (!isEffectivelyRecording) {
                            console.log('[Content Iframe Debug] Not recording, ignoring click in iframe');
                            return;
                        }
                        
                        console.log('[Content Iframe Debug] Click in iframe:', {
                            iframeSrc: currentIframe.src,
                            targetTagName: e.target.tagName,
                            targetId: e.target.id,
                            targetClassName: e.target.className
                        });
                        
                        // Always ensure we're in the correct iframe context
                        if (activeIframeElement !== currentIframe) {
                            console.log('[Content Iframe Debug] Iframe context changed, re-switching to frame');
                            logSwitchToFrame(currentIframe);
                            activeIframeElement = currentIframe;
                        }

                        // Small delay to ensure switchToFrame is processed first
                        setTimeout(() => {
                            // Log the click event
                            const clickTarget = e.target;
                            const clickLocators = getElementLocator(clickTarget);
                            console.log('[Content Iframe Debug] Logging click with locators:', clickLocators);
                            
                            logEvent('iframeClick', {
                                timestamp: Date.now(),
                                iframeSrc: currentIframe.src,
                                locators: clickLocators,
                                targetDetails: {
                                    tagName: clickTarget.tagName,
                                    id: clickTarget.id,
                                    className: clickTarget.className,
                                    name: clickTarget.name,
                                    value: clickTarget.value,
                                    type: clickTarget.type
                                }
                            });

                            // Log SwitchToParentFrame immediately after the click
                            logEvent('switchToParentFrame', {
                                iframeSrc: currentIframe.src,
                                iframeLocators: getIframeLocators(currentIframe) // Locators of the iframe we are switching from
                            });
                        }, 0);
                    };

                    iframeDoc.addEventListener('click', clickHandler, true);
                    iframeClickHandlers.set(currentIframe, clickHandler);
                    console.log('[Content Iframe Debug] Click handler set up successfully');
                } catch (err) {
                    console.warn('[Content Iframe Debug] Could not set up click handler for iframe:', currentIframe.src, err);
                }
            } else {
                console.log('[Content Iframe Debug] Skipping click handler setup:', {
                    isAccessible: isIframeAccessible(currentIframe),
                    hasHandler: iframeClickHandlers.has(currentIframe)
                });
            }
        }
    }
}, true);

// Clean up iframe handlers when iframe is removed
function cleanupIframeHandlers(iframe) {
    if (iframeClickHandlers.has(iframe)) {
        try {
            const doc = iframe.contentDocument;
            const handler = iframeClickHandlers.get(iframe);
            if (doc && handler) {
                doc.removeEventListener('click', handler, true);
            }
        } catch (e) {
            // Ignore errors for cross-origin iframes
        }
        iframeClickHandlers.delete(iframe);
    }
    
    if (iframeScrollHandlers.has(iframe)) {
        const { scrollHandler, debounceTimeoutId } = iframeScrollHandlers.get(iframe);
        try {
            const win = iframe.contentWindow;
            if (win && scrollHandler) {
                win.removeEventListener('scroll', scrollHandler);
            }
        } catch (e) {
            // Ignore errors for cross-origin iframes
        }
        if (debounceTimeoutId) {
            clearTimeout(debounceTimeoutId);
        }
        iframeScrollHandlers.delete(iframe);
    }
    
    if (iframe === activeIframeElement) {
        logEvent('switchToParentFrame', {
            timestamp: Date.now(),
            iframeSrc: iframe.src,
            iframeLocators: getIframeLocators(iframe)
        });
        activeIframeElement = null;
    }
}

// Update the iframe observer to use the new cleanup function
const iframeObserver = new MutationObserver(mutations => {
    if (!isEffectivelyRecording) return;
    
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IFRAME') {
                attachIframeListeners();
            } else if (node.nodeType === Node.ELEMENT_NODE && node.querySelector('iframe')) {
                attachIframeListeners();
            }
        });
        
        mutation.removedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IFRAME') {
                cleanupIframeHandlers(node);
            }
        });
    });
});

// --- Window Events ---
// We listen for window resize events to detect possible maximize/minimize
let lastWindowWidth = window.innerWidth;
let lastWindowHeight = window.innerHeight;

window.addEventListener('resize', () => {
    if (!isEffectivelyRecording) return;
    
    // Detect if this is likely a maximize or minimize event
    const isMaximize = window.innerWidth > lastWindowWidth && window.innerHeight > lastWindowHeight;
    const isMinimize = window.innerWidth < lastWindowWidth && window.innerHeight < lastWindowHeight;
    
    // Log the appropriate event
    if (isMaximize) {
        logEvent('windowMaximize', {
            oldWidth: lastWindowWidth,
            oldHeight: lastWindowHeight,
            newWidth: window.innerWidth,
            newHeight: window.innerHeight
        });
    } else if (isMinimize) {
        logEvent('windowMinimize', {
            oldWidth: lastWindowWidth,
            oldHeight: lastWindowHeight,
            newWidth: window.innerWidth,
            newHeight: window.innerHeight
        });
    }
    
    // Update the last known window size
    lastWindowWidth = window.innerWidth;
    lastWindowHeight = window.innerHeight;
});
// Helper function to set up listeners inside an iframe's content
function setupListenersInsideIframe(iframe) {
    console.log('[Content Iframe Debug] Setting up listeners for iframe:', {
        src: iframe.src,
        id: iframe.id,
        name: iframe.name,
        isRecording: isEffectivelyRecording
    });

    if (!isEffectivelyRecording) {
        console.log('[Content Iframe Debug] Not recording, skipping listener setup');
        return;
    }

    // Log that an attempt is made to process this iframe
    logEvent('iframeLoaded', {
        src: iframe.src,
        name: iframe.name || '',
        locators: getIframeLocators(iframe),
        accessible: false
    });

    try {
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;

        if (!doc || !win) {
            console.warn('[Content Iframe Debug] Cannot access iframe content:', {
                src: iframe.src,
                hasDoc: !!doc,
                hasWin: !!win
            });
            return;
        }

        console.log('[Content Iframe Debug] Successfully accessed iframe content:', iframe.src);
        
        // Ensure we log switchToFrame when setting up listeners
        if (activeIframeElement !== iframe) {
            logSwitchToFrame(iframe);
            activeIframeElement = iframe;
        }

        // CLICK LISTENER
        doc.addEventListener('click', iframeEvent => {
            if (!isEffectivelyRecording) return;
            const targetInIframe = iframeEvent.target;

            // 1. Log switchToFrame for the iframe itself, before the click event
            logEvent('switchToFrame', {
                src: iframe.src,
                name: iframe.name || '',
                locators: getElementLocator(iframe)
            });

            // 2. Log the click event on the element within the iframe
            const internalLocators = getElementLocator(targetInIframe);
            logEvent('iframeClick', {
                iframeSrc: iframe.src, // For context in the ClickElement tag
                locators: internalLocators,
                offsetX: iframeEvent.offsetX,
                offsetY: iframeEvent.offsetY,
                targetDetails: {
                    tagName: targetInIframe.tagName,
                    id: targetInIframe.id,
                    className: typeof targetInIframe.className === 'string' ? targetInIframe.className : (targetInIframe.className && targetInIframe.className.baseVal) || '',
                    name: targetInIframe.name
                }
            });

            // 3. Log SwitchToParentFrame immediately after the click
            logEvent('switchToParentFrame', {
                iframeSrc: iframe.src,
                iframeLocators: getElementLocator(iframe) // Locators of the iframe we are switching from
            });
        }, true); // Use capture phase

        // SCROLL LISTENER for iframe content
        let iframeLastScrollY = 0;
        let iframeScrollDebounceTimeout = null;

        const scrollHandlerInstance = () => {
            if (!isEffectivelyRecording) return;

            clearTimeout(iframeScrollDebounceTimeout);
            iframeScrollDebounceTimeout = setTimeout(() => {
                const scrollTop = win.scrollY || doc.documentElement.scrollTop || doc.body.scrollTop;
                if (Math.abs(scrollTop - iframeLastScrollY) > 10) {
                    const scrollHeight = doc.documentElement.scrollHeight;
                    const clientHeight = win.innerHeight;
                    const totalScrollable = Math.max(scrollHeight - clientHeight, 1);
                    const scrollPercentage = scrollHeight > clientHeight ? Math.round((scrollTop / totalScrollable) * 100) : 0;

                    logEvent('scroll', {
                        scrollTop,
                        scrollPercentage,
                        elementType: 'iframeContent',
                        locators: getElementLocator(iframe), // Locators of the iframe tag
                        iframeSrc: iframe.src,
                        isWindow: false // Context is scrolling within the iframe's document
                    });
                    iframeLastScrollY = scrollTop;
                }
            }, SCROLL_DEBOUNCE_DELAY);
        };

        win.addEventListener('scroll', scrollHandlerInstance, { passive: true });
        iframeScrollHandlers.set(iframe, {
            scrollHandler: scrollHandlerInstance,
            debounceTimeoutId: iframeScrollDebounceTimeout,
            lastY: iframeLastScrollY
        });

    } catch (err) {
        console.warn('[Content Iframe Debug] Error setting up iframe listeners:', {
            src: iframe.src,
            error: err.message
        });
    }
}

function attachIframeListeners() {
    document.querySelectorAll('iframe').forEach(iframe => {
        if (iframe.dataset.recorderListenersAttached === 'true') return;
        iframe.dataset.recorderListenersAttached = 'true';

        // Attempt to set up listeners if iframe is already loaded and accessible
        try {
            if (iframe.contentDocument && iframe.contentWindow && // Basic check for presence
                (iframe.contentDocument.readyState === 'complete' || iframe.contentDocument.readyState === 'interactive')) {
                // Further check for actual accessibility
                // eslint-disable-next-line no-unused-expressions
                iframe.contentWindow.document; // This will throw an error for cross-origin if not accessible
                console.log('[Content Iframe] Already loaded and accessible, setting up listeners directly for:', iframe.src);
                setupListenersInsideIframe(iframe);
            } else {
                // Not yet fully loaded or not accessible, attach to 'load' event
                console.log(`[Content Iframe] Iframe not immediately ready/accessible. Waiting for load. src: ${iframe.src}. contentDocument: ${iframe.contentDocument}, contentWindow: ${iframe.contentWindow}, readyState: ${iframe.contentDocument ? iframe.contentDocument.readyState : 'N/A'}`);
                iframe.addEventListener('load', () => setupListenersInsideIframe(iframe));
            }
        } catch (e) {
            // Likely cross-origin, or iframe.contentDocument is null before 'load'
            console.warn('[Content Iframe] Already loaded but not accessible (or not yet fully ready), will wait for load event for:', iframe.src, e.message);
            // Check if it's same origin despite the error
            let isSameOriginCheck = false;
            try {
                isSameOriginCheck = new URL(iframe.src, window.location.origin).origin === window.location.origin;
            } catch (urlError) { /* ignore if src is invalid for URL constructor */ }

            if (isSameOriginCheck) {
                console.warn(`[Content Iframe] Accessibility error for a SAME-ORIGIN iframe during direct setup. src: ${iframe.src}. Error: ${e.message}. This is unexpected. Check for sandbox attributes or other restrictions.`);
            }
            iframe.addEventListener('load', () => setupListenersInsideIframe(iframe));
        }

        iframe.addEventListener('error', (e) => {
            console.warn('[Content Iframe] Iframe element reported an error (e.g., src not found):', iframe.src, e);
            if (isEffectivelyRecording) {
                logEvent('iframeError', { // Log that an iframe element itself had an error
                    src: iframe.src,
                    name: iframe.name || '',
                    locators: getElementLocator(iframe)
                });
            }
        });
    });
}

// Initial attachment of listeners to existing iframes
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    attachIframeListeners();
} else {
    document.addEventListener('DOMContentLoaded', attachIframeListeners);
}
window.addEventListener('load', attachIframeListeners); // Also run on window.load for late iframes

// Start observing the document body for iframe changes
if (document.body) {
    iframeObserver.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        iframeObserver.observe(document.body, { childList: true, subtree: true });
    });
    // Also start generic element scroll observer if body exists and recording
    if (document.body && isEffectivelyRecording) {
        genericElementScrollObserver.observe(document.body, { childList: true, subtree: true });
    } else if (isEffectivelyRecording) { // If body not ready but recording, wait for DOMContentLoaded
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) genericElementScrollObserver.observe(document.body, { childList: true, subtree: true });
        });
    }
}