document.addEventListener('DOMContentLoaded', function () {
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const viewButton = document.getElementById('viewButton');
    const pauseButton = document.getElementById('pauseButton'); // New pause button
    const exportButton = document.getElementById('exportButton');
    const eventList = document.querySelector('.event-list');
    const noEventsMessage = document.querySelector('.no-events');

    let isRecording = false;
    let isPaused = false; // New state for pause
    let events = [];

    // Check initial recording state
    chrome.runtime.sendMessage({ action: 'checkRecordingState' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("[Popup] Error checking recording state:", chrome.runtime.lastError.message);
            return;
        }
        if (response && response.isRecording !== undefined && response.isPaused !== undefined) {
            isRecording = response.isRecording;
            isPaused = response.isPaused;
            console.log("[Popup] Initial recording state:", isRecording);
            updateButtonStates();
        }
    });

    // Updates the states of buttons based on recording status
    function updateButtonStates() {
        startButton.disabled = isRecording;
        stopButton.disabled = !isRecording;
        pauseButton.disabled = !isRecording;

        if (isRecording) {
            startButton.classList.add('recording');
            startButton.textContent = isPaused ? 'Paused' : 'Recording...';
            pauseButton.textContent = isPaused ? 'Resume Recording' : 'Pause Recording';
        } else {
            startButton.classList.remove('recording');
            startButton.textContent = 'Start Recording';
            pauseButton.textContent = 'Pause Recording'; // Reset text, will be disabled
            isPaused = false; // Reset pause state when not recording
        }
    }

    // Show a message to the user
    function showMessage(text, type = 'info') {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = text;
        document.body.appendChild(messageElement);
        
        // Show the message
        setTimeout(() => {
            messageElement.classList.add('show');
        }, 10);
        
        // Hide and remove the message after 3 seconds
        setTimeout(() => {
            messageElement.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(messageElement);
            }, 300);
        }, 3000);
    }

    // Display events in the popup
    function displayEvents() {
        eventList.innerHTML = `
            <div class="event-header">
                <div>Type</div>
                <div>Time</div>
                <div>Details</div>
            </div>
        `;

        if (events.length === 0) {
            const noEventsElement = document.createElement('div');
            noEventsElement.className = 'no-events';
            noEventsElement.textContent = 'No events recorded yet.';
            eventList.appendChild(noEventsElement);
            return;
        }

        events.forEach((event) => {
            const eventElement = document.createElement('div');
            eventElement.classList.add('event-item', event.type);
            
            const detailsText = typeof event.details === 'object' 
                ? Object.keys(event.details).map(key => `${key}: ${JSON.stringify(event.details[key])}`).join(', ')
                : JSON.stringify(event.details);
                
            eventElement.innerHTML = `
                <div class="event-type">${event.type}</div>
                <div class="event-time">${event.time || new Date(event.timestamp).toLocaleTimeString()}</div>
                <div class="event-details">${detailsText.substring(0, 100)}${detailsText.length > 100 ? '...' : ''}</div>
            `;
            
            // Add expanded details section (initially hidden)
            const expandedDetails = document.createElement('div');
            expandedDetails.className = 'expanded-details';
            expandedDetails.textContent = JSON.stringify(event.details, null, 2);
            eventElement.appendChild(expandedDetails);
            
            // Toggle expanded details on click
            eventElement.addEventListener('click', () => {
                expandedDetails.style.display = expandedDetails.style.display === 'block' ? 'none' : 'block';
            });
            
            eventList.appendChild(eventElement);
        });
    }

    // Start recording when the button is clicked
    startButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error starting recording:", chrome.runtime.lastError.message);
                showMessage('Failed to start recording', 'error'); return;
            }
            if (response && response.success && response.newState) {
                isRecording = response.newState.isRecording;
                isPaused = response.newState.isPaused;
                updateButtonStates();
                showMessage('Recording started');
            } else {
                console.error("Error starting recording:", response?.error);
                showMessage('Failed to start recording', 'error');
            }
        });
    });

    // Stop recording when the button is clicked
    stopButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error stopping recording:", chrome.runtime.lastError.message);
                showMessage('Failed to stop recording', 'error'); return;
            }
            if (response && response.success && response.newState) {
                isRecording = response.newState.isRecording;
                isPaused = response.newState.isPaused;
                updateButtonStates();
                showMessage('Recording stopped');
                
                // Auto-refresh the event list after stopping
                chrome.runtime.sendMessage({ action: 'getEventLog' }, (response) => {
                    if (response && response.log) {
                        events = response.log;
                        displayEvents();
                    } else if (chrome.runtime.lastError) {
                        console.error("[Popup] Error getting event log after stop:", chrome.runtime.lastError.message);
                        displayEvents();
                    }
                });
            } else {
                console.error("Error stopping recording:", response?.error);
                showMessage('Failed to stop recording', 'error');
            }
        });
    });

    // Pause or Resume recording
    pauseButton.addEventListener('click', () => {
        const action = isPaused ? 'resumeRecording' : 'pauseRecording';
        chrome.runtime.sendMessage({ action: action }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`[Popup] Error ${action}:`, chrome.runtime.lastError.message);
                showMessage(`Failed to ${isPaused ? 'resume' : 'pause'} recording`, 'error'); return;
            }
            if (response && response.success && response.newState) {
                isRecording = response.newState.isRecording;
                isPaused = response.newState.isPaused;
                updateButtonStates();
                showMessage(`Recording ${isPaused ? 'paused' : 'resumed'}`);
            } else {
                console.error(`Error ${isPaused ? 'resuming' : 'pausing'} recording:`, response?.error);
                showMessage(`Failed to ${isPaused ? 'resume' : 'pause'} recording`, 'error');
            }
        });
    });

    // View the event log
    viewButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'getEventLog' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error getting event log:", chrome.runtime.lastError.message);
                events = []; // Clear events on error
                displayEvents();
                showMessage('Failed to retrieve event log', 'error');
                return;
            }

            if (response && response.log) {
                events = response.log;
                displayEvents();
                showMessage(`Showing ${events.length} events`);
            } else {
                console.error("Error getting event log:", response?.error);
                showMessage('Failed to retrieve event log', 'error');
            }
        });
    });

    // Helper function to process locator pairs (id, xpath, css) and determine active/commented lines
    function processLocatorPairs(pairs, prefix = "") {
        let activeLine = '';
        let commentedLines = [];

        const attributePrefix = prefix ? `${prefix}L` : 'l'; // sourceLocatorType vs locatorType

        if (!pairs || pairs.length === 0) {
            activeLine = `        ${attributePrefix}ocatorType="id" ${attributePrefix}ocatorExpression=""\n`;
            // console.warn(`[Popup] No ${prefix}locator pairs found, defaulting to empty ID.`);
            return { activeLine, commentedLines };
        }

        const idPair = pairs.find(p => p.type === 'id');
        const xpathPair = pairs.find(p => p.type === 'xpath');
        const cssPair = pairs.find(p => p.type === 'cssSelector');

        let chosenActivePair = null;

        // New Priority: XPath (non-empty) -> ID (non-empty) -> CSS (non-empty)
        // Fallback: XPath (even if empty) -> ID (even if empty) -> CSS (even if empty)
        if (xpathPair && xpathPair.expression) {
            chosenActivePair = xpathPair;
        } else if (idPair && idPair.expression) {
            chosenActivePair = idPair;
        } else if (cssPair && cssPair.expression) {
            chosenActivePair = cssPair;
        } else if (xpathPair) { // Fallback to XPath
            chosenActivePair = xpathPair;
        } else if (idPair) { // Fallback to ID
            chosenActivePair = idPair;
        } else if (cssPair) { // Should not be reached if idPair always exists
            chosenActivePair = cssPair;
        }

        if (chosenActivePair) {
            activeLine = `        ${attributePrefix}ocatorType="${chosenActivePair.type}" ${attributePrefix}ocatorExpression="${chosenActivePair.expression}"\n`;
        } else {
            // Fallback, though chosenActivePair should ideally be set if any pair exists.
            // If no pairs exist at all, this will default to an empty ID locator.
            activeLine = `        ${attributePrefix}ocatorType="xpath" ${attributePrefix}ocatorExpression=""\n`;
            // console.warn(`[Popup] Could not determine an active ${prefix}locator, defaulting to empty XPath.`);
        }

        if (idPair && idPair.expression && (!chosenActivePair || chosenActivePair.type !== 'id')) { // Only comment if it has an expression
            commentedLines.push(`    <!-- ${attributePrefix}ocatorType="id" ${attributePrefix}ocatorExpression="${idPair.expression}" -->\n`);
        }
        if (xpathPair && xpathPair.expression && (!chosenActivePair || chosenActivePair.type !== 'xpath')) { // Only comment if it has an expression
            commentedLines.push(`    <!-- ${attributePrefix}ocatorType="xpath" ${attributePrefix}ocatorExpression="${xpathPair.expression}" -->\n`);
        }
        if (cssPair && cssPair.expression && (!chosenActivePair || chosenActivePair.type !== 'cssSelector')) {
            commentedLines.push(`    <!-- ${attributePrefix}ocatorType="cssSelector" ${attributePrefix}ocatorExpression="${cssPair.expression}" -->\n`);
        }
        return { activeLine, commentedLines };
    }

    // Helper function to prepare locators for XML attributes
    function assignLocatorsToAttributes(attributes, locators, prefix = "") {
        if (!locators) return; // Guard against null or undefined locators object

        const currentLocatorPairs = [];

        // Priority 1: ID for locatorType1
        // Always include an ID entry. Expression is "" if locators.id is null/undefined or an empty string.
        let idExpression = "";
        if (locators.id !== null && locators.id !== undefined && String(locators.id).trim() !== '') {
            idExpression = String(locators.id);
        } else if (locators.id !== null && locators.id !== undefined) { // Handles case where id is present but empty string
            idExpression = ""; // Ensure it's an empty string, not the original (e.g. " ")
        }
        currentLocatorPairs.push({ type: 'id', expression: idExpression });

        // Priority 2: XPath for locatorType2
        if (locators.xpath && String(locators.xpath).trim() !== '') {
            currentLocatorPairs.push({ type: 'xpath', expression: String(locators.xpath) });
        }
        // Priority 3: CSS for locatorType3
        if (locators.css && String(locators.css).trim() !== '') {
            currentLocatorPairs.push({ type: 'cssSelector', expression: String(locators.css) });
        }

        if (currentLocatorPairs.length > 0) {
            const keyName = prefix ? `${prefix}LocatorPairs` : 'locatorPairs';
            // Escape expressions when adding to attributes
            attributes[keyName] = currentLocatorPairs.map(pair => ({
                type: pair.type,
                expression: escapeXml(pair.expression) // Escape here before storing
            }));
        }
    }

    // Convert events to XML format
    function convertEventsToXml(events) {
        const SCROLL_EVENT_WAIT_TIME_MS = 500; // Default wait time in ms after a scroll event

        // XML header
        let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n`;
        // TestCase opening tag with namespaces on separate lines
        xml += `<TestCase xmlns="https://www.steepgraph.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\nxsi:schemaLocation="https://www.steepgraph.com ../../../resources/xsd/TestAutomationFramework.xsd">\n \n`;
        // Add Login tag
        xml += `    <Login username="$csv{username}" password="$csv{password}" />\n \n`;


        if (!events || events.length === 0) {
            xml += `</TestCase>\n`;
            return xml;
        }

        const firstEventTime = new Date(events[0].time).getTime();

        events.forEach(event => {
            const e = event.details || {};
            const currentEventTime = new Date(event.time).getTime(); // Use event.time for consistency
            const relativeTimestamp = String(currentEventTime - firstEventTime); // Calculate relative time

            let tagName = '';
            let eventAttributes = {};
            let includeTag = true; // This seems unused in the new logic, but keeping it as it was in the provided code.

            // This baseAttributes is specifically for PageRefreshed as per the new logic
            // const baseAttributesForPageRefreshed = { timestamp: relativeTimestamp }; // This variable is not used
            // if (e.iframeSrc) {
            //     baseAttributesForPageRefreshed.iframe = escapeXml(e.iframeSrc); // This variable is not used
            // }

            switch (event.type) {
                case 'navigation':
                case 'pageload':
                    includeTag = false; // Prevent OpenURL tag generation
                    break;

                case 'click':
                    tagName = 'ClickElement';
                    const clickLocs = e.locators || {};
                    eventAttributes = {
                        timestamp: relativeTimestamp
                    };
                    assignLocatorsToAttributes(eventAttributes, clickLocs); // Populates eventAttributes.locatorPairs
                    if (e.iframeSrc) eventAttributes.iframe = escapeXml(e.iframeSrc);
                    break;

                case 'iframeClick':
                    tagName = 'ClickElement';
                    const iframeResolvedLocs = e.locators || {};
                    eventAttributes = {
                        timestamp: relativeTimestamp
                    };
                    assignLocatorsToAttributes(eventAttributes, iframeResolvedLocs); // Populates eventAttributes.locatorPairs
                    // Restore iframe context: 'e' is event.details, which includes iframeSrc for iframeClick events
                    if (e.iframeSrc) {
                        eventAttributes.iframe = escapeXml(e.iframeSrc);
                    }
                    break;

                case 'input':
                    const inputLocs = e.locators || {};
                    if (e.type === 'password') {
                        tagName = 'Password'; // Use <Password> tag for password fields
                        eventAttributes = {
                            value: '********', // Add masked password value (updated to 8 asterisks)
                            timestamp: relativeTimestamp
                        };
                    } else {
                        tagName = 'InputText'; 
                        eventAttributes = {
                            value: escapeXml(e.value || ''), // The actual text to input
                            timestamp: relativeTimestamp // Add timestamp for InputText
                        };
                        // Add the 'id' attribute specifically if present in locators
                        // This 'id' attribute in eventAttributes will be the HTML element's actual ID.
                        if (inputLocs.id) {
                            eventAttributes.id = escapeXml(inputLocs.id);
                        }
                    }
                    assignLocatorsToAttributes(eventAttributes, inputLocs);
                    if (e.iframeSrc) eventAttributes.iframe = escapeXml(e.iframeSrc);
                    break;
                case 'selectChange': // New case for select element changes
                    tagName = 'selectelement';
                    const selectLocs = e.locators || {};
                    eventAttributes = {
                        value: escapeXml(e.value || ''), // The selected value
                        timestamp: relativeTimestamp
                    };
                    assignLocatorsToAttributes(eventAttributes, selectLocs); // Locators of the <select> element
                    if (e.iframeSrc) eventAttributes.iframe = escapeXml(e.iframeSrc);
                    break;

                case 'tabswitch': // Event for tab activation or switching to a new (non-parent) window
                    tagName = 'SwitchToWindow'; 
                    eventAttributes = {
                        // e.title is sourced from event.details.title, which background.js populates using:
                        // tab.title || tab.url || "Untitled Tab". So, e.title should always be a usable string.
                        title: escapeXml(e.title) 
                    };
                    break;

                case 'maximize':
                case 'windowMaximize':
                    tagName = 'MaximiseWindow'; // Note: Standard XML might prefer MaximiseWindow or MaximizeWindow
                    eventAttributes = {}; // No attributes as per example
                    break;

                case 'windowMinimize':
                    tagName = 'MinimizeWindow'; // Note: Standard XML might prefer MinimizeWindow
                    eventAttributes = {};
                    break;

                case 'rightclick':
                    const rightClickLocs = e.locators || {};
                    if (e.contextAction === 'saveAs') {
                        tagName = 'SaveAsElement';
                        eventAttributes = {
                            url: escapeXml(e.url || ''),
                            filename: escapeXml(e.filename || ''),
                            timestamp: relativeTimestamp
                        };
                    } else {
                        tagName = 'RightClickElement';
                        eventAttributes = {
                            timestamp: relativeTimestamp
                        };
                    }
                    assignLocatorsToAttributes(eventAttributes, rightClickLocs); // Populates eventAttributes.locatorPairs
                    if (e.iframeSrc) eventAttributes.iframe = escapeXml(e.iframeSrc);
                    break;

                case 'download':
                    tagName = 'SaveAS';
                    // Download events from background.js don't have DOM locators.
                    // e.locators will be undefined or empty.
                    const downloadLocs = e.locators || {};
                    eventAttributes = {
                        filename: escapeXml(e.filename || ''),
                        timestamp: relativeTimestamp
                    };
                    // Downloads from background might not have DOM locators.
                    // If e.locators exists (e.g., if a download was triggered by clicking a link with locators),
                    // assignLocatorsToAttributes will handle it.
                    assignLocatorsToAttributes(eventAttributes, downloadLocs); // Populates eventAttributes.locatorPairs
                    break;

                case 'scroll':
                    tagName = 'ScrollToElement';

                    // Add scroll percentage comment
                    xml += `    <!-- Scrolled to ${e.scrollPercentage}% of ${e.isWindow ? 'page' : e.elementType} -->\n`;

                    eventAttributes = { // Base attributes for all scroll events
                        timestamp: relativeTimestamp
                    };

                    // If it's a specific element scroll, use its locators
                    if (!e.isWindow && e.locators && (e.locators.id || e.locators.css || e.locators.xpath)) {
                        assignLocatorsToAttributes(eventAttributes, e.locators);
                    } else {
                        // For window scroll, or element scroll with no usable locators, default to page scroll.
                        eventAttributes.locatorType = 'cssSelector';
                        eventAttributes.locatorExpression = 'html'; // Use 'html' as a general page target
                    }
                    break;

                case 'iframeLoaded': // This event is logged when an iframe's content has loaded.
                    includeTag = false; // Not generating a specific XML tag for load, focus switch is handled by 'switchToFrame'.
                    break;

                case 'switchToFrame': // Event logged when focus enters an iframe's content
                    tagName = 'SwitchToFrame';
                    eventAttributes = {
                        // Prioritize e.frameName (path from inside iframe, logged on click)
                        // Fallback to e.name (path of iframe elements from parent, logged on focus)
                        name: (e.frameName || e.name || '') // Leave => as-is, do not escape
                    };
                    // Timestamp and other locators are intentionally removed as per the request.
                    break;

                case 'switchToParentFrame': // New event type for switching to parent frame
                    tagName = 'SwitchToParentFrame'; // Corrected casing
                    eventAttributes = {
                        timestamp: relativeTimestamp
                    };
                    break;

                case 'switchToParentWindow': // New event type for switching to parent window
                    tagName = 'SwitchToParentWindow';
                    eventAttributes = {
                        // No attributes by default, as per your request.
                    };
                    break;

                case 'findElement': // New case for find element action
                    tagName = 'findelement';
                    const findLocs = e.locators || {};
                    eventAttributes = {
                        timestamp: relativeTimestamp
                        // Optionally add tagName: escapeXml(e.tagName || '') if you logged it
                    };
                    assignLocatorsToAttributes(eventAttributes, findLocs);
                    break;

                case 'drop':
                case 'manualDrop':
                    tagName = 'DragAndDrop';
                    const sourceLocs = e.sourceLocators || {};
                    const targetLocs = e.targetLocators || {};
                    eventAttributes = {
                        timestamp: relativeTimestamp,
                        sourceIframe: escapeXml(e.sourceIframe || ''), // Ensure attribute is present
                        targetIframe: escapeXml(e.targetIframe || '')  // Ensure attribute is present
                    };
                    assignLocatorsToAttributes(eventAttributes, sourceLocs, "source"); // Populates eventAttributes.sourceLocatorPairs
                    assignLocatorsToAttributes(eventAttributes, targetLocs, "target");   // Populates eventAttributes.targetLocatorPairs
                    break;

                case 'dragend':
                    tagName = 'DragEnd'; // Define a tag name for this event
                    const dragEndLocs = e.locators || {}; // 'locators' here refers to the source element
                    eventAttributes = {
                        cancelled: escapeXml(String(e.cancelled || 'false')),
                        timestamp: relativeTimestamp
                    };
                    assignLocatorsToAttributes(eventAttributes, dragEndLocs); // Populates eventAttributes.locatorPairs
                    break;

                case 'RefreshCurrentPage': // Changed from ClickRefreshButton
                    tagName = 'RefreshCurrentPage';
                    eventAttributes = {}; // No attributes for RefreshCurrentPage
                    break;

                case 'reload':
                    includeTag = false; // Do not generate PageRefreshed for reload events
                    break;

                case 'uploadfile':
                    tagName = 'FileUpload';
                    const uploadLocs = e.locators || {};
                    const files = Array.isArray(e.filenames) ? e.filenames.join(', ') : (e.filenames || '');
                    eventAttributes = { // Assuming FileUpload also uses standard locators for the input element
                        files: escapeXml(files),
                        timestamp: relativeTimestamp
                    };
                    assignLocatorsToAttributes(eventAttributes, uploadLocs); // Populates eventAttributes.locatorPairs
                    if (e.iframeSrc) eventAttributes.iframe = escapeXml(e.iframeSrc);
                    break;

                case 'pause':
                    includeTag = false; // These event types are logged but not intended to create XML tags
                    break;
                case 'resume':
                    includeTag = false;
                    break;
                
                case 'sendkeys':
                    tagName = 'SendKeys';
                    // e.key will be the mapped value like "ARROW_UP" from content.js
                    eventAttributes = {
                        key: escapeXml(e.key || '')
                        // No timestamp or locators are added to the XML for SendKeys,
                        // matching the requested simple format: <SendKeys key="ARROW_VALUE"/>
                    };
                    // Ensure timestamp is added if the schema requires/allows it for all tags
                    // For now, keeping it simple as per the comment above. If timestamp is needed:
                    // eventAttributes.timestamp = relativeTimestamp;
                    // And if locators for the focused element are needed:
                    // assignLocatorsToAttributes(eventAttributes, e.locators);
                    break;

                case 'newTabOpenedByClick': // Handle the new event type
                    // e.title might be the preliminary title from onCreated, or the URL as a fallback.
                    // This event is informational. Actual tab/window switches are handled by
                    // 'tabswitch' and 'switchToParentWindow' events from chrome.tabs.onActivated,
                    // which reflect true focus changes.
                    includeTag = false; 
                    break;

                default:
                    includeTag = false; // Ignore unknown event types
            }

            if (includeTag && tagName) {
                // The specific 'if (tagName === 'InputText')' block has been removed.
                // InputText will now be handled by the generic logic below, similar to ClickElement.
                let mainAttributeLines = [];
                let timestampLine = '';

                let activeLocatorLine = '';
                let commentedLocatorLines = [];
                let activeSourceLocatorLine = '';
                let commentedSourceLocatorLines = [];
                let activeTargetLocatorLine = '';
                let commentedTargetLocatorLines = [];

                const tempAttributes = { ...eventAttributes }; // Clone to safely delete properties

                if (tempAttributes.locatorPairs) {
                    const result = processLocatorPairs(tempAttributes.locatorPairs);
                    activeLocatorLine = result.activeLine;
                    commentedLocatorLines = result.commentedLines;
                    delete tempAttributes.locatorPairs;
                }
                if (tempAttributes.sourceLocatorPairs) {
                    const result = processLocatorPairs(tempAttributes.sourceLocatorPairs, "source");
                    activeSourceLocatorLine = result.activeLine;
                    commentedSourceLocatorLines = result.commentedLines;
                    delete tempAttributes.sourceLocatorPairs;
                }
                if (tempAttributes.targetLocatorPairs) {
                    const result = processLocatorPairs(tempAttributes.targetLocatorPairs, "target");
                    activeTargetLocatorLine = result.activeLine;
                    commentedTargetLocatorLines = result.commentedLines;
                    delete tempAttributes.targetLocatorPairs;
                }

                // Handle remaining attributes, saving timestamp for last
                Object.entries(tempAttributes).forEach(([key, value]) => {
                    if (key === 'timestamp') {
                        timestampLine = `        ${key}="${value}"\n`;
                    } else {
                        mainAttributeLines.push(`        ${key}="${value}"\n`);
                    }
                });

                const finalAttributeBlock = mainAttributeLines.join('') +
                                          activeLocatorLine +
                                          activeSourceLocatorLine +
                                          activeTargetLocatorLine +
                                          timestampLine;

                if (finalAttributeBlock.trim() !== '') {
                    xml += `    <${tagName}\n`;
                    xml += finalAttributeBlock;
                    xml += `    />\n \n`;
                } else { 
                    xml += `    <${tagName}/>\n \n`;
                }

                // Append commented locators
                commentedLocatorLines.forEach(line => xml += line);
                commentedSourceLocatorLines.forEach(line => xml += line);
                commentedTargetLocatorLines.forEach(line => xml += line);

                // Add <wait> tag after <ScrollToElement>
                if (tagName === 'ScrollToElement') {
                    xml += `    <wait time="${SCROLL_EVENT_WAIT_TIME_MS}"/>\n \n`;
                }

                // The extra `xml += \n` after each event block is removed for cleaner and more consistent spacing.
                // Both InputText and other tags now manage their trailing newlines (typically \n\n after the tag or last comment).
            } // Closing 'if (includeTag && tagName)'
        });

        // Add Logout tag
        xml += `    <Logout/>\n \n`;

        xml += `</TestCase>\n \n`;
        return xml;
    }

    // Export events as XML when the export button is clicked
    exportButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'getEventLog' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Popup] Error getting event log for export:", chrome.runtime.lastError.message);
                showMessage('Failed to export XML', 'error');
                return;
            }
            if (response && response.log) {
                const xmlData = convertEventsToXml(response.log);
                const filename = `steepgraph_recording_${new Date().toISOString().replace(/[:.]/g, '-')}.xml`;
                downloadXmlFile(xmlData, filename);
                showMessage('XML exported successfully');
            } else {
                console.error("Error getting event log for export:", response?.error);
                showMessage('Failed to export XML', 'error');
            }
        });
    });

    // Download the XML file
    function downloadXmlFile(xml, filename) {
        const blob = new Blob([xml], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Escape special characters for XML (moved here to be defined before assignLocatorsToAttributes if it were nested, but it's fine at this scope)
    function escapeXml(string) {
        if (string === undefined || string === null) return '';
        return String(string).replace(/[<>&'"]/g, char => ({
            '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
        })[char]);
    }

    // Initialize button states
    updateButtonStates();

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (isRecording && !isPaused && changeInfo.status === "complete") {
            chrome.tabs.sendMessage(tabId, {
                action: 'updateRecordingState',
                isRecording: true,
                isPaused: false
            }).catch(() => {});
        }
    });
});