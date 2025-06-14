let isRecording = false;
let isPaused = false; // New state for pause
let eventLog = [];
let activeTabId = null;
let pageLoadTime = Date.now();
let recordingWindowId = null; // Window ID where recording was initiated, used for maximize/minimize etc.
let initialWindowId = null; // Window ID where recording started, for parent window detection
let currentFocusedWindowId = null; // Currently active window ID during recording
let pendingFileDownloads = {}; // To store downloads before their filename/state is final
let lastClickInitiatorInfo = null; // { tabId: number, timestamp: number } - To track clicks that might open new tabs
let windowState = 'normal'; // Track window state: normal, maximized, minimized

function addEventToLog(entry, tabId) {
    try {
        if (!entry.time) {
            entry.time = new Date().toISOString();
        }

        if (!entry.details) {
            entry.details = {};
        }

        eventLog.push(entry);
        console.log(`[Background] Event logged in tab ${tabId ?? 'unknown'}:`, entry);
    } catch (error) {
        console.error("[Background] Failed to log event:", error);
    }
}

function isWindowMaximized(window) {
    return window.state === "maximized" ||
        (window.width >= screen.width && window.height >= screen.height);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Background] Received message:", message);

    if (message.action === 'startRecording') {
        if (isRecording && !isPaused) { // Only warn if truly recording, not just paused
            console.warn("[Background] Recording already in progress. Ignoring start request.");
            sendResponse({ success: false, error: "Recording already in progress" });
            return true;
        }

        // If it was paused, starting again effectively unpauses and resets.
        isPaused = false;
        isRecording = true;
        eventLog = [];
        pageLoadTime = Date.now();

        chrome.windows.getCurrent({}, (window) => {
            recordingWindowId = window.id; // For window state events like maximize/minimize
            initialWindowId = window.id;   // For 'switchToParentWindow' logic
            currentFocusedWindowId = window.id; // Initialize current focused window
            windowState = window.state;
            // Log initial window state
            addEventToLog({
                type: 'windowState',
                time: new Date().toISOString(),
                details: { state: window.state }
            }, activeTabId);
        });

        chrome.contextMenus.create({
            id: "recordFindElement",
            title: "Record Find Element",
            contexts: ["all"],
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("[Background] Error creating context menu:", chrome.runtime.lastError.message);
            }
        });


        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                activeTabId = tabs[0].id;
                if (chrome.runtime.lastError) {
                    console.error("[Background] Error querying active tab:", chrome.runtime.lastError.message);
                    sendResponse({ success: false, error: "Failed to query active tab" });
                    return;
                }

                addEventToLog({
                    type: 'navigation',
                    time: new Date().toISOString(),
                    details: { url: tabs[0].url }
                }, activeTabId);

                chrome.tabs.query({}, (allTabs) => {
                    allTabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'updateRecordingState',
                            isRecording: true,
                            isPaused: false
                        })
                        .catch(err => {
                            console.warn(`[Background] Failed to send updateRecordingState (start) to tab ${tab.id}. Error: ${err.message}. Tab URL might be: ${tab.url}`);
                        });
                    });
                });
                sendResponse({ success: true, newState: { isRecording, isPaused } });
            } else {
                console.warn("[Background] No active tab found.");
                sendResponse({ success: false, error: "No active tab found" });
            }
        });

        return true;

    } else if (message.action === 'stopRecording') {
        if (!isRecording) {
            console.warn("[Background] No recording in progress. Ignoring stop request.");
            sendResponse({ success: false, error: "No recording in progress" });
            return true;
        }

        isRecording = false;
        isPaused = false; // Ensure pause is also reset
        initialWindowId = null;
        currentFocusedWindowId = null;

        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'updateRecordingState',
                    isRecording: false,
                    isPaused: false
                })
                .catch(err => {
                    console.warn(`[Background] Failed to send updateRecordingState (stop) to tab ${tab.id}. Error: ${err.message}. Tab URL might be: ${tab.url}`);
                });
            });
        });
        sendResponse({ success: true, newState: { isRecording, isPaused } });
        chrome.contextMenus.remove("recordFindElement", () => {
            if (chrome.runtime.lastError) { /* console.warn("Error removing context menu:", chrome.runtime.lastError.message); */ }
        });

        return true;

    } else if (message.action === 'pauseRecording') {
        if (!isRecording || isPaused) {
            sendResponse({ success: false, error: "Not recording or already paused" });
            return true;
        }
        isPaused = true;
        addEventToLog({ type: 'pause', time: new Date().toISOString() }, activeTabId);
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'updateRecordingState', isRecording, isPaused })
                .catch(err => console.warn(`[Background] Failed to send updateRecordingState (pause) to tab ${tab.id}. Error: ${err.message}. Tab URL might be: ${tab.url}`));

            });
        });
        sendResponse({ success: true, newState: { isRecording, isPaused } });
        return true;

    } else if (message.action === 'resumeRecording') {
        if (!isRecording || !isPaused) {
            sendResponse({ success: false, error: "Not recording or not paused" });
            return true;
        }
        isPaused = false;
        addEventToLog({ type: 'resume', time: new Date().toISOString() }, activeTabId);
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => { // Use forEach for clarity, though map/Promise.all is also an option
                chrome.tabs.sendMessage(tab.id, { action: 'updateRecordingState', isRecording, isPaused })
                .catch(err => console.warn(`[Background] Failed to send updateRecordingState (resume) to tab ${tab.id}. Error: ${err.message}. Tab URL might be: ${tab.url}`));
            });
        });
        sendResponse({ success: true, newState: { isRecording, isPaused } });
        return true;

    } else if (message.action === 'getEventLog') {
        console.log("[Background] Sending event log:", eventLog);
        sendResponse({ log: eventLog });
        return true;
    } else if (message.action === 'logEvent' && isRecording && !isPaused) { // Check isPaused
        const time = new Date().toISOString();
        const entry = {
            type: message.type,
            time: time,
            details: message.details || {}
        };

        // If the event is a click, store its initiator info
        if (message.type === 'click' && sender && sender.tab) {
            lastClickInitiatorInfo = { tabId: sender.tab.id, timestamp: Date.now() };
        }

        const tabId = sender?.tab?.id ?? activeTabId ?? -1;
        addEventToLog(entry, tabId);

        sendResponse({ success: true });
        return true;

    } else if (message.action === 'checkRecordingState') {
        sendResponse({ isRecording, isPaused }); // Send pause state too
        return true;
    }

    return false;
});

chrome.tabs.onCreated.addListener((newlyCreatedTab) => {
    if (!isRecording || isPaused || !lastClickInitiatorInfo) {
        return;
    }

    // Check if the new tab was opened by the last recorded click
    if (newlyCreatedTab.openerTabId &&
        newlyCreatedTab.openerTabId === lastClickInitiatorInfo.tabId &&
        (Date.now() - lastClickInitiatorInfo.timestamp) < 2000) { // 2-second window

        addEventToLog({
            type: 'newTabOpenedByClick',
            time: new Date().toISOString(),
            details: {
                title: newlyCreatedTab.title || newlyCreatedTab.url || '', // Use title, fallback to URL
                url: newlyCreatedTab.url || '',
                newTabId: newlyCreatedTab.id,
                openerTabId: newlyCreatedTab.openerTabId
            }
        }, newlyCreatedTab.openerTabId); // Log in the context of the opener tab
        lastClickInitiatorInfo = null; // Reset after consuming
    }
});

chrome.webNavigation.onCommitted.addListener((details) => {
    // Ensure it's a main frame navigation and recording is active
    if (!isRecording || isPaused || details.frameId !== 0) { // Check isPaused
        return;
    }

    const eventBase = {
        time: new Date(details.timeStamp).toISOString(), // Use event timestamp from onCommitted
        details: { 
            url: details.url,
            transitionType: details.transitionType, // Store for context, can be useful
            transitionQualifiers: details.transitionQualifiers // Store for context
        }
    };

    let eventType = null;

    if (details.transitionType === 'reload') {
        // User manually refreshed the tab (e.g., F5, refresh button)
        eventType = 'RefreshCurrentPage';
        // No target attribute needed for RefreshCurrentPage
    } else {
        // Define transition types that should be considered as 'navigation'
        const navigationTransitionTypes = [
            'link', 
            'typed', 
            'form_submit', 
            'auto_bookmark', 
            'start_page', // e.g. browser startup, new window with home page
            'generated'   // e.g. JS initiated navigation, like window.location = ...
            // 'keyword' and 'keyword_generated' (from omnibox search) could also be included if desired
        ];

        if (navigationTransitionTypes.includes(details.transitionType)) {
            eventType = 'navigation';
        }
    }

    if (eventType) {
        addEventToLog({ type: eventType, ...eventBase }, details.tabId);
    } else {
        // Optionally log or ignore other transition types like 'auto_subframe', 'manual_subframe'
        console.log(`[Background] webNavigation.onCommitted: Ignoring transitionType '${details.transitionType}' for URL '${details.url}'`);
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    if (isRecording && !isPaused) { // Check isPaused
        chrome.tabs.get(activeInfo.tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.error("[Background] Error getting tab info onActivated:", chrome.runtime.lastError.message);
                return;
            }
            // We need to record the switch even if tab.url is initially empty (e.g. about:blank in a new window)
            // The title and URL in the log details have fallbacks.
            if (tab) { 
                const newTabId = activeInfo.tabId;
                const newWindowId = activeInfo.windowId;

                if (newWindowId !== currentFocusedWindowId) {
                    if (newWindowId === initialWindowId) {
                        // Switched back to the initial window from another window
                        addEventToLog({
                            type: 'switchToParentWindow',
                            time: new Date().toISOString(),
                            details: {
                                url: tab.url || '', // Ensure url is at least an empty string if undefined
                                title: tab.title || tab.url || "Untitled Tab", // Added title
                                windowId: newWindowId,
                                tabId: newTabId
                            }
                        }, newTabId);
                    } else {
                        // Switched to a new, different window (not the initial one)
                        // This is effectively a tab switch into a new window context
                        addEventToLog({
                            type: 'tabswitch', // This will become <switchtowindow>
                            time: new Date().toISOString(),
                            details: {
                                url: tab.url || '', // Ensure url is at least an empty string
                                title: tab.title || tab.url || "Untitled Tab",
                                windowId: newWindowId,
                                tabId: newTabId,
                                previousWindowId: currentFocusedWindowId
                            }
                        }, newTabId);
                    }
                    currentFocusedWindowId = newWindowId; // Update current focused window
                } else if (activeTabId !== newTabId) {
                    // Tab switch within the same window
                    addEventToLog({
                        type: 'tabswitch', // This will also become <switchtowindow>
                        time: new Date().toISOString(),
                        details: {
                            url: tab.url || '', // Ensure url is at least an empty string
                            title: tab.title || tab.url || "Untitled Tab",
                            windowId: newWindowId,
                            tabId: newTabId
                        }
                    }, newTabId);
                }

                activeTabId = newTabId; // Update activeTabId regardless

                // Notify content script of the current tab about recording state
                // (might be redundant if content script already knows, but good for consistency)
                chrome.tabs.sendMessage(activeTabId, {
                    action: 'updateRecordingState',
                    isRecording: true,
                    isPaused: false
                }).catch(err => console.warn(`[Background] Could not notify active tab ${activeTabId} onActivated: ${err.message}`));
            }
        });
    }
});

chrome.windows.onBoundsChanged.addListener((window) => {
    if (isRecording && !isPaused && window.id === recordingWindowId) { // Check isPaused, use recordingWindowId
        chrome.windows.get(window.id, {}, (updatedWindow) => {
            // Check if window state has changed
            if (updatedWindow.state !== windowState) {
                windowState = updatedWindow.state;
                
                if (windowState === 'maximized') {
                    addEventToLog({
                        type: 'windowMaximize',
                        time: new Date().toISOString(),
                        details: { state: windowState }
                    }, activeTabId ?? -1);
                } else if (windowState === 'minimized') {
                    addEventToLog({
                        type: 'windowMinimize',
                        time: new Date().toISOString(),
                        details: { state: windowState }
                    }, activeTabId ?? -1);
                } else if (windowState === 'normal') {
                    addEventToLog({
                        type: 'windowRestore',
                        time: new Date().toISOString(),
                        details: { state: windowState }
                    }, activeTabId ?? -1);
                }
            }
            // Check for maximize based on window dimensions
            else if (isWindowMaximized(updatedWindow) && windowState !== 'maximized') {
                windowState = 'maximized';
                addEventToLog({
                    type: 'windowMaximize',
                    time: new Date().toISOString(),
                    details: { state: 'maximized-by-size' }
                }, activeTabId ?? -1);
            }
        });
    }
});

// Listen for window state changes directly
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (isRecording && !isPaused && windowId !== chrome.windows.WINDOW_ID_NONE) { // Check isPaused
        chrome.windows.get(windowId, {}, (window) => {
            if (window.state !== windowState) {
                const previousState = windowState;
                windowState = window.state;
                
                addEventToLog({
                    type: windowState === 'maximized' ? 'windowMaximize' : 
                         (windowState === 'minimized' ? 'windowMinimize' : 'windowStateChange'),
                    time: new Date().toISOString(),
                    details: { 
                        previousState: previousState,
                        currentState: windowState 
                    }
                }, activeTabId ?? -1);
            }
        });
    }
});

chrome.downloads.onCreated.addListener((downloadItem) => {
    if (!isRecording || isPaused) return;

    const tabId = typeof activeTabId === 'number' ? activeTabId : -1;
    // Store initial download information. Filename might not be final yet.
    pendingFileDownloads[downloadItem.id] = {
        type: 'download', // Event type for the log
        initialFilename: downloadItem.filename,
        finalFilename: downloadItem.filename, // Will be updated if changed
        url: downloadItem.url,
        mime: downloadItem.mime,
        startTime: new Date(downloadItem.startTime).toISOString(), // Standardized ISO string
        tabId: tabId,
        id: downloadItem.id // Store downloadId for tracking
    };
    console.log(`[Background] Download ${downloadItem.id} initiated. Initial filename: ${downloadItem.filename}. URL: ${downloadItem.url}`);
});

chrome.downloads.onChanged.addListener((downloadDelta) => {
    if (!isRecording || isPaused) {
        // If not recording, clean up any pending download for this ID
        if (pendingFileDownloads[downloadDelta.id]) {
            delete pendingFileDownloads[downloadDelta.id];
        }
        return;
    }

    const pendingDownloadEntry = pendingFileDownloads[downloadDelta.id];
    if (pendingDownloadEntry) {
        let logNow = false;

        // Update the pending entry with new information from downloadDelta
        if (downloadDelta.filename && downloadDelta.filename.current) {
            pendingDownloadEntry.finalFilename = downloadDelta.filename.current;
            console.log(`[Background] Download ${downloadDelta.id} filename updated to: ${pendingDownloadEntry.finalFilename}`);
        }
        if (downloadDelta.state) {
            pendingDownloadEntry.downloadState = downloadDelta.state.current;
            if (downloadDelta.state.current === 'complete' || downloadDelta.state.current === 'interrupted') {
                logNow = true;
                if (downloadDelta.state.current === 'interrupted' && downloadDelta.error && downloadDelta.error.current) {
                    pendingDownloadEntry.downloadError = downloadDelta.error.current;
                }
                console.log(`[Background] Download ${downloadDelta.id} state: ${pendingDownloadEntry.downloadState}. Error: ${pendingDownloadEntry.downloadError || 'None'}`);
            }
        }

        if (logNow) {
            const detailsForLog = {
                filename: pendingDownloadEntry.finalFilename, // Use the potentially updated filename
                url: pendingDownloadEntry.url,
                mime: pendingDownloadEntry.mime,
            };
            if (pendingDownloadEntry.downloadState) detailsForLog.downloadState = pendingDownloadEntry.downloadState;
            if (pendingDownloadEntry.downloadError) detailsForLog.downloadError = pendingDownloadEntry.downloadError;

            addEventToLog({
                type: 'download',
                time: pendingDownloadEntry.startTime, // Use original start time for chronological order
                details: detailsForLog
            }, pendingDownloadEntry.tabId);

            delete pendingFileDownloads[downloadDelta.id]; // Clean up
        }
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "recordFindElement" && isRecording && !isPaused && tab) {
        // Send a message to the content script of the tab where the right-click happened
        chrome.tabs.sendMessage(tab.id, { action: "captureRightClickedElementForFind" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Background] Error sending captureRightClickedElementForFind message:", chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log("[Background] Find element action initiated in content script for tab:", tab.id);
            } else {
                console.warn("[Background] Content script did not confirm find element action:", response);
            }
        });
    }
});

// Always update content script state on tab update (page load or reload)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Update content script state on page load/reload
    if (changeInfo.status === "complete") {
        chrome.tabs.sendMessage(tabId, {
            action: 'updateRecordingState',
            isRecording,
            isPaused
        }).catch(() => { /* console.warn(`[Background] Failed to send updateRecordingState (onUpdated) to tab ${tabId}`); */ });
    }

    // Attempt to update the title of a recent tabswitch event if a new title comes in.
    // This handles cases where the title wasn't fully available during the onActivated event.
    if (isRecording && !isPaused && changeInfo.title && tab) { // Ensure tab object is available
        const newTitle = changeInfo.title;
        const tabUrl = tab.url;

        // Proceed if the new title is meaningful and it's not a chrome internal page
        if (newTitle && newTitle.trim() !== '' && tabUrl && !tabUrl.startsWith('chrome://')) {
            // Iterate backwards through the event log to find the most recent 'tabswitch' event for this tab
            for (let i = eventLog.length - 1; i >= 0; i--) {
                const event = eventLog[i];

                // Check if the event is a 'tabswitch' for the current tabId
                // and occurred within a reasonable time window (e.g., 5 seconds)
                if (event.type === 'tabswitch' &&
                    event.details &&
                    event.details.tabId === tabId && // tabId is from onUpdated listener parameters
                    (new Date().getTime() - new Date(event.time).getTime()) < 5000) { // 5-second window

                    const oldTitleInLog = event.details.title;

                    // Update if the new title is different from the logged one,
                    // or if the logged one was a placeholder (like the URL or "Untitled Tab").
                    // We prefer the newTitle from changeInfo as it's directly from the update.
                    if (oldTitleInLog !== newTitle &&
                        (oldTitleInLog === event.details.url || oldTitleInLog === "Untitled Tab" || newTitle !== event.details.url)) {
                        
                        // Avoid overwriting a good title with the URL, unless the old title was also a placeholder.
                        if (!(newTitle === event.details.url && oldTitleInLog && oldTitleInLog !== "Untitled Tab" && oldTitleInLog !== event.details.url)) {
                            console.log(`[Background] Updating title for 'tabswitch' event. TabId: ${tabId}. Old: "${oldTitleInLog}", New: "${newTitle}"`);
                            event.details.title = newTitle;
                        }
                    }
                    // Found the most recent relevant tabswitch event for this tab, so break.
                    break;
                }

                // Optimization: If we've checked too many events (e.g., >10) or gone too far back in time (e.g., >7s), stop.
                if ((eventLog.length - 1 - i >= 10) || ((new Date().getTime() - new Date(event.time).getTime()) > 7000)) {
                    break;
                }
            }
        }
    }
});