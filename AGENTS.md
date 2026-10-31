# Torn Userscript Development Standards

## 1. Primary Objective

Build reliable, maintainable userscripts for Torn City, with TornPDA compatibility as a primary requirement.

Do not assume that code working in desktop Chrome will necessarily work correctly in TornPDA. Consider its mobile interface, embedded browser environment, dynamic page navigation, and available browser APIs.

Treat the requirements of each individual project as authoritative when they differ from these general standards.

## 2. TornPDA Compatibility

- Design and test for TornPDA compatibility wherever possible.
- Avoid relying on browser APIs or userscript-manager features that may not be available in TornPDA.
- Use standard JavaScript and browser APIs when practical.
- Respect the existing page structure and avoid unnecessarily modifying Torn's interface.
- Account for dynamic content, DOM replacement, and single-page application (SPA) navigation.
- Ensure scripts initialize correctly when their target elements appear after the initial page load.
- Avoid duplicate event listeners, observers, buttons, timers, and interface elements during navigation or reinitialization.
- Restrict execution to the intended Torn pages whenever possible.
- Do not assume a userscript is working merely because it initializes without errors.

## 3. Mobile-First Interface Design

The user primarily uses TornPDA on a Google Pixel Fold and prefers compact, readable interfaces.

- Design for a narrow phone viewport first.
- Prevent horizontal overflow and unwanted page-width expansion.
- Use responsive widths, sensible padding, and appropriately sized controls.
- Avoid unnecessary vertical space.
- Keep popups compact and easy to dismiss.
- Position buttons and panels so they do not obstruct important Torn controls.
- Consider the available viewport when the device keyboard, browser interface, or other overlays are visible.
- Keep touch targets usable without making the interface unnecessarily large.
- Use scrolling within a popup when content exceeds its available height rather than expanding the popup indefinitely.

## 4. Dark Mode and Accessibility

The user uses TornPDA's dark mode and expects strong contrast.

- Use high-contrast text and backgrounds.
- Avoid dark gray text on black backgrounds, dim blue text, and other low-contrast combinations.
- Use clear borders and distinguishable button states.
- Ensure important information remains readable at small font sizes.
- Use colors that distinguish status, warnings, success, and errors without relying on color alone.
- Keep popups readable against both the game's background and the surrounding interface.
- Avoid overriding global styles or changing the appearance of unrelated page elements.

## 5. Popups, Buttons, and Injected Elements

- Keep injected interfaces small, unobtrusive, and mobile-friendly.
- Do not cover existing Torn buttons, navigation controls, fight controls, or important information.
- Prefer dedicated containers and uniquely prefixed IDs and CSS classes.
- Avoid generic selectors that could unintentionally style Torn's existing elements.
- Give injected buttons clear labels and accessible interaction states.
- Provide reliable ways to close popups.
- Avoid injecting duplicate controls when the script initializes more than once.
- Clean up obsolete elements when navigating away from supported pages.
- Follow the requested placement for each project; do not assume all interfaces should appear at the top or bottom of the screen.

## 6. API Usage, Privacy, and Performance

The user prefers scripts that avoid unnecessary API calls.

- Do not make external requests unless the requested functionality requires them.
- Prefer local processing and local storage when suitable.
- When API requests are necessary, use caching, sensible refresh intervals, and request deduplication.
- Respect API rate limits and applicable Torn API rules.
- Never hardcode a real API key into publicly shared code.
- Use an explicit placeholder when a key must be supplied by the user.
- Do not transmit private game data to third parties without a clear requirement and user awareness.
- Avoid frequent polling when a MutationObserver or another event-driven approach is more appropriate.
- Prevent observers from reacting indefinitely to the script's own DOM modifications.
- Bound caches and stored history so they cannot grow without limit.
- Handle missing data, failed requests, malformed responses, and storage errors gracefully.

## 7. Local Storage and Persistence

When a script needs to remember information:

- Prefer localStorage or another suitable local persistence mechanism when appropriate.
- Use a unique, namespaced storage key.
- Validate stored data before using it.
- Handle invalid or outdated stored data without breaking the script.
- Keep storage formats predictable.
- Avoid erasing existing user data during an update unless explicitly required.
- Provide a clear/reset function when appropriate.
- Preserve existing records during script updates whenever the data format permits.

## 8. Dynamic Page Monitoring

Torn frequently updates page content without a full reload.

When monitoring live content:

- Identify the actual DOM elements responsible for displaying the information.
- Do not assume an element will be replaced when its contents change.
- Detect relevant text, attribute, and structural changes as appropriate.
- Handle elements that appear after initialization.
- Account for existing content and new content separately.
- Avoid treating initial page content as a new event unless the project requirements explicitly call for capturing it.
- Prevent duplicate records when the same event triggers multiple DOM mutations.
- Handle temporary empty containers and complete content replacement.
- Reinitialize correctly when navigation changes the URL without reloading the page.
- Use narrowly scoped observers when possible.
- Debounce expensive operations without introducing delays that could cause important events to be missed.

For live fight-log monitoring, for example, the script must distinguish a new trophy-marked entry from an existing entry that Torn updates in place.

## 9. Debugging and Diagnostics

When a script fails:

- Diagnose the actual failure before rewriting unrelated functionality.
- Use temporary diagnostic logging to inspect relevant elements, attributes, text, URLs, and state changes.
- Verify selectors against the actual DOM instead of guessing.
- Distinguish initialization failures, element-detection failures, event-detection failures, and storage failures.
- Remove excessive diagnostic logging from the final release or gate it behind a debug setting.
- Avoid claiming a fix is verified unless it has actually been tested.
- Explain any remaining uncertainty and give the user a practical way to verify the result.

If the user provides a screenshot, use it to understand the visible interface, but do not assume it reveals every underlying DOM attribute or class.

## 10. Code Quality and Script Updates

- Provide complete, internally consistent code.
- Preserve working functionality unless a change is requested.
- Use clear function names, comments, and logical sections.
- Avoid unnecessary dependencies.
- Handle exceptions where failures could disrupt the user experience.
- Ensure initialization and cleanup are safe to repeat.
- Increment the script version when making a meaningful release.
- Review selectors, event listeners, storage behavior, timers, and observer cleanup before delivery.
- Check for syntax errors and obvious logic errors before presenting the script.

## 11. How to Deliver Code to This User

The user prefers practical, ready-to-use solutions.

- When asked to fix or update an existing script, provide the complete corrected script rather than asking the user to locate and replace several separate sections.
- Split large scripts into clearly numbered, sequential copyable parts when requested or when necessary for convenient copying.
- Ensure the parts concatenate into one valid script.
- Identify exactly where each part begins and ends.
- Never omit unchanged sections when claiming to provide the complete script.
- Explain whether the script replaces the old version or is an addition to it.
- Avoid making the user manually search for obscure functions or CSS rules when a complete replacement is practical.
- If a partial patch is genuinely the better option, identify the exact section to replace and provide clear instructions.

## 12. Honesty and Verification

- Do not claim TornPDA compatibility has been verified unless it has actually been tested in TornPDA.
- Do not guarantee compliance with Torn's rules without sufficient evidence.
- Distinguish observed facts from assumptions.
- Prefer a small, testable change over an unnecessarily large rewrite when diagnosing a specific bug.
- When a screenshot, console output, or DOM inspection would materially improve reliability, request the specific evidence needed.
- Explain what the user should observe when testing the fix.

## 13. Project-Specific Requirements

Before modifying an existing script:

1. Read the entire current script.
2. Identify its existing functionality and constraints.
3. Identify the exact cause of the problem where possible.
4. Preserve existing features that are unrelated to the requested change.
5. Apply the user's project-specific requirements.
6. Review the complete resulting script for conflicts and regressions.
7. Provide concise testing instructions.

Do not silently change business logic, calculations, data sources, pricing assumptions, storage behavior, or interface placement.

When requirements conflict, follow the user's most recent explicit instruction for that project and explain any important trade-offs.

## 14. User-Specific Release and Commit Workflow

- After changing a userscript, increment its `@version` in the main `.js` file and update the matching `TornPDA/meta/<script-name>.meta.js` file to the same version in the same change. Use the next patch version unless the scope warrants a minor or major version increment.
- Keep the main script's `@downloadURL` pointed at that script's raw GitHub URL and its `@updateURL` pointed at the corresponding file under `TornPDA/meta/`.
- Keep the metadata file's name, namespace, version, match pattern, run time, grants, and download URL consistent with the main script. Create the metadata file if a remotely updateable script does not have one.
- After finishing and validating a requested code change, provide a concise, ready-to-paste commit message summarizing the changes since the last commit. Do not create the commit unless explicitly asked.